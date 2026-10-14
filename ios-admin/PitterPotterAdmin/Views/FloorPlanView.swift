import SwiftUI

// MARK: - Table Definitions (identical layout coordinates to the web floor plan)

struct FloorTable: Identifiable {
    let id: Int
    let label: String
    let area: String
    let x: CGFloat
    let y: CGFloat
    let chairs: [ChairSide]

    var seats: Int { chairs.count }
}

enum ChairSide: String, CaseIterable {
    case top, bottom, left, right
}

enum TableStatus {
    case free, partial, full, selected
}

private func firstName(_ name: String) -> String {
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    return trimmed.components(separatedBy: .whitespaces).first ?? name
}

// "10:00" or "10:00-12:00" → "10am"; "14:30" → "2:30pm"
private func shortTime(_ time: String) -> String {
    let start = time.split(separator: "-").first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? time
    let parts = start.split(separator: ":")
    guard let h = Int(parts.first ?? "") else { return time }
    let m = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
    let suffix = h >= 12 ? "pm" : "am"
    let h12 = h % 12 == 0 ? 12 : h % 12
    return m == 0 ? "\(h12)\(suffix)" : String(format: "%d:%02d%@", h12, m, suffix)
}

// Matches overlapsTwoHours in the web floor plans.
private func minutesOfDay(_ time: String) -> Int {
    let start = time.split(separator: "-").first.map(String.init) ?? time
    let parts = start.split(separator: ":")
    let h = Int(parts.first ?? "") ?? 0
    let m = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
    return h * 60 + m
}

private func overlapsTwoHours(_ a: String, _ b: String) -> Bool {
    abs(minutesOfDay(a) - minutesOfDay(b)) < 120
}

// All tables render at the same size on both platforms.
private let TABLE_W: CGFloat = 80
private let TABLE_H: CGFloat = 52
private let PARTY_CAPACITY = 9

struct PutneyTables {
    static let main: [FloorTable] = [
        FloorTable(id: 1, label: "T1", area: "main", x: 55, y: 55, chairs: [.top, .left, .left, .right, .right]),
        FloorTable(id: 2, label: "T2", area: "main", x: 55, y: 165, chairs: [.left, .right]),
        FloorTable(id: 3, label: "T3", area: "main", x: 55, y: 255, chairs: [.left, .right]),
        FloorTable(id: 4, label: "T4", area: "main", x: 55, y: 345, chairs: [.left, .left, .right, .right, .bottom]),
        FloorTable(id: 5, label: "T5", area: "main", x: 270, y: 55, chairs: [.top, .top, .bottom, .bottom]),
        FloorTable(id: 6, label: "T6", area: "main", x: 270, y: 165, chairs: [.top, .top, .bottom, .bottom]),
    ]

    static let party: [FloorTable] = [
        FloorTable(id: 7, label: "T7", area: "party", x: 30, y: 560, chairs: [.top, .top, .bottom, .bottom]),
        FloorTable(id: 8, label: "T8", area: "party", x: 165, y: 560, chairs: [.top, .bottom]),
        FloorTable(id: 9, label: "T9", area: "party", x: 255, y: 560, chairs: [.top, .bottom]),
        FloorTable(id: 10, label: "T10", area: "party", x: 340, y: 560, chairs: [.top, .top, .bottom, .bottom]),
    ]

    static let all: [FloorTable] = main + party
}

struct WimbledonTables {
    // Front: T1–T4 down the left, T5–T10 down the right (beam between T8 & T9).
    // Bar centre-left between front and back.
    // Back: Party Area 1 (T15+T16) and Party Area 2 (T17+T18) on the left;
    // T11, T12, T13 down the right, T14 at the bottom.
    static let main: [FloorTable] = [
        FloorTable(id: 1, label: "T1", area: "main", x: 50, y: 17, chairs: [.top, .left, .right]),
        FloorTable(id: 2, label: "T2", area: "main", x: 50, y: 87, chairs: [.top, .top, .bottom, .left, .right]),
        FloorTable(id: 3, label: "T3", area: "main", x: 50, y: 157, chairs: [.top, .top, .bottom, .left, .right]),
        FloorTable(id: 4, label: "T4", area: "main", x: 50, y: 227, chairs: [.top, .top, .bottom, .left, .right]),
        FloorTable(id: 5, label: "T5", area: "main", x: 310, y: 17, chairs: [.top, .top, .bottom, .bottom]),
        FloorTable(id: 6, label: "T6", area: "main", x: 310, y: 87, chairs: [.top, .bottom]),
        FloorTable(id: 7, label: "T7", area: "main", x: 310, y: 157, chairs: [.top, .top, .bottom, .bottom]),
        FloorTable(id: 8, label: "T8", area: "main", x: 310, y: 227, chairs: [.top, .bottom]),
        FloorTable(id: 9, label: "T9", area: "main", x: 310, y: 297, chairs: [.top, .top, .bottom, .bottom]),
        FloorTable(id: 10, label: "T10", area: "main", x: 310, y: 367, chairs: [.top, .left, .right]),
    ]

    // Back right: normal tables that can also extend the party areas.
    static let back: [FloorTable] = [
        FloorTable(id: 11, label: "T11", area: "back", x: 310, y: 447, chairs: [.top, .left, .right]),
        FloorTable(id: 12, label: "T12", area: "back", x: 310, y: 517, chairs: [.top, .left, .right]),
        FloorTable(id: 13, label: "T13", area: "back", x: 310, y: 587, chairs: [.top, .left, .right]),
        FloorTable(id: 14, label: "T14", area: "back", x: 310, y: 657, chairs: [.top, .top, .bottom, .left, .right]),
    ]

    // Party Area 1: T15 + T16 side by side.
    static let party1: [FloorTable] = [
        FloorTable(id: 15, label: "T15", area: "party1", x: 50, y: 447, chairs: [.top, .top, .bottom, .bottom]),
        FloorTable(id: 16, label: "T16", area: "party1", x: 170, y: 447, chairs: [.top, .top, .bottom, .left, .right]),
    ]

    // Party Area 2: T17 + T18 side by side.
    static let party2: [FloorTable] = [
        FloorTable(id: 17, label: "T17", area: "party2", x: 50, y: 517, chairs: [.top, .top, .bottom, .bottom]),
        FloorTable(id: 18, label: "T18", area: "party2", x: 170, y: 517, chairs: [.top, .top, .bottom, .left, .right]),
    ]

    static let all: [FloorTable] = main + back + party1 + party2
}

// MARK: - Floor Plan View

struct FloorPlanView: View {
    let studio: String
    let bookings: [Booking]
    let selectedDate: String?
    let selectedTime: String?
    let highlightTableId: String?
    var onAssign: ((String) -> Void)? = nil
    var onMoveBooking: ((String, String) -> Void)? = nil

    @State private var selectedTable: String? = nil
    @State private var pendingAssign: Booking? = nil
    @State private var zoomScale: CGFloat = 1.0
    @State private var lastZoomScale: CGFloat = 1.0
    @State private var panOffset: CGSize = .zero
    @State private var lastPanOffset: CGSize = .zero
    @State private var dropTarget: String? = nil

    private var tables: [FloorTable] {
        studio == "Putney" ? PutneyTables.all : WimbledonTables.all
    }

    private var viewBox: CGRect {
        studio == "Putney" ? CGRect(x: 0, y: 0, width: 470, height: 700) : CGRect(x: 0, y: 0, width: 460, height: 745)
    }

    private func dayBookings() -> [Booking] {
        guard let selectedDate else { return [] }
        return bookings.filter { b in
            b.date == selectedDate && b.studio == studio
                && b.status != BookingStatus.cancelled.rawValue && b.status != BookingStatus.noShow.rawValue
        }
    }

    private func bookingsForTable(_ tid: String) -> [Booking] {
        dayBookings().filter { b in
            (b.tableId ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.contains(tid)
        }
    }

    // Bookings relevant to the selected slot — matches the web plan's
    // relevantBookings: all of the day's, or only overlapping ones when a
    // time was passed (assign sheet / collection preview).
    private func relevantBookings(_ tid: String) -> [Booking] {
        let all = bookingsForTable(tid)
        let filtered = selectedTime != nil
            ? all.filter { !$0.time.isEmpty && overlapsTwoHours($0.time, selectedTime!) }
            : all
        return filtered.sorted { $0.time < $1.time }
    }

    // Bookings shown as chips / used for colours — overlap-filtered when a
    // slot is selected, sorted like the web legend.
    private var visibleBookings: [Booking] {
        let all = dayBookings()
        let filtered = selectedTime != nil
            ? all.filter { !$0.time.isEmpty && overlapsTwoHours($0.time, selectedTime!) }
            : all
        return filtered.sorted { $0.time == $1.time ? $0.name < $1.name : $0.time < $1.time }
    }

    private var unassignedBookings: [Booking] {
        dayBookings().filter { ($0.tableId ?? "").isEmpty }
    }

    private func partyAreaCapacity(_ area: String) -> (used: Int, total: Int, remaining: Int) {
        let tableIds = Set(tables.filter { $0.area == area }.map { "T\($0.id)" })
        let used = dayBookings()
            .filter { b in
                (b.tableId ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.contains { tableIds.contains($0) }
            }
            .reduce(0) { $0 + $1.paintersCount }
        return (used, PARTY_CAPACITY, max(0, PARTY_CAPACITY - used))
    }

    private var highlightIds: Set<String> {
        Set((highlightTableId ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) })
    }

    private func status(for table: FloorTable) -> TableStatus {
        let tid = "T\(table.id)"
        if selectedTable == tid || highlightIds.contains(tid) { return .selected }
        let tableBookings = bookingsForTable(tid)
        if tableBookings.isEmpty { return .free }
        if selectedTime != nil,
           tableBookings.contains(where: { !$0.time.isEmpty && overlapsTwoHours($0.time, selectedTime!) }) {
            return .full
        }
        return .partial
    }

    private func statusColor(_ s: TableStatus) -> Color {
        switch s {
        case .free: return .white
        case .partial: return Color(hex: 0xFEF9C3)
        case .full: return Color(hex: 0xEF4444)
        case .selected: return PPBrand.charcoal
        }
    }

    private func statusStroke(_ s: TableStatus) -> Color {
        switch s {
        case .free: return PPBrand.charcoal
        case .partial: return Color(hex: 0xCA8A04)
        case .full: return Color(hex: 0xB91C1C)
        case .selected: return PPBrand.charcoal
        }
    }

    private func statusTextColor(_ s: TableStatus) -> Color {
        switch s {
        case .free: return PPBrand.charcoal
        case .partial: return Color(hex: 0x854D0E)
        case .full: return .white
        case .selected: return .white
        }
    }

    private func occupantLabels(_ tableBookings: [Booking]) -> [String] {
        var labels = tableBookings.sorted { $0.time < $1.time }.prefix(2).map { b in
            String("\(shortTime(b.time)) \(firstName(b.name)) \(b.paintersCount)p".prefix(18))
        }
        if tableBookings.count > 2 { labels.append("+\(tableBookings.count - 2) more") }
        return labels
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(studio) Studio")
                        .font(AppFont.heading(16))
                        .foregroundStyle(PPBrand.charcoal)
                    Text(studio == "Putney" ? "10 tables · 234 Upper Richmond Road, London, SW15 6TG" : "18 tables · 52 Wimbledon Hill Road, London, SW19 7PA")
                        .font(AppFont.body(10))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
                Spacer()
                if let sel = selectedTable {
                    let table = tables.first { "T\($0.id)" == sel }
                    Text("\(sel) selected · \(table?.seats ?? 0) seats")
                        .font(AppFont.body(11, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(PPBrand.sage)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }

            // Pending assign banner — tap mode alternative to drag & drop
            if let pending = pendingAssign {
                HStack {
                    Text("Assigning \(firstName(pending.name)) — tap a table")
                        .font(AppFont.body(11, weight: .bold))
                        .foregroundStyle(Color(hex: 0x065F46))
                    Spacer()
                    Button("Cancel") { pendingAssign = nil }
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(Color(hex: 0x047857))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(hex: 0xECFDF5))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0x6EE7B7), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            // Unassigned bookings warning — tap a row then a table, or drag
            if !unassignedBookings.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(unassignedBookings.count) booking\(unassignedBookings.count == 1 ? "" : "s") need table assignment")
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(Color(hex: 0x92400E))
                        .textCase(.uppercase)
                        .tracking(0.5)
                    ForEach(unassignedBookings) { b in
                        HStack {
                            Text("\(firstName(b.name)) · \(b.time) · \(b.paintersCount)p")
                                .font(AppFont.body(10, weight: .semibold))
                                .foregroundStyle(pendingAssign?.id == b.id ? Color(hex: 0x065F46) : Color(hex: 0xB45309))
                            Spacer()
                            if onMoveBooking != nil {
                                Text(pendingAssign?.id == b.id ? "tap a table to assign" : "tap or drag onto a table")
                                    .font(AppFont.body(10))
                                    .foregroundStyle(Color(hex: 0xD97706))
                            }
                        }
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(pendingAssign?.id == b.id ? Color(hex: 0xD1FAE5) : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .draggable(b.id)
                        .onTapGesture {
                            if onMoveBooking != nil {
                                pendingAssign = pendingAssign?.id == b.id ? nil : b
                            }
                        }
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: 0xFFFBEB))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0xFDE68A), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            // Party area capacity bars (Wimbledon only, like web)
            if studio == "Wimbledon", selectedDate != nil {
                HStack(spacing: 10) {
                    partyAreaBar("Party Area 1", cap: partyAreaCapacity("party1"), tint: Color(hex: 0x16A34A))
                    partyAreaBar("Party Area 2", cap: partyAreaCapacity("party2"), tint: Color(hex: 0x2563EB))
                }
            }

            // Day's bookings listed vertically down the left of the plan —
            // tap a chip to locate its table, drag onto a table to move it
            HStack(alignment: .top, spacing: 8) {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 5) {
                        if !visibleBookings.isEmpty {
                            Text("\(visibleBookings.count) booking\(visibleBookings.count == 1 ? "" : "s")")
                                .font(AppFont.body(9, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                                .textCase(.uppercase)
                                .tracking(0.5)
                            ForEach(visibleBookings) { b in
                                Text("\(shortTime(b.time)) \(firstName(b.name)) \(b.paintersCount)p")
                                    .font(AppFont.body(11, weight: .semibold))
                                    .foregroundStyle(PPBrand.charcoal)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 5)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                    .draggable(b.id)
                                    .onTapGesture {
                                        if let t = (b.tableId ?? "").split(separator: ",").first {
                                            selectedTable = t.trimmingCharacters(in: .whitespaces)
                                        }
                                    }
                            }
                        } else {
                            legendItem(color: .white, stroke: PPBrand.charcoal, label: "Free")
                            legendItem(color: Color(hex: 0xFEF9C3), stroke: Color(hex: 0xCA8A04), label: "Has bookings")
                            legendItem(color: Color(hex: 0xEF4444), stroke: Color(hex: 0xB91C1C), label: "Slot taken")
                            legendItem(color: PPBrand.charcoal, stroke: PPBrand.charcoal, label: "Selected")
                        }
                    }
                    .padding(.vertical, 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(width: 118)

                // Floor plan fills the remaining space — drag pans in every direction
                GeometryReader { planGeo in
                let fitScale = min(planGeo.size.width / viewBox.width, planGeo.size.height / viewBox.height)
                let displayScale = fitScale * zoomScale
                let scaledW = viewBox.width * displayScale
                let scaledH = viewBox.height * displayScale
                let maxPanX = max(0, (scaledW - planGeo.size.width) / 2)
                let maxPanY = max(0, (scaledH - planGeo.size.height) / 2)

                ZStack {
                    planContent
                        .scaleEffect(displayScale, anchor: .center)
                        .frame(width: scaledW, height: scaledH)
                        .offset(x: panOffset.width, y: panOffset.height)
                }
                .frame(width: planGeo.size.width, height: planGeo.size.height)
                .background(Color(red: 0.99, green: 0.99, blue: 0.985))
                .clipped()
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            panOffset = CGSize(
                                width: min(maxPanX, max(-maxPanX, lastPanOffset.width + value.translation.width)),
                                height: min(maxPanY, max(-maxPanY, lastPanOffset.height + value.translation.height))
                            )
                        }
                        .onEnded { _ in
                            lastPanOffset = panOffset
                        }
                )
                .simultaneousGesture(
                    TapGesture(count: 2)
                        .onEnded {
                            zoomScale = 1.0
                            lastZoomScale = 1.0
                            panOffset = .zero
                            lastPanOffset = .zero
                        }
                )
                .simultaneousGesture(
                    MagnificationGesture()
                        .onChanged { value in
                            zoomScale = min(4.0, max(1.0, lastZoomScale * value))
                        }
                        .onEnded { _ in
                            lastZoomScale = zoomScale
                            if zoomScale == 1.0 {
                                panOffset = .zero
                                lastPanOffset = .zero
                            }
                        }
                )
                .overlay(alignment: .bottom) {
                    HStack(spacing: 10) {
                        Button {
                            zoomScale = max(1.0, zoomScale - 0.25)
                            lastZoomScale = zoomScale
                            panOffset = .zero
                            lastPanOffset = .zero
                        } label: {
                            Image(systemName: "minus.magnifyingglass")
                                .font(AppFont.body(16, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                        }

                        Text("\(Int(round(zoomScale * 100)))%")
                            .font(AppFont.body(12))
                            .foregroundStyle(PPBrand.charcoal)
                            .frame(minWidth: 36)

                        Button {
                            zoomScale = min(4.0, zoomScale + 0.25)
                            lastZoomScale = zoomScale
                        } label: {
                            Image(systemName: "plus.magnifyingglass")
                                .font(AppFont.body(16, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                        }

                        if zoomScale > 1.0 || panOffset != .zero {
                            Button {
                                zoomScale = 1.0
                                lastZoomScale = 1.0
                                panOffset = .zero
                                lastPanOffset = .zero
                            } label: {
                                Text("Reset")
                                    .font(AppFont.body(12, weight: .bold))
                                    .foregroundStyle(PPBrand.charcoal)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
                    .padding(10)
                }
            }
            .frame(minHeight: 200)
            }

            // Selected table bookings
            if let sel = selectedTable {
                let tableBookings = bookingsForTable(sel).sorted { $0.time < $1.time }
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(sel) — \(selectedDate ?? "")")
                            .font(AppFont.heading(13))
                            .foregroundStyle(PPBrand.charcoal)
                        if tableBookings.isEmpty {
                            Text("No bookings on this table for the selected date.")
                                .font(AppFont.body(11, weight: .semibold))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        }
                        ForEach(tableBookings) { b in
                            HStack {
                                Text(b.time).font(AppFont.body(11, weight: .bold))
                                Text(firstName(b.name)).font(AppFont.body(11))
                                Spacer()
                                Text("\(b.paintersCount)p").font(AppFont.body(10, weight: .bold))
                                StatusBadge(status: b.bookingStatus ?? .pending)
                                if onMoveBooking != nil {
                                    Button {
                                        onMoveBooking?(b.id, "")
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(AppFont.body(13))
                                            .foregroundStyle(Color(hex: 0xDC2626))
                                    }
                                    .buttonStyle(.plain)
                                    .help("Remove from table")
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 130)
                .background(Color(red: 0.973, green: 0.98, blue: 0.984))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            // Assign button
            if let sel = selectedTable, onAssign != nil {
                Button {
                    onAssign?(sel)
                } label: {
                    Text("Assign \(sel) to booking")
                        .font(AppFont.body(13, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(PPBrand.charcoal)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))
    }

    private func partyAreaBar(_ title: String, cap: (used: Int, total: Int, remaining: Int), tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(title).textCase(.uppercase).tracking(0.5)
                Spacer()
                Text("\(cap.used)/\(cap.total)")
            }
            .font(AppFont.body(9, weight: .bold))
            .foregroundStyle(tint)
            ProgressView(value: Double(cap.used), total: Double(cap.total))
                .tint(tint)
            Text("\(cap.remaining) seats remaining")
                .font(AppFont.body(9, weight: .semibold))
                .foregroundStyle(tint.opacity(0.8))
        }
        .padding(8)
        .background(tint.opacity(0.06))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(0.25), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var planContent: some View {
        ZStack {
            if studio == "Putney" {
                // Main area
                areaRect(x: 10, y: 10, w: 440, h: 490, fill: Color(hex: 0xF8FAFB), stroke: PPBrand.charcoal.opacity(0.3))
                Text("MAIN AREA")
                    .font(AppFont.body(10, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    .position(x: 225, y: 30)

                // Bar fixture — right column, below T6
                areaRect(x: 270, y: 270, w: 88, h: 190, fill: PPBrand.sage, stroke: PPBrand.charcoal)
                Text("BAR")
                    .font(AppFont.heading(13))
                    .tracking(3)
                    .foregroundStyle(PPBrand.charcoal)
                    .position(x: 314, y: 370)

                // Divider line
                Rectangle()
                    .fill(PPBrand.charcoal.opacity(0.6))
                    .frame(width: 440, height: 1.5)
                    .position(x: 230, y: 510)

                // Party area
                areaRect(x: 10, y: 520, w: 440, h: 165, fill: Color(hex: 0xF0FDF4), stroke: Color(hex: 0x16A34A))
                Text("PARTY AREA")
                    .font(AppFont.body(10, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(Color(hex: 0x16A34A).opacity(0.6))
                    .position(x: 225, y: 540)
            } else {
                // Front area
                areaRect(x: 15, y: 10, w: 430, h: 425, fill: Color(hex: 0xF8FAFB), stroke: PPBrand.charcoal.opacity(0.3))
                Text("FRONT")
                    .font(AppFont.body(10, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    .position(x: 230, y: 28)

                // Bar between front and back, centre-left
                areaRect(x: 60, y: 322, w: 180, h: 50, fill: PPBrand.sage, stroke: PPBrand.charcoal)
                Text("BAR")
                    .font(AppFont.heading(13))
                    .tracking(3)
                    .foregroundStyle(PPBrand.charcoal)
                    .position(x: 150, y: 350)

                // Structural beam between T8 and T9
                RoundedRectangle(cornerRadius: 2)
                    .fill(PPBrand.charcoal.opacity(0.5))
                    .frame(width: 50, height: 10)
                    .position(x: 335, y: 292)
                Text("BEAM")
                    .font(AppFont.body(8, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    .position(x: 335, y: 282)

                // Back area
                areaRect(x: 15, y: 436, w: 430, h: 300, fill: Color(hex: 0xF8FAFB), stroke: PPBrand.charcoal.opacity(0.3))

                // Party Areas 1 & 2
                areaRect(x: 40, y: 442, w: 245, h: 70, fill: Color(hex: 0xF0FDF4), stroke: Color(hex: 0x16A34A))
                areaRect(x: 40, y: 512, w: 245, h: 70, fill: Color(hex: 0xF0FDF4), stroke: Color(hex: 0x16A34A))
                Text("PA1")
                    .font(AppFont.body(8, weight: .bold))
                    .foregroundStyle(Color(hex: 0x16A34A).opacity(0.6))
                    .rotationEffect(.degrees(-90))
                    .position(x: 300, y: 470)
                Text("PA2")
                    .font(AppFont.body(8, weight: .bold))
                    .foregroundStyle(Color(hex: 0x16A34A).opacity(0.6))
                    .rotationEffect(.degrees(-90))
                    .position(x: 300, y: 540)

                // Toilets label (bottom right)
                Text("Toilets")
                    .font(AppFont.body(10, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    .position(x: 385, y: 710)
            }

            // All tables
            ForEach(tables) { table in
                tableGroup(table)
            }
        }
        .frame(width: viewBox.width, height: viewBox.height)
    }

    private func areaRect(x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, fill: Color, stroke: Color) -> some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(fill)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(stroke, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .frame(width: w, height: h)
            .position(x: x + w / 2, y: y + h / 2)
    }

    private func tableGroup(_ table: FloorTable) -> some View {
        let tid = "T\(table.id)"
        let stat = status(for: table)
        let labels = occupantLabels(relevantBookings(tid))

        return ZStack {
            // Drop-target highlight
            if dropTarget == tid {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color(hex: 0x16A34A).opacity(0.13))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0x16A34A), style: StrokeStyle(lineWidth: 2, dash: [5, 3])))
                    .frame(width: TABLE_W + 8, height: TABLE_H + 8)
                    .position(x: table.x + TABLE_W / 2, y: table.y + TABLE_H / 2)
            }

            // Table
            RoundedRectangle(cornerRadius: 4)
                .fill(statusColor(stat))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(statusStroke(stat), lineWidth: stat == .selected ? 2.5 : 1.5)
                )
                .overlay(
                    VStack(spacing: 1) {
                        Text(tid)
                            .font(AppFont.heading(11, weight: .black))
                            .foregroundStyle(statusTextColor(stat))
                        if labels.isEmpty {
                            Text("free")
                                .font(AppFont.body(8))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                        } else {
                            ForEach(labels, id: \.self) { label in
                                Text(label)
                                    .font(AppFont.body(7, weight: .bold))
                                    .foregroundStyle(statusTextColor(stat))
                                    .lineLimit(1)
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                )
                .frame(width: TABLE_W, height: TABLE_H)
                .position(x: table.x + TABLE_W / 2, y: table.y + TABLE_H / 2)
                .onTapGesture {
                    Haptics.light()
                    if let pending = pendingAssign {
                        onMoveBooking?(pending.id, tid)
                        pendingAssign = nil
                        selectedTable = tid
                    } else {
                        selectedTable = selectedTable == tid ? nil : tid
                        onAssign?(tid)
                    }
                }
                .dropDestination(for: String.self) { items, _ in
                    if let bookingId = items.first { onMoveBooking?(bookingId, tid) }
                    dropTarget = nil
                    return true
                } isTargeted: { targeted in
                    dropTarget = targeted ? tid : (dropTarget == tid ? nil : dropTarget)
                }
        }
    }

    private func legendItem(color: Color, stroke: Color, label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .overlay(RoundedRectangle(cornerRadius: 2).stroke(stroke, lineWidth: 1))
                .frame(width: 16, height: 12)
            Text(label)
                .font(AppFont.body(10, weight: .medium))
                .foregroundStyle(PPBrand.charcoal.opacity(0.7))
        }
    }
}

struct FloorPlanTabView: View {
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var toastManager: ToastManager

    @State private var studio: Studio = .Wimbledon
    @State private var date: Date = Date()

    private var availableStudios: [Studio] {
        authVM.staff?.visibleStudios ?? Studio.allCases
    }

    private var dateString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                if availableStudios.count > 1 {
                    Picker("Studio", selection: $studio) {
                        ForEach(availableStudios, id: \.self) { s in
                            Text(s.rawValue).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 220)
                } else {
                    Text(studio.rawValue)
                        .font(AppFont.body(13, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(PPBrand.sage)
                        .clipShape(Capsule())
                }

                DatePicker("Date", selection: $date, displayedComponents: [.date])
                    .datePickerStyle(.compact)
                    .labelsHidden()

                Button("Today") { date = Date() }
                    .font(AppFont.body(10, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.7))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(PPBrand.charcoal.opacity(0.2), lineWidth: 1))

                Spacer()

                Text("Tap a chip to locate it · tap an unassigned booking then a table to assign")
                    .font(AppFont.body(10, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            }
            .padding(.horizontal)
            .padding(.top, 8)

            FloorPlanView(
                studio: studio.rawValue,
                bookings: bookingsVM.bookings,
                selectedDate: dateString,
                selectedTime: nil,
                highlightTableId: nil,
                onAssign: nil,
                onMoveBooking: { bookingId, tableId in
                    moveBooking(bookingId, to: tableId)
                }
            )
            .onAppear {
                if let selected = bookingsVM.selectedStudio, availableStudios.contains(selected) {
                    studio = selected
                } else if let first = availableStudios.first {
                    studio = first
                }
            }
            .onChange(of: bookingsVM.selectedStudio) { newValue in
                if let selected = newValue, availableStudios.contains(selected), selected != studio {
                    studio = selected
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(PPBrand.sage.opacity(0.3))
        .onAppear {
            if let first = availableStudios.first, !availableStudios.contains(studio) {
                studio = first
            }
        }
    }

    private func moveBooking(_ bookingId: String, to tableId: String) {
        guard let staff = authVM.staff,
              let idx = bookingsVM.bookings.firstIndex(where: { $0.id == bookingId }) else { return }
        let booking = bookingsVM.bookings[idx]
        var updated = booking
        updated.tableId = tableId.isEmpty ? nil : tableId
        Task {
            let ok = await bookingsVM.patchBooking(
                id: bookingId, studio: booking.studio,
                fields: ["tableId": tableId],
                updated: updated, staff: staff
            )
            if ok {
                toastManager.success(tableId.isEmpty ? "\(firstName(booking.name)) unassigned" : "\(firstName(booking.name)) → \(tableId)")
            } else {
                toastManager.error(bookingsVM.error ?? "Failed to assign table")
            }
        }
    }
}

struct FloorPlanTabView_Previews: PreviewProvider {
    static var previews: some View {
        FloorPlanTabView()
            .environmentObject(BookingsViewModel())
    }
}
