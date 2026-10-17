import SwiftUI

// MARK: - Stock & Inventory

struct EposStockView: View {
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var toastManager: ToastManager

    enum StockSub: String, CaseIterable { case overview = "Overview", receive = "Receive", reorder = "Reorder", movements = "Movements", stocktake = "Stocktake", reports = "Reports" }

    @State private var sub: StockSub = .overview
    @State private var rows: [StockRow] = []
    @State private var stockStudios: [String] = []
    @State private var search = ""
    @State private var loading = false

    // Movements
    @State private var movements: [StockMovement] = []
    @State private var mvType: String = ""
    // Reorder
    @State private var reorder: [ReorderRow] = []
    // Stocktakes
    @State private var stocktakes: [Stocktake] = []
    // Report
    @State private var report: APIClient.StockReportResponse? = nil
    @State private var reportFrom = Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
    @State private var reportTo = Date()
    @State private var reportStudioAll = true
    @State private var reportSortBest = true

    // Sheets
    @State private var adjustTarget: StockRow? = nil
    @State private var adjustQty = ""
    @State private var adjustReason = StockViewData.adjustReasons[0]
    @State private var adjustStudio = "Putney"
    @State private var transferTarget: StockRow? = nil
    @State private var transferQty = ""
    @State private var transferFromPutney = true
    @State private var transferNote = ""
    @State private var levelsTarget: StockRow? = nil
    @State private var levelsMin = "0"
    @State private var levelsReorder = "0"
    @State private var levelsStudio = "Putney"
    @State private var levelsTrack = true

    // Receive
    @State private var receiveStudio = "Putney"
    @State private var receiveLines: [ReceiveLine] = [ReceiveLine()]
    @State private var receiveNote = ""

    // Stocktake
    @State private var takeStudio = "Putney"
    @State private var takeCounts: [String: Int] = [:]
    @State private var takeNote = ""

    struct ReceiveLine: Identifiable {
        let id = UUID()
        var productId: String = ""
        var qty: Int = 0
    }

    private var staff: Staff? { authVM.staff }
    private var isSuperAdmin: Bool { staff?.role == "super_admin" }
    private var canStock: Bool { isSuperAdmin || (staff?.canEposStock ?? false) }
    private var studios: [String] { (staff?.visibleStudios ?? Studio.allCases).map(\.rawValue) }
    private var studioScope: String? { isSuperAdmin ? bookingsVM.selectedStudio?.rawValue : studios.first }

    private var filtered: [StockRow] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.name.lowercased().contains(q) || ($0.sku ?? "").lowercased().contains(q) || $0.category.lowercased().contains(q) }
    }

    private var lowCount: Int { rows.reduce(0) { $0 + $1.studios.values.filter { $0.low }.count } }
    private var trackedRows: [StockRow] { rows.filter { $0.track_stock } }

    private var visibleSubs: [StockSub] {
        StockSub.allCases.filter { s in
            switch s {
            case .receive, .stocktake: return canStock
            case .reports: return isSuperAdmin
            default: return true
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            subTabBar
            Divider().opacity(0.3)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    switch sub {
                    case .overview: overviewSection
                    case .receive: receiveSection
                    case .reorder: reorderSection
                    case .movements: movementsSection
                    case .stocktake: stocktakeSection
                    case .reports: reportsSection
                    }
                }
                .padding(16)
            }
            .background(PPBrand.mist)
        }
        .task(id: studioScope) { await loadOverview() }
        .task(id: sub) {
            switch sub {
            case .movements: await loadMovements()
            case .reorder: await loadReorder()
            case .stocktake: await loadStocktakes()
            default: break
            }
        }
        .sheet(item: $adjustTarget) { adjustSheet(for: $0) }
        .sheet(item: $transferTarget) { transferSheet(for: $0) }
        .sheet(item: $levelsTarget) { levelsSheet(for: $0) }
    }

    // MARK: Sub-tab bar

    private var subTabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(visibleSubs, id: \.self) { s in
                    Button {
                        sub = s
                    } label: {
                        Text(s == .reorder && lowCount > 0 ? "\(s.rawValue) (\(lowCount))" : s.rawValue)
                            .font(AppFont.body(12, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(sub == s ? PPBrand.charcoal : Color.white)
                            .foregroundStyle(sub == s ? .white : PPBrand.charcoal.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15)))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Color.white)
    }

    // MARK: Overview

    private var overviewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(PPBrand.charcoal.opacity(0.4))
                    TextField("Search products…", text: $search)
                }
                .padding(10)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(PPBrand.charcoal.opacity(0.12)))
                if loading { ProgressView() }
            }
            if lowCount > 0 {
                Button { sub = .reorder } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text("\(lowCount) product\(lowCount == 1 ? "" : "s") at or below minimum stock — view reorder list")
                            .font(AppFont.body(12, weight: .bold))
                        Spacer()
                    }
                    .padding(10)
                    .foregroundStyle(Color(hex: 0x92400E))
                    .background(Color(hex: 0xFEF3C7))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: 0xF59E0B).opacity(0.4)))
                }
            }
            let bothStudios = isSuperAdmin && studioScope == nil
            LazyVStack(spacing: 6) {
                ForEach(filtered) { r in
                    let anyLow = r.studios.values.contains { $0.low }
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.name).font(AppFont.body(14, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                            Text("\(r.category) · £\(r.price, specifier: "%.2f")\(r.track_stock ? "" : " · not tracked")")
                                .font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        }
                        Spacer()
                        if bothStudios {
                            ForEach(studios, id: \.self) { s in
                                VStack(spacing: 1) {
                                    Text(String(s.prefix(1))).font(AppFont.body(8, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.4))
                                    qtyBadge(qty: r.studios[s]?.quantity ?? 0, min: r.studios[s]?.min_stock ?? 0, track: r.track_stock)
                                }
                            }
                        } else {
                            let s = studioScope ?? studios.first ?? "Putney"
                            qtyBadge(qty: r.studios[s]?.quantity ?? 0, min: r.studios[s]?.min_stock ?? 0, track: r.track_stock)
                        }
                        Text("sold \(r.studios.values.reduce(0) { $0 + $1.qty_sold })")
                            .font(AppFont.body(11, weight: .semibold)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                            .frame(width: 52, alignment: .trailing)
                        if canStock {
                            HStack(spacing: 4) {
                                Button("Levels") { openLevels(r) }.font(AppFont.body(10, weight: .bold))
                                    .padding(.horizontal, 8).padding(.vertical, 5)
                                    .background(Color(hex: 0xF5F2E8)).foregroundStyle(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 6))
                                if r.track_stock {
                                    Button("Adjust") { adjustTarget = r; adjustStudio = studioScope ?? studios.first ?? "Putney" }.font(AppFont.body(10, weight: .bold))
                                        .padding(.horizontal, 8).padding(.vertical, 5)
                                        .background(PPBrand.clay100).foregroundStyle(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 6))
                                    if isSuperAdmin {
                                        Button { transferTarget = r } label: { Image(systemName: "arrow.left.arrow.right").font(.system(size: 10, weight: .bold)) }
                                            .padding(.horizontal, 8).padding(.vertical, 5)
                                            .background(PPBrand.charcoal).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 6))
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(anyLow ? Color(hex: 0xFEF3C7).opacity(0.4) : Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.08)))
                }
                if filtered.isEmpty && !loading {
                    Text("No products match").font(AppFont.body(13)).foregroundStyle(PPBrand.charcoal.opacity(0.4)).frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
        }
    }

    private func qtyBadge(qty: Int, min: Int, track: Bool) -> some View {
        Group {
            if !track {
                Text("—").font(AppFont.body(10, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.3))
            } else {
                Text("\(qty)").font(AppFont.body(12, weight: .black))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .foregroundStyle(qty <= 0 ? Color(hex: 0xB91C1C) : (min > 0 && qty <= min) ? Color(hex: 0x92400E) : Color(hex: 0x047857))
                    .background(qty <= 0 ? Color(hex: 0xFEE2E2) : (min > 0 && qty <= min) ? Color(hex: 0xFEF3C7) : Color(hex: 0xECFDF5))
                    .clipShape(Capsule())
            }
        }
    }

    // MARK: Receive

    private var receiveSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Receive delivery", icon: "shippingbox")
            Picker("Studio", selection: $receiveStudio) {
                ForEach(studios, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            TextField("Delivery note (optional)", text: $receiveNote).textFieldStyle(PPFieldStyle())
            ForEach($receiveLines) { $line in
                HStack(spacing: 8) {
                    Menu {
                        ForEach(trackedRows) { r in
                            Button("\(r.name) (\(r.category))") { line.productId = r.id }
                        }
                    } label: {
                        HStack {
                            Text(line.productId.isEmpty ? "Select product…" : (rows.first { $0.id == line.productId }?.name ?? "Select product…"))
                                .font(AppFont.body(13, weight: .semibold))
                                .foregroundStyle(line.productId.isEmpty ? PPBrand.charcoal.opacity(0.4) : PPBrand.charcoal)
                                .lineLimit(1)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 10)).foregroundStyle(PPBrand.charcoal.opacity(0.4))
                        }
                        .padding(10)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(PPBrand.charcoal.opacity(0.12)))
                    }
                    Stepper(value: $line.qty, in: 0...999) {
                        Text("\(line.qty)").font(AppFont.body(16, weight: .black)).frame(minWidth: 34)
                    }
                    .frame(width: 150)
                    Button { receiveLines.removeAll { $0.id == line.id } } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.red.opacity(0.6))
                    }
                }
            }
            HStack {
                Button { receiveLines.append(ReceiveLine()) } label: {
                    Label("Line", systemImage: "plus").font(AppFont.body(12, weight: .bold))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color(hex: 0xF5F2E8)).foregroundStyle(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                Spacer()
                Button { submitReceive() } label: {
                    Text("CONFIRM RECEIPT").font(AppFont.body(12, weight: .black)).tracking(0.5)
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .background(PPBrand.charcoal).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .disabled(loading)
            }
        }
        .stockCard()
    }

    // MARK: Reorder

    private var reorderSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(reorder) { r in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.epos_products?.name ?? "—").font(AppFont.body(14, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                        Text(r.studio).font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                    Spacer()
                    Text("in stock \(r.quantity)").font(AppFont.body(12, weight: .black))
                        .foregroundStyle(r.quantity <= 0 ? Color(hex: 0xB91C1C) : Color(hex: 0x92400E))
                    Text("min \(r.min_stock)").font(AppFont.body(11)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    if r.reorder_qty > 0 {
                        Text("order \(r.reorder_qty)").font(AppFont.body(11, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.08)))
            }
            if reorder.isEmpty {
                Text("Nothing needs reordering — all stock levels are healthy").font(AppFont.body(13)).foregroundStyle(PPBrand.charcoal.opacity(0.4)).frame(maxWidth: .infinity).padding(.top, 40)
            }
        }
    }

    // MARK: Movements

    private var movementsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Menu {
                Button("All types") { mvType = ""; Task { await loadMovements() } }
                ForEach(StockViewData.movementTypes, id: \.self) { t in
                    Button(t.replacingOccurrences(of: "_", with: " ")) { mvType = t; Task { await loadMovements() } }
                }
            } label: {
                HStack {
                    Text(mvType.isEmpty ? "All types" : mvType.replacingOccurrences(of: "_", with: " "))
                        .font(AppFont.body(12, weight: .bold))
                    Image(systemName: "chevron.down").font(.system(size: 10))
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.white).foregroundStyle(PPBrand.charcoal)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.12)))
            }
            ForEach(movements) { m in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.epos_products?.name ?? "—").font(AppFont.body(13, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                        Text("\(fmtDate(m.created_at)) · \(m.studio) · \(m.staff_name ?? "—")\(m.reason.map { " · \($0)" } ?? "")")
                            .font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                    Spacer()
                    Text(m.type.replacingOccurrences(of: "_", with: " ")).font(AppFont.body(9, weight: .black)).textCase(.uppercase)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .foregroundStyle(m.type == "sale" ? PPBrand.charcoal.opacity(0.6) : m.change_qty > 0 ? Color(hex: 0x047857) : Color(hex: 0xB91C1C))
                        .background(m.type == "sale" ? PPBrand.charcoal.opacity(0.08) : m.change_qty > 0 ? Color(hex: 0xECFDF5) : Color(hex: 0xFEE2E2))
                        .clipShape(Capsule())
                    Text("\(m.change_qty > 0 ? "+" : "")\(m.change_qty)").font(AppFont.body(14, weight: .black))
                        .foregroundStyle(m.change_qty > 0 ? Color(hex: 0x047857) : Color(hex: 0xB91C1C))
                        .frame(width: 46, alignment: .trailing)
                    Text("→ \(m.quantity_after)").font(AppFont.body(11, weight: .semibold)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .frame(width: 44, alignment: .trailing)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.08)))
            }
            if movements.isEmpty {
                Text("No movements yet").font(AppFont.body(13)).foregroundStyle(PPBrand.charcoal.opacity(0.4)).frame(maxWidth: .infinity).padding(.top, 40)
            }
        }
    }

    // MARK: Stocktake

    private var stocktakeSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 12) {
                sectionTitle("New stocktake", icon: "checklist")
                Text("Enter the physical count for each product. Differences apply immediately and are recorded as stocktake adjustments.")
                    .font(AppFont.body(11)).foregroundStyle(PPBrand.charcoal.opacity(0.55))
                Picker("Studio", selection: $takeStudio) {
                    ForEach(studios, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
                Divider().opacity(0.3)
                ForEach(trackedRows) { r in
                    let exp = r.studios[takeStudio]?.quantity ?? 0
                    let counted = takeCounts[r.id]
                    let diff = counted.map { $0 - exp }
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.name).font(AppFont.body(13, weight: .bold)).foregroundStyle(PPBrand.charcoal).lineLimit(1)
                            Text("expected \(exp)").font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        }
                        Spacer()
                        if let d = diff {
                            Text("\(d > 0 ? "+" : "")\(d)").font(AppFont.body(12, weight: .black))
                                .foregroundStyle(d > 0 ? Color(hex: 0x047857) : d < 0 ? Color(hex: 0xB91C1C) : PPBrand.charcoal.opacity(0.4))
                                .frame(width: 34, alignment: .trailing)
                        }
                        Stepper(value: Binding(get: { takeCounts[r.id] ?? exp }, set: { takeCounts[r.id] = $0 }), in: 0...9999) {
                            Text("\(takeCounts[r.id] ?? exp)").font(AppFont.body(15, weight: .black)).frame(minWidth: 30)
                        }
                        .frame(width: 150)
                    }
                }
                TextField("Note (optional)", text: $takeNote).textFieldStyle(PPFieldStyle())
                Button { submitStocktake() } label: {
                    Text("SUBMIT STOCKTAKE").font(AppFont.body(12, weight: .black)).tracking(0.5)
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .background(PPBrand.charcoal).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .disabled(loading)
            }
            .stockCard()

            if !stocktakes.isEmpty {
                sectionTitle("Past stocktakes", icon: "clock.arrow.circlepath")
                ForEach(stocktakes) { s in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(fmtDate(s.created_at)) · \(s.studio)").font(AppFont.body(13, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                            Text("by \(s.staff_name ?? "—")\(s.note.map { " · \($0)" } ?? "")").font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        }
                        Spacer()
                        let items = s.epos_stocktake_items ?? []
                        Text("\(items.count) lines · \(items.filter { $0.difference != 0 }.count) adj").font(AppFont.body(11)).foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.08)))
                }
            }
        }
    }

    // MARK: Reports

    private var reportsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                sectionTitle("Sales & stock report", icon: "chart.bar")
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("FROM").font(AppFont.body(9, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        DatePicker("", selection: $reportFrom, displayedComponents: .date).labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("TO").font(AppFont.body(9, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        DatePicker("", selection: $reportTo, displayedComponents: .date).labelsHidden()
                    }
                    Toggle("All studios", isOn: $reportStudioAll).font(AppFont.body(11))
                }
                HStack(spacing: 10) {
                    Button { loadReport() } label: {
                        Text("RUN REPORT").font(AppFont.body(12, weight: .black)).tracking(0.5)
                            .padding(.horizontal, 18).padding(.vertical, 11)
                            .background(PPBrand.charcoal).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .disabled(loading)
                    if report != nil {
                        Button { reportSortBest.toggle() } label: {
                            Text(reportSortBest ? "Best sellers ↓" : "Slow movers ↑").font(AppFont.body(11, weight: .bold))
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .background(Color(hex: 0xF5F2E8)).foregroundStyle(PPBrand.charcoal).clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        Button { exportReportCsv() } label: {
                            Label("CSV", systemImage: "square.and.arrow.up").font(AppFont.body(11, weight: .bold))
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .background(Color(hex: 0xECFDF5)).foregroundStyle(Color(hex: 0x047857)).clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }
            }
            .stockCard()

            if let report {
                HStack(spacing: 10) {
                    ForEach(report.byStudio.keys.sorted(), id: \.self) { s in
                        if let v = report.byStudio[s] {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.uppercased()).font(AppFont.body(9, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                                Text("\(v.qty) sold · £\(v.revenue, specifier: "%.2f")").font(AppFont.body(16, weight: .black)).foregroundStyle(PPBrand.charcoal)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .stockCard()
                        }
                    }
                }
                ForEach(report.products.sorted { reportSortBest ? $0.qty_sold > $1.qty_sold : $0.qty_sold < $1.qty_sold }) { p in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(p.name).font(AppFont.body(13, weight: .bold)).foregroundStyle(PPBrand.charcoal)
                            Spacer()
                            Text("\(p.qty_sold) sold · £\(p.revenue, specifier: "%.2f")").font(AppFont.body(12, weight: .black)).foregroundStyle(PPBrand.charcoal)
                        }
                        HStack(spacing: 12) {
                            Text(p.category).font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                            ForEach(p.by_studio.keys.sorted(), id: \.self) { s in
                                if let v = p.by_studio[s] {
                                    Text("\(s): \(v.qty)").font(AppFont.body(10, weight: .semibold)).foregroundStyle(PPBrand.charcoal.opacity(0.7))
                                }
                            }
                            Spacer()
                            if p.received > 0 { Text("recv \(p.received)").font(AppFont.body(10)).foregroundStyle(Color(hex: 0x047857)) }
                            if p.breakages > 0 { Text("broken \(p.breakages)").font(AppFont.body(10, weight: .bold)).foregroundStyle(Color(hex: 0xB91C1C)) }
                            if p.transfers_in > 0 || p.transfers_out > 0 { Text("tr \(p.transfers_in)/\(p.transfers_out)").font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.6)) }
                            if p.adjustments > 0 { Text("adj \(p.adjustments)").font(AppFont.body(10)).foregroundStyle(PPBrand.charcoal.opacity(0.6)) }
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Color.white).clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.08)))
                }
                if report.products.isEmpty {
                    Text("No data in this range").font(AppFont.body(13)).foregroundStyle(PPBrand.charcoal.opacity(0.4)).frame(maxWidth: .infinity).padding(.top, 30)
                }
            }
        }
    }

    // MARK: Sheets

    private func adjustSheet(for r: StockRow) -> some View {
        sheetShell("Adjust — \(r.name)") {
            Picker("Studio", selection: $adjustStudio) {
                ForEach(stockStudios.isEmpty ? studios : stockStudios, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            HStack {
                Button { adjustQty = String((Int(adjustQty) ?? 0) - 1) } label: { Image(systemName: "minus") }
                    .frame(width: 44, height: 40).background(Color(hex: 0xF5F2E8)).clipShape(RoundedRectangle(cornerRadius: 8))
                TextField("e.g. -2 or +10", text: $adjustQty).keyboardType(.numbersAndPunctuation)
                    .multilineTextAlignment(.center).textFieldStyle(PPFieldStyle())
                Button { adjustQty = String((Int(adjustQty) ?? 0) + 1) } label: { Image(systemName: "plus") }
                    .frame(width: 44, height: 40).background(Color(hex: 0xF5F2E8)).clipShape(RoundedRectangle(cornerRadius: 8))
            }
            Picker("Reason", selection: $adjustReason) {
                ForEach(StockViewData.adjustReasons, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.menu)
            sheetButtons(cancel: { adjustTarget = nil }, confirmTitle: "APPLY", confirm: submitAdjust)
        }
    }

    private func transferSheet(for r: StockRow) -> some View {
        sheetShell("Transfer — \(r.name)") {
            Picker("Direction", selection: $transferFromPutney) {
                Text("Putney → Wimbledon").tag(true)
                Text("Wimbledon → Putney").tag(false)
            }
            .pickerStyle(.segmented)
            Stepper(value: Binding(get: { Int(transferQty) ?? 0 }, set: { transferQty = String($0) }), in: 0...999) {
                Text("\(Int(transferQty) ?? 0)").font(AppFont.body(16, weight: .black))
            }
            TextField("Note (optional)", text: $transferNote).textFieldStyle(PPFieldStyle())
            sheetButtons(cancel: { transferTarget = nil }, confirmTitle: "TRANSFER", confirm: submitTransfer)
        }
    }

    private func levelsSheet(for r: StockRow) -> some View {
        sheetShell("Stock levels — \(r.name)") {
            Toggle("Track stock for this product", isOn: $levelsTrack).font(AppFont.body(13, weight: .semibold))
            Picker("Studio", selection: $levelsStudio) {
                ForEach(stockStudios.isEmpty ? studios : stockStudios, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("MIN LEVEL").font(AppFont.body(9, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    TextField("0", text: $levelsMin).keyboardType(.numberPad).textFieldStyle(PPFieldStyle())
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("REORDER QTY").font(AppFont.body(9, weight: .bold)).foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    TextField("0", text: $levelsReorder).keyboardType(.numberPad).textFieldStyle(PPFieldStyle())
                }
            }
            sheetButtons(cancel: { levelsTarget = nil }, confirmTitle: "SAVE", confirm: submitLevels)
        }
    }

    private func sheetShell<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(PPBrand.headingFont).foregroundStyle(PPBrand.charcoal)
            content()
        }
        .padding(24)
        .presentationDetents([.height(360)])
    }

    private func sheetButtons(cancel: @escaping () -> Void, confirmTitle: String, confirm: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Button("Cancel", action: cancel).font(AppFont.body(12, weight: .bold))
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.2)))
            Button(confirmTitle, action: confirm).font(AppFont.body(12, weight: .black))
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .background(PPBrand.charcoal).foregroundStyle(.white).clipShape(RoundedRectangle(cornerRadius: 8))
                .disabled(loading)
        }
    }

    // MARK: Helpers

    private func sectionTitle(_ t: String, icon: String) -> some View {
        Label(t, systemImage: icon).font(AppFont.body(13, weight: .black)).textCase(.uppercase).tracking(0.5).foregroundStyle(PPBrand.charcoal)
    }

    private func fmtDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) ?? Date()
        let out = DateFormatter()
        out.dateFormat = "dd MMM HH:mm"
        return out.string(from: d)
    }

    private func openLevels(_ r: StockRow) {
        levelsTarget = r
        levelsStudio = studioScope ?? studios.first ?? "Putney"
        let s = r.studios[levelsStudio]
        levelsMin = String(s?.min_stock ?? 0)
        levelsReorder = String(s?.reorder_qty ?? 0)
        levelsTrack = r.track_stock
    }

    private func show(_ msg: String, isError: Bool = false) {
        isError ? toastManager.error(msg) : toastManager.success(msg)
    }

    // MARK: Data

    private func loadOverview() async {
        guard let staff else { return }
        loading = true
        defer { loading = false }
        do {
            let r = try await APIClient.shared.eposStockOverview(studio: studioScope ?? "all", staff: staff)
            rows = r.rows
            stockStudios = r.studios
        } catch { show(error.localizedDescription, isError: true) }
    }

    private func loadMovements() async {
        guard let staff else { return }
        do { movements = try await APIClient.shared.eposStockMovements(studio: studioScope, type: mvType.isEmpty ? nil : mvType, staff: staff) }
        catch { show(error.localizedDescription, isError: true) }
    }

    private func loadReorder() async {
        guard let staff else { return }
        do {
            var all: [ReorderRow] = []
            for s in studios where studioScope == nil || s == studioScope {
                all.append(contentsOf: try await APIClient.shared.eposStockReorderList(studio: s, staff: staff))
            }
            reorder = all
        } catch { show(error.localizedDescription, isError: true) }
    }

    private func loadStocktakes() async {
        guard let staff else { return }
        do { stocktakes = try await APIClient.shared.eposStocktakeList(studio: studioScope, staff: staff) }
        catch { show(error.localizedDescription, isError: true) }
    }

    private func loadReport() {
        guard let staff else { return }
        loading = true
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        Task {
            do {
                report = try await APIClient.shared.eposStockReport(
                    studio: reportStudioAll ? nil : (studioScope ?? studios.first),
                    from: df.string(from: reportFrom), to: df.string(from: reportTo), staff: staff)
            } catch { show(error.localizedDescription, isError: true) }
            loading = false
        }
    }

    private func submitAdjust() {
        guard let staff, let r = adjustTarget, let q = Int(adjustQty), q != 0 else {
            show("Enter a non-zero quantity (negative to remove)", isError: true); return
        }
        loading = true
        Task {
            do {
                _ = try await APIClient.shared.eposStockAdjust(studio: adjustStudio, productId: r.id, changeQty: q, reason: adjustReason, staff: staff)
                show("Adjusted \(r.name) by \(q) at \(adjustStudio)")
                adjustTarget = nil; adjustQty = ""
                await loadOverview()
            } catch { show(error.localizedDescription, isError: true) }
            loading = false
        }
    }

    private func submitTransfer() {
        guard let staff, let r = transferTarget, let q = Int(transferQty), q > 0 else {
            show("Enter a positive quantity", isError: true); return
        }
        let from = transferFromPutney ? "Putney" : "Wimbledon"
        let to = transferFromPutney ? "Wimbledon" : "Putney"
        loading = true
        Task {
            do {
                try await APIClient.shared.eposStockTransfer(productId: r.id, fromStudio: from, toStudio: to, qty: q, note: transferNote.isEmpty ? nil : transferNote, staff: staff)
                show("Transferred \(q) × \(r.name) \(from) → \(to)")
                transferTarget = nil; transferQty = ""; transferNote = ""
                await loadOverview()
            } catch { show(error.localizedDescription, isError: true) }
            loading = false
        }
    }

    private func submitLevels() {
        guard let staff, let r = levelsTarget else { return }
        loading = true
        Task {
            do {
                try await APIClient.shared.eposStockSetLevels(productId: r.id, studio: levelsStudio,
                    minStock: Int(levelsMin) ?? 0, reorderQty: Int(levelsReorder) ?? 0, trackStock: levelsTrack, staff: staff)
                show("Levels saved for \(r.name)")
                levelsTarget = nil
                await loadOverview()
            } catch { show(error.localizedDescription, isError: true) }
            loading = false
        }
    }

    private func submitReceive() {
        guard let staff else { return }
        let items: [[String: Any]] = receiveLines.compactMap { l in
            guard !l.productId.isEmpty, l.qty > 0 else { return nil }
            return ["productId": l.productId, "qty": l.qty]
        }
        guard !items.isEmpty else { show("Add at least one product with a quantity", isError: true); return }
        loading = true
        Task {
            do {
                try await APIClient.shared.eposStockReceive(studio: receiveStudio, items: items, note: receiveNote.isEmpty ? nil : receiveNote, staff: staff)
                show("Received \(items.count) line\(items.count == 1 ? "" : "s") into \(receiveStudio)")
                receiveLines = [ReceiveLine()]; receiveNote = ""
                await loadOverview()
            } catch { show(error.localizedDescription, isError: true) }
            loading = false
        }
    }

    private func submitStocktake() {
        guard let staff else { return }
        let counts: [[String: Any]] = trackedRows.compactMap { r in
            guard let c = takeCounts[r.id] else { return nil }
            return ["productId": r.id, "counted": c]
        }
        guard !counts.isEmpty else { show("Enter at least one counted quantity", isError: true); return }
        loading = true
        Task {
            do {
                let diffs = try await APIClient.shared.eposStocktakeSubmit(studio: takeStudio, counts: counts, note: takeNote.isEmpty ? nil : takeNote, staff: staff)
                show("Stocktake applied — \(diffs) adjustment\(diffs == 1 ? "" : "s") made")
                takeCounts = [:]; takeNote = ""
                await loadOverview(); await loadStocktakes()
            } catch { show(error.localizedDescription, isError: true) }
            loading = false
        }
    }

    private func exportReportCsv() {
        guard let report else { return }
        CSVExporter.exportStockReport(rows: report.products)
    }
}

// MARK: - Shared bits

enum StockViewData {
    static let adjustReasons = ["Breakage", "Damaged", "Missing", "Stocktake correction", "Complimentary", "Staff use", "Other"]
    static let movementTypes = ["sale", "receive", "transfer_out", "transfer_in", "adjust", "stocktake"]
}

struct PPFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(AppFont.body(13, weight: .semibold))
            .padding(10)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(PPBrand.charcoal.opacity(0.15)))
    }
}

private struct StockCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(PPBrand.charcoal.opacity(0.1)))
    }
}

extension View {
    func stockCard() -> some View { modifier(StockCardModifier()) }
}
