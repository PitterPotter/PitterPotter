import SwiftUI

struct NewWalkInView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @Environment(\.dismiss) var dismiss

    var initialSessionType: SessionType = .painting

    private var availableStudios: [Studio] {
        authVM.staff?.visibleStudios ?? Studio.allCases
    }

    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var selectedStudio: Studio = .Putney
    @State private var date = Date()
    @State private var time = "11:00"
    @State private var paintersCount = 1
    @State private var sessionType: SessionType = .painting
    @State private var notes = ""
    @State private var estimatedPrice = ""
    @State private var isSaving = false
    @State private var capacityWarning: String? = nil
    @State private var capacityRemaining: Int? = nil
    @State private var isCheckingCapacity = false

    // Baby Prints split
    @State private var babiesCount = 1
    @State private var adultsCount = 1

    private var isBabyPrints: Bool {
        initialSessionType == .clayImprints
    }

    private var effectivePaintersCount: Int {
        isBabyPrints ? babiesCount : paintersCount
    }

    private var effectiveNotes: String {
        if isBabyPrints {
            return "Babies: \(babiesCount), Adults: \(adultsCount)\(notes.isEmpty ? "" : " | \(notes)")"
        }
        return notes
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Customer") {
                    TextField("Name", text: $name)
                    TextField("Email", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    TextField("Phone", text: $phone)
                        .keyboardType(.phonePad)
                }

                Section("Booking") {
                    if availableStudios.count > 1 {
                        Picker("Studio", selection: $selectedStudio) {
                            ForEach(availableStudios, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("Time", text: $time)

                    if isBabyPrints {
                        Stepper("Babies: \(babiesCount)", value: $babiesCount, in: 1...50)
                        Stepper("Adults: \(adultsCount)", value: $adultsCount, in: 1...50)
                    } else {
                        Stepper("Painters: \(paintersCount)", value: $paintersCount, in: 1...100)
                    }
                }

                Section("Details") {
                    TextField("Estimated Price (£)", text: $estimatedPrice)
                        .keyboardType(.decimalPad)
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                if let warning = capacityWarning {
                    Section {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                            Text(warning)
                                .font(AppFont.body(12, weight: .medium))
                                .foregroundStyle(.orange)
                        }
                    }
                }

                if let remaining = capacityRemaining {
                    Section {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text("\(remaining) painter spots remaining for this slot")
                                .font(AppFont.body(12, weight: .medium))
                                .foregroundStyle(.green)
                        }
                    }
                }
            }
            .navigationTitle(initialSessionType == .painting ? "New Walk-in" : initialSessionType == .clayImprints ? "New Baby Print" : "New Booking")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                sessionType = initialSessionType
                selectedStudio = bookingsVM.selectedStudio.flatMap { availableStudios.contains($0) ? $0 : nil }
                    ?? availableStudios.first ?? .Putney
            }
            .onChange(of: selectedStudio) { _ in checkCapacity() }
            .onChange(of: date) { _ in checkCapacity() }
            .onChange(of: time) { _ in checkCapacity() }
            .onChange(of: paintersCount) { _ in checkCapacity() }
            .onChange(of: babiesCount) { _ in checkCapacity() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Create") {
                        Task { await createBooking() }
                    }
                    .fontWeight(.bold)
                    .disabled(name.isEmpty || isSaving)
                }
            }
            .overlay {
                if isSaving {
                    ProgressView("Creating...")
                        .padding()
                        .background(.regularMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    private func checkCapacity() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)

        isCheckingCapacity = true
        Task {
            do {
                let result = try await APIClient.shared.checkCapacity(
                    studio: selectedStudio.rawValue,
                    date: dateStr,
                    time: time,
                    sessionType: sessionType.rawValue
                )
                await MainActor.run {
                    capacityRemaining = result.remaining
                    if result.conflict == "party_session_exists" {
                        capacityWarning = "This time slot already has a party booked"
                    } else if result.remaining < effectivePaintersCount {
                        capacityWarning = "Only \(result.remaining) spots left — staff can still overbook"
                    } else {
                        capacityWarning = nil
                    }
                    isCheckingCapacity = false
                }
            } catch {
                await MainActor.run {
                    capacityWarning = nil
                    capacityRemaining = nil
                    isCheckingCapacity = false
                }
            }
        }
    }

    private func createBooking() async {
        guard let staff = authVM.staff else { return }
        isSaving = true

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)

        let booking = Booking(
            id: "walkin_\(Int(Date().timeIntervalSince1970 * 1000))",
            studio: selectedStudio.rawValue,
            name: name,
            email: email,
            phone: phone,
            date: dateStr,
            time: time,
            paintersCount: effectivePaintersCount,
            sessionType: sessionType.rawValue,
            notes: effectiveNotes.isEmpty ? nil : effectiveNotes,
            status: "confirmed",
            requestDate: dateStr,
            estimatedPrice: Double(estimatedPrice),
            source: "walk-in",
            giftCardCode: nil,
            giftCardDiscount: nil,
            finalPrice: nil,
            tableId: nil,
            depositAmount: nil,
            finalSeats: nil,
            finalBalance: nil,
            paymentLinkUrl: nil,
            paymentLinkSentAt: nil,
            paymentStatus: nil,
            stripePaymentIntentId: nil,
            managementToken: nil,
            createdAt: nil,
            photos: nil,
            collectionStatus: nil,
            readyAt: nil,
            collectedAt: nil,
            photoTags: nil
        )

        let success = await bookingsVM.createWalkIn(booking, staff: staff)
        isSaving = false
        if success {
            dismiss()
        }
    }
}
