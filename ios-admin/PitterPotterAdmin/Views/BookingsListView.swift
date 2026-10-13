import SwiftUI

struct BookingsListView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var toastManager: ToastManager
    @State private var showingFilters = false
    @State private var showingNewWalkIn = false
    @State private var showingGhostBooking = false
    @State private var bookingToDelete: Booking?
    @State private var bookingToShare: Booking?
    @State private var showingBulkActions = false
    @State private var showingPartyBooking = false
    @State private var showingNewBooking = false
    @State private var showingNewBabyPrint = false
    @State private var showingGiftCardScanner = false
    @State private var showingBulkDelete = false
    @State private var recentSearches: [String] = UserDefaults.standard.stringArray(forKey: "pp_recent_searches") ?? []

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(AppFont.body(15, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                    TextField("Search name, email, phone...", text: $bookingsVM.searchText)
                        .textInputAutocapitalization(.never)
                        .font(AppFont.body(15))
                        .foregroundStyle(PPBrand.charcoal)
                    if !bookingsVM.searchText.isEmpty {
                        Button {
                            bookingsVM.searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(AppFont.body(16))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                        }
                    }
                }
                .padding(12)
                .background(PPBrand.charcoal.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                )
                .padding(.horizontal, 16)
                .padding(.top, 8)

                // Session type tabs
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        SessionTabButton(title: "All", count: bookingsVM.visibleBookings.count, isSelected: bookingsVM.selectedSessionType == nil) {
                            bookingsVM.selectedSessionType = nil
                        }
                        SessionTabButton(title: "Painting", count: bookingsVM.visibleBookings.filter { $0.sessionType == "painting" }.count, isSelected: bookingsVM.selectedSessionType == "painting") {
                            bookingsVM.selectedSessionType = "painting"
                        }
                        SessionTabButton(title: "Baby Prints", count: bookingsVM.visibleBookings.filter { $0.sessionType == "clay-imprints" }.count, isSelected: bookingsVM.selectedSessionType == "clay-imprints") {
                            bookingsVM.selectedSessionType = "clay-imprints"
                        }
                        SessionTabButton(title: "Party", count: bookingsVM.visibleBookings.filter { $0.sessionType == "birthday-party" }.count, isSelected: bookingsVM.selectedSessionType == "birthday-party") {
                            bookingsVM.selectedSessionType = "birthday-party"
                        }
                        SessionTabButton(title: "Shower/Hen", count: bookingsVM.visibleBookings.filter { $0.sessionType == "baby-shower-hen" }.count, isSelected: bookingsVM.selectedSessionType == "baby-shower-hen") {
                            bookingsVM.selectedSessionType = "baby-shower-hen"
                        }
                        SessionTabButton(title: "Corporate", count: bookingsVM.visibleBookings.filter { $0.sessionType == "corporate" }.count, isSelected: bookingsVM.selectedSessionType == "corporate") {
                            bookingsVM.selectedSessionType = "corporate"
                        }
                        SessionTabButton(title: "Exclusive", count: bookingsVM.visibleBookings.filter { $0.sessionType == "exclusive-hire" }.count, isSelected: bookingsVM.selectedSessionType == "exclusive-hire") {
                            bookingsVM.selectedSessionType = "exclusive-hire"
                        }
                        SessionTabButton(title: "Sip & Paint", count: bookingsVM.visibleBookings.filter { $0.sessionType == "sip-and-paint" }.count, isSelected: bookingsVM.selectedSessionType == "sip-and-paint") {
                            bookingsVM.selectedSessionType = "sip-and-paint"
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.top, 8)
                if hasActiveFilters {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            if bookingsVM.showTodayOnly {
                                FilterChip(text: "Today", icon: "sun.max.fill") { bookingsVM.showTodayOnly = false }
                            }
                            if let studio = bookingsVM.selectedStudio {
                                FilterChip(text: studio.rawValue, icon: "building.2.fill") { bookingsVM.selectedStudio = nil }
                            }
                            if let status = bookingsVM.selectedStatus {
                                FilterChip(text: status.label, icon: "circle.fill") { bookingsVM.selectedStatus = nil }
                            }
                            if bookingsVM.dateRangeStart != nil {
                                FilterChip(text: "From", icon: "calendar") { bookingsVM.dateRangeStart = nil }
                            }
                            if bookingsVM.dateRangeEnd != nil {
                                FilterChip(text: "To", icon: "calendar") { bookingsVM.dateRangeEnd = nil }
                            }
                            if bookingsVM.selectedDate != nil {
                                FilterChip(text: "Date", icon: "calendar.badge.clock") { bookingsVM.selectedDate = nil }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .padding(.top, 8)
                }

                // Offline banner
                if bookingsVM.isOffline {
                    HStack(spacing: 6) {
                        Image(systemName: "wifi.slash")
                            .font(AppFont.body(13, weight: .medium))
                        Text("Offline — showing cached data")
                            .font(AppFont.body(13, weight: .medium))
                    }
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                    .background(.orange.opacity(0.1))
                    .clipShape(Capsule())
                    .padding(.top, 4)
                }

                // Bookings list
                if bookingsVM.isLoading {
                    Spacer()
                    ProgressView("Loading bookings...")
                } else if let error = bookingsVM.error {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.orange)
                        Text(error)
                            .font(AppFont.body(15, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        Button("Retry") {
                            if let staff = authVM.staff {
                                Task { await bookingsVM.loadBookings(staff: staff) }
                            }
                        }
                    }
                } else if bookingsVM.filteredBookings.isEmpty {
                    Spacer()
                    EmptyStateView(
                        icon: "calendar.badge.exclamationmark",
                        title: "No bookings found",
                        subtitle: bookingsVM.searchText.isEmpty ? "Try adjusting your filters" : "Try a different search term",
                        actionTitle: "Clear filters",
                        action: {
                            bookingsVM.searchText = ""
                            bookingsVM.selectedStudio = nil
                            bookingsVM.selectedStatus = nil
                            bookingsVM.selectedDate = nil
                            bookingsVM.showTodayOnly = false
                            bookingsVM.dateRangeStart = nil
                            bookingsVM.dateRangeEnd = nil
                        }
                    )
                } else {
                    List {
                        if bookingsVM.isBulkSelectMode {
                            ForEach(bookingsVM.filteredBookings) { booking in
                                HStack {
                                    Image(systemName: bookingsVM.selectedBookingIds.contains(booking.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(bookingsVM.selectedBookingIds.contains(booking.id) ? PPBrand.charcoal : .secondary)
                                    BookingRowView(booking: booking)
                                }
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    bookingsVM.toggleSelection(booking.id)
                                }
                            }
                        } else {
                            ForEach(bookingsVM.filteredBookings) { booking in
                                NavigationLink(value: booking) {
                                    BookingRowView(booking: booking)
                                }
                                .swipeActions(edge: .trailing) {
                                    if authVM.staff?.canUpdateStatus == true && booking.status != "confirmed" {
                                        Button {
                                            if let staff = authVM.staff {
                                                Task { await bookingsVM.optimisticUpdateStatus(booking: booking, status: .confirmed, staff: staff) }
                                            }
                                        } label: {
                                            Label("Confirm", systemImage: "checkmark.circle.fill")
                                        }
                                        .tint(.green)
                                    }
                                    if authVM.staff?.canUpdateStatus == true && booking.status != "cancelled" {
                                        Button(role: .destructive) {
                                            if let staff = authVM.staff {
                                                Task { await bookingsVM.optimisticUpdateStatus(booking: booking, status: .cancelled, staff: staff) }
                                            }
                                        } label: {
                                            Label("Cancel", systemImage: "xmark.circle")
                                        }
                                    }
                                    if authVM.staff?.canDeleteBookings == true {
                                        Button(role: .destructive) {
                                            bookingToDelete = booking
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                    Button {
                                        bookingToShare = booking
                                    } label: {
                                        Label("Share", systemImage: "square.and.arrow.up")
                                    }
                                    .tint(.blue)
                                }
                                .swipeActions(edge: .leading) {
                                    if authVM.staff?.canEditBookings == true {
                                        NavigationLink(value: booking) {
                                            Label("Edit", systemImage: "pencil")
                                        }
                                        .tint(.blue)
                                    }
                                    if authVM.staff?.canUpdateStatus == true && booking.status == "confirmed" {
                                        Button {
                                            if let staff = authVM.staff {
                                                Task { await bookingsVM.optimisticUpdateStatus(booking: booking, status: .seated, staff: staff) }
                                            }
                                        } label: {
                                            Label("Seated", systemImage: "person.2.fill")
                                        }
                                        .tint(.orange)
                                    }
                                }
                                .contextMenu {
                                    if authVM.staff?.canUpdateStatus == true {
                                        ForEach(BookingStatus.allCases, id: \.self) { status in
                                            Button(status.label) {
                                                if let staff = authVM.staff {
                                                    Task { await bookingsVM.optimisticUpdateStatus(booking: booking, status: status, staff: staff) }
                                                }
                                            }
                                        }
                                    }
                                    Button {
                                        bookingToShare = booking
                                    } label: {
                                        Label("Share", systemImage: "square.and.arrow.up")
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable {
                        if let staff = authVM.staff {
                            await bookingsVM.loadBookings(staff: staff)
                        }
                    }
                }

                Spacer()
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Bookings")
                        .font(AppFont.heading(17))
                        .foregroundStyle(PPBrand.charcoal)
                        .textCase(.uppercase)
                        .tracking(1)
                }
                ToolbarItem(placement: .topBarLeading) {
                    HStack {
                        Button {
                            bookingsVM.showTodayOnly.toggle()
                        } label: {
                            Image(systemName: bookingsVM.showTodayOnly ? "sun.max.fill" : "sun.max")
                                .foregroundStyle(bookingsVM.showTodayOnly ? PPBrand.charcoal : .primary)
                        }
                        if authVM.staff?.canUpdateStatus == true {
                            Button {
                                bookingsVM.isBulkSelectMode.toggle()
                                if !bookingsVM.isBulkSelectMode {
                                    bookingsVM.selectedBookingIds.removeAll()
                                }
                            } label: {
                                Image(systemName: bookingsVM.isBulkSelectMode ? "checkmark.circle.fill" : "checklist")
                                    .foregroundStyle(bookingsVM.isBulkSelectMode ? PPBrand.charcoal : .primary)
                            }
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack {
                        if bookingsVM.isBulkSelectMode && !bookingsVM.selectedBookingIds.isEmpty {
                            Button {
                                showingBulkActions = true
                            } label: {
                                Text("\(bookingsVM.selectedBookingIds.count)")
                                    .font(AppFont.body(17, weight: .semibold))
                                    .foregroundStyle(PPBrand.charcoal)
                            }
                        }
                        if !bookingsVM.isBulkSelectMode {
                            Menu {
                                Button {
                                    showingNewWalkIn = true
                                } label: {
                                    Label("Walk-in", systemImage: "person.walk")
                                }
                                Button {
                                    showingNewBooking = true
                                } label: {
                                    Label("New Booking", systemImage: "person.2.fill")
                                }
                                Button {
                                    showingPartyBooking = true
                                } label: {
                                    Label("New Party", systemImage: "birthday.cake.fill")
                                }
                                Button {
                                    showingNewBabyPrint = true
                                } label: {
                                    Label("New Baby Print", systemImage: "figure.and.child.holdinghands")
                                }
                                Button {
                                    showingGhostBooking = true
                                } label: {
                                    Label("Quick Walk-in (Ghost)", systemImage: "person.fill.questionmark")
                                }
                                Divider()
                                Button {
                                    showingGiftCardScanner = true
                                } label: {
                                    Label("Scan Gift Card", systemImage: "giftcard")
                                }
                                if authVM.staff?.role == "super_admin" {
                                    Button {
                                        CSVExporter.exportBookings(bookingsVM.bookings)
                                    } label: {
                                        Label("Export CSV", systemImage: "square.and.arrow.up")
                                    }
                                }
                            } label: {
                                Image(systemName: "plus")
                            }
                        }
                        if !bookingsVM.isBulkSelectMode {
                            Button {
                                showingFilters = true
                            } label: {
                                Image(systemName: "line.3.horizontal.decrease.circle")
                            }
                        }
                    }
                }
            }
            .navigationDestination(for: Booking.self) { booking in
                BookingDetailView(booking: booking)
                    .environmentObject(bookingsVM)
                    .environmentObject(authVM)
                    .environmentObject(toastManager)
            }
            .sheet(isPresented: $showingFilters) {
                FiltersView()
                    .environmentObject(bookingsVM)
                    .presentationDetents([.medium])
            }
            .onTapGesture {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
            .onChange(of: bookingsVM.searchText) { newValue in
                if !newValue.isEmpty && newValue.count > 2 {
                    if !recentSearches.contains(newValue) {
                        recentSearches.insert(newValue, at: 0)
                        if recentSearches.count > 10 { recentSearches.removeLast() }
                        UserDefaults.standard.set(recentSearches, forKey: "pp_recent_searches")
                    }
                }
            }
            .onAppear {
                guard let staff = authVM.staff else { return }
                Task {
                    await bookingsVM.loadBookings(staff: staff)
                    bookingsVM.startRealtime(staff: staff)
                }
            }
            .onDisappear {
                bookingsVM.stopRealtime()
            }
            .sheet(isPresented: $showingNewWalkIn) {
                NewWalkInView()
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showingGhostBooking) {
                GhostBookingView()
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showingPartyBooking) {
                PartyBookingView()
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showingNewBooking) {
                NewWalkInView(initialSessionType: .painting)
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showingNewBabyPrint) {
                NewWalkInView(initialSessionType: .clayImprints)
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showingGiftCardScanner) {
                GiftCardScannerSheet()
                    .environmentObject(authVM)
            }
            .sheet(item: $bookingToShare) { booking in
                ShareSheet(items: [bookingShareText(booking)])
            }
            .confirmationDialog("Update \(bookingsVM.selectedBookingIds.count) bookings?", isPresented: $showingBulkActions, titleVisibility: .visible) {
                if authVM.staff?.canUpdateStatus == true {
                    ForEach(BookingStatus.allCases, id: \.self) { status in
                        Button(status.label) {
                            if let staff = authVM.staff {
                                Task { await bookingsVM.bulkUpdateStatus(status: status, staff: staff) }
                            }
                        }
                    }
                }
                if authVM.staff?.role == "super_admin" {
                    Button("Export Selected to CSV") {
                        bookingsVM.exportSelectedCSV()
                    }
                }
                if authVM.staff?.canDeleteBookings == true {
                    Button("Delete Selected", role: .destructive) {
                        showingBulkDelete = true
                    }
                }
                Button("Cancel", role: .cancel) {
                    bookingsVM.selectedBookingIds.removeAll()
                    bookingsVM.isBulkSelectMode = false
                }
            }
            .confirmationDialog(
                "Delete \(bookingsVM.selectedBookingIds.count) bookings?",
                isPresented: $showingBulkDelete,
                titleVisibility: .visible
            ) {
                Button("Delete All", role: .destructive) {
                    if let staff = authVM.staff {
                        Task {
                            await bookingsVM.bulkDelete(staff: staff)
                            toastManager.success("Bookings deleted")
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This action cannot be undone. All selected bookings will be permanently removed.")
            }
            .confirmationDialog(
                "Delete booking for \(bookingToDelete?.name ?? "")?",
                isPresented: Binding(
                    get: { bookingToDelete != nil },
                    set: { if !$0 { bookingToDelete = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let booking = bookingToDelete, let staff = authVM.staff {
                        Task {
                            await bookingsVM.deleteBooking(booking, staff: staff)
                            toastManager.success("Booking deleted")
                        }
                    }
                    bookingToDelete = nil
                }
                Button("Cancel", role: .cancel) {
                    bookingToDelete = nil
                }
            } message: {
                Text("This action cannot be undone. The booking will be permanently removed.")
            }
        }
    }

    private var hasActiveFilters: Bool {
        bookingsVM.showTodayOnly
            || bookingsVM.selectedStudio != nil
            || bookingsVM.selectedStatus != nil
            || bookingsVM.selectedDate != nil
            || bookingsVM.dateRangeStart != nil
            || bookingsVM.dateRangeEnd != nil
    }
}

func bookingShareText(_ booking: Booking) -> String {
    var lines: [String] = []
    lines.append("Booking: \(booking.name)")
    lines.append("Date: \(PPDateDisplay.date(booking.date)) at \(PPDateDisplay.time(booking.time))")
    lines.append("Studio: \(booking.studio)")
    lines.append("Painters: \(booking.paintersCount)")
    lines.append("Session: \(booking.sessionTypeEnum?.label ?? booking.sessionType)")
    lines.append("Status: \(booking.bookingStatus?.label ?? booking.status)")
    if let phone = booking.phone as String?, !phone.isEmpty {
        lines.append("Phone: \(phone)")
    }
    if let email = booking.email, !email.isEmpty {
        lines.append("Email: \(email)")
    }
    if let notes = booking.notes, !notes.isEmpty {
        lines.append("Notes: \(notes)")
    }
    lines.append("ID: \(booking.id)")
    return lines.joined(separator: "\n")
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - Booking Row

struct BookingRowView: View {
    let booking: Booking

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .center, spacing: 2) {
                Text(PPDateDisplay.date(booking.date))
                    .font(AppFont.body(10, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                Text(PPDateDisplay.startTime(booking.time))
                    .font(AppFont.body(11, weight: .medium))
                    .foregroundStyle(PPBrand.clay300)
            }
            .frame(width: 92)
            .padding(.vertical, 6)
            .background(PPBrand.charcoal.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(booking.name)
                        .font(AppFont.body(16, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal)
                        .lineLimit(1)
                    if let photos = booking.photos, !photos.isEmpty {
                        Image(systemName: "camera.fill")
                            .font(AppFont.body(10))
                            .foregroundStyle(PPBrand.clay300)
                    }
                }
                HStack(spacing: 4) {
                    Image(systemName: "person.2.fill")
                        .font(AppFont.body(10))
                    Text("\(booking.paintersCount)")
                        .font(AppFont.body(12, weight: .medium))
                    Text("\u{00B7}")
                        .font(AppFont.body(12))
                        .foregroundStyle(PPBrand.clay300)
                    Text(booking.studio)
                        .font(AppFont.body(12, weight: .medium))
                    Text("\u{00B7}")
                        .font(AppFont.body(12))
                        .foregroundStyle(PPBrand.clay300)
                    SessionTypeBadge(sessionType: booking.sessionType)
                }
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }

            Spacer()

            let status = booking.bookingStatus ?? .pending
            if booking.studio == "Wimbledon" && (booking.tableId ?? "").isEmpty && status != .cancelled && status != .noShow {
                HStack(spacing: 3) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(AppFont.body(9, weight: .bold))
                    Text("No table")
                        .font(AppFont.body(10, weight: .bold))
                }
                .foregroundStyle(Color(red: 0.72, green: 0.25, blue: 0.05))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color(red: 1, green: 0.95, blue: 0.93))
                .clipShape(Capsule())
            }

            StatusBadge(status: status)
        }
        .padding(.vertical, 6)
    }
}

// MARK: - Status Badge (matching web pill badges with icons)

struct StatusBadge: View {
    let status: BookingStatus

    private var config: (label: String, icon: String, bg: Color, text: Color) {
        switch status {
        case .confirmed: return ("Confirmed", "checkmark.circle.fill", PPBrand.confirmedBadgeBg, PPBrand.confirmedBadgeText)
        case .cancelled: return ("Cancelled", "xmark.circle.fill", PPBrand.cancelledBadgeBg, PPBrand.cancelledBadgeText)
        case .seated: return ("Seated", "person.3.fill", PPBrand.seatedBadgeBg, PPBrand.seatedBadgeText)
        case .completed: return ("Complete", "checkmark.circle.fill", PPBrand.completedBadgeBg, PPBrand.completedBadgeText)
        case .pending: return ("Awaiting", "clock.fill", PPBrand.pendingBadgeBg, PPBrand.pendingBadgeText)
        case .noShow: return ("No Show", "xmark.circle.fill", PPBrand.cancelledBadgeBg, PPBrand.cancelledBadgeText)
        }
    }

    var body: some View {
        let cfg = config
        HStack(spacing: 4) {
            Image(systemName: cfg.icon)
                .font(AppFont.body(9, weight: .bold))
            Text(cfg.label)
                .font(AppFont.body(10, weight: .bold))
                .tracking(0.5)
        }
        .textCase(.uppercase)
        .foregroundStyle(cfg.text)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(cfg.bg)
        .clipShape(Capsule())
    }
}

// MARK: - Filter Chip

struct FilterChip: View {
    let text: String
    var icon: String? = nil
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            if let icon {
                Image(systemName: icon)
                    .font(AppFont.body(10, weight: .medium))
            }
            Text(text)
                .font(AppFont.body(12, weight: .medium))
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(AppFont.body(13))
            }
        }
        .foregroundStyle(PPBrand.charcoal)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(PPBrand.sage)
        .clipShape(Capsule())
    }
}

// MARK: - Filters View

struct FiltersView: View {
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) var dismiss

    private var availableStudios: [Studio] {
        authVM.staff?.visibleStudios ?? Studio.allCases
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Studio") {
                    Picker("Studio", selection: $bookingsVM.selectedStudio) {
                        Text("All").tag(Studio?.none)
                        ForEach(availableStudios, id: \.self) { studio in
                            Text(studio.rawValue).tag(Studio?.some(studio))
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Status") {
                    Picker("Status", selection: $bookingsVM.selectedStatus) {
                        Text("All").tag(BookingStatus?.none)
                        ForEach(BookingStatus.allCases, id: \.self) { status in
                            Text(status.label).tag(BookingStatus?.some(status))
                        }
                    }
                }

                Section("Date") {
                    DatePicker("Date", selection: Binding(
                        get: { bookingsVM.selectedDate ?? Date() },
                        set: { bookingsVM.selectedDate = $0 }
                    ), displayedComponents: .date)
                    if bookingsVM.selectedDate != nil {
                        Button("Clear date", role: .destructive) {
                            bookingsVM.selectedDate = nil
                        }
                    }
                }

                Section("Date Range") {
                    DatePicker("From", selection: Binding(
                        get: { bookingsVM.dateRangeStart ?? Date() },
                        set: { bookingsVM.dateRangeStart = $0 }
                    ), displayedComponents: .date)
                    DatePicker("To", selection: Binding(
                        get: { bookingsVM.dateRangeEnd ?? Date() },
                        set: { bookingsVM.dateRangeEnd = $0 }
                    ), displayedComponents: .date)
                    if bookingsVM.dateRangeStart != nil || bookingsVM.dateRangeEnd != nil {
                        Button("Clear range", role: .destructive) {
                            bookingsVM.dateRangeStart = nil
                            bookingsVM.dateRangeEnd = nil
                        }
                    }
                }

                Section("Sort") {
                    Picker("Sort by", selection: $bookingsVM.sortOption) {
                        ForEach(BookingsViewModel.SortOption.allCases, id: \.self) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                }

                Section {
                    Button("Clear all filters") {
                        bookingsVM.selectedStudio = nil
                        bookingsVM.selectedStatus = nil
                        bookingsVM.selectedDate = nil
                        bookingsVM.searchText = ""
                        bookingsVM.showTodayOnly = false
                        bookingsVM.dateRangeStart = nil
                        bookingsVM.dateRangeEnd = nil
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

struct SessionTabButton: View {
    let title: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                    .font(AppFont.body(12, weight: .bold))
                Text("\(count)")
                    .font(AppFont.body(10, weight: .bold))
                    .foregroundStyle(isSelected ? .white : PPBrand.charcoal.opacity(0.5))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(isSelected ? Color.white.opacity(0.2) : PPBrand.charcoal.opacity(0.08))
                    .clipShape(Capsule())
            }
            .foregroundStyle(isSelected ? .white : PPBrand.charcoal)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isSelected ? PPBrand.charcoal : Color.clear)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(isSelected ? Color.clear : PPBrand.charcoal.opacity(0.15), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
