import Foundation

// MARK: - Staff

struct Staff: Codable, Identifiable {
    let id: String
    let name: String
    let username: String
    let role: String
    let canUpdateStatus: Bool
    let canEditBookings: Bool
    let canAddWalkIns: Bool
    let canDeleteBookings: Bool
    let allowedStudios: [String]?
    let sessionToken: String

    enum CodingKeys: String, CodingKey {
        case id, name, username, role
        case canUpdateStatus
        case canEditBookings
        case canAddWalkIns
        case canDeleteBookings
        case allowedStudios
        case sessionToken
    }

    var isSuperAdmin: Bool { role == "super_admin" }

    /// Studios this staff member can see. Super admins always see all
    /// studios; other staff are restricted to `allowedStudios` (empty/nil
    /// means all).
    var visibleStudios: [Studio] {
        if isSuperAdmin { return Studio.allCases }
        guard let allowed = allowedStudios, !allowed.isEmpty else {
            return Studio.allCases
        }
        return allowed.compactMap { Studio(rawValue: $0) }
    }
}

// MARK: - Staff Member (for staff management)

struct StaffMember: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var username: String
    var role: String
    var canUpdateStatus: Bool
    var canEditBookings: Bool
    var canAddWalkIns: Bool
    var canDeleteBookings: Bool
    var allowedStudios: [String]?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, username, role
        case canUpdateStatus = "can_update_status"
        case canEditBookings = "can_edit_bookings"
        case canAddWalkIns = "can_add_walk_ins"
        case canDeleteBookings = "can_delete_bookings"
        case allowedStudios = "allowed_studios"
        case createdAt = "created_at"
    }

    var isSuperAdmin: Bool { role == "super_admin" }
    var roleLabel: String { role == "super_admin" ? "Super Admin" : "Staff" }
}

// MARK: - Booking

enum BookingStatus: String, Codable, CaseIterable {
    case pending
    case confirmed
    case seated
    case completed
    case cancelled
    case noShow = "no_show"

    var label: String {
        switch self {
        case .pending: return "Pending"
        case .confirmed: return "Confirmed"
        case .seated: return "Seated"
        case .completed: return "Completed"
        case .cancelled: return "Cancelled"
        case .noShow: return "No Show"
        }
    }

    var color: String {
        switch self {
        case .confirmed: return "green"
        case .cancelled: return "red"
        case .seated: return "orange"
        case .completed: return "teal"
        case .pending: return "yellow"
        case .noShow: return "red"
        }
    }
}

enum SessionType: String, Codable, CaseIterable {
    case painting
    case birthdayParty = "birthday-party"
    case babyShowerHen = "baby-shower-hen"
    case clayImprints = "clay-imprints"
    case corporate
    case exclusiveHire = "exclusive-hire"
    case sipAndPaint = "sip-and-paint"

    var label: String {
        switch self {
        case .painting: return "Painting"
        case .birthdayParty: return "Birthday Party"
        case .babyShowerHen: return "Baby Shower / Hen"
        case .clayImprints: return "Baby Prints"
        case .corporate: return "Corporate"
        case .exclusiveHire: return "Exclusive Hire"
        case .sipAndPaint: return "Sip & Paint"
        }
    }
}

enum Studio: String, Codable, CaseIterable {
    case Putney
    case Wimbledon
}

struct Booking: Codable, Identifiable, Hashable {
    var id: String
    var studio: String
    var name: String
    var email: String?
    var phone: String?
    var date: String
    var time: String
    var paintersCount: Int
    var sessionType: String
    var notes: String?
    var status: String
    var requestDate: String?
    var estimatedPrice: Double?
    var source: String?
    var giftCardCode: String?
    var giftCardDiscount: Double?
    var finalPrice: Double?
    var tableId: String?
    var depositAmount: Double?
    var finalSeats: Int?
    var finalBalance: Double?
    var paymentLinkUrl: String?
    var paymentLinkSentAt: String?
    var paymentStatus: String?
    var stripePaymentIntentId: String?
    var managementToken: String?
    var createdAt: String?
    var photos: [String]?
    var collectionStatus: String?
    var collectedAt: String?
    var photoTags: [String: [PhotoTag]]?

    var bookingStatus: BookingStatus? {
        BookingStatus(rawValue: status)
    }

    var sessionTypeEnum: SessionType? {
        SessionType(rawValue: sessionType)
    }

    var studioEnum: Studio? {
        Studio(rawValue: studio)
    }
}

// MARK: - Photo Tag

struct PhotoTag: Codable, Identifiable, Hashable {
    var id: String?
    var label: String?
    var status: String
    var x: Double
    var y: Double

    enum CodingKeys: String, CodingKey {
        case id, label, status, x, y
    }
}

// MARK: - Collection Stage

enum CollectionStage: String, CaseIterable {
    case painted
    case ready
    case collected

    var label: String {
        switch self {
        case .painted: return "Painted"
        case .ready: return "Ready to Collect"
        case .collected: return "Collected"
        }
    }
}

// MARK: - Notification

enum NotificationType: String, Codable {
    case bookingNew = "booking_new"
    case bookingCancelled = "booking_cancelled"
    case bookingStatusChanged = "booking_status_changed"
    case bookingWalkIn = "booking_walk_in"
    case giftCardPurchased = "gift_card_purchased"
    case giftCardRedeemed = "gift_card_redeemed"
    case collectionReady = "collection_ready"
    case staffAction = "staff_action"

    var icon: String {
        switch self {
        case .bookingNew: return "calendar.badge.plus"
        case .bookingCancelled: return "calendar.badge.exclamationmark"
        case .bookingStatusChanged: return "checkmark.circle"
        case .bookingWalkIn: return "person.2.fill"
        case .giftCardPurchased: return "giftcard.fill"
        case .giftCardRedeemed: return "giftcard"
        case .collectionReady: return "camera.circle.fill"
        case .staffAction: return "person.badge.shield.checkmark"
        }
    }

    var color: String {
        switch self {
        case .bookingNew: return "green"
        case .bookingCancelled: return "red"
        case .bookingStatusChanged: return "blue"
        case .bookingWalkIn: return "indigo"
        case .giftCardPurchased: return "purple"
        case .giftCardRedeemed: return "orange"
        case .collectionReady: return "teal"
        case .staffAction: return "gray"
        }
    }
}

struct AppNotification: Codable, Identifiable {
    let id: String
    let type: NotificationType
    let title: String
    let message: String
    let entityType: String?
    let entityId: String?
    let studio: String?
    let readAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, type, title, message
        case entityType = "entity_type"
        case entityId = "entity_id"
        case studio
        case readAt = "read_at"
        case createdAt = "created_at"
    }

    var isRead: Bool { readAt != nil }
}

struct NotificationsResponse: Codable {
    let notifications: [AppNotification]?
}

struct UnreadCountResponse: Codable {
    let count: Int
}

struct NotificationSetting: Codable, Identifiable {
    let id: String
    let type: NotificationType
    var enabled: Bool
    var studio: String
    var customTitle: String?
    var customMessage: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, type, enabled, studio
        case customTitle = "custom_title"
        case customMessage = "custom_message"
        case updatedAt = "updated_at"
    }
}

struct NotificationSettingsResponse: Codable {
    let settings: [NotificationSetting]?
}

extension NotificationType {
    var label: String {
        switch self {
        case .bookingNew: return "New Booking"
        case .bookingCancelled: return "Booking Cancelled"
        case .bookingStatusChanged: return "Booking Status Changed"
        case .bookingWalkIn: return "Walk-in Booking"
        case .giftCardPurchased: return "Gift Card Purchased"
        case .giftCardRedeemed: return "Gift Card Redeemed"
        case .collectionReady: return "Collection Ready"
        case .staffAction: return "Staff Action"
        }
    }
}
