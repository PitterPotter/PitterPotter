import SwiftUI

struct PartyBookingView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @Environment(\.dismiss) var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var selectedStudio: Studio = .Putney
    @State private var date = Date()
    @State private var time = "11:00"
    @State private var paintersCount = 10
    @State private var sessionType: SessionType = .birthdayParty
    @State private var notes = ""
    @State private var depositAmount = "50"
    @State private var sendDepositLink = true
    @State private var isCreating = false
    @State private var capacityResult: CapacityResult?
    @State private var checkingCapacity = false
    @State private var loadedSlots: TimeSlotsData?

    private var availableStudios: [Studio] {
        authVM.staff?.visibleStudios ?? Studio.allCases
    }

    private var partyTimeSlots: [String] {
        let studioKey = selectedStudio.rawValue
        let calendar = Calendar.current
        let weekday = calendar.component(.weekday, from: date)
        let isWeekend = weekday == 1 || weekday == 7
        let dayType = isWeekend ? "weekend" : "weekday"
        if let loaded = loadedSlots, let studio = loaded.dict[studioKey],
           let party = studio["party"] as? [String: Any],
           let slotsByDay = party["slots"] as? [String: [String]],
           let slots = slotsByDay[dayType] {
            return filteredSlots(slots)
        }
        let defaults = ["10:00-12:00", "12:30-14:30", "15:00-17:00"]
        return filteredSlots(defaults)
    }

    private func filteredSlots(_ slots: [String]) -> [String] {
        let calendar = Calendar.current
        let now = Date()
        let isSameDay = calendar.isDate(date, inSameDayAs: now)
        if !isSameDay { return slots }
        return slots.filter { slot in
            let startTime = slot.split(separator: "-").first.map(String.init) ?? slot
            let parts = startTime.split(separator: ":").compactMap { Int($0) }
            guard parts.count >= 2 else { return true }
            let slotDate = calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: date) ?? date
            return slotDate > now
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Customer")) {
                    TextField("Name", text: $name)
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                    TextField("Phone", text: $phone)
                }

                Section(header: Text("Booking")) {
                    if availableStudios.count > 1 {
                        Picker("Studio", selection: $selectedStudio) {
                            ForEach(availableStudios, id: \.self) { s in
                                Text(s.rawValue).tag(s)
                            }
                        }
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    .onChange(of: date) { _ in
                        capacityResult = nil
                        if let first = partyTimeSlots.first { time = first }
                        checkCapacity()
                    }
                    if partyTimeSlots.isEmpty {
                        Text("No slots available for this date")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(.red)
                    } else {
                        Picker("Time", selection: $time) {
                            ForEach(partyTimeSlots, id: \.self) { t in
                                Text(t).tag(t)
                            }
                        }
                        .onChange(of: time) { _ in
                            capacityResult = nil
                            checkCapacity()
                        }
                    }
                    Stepper("Painters: \(paintersCount)", value: $paintersCount, in: 1...100)
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }

                Section(header: Text("Availability")) {
                    if checkingCapacity {
                        HStack {
                            ProgressView()
                            Text("Checking availability...")
                        }
                    } else if let cap = capacityResult {
                        if cap.conflict == "party_session_exists" {
                            Label("Another party is already booked at this time", systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.red)
                        } else if cap.remaining < paintersCount {
                            Label("Only \(cap.remaining) spots available", systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        } else {
                            Label("\(cap.remaining) of \(cap.max) spots available", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                    } else {
                        Text("Select date, time and studio to check availability")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                }

                Section(header: Text("Deposit")) {
                    Toggle("Send deposit payment link", isOn: $sendDepositLink)
                    if sendDepositLink {
                        TextField("Deposit amount (£)", text: $depositAmount)
                            .keyboardType(.decimalPad)
                        Text("A deposit payment link will be emailed to the customer.")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                }

                Section {
                    Button {
                        createBooking()
                    } label: {
                        HStack {
                            if isCreating { ProgressView() }
                            Text(isCreating ? "Creating..." : "Create Party Booking")
                        }
                    }
                    .disabled(name.isEmpty || isCreating)
                }
            }
            .navigationTitle("New Party Booking")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                selectedStudio = bookingsVM.selectedStudio.flatMap { availableStudios.contains($0) ? $0 : nil }
                    ?? availableStudios.first ?? .Putney
                if let first = partyTimeSlots.first { time = first }
                loadTimeSlots()
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onChange(of: selectedStudio) { _ in
                capacityResult = nil
                if let first = partyTimeSlots.first { time = first }
                checkCapacity()
            }
            .onTapGesture {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
        }
    }

    private func loadTimeSlots() {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                if let value = try await APIClient.shared.loadSetting(key: "time_slots", staff: staff),
                   let data = value.data(using: .utf8),
                   let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    await MainActor.run {
                        loadedSlots = TimeSlotsData.fromDict(parsed)
                        if let first = partyTimeSlots.first { time = first }
                    }
                    return
                }
            } catch {}
            await MainActor.run {
                loadedSlots = TimeSlotsData.default
                if let first = partyTimeSlots.first { time = first }
            }
        }
    }

    private func checkCapacity() {
        guard let staff = authVM.staff else { return }
        checkingCapacity = true
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)

        Task {
            do {
                let result = try await APIClient.shared.checkCapacity(
                    studio: selectedStudio.rawValue,
                    date: dateStr,
                    time: time,
                    sessionType: sessionType.rawValue
                )
                await MainActor.run {
                    capacityResult = result
                    checkingCapacity = false
                }
            } catch {
                await MainActor.run {
                    checkingCapacity = false
                }
            }
        }
    }

    private func createBooking() {
        guard let staff = authVM.staff else { return }
        isCreating = true

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)

        let booking = Booking(
            id: UUID().uuidString,
            studio: selectedStudio.rawValue,
            name: name,
            email: email,
            phone: phone,
            date: dateStr,
            time: time,
            paintersCount: paintersCount,
            sessionType: sessionType.rawValue,
            notes: notes.isEmpty ? nil : notes,
            status: "pending",
            requestDate: ISO8601DateFormatter().string(from: Date()),
            estimatedPrice: nil,
            source: "admin_app",
            giftCardCode: nil,
            giftCardDiscount: nil,
            finalPrice: nil,
            tableId: nil,
            depositAmount: Double(depositAmount),
            finalSeats: nil,
            finalBalance: nil,
            paymentLinkUrl: nil,
            paymentLinkSentAt: nil,
            paymentStatus: nil,
            stripePaymentIntentId: nil,
            managementToken: nil,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            photos: nil,
            collectionStatus: nil,
            collectedAt: nil,
            photoTags: nil
        )

        Task {
            let success = await bookingsVM.createWalkIn(booking, staff: staff)
            await MainActor.run {
                isCreating = false
                if success {
                    Analytics.track("party_booking_created", properties: [
                        "studio": selectedStudio.rawValue,
                        "session_type": sessionType.rawValue,
                        "painters": paintersCount
                    ])
                    dismiss()
                }
            }
        }
    }
}
