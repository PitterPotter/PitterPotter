import SwiftUI

struct NotificationSettingsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @State private var settings: [NotificationSetting] = []
    @State private var loading = false
    @State private var editingId: String?
    @State private var editTitle = ""
    @State private var editMessage = ""
    @State private var showAdd = false
    @State private var newType: NotificationType = .bookingNew
    @State private var newStudio = "All"

    // Only types that still produce notifications — status changes,
    // redemptions and collection-ready alerts no longer fire.
    private let allTypes: [NotificationType] = [
        .bookingNew, .bookingWalkIn, .bookingCancelled, .bookingFailed, .giftCardPurchased,
    ]
    private let studios = ["All", "Putney", "Wimbledon"]

    var body: some View {
        List {
            if loading {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding()
            } else {
                ForEach(groupedTypes, id: \.0) { type, typeSettings in
                    Section(header: Text(type.label)) {
                        ForEach(typeSettings.sorted(by: { $0.studio < $1.studio })) { setting in
                            settingRow(setting)
                        }
                    }
                }

                if showAdd {
                    addSection
                }
            }
        }
        .navigationTitle("Notification Settings")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: { showAdd.toggle() }) {
                    Image(systemName: "plus")
                }
            }
        }
        .onAppear { loadSettings() }
    }

    private var groupedTypes: [(NotificationType, [NotificationSetting])] {
        allTypes.compactMap { type in
            let typeSettings = settings.filter { $0.type == type }
            return typeSettings.isEmpty ? nil : (type, typeSettings)
        }
    }

    private var availableTypes: [NotificationType] {
        allTypes.filter { t in
            !settings.contains { $0.type == t && $0.studio == newStudio }
        }
    }

    private func settingRow(_ setting: NotificationSetting) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Toggle("", isOn: Binding(
                    get: { setting.enabled },
                    set: { newValue in toggleSetting(setting, enabled: newValue) }
                ))
                .labelsHidden()

                Text(setting.studio)
                    .font(.subheadline.bold())

                Spacer()

                if setting.customTitle != nil || setting.customMessage != nil {
                    Image(systemName: "pencil.line")
                        .font(AppFont.body(12, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }

                Button(action: {
                    if editingId == setting.id {
                        editingId = nil
                    } else {
                        editingId = setting.id
                        editTitle = setting.customTitle ?? ""
                        editMessage = setting.customMessage ?? ""
                    }
                }) {
                    Text(editingId == setting.id ? "Close" : "Customize")
                        .font(.caption.bold())
                }
                .buttonStyle(.borderless)

                Button(role: .destructive, action: { deleteSetting(setting) }) {
                    Image(systemName: "trash")
                        .font(AppFont.body(12, weight: .medium))
                }
                .buttonStyle(.borderless)
            }

            if editingId == setting.id {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Custom Title")
                        .font(.caption2.bold())
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    TextField("Leave empty for default", text: $editTitle)
                        .textFieldStyle(.roundedBorder)

                    Text("Custom Message")
                        .font(.caption2.bold())
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    TextField("Leave empty for default", text: $editMessage, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(2...4)

                    Button("Save") {
                        saveCustom(setting)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
                .padding(.leading, 32)
            }
        }
    }

    private var addSection: some View {
        Section(header: Text("Add Rule")) {
            Picker("Type", selection: $newType) {
                ForEach(availableTypes, id: \.self) { t in
                    Text(t.label).tag(t)
                }
            }

            Picker("Studio", selection: $newStudio) {
                ForEach(studios, id: \.self) { Text($0).tag($0) }
            }

            Button("Add Rule") {
                addSetting()
            }
            .disabled(availableTypes.isEmpty)

            if availableTypes.isEmpty {
                Text("All types already have a rule for \(newStudio)")
                    .font(AppFont.body(12, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }
        }
    }

    private func loadSettings() {
        guard let staff = authVM.staff else { return }
        loading = true
        Task {
            do {
                let result = try await APIClient.shared.fetchNotificationSettings(staff: staff)
                await MainActor.run { settings = result; loading = false }
            } catch {
                await MainActor.run { loading = false }
            }
        }
    }

    private func toggleSetting(_ setting: NotificationSetting, enabled: Bool) {
        guard let staff = authVM.staff else { return }
        if let idx = settings.firstIndex(where: { $0.id == setting.id }) {
            settings[idx].enabled = enabled
        }
        Task {
            try? await APIClient.shared.updateNotificationSetting(
                id: setting.id, enabled: enabled, customTitle: nil, customMessage: nil, staff: staff
            )
        }
    }

    private func saveCustom(_ setting: NotificationSetting) {
        guard let staff = authVM.staff else { return }
        if let idx = settings.firstIndex(where: { $0.id == setting.id }) {
            settings[idx].customTitle = editTitle.isEmpty ? nil : editTitle
            settings[idx].customMessage = editMessage.isEmpty ? nil : editMessage
        }
        Task {
            try? await APIClient.shared.updateNotificationSetting(
                id: setting.id, enabled: nil,
                customTitle: editTitle.isEmpty ? nil : editTitle,
                customMessage: editMessage.isEmpty ? nil : editMessage,
                staff: staff
            )
            await MainActor.run { editingId = nil }
        }
    }

    private func addSetting() {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                if let newSetting = try await APIClient.shared.addNotificationSetting(
                    type: newType, studio: newStudio, staff: staff
                ) {
                    await MainActor.run {
                        settings.append(newSetting)
                        showAdd = false
                    }
                }
            } catch {
                // ignore
            }
        }
    }

    private func deleteSetting(_ setting: NotificationSetting) {
        guard let staff = authVM.staff else { return }
        settings.removeAll { $0.id == setting.id }
        Task {
            try? await APIClient.shared.deleteNotificationSetting(id: setting.id, staff: staff)
        }
    }
}
