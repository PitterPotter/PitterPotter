import Foundation
import SwiftUI

@MainActor
class AuthViewModel: ObservableObject {
    @Published var staff: Staff?
    @Published var isLoading = false
    @Published var error: String?
    @AppStorage("pp_staff_id") private var storedId: String?
    @AppStorage("pp_staff_name") private var storedName: String?
    @AppStorage("pp_staff_username") private var storedUsername: String?
    @AppStorage("pp_staff_role") private var storedRole: String?
    @AppStorage("pp_staff_token") private var storedToken: String?
    @AppStorage("pp_staff_can_update") private var storedCanUpdate: Bool = false
    @AppStorage("pp_staff_can_edit") private var storedCanEdit: Bool = false
    @AppStorage("pp_staff_can_walkin") private var storedCanWalkIn: Bool = false
    @AppStorage("pp_staff_can_delete") private var storedCanDelete: Bool = false
    @AppStorage("pp_staff_can_epos_refunds") private var storedCanEposRefunds: Bool = false
    @AppStorage("pp_staff_can_epos_discounts") private var storedCanEposDiscounts: Bool = false
    @AppStorage("pp_staff_can_epos_products") private var storedCanEposProducts: Bool = false
    @AppStorage("pp_staff_allowed_studios") private var storedAllowedStudios: String = ""

    var isLoggedIn: Bool {
        staff != nil
    }

    init() {
        restoreSession()
    }

    private func restoreSession() {
        guard let id = storedId,
              let name = storedName,
              let username = storedUsername,
              let role = storedRole,
              let token = storedToken else { return }
        staff = Staff(
            id: id,
            name: name,
            username: username,
            role: role,
            canUpdateStatus: storedCanUpdate,
            canEditBookings: storedCanEdit,
            canAddWalkIns: storedCanWalkIn,
            canDeleteBookings: storedCanDelete,
            canEposRefunds: storedCanEposRefunds,
            canEposDiscounts: storedCanEposDiscounts,
            canEposManageProducts: storedCanEposProducts,
            allowedStudios: storedAllowedStudios.isEmpty ? nil : storedAllowedStudios.components(separatedBy: ","),
            sessionToken: token
        )
    }

    func login(username: String, password: String) async {
        isLoading = true
        error = nil
        do {
            let result = try await APIClient.shared.login(username: username, password: password)
            staff = result
            storedId = result.id
            storedName = result.name
            storedUsername = result.username
            storedRole = result.role
            storedToken = result.sessionToken
            storedCanUpdate = result.canUpdateStatus
            storedCanEdit = result.canEditBookings
            storedCanWalkIn = result.canAddWalkIns
            storedCanDelete = result.canDeleteBookings
            storedCanEposRefunds = result.canEposRefunds
            storedCanEposDiscounts = result.canEposDiscounts
            storedCanEposProducts = result.canEposManageProducts
            storedAllowedStudios = result.allowedStudios?.joined(separator: ",") ?? ""
            Analytics.startSession()
            Analytics.track("login", properties: ["username": result.username, "role": result.role])
        } catch let err as APIError {
            self.error = err.errorDescription
        } catch let err {
            self.error = "Login failed: \(err.localizedDescription)"
        }
        isLoading = false
    }

    func logout() {
        staff = nil
        storedId = nil
        storedName = nil
        storedUsername = nil
        storedRole = nil
        storedToken = nil
        storedCanUpdate = false
        storedCanEdit = false
        storedCanWalkIn = false
        storedCanDelete = false
        storedCanEposRefunds = false
        storedCanEposDiscounts = false
        storedCanEposProducts = false
        storedAllowedStudios = ""
        Analytics.track("logout")
    }
}
