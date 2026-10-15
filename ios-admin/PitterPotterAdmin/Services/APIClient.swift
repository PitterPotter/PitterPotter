import Foundation

// MARK: - API Configuration

enum APIConfig {
    static let supabaseURL = "https://xjtfjlhykfvkckziyvxk.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqdGZqbGh5a2Z2a2Nreml5dnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzA4NzcsImV4cCI6MjA5NzkwNjg3N30.Spa_MrOdkjuRCZA3FcRD9uI18hPahMWiQjqTvFEXFGw"

    static let bookingsEndpoint = "\(supabaseURL)/functions/v1/admin-bookings"
    static let loginEndpoint = "\(supabaseURL)/functions/v1/staff-login"
    static let contentEndpoint = "\(supabaseURL)/functions/v1/admin-content"
    static let staffManagementEndpoint = "\(supabaseURL)/functions/v1/staff-management"
    static let partyReminderEndpoint = "\(supabaseURL)/functions/v1/send-party-final-reminder"
    static let capacityEndpoint = "\(supabaseURL)/functions/v1/get-capacity"
    static let settingsEndpoint = "\(supabaseURL)/functions/v1/admin-settings"
    static let giftCardsEndpoint = "\(supabaseURL)/functions/v1/admin-gift-cards"
    static let partyDepositEndpoint = "\(supabaseURL)/functions/v1/create-party-deposit-payment"
    static let emailTemplatesEndpoint = "\(supabaseURL)/functions/v1/admin-email-templates"
    static let dbHealthEndpoint = "\(supabaseURL)/functions/v1/db-health"
    static let dbBackupEndpoint = "\(supabaseURL)/functions/v1/db-backup"
    static let sampleDataEndpoint = "\(supabaseURL)/functions/v1/sample-data"
    static let pageSettingsEndpoint = "\(supabaseURL)/functions/v1/page-settings"
    static let notificationsEndpoint = "\(supabaseURL)/functions/v1/admin-notifications"
}

// MARK: - API Client

actor APIClient {
    static let shared = APIClient()

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 180
        session = URLSession(configuration: config)
    }

    // MARK: - Auth

    func login(username: String, password: String) async throws -> Staff {
        var request = URLRequest(url: URL(string: APIConfig.loginEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(["username": username, "password": password])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.invalidCredentials
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Login failed")
        }
        return try JSONDecoder().decode(Staff.self, from: data)
    }

    // MARK: - Bookings

    func loadBookings(staff: Staff) async throws -> [Booking] {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "load",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to load bookings (status \(http.statusCode))")
        }
        // Decode off the main thread for large payloads
        return try await Task.detached(priority: .userInitiated) {
            do {
                return try JSONDecoder().decode([Booking].self, from: data)
            } catch {
                print("❌ Booking decode error: \(error)")
                if let str = String(data: data, encoding: .utf8) {
                    print("❌ Response preview: \(str.prefix(500))")
                }
                throw APIError.serverError("Failed to decode bookings: \(error.localizedDescription)")
            }
        }.value
    }

    func updateBooking(_ booking: Booking, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let bookingDict = try booking.toDictionary()
        let body: [String: Any] = [
            "action": "update",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "booking": bookingDict,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update booking")
        }
    }

    /// Partial update — sends only the given fields so a stale local copy can
    /// never overwrite columns it didn't intend to change. `fields` uses the
    /// same camelCase keys as `toDictionary()` (e.g. "notes", "photoTags");
    /// pass NSNull() to clear a field.
    func updateBookingFields(id: String, studio: String, fields: [String: Any], staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        var bookingDict: [String: Any] = ["id": id, "studio": studio]
        for (key, value) in fields {
            bookingDict[key] = value
        }
        let body: [String: Any] = [
            "action": "patch",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "booking": bookingDict,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to save booking")
        }
    }

    /// Encodes an optional Encodable value to a JSON-safe object for patch fields.
    static func jsonPatchValue<T: Encodable>(_ value: T?) throws -> Any {
        guard let value else { return NSNull() }
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }

    func updateBookingStatus(id: String, status: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "updateStatus",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
            "status": status,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update status")
        }
    }

    // MARK: - Create Booking

    func createBooking(_ booking: Booking, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let bookingDict = try booking.toDictionary()
        let body: [String: Any] = [
            "action": "create",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "booking": bookingDict,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        if http.statusCode == 403 {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Not permitted")
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to create booking")
        }
    }

    // MARK: - Staff Management

    func loadStaff(staff: Staff) async throws -> [StaffMember] {
        var request = URLRequest(url: URL(string: APIConfig.staffManagementEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "list",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to load staff")
        }
        let result = try JSONDecoder().decode(StaffListResponse.self, from: data)
        return result.staff ?? []
    }

    func createStaff(_ member: StaffMember, password: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.staffManagementEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "create",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "staff": [
                "name": member.name,
                "username": member.username,
                "password": password,
                "role": member.role,
                "canUpdateStatus": member.canUpdateStatus,
                "canEditBookings": member.canEditBookings,
                "canAddWalkIns": member.canAddWalkIns,
                "canDeleteBookings": member.canDeleteBookings,
                "allowedStudios": member.allowedStudios ?? [],
            ],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to create staff member")
        }
    }

    func updateStaff(_ member: StaffMember, password: String?, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.staffManagementEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        var staffDict: [String: Any] = [
            "id": member.id,
            "name": member.name,
            "role": member.role,
            "canUpdateStatus": member.canUpdateStatus,
            "canEditBookings": member.canEditBookings,
            "canAddWalkIns": member.canAddWalkIns,
            "canDeleteBookings": member.canDeleteBookings,
            "allowedStudios": member.allowedStudios ?? [],
        ]
        if let pw = password, !pw.isEmpty {
            staffDict["password"] = pw
        }

        let body: [String: Any] = [
            "action": "update",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "staff": staffDict,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update staff member")
        }
    }

    func deleteStaff(id: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.staffManagementEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "delete",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "staff": ["id": id],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to delete staff member")
        }
    }

    // MARK: - Change Own Password

    /// Changes the logged-in staff member's own password.
    /// Verifies the current password by attempting a login (the existing
    /// session remains valid thanks to multi-session support), then updates
    /// the password via the staff-management `update` action.
    func changeOwnPassword(currentPassword: String, newPassword: String, staff: Staff) async throws {
        // Verify the current password by attempting a login. This does not
        // invalidate the existing session because `staff_sessions` keeps the
        // old token row (the edge function only inserts a new row).
        _ = try await login(username: staff.username, password: currentPassword)

        var request = URLRequest(url: URL(string: APIConfig.staffManagementEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "update",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "staff": [
                "id": staff.id,
                "name": staff.name,
                "role": staff.role,
                "password": newPassword,
            ],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to change password")
        }
    }

    func deleteBooking(id: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "delete",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        if http.statusCode == 403 {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Not permitted")
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to delete booking")
        }
    }

    // MARK: - Payment Reminder

    func sendPaymentReminder(bookingId: String, finalSeats: Int, staff: Staff) async throws -> (paymentLinkUrl: String?, finalBalance: Double?) {
        var request = URLRequest(url: URL(string: APIConfig.partyReminderEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "bookingId": bookingId,
            "finalSeats": finalSeats,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to send payment reminder")
        }
        let result = try? JSONDecoder().decode(PaymentReminderResponse.self, from: data)
        return (result?.paymentLinkUrl, result?.finalBalance)
    }

    // MARK: - Capacity

    func checkCapacity(studio: String, date: String, time: String, sessionType: String?) async throws -> CapacityResult {
        var request = URLRequest(url: URL(string: APIConfig.capacityEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        var body: [String: Any] = [
            "studio": studio,
            "date": date,
            "time": time,
        ]
        if let st = sessionType { body["sessionType"] = st }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        return try JSONDecoder().decode(CapacityResult.self, from: data)
    }

    // MARK: - Audit Logs

    func loadAuditLogs(staff: Staff, limit: Int = 100) async throws -> [AuditLog] {
        var request = URLRequest(url: URL(string: APIConfig.settingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "getAuditLogs",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "limit": limit,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to load audit logs")
        }
        let result = try JSONDecoder().decode(AuditLogResponse.self, from: data)
        return result.logs ?? []
    }

    // MARK: - Gift Cards

    func loadGiftCards(staff: Staff) async throws -> [GiftCard] {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "list",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to load gift cards")
        }
        let result = try JSONDecoder().decode(GiftCardResponse.self, from: data)
        return result.giftCards ?? []
    }

    func updateGiftCardStatus(id: String, status: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "updateStatus",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
            "status": status,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update gift card")
        }
    }

    func unredeemGiftCard(id: String, staff: Staff) async throws -> Double {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "unredeem",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to un-redeem gift card")
        }
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["balance"] as? Double ?? 0
    }

    func deleteGiftCard(id: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "delete",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to delete gift card")
        }
    }

    func resendGiftCard(id: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "resend",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to resend email")
        }
    }

    func downloadGiftCardVoucher(id: String, staff: Staff) async throws -> Data {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "downloadVoucher",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to download voucher")
        }
        return data
    }

    // MARK: - Party Deposit Payment

    func createPartyDepositPayment(bookingId: String, depositAmount: Double, staff: Staff) async throws -> String? {
        var request = URLRequest(url: URL(string: APIConfig.partyDepositEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "bookingId": bookingId,
            "depositAmount": depositAmount,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to create deposit payment")
        }
        let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return result?["url"] as? String
    }

    // MARK: - Settings (load/update key-value)

    func loadSetting(key: String, staff: Staff) async throws -> String? {
        var request = URLRequest(url: URL(string: APIConfig.settingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "load",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "key": key,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        return result?["value"] as? String
    }

    func updateSetting(key: String, value: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.settingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "update",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "key": key,
            "value": value,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update setting")
        }
    }

    // MARK: - Capacity Table (load/update)

    func loadCapacityTable(staff: Staff) async throws -> [CapacityRow] {
        var request = URLRequest(url: URL(string: APIConfig.settingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "loadCapacity",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try JSONDecoder().decode(CapacityTableResponse.self, from: data)
        return result.capacity ?? []
    }

    func updateCapacityRow(studio: String, sessionType: String, maxPainters: Int, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.settingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "updateCapacity",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "studio": studio,
            "sessionType": sessionType,
            "maxPainters": maxPainters,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update capacity")
        }
    }

    // MARK: - Email Logs

    func loadEmailLogs(staff: Staff, limit: Int = 100) async throws -> [EmailLog] {
        var request = URLRequest(url: URL(string: APIConfig.settingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "getEmailLogs",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "limit": limit,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to load email logs")
        }
        let result = try JSONDecoder().decode(EmailLogResponse.self, from: data)
        return result.logs ?? []
    }

    // MARK: - Email Templates

    func loadEmailTemplates(staff: Staff) async throws -> [EmailTemplate] {
        var request = URLRequest(url: URL(string: APIConfig.emailTemplatesEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "load",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try JSONDecoder().decode(EmailTemplateResponse.self, from: data)
        return result.templates ?? []
    }

    func updateEmailTemplate(templateKey: String, subject: String, htmlContent: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.emailTemplatesEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "update",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "templateKey": templateKey,
            "subject": subject,
            "htmlContent": htmlContent,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to save template")
        }
    }

    // MARK: - Page Settings

    func loadPageSettings(staff: Staff) async throws -> [PageSetting] {
        var request = URLRequest(url: URL(string: APIConfig.pageSettingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "load",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try JSONDecoder().decode(PageSettingsResponse.self, from: data)
        return result.pages ?? []
    }

    func updatePageSetting(pageKey: String, enabled: Bool, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.pageSettingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "update",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "pageKey": pageKey,
            "enabled": enabled,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update page setting")
        }
    }

    // MARK: - DB Health

    func loadDbHealth(staff: Staff) async throws -> DbHealth {
        var request = URLRequest(url: URL(string: APIConfig.dbHealthEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        return try JSONDecoder().decode(DbHealth.self, from: data)
    }

    // MARK: - DB Backup

    func loadDbBackups(staff: Staff) async throws -> [DbBackup] {
        var request = URLRequest(url: URL(string: APIConfig.dbBackupEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "list",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try JSONDecoder().decode(DbBackupResponse.self, from: data)
        return result.backups ?? []
    }

    func createDbBackup(tables: [String], staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.dbBackupEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "create",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "tables": tables,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to create backup")
        }
    }

    func deleteDbBackup(id: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.dbBackupEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "delete",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to delete backup")
        }
    }

    // MARK: - Sample Data

    func loadSampleDataStatus(staff: Staff) async throws -> SampleDataStatus {
        var request = URLRequest(url: URL(string: APIConfig.sampleDataEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "status",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        return try JSONDecoder().decode(SampleDataStatus.self, from: data)
    }

    func addSampleData(staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.sampleDataEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "add",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to add sample data")
        }
    }

    func removeSampleData(staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.sampleDataEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "remove",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to remove sample data")
        }
    }

    // MARK: - Gift Card Creation

    func createGiftCard(amount: Double, covers: String = "", recipientName: String, recipientEmail: String, senderName: String, message: String, staff: Staff, isPhysical: Bool = false) async throws -> GiftCard {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        var body: [String: Any] = [
            "action": "create",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "amount": amount,
            "recipientName": recipientName,
            "recipientEmail": recipientEmail,
            "senderName": senderName,
            "message": message,
        ]
        if !covers.isEmpty {
            body["covers"] = covers
        }
        if isPhysical {
            body["isPhysical"] = true
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to create gift card")
        }
        return try JSONDecoder().decode(GiftCard.self, from: data)
    }

    // MARK: - Gift Card Balance & Redemption

    func checkGiftCardBalance(code: String, staff: Staff) async throws -> GiftCardBalanceResult {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "balance",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "code": code,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Gift card not found")
        }
        return try JSONDecoder().decode(GiftCardBalanceResult.self, from: data)
    }

    func redeemGiftCard(code: String, amount: Double, staff: Staff) async throws -> GiftCardRedeemResult {
        var request = URLRequest(url: URL(string: APIConfig.giftCardsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "redeem",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "code": code,
            "amount": amount,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to redeem gift card")
        }
        return try JSONDecoder().decode(GiftCardRedeemResult.self, from: data)
    }

    // MARK: - Photo Upload

    func uploadPhoto(imageData: Data, fileName: String, bookingId: String, staff: Staff) async throws -> String {
        let base64 = imageData.base64EncodedString()
        let dataUrl = "data:image/jpeg;base64,\(base64)"

        var request = URLRequest(url: URL(string: APIConfig.contentEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "upload",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "key": "booking_\(bookingId)_photo_\(Int(Date().timeIntervalSince1970 * 1000))",
            "page": "booking-photos",
            "fileData": dataUrl,
            "fileName": fileName,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Upload failed")
        }

        let result = try JSONDecoder().decode(UploadResponse.self, from: data)
        return result.url
    }

    // MARK: - Collection Status

    func blockStudio(studio: String, date: String, startTime: String, endTime: String, label: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "blockStudio",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "studio": studio,
            "date": date,
            "startTime": startTime,
            "endTime": endTime,
            "label": label,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to block studio")
        }
    }

    func updateCollectionStatus(bookingId: String, studio: String, status: String, staff: Staff, location: String? = nil, collectedAt: String? = nil, readyAt: String? = nil) async throws {
        var request = URLRequest(url: URL(string: APIConfig.bookingsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        var body: [String: Any] = [
            "action": "updateCollection",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": bookingId,
            "collectionStatus": status,
        ]
        if let location { body["location"] = location }
        if let collectedAt { body["collectedAt"] = collectedAt }
        if let readyAt { body["readyAt"] = readyAt }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard http.statusCode == 200 else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw APIError.serverError(error?.error ?? "Failed to update collection status")
        }
    }

    func sendCollectionReady(bookingId: String, staff: Staff) async throws {
        let endpoint = "\(APIConfig.supabaseURL)/functions/v1/send-collection-ready"
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = ["bookingId": bookingId]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
    }

    // MARK: - SMS Admin

    func loadSmsBalance(staff: Staff) async throws -> (balance: String, currency: String) {
        let endpoint = "\(APIConfig.supabaseURL)/functions/v1/admin-sms"
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "balance",
            "staff": ["username": staff.username, "sessionToken": staff.sessionToken],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try JSONDecoder().decode(SmsBalanceResponse.self, from: data)
        return (result.balance, result.currency)
    }

    func loadSmsUsage(staff: Staff) async throws -> SmsUsageData {
        let endpoint = "\(APIConfig.supabaseURL)/functions/v1/admin-sms"
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "usage",
            "days": 30,
            "staff": ["username": staff.username, "sessionToken": staff.sessionToken],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        return try JSONDecoder().decode(SmsUsageData.self, from: data)
    }

    func loadSmsTemplates(staff: Staff) async throws -> [SmsTemplate] {
        let endpoint = "\(APIConfig.supabaseURL)/functions/v1/admin-sms"
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "templates",
            "staff": ["username": staff.username, "sessionToken": staff.sessionToken],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try JSONDecoder().decode(SmsTemplatesResponse.self, from: data)
        return result.templates ?? []
    }

    func updateSmsTemplate(templateKey: String, body text: String, staff: Staff) async throws {
        let endpoint = "\(APIConfig.supabaseURL)/functions/v1/admin-sms"
        var request = URLRequest(url: URL(string: endpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "update_template",
            "staff": ["username": staff.username, "sessionToken": staff.sessionToken],
            "templateKey": templateKey,
            "body": text,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
    }
    // MARK: - Notifications

    func fetchNotifications(staff: Staff, limit: Int = 50) async throws -> [AppNotification] {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "list",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "limit": limit,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        let result = try JSONDecoder().decode(NotificationsResponse.self, from: data)
        return result.notifications ?? []
    }

    func fetchUnreadNotificationCount(staff: Staff) async throws -> Int {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "unreadCount",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return 0
        }
        let result = try JSONDecoder().decode(UnreadCountResponse.self, from: data)
        return result.count
    }

    func markNotificationRead(id: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "markRead",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
    }

    func markAllNotificationsRead(staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "markAllRead",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
    }

    // MARK: - Notification Settings

    func fetchNotificationSettings(staff: Staff) async throws -> [NotificationSetting] {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "loadSettings",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return []
        }
        let result = try JSONDecoder().decode(NotificationSettingsResponse.self, from: data)
        return result.settings ?? []
    }

    func updateNotificationSetting(id: String, enabled: Bool?, customTitle: String?, customMessage: String?, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        var body: [String: Any] = [
            "action": "updateSetting",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        if let enabled = enabled { body["enabled"] = enabled }
        if let customTitle = customTitle { body["customTitle"] = customTitle }
        if let customMessage = customMessage { body["customMessage"] = customMessage }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
    }

    func addNotificationSetting(type: NotificationType, studio: String, staff: Staff) async throws -> NotificationSetting? {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "addSetting",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "type": type.rawValue,
            "studio": studio,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return nil
        }
        return try JSONDecoder().decode(NotificationSetting.self, from: data)
    }

    func deleteNotificationSetting(id: String, staff: Staff) async throws {
        var request = URLRequest(url: URL(string: APIConfig.notificationsEndpoint)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(APIConfig.supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "action": "deleteSetting",
            "username": staff.username,
            "sessionToken": staff.sessionToken,
            "id": id,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.invalidResponse
        }
    }
}

// MARK: - Helpers

extension Booking {
    func toDictionary() throws -> [String: Any] {
        let data = try JSONEncoder().encode(self)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        return dict
    }
}

// MARK: - Response Types

struct ErrorResponse: Codable {
    let error: String?
}

struct UploadResponse: Codable {
    let url: String
}

struct StaffListResponse: Codable {
    let staff: [StaffMember]?
}

struct PaymentReminderResponse: Codable {
    let paymentLinkUrl: String?
    let finalBalance: Double?
}

struct CapacityResult: Codable {
    let remaining: Int
    let max: Int
    let booked: Int
    let hasPartyBooking: Bool
    let conflict: String?
}

struct AuditLog: Codable, Identifiable {
    let id: String
    let staffId: String?
    let username: String?
    let action: String
    let entity: String
    let entityId: String?
    let details: [String: AnyCodable]?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, staffId = "staff_id", username, action, entity
        case entityId = "entity_id", details, createdAt = "created_at"
    }
}

struct AnyCodable: Codable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let intVal = try? container.decode(Int.self) { value = intVal }
        else if let doubleVal = try? container.decode(Double.self) { value = doubleVal }
        else if let boolVal = try? container.decode(Bool.self) { value = boolVal }
        else if let stringVal = try? container.decode(String.self) { value = stringVal }
        else { value = "" }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let intVal = value as? Int { try container.encode(intVal) }
        else if let doubleVal = value as? Double { try container.encode(doubleVal) }
        else if let boolVal = value as? Bool { try container.encode(boolVal) }
        else if let stringVal = value as? String { try container.encode(stringVal) }
        else { try container.encodeNil() }
    }
}

struct AuditLogResponse: Codable {
    let logs: [AuditLog]?
}

struct GiftCard: Codable, Identifiable {
    let id: String
    var code: String
    var amount: Double
    var balance: Double?
    var status: String
    var covers: String?
    var recipientName: String?
    var recipientEmail: String?
    var recipientPhone: String?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, code, amount, balance, status, covers
        case recipientName = "recipient_name"
        case recipientEmail = "recipient_email"
        case recipientPhone = "recipient_phone"
        case createdAt = "created_at"
    }

    var isActivityVoucher: Bool { !(covers ?? "").isEmpty }

    var statusLabel: String {
        status.capitalized
    }

    var statusColor: String {
        switch status {
        case "active": return "green"
        case "redeemed": return "teal"
        case "expired": return "orange"
        case "cancelled": return "red"
        default: return "gray"
        }
    }
}

struct GiftCardResponse: Codable {
    let giftCards: [GiftCard]?
}

struct GiftCardBalanceResult: Codable {
    let id: String
    let code: String
    let amount: Double
    let balance: Double
    let status: String
    let covers: String?
    let recipientName: String?
    let recipientEmail: String?
    let expiryDate: String?

    var isActivityVoucher: Bool { !(covers ?? "").isEmpty }

    enum CodingKeys: String, CodingKey {
        case id, code, amount, balance, status, covers
        case recipientName = "recipient_name"
        case recipientEmail = "recipient_email"
        case expiryDate = "expiry_date"
    }
}

struct GiftCardRedeemResult: Codable {
    let success: Bool
    let code: String
    let discount: Double
    let balance: Double
    let status: String
}

struct CapacityRow: Codable, Identifiable {
    var id: String { "\(studio)-\(sessionType)" }
    let studio: String
    let sessionType: String
    var maxPainters: Int

    enum CodingKeys: String, CodingKey {
        case studio
        case sessionType = "session_type"
        case maxPainters = "max_painters"
    }

    var sessionLabel: String {
        switch sessionType {
        case "open": return "Painting — Full Studio"
        case "open_restricted": return "Painting — Front Only"
        case "party": return "Party (Back Tables)"
        default: return sessionType
        }
    }
}

struct CapacityTableResponse: Codable {
    let capacity: [CapacityRow]?
}

struct EmailLog: Codable, Identifiable {
    let id: String
    let createdAt: String?
    let emailType: String?
    let recipient: String?
    let subject: String?
    let status: String?
    let bookingId: String?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case id
        case createdAt = "created_at"
        case emailType = "email_type"
        case recipient, subject, status
        case bookingId = "booking_id"
        case error
    }

    var typeLabel: String {
        switch emailType ?? "" {
        case "admin_booking_notification": return "Admin Notify"
        case "booking_confirmation": return "Confirmation"
        case "party_final_reminder": return "Party Reminder"
        case "general": return "General"
        default: return emailType ?? "Unknown"
        }
    }

    var statusColorName: String {
        switch status ?? "" {
        case "sent": return "blue"
        case "delivered": return "green"
        case "bounced", "failed": return "red"
        case "opened": return "purple"
        case "clicked": return "indigo"
        case "complained": return "orange"
        default: return "gray"
        }
    }
}

struct EmailLogResponse: Codable {
    let logs: [EmailLog]?
}

struct EmailTemplate: Codable, Identifiable {
    let id: String
    let templateKey: String
    let name: String
    let subject: String
    let htmlContent: String
    let availableVariables: [String]?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case templateKey = "template_key"
        case name, subject
        case htmlContent = "html_content"
        case availableVariables = "available_variables"
        case updatedAt = "updated_at"
    }
}

struct EmailTemplateResponse: Codable {
    let templates: [EmailTemplate]?
}

struct PageSetting: Codable, Identifiable {
    var id: String { pageKey }
    let pageKey: String
    var enabled: Bool

    enum CodingKeys: String, CodingKey {
        case pageKey = "page_key"
        case enabled
    }

    var label: String {
        switch pageKey {
        case "pottery-painting": return "Pottery Painting"
        case "baby-prints": return "Baby Prints"
        case "parties": return "Parties & Events"
        case "pricing": return "Prices"
        case "price-list": return "Price List"
        case "food-drink": return "Food & Drink"
        case "buy-gift-card": return "Gift Cards"
        case "faqs": return "FAQs"
        case "gallery": return "Gallery"
        case "contact-info": return "Contact"
        case "putney": return "Putney Studio"
        case "wimbledon": return "Wimbledon Studio"
        default: return pageKey
        }
    }
}

struct PageSettingsResponse: Codable {
    let pages: [PageSetting]?
}

struct DbHealth: Codable {
    let healthy: Bool
    let tables: [String: DbTableInfo]
    let issues: [String]
}

struct DbTableInfo: Codable {
    let exists: Bool
    let rows: Int
}

struct DbBackup: Codable, Identifiable {
    let id: String
    let name: String
    let createdAt: String?
    let tables: [String]?

    enum CodingKeys: String, CodingKey {
        case id, name
        case createdAt = "created_at"
        case tables
    }
}

struct DbBackupResponse: Codable {
    let backups: [DbBackup]?
}

struct SampleDataStatus: Codable {
    let sampleBookings: Int
    let sampleGiftCards: Int

    enum CodingKeys: String, CodingKey {
        case sampleBookings = "sample_bookings"
        case sampleGiftCards = "sample_gift_cards"
    }
}

// MARK: - SMS Models

struct SmsBalanceResponse: Codable {
    let balance: String
    let currency: String
}

struct SmsUsageData: Codable {
    let count: Int
    let totalCost: String
    let currency: String
    let recent: [SmsUsageEntry]?
}

struct SmsUsageEntry: Codable, Identifiable {
    var id: String { "\(to)-\(dateSent ?? "")" }
    let to: String
    let body: String
    let status: String
    let direction: String
    let dateSent: String?
    let price: String?
    let errorCode: Int?
    let errorMessage: String?
}

struct SmsTemplate: Codable, Identifiable {
    let id: String
    let templateKey: String
    let name: String
    let body: String
    let availableVariables: [String]?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case templateKey = "template_key"
        case name, body
        case availableVariables = "available_variables"
        case updatedAt = "updated_at"
    }
}

struct SmsTemplatesResponse: Codable {
    let templates: [SmsTemplate]?
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidResponse
    case invalidCredentials
    case unauthorized
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid server response"
        case .invalidCredentials: return "Invalid username or password"
        case .unauthorized: return "Session expired. Please log in again."
        case .serverError(let msg): return msg
        }
    }
}
