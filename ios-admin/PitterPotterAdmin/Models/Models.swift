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
    let canEposRefunds: Bool
    let canEposDiscounts: Bool
    let canEposManageProducts: Bool
    let canEposStock: Bool
    let allowedStudios: [String]?
    let sessionToken: String

    enum CodingKeys: String, CodingKey {
        case id, name, username, role
        case canUpdateStatus
        case canEditBookings
        case canAddWalkIns
        case canDeleteBookings
        case canEposRefunds
        case canEposDiscounts
        case canEposManageProducts
        case canEposStock
        case allowedStudios
        case sessionToken
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        username = try c.decode(String.self, forKey: .username)
        role = try c.decode(String.self, forKey: .role)
        canUpdateStatus = try c.decode(Bool.self, forKey: .canUpdateStatus)
        canEditBookings = try c.decode(Bool.self, forKey: .canEditBookings)
        canAddWalkIns = try c.decode(Bool.self, forKey: .canAddWalkIns)
        canDeleteBookings = try c.decode(Bool.self, forKey: .canDeleteBookings)
        canEposRefunds = try c.decodeIfPresent(Bool.self, forKey: .canEposRefunds) ?? false
        canEposDiscounts = try c.decodeIfPresent(Bool.self, forKey: .canEposDiscounts) ?? false
        canEposManageProducts = try c.decodeIfPresent(Bool.self, forKey: .canEposManageProducts) ?? false
        canEposStock = try c.decodeIfPresent(Bool.self, forKey: .canEposStock) ?? false
        allowedStudios = try c.decodeIfPresent([String].self, forKey: .allowedStudios)
        sessionToken = try c.decode(String.self, forKey: .sessionToken)
    }

    init(id: String, name: String, username: String, role: String, canUpdateStatus: Bool, canEditBookings: Bool, canAddWalkIns: Bool, canDeleteBookings: Bool, canEposRefunds: Bool, canEposDiscounts: Bool, canEposManageProducts: Bool, canEposStock: Bool = false, allowedStudios: [String]?, sessionToken: String) {
        self.id = id; self.name = name; self.username = username; self.role = role
        self.canUpdateStatus = canUpdateStatus; self.canEditBookings = canEditBookings
        self.canAddWalkIns = canAddWalkIns; self.canDeleteBookings = canDeleteBookings
        self.canEposRefunds = canEposRefunds; self.canEposDiscounts = canEposDiscounts
        self.canEposManageProducts = canEposManageProducts; self.canEposStock = canEposStock
        self.allowedStudios = allowedStudios; self.sessionToken = sessionToken
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
    var canEposRefunds: Bool = false
    var canEposDiscounts: Bool = false
    var canEposManageProducts: Bool = false
    var canEposStock: Bool = false
    var allowedStudios: [String]?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, username, role
        case canUpdateStatus = "can_update_status"
        case canEditBookings = "can_edit_bookings"
        case canAddWalkIns = "can_add_walk_ins"
        case canDeleteBookings = "can_delete_bookings"
        case canEposRefunds = "can_epos_refunds"
        case canEposDiscounts = "can_epos_discounts"
        case canEposManageProducts = "can_epos_manage_products"
        case canEposStock = "can_epos_stock"
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
    var readyAt: String?
    var collectedAt: String?
    var paintedFlag: String?
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
    case bookingFailed = "booking_failed"
    case giftCardPurchased = "gift_card_purchased"
    case giftCardRedeemed = "gift_card_redeemed"
    case collectionReady = "collection_ready"
    case staffAction = "staff_action"
    case eposRefund = "epos_refund"

    var icon: String {
        switch self {
        case .bookingNew: return "calendar.badge.plus"
        case .bookingCancelled: return "calendar.badge.exclamationmark"
        case .bookingStatusChanged: return "checkmark.circle"
        case .bookingWalkIn: return "person.2.fill"
        case .bookingFailed: return "exclamationmark.triangle.fill"
        case .giftCardPurchased: return "giftcard.fill"
        case .giftCardRedeemed: return "giftcard"
        case .collectionReady: return "camera.circle.fill"
        case .staffAction: return "person.badge.shield.checkmark"
        case .eposRefund: return "arrow.uturn.backward.circle.fill"
        }
    }

    var color: String {
        switch self {
        case .bookingNew: return "green"
        case .bookingCancelled: return "red"
        case .bookingStatusChanged: return "blue"
        case .bookingWalkIn: return "indigo"
        case .bookingFailed: return "red"
        case .giftCardPurchased: return "purple"
        case .giftCardRedeemed: return "orange"
        case .collectionReady: return "teal"
        case .staffAction: return "gray"
        case .eposRefund: return "red"
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
        case .bookingFailed: return "Booking Failed (Paid)"
        case .giftCardPurchased: return "Gift Card Purchased"
        case .giftCardRedeemed: return "Gift Card Redeemed"
        case .collectionReady: return "Collection Ready"
        case .staffAction: return "Staff Action"
        case .eposRefund: return "EPOS Refund"
        }
    }
}

// MARK: - EPOS

struct EposCategory: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var slug: String
    var color: String
    var sort_order: Int
    var active: Bool
}

struct EposProduct: Codable, Identifiable, Hashable {
    let id: String
    var category_id: String?
    var name: String
    var sku: String?
    var price: Double
    var vat_treatment: String
    var vat_rate: Double
    var image_url: String?
    var studios: [String]
    var active: Bool
    var track_stock: Bool?   // nil until the stock migration deploys — treat as tracked
    var sort_order: Int
    var tracksStock: Bool { track_stock ?? true }
}

struct EposDiscount: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var kind: String      // "percent" | "fixed"
    var value: Double
    var active: Bool
    var sort_order: Int
}

struct EposOrderItem: Codable, Identifiable, Hashable {
    let id: String
    let order_id: String
    let product_id: String?
    var name: String
    var unit_price: Double
    var quantity: Int
    var vat_treatment: String
    var vat_rate: Double
    var line_total: Double
}

struct EposPayment: Codable, Identifiable, Hashable {
    let id: String
    let order_id: String
    var method: String        // cash | card | voucher | other
    var provider: String
    var amount: Double
    var status: String        // completed | pending | failed | partially_refunded | refunded
    var reference: String?
    var gift_card_id: String?
    var change_given: Double?
    var refunded_amount: Double
    var staff_name: String?
    var created_at: String
}

struct EposOrder: Codable, Identifiable, Hashable {
    let id: String
    var order_number: String
    var studio: String
    var table_id: String?
    var booking_id: String?
    var customer_name: String?
    var label: String?
    var staff_name: String?
    var status: String        // open | partial | paid | void
    var subtotal: Double
    var discount_total: Double
    var vat_total: Double
    var total: Double
    var paid_total: Double
    var discount_label: String?
    var notes: String?
    var created_at: String
    var closed_at: String?

    var outstanding: Double { max(0, total - paid_total) }
}

struct EposTable: Codable, Identifiable, Hashable {
    var id: String { table_id }
    let table_id: String
    var label: String
    var area: String
    var max_capacity: Int
}

struct EposBootstrap: Codable {
    let categories: [EposCategory]
    let products: [EposProduct]
    let discounts: [EposDiscount]
    let stock: [String: StockLevel]?
    let cardProvider: String
}

struct StockLevel: Codable {
    let quantity: Int
    let min_stock: Int
}

// MARK: - Stock & inventory

struct StockStudioInfo: Codable {
    let quantity: Int
    let min_stock: Int
    let reorder_qty: Int
    let qty_sold: Int
    let revenue: Double
    let low: Bool
}

struct StockRow: Codable, Identifiable {
    let id: String
    let name: String
    let sku: String?
    let price: Double
    let image_url: String?
    let category_id: String?
    let category: String
    let track_stock: Bool
    let studios: [String: StockStudioInfo]
}

struct StockOverviewResponse: Codable {
    let rows: [StockRow]
    let studios: [String]
}

struct StockMovement: Codable, Identifiable {
    let id: String
    let product_id: String
    let studio: String
    let change_qty: Int
    let type: String
    let reason: String?
    let order_id: String?
    let staff_name: String?
    let quantity_after: Int
    let created_at: String
    let epos_products: MovementProduct?
    struct MovementProduct: Codable { let name: String }
}

struct ReorderRow: Codable, Identifiable {
    var id: String { "\(product_id)-\(studio)" }
    let product_id: String
    let studio: String
    let quantity: Int
    let min_stock: Int
    let reorder_qty: Int
    let epos_products: ReorderProduct?
    struct ReorderProduct: Codable {
        let name: String
        let sku: String?
        let price: Double
        let active: Bool
        let track_stock: Bool
    }
}

struct StocktakeItem: Codable, Identifiable {
    let id: String
    let product_id: String
    let expected_qty: Int
    let counted_qty: Int
    let difference: Int
    let epos_products: MovementProduct?
    typealias MovementProduct = StockMovement.MovementProduct
}

struct Stocktake: Codable, Identifiable {
    let id: String
    let studio: String
    let note: String?
    let staff_name: String?
    let created_at: String
    let epos_stocktake_items: [StocktakeItem]?
}

struct StockReportRow: Codable, Identifiable {
    var id: String { product_id }
    let product_id: String
    let name: String
    let category: String
    let qty_sold: Int
    let revenue: Double
    let by_studio: [String: StudioSales]
    let received: Int
    let breakages: Int
    let adjustments: Int
    let transfers_in: Int
    let transfers_out: Int
    let stocktake: Int
    struct StudioSales: Codable { let qty: Int; let revenue: Double }
}

struct EposOrderFull: Codable {
    let order: EposOrder
    let items: [EposOrderItem]
    let payments: [EposPayment]
}

struct EposReceiptData: Codable, Identifiable {
    var id: String { order.id }
    let order: EposOrder
    let items: [EposOrderItem]
    let payments: [EposPayment]
    let studio: EposStudioDetail?
    let vatNumber: String?
    let html: String
}

struct EposStudioDetail: Codable {
    let address: String
    let phone: String
}

struct EposSalesReport: Codable {
    let orders: Int
    let gross: Double
    let vat: Double
    let discounts: Double
    let refunds: Double
    let outstanding: Double
    let byStudio: [String: Double]
    let byMethod: [String: Double]
    let byCategory: [String: Double]
    let byVatRate: [String: EposVatBucket]
    let byDay: [String: Double]
    let rawOrders: [EposOrder]
}

struct EposVatBucket: Codable {
    let net: Double
    let vat: Double
    let gross: Double
}
