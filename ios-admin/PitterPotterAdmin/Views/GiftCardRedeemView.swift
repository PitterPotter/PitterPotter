import SwiftUI

struct GiftCardRedeemView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) var dismiss

    @State private var code = ""
    @State private var balanceResult: GiftCardBalanceResult?
    @State private var redeemAmount = ""
    @State private var isChecking = false
    @State private var isRedeeming = false
    @State private var error: String?
    @State private var redeemResult: GiftCardRedeemResult?
    @State private var showingScanner = false
    @State private var scannedCode: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Gift Card Code")) {
                    HStack {
                        TextField("PP-XXXXXXXXXX", text: $code)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.system(.body, design: .monospaced))

                        Button {
                            showingScanner = true
                        } label: {
                            Image(systemName: "qrcode.viewfinder")
                                .font(AppFont.heading(22))
                        }
                        .buttonStyle(.borderless)
                    }

                    Button {
                        checkBalance()
                    } label: {
                        HStack {
                            if isChecking { ProgressView() }
                            Text("Check Balance")
                        }
                    }
                    .disabled(code.isEmpty || isChecking)
                }

                if let result = balanceResult {
                    Section(header: Text("Card Details")) {
                        LabeledContent("Code", value: result.code)
                        if result.isActivityVoucher {
                            LabeledContent("Covers", value: result.covers ?? "")
                        } else {
                            LabeledContent("Original Amount", value: "£\(String(format: "%.2f", result.amount))")
                            LabeledContent("Balance", value: "£\(String(format: "%.2f", result.balance))")
                                .fontWeight(.bold)
                        }
                        LabeledContent("Status", value: result.status.capitalized)
                        if let name = result.recipientName, !name.isEmpty {
                            LabeledContent("Recipient", value: name)
                        }
                    }

                    if result.status == "active" && result.isActivityVoucher {
                        Section {
                            Button {
                                markUsed()
                            } label: {
                                HStack {
                                    if isRedeeming { ProgressView() }
                                    Text(isRedeeming ? "Marking..." : "Mark as Used")
                                        .fontWeight(.bold)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.purple)
                            .disabled(isRedeeming)
                        }
                    }

                    if result.status == "active" && !result.isActivityVoucher && result.balance > 0 {
                        Section(header: Text("Redeem")) {
                            HStack {
                                Text("£")
                                    .font(AppFont.body(17, weight: .semibold))
                                TextField("Amount to redeem", text: $redeemAmount)
                                    .keyboardType(.decimalPad)
                            }

                            Button {
                                redeemFullBalance()
                            } label: {
                                Text("Redeem Full Balance (£\(String(format: "%.2f", balanceResult?.balance ?? 0)))")
                                    .font(AppFont.body(12, weight: .medium))
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)

                            Button {
                                redeem()
                            } label: {
                                HStack {
                                    if isRedeeming { ProgressView() }
                                    Text(isRedeeming ? "Redeeming..." : "Redeem")
                                        .fontWeight(.bold)
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(PPBrand.charcoal)
                            .disabled(isRedeeming || redeemAmount.isEmpty)
                        }
                    }
                }

                if let result = redeemResult {
                    Section(header: Text("Result")) {
                        if balanceResult?.isActivityVoucher == true {
                            Text("Activity voucher marked as used")
                                .font(AppFont.body(13, weight: .semibold))
                        } else {
                            LabeledContent("Discount Applied", value: "£\(String(format: "%.2f", result.discount))")
                                .fontWeight(.bold)
                            LabeledContent("Remaining Balance", value: "£\(String(format: "%.2f", result.balance))")
                        }
                        LabeledContent("Status", value: result.status.capitalized)
                    }
                }

                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(AppFont.body(12, weight: .medium))
                    }
                }
            }
            .navigationTitle("Redeem Gift Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                if redeemResult != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                            .fontWeight(.bold)
                    }
                }
            }
            .sheet(isPresented: $showingScanner) {
                GiftCardScannerView(scannedCode: $scannedCode)
                    .onDisappear {
                        if let scanned = scannedCode {
                            code = scanned
                            checkBalance()
                        }
                    }
            }
            .onChange(of: scannedCode) { newValue in
                if let scanned = newValue {
                    code = scanned
                    checkBalance()
                }
            }
        }
    }

    private func checkBalance() {
        guard let staff = authVM.staff else { return }
        isChecking = true
        error = nil
        balanceResult = nil
        redeemResult = nil
        Task {
            do {
                let result = try await APIClient.shared.checkGiftCardBalance(code: code, staff: staff)
                await MainActor.run {
                    balanceResult = result
                    isChecking = false
                    Haptics.light()
                }
            } catch let err as APIError {
                await MainActor.run {
                    self.error = err.errorDescription
                    isChecking = false
                    Haptics.error()
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    isChecking = false
                    Haptics.error()
                }
            }
        }
    }

    private func redeem() {
        guard let staff = authVM.staff,
              let amount = Double(redeemAmount) else { return }
        isRedeeming = true
        error = nil
        Task {
            do {
                let result = try await APIClient.shared.redeemGiftCard(code: code, amount: amount, staff: staff)
                await MainActor.run {
                    redeemResult = result
                    isRedeeming = false
                    if let idx = balanceResult {
                        balanceResult = GiftCardBalanceResult(
                            id: idx.id, code: idx.code, amount: idx.amount,
                            balance: result.balance, status: result.status, covers: idx.covers,
                            recipientName: idx.recipientName, recipientEmail: idx.recipientEmail,
                            expiryDate: idx.expiryDate
                        )
                    }
                    Haptics.success()
                }
            } catch let err as APIError {
                await MainActor.run {
                    self.error = err.errorDescription
                    isRedeeming = false
                    Haptics.error()
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    isRedeeming = false
                    Haptics.error()
                }
            }
        }
    }

    private func markUsed() {
        redeemAmount = "0"
        redeem()
    }

    private func redeemFullBalance() {
        if let balance = balanceResult?.balance {
            redeemAmount = String(format: "%.2f", balance)
        }
    }
}
