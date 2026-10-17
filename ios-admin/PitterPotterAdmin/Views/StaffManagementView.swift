import SwiftUI

struct StaffManagementView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @StateObject private var staffVM = StaffViewModel()
    @State private var showingAddStaff = false
    @State private var editingMember: StaffMember?

    var body: some View {
        NavigationStack {
            Group {
                if staffVM.isLoading {
                    ProgressView("Loading staff...")
                } else if let error = staffVM.error {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.largeTitle)
                            .foregroundStyle(.orange)
                        Text(error)
                            .font(AppFont.body(15, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                        Button("Retry") {
                            if let staff = authVM.staff {
                                Task { await staffVM.loadStaff(staff: staff) }
                            }
                        }
                    }
                } else if staffVM.staffMembers.isEmpty {
                    EmptyStateView(
                        icon: "person.2",
                        title: "No staff members",
                        subtitle: "Tap + to add your first staff member",
                        actionTitle: "Add Staff",
                        action: { showingAddStaff = true }
                    )
                } else {
                    List {
                        ForEach(staffVM.staffMembers) { member in
                            Button {
                                editingMember = member
                            } label: {
                                StaffRowView(member: member)
                            }
                            .swipeActions(edge: .trailing) {
                                if member.id != authVM.staff?.id {
                                    Button(role: .destructive) {
                                        if let staff = authVM.staff {
                                            Task { await staffVM.deleteStaff(id: member.id, staff: staff) }
                                        }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable {
                        if let staff = authVM.staff {
                            await staffVM.loadStaff(staff: staff)
                        }
                    }
                }
            }
            .navigationTitle("Staff")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingAddStaff = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddStaff) {
                EditStaffView(mode: .create) { member, password in
                    if let staff = authVM.staff {
                        Task { await staffVM.createStaff(member, password: password, staff: staff) }
                    }
                }
            }
            .sheet(item: $editingMember) { member in
                EditStaffView(mode: .edit(member)) { updated, password in
                    if let staff = authVM.staff {
                        Task { await staffVM.updateStaff(updated, password: password, staff: staff) }
                    }
                }
            }
        }
        .task {
            if let staff = authVM.staff {
                await staffVM.loadStaff(staff: staff)
            }
        }
    }
}

// MARK: - Staff Row

struct StaffRowView: View {
    let member: StaffMember

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "person.circle.fill")
                .font(AppFont.heading(22))
                .foregroundStyle(PPBrand.charcoal)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(member.name)
                        .font(AppFont.body(17, weight: .semibold))
                    if member.isSuperAdmin {
                        Text("Super Admin")
                            .font(AppFont.body(11, weight: .medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.purple.opacity(0.2))
                            .foregroundStyle(.purple)
                            .clipShape(Capsule())
                    }
                }
                Text(member.username)
                    .font(AppFont.body(12, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))

                HStack(spacing: 4) {
                    if member.canUpdateStatus { PermDot(color: .green, icon: "checkmark.circle") }
                    if member.canEditBookings { PermDot(color: .blue, icon: "pencil.circle") }
                    if member.canAddWalkIns { PermDot(color: .orange, icon: "plus.app") }
                    if member.canDeleteBookings { PermDot(color: .red, icon: "trash") }
                }

                StudioBadgesView(member: member)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

struct PermDot: View {
    let color: Color
    let icon: String

    var body: some View {
        Image(systemName: icon)
            .font(AppFont.body(11, weight: .medium))
            .foregroundStyle(color)
    }
}

// MARK: - Studio Badges

struct StudioBadgesView: View {
    let member: StaffMember

    var body: some View {
        if member.isSuperAdmin {
            Text("All")
                .font(AppFont.body(10, weight: .bold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.purple.opacity(0.15))
                .foregroundStyle(.purple)
                .clipShape(Capsule())
        } else if let studios = member.allowedStudios, !studios.isEmpty {
            HStack(spacing: 4) {
                ForEach(studios, id: \.self) { studio in
                    Text(studio)
                        .font(AppFont.body(10, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.15))
                        .foregroundStyle(PPBrand.charcoal)
                        .clipShape(Capsule())
                }
            }
        } else {
            Text("All")
                .font(AppFont.body(10, weight: .bold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.gray.opacity(0.15))
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                .clipShape(Capsule())
        }
    }
}

// MARK: - Edit Staff View

struct EditStaffView: View {
    enum Mode {
        case create
        case edit(StaffMember)
    }

    let mode: Mode
    let onSave: (StaffMember, String) -> Void
    @Environment(\.dismiss) var dismiss

    @State private var name = ""
    @State private var username = ""
    @State private var password = ""
    @State private var role = "staff"
    @State private var canUpdateStatus = false
    @State private var canEditBookings = false
    @State private var canAddWalkIns = false
    @State private var canDeleteBookings = false
    @State private var canEposRefunds = false
    @State private var canEposDiscounts = false
    @State private var canEposManageProducts = false
    @State private var canEposStock = false
    @State private var allowedPutney = false
    @State private var allowedWimbledon = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Details") {
                    TextField("Name", text: $name)
                    if case .create = mode {
                        TextField("Username", text: $username)
                            .textInputAutocapitalization(.never)
                    }
                    TextField(passwordPlaceholder, text: $password)
                        .textInputAutocapitalization(.never)
                }

                Section("Role") {
                    Picker("Role", selection: $role) {
                        Text("Staff").tag("staff")
                        Text("Super Admin").tag("super_admin")
                    }
                }

                Section("Permissions") {
                    Toggle("Update Status", isOn: $canUpdateStatus)
                        .disabled(isSuperAdmin)
                    Toggle("Edit Bookings", isOn: $canEditBookings)
                        .disabled(isSuperAdmin)
                    Toggle("Add Walk-ins", isOn: $canAddWalkIns)
                        .disabled(isSuperAdmin)
                    Toggle("Delete Bookings", isOn: $canDeleteBookings)
                        .disabled(isSuperAdmin)
                }

                Section("EPOS") {
                    Toggle("EPOS Discounts", isOn: $canEposDiscounts)
                        .disabled(isSuperAdmin)
                    Toggle("EPOS Refunds", isOn: $canEposRefunds)
                        .disabled(isSuperAdmin)
                    Toggle("EPOS Product Management", isOn: $canEposManageProducts)
                        .disabled(isSuperAdmin)
                    Toggle("EPOS Stock Management", isOn: $canEposStock)
                        .disabled(isSuperAdmin)
                }

                if !isSuperAdmin {
                    Section("Allowed Studios") {
                        Toggle("Putney", isOn: $allowedPutney)
                        Toggle("Wimbledon", isOn: $allowedWimbledon)
                    }
                }
            }
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { save() }
                        .fontWeight(.bold)
                        .disabled(name.isEmpty || (isCreate && username.isEmpty) || (isCreate && password.isEmpty))
                }
            }
            .onAppear { loadMember() }
        }
    }

    private var isCreate: Bool {
        if case .create = mode { return true }
        return false
    }

    private var isSuperAdmin: Bool { role == "super_admin" }

    private var navTitle: String {
        isCreate ? "New Staff" : "Edit Staff"
    }

    private var passwordPlaceholder: String {
        isCreate ? "Password" : "New Password (leave blank to keep)"
    }

    private func loadMember() {
        if case .edit(let member) = mode {
            name = member.name
            username = member.username
            role = member.role
            canUpdateStatus = member.canUpdateStatus
            canEditBookings = member.canEditBookings
            canAddWalkIns = member.canAddWalkIns
            canDeleteBookings = member.canDeleteBookings
            canEposRefunds = member.canEposRefunds
            canEposDiscounts = member.canEposDiscounts
            canEposManageProducts = member.canEposManageProducts
            canEposStock = member.canEposStock
            if let studios = member.allowedStudios {
                allowedPutney = studios.contains("Putney")
                allowedWimbledon = studios.contains("Wimbledon")
            }
        }
    }

    private func save() {
        var studios: [String]? = nil
        if !isSuperAdmin {
            var s: [String] = []
            if allowedPutney { s.append("Putney") }
            if allowedWimbledon { s.append("Wimbledon") }
            studios = s.isEmpty ? nil : s
        }

        let id: String
        if case .edit(let member) = mode {
            id = member.id
        } else {
            id = ""
        }

        let member = StaffMember(
            id: id,
            name: name,
            username: username,
            role: role,
            canUpdateStatus: isSuperAdmin || canUpdateStatus,
            canEditBookings: isSuperAdmin || canEditBookings,
            canAddWalkIns: isSuperAdmin || canAddWalkIns,
            canDeleteBookings: isSuperAdmin || canDeleteBookings,
            canEposRefunds: isSuperAdmin || canEposRefunds,
            canEposDiscounts: isSuperAdmin || canEposDiscounts,
            canEposManageProducts: isSuperAdmin || canEposManageProducts,
            canEposStock: isSuperAdmin || canEposStock,
            allowedStudios: studios,
            createdAt: nil
        )

        onSave(member, password)
        dismiss()
    }
}
