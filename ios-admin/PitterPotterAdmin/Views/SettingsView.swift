import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Image(systemName: "person.circle.fill")
                            .font(AppFont.heading(28))
                            .foregroundStyle(PPBrand.charcoal)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(authVM.staff?.name ?? "Unknown")
                                .font(AppFont.body(17, weight: .semibold))
                            Text(authVM.staff?.username ?? "")
                                .font(AppFont.body(12, weight: .medium))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                            HStack(spacing: 6) {
                                Text(authVM.staff?.role.capitalized ?? "")
                                    .font(AppFont.body(11, weight: .medium))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(PPBrand.charcoal.opacity(0.2))
                                    .foregroundStyle(PPBrand.charcoal)
                                    .clipShape(Capsule())
                                if let studios = authVM.staff?.visibleStudios, !studios.isEmpty {
                                    Text(studios.map { $0.rawValue }.joined(separator: ", "))
                                        .font(AppFont.body(11, weight: .medium))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 2)
                                        .background(Color.blue.opacity(0.2))
                                        .foregroundStyle(.blue)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                }

                Section("Permissions") {
                    PermissionRow(label: "Update Status", enabled: authVM.staff?.canUpdateStatus ?? false)
                    PermissionRow(label: "Edit Bookings", enabled: authVM.staff?.canEditBookings ?? false)
                    PermissionRow(label: "Add Walk-ins", enabled: authVM.staff?.canAddWalkIns ?? false)
                    PermissionRow(label: "Delete Bookings", enabled: authVM.staff?.canDeleteBookings ?? false)
                }

                Section("API Configuration") {
                    LabeledContent("Supabase URL") {
                        Text(String(APIConfig.supabaseURL.prefix(30)) + "...")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                }

                Section("App") {
                    LabeledContent("Version", value: "1.0.0")
                    LabeledContent("Build", value: "1")
                    LabeledContent("Bookings Loaded", value: "\(bookingsVM.bookings.count)")
                }

                Section {
                    Button(role: .destructive) {
                        authVM.logout()
                    } label: {
                        HStack {
                            Image(systemName: "arrow.right.square")
                            Text("Sign Out")
                        }
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

struct PermissionRow: View {
    let label: String
    let enabled: Bool

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Image(systemName: enabled ? "checkmark.circle.fill" : "xmark.circle")
                .foregroundStyle(enabled ? .green : .secondary)
                .font(AppFont.body(12, weight: .medium))
        }
    }
}
