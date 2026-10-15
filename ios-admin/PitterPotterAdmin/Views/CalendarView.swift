import SwiftUI
import UIKit

private let sharedDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

struct CalendarView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var toastManager: ToastManager

    @State private var calendarMonth = Date()
    @State private var selectedDate: String? = nil
    @State private var searchText = ""

    private var canAddBookings: Bool {
        authVM.staff?.role == "super_admin" || authVM.staff?.canAddWalkIns == true
    }

    /// Bookings scoped to the globally selected location (nil = all studios)
    private var studioBookings: [Booking] {
        bookingsVM.visibleBookings
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let dateStr = selectedDate {
                    DayDashboardView(
                        date: dateStr,
                        bookings: studioBookings,
                        onBack: { selectedDate = nil },
                        onUpdateStatus: { id, status in
                            Task {
                                if let staff = authVM.staff {
                                    if let booking = bookingsVM.bookings.first(where: { $0.id == id }) {
                                        await bookingsVM.updateStatus(booking: booking, status: status, staff: staff)
                                    }
                                }
                            }
                        },
                        canUpdateStatus: authVM.staff?.canUpdateStatus ?? false,
                        bookingsVM: bookingsVM,
                        authVM: authVM,
                        toastManager: toastManager
                    )
                } else {
                    if searchText.isEmpty {
                    MonthCalendarView(
                        bookings: studioBookings,
                        selectedDate: selectedDate,
                        month: calendarMonth,
                        onMonthChange: { calendarMonth = $0 },
                        onSelectDate: { dateStr in selectedDate = dateStr }
                    )
                }

                    BookingsListBelowCalendar(
                        bookings: studioBookings,
                        onTap: { booking in
                            selectedDate = booking.date
                        },
                        searchText: $searchText,
                        staffStudio: authVM.staff?.allowedStudios?.count == 1 ? authVM.staff?.allowedStudios?.first : nil,
                        canUpdateStatus: authVM.staff?.canUpdateStatus ?? false || authVM.staff?.role == "super_admin",
                        onUpdateStatus: { id, status in
                            Task {
                                if let staff = authVM.staff {
                                    if let booking = bookingsVM.bookings.first(where: { $0.id == id }) {
                                        await bookingsVM.updateStatus(booking: booking, status: status, staff: staff)
                                    }
                                }
                            }
                        }
                    )
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color.white)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(selectedDate == nil ? "Calendar" : "Day View")
                        .font(AppFont.heading(17))
                        .foregroundStyle(PPBrand.charcoal)
                        .textCase(.uppercase)
                        .tracking(1)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if selectedDate == nil {
                        Button("Today") {
                            calendarMonth = Date()
                        }
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                    }
                }
            }
            .navigationDestination(for: Booking.self) { booking in
                BookingDetailView(booking: booking)
                    .environmentObject(bookingsVM)
                    .environmentObject(authVM)
                    .environmentObject(toastManager)
            }
            .refreshable {
                if let staff = authVM.staff {
                    await bookingsVM.loadBookings(staff: staff)
                }
            }
        }
    }
}

// MARK: - Month Calendar Grid (matches web AdminCalendar)

struct MonthCalendarView: View {
    let bookings: [Booking]
    let selectedDate: String?
    let month: Date
    let onMonthChange: (Date) -> Void
    let onSelectDate: (String) -> Void

    private let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    private let partyTypes: Set<String> = ["birthday-party", "baby-shower-hen", "corporate"]

    private var days: [Date] {
        let cal = Calendar.current
        let firstOfMonth = cal.date(from: cal.dateComponents([.year, .month], from: month))!
        let firstOfWeek = cal.date(byAdding: .day, value: -(cal.component(.weekday, from: firstOfMonth) - 2 + 7) % 7, to: firstOfMonth)!
        return (0..<42).compactMap { cal.date(byAdding: .day, value: $0, to: firstOfWeek) }
    }

    private var bookingsByDate: [String: (painting: Bool, babyPrints: Bool, party: Bool, painters: Int, bookings: Int)] {
        var map: [String: (painting: Bool, babyPrints: Bool, party: Bool, painters: Int, bookings: Int)] = [:]
        for b in bookings {
            if b.status == "cancelled" || b.status == "no_show" { continue }
            if map[b.date] == nil { map[b.date] = (false, false, false, 0, 0) }
            if b.sessionType == "painting" { map[b.date]!.painting = true }
            else if b.sessionType == "clay-imprints" { map[b.date]!.babyPrints = true }
            else if partyTypes.contains(b.sessionType) { map[b.date]!.party = true }
            map[b.date]!.painters += b.paintersCount
            map[b.date]!.bookings += 1
        }
        return map
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(month.formatted(.dateTime.month(.wide).year()))
                        .font(AppFont.heading(20))
                        .foregroundStyle(PPBrand.charcoal)
                    HStack(spacing: 12) {
                        LegendDot(color: Color(hex: 0x10B981), label: "Painting")
                        LegendDot(color: Color(hex: 0xFB923C), label: "Baby Prints")
                        LegendDot(color: Color(hex: 0xA855F7), label: "Party")
                    }
                }
                Spacer()
                Button {
                    onMonthChange(Date())
                } label: {
                    Text("Today")
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                        .textCase(.uppercase)
                        .tracking(1)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(PPBrand.charcoal.opacity(0.2), lineWidth: 1)
                        )
                }
                HStack(spacing: 0) {
                    Button { if let d = Calendar.current.date(byAdding: .month, value: -1, to: month) { onMonthChange(d) } } label: {
                        Image(systemName: "chevron.left")
                            .font(AppFont.body(14, weight: .bold))
                            .foregroundStyle(PPBrand.charcoal)
                            .frame(width: 32, height: 32)
                    }
                    Button { if let d = Calendar.current.date(byAdding: .month, value: 1, to: month) { onMonthChange(d) } } label: {
                        Image(systemName: "chevron.right")
                            .font(AppFont.body(14, weight: .bold))
                            .foregroundStyle(PPBrand.charcoal)
                            .frame(width: 32, height: 32)
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(PPBrand.charcoal.opacity(0.2), lineWidth: 1)
                )
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            // Weekday headers
            HStack(spacing: 0) {
                ForEach(weekdays, id: \.self) { day in
                    Text(day)
                        .font(AppFont.heading(10))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                        .textCase(.uppercase)
                        .tracking(1)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .overlay(alignment: .bottom) {
                Rectangle().fill(PPBrand.charcoal.opacity(0.08)).frame(height: 0.5)
            }

            // Day grid
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                ForEach(days, id: \.self) { day in
                    let dateStr = dateString(day)
                    let cal = Calendar.current
                    let inMonth = cal.isDate(day, equalTo: month, toGranularity: .month)
                    let isToday = cal.isDateInToday(day)
                    let isSelected = selectedDate == dateStr
                    let types = bookingsByDate[dateStr]

                    Button {
                        onSelectDate(dateStr)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(cal.component(.day, from: day))")
                                .font(AppFont.heading(14))
                                .foregroundStyle(isSelected ? Color.white : isToday ? Color.white : PPBrand.charcoal)
                                .frame(width: 30, height: 30)
                                .background(
                                    isSelected ? PPBrand.charcoal :
                                    isToday ? PPBrand.sage : Color.clear
                                )
                                .clipShape(Circle())
                                .overlay(
                                    isToday && !isSelected ?
                                        Circle().stroke(PPBrand.sage, lineWidth: 2)
                                    : nil
                                )

                            if let types {
                                HStack(spacing: 3) {
                                    if types.painting { Circle().fill(Color(hex: 0x10B981)).frame(width: 6, height: 6) }
                                    if types.babyPrints { Circle().fill(Color(hex: 0xFB923C)).frame(width: 6, height: 6) }
                                    if types.party { Circle().fill(Color(hex: 0xA855F7)).frame(width: 6, height: 6) }
                                    if types.painters > 0 {
                                        Text("\(types.painters)")
                                            .font(AppFont.heading(8))
                                            .foregroundStyle(isSelected ? Color.white : PPBrand.charcoal.opacity(0.4))
                                    }
                                }
                            }
                            Spacer()
                        }
                        .frame(maxWidth: .infinity, minHeight: 60, alignment: .topLeading)
                        .padding(6)
                        .background(
                            isSelected ? PPBrand.sage.opacity(0.85) :
                            isToday ? PPBrand.clay100.opacity(0.5) :
                            inMonth ? Color.white : Color(.systemGray6).opacity(0.3)
                        )
                        .overlay(
                            isSelected ?
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(PPBrand.charcoal, lineWidth: 3)
                            : nil
                        )
                        .overlay(alignment: .trailing) {
                            Rectangle().fill(PPBrand.charcoal.opacity(0.06)).frame(width: 0.5)
                        }
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(PPBrand.charcoal.opacity(0.06)).frame(height: 0.5)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
    }

    private func dateString(_ date: Date) -> String {
        sharedDateFormatter.string(from: date)
    }
}

// MARK: - Bookings List Below Calendar

struct BookingsListBelowCalendar: View {
    let bookings: [Booking]
    let onTap: (Booking) -> Void
    @Binding var searchText: String
    var staffStudio: String? = nil
    var canUpdateStatus: Bool = false
    var onUpdateStatus: ((String, BookingStatus) -> Void)? = nil
    @State private var statusFilter: String = "all"
    @State private var bookingTypeTab: String = "all"
    @State private var selectedIds: Set<String> = []
    @State private var sortField: String = "added"
    @State private var sortAsc: Bool = false
    @FocusState private var searchFocused: Bool

    private func sortHeader(_ field: String, _ label: String) -> some View {
        Button {
            if sortField == field {
                sortAsc.toggle()
            } else {
                sortField = field
                sortAsc = false
            }
        } label: {
            HStack(spacing: 3) {
                Text(label)
                    .font(AppFont.body(10, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.5)
                if sortField == field {
                    Image(systemName: sortAsc ? "chevron.up" : "chevron.down")
                        .font(AppFont.body(8, weight: .bold))
                }
            }
            .foregroundStyle(PPBrand.charcoal)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
        }
        .buttonStyle(.plain)
    }

    private var sortedBookings: [Booking] {
        let result = filteredBookings
        switch sortField {
        case "added":
            return result.sorted { sortAsc ? ($0.createdAt ?? "") < ($1.createdAt ?? "") : ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        case "date":
            return result.sorted { sortAsc ? $0.date < $1.date : $0.date > $1.date }
        case "name":
            return result.sorted { sortAsc ? $0.name < $1.name : $0.name > $1.name }
        case "status":
            return result.sorted { sortAsc ? $0.status < $1.status : $0.status > $1.status }
        default:
            return result
        }
    }

    private var filteredBookings: [Booking] {
        var result = bookings
        switch statusFilter {
        case "all": break
        case "pending": result = result.filter { $0.status == "pending" }
        case "confirmed": result = result.filter { $0.status == "confirmed" }
        case "seated": result = result.filter { $0.status == "seated" }
        case "completed": result = result.filter { $0.status == "completed" }
        case "cancelled": result = result.filter { $0.status == "cancelled" }
        default: break
        }
        switch bookingTypeTab {
        case "all": break
        case "painting": result = result.filter { $0.sessionType == "painting" }
        case "baby-prints": result = result.filter { $0.sessionType == "clay-imprints" }
        case "party": result = result.filter { ["birthday-party", "baby-shower-hen", "corporate"].contains($0.sessionType) }
        default: break
        }
        if !searchText.isEmpty {
            let q = searchText.lowercased()
            result = result.filter { b in
                b.name.lowercased().contains(q) ||
                (b.phone ?? "").contains(q) ||
                (b.email ?? "").lowercased().contains(q) ||
                b.date.contains(q) ||
                b.studio.lowercased().contains(q)
            }
        }
        return result.sorted { $0.date == $1.date ? $0.time < $1.time : $0.date < $1.date }
    }

    private func countForTab(_ tab: String) -> Int {
        switch tab {
        case "all": return bookings.count
        case "painting": return bookings.filter { $0.sessionType == "painting" }.count
        case "baby-prints": return bookings.filter { $0.sessionType == "clay-imprints" }.count
        case "party": return bookings.filter { ["birthday-party", "baby-shower-hen", "corporate"].contains($0.sessionType) }.count
        default: return 0
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Booking type tabs (matching web: All Bookings, Painting, Baby Prints, Party)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach([("all", "All Bookings"), ("painting", "Painting"), ("baby-prints", "Baby Prints"), ("party", "Party")], id: \.0) { tab in
                        Button {
                            bookingTypeTab = tab.0
                            Haptics.light()
                        } label: {
                            HStack(spacing: 4) {
                                Text(tab.1)
                                    .font(AppFont.body(11, weight: .bold))
                                Text("\(countForTab(tab.0))")
                                    .font(AppFont.body(9, weight: .black))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1)
                                    .background(bookingTypeTab == tab.0 ? PPBrand.charcoal.opacity(0.15) : PPBrand.charcoal.opacity(0.08))
                                    .clipShape(Capsule())
                            }
                            .foregroundStyle(bookingTypeTab == tab.0 ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.6))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(bookingTypeTab == tab.0 ? PPBrand.sage : Color.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(PPBrand.charcoal.opacity(bookingTypeTab == tab.0 ? 0.3 : 0.15), lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 16)
            }

            // Search + status filter toolbar (matching web)
            VStack(spacing: 8) {
                // Search
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(AppFont.body(13, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                    TextField("Search name, email or phone…", text: $searchText)
                        .font(AppFont.body(12, weight: .semibold))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($searchFocused)
                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(AppFont.body(14))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))

                // Status filter (segmented like web — no bright colors)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        ForEach([("all", "All"), ("pending", "Awaiting"), ("confirmed", "Confirmed"), ("seated", "Seated"), ("completed", "Complete"), ("cancelled", "Cancelled")], id: \.0) { status in
                            Button {
                                statusFilter = status.0
                                Haptics.light()
                            } label: {
                                Text(status.1)
                                    .font(AppFont.body(10, weight: .bold))
                                    .foregroundStyle(statusFilter == status.0 ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.6))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                                    .background(statusFilter == status.0 ? PPBrand.sage : Color.white)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))
                }
            }

            // Bookings count
            HStack {
                Text("\(filteredBookings.count) booking\(filteredBookings.count != 1 ? "s" : "")")
                    .font(AppFont.body(11, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                if statusFilter != "all" || bookingTypeTab != "all" || !searchText.isEmpty {
                    Text("(filtered)")
                        .font(AppFont.body(11, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                }
                Spacer()
            }
            .padding(.top, 4)

            if filteredBookings.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tray")
                        .font(AppFont.body(28))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.2))
                    Text("No bookings found")
                        .font(AppFont.body(13, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                    Text("Adjust your filters or add a new booking")
                        .font(AppFont.body(11, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else {
                // Table (matching web desktop)
                LazyVStack(spacing: 0) {
                    HStack(spacing: 0) {
                        // Checkbox column with select all
                        Button {
                            if selectedIds.count == sortedBookings.count {
                                selectedIds.removeAll()
                            } else {
                                selectedIds = Set(sortedBookings.map { $0.id })
                            }
                        } label: {
                            Image(systemName: selectedIds.count == sortedBookings.count && !sortedBookings.isEmpty ? "checkmark.square.fill" : "square")
                                .font(AppFont.body(12, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                        }
                        .buttonStyle(.plain)
                        .frame(width: 40, alignment: .center)
                        .padding(.horizontal, 4)

                        sortHeader("added", "ADDED")
                        sortHeader("date", "DATE")
                        sortHeader("name", "GUEST")
                        Text("SESSION")
                            .font(AppFont.body(10, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                        sortHeader("status", "STATUS")
                        Text("TABLE")
                            .font(AppFont.body(10, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .frame(width: 70, alignment: .leading)
                            .padding(.horizontal, 8)
                        Text("ACTIONS")
                            .font(AppFont.body(10, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .frame(width: 90, alignment: .center)
                            .padding(.horizontal, 8)
                    }
                    .padding(.vertical, 10)
                    .background(PPBrand.clay100)
                    .overlay(
                        Rectangle()
                            .fill(PPBrand.charcoal.opacity(0.15))
                            .frame(height: 1),
                        alignment: .bottom
                    )

                    ForEach(sortedBookings) { booking in
                        BookingListRow(
                            booking: booking,
                            onTap: { onTap(booking) },
                            staffStudio: staffStudio,
                            canUpdateStatus: canUpdateStatus,
                            isSelected: selectedIds.contains(booking.id),
                            onToggleSelect: { id in
                                if selectedIds.contains(id) {
                                    selectedIds.remove(id)
                                } else {
                                    selectedIds.insert(id)
                                }
                            },
                            onConfirm: { id in onUpdateStatus?(id, .confirmed) },
                            onAwaiting: { id in onUpdateStatus?(id, .pending) },
                            onCancel: { id in onUpdateStatus?(id, .cancelled) }
                        )
                    }
                }
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                )
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
    }

    private func dateString(_ date: Date) -> String {
        sharedDateFormatter.string(from: date)
    }
}

struct BookingListRow: View {
    let booking: Booking
    let onTap: () -> Void
    var staffStudio: String? = nil
    var canUpdateStatus: Bool = false
    var isSelected: Bool = false
    var onToggleSelect: ((String) -> Void)? = nil
    var onConfirm: ((String) -> Void)? = nil
    var onAwaiting: ((String) -> Void)? = nil
    var onCancel: ((String) -> Void)? = nil

    private var statusBgColor: Color {
        switch booking.status {
        case "confirmed": return Color(red: 0.94, green: 0.99, blue: 0.94)
        case "cancelled": return Color(red: 0.99, green: 0.93, blue: 0.93)
        case "seated": return Color(red: 0.99, green: 0.96, blue: 0.88)
        case "completed": return Color(red: 0.92, green: 0.98, blue: 0.96)
        default: return Color(red: 0.99, green: 0.96, blue: 0.88)
        }
    }

    private var statusTextColor: Color {
        switch booking.status {
        case "confirmed": return Color(red: 0.1, green: 0.5, blue: 0.2)
        case "cancelled": return Color(red: 0.7, green: 0.15, blue: 0.15)
        case "seated": return Color(red: 0.6, green: 0.4, blue: 0.1)
        case "completed": return Color(red: 0.1, green: 0.4, blue: 0.3)
        default: return Color(red: 0.6, green: 0.4, blue: 0.1)
        }
    }

    private var statusLabel: String {
        switch booking.status {
        case "pending": return "Awaiting"
        case "confirmed": return "Confirmed"
        case "seated": return "Seated"
        case "completed": return "Complete"
        case "cancelled": return "Cancelled"
        case "no_show": return "No-Show"
        default: return booking.status.capitalized
        }
    }

    private var statusIcon: String {
        switch booking.status {
        case "confirmed": return "checkmark.circle.fill"
        case "cancelled": return "xmark.circle.fill"
        case "seated": return "person.2.fill"
        case "completed": return "checkmark.circle.fill"
        default: return "clock.fill"
        }
    }

    private var sessionLabel: String {
        switch booking.sessionType {
        case "painting": return "Painting"
        case "birthday-party": return "Birthday Party"
        case "baby-shower-hen": return "Baby Shower / Hen"
        case "clay-imprints": return "Baby Prints"
        case "corporate": return "Corporate"
        case "exclusive-hire": return "Exclusive Hire"
        default: return booking.sessionType ?? "—"
        }
    }

    private var sessionBadgeColors: (bg: Color, text: Color) {
        switch booking.sessionType {
        case "painting": return (PPBrand.paintingBadgeBg, PPBrand.paintingBadgeText)
        case "birthday-party": return (Color(red: 1.0, green: 0.88, blue: 0.93), Color(red: 0.7, green: 0.1, blue: 0.4))
        case "baby-shower-hen": return (Color(red: 0.92, green: 0.88, blue: 0.97), Color(red: 0.4, green: 0.2, blue: 0.6))
        case "clay-imprints": return (Color(red: 1.0, green: 0.92, blue: 0.82), Color(red: 0.7, green: 0.4, blue: 0.1))
        case "corporate": return (Color(red: 0.9, green: 0.9, blue: 0.95), Color(red: 0.2, green: 0.2, blue: 0.3))
        case "exclusive-hire": return (Color(red: 0.88, green: 0.9, blue: 0.98), Color(red: 0.2, green: 0.2, blue: 0.6))
        default: return (Color.gray.opacity(0.15), Color.gray)
        }
    }

    private var formattedDate: String {
        guard let d = sharedDateFormatter.date(from: booking.date) else { return booking.date }
        let f = DateFormatter()
        f.dateFormat = "dd MMM yyyy"
        return f.string(from: d)
    }

    private var formattedAdded: String {
        guard let added = booking.createdAt else { return "—" }
        let formats = [
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ssXXXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd"
        ]
        for format in formats {
            let f = DateFormatter()
            f.dateFormat = format
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(secondsFromGMT: 0)
            if let d = f.date(from: added) {
                let out = DateFormatter()
                out.dateFormat = "dd MMM yyyy, HH:mm"
                out.timeZone = TimeZone.current
                return out.string(from: d)
            }
        }
        return added
    }

    var body: some View {
        HStack(spacing: 0) {
            // Checkbox column
            Button {
                onToggleSelect?(booking.id)
            } label: {
                Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                    .font(AppFont.body(12, weight: .bold))
                    .foregroundStyle(isSelected ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.3))
            }
            .buttonStyle(.plain)
            .frame(width: 40, alignment: .center)
            .padding(.horizontal, 4)

            Divider().frame(height: 32)

            // Added column
            VStack(alignment: .leading, spacing: 1) {
                Text(formattedAdded)
                    .font(AppFont.body(11, weight: .black))
                    .foregroundStyle(PPBrand.charcoal)
                Text(booking.studio)
                    .font(AppFont.body(10, weight: .semibold))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)

            Divider().frame(height: 32)

            // Date column
            VStack(alignment: .leading, spacing: 1) {
                Text(formattedDate)
                    .font(AppFont.body(11, weight: .black))
                    .foregroundStyle(PPBrand.charcoal)
                Text(booking.time)
                    .font(AppFont.body(10, weight: .regular))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)

            Divider().frame(height: 32)

            // Guest column
            VStack(alignment: .leading, spacing: 1) {
                Text(booking.name)
                    .font(AppFont.body(11, weight: .black))
                    .foregroundStyle(PPBrand.charcoal)
                    .lineLimit(1)
                if let email = booking.email, !email.isEmpty {
                    Text(email)
                        .font(AppFont.body(9, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .lineLimit(1)
                }
                if let phone = booking.phone, !phone.isEmpty {
                    Text(phone)
                        .font(AppFont.body(10, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
                HStack(spacing: 4) {
                    HStack(spacing: 2) {
                        Image(systemName: "person.2.fill")
                            .font(AppFont.body(8, weight: .bold))
                        Text("\(booking.paintersCount)")
                            .font(AppFont.body(10, weight: .black))
                    }
                    .foregroundStyle(PPBrand.charcoal)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(PPBrand.clay100)
                    .clipShape(Capsule())
                    if booking.source == "walk-in" {
                        Text("Walk-in")
                            .font(AppFont.body(9, weight: .bold))
                            .foregroundStyle(Color(red: 0.5, green: 0.3, blue: 0.7))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Color(red: 0.92, green: 0.88, blue: 0.96))
                            .clipShape(Capsule())
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)

            Divider().frame(height: 32)

            // Session column
            VStack(alignment: .leading, spacing: 4) {
                let colors = sessionBadgeColors
                Text(sessionLabel)
                    .font(AppFont.body(10, weight: .bold))
                    .foregroundStyle(colors.text)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(colors.bg)
                    .clipShape(Capsule())
                if let photos = booking.photos, !photos.isEmpty {
                    HStack(spacing: 3) {
                        ForEach(photos.prefix(3).indices, id: \.self) { i in
                            if let url = URL(string: photos[i]) {
                                CachedAsyncImage(url: url, contentMode: .fill)
                                    .frame(width: 32, height: 32)
                                    .clipShape(RoundedRectangle(cornerRadius: 5))
                                    .overlay(RoundedRectangle(cornerRadius: 5).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1))
                            }
                        }
                        if photos.count > 3 {
                            Text("+\(photos.count - 3)")
                                .font(AppFont.body(9, weight: .black))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                                .frame(width: 32, height: 32)
                                .background(PPBrand.clay100)
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)

            Divider().frame(height: 32)

            // Status column
            HStack(spacing: 3) {
                Image(systemName: statusIcon)
                    .font(AppFont.body(9, weight: .bold))
                Text(statusLabel)
                    .font(AppFont.body(10, weight: .black))
                    .textCase(.uppercase)
                    .tracking(0.5)
            }
            .foregroundStyle(statusTextColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusBgColor)
            .clipShape(Capsule())
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)

            Divider().frame(height: 32)

            // Table column
            Group {
                if let tableId = booking.tableId, !tableId.isEmpty {
                    Text(tableId)
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(PPBrand.sage)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                } else {
                    Text("Assign")
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(Color(red: 0.6, green: 0.4, blue: 0.1))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(red: 0.99, green: 0.96, blue: 0.88))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(red: 0.9, green: 0.8, blue: 0.5), lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
            .frame(width: 70, alignment: .leading)
            .padding(.horizontal, 8)

            Divider().frame(height: 32)

            // Actions column (small icon buttons like web desktop)
            HStack(spacing: 6) {
                if canUpdateStatus && booking.status != "confirmed" && booking.status != "cancelled" {
                    Button {
                        onConfirm?(booking.id)
                    } label: {
                        Image(systemName: "checkmark.circle.fill")
                            .font(AppFont.body(12, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(6)
                            .background(Color(red: 0.05, green: 0.6, blue: 0.3))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                }
                if canUpdateStatus && booking.status == "confirmed" {
                    Button {
                        onAwaiting?(booking.id)
                    } label: {
                        Image(systemName: "clock")
                            .font(AppFont.body(12, weight: .bold))
                            .foregroundStyle(Color(red: 0.6, green: 0.4, blue: 0.1))
                            .padding(6)
                            .background(Color(red: 0.99, green: 0.96, blue: 0.88))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(red: 0.9, green: 0.8, blue: 0.5), lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                }
                if canUpdateStatus && booking.status != "cancelled" {
                    Button {
                        onCancel?(booking.id)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(AppFont.body(12, weight: .bold))
                            .foregroundStyle(Color(red: 0.7, green: 0.2, blue: 0.2))
                            .padding(6)
                            .background(Color(red: 0.99, green: 0.93, blue: 0.93))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(red: 0.95, green: 0.75, blue: 0.75), lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                }
                // ⋯ button to open detail (matching web)
                Button {
                    onTap()
                } label: {
                    Image(systemName: "ellipsis")
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .padding(6)
                }
                .buttonStyle(.plain)
            }
            .frame(width: 90, alignment: .center)
            .padding(.horizontal, 8)
        }
        .padding(.vertical, 10)
        .background(isSelected ? PPBrand.clay100.opacity(0.5) : Color.white)
        .overlay(
            Rectangle()
                .fill(PPBrand.charcoal.opacity(0.08))
                .frame(height: 1),
            alignment: .bottom
        )
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }
}

struct LegendDot: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label)
                .font(AppFont.body(9, weight: .bold))
                .foregroundStyle(PPBrand.charcoal.opacity(0.6))
        }
    }
}

// MARK: - Day Dashboard (matches web DayDashboard with 4 kanban columns)

struct DayDashboardView: View {
    let date: String
    let bookings: [Booking]
    let onBack: () -> Void
    let onUpdateStatus: (String, BookingStatus) -> Void
    let canUpdateStatus: Bool
    let bookingsVM: BookingsViewModel
    let authVM: AuthViewModel
    let toastManager: ToastManager

    @State private var selectedBooking: Booking? = nil
    @State private var photoBooking: Booking? = nil
    @State private var showingGhostBooking = false
    @State private var cancelTarget: Booking? = nil

    private var staffStudio: String? {
        guard let studios = authVM.staff?.allowedStudios, studios.count == 1 else { return nil }
        return studios[0]
    }

    private var dayBookings: [Booking] {
        bookings.filter { $0.date == date && $0.status != "cancelled" }.sorted { $0.time < $1.time }
    }

    private var bookingsColumn: [Booking] {
        dayBookings.filter { $0.status == "pending" || $0.status == "confirmed" }
    }

    private var seatedColumn: [Booking] {
        dayBookings.filter { $0.status == "seated" }
    }

    private var completeColumn: [Booking] {
        dayBookings.filter { $0.status == "completed" }
    }

    private var noshowColumn: [Booking] {
        dayBookings.filter { $0.status == "no_show" }
    }

    private var totalSeats: Int {
        dayBookings.filter { $0.status != "no_show" }.reduce(0) { $0 + $1.paintersCount }
    }

    var body: some View {
        VStack(spacing: 16) {
            // Back button + date header
            HStack(spacing: 12) {
                Button {
                    onBack()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(AppFont.body(12, weight: .bold))
                        Text("Calendar")
                            .font(AppFont.body(12, weight: .bold))
                    }
                    .foregroundStyle(PPBrand.charcoal)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .webCard()
                }
                Text(formatDate(date))
                    .font(AppFont.heading(18))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(PPBrand.charcoal)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Spacer()
            }

            // Stat bubbles
            HStack(spacing: 8) {
                StatBubble(label: "Bookings", value: dayBookings.filter { $0.status != "no_show" }.count, color: .slate)
                StatBubble(label: "Seats", value: totalSeats, color: .slate)
                StatBubble(label: "Seated", value: seatedColumn.count, color: .amber)
                StatBubble(label: "Complete", value: completeColumn.count, color: .green)
                StatBubble(label: "No-Show", value: noshowColumn.count, color: .red)
            }

            // 4-column kanban (horizontal like web)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    KanbanColumn(
                        title: "Bookings",
                        count: bookingsColumn.count,
                        bookings: bookingsColumn,
                        columnType: .bookings,
                        canUpdate: canUpdateStatus,
                        onMove: handleMove,
                        onNoShow: handleNoShow,
                        onCancel: { id in cancelTarget = bookings.first(where: { $0.id == id }) },
                        onTap: { selectedBooking = $0 },
                        onAddPhoto: { photoBooking = $0 },
                        staffStudio: staffStudio
                    )
                    .frame(width: 280)

                    KanbanColumn(
                        title: "Seated",
                        count: seatedColumn.count,
                        bookings: seatedColumn,
                        columnType: .seated,
                        canUpdate: canUpdateStatus,
                        onMove: handleMove,
                        onNoShow: nil,
                        onTap: { selectedBooking = $0 },
                        onAddPhoto: { photoBooking = $0 },
                        staffStudio: staffStudio
                    )
                    .frame(width: 280)

                    KanbanColumn(
                        title: "Complete",
                        count: completeColumn.count,
                        bookings: completeColumn,
                        columnType: .complete,
                        canUpdate: canUpdateStatus,
                        onMove: handleMove,
                        onNoShow: nil,
                        onTap: { selectedBooking = $0 },
                        onAddPhoto: { photoBooking = $0 },
                        staffStudio: staffStudio
                    )
                    .frame(width: 280)
                }
                .padding(.bottom, 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
        .sheet(item: $selectedBooking) { booking in
            NavigationStack {
                BookingDetailView(booking: booking)
                    .environmentObject(bookingsVM)
                    .environmentObject(authVM)
                    .environmentObject(toastManager)
            }
        }
        .sheet(item: $photoBooking) { booking in
            CameraPicker { data in
                uploadPhoto(data, for: booking)
            }
        }
        .confirmationDialog(
            "Cancel \(cancelTarget?.name ?? "")'s booking?",
            isPresented: Binding(
                get: { cancelTarget != nil },
                set: { if !$0 { cancelTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Cancel Booking", role: .destructive) { handleCancelConfirm() }
            Button("Keep Booking", role: .cancel) { cancelTarget = nil }
        } message: {
            Text("The customer will be marked as cancelled and the slot freed up.")
        }
    }

    private func uploadPhoto(_ data: Data, for booking: Booking) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                let url = try await APIClient.shared.uploadPhoto(
                    imageData: data,
                    fileName: "photo_\(Int(Date().timeIntervalSince1970)).jpg",
                    bookingId: booking.id,
                    staff: staff
                )
                if let urlObject = URL(string: url), let image = UIImage(data: data) {
                    CachedAsyncImage.prefetch(url: urlObject, image: image)
                }
                var updated = booking
                var photos = updated.photos ?? []
                photos.append(url)
                updated.photos = photos
                try await APIClient.shared.updateBooking(updated, staff: staff)
                await MainActor.run {
                    bookingsVM.updateBookingLocally(updated)
                    photoBooking = nil
                    Haptics.success()
                }
            } catch {
                await MainActor.run {
                    Haptics.error()
                    toastManager.show("Photo upload failed", type: .error)
                }
            }
        }
    }

    private func handleMove(id: String, direction: String) {
        guard let booking = bookings.first(where: { $0.id == id }) else { return }
        let status = booking.bookingStatus ?? .pending
        if direction == "forward" {
            if status == .pending || status == .confirmed {
                onUpdateStatus(id, .seated)
            } else if status == .seated {
                onUpdateStatus(id, .completed)
            }
        } else {
            if status == .seated {
                onUpdateStatus(id, .confirmed)
            } else if status == .completed {
                onUpdateStatus(id, .seated)
            } else if status == .noShow {
                onUpdateStatus(id, .confirmed)
            }
        }
    }

    private func handleNoShow(id: String) {
        onUpdateStatus(id, .noShow)
    }

    private func handleCancelConfirm() {
        guard let b = cancelTarget else { return }
        onUpdateStatus(b.id, .cancelled)
        cancelTarget = nil
    }

    private func formatDate(_ s: String) -> String {
        PPDateDisplay.date(s)
    }
}

// MARK: - Kanban Column

enum KanbanColumnType {
    case bookings, seated, complete, noshow

    var bgColor: Color {
        switch self {
        case .bookings: return Color(red: 0.98, green: 0.94, blue: 0.94)
        case .seated: return Color(red: 0.98, green: 0.96, blue: 0.88)
        case .complete: return Color(red: 0.94, green: 0.98, blue: 0.94)
        case .noshow: return Color(red: 0.96, green: 0.95, blue: 0.93)
        }
    }

    var borderColor: Color {
        switch self {
        case .bookings: return Color.red.opacity(0.25)
        case .seated: return Color.orange.opacity(0.25)
        case .complete: return Color.green.opacity(0.25)
        case .noshow: return Color.gray.opacity(0.3)
        }
    }

    var headerColor: Color {
        switch self {
        case .bookings: return Color(red: 0.7, green: 0.2, blue: 0.2)
        case .seated: return Color(red: 0.6, green: 0.4, blue: 0.1)
        case .complete: return Color(red: 0.1, green: 0.5, blue: 0.2)
        case .noshow: return Color.gray
        }
    }
}

struct KanbanColumn: View {
    let title: String
    let count: Int
    let bookings: [Booking]
    let columnType: KanbanColumnType
    let canUpdate: Bool
    let onMove: (String, String) -> Void
    let onNoShow: ((String) -> Void)?
    var onCancel: ((String) -> Void)? = nil
    let onTap: (Booking) -> Void
    let onAddPhoto: (Booking) -> Void
    var staffStudio: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(AppFont.heading(13))
                    .foregroundStyle(columnType.headerColor)
                    .textCase(.uppercase)
                    .tracking(1)
                Spacer()
                Text("\(count)")
                    .font(AppFont.heading(10))
                    .foregroundStyle(columnType.headerColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(columnType.headerColor.opacity(0.15))
                    .clipShape(Capsule())
            }

            if bookings.isEmpty {
                Text(emptyMessage)
                    .font(AppFont.body(12, weight: .medium))
                    .foregroundStyle(columnType.headerColor.opacity(0.4))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
            } else {
                ForEach(bookings) { booking in
                    KanbanBookingCard(
                        booking: booking,
                        columnType: columnType,
                        canUpdate: canUpdate,
                        onMove: onMove,
                        onNoShow: onNoShow,
                        onCancel: onCancel,
                        onTap: { onTap(booking) },
                        onAddPhoto: onAddPhoto,
                        staffStudio: staffStudio
                    )
                }
            }
        }
        .padding(12)
        .background(columnType.bgColor)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(columnType.borderColor, lineWidth: 1)
        )
    }

    private var emptyMessage: String {
        switch columnType {
        case .bookings: return "No bookings waiting"
        case .seated: return "No one seated yet"
        case .complete: return "Nothing completed yet"
        case .noshow: return "No no-shows"
        }
    }
}

// MARK: - Kanban Booking Card

struct KanbanBookingCard: View {
    let booking: Booking
    let columnType: KanbanColumnType
    let canUpdate: Bool
    let onMove: (String, String) -> Void
    let onNoShow: ((String) -> Void)?
    var onCancel: ((String) -> Void)? = nil
    let onTap: () -> Void
    let onAddPhoto: (Booking) -> Void
    var staffStudio: String? = nil

    private var sessionLabel: String? {
        switch booking.sessionType {
        case "painting": return nil
        case "birthday-party": return "Party"
        case "baby-shower-hen": return "Shower/Hen"
        case "clay-imprints": return "Baby Prints"
        case "corporate": return "Corporate"
        case "exclusive-hire": return "Exclusive Hire"
        default: return nil
        }
    }

    private var locationTagSummary: String? {
        guard let tags = booking.photoTags, !tags.isEmpty else { return nil }
        var locations: [String] = []
        for (_, photoTags) in tags {
            for tag in photoTags {
                if tag.status == "location", let label = tag.label, !label.isEmpty {
                    if !locations.contains(label) {
                        locations.append(label)
                    }
                }
            }
        }
        return locations.isEmpty ? nil : locations.joined(separator: ", ")
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                // Photos with tag badges (like web collections)
                if let photos = booking.photos, !photos.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(photos.indices, id: \.self) { i in
                                if let url = URL(string: photos[i]) {
                                    ZStack {
                                        CachedAsyncImage(url: url, contentMode: .fill)
                                            .frame(width: 56, height: 56)
                                            .clipShape(RoundedRectangle(cornerRadius: 6))
                                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1))

                                        // Tag badges overlay
                                        let photoTags = (booking.photoTags?[String(i)] ?? []).filter { $0.status != "location" }
                                        if !photoTags.isEmpty {
                                            ForEach(photoTags) { tag in
                                                PhotoTagBadge(tag: tag, canRemove: false) {}
                                                    .position(
                                                        x: CGFloat(tag.x) / 100 * 56,
                                                        y: CGFloat(tag.y) / 100 * 56
                                                    )
                                            }
                                        }
                                    }
                                    .frame(width: 56, height: 56)
                                }
                            }
                        }
                    }
                    .frame(height: 56)
                }

                Button {
                    onAddPhoto(booking)
                } label: {
                    Label("Add Photo", systemImage: "camera.fill")
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(PPBrand.sage)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)

                Text(booking.name)
                    .font(AppFont.heading(14))
                    .foregroundStyle(PPBrand.charcoal)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Image(systemName: "person.2.fill")
                        .font(AppFont.body(9))
                    Text("\(booking.paintersCount)")
                        .font(AppFont.body(10, weight: .bold))
                    Text("·")
                        .font(AppFont.body(10))
                    Image(systemName: "clock.fill")
                        .font(AppFont.body(9))
                    Text(PPDateDisplay.time(booking.time))
                        .font(AppFont.body(10, weight: .bold))
                    if staffStudio == nil || staffStudio != booking.studio {
                        Text("·")
                            .font(AppFont.body(10))
                        Text(booking.studio)
                            .font(AppFont.body(10, weight: .bold))
                    }
                }
                .foregroundStyle(PPBrand.charcoal.opacity(0.6))

                if booking.sessionType != "painting" {
                    SessionTypeBadge(sessionType: booking.sessionType)
                }

                // Location tags summary (like web collections)
                if let tagSummary = locationTagSummary {
                    HStack(spacing: 4) {
                        Image(systemName: "mappin.circle.fill")
                            .font(AppFont.body(10))
                            .foregroundStyle(Color.orange)
                        Text(tagSummary)
                            .font(AppFont.body(10, weight: .bold))
                            .foregroundStyle(PPBrand.charcoal)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.orange.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                if canUpdate {
                    HStack(spacing: 6) {
                        if columnType != .bookings {
                            Button {
                                onMove(booking.id, "back")
                            } label: {
                                HStack(spacing: 2) {
                                    Image(systemName: "chevron.left")
                                        .font(AppFont.body(9, weight: .bold))
                                    Text("Back")
                                        .font(AppFont.body(9, weight: .bold))
                                        .textCase(.uppercase)
                                        .tracking(1)
                                }
                                .foregroundStyle(PPBrand.charcoal)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.white.opacity(0.8))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                                )
                            }
                            .buttonStyle(.plain)
                        }

                        if columnType == .bookings && onNoShow != nil {
                            Button {
                                onNoShow?(booking.id)
                            } label: {
                                HStack(spacing: 2) {
                                    Image(systemName: "xmark")
                                        .font(AppFont.body(9, weight: .bold))
                                    Text("No-Show")
                                        .font(AppFont.body(9, weight: .bold))
                                        .textCase(.uppercase)
                                        .tracking(1)
                                }
                                .foregroundStyle(Color.gray)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.gray.opacity(0.15))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }

                        if columnType == .bookings && onCancel != nil {
                            Button {
                                onCancel?(booking.id)
                            } label: {
                                HStack(spacing: 2) {
                                    Image(systemName: "xmark")
                                        .font(AppFont.body(9, weight: .bold))
                                    Text("Cancel")
                                        .font(AppFont.body(9, weight: .bold))
                                        .textCase(.uppercase)
                                        .tracking(1)
                                }
                                .foregroundStyle(Color.red)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.red.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6)
                                        .stroke(Color.red.opacity(0.3), lineWidth: 1)
                                )
                            }
                            .buttonStyle(.plain)
                        }

                        if columnType != .complete && columnType != .noshow {
                            Button {
                                onMove(booking.id, "forward")
                            } label: {
                                HStack(spacing: 2) {
                                    Text(columnType == .bookings ? "Seat" : "Complete")
                                        .font(AppFont.body(9, weight: .bold))
                                        .textCase(.uppercase)
                                        .tracking(1)
                                    Image(systemName: "chevron.right")
                                        .font(AppFont.body(9, weight: .bold))
                                }
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(columnType == .bookings ? Color.orange : Color.green)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(columnType.borderColor, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Stat Bubble

struct StatBubble: View {
    let label: String
    let value: Int
    let color: BubbleColor

    enum BubbleColor {
        case slate, amber, green, red

        var bg: Color {
            switch self {
            case .slate: return PPBrand.charcoal.opacity(0.04)
            case .amber: return Color.orange.opacity(0.08)
            case .green: return Color.green.opacity(0.08)
            case .red: return Color.red.opacity(0.08)
            }
        }

        var border: Color {
            switch self {
            case .slate: return PPBrand.charcoal.opacity(0.1)
            case .amber: return Color.orange.opacity(0.2)
            case .green: return Color.green.opacity(0.2)
            case .red: return Color.red.opacity(0.2)
            }
        }

        var text: Color {
            switch self {
            case .slate: return PPBrand.charcoal
            case .amber: return Color(red: 0.6, green: 0.4, blue: 0.1)
            case .green: return Color(red: 0.1, green: 0.5, blue: 0.2)
            case .red: return Color(red: 0.6, green: 0.2, blue: 0.2)
            }
        }
    }

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(AppFont.heading(22))
                .foregroundStyle(color.text)
            Text(label)
                .font(AppFont.body(9, weight: .bold))
                .foregroundStyle(color.text.opacity(0.7))
                .textCase(.uppercase)
                .tracking(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(color.bg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(color.border, lineWidth: 1)
        )
    }
}
