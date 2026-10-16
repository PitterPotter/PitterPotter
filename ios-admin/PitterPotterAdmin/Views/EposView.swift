import SwiftUI
import WebKit

// MARK: - EPOS Till

struct EposView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel

    @State private var categories: [EposCategory] = []
    @State private var products: [EposProduct] = []
    @State private var discounts: [EposDiscount] = []
    @State private var cardProvider = "mock"
    @State private var tables: [EposTable] = []
    @State private var openOrders: [EposOrder] = []
    @State private var order: EposOrder?
    @State private var items: [EposOrderItem] = []
    @State private var payments: [EposPayment] = []
    @State private var activeCategory: String? = nil   // nil = all
    @State private var search = ""
    @State private var showTables = false
    @State private var busy = false
    @State private var errorMsg: String?

    // Sheets
    @State private var payMethod: String? = nil       // cash/card/voucher/other
    @State private var payAmount = ""
    @State private var tendered = ""
    @State private var voucherCode = ""
    @State private var showNewOrder = false
    @State private var newOrderTable: String? = nil
    @State private var newLabel = ""
    @State private var newCustomer = ""
    @State private var newBookingId = ""
    @State private var showDiscount = false
    @State private var showCustom = false
    @State private var customName = ""
    @State private var customPrice = ""
    @State private var customVat = "standard"
    @State private var receipt: EposReceiptData? = nil
    @State private var receiptEmail = ""
    @State private var refundTarget: EposPayment? = nil
    @State private var pendingPaymentId: String? = nil
    @State private var pollTask: Task<Void, Never>? = nil
    @State private var showManage = false
    @State private var showSales = false

    private var tillStudio: String {
        bookingsVM.selectedStudio?.rawValue ?? authVM.staff?.visibleStudios.first?.rawValue ?? "Putney"
    }
    private var canDiscount: Bool { authVM.staff?.isSuperAdmin == true || authVM.staff?.canEposDiscounts == true }
    private var canRefund: Bool { authVM.staff?.isSuperAdmin == true || authVM.staff?.canEposRefunds == true }
    private var canManageProducts: Bool { authVM.staff?.isSuperAdmin == true || authVM.staff?.canEposManageProducts == true }
    private var canSeeReports: Bool { authVM.staff?.isSuperAdmin == true || canRefund || canDiscount }
    private var outstanding: Double { order?.outstanding ?? 0 }
    private var orderClosed: Bool { order?.status == "paid" || order?.status == "void" }

    private var todaysBookings: [Booking] {
        let today = Self.todayString()
        return bookingsVM.visibleBookings.filter {
            $0.date == today && ["confirmed", "seated", "completed"].contains($0.status)
        }
    }

    private func bookingsAt(_ tableId: String) -> [Booking] {
        todaysBookings.filter { b in
            (b.tableId ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.contains(tableId)
        }
    }

    private static func todayString() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date())
    }

    var body: some View {
        HStack(spacing: 12) {
            // LEFT: catalogue
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Button { showTables.toggle() } label: {
                        Label(showTables ? "Till" : "Tables", systemImage: showTables ? "creditcard" : "map")
                            .font(AppFont.body(12, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    TextField("Search products…", text: $search)
                        .textFieldStyle(.roundedBorder)
                        .font(AppFont.body(14, weight: .medium))
                    if canSeeReports {
                        Button { showSales = true } label: {
                            Image(systemName: "chart.bar").font(AppFont.body(13, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(PPBrand.sage).clipShape(RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                    if canManageProducts {
                        Button { showManage = true } label: {
                            Image(systemName: "shippingbox").font(AppFont.body(13, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(PPBrand.sage).clipShape(RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.bottom, 10)

                if showTables {
                    tableGrid
                } else {
                    categoryBar
                    productGrid
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // RIGHT: order panel
            orderPanel
                .frame(width: 380)
        }
        .padding(12)
        .background(PPBrand.mist.ignoresSafeArea())
        .task { await load() }
        .alert("Error", isPresented: .constant(errorMsg != nil)) {
            Button("OK") { errorMsg = nil }
        } message: { Text(errorMsg ?? "") }
        .sheet(item: payMethodIdent) { _ in paySheet }
        .sheet(isPresented: $showNewOrder) { newOrderSheet }
        .sheet(isPresented: $showDiscount) { discountSheet }
        .sheet(isPresented: $showCustom) { customSheet }
        .sheet(item: $receipt) { r in receiptSheet(r) }
        .sheet(item: $refundTarget) { p in refundSheet(p) }
        .sheet(isPresented: $showManage) { EposManageView().environmentObject(authVM) }
        .sheet(isPresented: $showSales) { EposSalesView().environmentObject(authVM).environmentObject(bookingsVM) }
    }

    // helper for `.sheet(item:)` on a String method
    private var payMethodIdent: Binding<IdentStr?> {
        Binding(get: { payMethod.map(IdentStr.init) }, set: { if $0 == nil { payMethod = nil } })
    }

    // MARK: - Catalogue

    private var categoryBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                catChip(nil, label: "All", color: PPBrand.charcoal)
                ForEach(categories) { c in
                    catChip(c.id, label: c.name, color: ppColor(c.color, fallback: PPBrand.charcoal))
                }
                Button { showCustom = true } label: {
                    Text("+ CUSTOM")
                        .font(AppFont.heading(11))
                        .foregroundStyle(Color(hex: 0x047857))
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: 0x047857).opacity(0.4), lineWidth: 1.5))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.bottom, 10)
    }

    private func catChip(_ id: String?, label: String, color: Color) -> some View {
        let selected = activeCategory == id
        return Button { activeCategory = id } label: {
            Text(label.uppercased())
                .font(AppFont.heading(11))
                .foregroundStyle(selected ? .white : PPBrand.charcoal)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(selected ? color : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: selected ? 0 : 1.5))
        }
        .buttonStyle(.plain)
    }

    private var productGrid: some View {
        let q = search.lowercased().trimmingCharacters(in: .whitespaces)
        let filtered = products.filter {
            (activeCategory == nil || $0.category_id == activeCategory) &&
            (q.isEmpty || $0.name.lowercased().contains(q) || ($0.sku ?? "").lowercased().contains(q))
        }
        return ScrollView {
            if filtered.isEmpty {
                Text(products.isEmpty ? "No products yet — add them under Admin → EPOS Products (web) or Manage below." : "No matching products")
                    .font(AppFont.body(13)).foregroundStyle(PPBrand.charcoal.opacity(0.5)).padding(.top, 60)
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(filtered) { p in
                    Button { Task { await addProduct(p) } } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(p.name).font(AppFont.body(13, weight: .bold)).foregroundStyle(PPBrand.charcoal).lineLimit(2)
                            Spacer(minLength: 0)
                            Text(money(p.price)).font(AppFont.heading(15)).foregroundStyle(PPBrand.charcoal)
                        }
                        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
                        .padding(10)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy || order == nil || orderClosed)
                }
            }
        }
    }

    private var tableGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(tables) { t in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(t.label).font(AppFont.heading(18))
                            Spacer()
                            Text(t.area.lowercased()).font(AppFont.body(9, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.5)).textCase(.uppercase)
                        }
                        ForEach(bookingsAt(t.table_id)) { b in
                            Text("\(b.name) · \(b.time) · \(b.paintersCount)p")
                                .font(AppFont.body(11, weight: .medium)).foregroundStyle(PPBrand.charcoal.opacity(0.8)).lineLimit(1)
                        }
                        ForEach(openOrders.filter { $0.table_id == t.table_id }) { o in
                            Button { Task { await selectOrder(o); showTables = false } } label: {
                                Text("\(o.order_number)\(o.label.map { " · \($0)" } ?? "") · \(money(o.total)) (\(o.status))")
                                    .font(AppFont.body(11, weight: .bold)).foregroundStyle(Color(hex: 0x92400E))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(6).background(Color(hex: 0xFEF3C7))
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }
                        Button { newOrderTable = t.table_id; showNewOrder = true } label: {
                            Text("+ NEW ORDER").font(AppFont.heading(9)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 7)
                                .background(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(10)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1.5))
                }
            }
        }
    }

    // MARK: - Order panel

    private var orderPanel: some View {
        VStack(spacing: 0) {
            // Order selector
            VStack(spacing: 6) {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(openOrders) { o in
                            Button("\(o.order_number)\(o.table_id.map { " · \($0)" } ?? "")\(o.label.map { " · \($0)" } ?? "") · \(money(o.total))") {
                                Task { await selectOrder(o) }
                            }
                        }
                    } label: {
                        Text(order.map { "\($0.order_number)\($0.table_id.map { " · \($0)" } ?? "")" } ?? "Select open order…")
                            .font(AppFont.body(13, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                            .frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
                            .padding(9).background(Color.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.2), lineWidth: 1))
                    }
                    Button { newOrderTable = nil; showNewOrder = true } label: {
                        Image(systemName: "plus").font(AppFont.body(14, weight: .bold)).foregroundStyle(.white)
                            .padding(9).background(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
                if let o = order {
                    HStack(spacing: 4) {
                        Text([o.order_number, o.table_id.map { "Table \($0)" }, o.customer_name, o.label].compactMap { $0 }.joined(separator: " · "))
                            .font(AppFont.body(10, weight: .medium)).foregroundStyle(PPBrand.charcoal.opacity(0.7)).lineLimit(1)
                        Text(o.status.uppercased())
                            .font(AppFont.heading(8))
                            .foregroundStyle(.white).padding(.horizontal, 7).padding(.vertical, 3)
                            .background(statusColor(o.status)).clipShape(Capsule())
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(10)
            .background(PPBrand.sage.opacity(0.4))

            // Items
            ScrollView {
                VStack(spacing: 6) {
                    if order == nil {
                        Text("Create an order or pick an open order / table")
                            .font(AppFont.body(12)).foregroundStyle(PPBrand.charcoal.opacity(0.4)).padding(.top, 40)
                    }
                    ForEach(items) { i in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(i.name).font(AppFont.body(12, weight: .bold)).lineLimit(1)
                                Text("\(money(i.unit_price)) each\(i.vat_treatment != "standard" ? " · \(i.vat_treatment)" : "")")
                                    .font(AppFont.body(9)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                            }
                            Spacer()
                            HStack(spacing: 4) {
                                Button { Task { await setQty(i, i.quantity - 1) } } label: {
                                    Text("−").font(AppFont.body(16, weight: .bold)).frame(width: 30, height: 30)
                                        .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 6))
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(PPBrand.charcoal.opacity(0.2)))
                                }.buttonStyle(.plain).disabled(orderClosed)
                                Text("\(i.quantity)").font(AppFont.body(13, weight: .bold)).frame(width: 24)
                                Button { Task { await setQty(i, i.quantity + 1) } } label: {
                                    Text("+").font(AppFont.body(16, weight: .bold)).frame(width: 30, height: 30)
                                        .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 6))
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(PPBrand.charcoal.opacity(0.2)))
                                }.buttonStyle(.plain).disabled(orderClosed)
                            }
                            Text(money(i.line_total)).font(AppFont.body(13, weight: .bold)).frame(width: 56, alignment: .trailing)
                            Button { Task { await removeItem(i) } } label: {
                                Image(systemName: "xmark").font(AppFont.body(11, weight: .bold)).foregroundStyle(.red.opacity(0.7))
                            }.buttonStyle(.plain).disabled(orderClosed)
                        }
                        .padding(8)
                        .background(PPBrand.sage.opacity(0.25))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(10)
            }

            // Totals + actions
            if let o = order {
                VStack(spacing: 6) {
                    row("Subtotal", money(o.subtotal), dim: true)
                    if o.discount_total > 0 {
                        HStack {
                            Text("Discount\(o.discount_label.map { " (\($0))" } ?? "")").font(AppFont.body(10, weight: .medium)).foregroundStyle(Color(hex: 0x047857))
                            Spacer()
                            Text("-\(money(o.discount_total))").font(AppFont.body(10, weight: .bold)).foregroundStyle(Color(hex: 0x047857))
                            if canDiscount && !orderClosed {
                                Button { Task { order = try? await APIClient.shared.eposRemoveDiscount(orderId: o.id, staff: authVM.staff!) } } label: {
                                    Text("✕").font(AppFont.body(9, weight: .bold)).foregroundStyle(.red)
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    row("of which VAT", money(o.vat_total), dim: true)
                    HStack {
                        Text("Total").font(AppFont.heading(18))
                        Spacer()
                        Text(money(o.total)).font(AppFont.heading(20))
                    }
                    if o.paid_total > 0 {
                        row("Paid", money(o.paid_total), color: Color(hex: 0x047857))
                        if o.outstanding > 0 { row("Outstanding", money(o.outstanding), color: Color(hex: 0xB45309), bold: true) }
                    }
                    if !payments.isEmpty {
                        ForEach(payments) { p in
                            HStack {
                                Text("\(p.method.uppercased())\(p.method == "voucher" && p.reference != nil ? " · \(p.reference!)" : "")\(p.status == "pending" ? " (on terminal…)" : "")")
                                    .font(AppFont.body(9, weight: .bold))
                                    .foregroundStyle(p.status == "refunded" ? .red : p.status == "pending" ? .orange : PPBrand.charcoal.opacity(0.7))
                                    .strikethrough(p.status == "refunded")
                                Spacer()
                                Text(money(p.amount)).font(AppFont.body(11, weight: .bold))
                                if canRefund && (p.status == "completed" || p.status == "partially_refunded") {
                                    Button("refund") { refundTarget = p }.font(AppFont.body(9, weight: .bold)).foregroundStyle(.red)
                                }
                            }
                        }
                    }

                    if !orderClosed {
                        if canDiscount {
                            Button { showDiscount = true } label: {
                                Text("DISCOUNT").font(AppFont.heading(11)).foregroundStyle(PPBrand.charcoal)
                                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                                    .background(PPBrand.sage).clipShape(RoundedRectangle(cornerRadius: 8))
                            }.buttonStyle(.plain)
                        }
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            payButton("CASH", "banknote", Color(hex: 0x059669), "cash")
                            payButton(cardProvider == "dojo" ? "CARD (DOJO)" : "CARD", "creditcard", PPBrand.charcoal, "card")
                            payButton("VOUCHER", "giftcard", Color(hex: 0xDB2777), "voucher")
                            payButton("OTHER", "ellipsis.circle", Color(hex: 0x64748B), "other")
                        }
                        .disabled(outstanding <= 0)
                        Button("Void order") {
                            Task {
                                do {
                                    try await APIClient.shared.eposVoidOrder(orderId: o.id, reason: "voided from till", staff: authVM.staff!)
                                    order = nil; items = []; payments = []; await load()
                                } catch { errorMsg = error.localizedDescription }
                            }
                        }
                        .font(AppFont.body(10, weight: .bold)).foregroundStyle(.red.opacity(0.8))
                    } else if o.status == "paid" {
                        Button { Task { receipt = try? await APIClient.shared.eposGetReceipt(orderId: o.id, staff: authVM.staff!) } } label: {
                            Text("RECEIPT / EMAIL").font(AppFont.heading(12)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                }
                .padding(10)
                .background(Color.white)
                .overlay(alignment: .top) { Rectangle().fill(PPBrand.charcoal.opacity(0.1)).frame(height: 1) }
            }
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1.5))
    }

    private func row(_ l: String, _ v: String, dim: Bool = false, color: Color? = nil, bold: Bool = false) -> some View {
        HStack {
            Text(l).font(AppFont.body(bold ? 12 : 10, weight: bold ? .bold : .medium))
                .foregroundStyle(color ?? PPBrand.charcoal.opacity(dim ? 0.5 : 0.75))
            Spacer()
            Text(v).font(AppFont.body(bold ? 12 : 10, weight: .bold))
                .foregroundStyle(color ?? PPBrand.charcoal.opacity(dim ? 0.5 : 1))
        }
    }

    private func payButton(_ label: String, _ icon: String, _ color: Color, _ method: String) -> some View {
        Button {
            payMethod = method
            payAmount = String(format: "%.2f", outstanding)
            tendered = ""; voucherCode = ""
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon).font(AppFont.body(12, weight: .bold))
                Text(label).font(AppFont.heading(11))
            }
            .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 13)
            .background(color).clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Sheets

    private var paySheet: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("Outstanding: \(money(outstanding)) on \(order?.order_number ?? "")")
                    .font(AppFont.body(12)).foregroundStyle(PPBrand.charcoal.opacity(0.6))
                VStack(alignment: .leading, spacing: 4) {
                    Text("AMOUNT (£)").font(AppFont.heading(9)).foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    TextField("0.00", text: $payAmount).keyboardType(.decimalPad)
                        .font(AppFont.heading(26)).textFieldStyle(.roundedBorder)
                }
                if payMethod == "cash" {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("CASH TENDERED (£)").font(AppFont.heading(9)).foregroundStyle(PPBrand.charcoal.opacity(0.6))
                        TextField("0.00", text: $tendered).keyboardType(.decimalPad)
                            .font(AppFont.body(18, weight: .bold)).textFieldStyle(.roundedBorder)
                    }
                    HStack(spacing: 6) {
                        ForEach([5, 10, 20, 50], id: \.self) { n in
                            Button("£\(n)") { tendered = "\(n)" }
                                .font(AppFont.body(12, weight: .bold)).padding(.horizontal, 12).padding(.vertical, 7)
                                .background(PPBrand.sage).clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        Button("Exact") { tendered = payAmount }
                            .font(AppFont.body(12, weight: .bold)).padding(.horizontal, 12).padding(.vertical, 7)
                            .background(PPBrand.sage).clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    if let t = Double(tendered), let a = Double(payAmount), t >= a {
                        Text("Change: \(money(t - a))")
                            .font(AppFont.heading(18)).foregroundStyle(Color(hex: 0x047857))
                            .frame(maxWidth: .infinity).padding(10)
                            .background(Color(hex: 0xECFDF5).opacity(0.1)).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                if payMethod == "voucher" {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("GIFT VOUCHER CODE").font(AppFont.heading(9)).foregroundStyle(PPBrand.charcoal.opacity(0.6))
                        TextField("PP-XXXX…", text: $voucherCode).autocapitalization(.allCharacters)
                            .font(AppFont.body(18, weight: .bold)).textFieldStyle(.roundedBorder)
                    }
                }
                if payMethod == "card" && cardProvider == "mock" {
                    Text("Mock card mode — no real charge. Dojo is not yet configured.")
                        .font(AppFont.body(11, weight: .medium)).foregroundStyle(Color(hex: 0x92400E))
                        .padding(10).background(Color(hex: 0xFEF3C7)).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                Spacer()
                Button {
                    Task { await submitPay() }
                } label: {
                    Text(busy ? "Processing…" : "TAKE \(money(Double(payAmount) ?? 0))")
                        .font(AppFont.heading(14)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain).disabled(busy)
            }
            .padding(20)
            .navigationTitle("\(payMethod?.capitalized ?? "") Payment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { payMethod = nil } } }
        }
    }

    private var newOrderSheet: some View {
        NavigationStack {
            Form {
                if let t = newOrderTable { LabeledContent("Table", value: t) }
                TextField("Order label (e.g. Seat 2)", text: $newLabel)
                TextField("Customer name", text: $newCustomer)
                Picker("Link to booking", selection: $newBookingId) {
                    Text("None (walk-in)").tag("")
                    ForEach(newOrderTable.map(bookingsAt) ?? todaysBookings) { b in
                        Text("\(b.name) · \(b.time) · \(b.paintersCount)p").tag(b.id)
                    }
                }
            }
            .navigationTitle("New Order")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showNewOrder = false } }
                ToolbarItem(placement: .confirmationAction) { Button("Create") { Task { await createOrder() } }.disabled(busy) }
            }
        }
    }

    private var discountSheet: some View {
        NavigationStack {
            List {
                if !discounts.isEmpty {
                    Section("Presets") {
                        ForEach(discounts) { d in
                            Button {
                                Task { order = try? await APIClient.shared.eposApplyDiscount(orderId: order!.id, discountId: d.id, staff: authVM.staff!); showDiscount = false }
                            } label: {
                                HStack { Text(d.name).font(AppFont.body(13, weight: .bold)); Spacer(); Text(d.kind == "percent" ? "\(d.value.clean)% off" : "\(money(d.value)) off").font(AppFont.body(12)).foregroundStyle(PPBrand.charcoal.opacity(0.6)) }
                            }
                        }
                    }
                }
                CustomDiscountRow { kind, value, label in
                    Task {
                        order = try? await APIClient.shared.eposApplyDiscount(orderId: order!.id, kind: kind, value: value, label: label, staff: authVM.staff!)
                        showDiscount = false
                    }
                }
            }
            .navigationTitle("Discount")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { showDiscount = false } } }
        }
    }

    private var customSheet: some View {
        NavigationStack {
            Form {
                TextField("Description", text: $customName)
                TextField("Price £", text: $customPrice).keyboardType(.decimalPad)
                Picker("VAT", selection: $customVat) {
                    Text("VAT 20%").tag("standard"); Text("VAT 5%").tag("reduced")
                    Text("VAT 0% (zero-rated)").tag("zero"); Text("VAT exempt").tag("exempt")
                }
            }
            .navigationTitle("Custom Item")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showCustom = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            guard let o = order else { errorMsg = "Select an order first"; return }
                            order = try? await APIClient.shared.eposAddItem(orderId: o.id, customName: customName, customPrice: Double(customPrice) ?? 0, customVatTreatment: customVat, staff: authVM.staff!)
                            await refreshItems()
                            showCustom = false; customName = ""; customPrice = ""
                        }
                    }
                }
            }
        }
    }

    private func receiptSheet(_ r: EposReceiptData) -> some View {
        NavigationStack {
            VStack {
                ReceiptWebView(html: r.html)
                HStack {
                    TextField("customer@email.com", text: $receiptEmail).textFieldStyle(.roundedBorder).keyboardType(.emailAddress).autocapitalization(.none)
                    Button("Email") {
                        Task {
                            try? await APIClient.shared.eposEmailReceipt(orderId: r.order.id, email: receiptEmail, staff: authVM.staff!)
                            receiptEmail = ""
                        }
                    }.font(AppFont.body(13, weight: .bold)).padding(.horizontal, 14).padding(.vertical, 9)
                        .background(PPBrand.charcoal).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .padding()
            }
            .navigationTitle("Receipt \(r.order.order_number)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { receipt = nil } } }
        }
    }

    private func refundSheet(_ p: EposPayment) -> some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("Paid \(money(p.amount)) · refundable \(money(p.amount - p.refunded_amount))")
                    .font(AppFont.body(13))
                if p.method == "voucher" { Text("Restores the voucher balance.").font(AppFont.body(11)).foregroundStyle(.secondary) }
                if p.method == "card" && p.provider == "mock" { Text("Mock payment — refund is a record only.").font(AppFont.body(11)).foregroundStyle(.secondary) }
                Button("Refund Full Amount", role: .destructive) {
                    Task {
                        do {
                            order = try await APIClient.shared.eposRefundPayment(paymentId: p.id, staff: authVM.staff!)
                            refundTarget = nil
                            if let o = order { await refreshOrder(o.id) }
                        } catch { errorMsg = error.localizedDescription }
                    }
                }
                .font(AppFont.heading(13)).foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(Color.red).clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .padding(20)
            .navigationTitle("Refund \(p.method) payment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { refundTarget = nil } } }
        }
    }

    // MARK: - Actions

    private func load() async {
        guard let staff = authVM.staff else { return }
        do {
            let b = try await APIClient.shared.eposBootstrap(studio: tillStudio, staff: staff)
            categories = b.categories; products = b.products; discounts = b.discounts; cardProvider = b.cardProvider
            async let t = APIClient.shared.eposListTables(studio: tillStudio, staff: staff)
            async let o = APIClient.shared.eposOpenOrders(studio: tillStudio, staff: staff)
            tables = try await t; openOrders = try await o
        } catch { errorMsg = error.localizedDescription }
    }

    private func refreshOrder(_ id: String) async {
        guard let staff = authVM.staff else { return }
        do {
            let f = try await APIClient.shared.eposGetOrder(orderId: id, staff: staff)
            order = f.order; items = f.items; payments = f.payments
            openOrders = try await APIClient.shared.eposOpenOrders(studio: tillStudio, staff: staff)
        } catch { errorMsg = error.localizedDescription }
    }

    private func refreshItems() async {
        guard let o = order else { return }
        await refreshOrder(o.id)
    }

    private func selectOrder(_ o: EposOrder) async { await refreshOrder(o.id) }

    private func createOrder() async {
        guard let staff = authVM.staff else { return }
        busy = true
        do {
            let o = try await APIClient.shared.eposCreateOrder(
                studio: tillStudio, tableId: newOrderTable,
                bookingId: newBookingId.isEmpty ? nil : newBookingId,
                customerName: newCustomer.isEmpty ? nil : newCustomer,
                label: newLabel.isEmpty ? nil : newLabel, staff: staff)
            showNewOrder = false; newLabel = ""; newCustomer = ""; newBookingId = ""; newOrderTable = nil
            await refreshOrder(o.id)
        } catch { errorMsg = error.localizedDescription }
        busy = false
    }

    private func addProduct(_ p: EposProduct) async {
        guard let staff = authVM.staff, let o = order else { errorMsg = "Select or create an order first"; return }
        busy = true
        do {
            order = try await APIClient.shared.eposAddItem(orderId: o.id, productId: p.id, staff: staff)
            await refreshItems()
        } catch { errorMsg = error.localizedDescription }
        busy = false
    }

    private func setQty(_ i: EposOrderItem, _ qty: Int) async {
        guard let staff = authVM.staff else { return }
        order = try? await APIClient.shared.eposUpdateItemQty(itemId: i.id, quantity: qty, staff: staff)
        await refreshItems()
    }

    private func removeItem(_ i: EposOrderItem) async {
        guard let staff = authVM.staff else { return }
        order = try? await APIClient.shared.eposRemoveItem(itemId: i.id, staff: staff)
        await refreshItems()
    }

    private func submitPay() async {
        guard let staff = authVM.staff, let o = order, let method = payMethod else { return }
        guard let amt = Double(payAmount), amt > 0 else { errorMsg = "Enter an amount"; return }
        if method == "voucher" && voucherCode.trimmingCharacters(in: .whitespaces).isEmpty { errorMsg = "Enter the voucher code"; return }
        busy = true
        do {
            let (payment, updated) = try await APIClient.shared.eposPay(
                orderId: o.id, method: method, amount: amt,
                tendered: method == "cash" ? Double(tendered) : nil,
                voucherCode: method == "voucher" ? voucherCode : nil,
                idempotencyKey: UUID().uuidString, staff: staff)
            order = updated
            payMethod = nil
            await refreshItems()
            if payment.status == "pending" { pollPayment(payment.id) }
        } catch { errorMsg = error.localizedDescription }
        busy = false
    }

    private func pollPayment(_ paymentId: String) {
        pendingPaymentId = paymentId
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let staff = authVM.staff, !Task.isCancelled else { return }
                if let p = try? await APIClient.shared.eposCheckPayment(paymentId: paymentId, staff: staff) {
                    if p.status == "completed" || p.status == "failed" {
                        if let o = order { await refreshOrder(o.id) }
                        return
                    }
                }
            }
        }
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "paid": return Color(hex: 0x059669)
        case "partial": return Color(hex: 0xD97706)
        case "void": return .red
        default: return .gray
        }
    }
}

// MARK: - helpers

struct IdentStr: Identifiable { let id: String; init(_ s: String) { id = s } }

private func ppColor(_ hex: String, fallback: Color) -> Color {
    var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if h.hasPrefix("#") { h.removeFirst() }
    guard let v = UInt32(h, radix: 16) else { return fallback }
    return Color(hex: v)
}

private func money(_ n: Double) -> String { String(format: "£%.2f", n) }

extension Double { var clean: String { truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", self) : String(self) } }

struct CustomDiscountRow: View {
    var onApply: (String, Double, String) -> Void
    @State private var kind = "percent"
    @State private var value = ""
    @State private var label = ""
    var body: some View {
        Section("Custom discount") {
            Picker("Type", selection: $kind) { Text("% off").tag("percent"); Text("£ off").tag("fixed") }
                .pickerStyle(.segmented)
            TextField("Amount", text: $value).keyboardType(.decimalPad)
            TextField("Reason (optional)", text: $label)
            Button("Apply") {
                if let v = Double(value), v > 0 { onApply(kind, v, label.isEmpty ? (kind == "percent" ? "\(v.clean)% off" : "Discount") : label) }
            }.disabled((Double(value) ?? 0) <= 0)
        }
    }
}

struct ReceiptWebView: UIViewRepresentable {
    let html: String
    func makeUIView(context: Context) -> WKWebView { WKWebView() }
    func updateUIView(_ v: WKWebView, context: Context) { v.loadHTMLString(html, baseURL: nil) }
}
