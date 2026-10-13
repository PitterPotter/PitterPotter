import SwiftUI

struct NotificationsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @StateObject private var notificationsVM = NotificationsViewModel()
    @Environment(\.dismiss) var dismiss

    /// Notifications scoped to the active location — global ones (no studio
    /// or "All") always show.
    private var visibleNotifications: [AppNotification] {
        guard let studio = bookingsVM.selectedStudio else { return notificationsVM.notifications }
        return notificationsVM.notifications.filter {
            $0.studio == nil || $0.studio == "All" || $0.studio == studio.rawValue
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if notificationsVM.isLoading && notificationsVM.notifications.isEmpty {
                    VStack(spacing: 12) {
                        ProgressView()
                            .tint(PPBrand.charcoal)
                        Text("Loading notifications...")
                            .font(PPBrand.bodyFontSmall)
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                } else if visibleNotifications.isEmpty {
                    EmptyStateView(
                        icon: "bell.slash",
                        title: "No Notifications",
                        subtitle: "You're all caught up!"
                    )
                } else {
                    List {
                        if visibleNotifications.contains(where: { !$0.isRead }) {
                            Section {
                                Button {
                                    Task {
                                        await notificationsVM.markAllAsRead(staff: authVM.staff!)
                                    }
                                } label: {
                                    HStack(spacing: 8) {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.blue)
                                        Text("Mark all as read")
                                            .font(AppFont.body(14, weight: .medium))
                                            .foregroundStyle(PPBrand.charcoal)
                                    }
                                }
                            }
                        }

                        Section {
                            ForEach(visibleNotifications) { notif in
                                NotificationRow(notification: notif)
                                    .onTapGesture {
                                        guard let staff = authVM.staff else { return }
                                        Task {
                                            await notificationsVM.markAsRead(notif, staff: staff)
                                        }
                                    }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .font(AppFont.body(16, weight: .medium))
                }
            }
        }
        .task {
            if let staff = authVM.staff {
                await notificationsVM.loadNotifications(staff: staff)
            }
        }
    }
}

private struct NotificationRow: View {
    let notification: AppNotification

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.12))
                    .frame(width: 40, height: 40)
                Image(systemName: notification.type.icon)
                    .font(AppFont.body(16, weight: .medium))
                    .foregroundStyle(color)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(notification.title)
                        .font(AppFont.body(14, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal)
                        .lineLimit(1)

                    if !notification.isRead {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 7, height: 7)
                    }
                }

                Text(notification.message)
                    .font(AppFont.body(12))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text(timeAgo(notification.createdAt))
                        .font(AppFont.body(10, weight: .medium))
                        .foregroundStyle(.tertiary)

                    if let studio = notification.studio {
                        Text("· \(studio)")
                            .font(AppFont.body(10, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .listRowBackground(notification.isRead ? Color.clear : Color.blue.opacity(0.04))
    }

    private var color: Color {
        switch notification.type.color {
        case "green": return .green
        case "red": return .red
        case "blue": return .blue
        case "indigo": return .indigo
        case "purple": return .purple
        case "orange": return .orange
        case "teal": return .teal
        default: return .gray
        }
    }

    private func timeAgo(_ dateStr: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateStr) else { return "" }
        let diff = Date().timeIntervalSince(date)
        let mins = Int(diff / 60)
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins)m ago" }
        let hours = mins / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return PPDateDisplay.date(dateStr)
    }
}
