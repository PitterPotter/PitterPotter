import SwiftUI

struct ClosuresView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @State private var schoolHolidays: [HolidayRange] = []
    @State private var closedDates: [ClosedDateEntry] = []
    @State private var isLoading = false

    // New holiday form
    @State private var newHolidayLabel = ""
    @State private var newHolidayFrom = Date()
    @State private var newHolidayTo = Date()

    // New closed date form
    @State private var newClosedDate = Date()
    @State private var newClosedStudio = "Both"

    private var studios: [String] {
        ["Both"] + (authVM.staff?.visibleStudios ?? Studio.allCases).map { $0.rawValue }
    }

    /// Closed dates relevant to the active location — a specific selection
    /// still shows "Both" entries since they close that studio too.
    private var visibleClosedDates: [ClosedDateEntry] {
        guard let studio = bookingsVM.selectedStudio?.rawValue else { return closedDates }
        return closedDates.filter { $0.studio == studio || $0.studio == "Both" }
    }

    private func removeClosedDate(_ entry: ClosedDateEntry) {
        guard let idx = closedDates.firstIndex(where: { $0.date == entry.date && $0.studio == entry.studio }) else { return }
        closedDates.remove(at: idx)
        saveClosures()
    }

    private let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading closures...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    Form {
                        holidaysSection
                        closedDatesSection
                    }
                }
            }
            .navigationTitle("Holidays & Closures")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let studio = bookingsVM.selectedStudio?.rawValue, studios.contains(studio) {
                    newClosedStudio = studio
                }
                loadClosures()
            }
        }
    }

    private var holidaysSection: some View {
        Section(header: Text("School Holiday Periods"), footer: Text("Mondays within a holiday range will be open for bookings.")) {
            if schoolHolidays.isEmpty {
                Text("No holiday periods set")
                    .font(AppFont.body(12, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }
            ForEach(schoolHolidays.indices, id: \.self) { idx in
                let holiday = schoolHolidays[idx]
                HStack {
                    VStack(alignment: .leading) {
                        if let label = holiday.label, !label.isEmpty {
                            Text(label)
                                .font(AppFont.body(15, weight: .medium))
                                .fontWeight(.medium)
                        }
                        Text("\(holiday.from) → \(holiday.to)")
                            .font(AppFont.body(12, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    }
                    Spacer()
                    Button(role: .destructive) {
                        schoolHolidays.remove(at: idx)
                        saveClosures()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.red.opacity(0.6))
                    }
                }
            }

            VStack(spacing: 8) {
                TextField("Label (e.g. Summer)", text: $newHolidayLabel)
                    .font(AppFont.body(12, weight: .medium))
                HStack {
                    DatePicker("From", selection: $newHolidayFrom, displayedComponents: .date)
                        .labelsHidden()
                        .datePickerStyle(.compact)
                    DatePicker("To", selection: $newHolidayTo, displayedComponents: .date)
                        .labelsHidden()
                        .datePickerStyle(.compact)
                }
                Button {
                    addHoliday()
                } label: {
                    Text("Add Period")
                        .font(AppFont.body(12, weight: .medium))
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(PPBrand.charcoal)
            }
        }
    }

    private var closedDatesSection: some View {
        Section(header: Text("Closed Dates"), footer: Text("No bookings will be accepted on these dates for the selected studio.")) {
            if visibleClosedDates.isEmpty {
                Text("No closed dates set")
                    .font(AppFont.body(12, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }
            ForEach(visibleClosedDates.indices, id: \.self) { idx in
                let entry = visibleClosedDates[idx]
                HStack {
                    Text(entry.date)
                        .font(AppFont.body(15, weight: .medium))
                    Spacer()
                    Text(entry.studio)
                        .font(AppFont.body(11, weight: .medium))
                        .fontWeight(.bold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(entry.studio == "Both" ? Color.red.opacity(0.2) : Color.orange.opacity(0.2))
                        .foregroundStyle(entry.studio == "Both" ? .red : .orange)
                        .clipShape(Capsule())
                    Button(role: .destructive) {
                        removeClosedDate(entry)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.red.opacity(0.6))
                    }
                }
            }

            VStack(spacing: 8) {
                HStack {
                    DatePicker("Date", selection: $newClosedDate, displayedComponents: .date)
                        .datePickerStyle(.compact)
                    Picker("Studio", selection: $newClosedStudio) {
                        ForEach(studios, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                Button {
                    addClosedDate()
                } label: {
                    Text("Add Closed Date")
                        .font(AppFont.body(12, weight: .medium))
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            }
        }
    }

    private func addHoliday() {
        let from = dateFormatter.string(from: newHolidayFrom)
        let to = dateFormatter.string(from: newHolidayTo)
        guard from <= to else { Haptics.error(); return }
        let entry = HolidayRange(from: from, to: to, label: newHolidayLabel.isEmpty ? nil : newHolidayLabel)
        schoolHolidays.append(entry)
        schoolHolidays.sort { $0.from < $1.from }
        newHolidayLabel = ""
        saveClosures()
        Haptics.success()
    }

    private func addClosedDate() {
        let date = dateFormatter.string(from: newClosedDate)
        let entry = ClosedDateEntry(date: date, studio: newClosedStudio)
        if !closedDates.contains(where: { $0.date == date && $0.studio == newClosedStudio }) {
            closedDates.append(entry)
            closedDates.sort { $0.date < $1.date }
            saveClosures()
            Haptics.success()
        }
    }

    private func loadClosures() {
        guard let staff = authVM.staff else { return }
        isLoading = true
        Task {
            do {
                async let holidaysVal = APIClient.shared.loadSetting(key: "school_holidays", staff: staff)
                async let closedVal = APIClient.shared.loadSetting(key: "closed_dates", staff: staff)
                let (h, c) = try await (holidaysVal, closedVal)
                await MainActor.run {
                    if let h = h, let data = h.data(using: .utf8),
                       let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                        schoolHolidays = parsed.compactMap { dict in
                            guard let from = dict["from"] as? String, let to = dict["to"] as? String else { return nil }
                            return HolidayRange(from: from, to: to, label: dict["label"] as? String)
                        }
                    }
                    if let c = c, let data = c.data(using: .utf8),
                       let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                        closedDates = parsed.compactMap { dict in
                            guard let date = dict["date"] as? String else { return nil }
                            let studio = dict["studio"] as? String ?? "Both"
                            return ClosedDateEntry(date: date, studio: studio)
                        }
                    }
                    isLoading = false
                }
            } catch {
                await MainActor.run { isLoading = false }
            }
        }
    }

    private func saveClosures() {
        guard let staff = authVM.staff else { return }
        let holidaysArray = schoolHolidays.map { ["from": $0.from, "to": $0.to, "label": $0.label ?? ""] as [String: Any] }
        let closedArray = closedDates.map { ["date": $0.date, "studio": $0.studio] as [String: Any] }

        guard let hData = try? JSONSerialization.data(withJSONObject: holidaysArray),
              let hJson = String(data: hData, encoding: .utf8),
              let cData = try? JSONSerialization.data(withJSONObject: closedArray),
              let cJson = String(data: cData, encoding: .utf8) else { return }

        Task {
            do {
                try await APIClient.shared.updateSetting(key: "school_holidays", value: hJson, staff: staff)
                try await APIClient.shared.updateSetting(key: "closed_dates", value: cJson, staff: staff)
            } catch {
                Haptics.error()
            }
        }
    }
}

struct HolidayRange {
    let from: String
    let to: String
    let label: String?
}

struct ClosedDateEntry {
    let date: String
    let studio: String
}
