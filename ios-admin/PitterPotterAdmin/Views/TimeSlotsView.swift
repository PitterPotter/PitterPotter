import SwiftUI

struct TimeSlotsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @State private var slots: TimeSlotsData = TimeSlotsData.default
    @State private var selectedStudio: String = "Putney"
    @State private var selectedDayType: String = "weekday"
    @State private var newSlotInputs: [String: String] = [:]
    @State private var isLoading = false

    private let sessionTypes: [(key: String, label: String)] = [
        ("painting", "Painting"),
        ("sip-and-paint", "Sip & Paint"),
        ("baby-prints", "Baby Prints"),
        ("party", "Party"),
    ]

    private var studios: [String] {
        (authVM.staff?.visibleStudios ?? Studio.allCases).map { $0.rawValue }
    }
    private let dayTypes: [(key: String, label: String)] = [
        ("weekday", "Weekdays"),
        ("weekend", "Weekends"),
    ]
    private let dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                pickerBar

                if isLoading {
                    ProgressView("Loading time slots...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    slotsList
                }
            }
            .navigationTitle("Time Slots")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let selected = bookingsVM.selectedStudio?.rawValue, studios.contains(selected) {
                    selectedStudio = selected
                } else if let first = studios.first {
                    selectedStudio = first
                }
                loadSlots()
            }
        }
    }

    private var pickerBar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                ForEach(studios, id: \.self) { studio in
                    Button {
                        selectedStudio = studio
                    } label: {
                        Text(studio)
                            .font(AppFont.body(12, weight: .medium))
                            .fontWeight(.bold)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(selectedStudio == studio ? PPBrand.charcoal : Color(.secondarySystemBackground))
                            .foregroundStyle(selectedStudio == studio ? .white : .primary)
                            .clipShape(Capsule())
                    }
                }
                Spacer()
            }

            HStack(spacing: 8) {
                ForEach(dayTypes, id: \.key) { dt in
                    Button {
                        selectedDayType = dt.key
                    } label: {
                        Text(dt.label)
                            .font(AppFont.body(12, weight: .medium))
                            .fontWeight(.bold)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(selectedDayType == dt.key ? PPBrand.charcoal : Color(.secondarySystemBackground))
                            .foregroundStyle(selectedDayType == dt.key ? .white : .primary)
                            .clipShape(Capsule())
                    }
                }
                Spacer()
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
    }

    private var slotsList: some View {
        Form {
            ForEach(sessionTypes, id: \.key) { session in
                Section(header: Text(session.label)) {
                    Toggle("Enabled", isOn: Binding(
                        get: { isEnabled(for: session.key) },
                        set: { setEnabled($0, session: session.key) }
                    ))
                    .tint(PPBrand.charcoal)

                    let currentDays = getAvailableDays(for: session.key)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Available days")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.7))
                        HStack(spacing: 8) {
                            ForEach(0..<7, id: \.self) { idx in
                                let active = currentDays.contains(idx)
                                Button {
                                    toggleDay(idx, session: session.key)
                                } label: {
                                    Text(dayLabels[idx])
                                        .font(AppFont.body(10, weight: .medium))
                                        .fontWeight(.bold)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(active ? PPBrand.charcoal : Color(.secondarySystemBackground))
                                        .foregroundStyle(active ? .white : .primary)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)

                    let currentSlots = getSlots(for: session.key)
                    if currentSlots.isEmpty {
                        Text("No slots configured")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                    ForEach(currentSlots, id: \.self) { slot in
                        HStack {
                            Text(slot)
                                .font(.system(.subheadline, design: .monospaced))
                            Spacer()
                            Button {
                                removeSlot(slot, session: session.key)
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.red.opacity(0.6))
                            }
                        }
                    }
                    .onDelete { offsets in
                        let updated = currentSlots.enumerated().filter { !offsets.contains($0.offset) }.map { $0.element }
                        setSlots(updated, session: session.key)
                    }

                    HStack {
                        TextField(session.key == "party" ? "e.g. 10:00-12:00" : "e.g. 10:00", text: Binding(
                            get: { newSlotInputs[session.key] ?? "" },
                            set: { newSlotInputs[session.key] = $0 }
                        ))
                        .textInputAutocapitalization(.never)

                        Button {
                            addSlot(session: session.key)
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(AppFont.heading(20))
                        }
                    }
                }
            }
        }
    }

    private func getConfig(for session: String) -> [String: Any] {
        let studio = slots.dict[selectedStudio] ?? [:]
        if let config = studio[session] as? [String: Any] {
            return config
        }
        return TimeSlotsData.defaultConfig(for: session)
    }

    private func isEnabled(for session: String) -> Bool {
        let config = getConfig(for: session)
        return (config["enabled"] as? Bool) ?? true
    }

    private func setEnabled(_ enabled: Bool, session: String) {
        var config = getConfig(for: session)
        config["enabled"] = enabled
        setConfig(config, session: session)
    }

    private func getSlots(for session: String) -> [String] {
        let config = getConfig(for: session)
        guard let slotsByDay = config["slots"] as? [String: [String]] else { return [] }
        var slots = sortSlots(slotsByDay[selectedDayType] ?? [])
        // 18:00 is not offered for Sip & Paint on weekend days
        if session == "sip-and-paint" && selectedDayType == "weekend" {
            slots.removeAll { $0 == "18:00" }
        }
        return slots
    }

    private func getAvailableDays(for session: String) -> [Int] {
        let config = getConfig(for: session)
        guard let days = config["availableDays"] as? [Int] else { return TimeSlotsData.defaultAvailableDays(for: session) }
        return days
    }

    private func setConfig(_ config: [String: Any], session: String) {
        var studio = slots.dict[selectedStudio] ?? [:]
        studio[session] = config
        slots.dict[selectedStudio] = studio
        saveSlots()
    }

    private func setSlots(_ updated: [String], session: String) {
        var config = getConfig(for: session)
        var slotsByDay = (config["slots"] as? [String: [String]]) ?? [:]
        slotsByDay[selectedDayType] = sortSlots(updated)
        config["slots"] = slotsByDay
        setConfig(config, session: session)
    }

    private func toggleDay(_ day: Int, session: String) {
        var config = getConfig(for: session)
        var days = getAvailableDays(for: session)
        if days.contains(day) {
            days.removeAll { $0 == day }
        } else {
            days.append(day)
        }
        config["availableDays"] = days.sorted()
        setConfig(config, session: session)
    }

    private func addSlot(session: String) {
        guard let input = newSlotInputs[session], !input.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        var current = getSlots(for: session)
        if !current.contains(trimmed) {
            current.append(trimmed)
            setSlots(current, session: session)
        }
        newSlotInputs[session] = ""
        Haptics.success()
    }

    private func removeSlot(_ slot: String, session: String) {
        var current = getSlots(for: session)
        current.removeAll { $0 == slot }
        setSlots(current, session: session)
        Haptics.light()
    }

    private func sortSlots(_ slots: [String]) -> [String] {
        let parseStart: (String) -> Int = { s in
            let start = s.split(separator: "-").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? s
            let parts = start.split(separator: ":").map { Int($0) ?? 0 }
            return (parts.first ?? 0) * 60 + (parts.count > 1 ? parts[1] : 0)
        }
        return slots.sorted { parseStart($0) < parseStart($1) }
    }

    private func loadSlots() {
        guard let staff = authVM.staff else { return }
        isLoading = true
        Task {
            do {
                let value = try await APIClient.shared.loadSetting(key: "time_slots", staff: staff)
                if let value = value, let data = value.data(using: .utf8) {
                    if let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        await MainActor.run {
                            slots = TimeSlotsData.fromDict(parsed)
                            isLoading = false
                        }
                        return
                    }
                }
                await MainActor.run {
                    slots = TimeSlotsData.default
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    slots = TimeSlotsData.default
                    isLoading = false
                }
            }
        }
    }

    private func saveSlots() {
        guard let staff = authVM.staff else { return }
        let dict = slots.toDict()
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: data, encoding: .utf8) else { return }
        Task {
            do {
                try await APIClient.shared.updateSetting(key: "time_slots", value: json, staff: staff)
                Haptics.success()
            } catch {
                Haptics.error()
            }
        }
    }
}

struct TimeSlotsData {
    var dict: [String: [String: [String: Any]]]

    static let `default`: TimeSlotsData = {
        var putneyStudio: [String: [String: Any]] = [
            "painting": defaultConfig(for: "painting"),
            "sip-and-paint": defaultConfig(for: "sip-and-paint"),
            "baby-prints": defaultConfig(for: "baby-prints"),
            "party": defaultConfig(for: "party"),
        ]
        putneyStudio["sip-and-paint"]?["enabled"] = false
        let wimbledonStudio: [String: [String: Any]] = [
            "painting": defaultConfig(for: "painting"),
            "sip-and-paint": defaultConfig(for: "sip-and-paint"),
            "baby-prints": defaultConfig(for: "baby-prints"),
            "party": defaultConfig(for: "party"),
        ]
        return TimeSlotsData(dict: ["Putney": putneyStudio, "Wimbledon": wimbledonStudio])
    }()

    static func defaultAvailableDays(for session: String) -> [Int] {
        switch session {
        case "sip-and-paint":
            return [4, 5, 6]
        default:
            return [0, 2, 3, 4, 5, 6]
        }
    }

    static func defaultSlots(for session: String) -> [String: [String]] {
        let painting = ["10:00", "10:30", "12:00", "12:30", "14:00", "14:30", "16:00", "16:30"]
        let sipAndPaintWeekday = ["18:00", "18:30", "19:00"]
        let sipAndPaintWeekend = ["18:30", "19:00"]
        let babyPrints = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"]
        let party = ["10:00-12:00", "12:30-14:30", "15:00-17:00"]
        switch session {
        case "painting", "baby-prints":
            let slots = session == "painting" ? painting : babyPrints
            return ["weekday": slots, "weekend": slots]
        case "sip-and-paint":
            return ["weekday": sipAndPaintWeekday, "weekend": sipAndPaintWeekend]
        case "party":
            return ["weekday": party, "weekend": party]
        default:
            return ["weekday": painting, "weekend": painting]
        }
    }

    static func defaultConfig(for session: String) -> [String: Any] {
        [
            "slots": defaultSlots(for: session),
            "availableDays": defaultAvailableDays(for: session),
            "enabled": true,
        ]
    }

    static func fromDict(_ raw: [String: Any]) -> TimeSlotsData {
        var result = TimeSlotsData.default
        for (studioKey, studioVal) in raw {
            guard let studioSessions = studioVal as? [String: Any] else { continue }
            var studio: [String: [String: Any]] = [:]

            for (sessionKey, sessionVal) in studioSessions {
                if let newConfig = sessionVal as? [String: Any] {
                    var config: [String: Any] = [:]
                    if let slots = newConfig["slots"] as? [String: [String]] {
                        config["slots"] = slots
                    } else if let oldSlots = sessionVal as? [String: [String]] {
                        config["slots"] = oldSlots
                    }
                    if let days = newConfig["availableDays"] as? [Int] {
                        config["availableDays"] = days
                    } else {
                        config["availableDays"] = defaultAvailableDays(for: sessionKey)
                    }
                    if let enabled = newConfig["enabled"] as? Bool {
                        config["enabled"] = enabled
                    } else {
                        config["enabled"] = true
                    }
                    if config["slots"] != nil {
                        studio[sessionKey] = config
                    }
                } else if let oldSlots = sessionVal as? [String: [String]] {
                    studio[sessionKey] = [
                        "slots": oldSlots,
                        "availableDays": defaultAvailableDays(for: sessionKey),
                        "enabled": true,
                    ]
                }
            }

            for sessionType in ["painting", "sip-and-paint", "baby-prints", "party"] {
                if studio[sessionType] == nil {
                    studio[sessionType] = defaultConfig(for: sessionType)
                }
            }

            result.dict[studioKey] = studio
        }
        return result
    }

    func toDict() -> [String: Any] {
        dict
    }
}
