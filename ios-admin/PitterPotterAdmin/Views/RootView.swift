import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case bookings = "Bookings"
    case painted = "Painted"
    case ready = "Ready"
    case collected = "Collected"
    case scan = "Scan"
    case floorPlan = "Floor Plan"
    case calendar = "Calendar"
    case capacity = "Capacity"
    case staff = "Staff"
    case giftCards = "Gift Cards"
    case sms = "SMS"
    case audit = "Audit"
    case emailLogs = "Email Logs"
    case emailTemplates = "Templates"
    case analytics = "Analytics"
    case webmaster = "Webmaster"
    case documentation = "Docs"
    case settings = "Settings"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .bookings: return "list.bullet.clipboard"
        case .painted: return "paintbrush"
        case .ready: return "checkmark.circle"
        case .collected: return "tray.full.fill"
        case .scan: return "qrcode.viewfinder"
        case .floorPlan: return "map"
        case .calendar: return "calendar"
        case .capacity: return "chart.bar.xaxis"
        case .staff: return "person.2"
        case .giftCards: return "giftcard"
        case .sms: return "message"
        case .audit: return "doc.text.magnifyingglass"
        case .emailLogs: return "envelope"
        case .emailTemplates: return "envelope.open"
        case .analytics: return "chart.line.uptrend.xyaxis"
        case .webmaster: return "server.rack"
        case .documentation: return "book.fill"
        case .settings: return "gearshape"
        }
    }

    var isSuperAdminOnly: Bool {
        switch self {
        case .staff, .giftCards, .sms, .audit, .emailLogs, .emailTemplates, .analytics, .webmaster, .documentation: return true
        default: return false
        }
    }

    @ViewBuilder
    func makeView(bookingsVM: BookingsViewModel, authVM: AuthViewModel) -> some View {
        switch self {
        case .dashboard:
            DashboardOverviewView().environmentObject(bookingsVM)
        case .bookings:
            BookingsListView().environmentObject(bookingsVM)
        case .painted:
            CollectionsView(initialStage: .painted).environmentObject(bookingsVM)
        case .ready:
            CollectionsView(initialStage: .ready).environmentObject(bookingsVM)
        case .collected:
            CollectionsView(initialStage: .collected).environmentObject(bookingsVM)
        case .scan:
            EmptyView()
        case .floorPlan:
            FloorPlanTabView().environmentObject(bookingsVM)
        case .calendar:
            CalendarView().environmentObject(bookingsVM)
        case .capacity:
            CapacityView().environmentObject(bookingsVM)
        case .staff:
            StaffManagementView().environmentObject(bookingsVM)
        case .giftCards:
            GiftCardView()
        case .sms:
            SMSAdminView()
        case .audit:
            AuditLogView()
        case .emailLogs:
            EmailLogsView()
        case .emailTemplates:
            EmailTemplatesView()
        case .analytics:
            AnalyticsView().environmentObject(bookingsVM)
        case .webmaster:
            WebmasterView()
        case .documentation:
            DocumentationView()
        case .settings:
            AdminSettingsView().environmentObject(bookingsVM)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var bookingsVM = BookingsViewModel()
    @StateObject private var notificationsVM = NotificationsViewModel()
    @State private var isLoading = true
    @State private var loadError: String? = nil
    @State private var loadProgress: Double = 0
    @State private var loadStep: String = "Starting…"

    var body: some View {
        Group {
            if !authVM.isLoggedIn {
                LoginView()
            } else if isLoading {
                PreloaderView(
                    progress: loadProgress,
                    stepText: loadStep,
                    error: loadError,
                    onRetry: { loadData() }
                )
            } else {
                MainTabView()
                    .environmentObject(bookingsVM)
                    .environmentObject(notificationsVM)
            }
        }
        .onChange(of: authVM.isLoggedIn) { loggedIn in
            if loggedIn {
                isLoading = true
                loadData()
            } else {
                isLoading = false
            }
        }
        .task {
            if authVM.isLoggedIn {
                loadData()
            }
        }
    }

    private func loadData() {
        guard let staff = authVM.staff else {
            isLoading = false
            return
        }
        // Clamp persisted studio filter to what this staff member can see
        if let selected = bookingsVM.selectedStudio, !staff.visibleStudios.contains(selected) {
            bookingsVM.selectedStudio = nil
        }
        loadError = nil
        loadProgress = 0
        loadStep = "Loading cache…"

        Task {
            // Step 1: Load cached data (instant)
            await setProgress(0.3, "Loading cache…")
            bookingsVM.loadFromCache()

            let hasCached = await MainActor.run { bookingsVM.bookings.count }

            if hasCached > 0 {
                // We have cached data — show the app immediately, refresh in background
                await setProgress(0.5, "Loaded \(hasCached) bookings")
                await MainActor.run {
                    isLoading = false
                }
                // Now fetch fresh data in the background (user can use the app)
                await bookingsVM.loadBookings(staff: staff)
                await notificationsVM.refreshUnreadCount(staff: staff)
                bookingsVM.startRealtime(staff: staff)
                notificationsVM.startPolling(staff: staff)
            } else {
                // No cached data — must wait for API
                await setProgress(0.6, "Fetching bookings…")
                await bookingsVM.loadBookings(staff: staff)

                let bookingCount = await MainActor.run { bookingsVM.bookings.count }
                if bookingCount == 0 && bookingsVM.isOffline {
                    await MainActor.run {
                        loadError = bookingsVM.error ?? "No data available. Check your connection."
                        loadStep = "Failed"
                    }
                    return
                }

                await setProgress(0.9, "Loaded \(bookingCount) bookings")
                await notificationsVM.refreshUnreadCount(staff: staff)
                bookingsVM.startRealtime(staff: staff)
                notificationsVM.startPolling(staff: staff)

                await MainActor.run {
                    isLoading = false
                }
            }
        }
    }

    private func setProgress(_ value: Double, _ step: String) async {
        await MainActor.run {
            loadProgress = value
            loadStep = step
        }
    }
}

// MARK: - Preloader

struct PreloaderView: View {
    let progress: Double
    let stepText: String
    let error: String?
    let onRetry: () -> Void

    @State private var logoScale: CGFloat = 0.8
    @State private var logoOpacity: Double = 0
    @State private var textOpacity: Double = 0
    @State private var spinnerOpacity: Double = 0

    var body: some View {
        ZStack {
            PPBrand.sage
                .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                Image("BrandLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 80)
                    .scaleEffect(logoScale)
                    .opacity(logoOpacity)

                VStack(spacing: 6) {
                    Text("ADMIN")
                        .font(AppFont.heading(14))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        .tracking(6)
                        .textCase(.uppercase)
                    Text("Pitter Potter")
                        .font(AppFont.body(22, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                    Text("Paint Your Own Pottery Studios")
                        .font(AppFont.body(12, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                }
                .opacity(textOpacity)

                Spacer()

                if let error = error {
                    VStack(spacing: 16) {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 32))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                        Text("Couldn't load data")
                            .font(AppFont.body(14, weight: .bold))
                            .foregroundStyle(PPBrand.charcoal)
                        Text(error)
                            .font(AppFont.body(11))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                        Button {
                            onRetry()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.clockwise")
                                    .font(AppFont.body(12, weight: .bold))
                                Text("Retry")
                                    .font(AppFont.body(13, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(PPBrand.charcoal)
                            .clipShape(Capsule())
                        }
                    }
                    .padding(.bottom, 60)
                } else {
                    VStack(spacing: 14) {
                        // Step text
                        Text(stepText)
                            .font(AppFont.body(13, weight: .semibold))
                            .foregroundStyle(PPBrand.charcoal)

                        // Progress bar
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule()
                                    .fill(PPBrand.charcoal.opacity(0.1))
                                    .frame(height: 6)
                                Capsule()
                                    .fill(PPBrand.charcoal)
                                    .frame(width: geo.size.width * progress, height: 6)
                            }
                        }
                        .frame(width: 200, height: 6)
                    }
                    .opacity(spinnerOpacity)
                    .padding(.bottom, 60)
                }
            }
            .padding(.horizontal, 40)
        }
        .onAppear {
            withAnimation(.easeIn(duration: 0.3)) {
                logoOpacity = 1
            }
            withAnimation(.spring(response: 0.6, dampingFraction: 0.7).delay(0.1)) {
                logoScale = 1.0
            }
            withAnimation(.easeOut(duration: 0.5).delay(0.3)) {
                textOpacity = 1
            }
            withAnimation(.easeOut(duration: 0.4).delay(0.6)) {
                spinnerOpacity = 1
            }
        }
    }
}
