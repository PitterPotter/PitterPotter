import SwiftUI

struct PaintingScannerView: View {
    @ObservedObject var bookingsVM: BookingsViewModel
    @ObservedObject var authVM: AuthViewModel
    @Environment(\.dismiss) var dismiss

    @State private var scannedCode: String?
    @State private var scanError: String?
    @State private var scannedBooking: Booking?
    @State private var isMarking = false
    @State private var voucherCode: String? = nil
    @State private var showVoucherRedeem = false
    @State private var isCheckingVoucher = false
    @State private var manualCode = ""

    var body: some View {
        NavigationStack {
            ZStack {
                if scannedBooking == nil {
                    GiftCardScannerView(scannedCode: $scannedCode)
                        .ignoresSafeArea()
                        .onAppear {
                            scannedCode = nil
                            scanError = nil
                        }
                        .onChange(of: scannedCode) { newValue in
                            if let code = newValue {
                                handleScannedCode(code)
                            }
                        }
                }

                VStack {
                    if let booking = scannedBooking {
                        scannedResultView(booking)
                    } else if let error = scanError {
                        errorView(error)
                    } else {
                        scannerOverlay
                    }
                }
            }
            .navigationTitle("Scanner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
            .sheet(isPresented: $showVoucherRedeem) {
                GiftCardRedeemView(initialCode: voucherCode ?? "")
                    .environmentObject(authVM)
            }
        }
    }

    private var scannerOverlay: some View {
        VStack {
            Spacer()
            VStack(spacing: 12) {
                Image(systemName: "qrcode.viewfinder")
                    .font(AppFont.body(40))
                    .foregroundStyle(PPBrand.charcoal)
                Text("Scan QR Code")
                    .font(AppFont.heading(16))
                    .foregroundStyle(PPBrand.charcoal)
                Text("Point the camera at any QR code — collection, booking, or gift card")
                    .font(AppFont.body(12, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    .multilineTextAlignment(.center)

                HStack(spacing: 8) {
                    TextField("Or type the code manually", text: $manualCode)
                        .font(AppFont.body(14, weight: .medium))
                        .textFieldStyle(.roundedBorder)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .onSubmit { submitManualCode() }
                    Button("Look Up") { submitManualCode() }
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(PPBrand.charcoal)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .disabled(manualCode.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.top, 4)
            }
            .padding(24)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    private func submitManualCode() {
        let code = manualCode.trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty else { return }
        manualCode = ""
        handleScannedCode(code)
    }

    private func scannedResultView(_ booking: Booking) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                if let photo = booking.photos?.first, let url = URL(string: photo) {
                    CachedAsyncImage(url: url, contentMode: .fit, maxDimension: 1000)
                        .frame(maxWidth: .infinity)
                        .frame(height: 240)
                        .background(PPBrand.clay100.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, 24)
                        .padding(.top, 24)
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: "camera")
                            .font(AppFont.body(28))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                        Text("No photo")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 160)
                    .background(PPBrand.clay100.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 24)
                    .padding(.top, 24)
                }

                HStack(spacing: 8) {
                    Image(systemName: "mappin.circle.fill")
                        .font(AppFont.body(16, weight: .bold))
                    Text("Location")
                        .font(AppFont.body(12, weight: .bold))
                    Spacer()
                    Text(bookingLocation(booking) ?? "Not set")
                        .font(AppFont.body(14, weight: .bold))
                }
                .foregroundStyle(PPBrand.charcoal)
                .padding(14)
                .background(PPBrand.sage)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 24)

                // Info card
                VStack(alignment: .leading, spacing: 10) {
                    infoRow("Name", booking.name, icon: "person.fill")
                    infoRow("Date", PPDateDisplay.date(booking.date), icon: "calendar")
                    infoRow("Phone", booking.phone.flatMap { $0.isEmpty ? nil : $0 } ?? "Not provided", icon: "phone.fill")
                    infoRow("Email", booking.email.flatMap { $0.isEmpty ? nil : $0 } ?? "Not provided", icon: "envelope.fill")
                    infoRow("Tags", bookingTagSummary(booking) ?? "No tags added", icon: "checkmark.circle.fill")
                }
                .padding(16)
                .background(PPBrand.sage.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 24)

                // Action button
                if booking.collectionStatus == CollectionStage.collected.rawValue {
                    Text("Already collected")
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .padding(.horizontal, 24)
                } else if booking.status == "completed" {
                    Button {
                        markCollected(booking)
                    } label: {
                        HStack(spacing: 8) {
                            if isMarking {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                Image(systemName: "checkmark.circle.fill")
                            }
                            Text("Mark as Collected")
                        }
                        .font(AppFont.body(16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(isMarking ? Color.green.opacity(0.6) : Color.green)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(isMarking)
                    .padding(.horizontal, 24)
                } else {
                    Text("Status: \(booking.status.capitalized) — not ready to collect")
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .padding(.horizontal, 24)
                }

                Button {
                    scannedBooking = nil
                    scannedCode = nil
                    scanError = nil
                } label: {
                    Text("Scan Another")
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 24)
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
        }
    }

    private func infoRow(_ label: String, _ value: String, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(AppFont.body(12))
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                .frame(width: 20)
            Text(label)
                .font(AppFont.body(11, weight: .bold))
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(AppFont.body(12, weight: .semibold))
                .foregroundStyle(PPBrand.charcoal)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func sessionLabel(_ session: String) -> String {
        switch session {
        case "painting": return "Painting"
        case "birthday-party": return "Birthday Party"
        case "baby-shower-hen": return "Baby Shower / Hen"
        case "clay-imprints": return "Baby Prints"
        case "corporate": return "Corporate"
        case "exclusive-hire": return "Exclusive Hire"
        default: return session
        }
    }

    private func collectionStageLabel(_ booking: Booking) -> String? {
        guard let status = booking.collectionStatus else { return nil }
        switch status {
        case CollectionStage.painted.rawValue: return "Painted"
        case CollectionStage.ready.rawValue: return "Ready to Collect"
        case CollectionStage.collected.rawValue: return "Collected"
        default: return status.capitalized
        }
    }

    private func bookingLocation(_ booking: Booking) -> String? {
        guard let photoTags = booking.photoTags else { return nil }
        for key in photoTags.keys.sorted() {
            if let location = photoTags[key]?.first(where: { $0.status == "location" })?.label, !location.isEmpty {
                return location
            }
        }
        return nil
    }

    private func bookingTagSummary(_ booking: Booking) -> String? {
        guard let photoTags = booking.photoTags else { return nil }
        var counts: [String: Int] = [:]
        for tag in photoTags.values.flatMap({ $0 }) where tag.status != "location" {
            let label = tag.label.flatMap { $0.isEmpty ? nil : $0 } ?? tag.status.replacingOccurrences(of: "_", with: " ").capitalized
            counts[label, default: 0] += 1
        }
        guard !counts.isEmpty else { return nil }
        return counts.keys.sorted().map { counts[$0] == 1 ? $0 : "\(counts[$0]!) × \($0)" }.joined(separator: ", ")
    }

    private func tagLabel(_ tag: PhotoTag) -> String {
        tag.label.flatMap { $0.isEmpty ? nil : $0 } ?? tag.status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private func errorView(_ error: String) -> some View {
        VStack {
            Spacer()
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(AppFont.body(40))
                    .foregroundStyle(Color.orange)
                Text(error)
                    .font(AppFont.body(14, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                    .multilineTextAlignment(.center)
                Button {
                    scanError = nil
                    scannedCode = nil
                } label: {
                    Text("Try Again")
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                }
            }
            .padding(24)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Color.black.opacity(0.1), radius: 8, y: 4)
            .padding(.horizontal, 24)
            Spacer()
        }
    }

    // Unified scan: collection QRs carry a booking token (?token=…), gift
    // voucher QRs carry the raw voucher code — route by content.
    private func handleScannedCode(_ code: String) {
        scannedCode = nil
        var token: String?
        if let url = URL(string: code), let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            token = components.queryItems?.first(where: { $0.name == "token" })?.value
        } else if code.hasPrefix("token=") {
            token = String(code.dropFirst(6))
        } else {
            token = code
        }

        guard let token = token, !token.isEmpty else {
            scanError = "Invalid QR code — no token found"
            Haptics.error()
            return
        }

        Task {
            if let staff = authVM.staff {
                await bookingsVM.loadBookings(staff: staff)
            }
            await MainActor.run {
                if let booking = bookingsVM.bookings.first(where: { $0.managementToken == token }) {
                    scannedBooking = booking
                    Haptics.success()
                } else {
                    // Not a booking token — try it as a gift voucher code
                    checkVoucher(token)
                }
            }
        }
    }

    private func checkVoucher(_ code: String) {
        guard let staff = authVM.staff else { return }
        isCheckingVoucher = true
        Task {
            do {
                _ = try await APIClient.shared.checkGiftCardBalance(code: code, staff: staff)
                await MainActor.run {
                    isCheckingVoucher = false
                    voucherCode = code
                    showVoucherRedeem = true
                    Haptics.success()
                }
            } catch {
                await MainActor.run {
                    isCheckingVoucher = false
                    scanError = "No booking or gift voucher found for this QR code"
                    Haptics.error()
                }
            }
        }
    }

    private func markCollected(_ booking: Booking) {
        guard let staff = authVM.staff else { return }
        isMarking = true
        Haptics.light()
        Task {
            do {
                try await APIClient.shared.updateCollectionStatus(
                    bookingId: booking.id, studio: booking.studio,
                    status: CollectionStage.collected.rawValue, staff: staff
                )
                await MainActor.run {
                    bookingsVM.updateBookingLocally(booking.id, collectionStatus: CollectionStage.collected.rawValue)
                    isMarking = false
                    Haptics.success()
                    scannedBooking = nil
                    scannedCode = nil
                    scanError = nil
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isMarking = false
                    scanError = "Failed to update: \(error.localizedDescription)"
                    Haptics.error()
                }
            }
        }
    }
}
