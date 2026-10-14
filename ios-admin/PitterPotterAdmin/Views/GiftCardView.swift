import SwiftUI

struct GiftCardView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var toastManager: ToastManager
    @State private var giftCards: [GiftCard] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var searchText = ""
    @State private var statusFilter: String? = nil
    @State private var showingCreate = false
    @State private var showingRedeem = false
    @State private var voucherFileURL: URL?
    @State private var showingVoucherShare = false
    @State private var downloadingVoucher: GiftCard?
    @State private var cardToRedeem: GiftCard?
    @State private var cardToUnredeem: GiftCard?

    private let statusOptions = ["active", "redeemed", "expired", "cancelled", "disabled"]

    private var filteredCards: [GiftCard] {
        giftCards.filter { card in
            if let status = statusFilter, card.status != status { return false }
            if !searchText.isEmpty {
                let q = searchText.lowercased()
                if !card.code.lowercased().contains(q),
                   !(card.recipientName?.lowercased().contains(q) ?? false),
                   !(card.recipientEmail?.lowercased().contains(q) ?? false),
                   !(card.recipientPhone?.lowercased().contains(q) ?? false) {
                    return false
                }
            }
            return true
        }
    }

    private var totalSold: Int { giftCards.count }

    private var activeCount: Int {
        giftCards.filter { $0.status == "active" }.count
    }

    private var totalValue: Double {
        giftCards.reduce(0) { $0 + $1.amount }
    }

    private var remainingBalance: Double {
        giftCards.reduce(0) { $0 + ($1.balance ?? $1.amount) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !giftCards.isEmpty {
                    giftCardStatsHeader
                }
                if isLoading {
                    ProgressView("Loading gift cards...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.orange)
                        Text(error)
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        Button("Retry") { loadGiftCards() }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filteredCards.isEmpty {
                    EmptyStateView(
                        icon: "giftcard",
                        title: "No gift cards",
                        subtitle: searchText.isEmpty ? "Gift cards will appear here" : "No cards match your search"
                    )
                } else {
                    List(filteredCards) { card in
                        GiftCardRowView(card: card)
                            .swipeActions(edge: .trailing) {
                                if card.status == "active" {
                                    Button {
                                        cardToRedeem = card
                                    } label: {
                                        Label("Redeem", systemImage: "checkmark.circle.fill")
                                    }
                                    .tint(PPBrand.charcoal)
                                    Button(role: .destructive) {
                                        cancelCard(card)
                                    } label: {
                                        Label("Cancel", systemImage: "xmark.circle")
                                    }
                                    Button {
                                        disableCard(card)
                                    } label: {
                                        Label("Disable", systemImage: "nosign")
                                    }
                                    .tint(.orange)
                                    Button(role: .destructive) {
                                        expireCard(card)
                                    } label: {
                                        Label("Expire", systemImage: "calendar.badge.exclamationmark")
                                    }
                                    .tint(.red)
                                }
                                if card.status == "disabled" {
                                    Button {
                                        enableCard(card)
                                    } label: {
                                        Label("Enable", systemImage: "checkmark.circle")
                                    }
                                    .tint(.green)
                                }
                                if card.status == "redeemed" {
                                    Button {
                                        cardToUnredeem = card
                                    } label: {
                                        Label("Un-redeem", systemImage: "arrow.uturn.backward.circle")
                                    }
                                    .tint(.green)
                                }
                                Button {
                                    copyCode(card)
                                } label: {
                                    Label("Copy", systemImage: "doc.on.doc")
                                }
                                .tint(PPBrand.clay300)
                                Button {
                                    downloadVoucher(card)
                                } label: {
                                    Label("Download", systemImage: "square.and.arrow.down")
                                }
                                .tint(PPBrand.clay300)
                                Button(role: .destructive) {
                                    deleteCard(card)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                if card.status == "active" {
                                    Button("Mark Redeemed") { cardToRedeem = card }
                                    Button("Cancel Card", role: .destructive) { cancelCard(card) }
                                    Button { disableCard(card) } label: {
                                        Label("Disable Card", systemImage: "nosign")
                                    }
                                    Button("Expire Card", role: .destructive) { expireCard(card) }
                                }
                                if card.status == "disabled" {
                                    Button { enableCard(card) } label: {
                                        Label("Enable Card", systemImage: "checkmark.circle")
                                    }
                                }
                                if card.status == "redeemed" {
                                    Button { cardToUnredeem = card } label: {
                                        Label("Un-redeem Card", systemImage: "arrow.uturn.backward.circle")
                                    }
                                }
                                Button { copyCode(card) } label: {
                                    Label("Copy Code", systemImage: "doc.on.doc")
                                }
                                if let email = card.recipientEmail, !email.isEmpty {
                                    Button { resendCard(card) } label: {
                                        Label("Resend Email", systemImage: "envelope.arrow.triangle.branch")
                                    }
                                }
                                Button { downloadVoucher(card) } label: {
                                    Label("Download Voucher", systemImage: "square.and.arrow.down")
                                }
                                Button("Delete Card", role: .destructive) { deleteCard(card) }
                            }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Gift Cards")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search code, name, email, phone")
            .onAppear { loadGiftCards() }
            .refreshable { loadGiftCards() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack {
                        Button {
                            showingRedeem = true
                        } label: {
                            Image(systemName: "qrcode.viewfinder")
                        }
                        if !giftCards.isEmpty {
                            Button {
                                CSVExporter.exportGiftCards(giftCards)
                            } label: {
                                Image(systemName: "square.and.arrow.up")
                            }
                        }
                        Button {
                            showingCreate = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
            }
            .sheet(isPresented: $showingCreate) {
                CreateGiftCardView()
                    .environmentObject(authVM)
            }
            .sheet(isPresented: $showingRedeem) {
                GiftCardRedeemView()
                    .environmentObject(authVM)
            }
            .alert("Delete Gift Card?", isPresented: Binding(
                get: { cardToDelete != nil },
                set: { if !$0 { cardToDelete = nil } }
            )) {
                Button("Delete", role: .destructive) { confirmDelete() }
                Button("Cancel", role: .cancel) { cardToDelete = nil }
            } message: {
                if let card = cardToDelete {
                    Text("Permanently delete gift card \(card.code)? This cannot be undone.")
                }
            }
            .alert("Mark Redeemed?", isPresented: Binding(
                get: { cardToRedeem != nil },
                set: { if !$0 { cardToRedeem = nil } }
            )) {
                Button("Mark Redeemed") { if let card = cardToRedeem { redeemCard(card) }; cardToRedeem = nil }
                Button("Cancel", role: .cancel) { cardToRedeem = nil }
            } message: {
                if let card = cardToRedeem {
                    Text("Mark gift card \(card.code) as redeemed?")
                }
            }
            .alert("Un-redeem Gift Card?", isPresented: Binding(
                get: { cardToUnredeem != nil },
                set: { if !$0 { cardToUnredeem = nil } }
            )) {
                Button("Restore to Active") { if let card = cardToUnredeem { unredeemCard(card) }; cardToUnredeem = nil }
                Button("Cancel", role: .cancel) { cardToUnredeem = nil }
            } message: {
                if let card = cardToUnredeem {
                    Text("Restore gift card \(card.code) to active? If its balance was fully used it will be restored to the full amount.")
                }
            }
        }
    }

    private var giftCardStatsHeader: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            WebStatCard(title: "Total Sold", value: "\(totalSold)", icon: "giftcard.fill")
            WebStatCard(title: "Active", value: "\(activeCount)", icon: "checkmark.circle")
            WebStatCard(title: "Total Value", value: String(format: "£%.2f", totalValue), icon: "sterlingsign.circle")
            WebStatCard(title: "Remaining Balance", value: String(format: "£%.2f", remainingBalance), icon: "creditcard")
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private func loadGiftCards() {
        guard let staff = authVM.staff else { return }
        isLoading = true
        error = nil
        Task {
            do {
                let result = try await APIClient.shared.loadGiftCards(staff: staff)
                await MainActor.run {
                    giftCards = result
                    isLoading = false
                }
            } catch let err as APIError {
                await MainActor.run {
                    self.error = err.errorDescription
                    isLoading = false
                }
            } catch let err {
                await MainActor.run {
                    self.error = err.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func redeemCard(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                try await APIClient.shared.updateGiftCardStatus(id: card.id, status: "redeemed", staff: staff)
                await MainActor.run {
                    if let idx = giftCards.firstIndex(where: { $0.id == card.id }) {
                        giftCards[idx].status = "redeemed"
                    }
                    Haptics.success()
                    toastManager.success("Gift card redeemed")
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.error("Failed to redeem card")
                }
            }
        }
    }

    private func unredeemCard(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                let restoredBalance = try await APIClient.shared.unredeemGiftCard(id: card.id, staff: staff)
                await MainActor.run {
                    if let idx = giftCards.firstIndex(where: { $0.id == card.id }) {
                        giftCards[idx].status = "active"
                        giftCards[idx].balance = restoredBalance
                    }
                    Haptics.success()
                    toastManager.success("Gift card restored to active")
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.error("Failed to un-redeem card")
                }
            }
        }
    }

    private func cancelCard(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                try await APIClient.shared.updateGiftCardStatus(id: card.id, status: "cancelled", staff: staff)
                await MainActor.run {
                    if let idx = giftCards.firstIndex(where: { $0.id == card.id }) {
                        giftCards[idx].status = "cancelled"
                    }
                    Haptics.success()
                    toastManager.success("Gift card cancelled")
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.error("Failed to cancel card")
                }
            }
        }
    }

    private func disableCard(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                try await APIClient.shared.updateGiftCardStatus(id: card.id, status: "disabled", staff: staff)
                await MainActor.run {
                    if let idx = giftCards.firstIndex(where: { $0.id == card.id }) {
                        giftCards[idx].status = "disabled"
                    }
                    Haptics.success()
                    toastManager.success("Gift card disabled")
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.error("Failed to disable card")
                }
            }
        }
    }

    private func enableCard(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                try await APIClient.shared.updateGiftCardStatus(id: card.id, status: "active", staff: staff)
                await MainActor.run {
                    if let idx = giftCards.firstIndex(where: { $0.id == card.id }) {
                        giftCards[idx].status = "active"
                    }
                    Haptics.success()
                    toastManager.success("Gift card enabled")
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.error("Failed to enable card")
                }
            }
        }
    }

    private func expireCard(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                try await APIClient.shared.updateGiftCardStatus(id: card.id, status: "expired", staff: staff)
                await MainActor.run {
                    if let idx = giftCards.firstIndex(where: { $0.id == card.id }) {
                        giftCards[idx].status = "expired"
                    }
                    Haptics.success()
                    toastManager.success("Gift card expired")
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.error("Failed to expire card")
                }
            }
        }
    }

    private func copyCode(_ card: GiftCard) {
        UIPasteboard.general.string = card.code
        Haptics.light()
        toastManager.success("Code copied to clipboard")
    }

    @State private var cardToDelete: GiftCard?

    private func deleteCard(_ card: GiftCard) {
        cardToDelete = card
    }

    private func resendCard(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                try await APIClient.shared.resendGiftCard(id: card.id, staff: staff)
                await MainActor.run {
                    Haptics.success()
                    toastManager.success("Email resent to \(card.recipientEmail ?? "")")
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.error("Failed to resend email")
                }
            }
        }
    }

    private func downloadVoucher(_ card: GiftCard) {
        guard let staff = authVM.staff else { return }
        downloadingVoucher = card
        Task {
            do {
                let pdfData = try await APIClient.shared.downloadGiftCardVoucher(id: card.id, staff: staff)
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("pitter-potter-gift-voucher-\(card.code).pdf")
                try pdfData.write(to: tempURL)
                await MainActor.run {
                    downloadingVoucher = nil
                    Haptics.success()
                    toastManager.success("Voucher downloaded")
                    voucherFileURL = tempURL
                    showingVoucherShare = true
                }
            } catch {
                await MainActor.run {
                    downloadingVoucher = nil
                    Haptics.error()
                    toastManager.error("Failed to download voucher")
                }
            }
        }
    }

    private func confirmDelete() {
        guard let staff = authVM.staff, let card = cardToDelete else { return }
        Task {
            do {
                try await APIClient.shared.deleteGiftCard(id: card.id, staff: staff)
                await MainActor.run {
                    giftCards.removeAll { $0.id == card.id }
                    cardToDelete = nil
                    Haptics.success()
                    toastManager.success("Gift card deleted")
                }
            } catch {
                await MainActor.run {
                    cardToDelete = nil
                    Haptics.error()
                    toastManager.error("Failed to delete card")
                }
            }
        }
    }
}

struct GiftCardRowView: View {
    let card: GiftCard

    var body: some View {
        HStack(spacing: 12) {
            VStack(spacing: 4) {
                Image(systemName: "giftcard.fill")
                    .font(AppFont.body(20))
                    .foregroundStyle(statusColor)
            }
            .frame(width: 44, height: 44)
            .background(statusColor.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 3) {
                Text(card.code)
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundStyle(PPBrand.charcoal)
                if let name = card.recipientName {
                    Text(name)
                        .font(AppFont.body(13, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
                if let email = card.recipientEmail, !email.isEmpty {
                    Text(email)
                        .font(AppFont.body(11, weight: .medium))
                        .foregroundStyle(PPBrand.clay300)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                if card.isActivityVoucher {
                    Text(card.covers ?? "")
                        .font(AppFont.body(11, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal)
                        .lineLimit(2)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 140)
                } else {
                    Text("£\(String(format: "%.0f", card.amount))")
                        .font(AppFont.heading(17))
                        .foregroundStyle(PPBrand.charcoal)
                }
                if !card.isActivityVoucher, let balance = card.balance, balance != card.amount {
                    Text("Bal £\(String(format: "%.0f", balance))")
                        .font(AppFont.body(11, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
                Text(card.statusLabel)
                    .font(AppFont.body(9, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.3)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(statusColor.opacity(0.15))
                    .foregroundStyle(statusColor)
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 6)
    }

    private var statusColor: Color {
        switch card.status {
        case "active": return PPBrand.confirmedBadgeText
        case "redeemed": return PPBrand.charcoal
        case "expired": return PPBrand.cancelledBadgeText
        case "cancelled": return PPBrand.cancelledBadgeText
        case "disabled": return PPBrand.seatedBadgeText
        default: return .gray
        }
    }
}

// MARK: - Gift Card Scanner Sheet

struct GiftCardScannerSheet: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) var dismiss

    @State private var scannedCode: String?
    @State private var scanError: String?
    @State private var giftCard: GiftCardBalanceResult?
    @State private var isChecking = false
    @State private var isRedeeming = false

    var body: some View {
        NavigationStack {
            ZStack {
                if giftCard == nil {
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
                    if let card = giftCard {
                        giftCardResultView(card)
                    } else if let error = scanError {
                        errorView(error)
                    } else if isChecking {
                        ProgressView("Checking gift card...")
                            .padding()
                            .background(.regularMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    } else {
                        scannerOverlay
                    }
                }
            }
            .navigationTitle("Gift Card Scanner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private var scannerOverlay: some View {
        VStack {
            Spacer()
            VStack(spacing: 8) {
                Image(systemName: "giftcard")
                    .font(AppFont.body(40))
                    .foregroundStyle(.white.opacity(0.8))
                Text("Scan a gift card QR code")
                    .font(AppFont.body(16, weight: .bold))
                    .foregroundStyle(.white.opacity(0.9))
                Text("Point the camera at the QR code")
                    .font(AppFont.body(13))
                    .foregroundStyle(.white.opacity(0.6))
            }
            .padding(.bottom, 60)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack {
            Spacer()
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle")
                    .font(AppFont.body(36))
                    .foregroundStyle(.orange)
                Text(message)
                    .font(AppFont.body(15, weight: .medium))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(PPBrand.charcoal)
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

    private func giftCardResultView(_ card: GiftCardBalanceResult) -> some View {
        VStack(spacing: 16) {
            Spacer()

            VStack(spacing: 16) {
                Image(systemName: "giftcard.fill")
                    .font(AppFont.body(36))
                    .foregroundStyle(Color.purple)

                Text("Gift Card")
                    .font(AppFont.heading(20))
                    .foregroundStyle(PPBrand.charcoal)

                Text(card.code)
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.6))

                VStack(spacing: 8) {
                    if card.isActivityVoucher {
                        Label(card.covers ?? "", systemImage: "heart.fill")
                            .font(AppFont.body(13, weight: .bold))
                            .foregroundStyle(.purple)
                            .multilineTextAlignment(.center)
                    } else {
                        HStack(spacing: 16) {
                            Label(String(format: "£%.2f", card.balance), systemImage: "sterlingsign.circle.fill")
                                .font(AppFont.body(14, weight: .bold))
                            Label(card.status.capitalized, systemImage: "tag.fill")
                                .font(AppFont.body(12, weight: .bold))
                        }
                        .foregroundStyle(PPBrand.charcoal.opacity(0.7))
                    }

                    if let name = card.recipientName, !name.isEmpty {
                        Text(name)
                            .font(AppFont.body(13, weight: .semibold))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    }
                }

                if card.status.lowercased() == "active" {
                    Button {
                        redeemCard(card)
                    } label: {
                        HStack(spacing: 8) {
                            if isRedeeming {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: "checkmark.circle.fill")
                            }
                            Text(card.isActivityVoucher ? "Mark as Used" : "Mark as Redeemed")
                        }
                        .font(AppFont.body(16, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(isRedeeming ? Color.purple.opacity(0.6) : Color.purple)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(isRedeeming)
                    .padding(.top, 8)
                } else {
                    Text("Status: \(card.status.capitalized)")
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .padding(.top, 8)
                }

                Button {
                    giftCard = nil
                    scannedCode = nil
                    scanError = nil
                } label: {
                    Text("Scan Another")
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                }
                .padding(.top, 4)
            }
            .padding(24)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: Color.black.opacity(0.1), radius: 8, y: 4)
            .padding(.horizontal, 24)

            Spacer()
        }
    }

    private func handleScannedCode(_ code: String) {
        scannedCode = nil
        guard let staff = authVM.staff else {
            scanError = "Not authenticated"
            Haptics.error()
            return
        }

        isChecking = true
        Task {
            do {
                let result = try await APIClient.shared.checkGiftCardBalance(code: code, staff: staff)
                await MainActor.run {
                    isChecking = false
                    giftCard = result
                    Haptics.success()
                }
            } catch {
                await MainActor.run {
                    isChecking = false
                    scanError = "Gift card not found"
                    Haptics.error()
                }
            }
        }
    }

    private func redeemCard(_ card: GiftCardBalanceResult) {
        guard let staff = authVM.staff else { return }
        isRedeeming = true
        Haptics.light()
        Task {
            do {
                _ = try await APIClient.shared.updateGiftCardStatus(id: card.id, status: "redeemed", staff: staff)
                await MainActor.run {
                    isRedeeming = false
                    Haptics.success()
                    giftCard = nil
                    scannedCode = nil
                    scanError = nil
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isRedeeming = false
                    scanError = "Failed to redeem gift card"
                    Haptics.error()
                }
            }
        }
    }
}
