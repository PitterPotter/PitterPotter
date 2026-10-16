import SwiftUI

// MARK: - EPOS Product Management (managers / super admin)

struct EposManageView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) var dismiss

    @State private var categories: [EposCategory] = []
    @State private var products: [EposProduct] = []
    @State private var discounts: [EposDiscount] = []
    @State private var editing: EposProduct? = nil
    @State private var showNew = false
    @State private var errorMsg: String?
    @State private var filter = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(products.filter { filter.isEmpty || $0.name.lowercased().contains(filter.lowercased()) }) { p in
                        Button { editing = p } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.name).font(AppFont.body(14, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                                    Text("\(catName(p.category_id)) · VAT \(p.vat_treatment) · \(p.studios.joined(separator: " + "))")
                                        .font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                                }
                                Spacer()
                                Text(String(format: "£%.2f", p.price)).font(AppFont.body(14, weight: .bold))
                                if !p.active {
                                    Text("HIDDEN").font(AppFont.heading(8)).foregroundStyle(.secondary)
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Color.gray.opacity(0.15)).clipShape(Capsule())
                                }
                            }
                        }
                    }
                    .onDelete { idx in
                        let visible = products.filter { filter.isEmpty || $0.name.lowercased().contains(filter.lowercased()) }
                        for i in idx {
                            Task {
                                try? await APIClient.shared.eposDeleteProduct(productId: visible[i].id, staff: authVM.staff!)
                                await load()
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("Products")
                        Spacer()
                        TextField("Filter…", text: $filter).textFieldStyle(.roundedBorder).frame(width: 160)
                    }
                }

                Section("Categories") {
                    ForEach(categories) { c in
                        HStack {
                            Circle().fill(ppColor(c.color)).frame(width: 12, height: 12)
                            Text(c.name).font(AppFont.body(13, weight: .medium))
                            Spacer()
                            if !c.active { Text("hidden").font(AppFont.body(10)).foregroundStyle(.secondary) }
                        }
                    }
                }

                Section("Preset discounts") {
                    ForEach(discounts) { d in
                        HStack {
                            Text(d.name).font(AppFont.body(13, weight: .medium))
                            Spacer()
                            Text(d.kind == "percent" ? "\(d.value.clean)%" : String(format: "£%.2f", d.value))
                                .font(AppFont.body(12)).foregroundStyle(.secondary)
                            Button(d.active ? "Hide" : "Show") {
                                Task {
                                    _ = try? await APIClient.shared.eposSaveDiscount([
                                        "id": d.id, "name": d.name, "kind": d.kind, "value": d.value, "active": !d.active,
                                    ], staff: authVM.staff!)
                                    await load()
                                }
                            }.font(AppFont.body(11, weight: .bold))
                        }
                    }
                }
            }
            .navigationTitle("EPOS Products")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button("New Product") { showNew = true } }
            }
            .task { await load() }
            .sheet(item: $editing) { p in ProductEditor(product: p, categories: categories) { await load() }.environmentObject(authVM) }
            .sheet(isPresented: $showNew) { ProductEditor(product: nil, categories: categories) { await load() }.environmentObject(authVM) }
            .alert("Error", isPresented: .constant(errorMsg != nil)) { Button("OK") { errorMsg = nil } } message: { Text(errorMsg ?? "") }
        }
    }

    private func catName(_ id: String?) -> String {
        categories.first { $0.id == id }?.name ?? "—"
    }

    private func load() async {
        guard let staff = authVM.staff else { return }
        do {
            let (c, p, d) = try await APIClient.shared.eposListProductsAdmin(staff: staff)
            categories = c; products = p; discounts = d
        } catch { errorMsg = error.localizedDescription }
    }

    private func ppColor(_ hex: String) -> Color {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h.removeFirst() }
        guard let v = UInt32(h, radix: 16) else { return PPBrand.charcoal }
        return Color(hex: v)
    }
}

struct ProductEditor: View {
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) var dismiss
    let product: EposProduct?
    let categories: [EposCategory]
    var onSaved: () async -> Void

    @State private var name = ""
    @State private var sku = ""
    @State private var price = ""
    @State private var vat = "standard"
    @State private var categoryId = ""
    @State private var putney = true
    @State private var wimbledon = true
    @State private var active = true
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Product") {
                    TextField("Name", text: $name)
                    TextField("SKU (optional)", text: $sku)
                    TextField("Price £ (VAT-inclusive)", text: $price).keyboardType(.decimalPad)
                    Picker("Category", selection: $categoryId) {
                        Text("None").tag("")
                        ForEach(categories) { Text($0.name).tag($0.id) }
                    }
                    Picker("VAT treatment", selection: $vat) {
                        Text("Standard 20%").tag("standard")
                        Text("Reduced 5%").tag("reduced")
                        Text("Zero-rated 0%").tag("zero")
                        Text("Exempt").tag("exempt")
                    }
                }
                Section("Availability") {
                    Toggle("Putney", isOn: $putney)
                    Toggle("Wimbledon", isOn: $wimbledon)
                    Toggle("Available on till", isOn: $active)
                }
            }
            .navigationTitle(product == nil ? "New Product" : "Edit Product")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(saving || name.isEmpty || (Double(price) ?? -1) < 0 || (!putney && !wimbledon))
                }
            }
            .onAppear {
                if let p = product {
                    name = p.name; sku = p.sku ?? ""; price = String(p.price); vat = p.vat_treatment
                    categoryId = p.category_id ?? ""; active = p.active
                    putney = p.studios.contains("Putney"); wimbledon = p.studios.contains("Wimbledon")
                }
            }
        }
    }

    private func save() async {
        guard let staff = authVM.staff, let priceVal = Double(price), priceVal >= 0 else { return }
        saving = true
        var studios: [String] = []
        if putney { studios.append("Putney") }
        if wimbledon { studios.append("Wimbledon") }
        var body: [String: Any] = [
            "name": name, "price": priceVal, "vatTreatment": vat,
            "studios": studios, "active": active,
        ]
        if let id = product?.id { body["id"] = id }
        if !sku.isEmpty { body["sku"] = sku }
        if !categoryId.isEmpty { body["categoryId"] = categoryId }
        _ = try? await APIClient.shared.eposSaveProduct(body, staff: staff)
        await onSaved()
        saving = false
        dismiss()
    }
}

// MARK: - EPOS Sales report (managers / super admin)

struct EposSalesView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @Environment(\.dismiss) var dismiss

    @State private var studio = "all"
    @State private var range = 0 // 0 today, 1 week, 2 month
    @State private var report: EposSalesReport? = nil
    @State private var loading = false
    @State private var receipt: EposReceiptData? = nil

    private var studios: [String] {
        guard let s = authVM.staff else { return ["all"] }
        if s.isSuperAdmin { return ["all", "Putney", "Wimbledon"] }
        return s.visibleStudios.map { $0.rawValue }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    HStack(spacing: 8) {
                        if studios.count > 1 {
                            Picker("Studio", selection: $studio) {
                                ForEach(studios, id: \.self) { Text($0 == "all" ? "All" : $0).tag($0) }
                            }.pickerStyle(.segmented)
                        }
                        Picker("Range", selection: $range) {
                            Text("Today").tag(0); Text("7 Days").tag(1); Text("30 Days").tag(2)
                        }.pickerStyle(.segmented)
                    }

                    if let r = report {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            stat("Orders", "\(r.orders)")
                            stat("Gross", money2(r.gross))
                            stat("VAT", money2(r.vat))
                            stat("Discounts", money2(r.discounts))
                            stat("Refunds", money2(r.refunds))
                            stat("Outstanding", money2(r.outstanding))
                        }

                        GroupBox("By payment method") {
                            ForEach(r.byMethod.sorted(by: { $0.key < $1.key }), id: \.key) { k, v in
                                HStack { Text(k.capitalized).font(AppFont.body(12, weight: .bold)); Spacer(); Text(money2(v)).font(AppFont.body(12)) }
                            }
                        }
                        GroupBox("By category") {
                            ForEach(r.byCategory.sorted(by: { $0.value > $1.value }), id: \.key) { k, v in
                                HStack { Text(k).font(AppFont.body(12)); Spacer(); Text(money2(v)).font(AppFont.body(12, weight: .bold)) }
                            }
                        }
                        GroupBox("VAT breakdown") {
                            ForEach(r.byVatRate.sorted(by: { $0.key < $1.key }), id: \.key) { k, v in
                                HStack {
                                    Text(k).font(AppFont.body(12, weight: .bold)).frame(width: 44, alignment: .leading)
                                    Spacer()
                                    Text("net \(money2(v.net))").font(AppFont.body(11)).foregroundStyle(.secondary)
                                    Text("VAT \(money2(v.vat))").font(AppFont.body(11, weight: .bold))
                                }
                            }
                        }
                        GroupBox("Orders") {
                            ForEach(r.rawOrders) { o in
                                Button { Task { receipt = try? await APIClient.shared.eposGetReceipt(orderId: o.id, staff: authVM.staff!) } } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("\(o.order_number) · \(o.studio)").font(AppFont.body(11, weight: .bold))
                                            Text([o.table_id, o.customer_name ?? o.label].compactMap { $0 }.joined(separator: " · "))
                                                .font(AppFont.body(10)).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text(o.status.uppercased()).font(AppFont.heading(8)).foregroundStyle(o.status == "paid" ? .green : .orange)
                                        Text(money2(o.total)).font(AppFont.body(12, weight: .bold))
                                    }
                                }.buttonStyle(.plain)
                            }
                        }
                    } else if loading {
                        ProgressView().padding(.top, 60)
                    }
                }
                .padding()
            }
            .navigationTitle("EPOS Sales")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task(id: "\(studio)-\(range)") { await load() }
            .sheet(item: $receipt) { r in
                NavigationStack {
                    ReceiptWebView(html: r.html)
                        .navigationTitle(r.order.order_number)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { receipt = nil } } }
                }
            }
        }
    }

    private func stat(_ l: String, _ v: String) -> some View {
        VStack(spacing: 3) {
            Text(l).font(AppFont.heading(8)).foregroundStyle(PPBrand.charcoal.opacity(0.5)).textCase(.uppercase)
            Text(v).font(AppFont.heading(15))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(PPBrand.charcoal.opacity(0.1)))
    }

    private func load() async {
        guard let staff = authVM.staff else { return }
        loading = true
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let to = f.string(from: Date())
        let from = f.string(from: Date().addingTimeInterval(range == 0 ? 0 : range == 1 ? -6 * 86400 : -29 * 86400))
        report = try? await APIClient.shared.eposSalesReport(
            studio: studio == "all" ? nil : studio, from: from, to: to, staff: staff)
        loading = false
    }

    private func money2(_ n: Double) -> String { String(format: "£%.2f", n) }
}
