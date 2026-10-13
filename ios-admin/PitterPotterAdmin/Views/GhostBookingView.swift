import SwiftUI

struct GhostBookingView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @Environment(\.dismiss) var dismiss

    @State private var seats = 1
    @State private var selectedStudio: Studio = .Putney
    @State private var capacity: CapacityResult?
    @State private var capacityLoading = false
    @State private var isSaving = false

    private var availableStudios: [Studio] {
        authVM.staff?.visibleStudios ?? Studio.allCases
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Quick Walk-in"), footer: Text("Blocks seats from now for a 2-hour session — for walk-in painters.")) {
                    if availableStudios.count > 1 {
                        Picker("Studio", selection: $selectedStudio) {
                            ForEach(availableStudios, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                    }

                    Stepper("Seats: \(seats)", value: $seats, in: 1...50)
                }

                Section(header: Text("Capacity Check")) {
                    if capacityLoading {
                        ProgressView("Checking capacity...")
                    } else if let cap = capacity {
                        HStack {
                            Image(systemName: "person.2")
                                .foregroundStyle(cap.remaining <= 0 ? .red : cap.remaining <= 5 ? .orange : .green)
                            Text("\(cap.remaining) spots remaining")
                                .foregroundStyle(cap.remaining <= 0 ? .red : cap.remaining <= 5 ? .orange : .green)
                                .fontWeight(.bold)
                        }
                        if cap.hasPartyBooking {
                            Label("A party is booked at this time", systemImage: "exclamationmark.triangle")
                                .font(AppFont.body(12, weight: .medium))
                                .foregroundStyle(.orange)
                        }
                    } else {
                        Text("Tap to check capacity")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                }

                Section {
                    Button {
                        Task { await saveGhostBooking() }
                    } label: {
                        HStack {
                            if isSaving { ProgressView() }
                            Text(isSaving ? "Blocking..." : "Block Seats")
                                .fontWeight(.bold)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(PPBrand.charcoal)
                    .disabled(isSaving || (capacity != nil && capacity!.remaining < seats))
                }
            }
            .navigationTitle("Quick Walk-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                selectedStudio = bookingsVM.selectedStudio.flatMap { availableStudios.contains($0) ? $0 : nil }
                    ?? availableStudios.first ?? .Putney
                checkCapacity()
            }
            .onChange(of: selectedStudio) { _ in checkCapacity() }
        }
    }

    private func checkCapacity() {
        guard let staff = authVM.staff else { return }
        let now = Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: now)
        let timeStr = String(format: "%02d:%02d", Calendar.current.component(.hour, from: now), Calendar.current.component(.minute, from: now))

        capacityLoading = true
        Task {
            do {
                let result = try await APIClient.shared.checkCapacity(
                    studio: selectedStudio.rawValue,
                    date: dateStr,
                    time: timeStr,
                    sessionType: "painting"
                )
                await MainActor.run {
                    capacity = result
                    capacityLoading = false
                }
            } catch {
                await MainActor.run { capacityLoading = false }
            }
        }
    }

    private func saveGhostBooking() async {
        guard let staff = authVM.staff else { return }
        isSaving = true

        let now = Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: now)
        let timeStr = String(format: "%02d:%02d", Calendar.current.component(.hour, from: now), Calendar.current.component(.minute, from: now))

        let booking = Booking(
            id: "walkin_\(Int(now.timeIntervalSince1970 * 1000))",
            studio: selectedStudio.rawValue,
            name: "Walk-in",
            email: "",
            phone: "",
            date: dateStr,
            time: timeStr,
            paintersCount: seats,
            sessionType: "painting",
            notes: "Walk-in: \(seats) painter\(seats != 1 ? "s" : "")",
            status: "confirmed",
            requestDate: ISO8601DateFormatter().string(from: now),
            estimatedPrice: nil,
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
            collectedAt: nil,
            photoTags: nil
        )

        let success = await bookingsVM.createWalkIn(booking, staff: staff)
        isSaving = false
        if success {
            Haptics.success()
            dismiss()
        } else {
            Haptics.error()
        }
    }
}
