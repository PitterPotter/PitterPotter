import SwiftUI

struct DashboardOverviewView: View {
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var toastManager: ToastManager
    @State private var giftCards: [GiftCard] = []
    @State private var showingNewWalkIn = false
    @State private var showingPartyBooking = false
    @State private var showingGhostBooking = false
    @State private var showingCollectionScanner = false
    @State private var showingNewBooking = false
    @State private var showingNewBabyPrint = false
    private var selectedStudio: String? {
        get { bookingsVM.selectedStudio?.rawValue }
        nonmutating set { bookingsVM.selectedStudio = newValue.flatMap { Studio(rawValue: $0) } }
    }

    private var availableStudios: [String] {
        var studios = ["All"]
        studios.append(contentsOf: (authVM.staff?.visibleStudios ?? Studio.allCases).map { $0.rawValue })
        return studios
    }

    private var filteredBookings: [Booking] {
        bookingsVM.visibleBookings
    }

    private var todayString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private var todayBookings: [Booking] {
        filteredBookings.filter { $0.date == todayString }.sorted { $0.time < $1.time }
    }

    private var pendingCount: Int {
        filteredBookings.filter { $0.status == "pending" }.count
    }

    private var confirmedCount: Int {
        filteredBookings.filter { $0.status == "confirmed" }.count
    }

    private var seatedCount: Int {
        filteredBookings.filter { $0.status == "seated" }.count
    }

    private var completedCount: Int {
        filteredBookings.filter { $0.status == "completed" }.count
    }

    private var todayPainters: Int {
        todayBookings.reduce(0) { $0 + $1.paintersCount }
    }

    private var activeGiftCards: Int {
        giftCards.filter { $0.status == "active" }.count
    }

    private var giftCardValue: Double {
        giftCards.filter { $0.status == "active" }.reduce(0) { $0 + ($1.balance ?? $1.amount) }
    }

    private var recentBookings: [Booking] {
        filteredBookings.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }.prefix(5).map { $0 }
    }

    // MARK: - Web-parity computed properties

    private var upcomingCount: Int {
        filteredBookings.filter { b in
            b.status != "cancelled" && b.status != "no_show" &&
            dateFromString(b.date).map { $0 > Date() } ?? false
        }.count
    }

    private var upcomingBookings: [Booking] {
        filteredBookings
            .filter { b in
                b.status != "cancelled" && b.status != "no_show" &&
                dateFromString(b.date).map { $0 > Date() } ?? false
            }
            .sorted { $0.date < $1.date }
            .prefix(5).map { $0 }
    }

    private var collectionCounts: (painted: Int, ready: Int, collected: Int) {
        var painted = 0, ready = 0, collected = 0
        for b in filteredBookings where b.status != "cancelled" && b.status != "no_show" {
            let stage = b.collectionStatus ?? (b.status == "completed" ? "painted" : nil)
            switch stage {
            case "painted": painted += 1
            case "ready": ready += 1
            case "collected": collected += 1
            default: break
            }
        }
        return (painted, ready, collected)
    }

    private var noPhotoAlerts: [Booking] {
        filteredBookings.filter { b in
            b.status == "completed" &&
            (b.collectionStatus == nil || b.collectionStatus == "painted") &&
            (b.photos?.isEmpty ?? true)
        }
    }

    private var forecastData: [(date: String, painters: Int, bookings: Int)] {
        let cal = Calendar.current
        var byDate: [String: (painters: Int, bookings: Int)] = [:]
        let today = todayString
        for b in filteredBookings where b.status != "cancelled" && b.status != "no_show" {
            if b.date >= today {
                let existing = byDate[b.date] ?? (0, 0)
                byDate[b.date] = (existing.painters + b.paintersCount, existing.bookings + 1)
            }
        }
        return byDate.sorted { $0.key < $1.key }.prefix(7).map { (date: $0.key, painters: $0.value.painters, bookings: $0.value.bookings) }
    }

    private var totalGiftCardsSold: Int { giftCards.count }
    private var giftCardRemainingValue: Double {
        giftCards.filter { $0.status == "active" }.reduce(0) { $0 + ($1.balance ?? $1.amount) }
    }
    private var giftCardTotalValue: Double {
        giftCards.reduce(0) { $0 + $1.amount }
    }

    private var studioToggle: some View {
        HStack(spacing: 8) {
            ForEach(availableStudios, id: \.self) { studio in
                Button {
                    selectedStudio = (studio == "All") ? nil : studio
                    Haptics.light()
                } label: {
                    Text(studio)
                        .font(AppFont.body(13, weight: .bold))
                        .foregroundStyle(isStudioSelected(studio) ? .white : PPBrand.charcoal)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(isStudioSelected(studio) ? PPBrand.charcoal : PPBrand.clay100.opacity(0.5))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    private func isStudioSelected(_ studio: String) -> Bool {
        if studio == "All" { return selectedStudio == nil }
        return selectedStudio == studio
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    studioToggle

                    statsGrid

                    revenueRow

                    painterForecastSection

                    noPhotoAlertSection

                    collectionSummarySection

                    quickActionsRow

                    todayScheduleSection

                    upcomingBookingsSection

                    giftCardStatsSection

                    recentSection
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .background(PPBrand.mist)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Dashboard Summary")
                        .font(AppFont.heading(17))
                        .foregroundStyle(PPBrand.charcoal)
                        .textCase(.uppercase)
                        .tracking(1)
                }
            }
            .refreshable {
                if let staff = authVM.staff {
                    await bookingsVM.loadBookings(staff: staff)
                    await loadGiftCards()
                }
            }
            .task {
                await loadGiftCards()
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
            .sheet(isPresented: $showingPartyBooking) {
                PartyBookingView()
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showingGhostBooking) {
                GhostBookingView()
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
            .sheet(isPresented: $showingCollectionScanner) {
                PaintingScannerView(bookingsVM: bookingsVM, authVM: authVM)
            }
        }
    }

    private var heroHeader: some View {
        EmptyView()
    }

    private func formatDate_unused() {}

    private var revenueRow: some View {
        HStack(spacing: 12) {
            RevenueBox(label: "Today", value: "£\(String(format: "%.0f", todayRevenue))")
            RevenueBox(label: "This Week", value: "£\(String(format: "%.0f", weekRevenue))")
            RevenueBox(label: "This Month", value: "£\(String(format: "%.0f", monthRevenue))")
        }
    }

    private var todayRevenue: Double {
        todayBookings.reduce(0) { $0 + ($1.finalPrice ?? $1.estimatedPrice ?? 0) }
    }

    private var weekRevenue: Double {
        let cal = Calendar.current
        let weekStart = cal.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
        let weekEnd = cal.dateInterval(of: .weekOfYear, for: Date())?.end ?? Date()
        return filteredBookings.filter { b in
            if let d = dateFromString(b.date) { return d >= weekStart && d < weekEnd }
            return false
        }.reduce(0) { $0 + ($1.finalPrice ?? $1.estimatedPrice ?? 0) }
    }

    private var monthRevenue: Double {
        let cal = Calendar.current
        let monthStart = cal.dateInterval(of: .month, for: Date())?.start ?? Date()
        let monthEnd = cal.dateInterval(of: .month, for: Date())?.end ?? Date()
        return filteredBookings.filter { b in
            if let d = dateFromString(b.date) { return d >= monthStart && d < monthEnd }
            return false
        }.reduce(0) { $0 + ($1.finalPrice ?? $1.estimatedPrice ?? 0) }
    }

    private static let sharedDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private func dateFromString(_ s: String) -> Date? {
        Self.sharedDateFormatter.date(from: s)
    }

    private static let sharedDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEEE, d MMM"
        return f
    }()

    private func formatDate(_ date: Date) -> String {
        Self.sharedDayFormatter.string(from: date)
    }

    // MARK: - Painter Forecast

    private var painterForecastSection: some View {
        Group {
            if !forecastData.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 6) {
                        Image(systemName: "person.2.fill")
                            .font(AppFont.body(14, weight: .bold))
                            .foregroundStyle(PPBrand.charcoal)
                        Text("Painter Forecast (Next 7 Days)")
                            .font(AppFont.heading(13))
                            .foregroundStyle(PPBrand.charcoal)
                            .textCase(.uppercase)
                            .tracking(0.5)
                    }

                    ForEach(forecastData, id: \.date) { item in
                        HStack(spacing: 10) {
                            Text(PPDateDisplay.date(item.date))
                                .font(AppFont.body(11, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                                .frame(width: 130, alignment: .leading)

                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(PPBrand.charcoal.opacity(0.1))
                                        .frame(height: 6)
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(PPBrand.charcoal)
                                        .frame(width: min(geo.size.width, geo.size.width * CGFloat(item.painters) / 40), height: 6)
                                }
                                .frame(maxHeight: .infinity, alignment: .center)
                            }
                            .frame(height: 20)

                            Text("\(item.painters)")
                                .font(AppFont.body(11, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                            Text("\(item.bookings) bk")
                                .font(AppFont.body(9, weight: .medium))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                        }
                    }
                }
                .padding(16)
                .webCard()
            }
        }
    }

    // MARK: - No Photo Alerts

    private var noPhotoAlertSection: some View {
        Group {
            if !noPhotoAlerts.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        HStack(spacing: 6) {
                            Image(systemName: "camera.fill")
                                .font(AppFont.body(14, weight: .bold))
                                .foregroundStyle(Color(hex: 0x92400E))
                            Text("\(noPhotoAlerts.count) completed booking\(noPhotoAlerts.count != 1 ? "s" : "") need photo\(noPhotoAlerts.count != 1 ? "s" : "")")
                                .font(AppFont.heading(13))
                                .foregroundStyle(Color(hex: 0x92400E))
                                .textCase(.uppercase)
                                .tracking(0.5)
                        }
                        Spacer()
                        NavigationLink {
                            CollectionsView(initialStage: .painted)
                                .environmentObject(authVM)
                                .environmentObject(bookingsVM)
                        } label: {
                            HStack(spacing: 2) {
                                Text("Painted")
                                    .font(AppFont.body(10, weight: .bold))
                                    .textCase(.uppercase)
                                Image(systemName: "chevron.right")
                                    .font(AppFont.body(10, weight: .bold))
                            }
                            .foregroundStyle(Color(hex: 0xB45309))
                        }
                        .buttonStyle(.plain)
                    }

                    ForEach(noPhotoAlerts.prefix(4)) { booking in
                        HStack(spacing: 10) {
                            Text(PPDateDisplay.date(booking.date))
                                .font(AppFont.body(10, weight: .medium))
                                .foregroundStyle(Color(hex: 0xB45309).opacity(0.7))
                                .frame(width: 120, alignment: .leading)
                            Text(booking.name)
                                .font(AppFont.body(12, weight: .bold))
                                .foregroundStyle(Color(hex: 0x92400E))
                                .lineLimit(1)
                            Spacer()
                            Text(booking.studio)
                                .font(AppFont.body(10, weight: .bold))
                                .foregroundStyle(Color(hex: 0xB45309).opacity(0.7))
                        }
                    }

                    if noPhotoAlerts.count > 4 {
                        Text("+\(noPhotoAlerts.count - 4) more...")
                            .font(AppFont.body(10, weight: .medium))
                            .foregroundStyle(Color(hex: 0xB45309).opacity(0.7))
                    }
                }
                .padding(16)
                .background(Color(hex: 0xFFFBEB).opacity(0.8))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0xFCD34D), lineWidth: 1))
            }
        }
    }

    // MARK: - Collection Summary

    private var collectionSummarySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Collections")
                .font(AppFont.heading(13))
                .foregroundStyle(PPBrand.charcoal)
                .textCase(.uppercase)
                .tracking(0.5)

            HStack(spacing: 10) {
                CollectionStatCard(label: "Painted", count: collectionCounts.painted, icon: "camera.fill", color: Color(hex: 0x92400E), bg: Color(hex: 0xFEF3C7))
                CollectionStatCard(label: "Ready", count: collectionCounts.ready, icon: "shippingbox.fill", color: Color(hex: 0x1E40AF), bg: Color(hex: 0xDBEAFE))
                CollectionStatCard(label: "Collected", count: collectionCounts.collected, icon: "checkmark.circle.fill", color: Color(hex: 0x047857), bg: Color(hex: 0xD1FAE5))
            }
        }
        .padding(16)
        .webCard()
    }

    // MARK: - Upcoming Bookings

    private var upcomingBookingsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Upcoming")
                    .font(AppFont.heading(13))
                    .foregroundStyle(PPBrand.charcoal)
                    .textCase(.uppercase)
                    .tracking(0.5)
                Spacer()
                NavigationLink {
                    BookingsListView()
                        .environmentObject(bookingsVM)
                        .environmentObject(authVM)
                        .environmentObject(toastManager)
                } label: {
                    HStack(spacing: 2) {
                        Text("View all")
                            .font(AppFont.body(10, weight: .bold))
                        Image(systemName: "chevron.right")
                            .font(AppFont.body(10, weight: .bold))
                    }
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
                .buttonStyle(.plain)
            }

            if upcomingBookings.isEmpty {
                Text("No upcoming bookings")
                    .font(AppFont.body(13, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            } else {
                ForEach(upcomingBookings) { booking in
                    NavigationLink(value: booking) {
                        HStack(spacing: 10) {
                            Text(PPDateDisplay.date(booking.date))
                                .font(AppFont.body(10, weight: .medium))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                                .frame(width: 120, alignment: .leading)
                            Text(PPDateDisplay.time(booking.time))
                                .font(AppFont.body(12, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                            Text(booking.name)
                                .font(AppFont.body(12, weight: .medium))
                                .foregroundStyle(PPBrand.charcoal)
                                .lineLimit(1)
                            Spacer()
                            Text("\(booking.paintersCount)")
                                .font(AppFont.body(10, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(16)
        .webCard()
    }

    private static let sharedOutputFormatter: DateFormatter = {
        let f = DateFormatter()
        return f
    }()

    private func formatDateString(_ s: String, format: String) -> String {
        guard let d = Self.sharedDateFormatter.date(from: s) else { return s }
        Self.sharedOutputFormatter.dateFormat = format
        return Self.sharedOutputFormatter.string(from: d)
    }

    private var statsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            WebStatCard(title: "Today", value: "\(todayBookings.count)", icon: "calendar", subtitle: "\(todayPainters) painters")
            WebStatCard(title: "Upcoming", value: "\(upcomingCount)", icon: "clock.fill", subtitle: "Future bookings")
            WebStatCard(title: "Awaiting", value: "\(pendingCount)", icon: "person.2.fill", subtitle: "Needs action", highlight: pendingCount > 0)
            WebStatCard(title: "Confirmed", value: "\(confirmedCount)", icon: "checkmark.circle.fill", subtitle: "Ready to go")
        }
    }

    private var quickActionsRow: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button {
                    showingNewWalkIn = true
                } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "person.walk")
                                .font(AppFont.body(18, weight: .medium))
                            Text("Walk-in")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(PPBrand.charcoal)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                Button {
                    showingNewBooking = true
                } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "person.2.fill")
                                .font(AppFont.body(18, weight: .medium))
                            Text("New Booking")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color(red: 0.0, green: 0.65, blue: 0.35))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                Button {
                    showingPartyBooking = true
                } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "birthday.cake.fill")
                                .font(AppFont.body(18, weight: .medium))
                            Text("New Party")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color(red: 0.55, green: 0.25, blue: 0.65))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
            HStack(spacing: 12) {
                Button {
                    showingNewBabyPrint = true
                } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "figure.and.child.holdinghands")
                                .font(AppFont.body(18, weight: .medium))
                            Text("New Baby Print")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color(red: 0.976, green: 0.451, blue: 0.086))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                Button {
                    showingCollectionScanner = true
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "qrcode.viewfinder")
                            .font(AppFont.body(18, weight: .medium))
                        Text("Scanner")
                            .font(AppFont.body(11, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(PPBrand.sage)
                    .foregroundStyle(PPBrand.charcoal)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                    )
                }
                NavigationLink {
                    BookingsListView()
                        .environmentObject(bookingsVM)
                        .environmentObject(authVM)
                        .environmentObject(toastManager)
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "list.bullet.clipboard")
                            .font(AppFont.body(18, weight: .medium))
                        Text("Bookings")
                            .font(AppFont.body(11, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(PPBrand.clay100.opacity(0.3))
                    .foregroundStyle(PPBrand.charcoal)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                    )
                }
            }
        }
    }

    private var todayScheduleSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "calendar.day.left")
                    .font(AppFont.body(14, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                Text("Today's Schedule")
                    .font(AppFont.heading(15))
                    .foregroundStyle(PPBrand.charcoal)
                    .textCase(.uppercase)
                    .tracking(1)
                Spacer()
                Text("\(todayBookings.count) booking\(todayBookings.count != 1 ? "s" : "")")
                    .font(AppFont.body(12, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(PPBrand.charcoal.opacity(0.06))
                    .clipShape(Capsule())
            }

            if todayBookings.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "sun.max.fill")
                        .font(AppFont.body(32))
                        .foregroundStyle(PPBrand.clay300)
                    Text("No bookings today")
                        .font(AppFont.body(15, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    Text("Enjoy the quiet!")
                        .font(AppFont.body(13))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(todayBookings.enumerated()), id: \.element.id) { index, booking in
                        NavigationLink(value: booking) {
                            ScheduleRow(booking: booking, isLast: index == todayBookings.count - 1)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(16)
        .webCard()
    }

    private var giftCardStatsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "giftcard.fill")
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                    Text("Gift Vouchers")
                        .font(AppFont.heading(13))
                        .foregroundStyle(PPBrand.charcoal)
                        .textCase(.uppercase)
                        .tracking(0.5)
                }
                Spacer()
                Text("£\(String(format: "%.0f", giftCardTotalValue)) sold")
                    .font(AppFont.body(10, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }

            HStack(spacing: 0) {
                VStack(spacing: 4) {
                    Text("\(totalGiftCardsSold)")
                        .font(AppFont.heading(20))
                        .foregroundStyle(PPBrand.charcoal)
                    Text("Total")
                        .font(AppFont.body(9, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .textCase(.uppercase)
                }
                .frame(maxWidth: .infinity)

                Rectangle()
                    .fill(PPBrand.charcoal.opacity(0.1))
                    .frame(width: 1, height: 40)

                VStack(spacing: 4) {
                    Text("\(activeGiftCards)")
                        .font(AppFont.heading(20))
                        .foregroundStyle(PPBrand.charcoal)
                    Text("Active")
                        .font(AppFont.body(9, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .textCase(.uppercase)
                }
                .frame(maxWidth: .infinity)

                Rectangle()
                    .fill(PPBrand.charcoal.opacity(0.1))
                    .frame(width: 1, height: 40)

                VStack(spacing: 4) {
                    Text("£\(String(format: "%.0f", giftCardRemainingValue))")
                        .font(AppFont.heading(20))
                        .foregroundStyle(PPBrand.charcoal)
                    Text("Remaining")
                        .font(AppFont.body(9, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .textCase(.uppercase)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(16)
        .webCard()
    }

    private func loadGiftCards() async {
        guard let staff = authVM.staff else { return }
        do {
            let result = try await APIClient.shared.loadGiftCards(staff: staff)
            await MainActor.run { giftCards = result }
        } catch {}
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "clock.arrow.circlepath")
                    .font(AppFont.body(14, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                Text("Recently Added")
                    .font(AppFont.heading(15))
                    .foregroundStyle(PPBrand.charcoal)
                    .textCase(.uppercase)
                    .tracking(1)
                Spacer()
            }

            ForEach(recentBookings) { booking in
                NavigationLink(value: booking) {
                    BookingRowCompact(booking: booking)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .webCard()
    }
}

struct WebStatCard: View {
    let title: String
    let value: String
    let icon: String
    var subtitle: String? = nil
    var highlight: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(AppFont.body(10, weight: .bold))
                .foregroundStyle(PPBrand.charcoal.opacity(0.7))
                .textCase(.uppercase)
                .tracking(0.5)
            Text(value)
                .font(AppFont.heading(22))
                .foregroundStyle(PPBrand.charcoal)
            if let subtitle {
                Text(subtitle)
                    .font(AppFont.body(10, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            }
        }
        .padding(12)
        .background(PPBrand.clay100.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct RevenueBox: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: "sterlingsign")
                    .font(AppFont.body(12))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                Text(label.uppercased())
                    .font(AppFont.body(9, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    .tracking(0.5)
            }
            Text(value)
                .font(AppFont.heading(20))
                .foregroundStyle(PPBrand.charcoal)
            Spacer()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PPBrand.clay100.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    var subtitle: String? = nil

    var body: some View {
        WebStatCard(title: title, value: value, icon: icon, subtitle: subtitle)
    }
}

struct BookingRowCompact: View {
    let booking: Booking

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 4)
                .fill(statusColor)
                .frame(width: 3, height: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(booking.name)
                    .font(AppFont.body(15, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal)
                HStack(spacing: 4) {
                    Text(booking.studio)
                        .font(AppFont.body(12, weight: .medium))
                        .foregroundStyle(.secondary)
                    Text("\u{00B7}")
                        .font(AppFont.body(12))
                        .foregroundStyle(PPBrand.clay300)
                    Text(PPDateDisplay.date(booking.date))
                        .font(AppFont.body(12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            StatusTextBadge(status: booking.status)
        }
        .padding(.vertical, 6)
    }

    private var statusColor: Color {
        switch booking.status {
        case "confirmed": return PPBrand.confirmedBadgeText
        case "cancelled": return PPBrand.cancelledBadgeText
        case "seated": return PPBrand.seatedBadgeText
        case "completed": return PPBrand.completedBadgeText
        case "pending": return PPBrand.pendingBadgeText
        default: return .gray
        }
    }
}

struct ScheduleRow: View {
    let booking: Booking
    var isLast: Bool = false

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .center, spacing: 2) {
                Text(PPDateDisplay.startTime(booking.time))
                    .font(AppFont.heading(15))
                    .foregroundStyle(PPBrand.charcoal)
                Text(booking.studio.prefix(3).description)
                    .font(AppFont.body(10, weight: .medium))
                    .foregroundStyle(PPBrand.clay300)
            }
            .frame(width: 56)

            RoundedRectangle(cornerRadius: 2)
                .fill(statusColor)
                .frame(width: 3, height: 40)

            VStack(alignment: .leading, spacing: 4) {
                Text(booking.name)
                    .font(AppFont.body(15, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal)
                HStack(spacing: 4) {
                    Image(systemName: "person.2.fill")
                        .font(AppFont.body(10))
                    Text("\(booking.paintersCount)")
                        .font(AppFont.body(12, weight: .medium))
                    Text("\u{00B7}")
                        .font(AppFont.body(12))
                    SessionTypeBadge(sessionType: booking.sessionType)
                }
                .foregroundStyle(.secondary)
            }

            Spacer()

            StatusBadge(status: booking.bookingStatus ?? .pending)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            if !isLast {
                Rectangle()
                    .fill(PPBrand.charcoal.opacity(0.06))
                    .frame(height: 0.5)
                    .padding(.leading, 70)
            }
        }
    }

    private var statusColor: Color {
        switch booking.status {
        case "confirmed": return PPBrand.confirmedBadgeText
        case "cancelled": return PPBrand.cancelledBadgeText
        case "seated": return PPBrand.seatedBadgeText
        case "completed": return PPBrand.completedBadgeText
        case "pending": return PPBrand.pendingBadgeText
        default: return .gray
        }
    }
}

struct CollectionStatCard: View {
    let label: String
    let count: Int
    let icon: String
    let color: Color
    let bg: Color

    var body: some View {
        VStack(spacing: 6) {
            Text(label)
                .font(AppFont.body(9, weight: .bold))
                .foregroundStyle(color)
                .textCase(.uppercase)
                .tracking(0.5)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(bg)
                .clipShape(Capsule())

            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(AppFont.body(14))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                Text("\(count)")
                    .font(AppFont.heading(20))
                    .foregroundStyle(PPBrand.charcoal)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
    }
}
