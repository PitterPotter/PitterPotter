import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var notificationsVM: NotificationsViewModel
    @State private var showingNotifications = false
    @State private var selectedTab: AppTab = .bookings
    @State private var showingScanner = false
    @State private var showingNewWalkIn = false
    @State private var showingNewBooking = false
    @State private var showingPartyBooking = false
    @State private var showingNewBabyPrint = false
    @State private var showingExclusiveHire = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var wasActive = true


    var body: some View {
        VStack(spacing: 0) {
            // Sage header bar matching web admin
            WebHeaderBar(
                staff: authVM.staff,
                studios: authVM.staff?.visibleStudios ?? [],
                selectedStudio: Binding(
                    get: { bookingsVM.selectedStudio },
                    set: { bookingsVM.selectedStudio = $0 }
                ),
                onLogout: { authVM.logout() },
                onNotifications: { showingNotifications = true },
                unreadCount: notificationsVM.unreadCount(studio: bookingsVM.selectedStudio),
                canAddWalkIn: authVM.staff?.canAddWalkIns == true || authVM.staff?.role == "super_admin",
                onWalkIn: { showingNewWalkIn = true },
                onNewBooking: { showingNewBooking = true },
                onNewParty: { showingPartyBooking = true },
                onNewBabyPrint: { showingNewBabyPrint = true },
                onExclusiveHire: { showingExclusiveHire = true },
                onRedeemCard: { showingScanner = true },
                onEditor: authVM.staff?.role == "super_admin" ? { 
                    if let url = URL(string: "https://pitterpotter.co.uk/admin") {
                        UIApplication.shared.open(url)
                    }
                } : nil
            )
            .frame(maxWidth: 1280)
            .frame(maxWidth: .infinity)

            // Horizontal tab bar matching web admin
            WebTabBar(
                selectedTab: $selectedTab,
                isSuperAdmin: authVM.staff?.role == "super_admin",
                pendingCount: bookingsVM.visibleBookings.filter { $0.status == "pending" }.count,
                onScan: { showingScanner = true }
            )
            .frame(maxWidth: 1280)
            .frame(maxWidth: .infinity)

            // Content
            Group {
                switch selectedTab {
                case .dashboard:
                    DashboardOverviewView()
                        .environmentObject(bookingsVM)
                case .bookings:
                    CalendarView()
                        .environmentObject(bookingsVM)
                case .painted:
                    CollectionsView(initialStage: .painted)
                        .environmentObject(bookingsVM)
                case .ready:
                    CollectionsView(initialStage: .ready)
                        .environmentObject(bookingsVM)
                case .collected:
                    CollectionsView(initialStage: .collected)
                        .environmentObject(bookingsVM)
                case .scan:
                    EmptyView()
                case .floorPlan:
                    FloorPlanTabView().environmentObject(bookingsVM)
                case .giftCards:
                    GiftCardView()
                case .analytics:
                    AnalyticsView()
                        .environmentObject(bookingsVM)
                case .sms:
                    SMSAdminView()
                case .emailLogs:
                    EmailLogsView()
                case .emailTemplates:
                    EmailTemplatesView()
                case .audit:
                    AuditLogView()
                case .webmaster:
                    WebmasterView()
                case .documentation:
                    DocumentationView()
                case .settings:
                    if authVM.staff?.role == "super_admin" {
                        AdminSettingsView()
                            .environmentObject(bookingsVM)
                    } else {
                        SettingsView()
                            .environmentObject(bookingsVM)
                    }
                default:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(maxWidth: 1280) // Match web's max-w-7xl
        }
        .sheet(isPresented: $showingScanner) {
            PaintingScannerView(bookingsVM: bookingsVM, authVM: authVM)
        }
        .sheet(isPresented: $showingNewWalkIn) {
            NewWalkInView(initialSessionType: .painting)
                .environmentObject(authVM)
                .environmentObject(bookingsVM)
        }
        .sheet(isPresented: $showingNewBooking) {
            NewWalkInView(initialSessionType: .painting)
                .environmentObject(authVM)
                .environmentObject(bookingsVM)
        }
        .sheet(isPresented: $showingPartyBooking) {
            PartyBookingView()
                .environmentObject(authVM)
                .environmentObject(bookingsVM)
        }
        .sheet(isPresented: $showingNewBabyPrint) {
            NewWalkInView(initialSessionType: .clayImprints)
                .environmentObject(authVM)
                .environmentObject(bookingsVM)
        }
        .sheet(isPresented: $showingExclusiveHire) {
            NewWalkInView(initialSessionType: .exclusiveHire)
                .environmentObject(authVM)
                .environmentObject(bookingsVM)
        }
        .sheet(isPresented: $showingNotifications) {
            NotificationsView()
                .environmentObject(authVM)
                .environmentObject(bookingsVM)
        }
        .task {
            // RootView handles all data loading and polling
            // Don't start anything here to avoid duplicate API calls
        }
        .onDisappear {
            bookingsVM.stopRealtime()
            notificationsVM.stopPolling()
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                if !wasActive, let staff = authVM.staff {
                    // Resume polling and do an immediate refresh
                    bookingsVM.startRealtime(staff: staff)
                    notificationsVM.startPolling(staff: staff)
                    Task {
                        await bookingsVM.loadBookings(staff: staff)
                        await notificationsVM.refreshUnreadCount(staff: staff)
                    }
                }
                wasActive = true
            case .inactive:
                break
            case .background:
                wasActive = false
                bookingsVM.stopRealtime()
                notificationsVM.stopPolling()
            @unknown default:
                break
            }
        }
    }
}

// MARK: - Horizontal Tab Bar (matches web admin)

struct WebTabBar: View {
    @Binding var selectedTab: AppTab
    let isSuperAdmin: Bool
    let pendingCount: Int
    var onScan: (() -> Void)? = nil

    private var tabs: [(tab: AppTab, label: String, badge: Int?)] {
        var t: [(AppTab, String, Int?)] = []
        if isSuperAdmin {
            t.append((.dashboard, "Dashboard", pendingCount > 0 ? pendingCount : nil))
            t.append((.bookings, "Bookings", nil))
        } else {
            t.append((.bookings, "Dashboard", pendingCount > 0 ? pendingCount : nil))
        }
        t.append((.painted, "Painted", nil))
        t.append((.ready, "Ready", nil))
        t.append((.collected, "Collected", nil))
        t.append((.scan, "Scan", nil))
        t.append((.floorPlan, "Floor Plan", nil))
        if isSuperAdmin {
            t.append((.giftCards, "Gift Vouchers", nil))
            t.append((.analytics, "Analytics", nil))
            t.append((.sms, "SMS", nil))
            t.append((.emailLogs, "Emails", nil))
            t.append((.emailTemplates, "Templates", nil))
            t.append((.audit, "Audit", nil))
            t.append((.webmaster, "Webmaster", nil))
            t.append((.documentation, "Docs", nil))
            t.append((.settings, "Settings", nil))
        }
        return t
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(tabs, id: \.tab) { item in
                    Button {
                        if item.tab == .scan, let onScan = onScan {
                            onScan()
                        } else {
                            selectedTab = item.tab
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if item.tab == .scan {
                                HStack(spacing: 4) {
                                    Image(systemName: "qrcode.viewfinder")
                                        .font(AppFont.body(13, weight: .bold))
                                    Text("SCANNER")
                                        .font(AppFont.heading(11))
                                        .tracking(0.5)
                                }
                                .foregroundStyle(PPBrand.charcoal)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(PPBrand.sage)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                                )
                            } else {
                                Text(item.label)
                                    .font(AppFont.body(13, weight: .bold))
                                    .tracking(0.5)
                            }

                            if let badge = item.badge, badge > 0 {
                                Text(badge > 99 ? "99+" : "\(badge)")
                                    .font(AppFont.heading(9))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(Color.red)
                                    .clipShape(Capsule())
                            }
                        }
                        .padding(.horizontal, item.tab == .scan ? 0 : 16)
                        .padding(.vertical, item.tab == .scan ? 4 : 12)
                        .foregroundStyle(item.tab == .scan ? .clear : (selectedTab == item.tab ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.5)))
                        .overlay(alignment: .bottom) {
                            if selectedTab == item.tab {
                                Rectangle()
                                    .fill(PPBrand.charcoal)
                                    .frame(height: 2)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .background(PPBrand.sage)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(PPBrand.charcoal.opacity(0.1))
                .frame(height: 1)
        }
    }
}

// Sage header bar matching web admin exactly
struct WebHeaderBar: View {
    let staff: Staff?
    var studios: [Studio] = []
    var selectedStudio: Binding<Studio?>? = nil
    let onLogout: () -> Void
    let onNotifications: () -> Void
    let unreadCount: Int
    var canAddWalkIn: Bool = false
    var onWalkIn: (() -> Void)? = nil
    var onNewBooking: (() -> Void)? = nil
    var onNewParty: (() -> Void)? = nil
    var onNewBabyPrint: (() -> Void)? = nil
    var onExclusiveHire: (() -> Void)? = nil
    var onRedeemCard: (() -> Void)? = nil
    var onEditor: (() -> Void)? = nil

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "Good Morning"
        case 12..<17: return "Good Afternoon"
        case 17..<22: return "Good Evening"
        default: return "Good Night"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                // Left: logo + greeting + role
                VStack(spacing: 2) {
                    Image("BrandLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 28)
                    if let staff = staff {
                        Text("\(greeting), \(staff.name)")
                            .font(AppFont.body(10))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                            .lineLimit(1)
                        if staff.role == "super_admin" {
                            Text("Super Admin")
                                .font(AppFont.body(8, weight: .bold))
                                .textCase(.uppercase)
                                .tracking(0.5)
                                .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                        }
                    }
                }

                Spacer()

                // Right: Redeem Card, Editor, notifications, logout
                HStack(spacing: 12) {
                    // Redeem Card button
                    if let onRedeemCard = onRedeemCard {
                        Button {
                            onRedeemCard()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "ticket")
                                    .font(AppFont.body(11, weight: .bold))
                                Text("Redeem")
                                    .font(AppFont.body(11, weight: .bold))
                            }
                            .foregroundStyle(PPBrand.charcoal)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(PPBrand.sage)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }

                    // Editor button (super admin only)
                    if staff?.role == "super_admin", let onEditor = onEditor {
                        Button {
                            onEditor()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "globe")
                                    .font(AppFont.body(11, weight: .bold))
                                Text("Editor")
                                    .font(AppFont.body(11, weight: .bold))
                            }
                            .foregroundStyle(PPBrand.charcoal)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(PPBrand.clay100)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }

                    // Notification bell
                    Button {
                        onNotifications()
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bell")
                                .font(AppFont.body(18, weight: .medium))
                                .foregroundStyle(PPBrand.charcoal)
                            if unreadCount > 0 {
                                Text(unreadCount > 99 ? "99+" : "\(unreadCount)")
                                    .font(AppFont.body(9, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(Color.red)
                                    .clipShape(Capsule())
                                    .offset(x: 8, y: -6)
                            }
                        }
                    }
                    .buttonStyle(.plain)

                    // Logout
                    Button {
                        onLogout()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                                .font(AppFont.body(14, weight: .bold))
                            Text("Logout")
                                .font(AppFont.body(12, weight: .bold))
                        }
                        .foregroundStyle(PPBrand.charcoal)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            // Location switcher — only when staff can see more than one studio
            if let selection = selectedStudio, studios.count > 1 {
                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    studioChip(label: "All Locations", isSelected: selection.wrappedValue == nil) {
                        selection.wrappedValue = nil
                    }
                    ForEach(studios, id: \.self) { studio in
                        studioChip(label: studio.rawValue, isSelected: selection.wrappedValue == studio) {
                            selection.wrappedValue = studio
                        }
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }

            // Quick action buttons (matching web header)
            if canAddWalkIn {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        // Walk-in (charcoal)
                        Button {
                            onWalkIn?()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "person.2")
                                    .font(AppFont.body(11, weight: .bold))
                                Text("Walk-in")
                                    .font(AppFont.body(11, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(PPBrand.charcoal)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)

                        // New Booking (green)
                        Button {
                            onNewBooking?()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                    .font(AppFont.body(11, weight: .bold))
                                Text("New Booking")
                                    .font(AppFont.body(11, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color(red: 0.1, green: 0.7, blue: 0.4))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)

                        // New Party (purple)
                        Button {
                            onNewParty?()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "gift")
                                    .font(AppFont.body(11, weight: .bold))
                                Text("New Party")
                                    .font(AppFont.body(11, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color(red: 0.6, green: 0.3, blue: 0.8))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)

                        // New Baby Print (orange)
                        Button {
                            onNewBabyPrint?()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                    .font(AppFont.body(11, weight: .bold))
                                Text("New Baby Print")
                                    .font(AppFont.body(11, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color(red: 0.9, green: 0.5, blue: 0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)

                        // Exclusive Hire (indigo)
                        Button {
                            onExclusiveHire?()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "clock")
                                    .font(AppFont.body(11, weight: .bold))
                                Text("Exclusive Hire")
                                    .font(AppFont.body(11, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color(red: 0.3, green: 0.3, blue: 0.7))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                }
            }
        }
    }

    @ViewBuilder
    private func studioChip(label: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(AppFont.body(11, weight: .bold))
                .foregroundStyle(isSelected ? .white : PPBrand.charcoal.opacity(0.6))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? PPBrand.charcoal : Color.white)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}
