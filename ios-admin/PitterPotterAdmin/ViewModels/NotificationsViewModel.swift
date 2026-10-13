import Foundation
import SwiftUI

@MainActor
class NotificationsViewModel: ObservableObject {
    @Published var notifications: [AppNotification] = []
    @Published var unreadCount: Int = 0
    @Published var isLoading = false

    private var pollTimer: Timer?

    func loadNotifications(staff: Staff) async {
        isLoading = true
        do {
            let result = try await APIClient.shared.fetchNotifications(staff: staff, limit: 50)
            notifications = result
            unreadCount = result.filter { !$0.isRead }.count
        } catch {
            print("Failed to load notifications: \(error)")
        }
        isLoading = false
    }

    func refreshUnreadCount(staff: Staff) async {
        do {
            // Fetch the list too so the badge can be scoped per-location
            let result = try await APIClient.shared.fetchNotifications(staff: staff, limit: 50)
            notifications = result
            unreadCount = result.filter { !$0.isRead }.count
        } catch {
            // ignore
        }
    }

    /// Unread count scoped to a location. nil studio = all locations.
    /// Notifications with no studio (or "All") are global and always count.
    func unreadCount(studio: Studio?) -> Int {
        guard let studio = studio else { return unreadCount }
        return notifications.filter {
            !$0.isRead && ($0.studio == nil || $0.studio == "All" || $0.studio == studio.rawValue)
        }.count
    }

    func markAsRead(_ notification: AppNotification, staff: Staff) async {
        do {
            try await APIClient.shared.markNotificationRead(id: notification.id, staff: staff)
            if let idx = notifications.firstIndex(where: { $0.id == notification.id }) {
                let updated = AppNotification(
                    id: notification.id,
                    type: notification.type,
                    title: notification.title,
                    message: notification.message,
                    entityType: notification.entityType,
                    entityId: notification.entityId,
                    studio: notification.studio,
                    readAt: ISO8601DateFormatter().string(from: Date()),
                    createdAt: notification.createdAt
                )
                notifications[idx] = updated
            }
            unreadCount = max(0, unreadCount - 1)
        } catch {
            print("Failed to mark notification as read: \(error)")
        }
    }

    func markAllAsRead(staff: Staff) async {
        do {
            try await APIClient.shared.markAllNotificationsRead(staff: staff)
            notifications = notifications.map { n in
                AppNotification(
                    id: n.id,
                    type: n.type,
                    title: n.title,
                    message: n.message,
                    entityType: n.entityType,
                    entityId: n.entityId,
                    studio: n.studio,
                    readAt: n.readAt ?? ISO8601DateFormatter().string(from: Date()),
                    createdAt: n.createdAt
                )
            }
            unreadCount = 0
        } catch {
            print("Failed to mark all as read: \(error)")
        }
    }

    func startPolling(staff: Staff) {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 60.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            Task { @MainActor in
                await self.refreshUnreadCount(staff: staff)
            }
        }
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}
