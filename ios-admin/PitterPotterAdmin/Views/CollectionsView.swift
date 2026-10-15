import SwiftUI
import PhotosUI

struct CollectionsView: View {
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    var initialStage: CollectionStage
    @State private var nameSearchText = ""
    @State private var phoneSearchText = ""
    private var selectedStudio: Studio? {
        get { bookingsVM.selectedStudio }
        nonmutating set { bookingsVM.selectedStudio = newValue }
    }
    @State private var selectedBooking: Booking?
    @State private var showCamera = false
    @State private var isUploading = false
    @State private var uploadError: String?
    @State private var showAddProfile = false
    @State private var showScanner = false
    @State private var scannedCode: String?
    @State private var scanResult: String?
    @State private var scanError: String?
    @State private var scannedBooking: Booking?
    @State private var expandedDates: Set<String> = []
    @State private var expandedMonths: Set<String> = []
    @State private var showNoPhotoGroup = false
    @State private var showRushGroup = true
    @State private var showReturnGroup = false
    @State private var sortOrder: SortOrder = .newest
    @State private var needsPhotoOnly = false
    @State private var selectMode = false
    @State private var selectedIds = Set<String>()
    @State private var showBulkTagSheet = false
    @State private var showingReadyPrompt = false
    @State private var pendingMoveBooking: Booking?
    @State private var stageUpdateError: String?

    enum SortOrder {
        case newest, oldest
    }

    init(initialStage: CollectionStage = .painted) {
        self.initialStage = initialStage
    }

    var filteredBookings: [Booking] {
        bookingsVM.visibleBookings.filter { b in
            guard b.status == "completed" else { return false }
            guard b.collectionStatus == initialStage.rawValue else { return false }
            if !nameSearchText.isEmpty {
                let q = nameSearchText.lowercased()
                if !b.name.lowercased().contains(q) { return false }
            }
            if !phoneSearchText.isEmpty {
                let digits = (b.phone ?? "").filter { $0.isNumber }
                let qDigits = phoneSearchText.filter { $0.isNumber }
                if !digits.contains(qDigits) { return false }
            }
            if needsPhotoOnly {
                if let photos = b.photos, !photos.isEmpty { return false }
            }
            return true
        }
    }

    // Painted: flagged bookings (rush / return-to-finish) get their own
    // buckets; photo-less bookings are the stale backlog at the bottom.
    var rushBookings: [Booking] {
        initialStage == .painted ? filteredBookings.filter { $0.paintedFlag == "rush" } : []
    }

    var returnBookings: [Booking] {
        initialStage == .painted ? filteredBookings.filter { $0.paintedFlag == "return_to_finish" } : []
    }

    var mainBookings: [Booking] {
        initialStage == .painted ? filteredBookings.filter { $0.paintedFlag == nil && !($0.photos?.isEmpty ?? true) } : filteredBookings
    }

    var noPhotoBookings: [Booking] {
        initialStage == .painted ? filteredBookings.filter { $0.paintedFlag == nil && ($0.photos?.isEmpty ?? true) } : []
    }

    var groupedByDate: [(date: String, bookings: [Booking])] {
        let map = Dictionary(grouping: mainBookings, by: { $0.date })
        var entries = map.map { (date: $0.key, bookings: $0.value.sorted { $0.time < $1.time }) }
        entries.sort { sortOrder == .newest ? $0.date > $1.date : $0.date < $1.date }
        return entries
    }

    var noPhotoGroupedByDate: [(date: String, bookings: [Booking])] {
        let map = Dictionary(grouping: noPhotoBookings, by: { $0.date })
        var entries = map.map { (date: $0.key, bookings: $0.value.sorted { $0.time < $1.time }) }
        entries.sort { $0.date > $1.date }
        return entries
    }

    // Month collapses wrap the date groups — long lists stay short.
    private func groupIntoMonths(_ entries: [(date: String, bookings: [Booking])]) -> [(month: String, groups: [(date: String, bookings: [Booking])])] {
        var order: [String] = []
        var map: [String: [(date: String, bookings: [Booking])]] = [:]
        for entry in entries {
            let month = String(entry.date.prefix(7))
            if map[month] == nil { order.append(month); map[month] = [] }
            map[month]?.append(entry)
        }
        return order.map { (month: $0, groups: map[$0]!) }
    }

    var groupedByMonth: [(month: String, groups: [(date: String, bookings: [Booking])])] {
        groupIntoMonths(groupedByDate)
    }

    var noPhotoByMonth: [(month: String, groups: [(date: String, bookings: [Booking])])] {
        groupIntoMonths(noPhotoGroupedByDate)
    }

    private func monthTitle(_ month: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM"
        guard let d = f.date(from: month) else { return month }
        let out = DateFormatter()
        out.dateFormat = "MMMM yyyy"
        return out.string(from: d)
    }

    @ViewBuilder
    private func dateSection(_ group: (date: String, bookings: [Booking])) -> some View {
        CollapsibleDateSection(
            date: group.date,
            bookings: group.bookings,
            stage: initialStage,
            isExpanded: !nameSearchText.isEmpty || !phoneSearchText.isEmpty || expandedDates.contains(group.date),
            onToggle: {
                if expandedDates.contains(group.date) {
                    expandedDates.remove(group.date)
                } else {
                    expandedDates.insert(group.date)
                }
            },
            onTap: { booking in
                if selectMode {
                    toggleSelection(booking.id)
                } else {
                    selectedBooking = booking
                }
            },
            onMove: moveToStage,
            onAddPhoto: { booking in
                selectedBooking = booking
                showCamera = true
            },
            selectMode: selectMode,
            selectedIds: selectedIds,
            onToggleSelect: { id in toggleSelection(id) },
            onReadyPrompt: { booking in
                pendingMoveBooking = booking
                showingReadyPrompt = true
            },
            onTagPhoto: { booking, photoIndex, xPct, yPct in
                addTagToPhoto(bookingId: booking.id, photoIndex: photoIndex, x: xPct, y: yPct)
            },
            onRemoveLastTag: { booking, photoIndex in
                removeLastTag(bookingId: booking.id, photoIndex: photoIndex)
            },
            onSetPaintedFlag: { booking, flag in setPaintedFlag(booking, flag) }
        )
    }

    @ViewBuilder
    private func monthSection(_ monthGroup: (month: String, groups: [(date: String, bookings: [Booking])])) -> some View {
        let isExpanded = expandedMonths.contains(monthGroup.month)
        let count = monthGroup.groups.reduce(0) { $0 + $1.bookings.count }
        VStack(spacing: 0) {
            Button {
                withAnimation {
                    if expandedMonths.contains(monthGroup.month) {
                        expandedMonths.remove(monthGroup.month)
                    } else {
                        expandedMonths.insert(monthGroup.month)
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    Text(monthTitle(monthGroup.month))
                        .font(AppFont.heading(13))
                        .foregroundStyle(PPBrand.charcoal)
                        .textCase(.uppercase)
                        .tracking(0.5)
                    Text("\(count) booking\(count != 1 ? "s" : "")")
                        .font(AppFont.heading(10))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(PPBrand.charcoal.opacity(0.08))
                        .clipShape(Capsule())
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(spacing: 10) {
                    ForEach(monthGroup.groups, id: \.date) { group in
                        dateSection(group)
                    }
                }
                .padding(10)
            }
        }
        .background(Color.white.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1)
        )
    }

    private func moveToStage(_ booking: Booking, _ stage: CollectionStage) {
        guard let staff = authVM.staff else { return }
        Haptics.light()
        Task {
            do {
                try await APIClient.shared.updateCollectionStatus(
                    bookingId: booking.id, studio: booking.studio, status: stage.rawValue, staff: staff
                )
                await MainActor.run {
                    bookingsVM.updateBookingLocally(booking.id, collectionStatus: stage.rawValue)
                }
            } catch {
                await MainActor.run {
                    stageUpdateError = error.localizedDescription
                    Haptics.error()
                }
            }
        }
    }

    private func addTagToPhoto(bookingId: String, photoIndex: Int, x: Double, y: Double) {
        guard let staff = authVM.staff,
              var booking = bookingsVM.bookings.first(where: { $0.id == bookingId }) else { return }
        var tags = booking.photoTags ?? [:]
        var existing = tags[String(photoIndex)] ?? []
        existing.append(PhotoTag(id: nil, label: nil, status: "ready", x: x, y: y))
        tags[String(photoIndex)] = existing
        booking.photoTags = tags
        Task { await patchTags(booking, staff: staff) }
    }

    private func removeLastTag(bookingId: String, photoIndex: Int) {
        guard let staff = authVM.staff,
              var booking = bookingsVM.bookings.first(where: { $0.id == bookingId }) else { return }
        guard var tags = booking.photoTags,
              var existing = tags[String(photoIndex)],
              let tagIndex = existing.lastIndex(where: { $0.status != "location" }) else { return }
        existing.remove(at: tagIndex)
        if existing.isEmpty {
            tags.removeValue(forKey: String(photoIndex))
        } else {
            tags[String(photoIndex)] = existing
        }
        booking.photoTags = tags
        Task { await patchTags(booking, staff: staff) }
    }

    /// Sends only photo_tags to the server — a stale local copy can never
    /// overwrite notes or other fields.
    private func patchTags(_ booking: Booking, staff: Staff) async {
        guard let tagsObj = try? APIClient.jsonPatchValue(booking.photoTags) else { return }
        await bookingsVM.patchBooking(
            id: booking.id, studio: booking.studio,
            fields: ["photoTags": tagsObj],
            updated: booking, staff: staff
        )
    }

    /// Paints the rush / return-to-finish flag via a partial patch.
    private func setPaintedFlag(_ booking: Booking, _ flag: String?) {
        guard let staff = authVM.staff else { return }
        Haptics.light()
        var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
        updated.paintedFlag = flag
        Task {
            await bookingsVM.patchBooking(
                id: booking.id, studio: booking.studio,
                fields: ["paintedFlag": flag ?? NSNull()],
                updated: updated, staff: staff
            )
        }
    }

    /// Flat card grid for the painted flag buckets (rush / return-to-finish).
    @ViewBuilder
    private func flagCardGrid(_ bookings: [Booking]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(bookings) { booking in
                CollectionCard(
                    booking: booking,
                    stage: initialStage,
                    onTap: {
                        if selectMode { toggleSelection(booking.id) } else { selectedBooking = booking }
                    },
                    onAddPhoto: {
                        selectedBooking = booking
                        showCamera = true
                    },
                    onMove: moveToStage,
                    onReadyPrompt: {
                        pendingMoveBooking = booking
                        showingReadyPrompt = true
                    },
                    selectMode: selectMode,
                    isSelected: selectedIds.contains(booking.id),
                    onToggleSelect: { toggleSelection(booking.id) },
                    onTagPhoto: { photoIndex, xPct, yPct in
                        addTagToPhoto(bookingId: booking.id, photoIndex: photoIndex, x: xPct, y: yPct)
                    },
                    onRemoveLastTag: { photoIndex in
                        removeLastTag(bookingId: booking.id, photoIndex: photoIndex)
                    },
                    onSetPaintedFlag: { b, flag in setPaintedFlag(b, flag) }
                )
            }
        }
    }

    /// Collapsible painted flag bucket (rush pinned top, return pinned bottom).
    @ViewBuilder
    private func flagBucket(title: String, icon: String, bookings: [Booking], expanded: Bool, tint: Color, onToggle: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            Button {
                withAnimation { onToggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(tint)
                    HStack(spacing: 5) {
                        Image(systemName: icon)
                            .font(AppFont.body(12, weight: .bold))
                        Text(title)
                            .font(AppFont.heading(13))
                            .textCase(.uppercase)
                            .tracking(0.5)
                    }
                    .foregroundStyle(tint)
                    Text("\(bookings.count) booking\(bookings.count != 1 ? "s" : "")")
                        .font(AppFont.heading(10))
                        .foregroundStyle(tint.opacity(0.7))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(tint.opacity(0.15))
                        .clipShape(Capsule())
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)

            if expanded {
                flagCardGrid(bookings)
                    .padding(10)
            }
        }
        .background(tint.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(tint.opacity(0.4), lineWidth: 1)
        )
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar
                filterBar

                if selectMode && !selectedIds.isEmpty {
                    bulkActionBar
                }

                if filteredBookings.isEmpty {
                    EmptyStateView(
                        icon: "tray",
                        title: "Nothing \(initialStage.label.lowercased()) yet",
                        subtitle: "Bookings will appear here when moved to this stage"
                    )
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            // Painted: RUSH bucket pinned above the month groups
                            if initialStage == .painted && !rushBookings.isEmpty {
                                flagBucket(
                                    title: "Rush", icon: "bolt.fill",
                                    bookings: rushBookings, expanded: showRushGroup,
                                    tint: Color(red: 0.85, green: 0.55, blue: 0.1),
                                    onToggle: { showRushGroup.toggle() }
                                )
                            }

                            ForEach(groupedByMonth, id: \.month) { monthGroup in
                                monthSection(monthGroup)
                            }

                            // Painted: photo-less backlog collapsed into its own bucket
                            if initialStage == .painted && !noPhotoByMonth.isEmpty {
                                VStack(spacing: 0) {
                                    Button {
                                        withAnimation { showNoPhotoGroup.toggle() }
                                    } label: {
                                        HStack(spacing: 8) {
                                            Image(systemName: showNoPhotoGroup ? "chevron.up" : "chevron.down")
                                                .font(AppFont.body(12, weight: .bold))
                                                .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                                            Text("Without photos")
                                                .font(AppFont.heading(13))
                                                .foregroundStyle(PPBrand.charcoal.opacity(0.7))
                                                .textCase(.uppercase)
                                                .tracking(0.5)
                                            Text("\(noPhotoBookings.count) booking\(noPhotoBookings.count != 1 ? "s" : "")")
                                                .font(AppFont.heading(10))
                                                .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 3)
                                                .background(PPBrand.charcoal.opacity(0.08))
                                                .clipShape(Capsule())
                                            Spacer()
                                        }
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 12)
                                    }
                                    .buttonStyle(.plain)

                                    if showNoPhotoGroup {
                                        VStack(spacing: 10) {
                                            ForEach(noPhotoByMonth, id: \.month) { monthGroup in
                                                monthSection(monthGroup)
                                            }
                                        }
                                        .padding(10)
                                    }
                                }
                                .background(Color(red: 0.96, green: 0.95, blue: 0.93))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1)
                                )
                            }

                            // Painted: return-to-finish bucket at the very bottom
                            if initialStage == .painted && !returnBookings.isEmpty {
                                flagBucket(
                                    title: "Return to finish", icon: "arrow.uturn.backward",
                                    bookings: returnBookings, expanded: showReturnGroup,
                                    tint: Color(red: 0.15, green: 0.5, blue: 0.8),
                                    onToggle: { showReturnGroup.toggle() }
                                )
                            }
                        }
                        .padding(16)
                    }
                    .refreshable {
                        if let staff = authVM.staff {
                            await bookingsVM.loadBookings(staff: staff)
                        }
                    }
                }
            }
            .navigationTitle(initialStage.label)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if !filteredBookings.isEmpty {
                        Button {
                            Haptics.light()
                            if selectMode { selectedIds.removeAll() }
                            selectMode.toggle()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: selectMode ? "checkmark.circle.fill" : "checklist")
                                Text(selectMode ? "Done" : "Select")
                            }
                            .font(AppFont.body(12, weight: .bold))
                            .foregroundStyle(PPBrand.charcoal)
                        }
                    }
                }
            }
            .sheet(item: $selectedBooking) { booking in
                CollectionDetailSheet(booking: booking, stage: initialStage)
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { imageData in
                    uploadPhoto(data: imageData, bookingId: selectedBooking?.id ?? "")
                }
            }
            .sheet(isPresented: $showAddProfile) {
                AddProfileSheet(stage: initialStage)
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .sheet(isPresented: $showScanner) {
                GiftCardScannerView(scannedCode: $scannedCode)
                    .onDisappear {
                        if let code = scannedCode {
                            handleScannedCode(code)
                        }
                    }
            }
            .sheet(item: $scannedBooking) { booking in
                ScanResultSheet(booking: booking)
                    .environmentObject(authVM)
                    .environmentObject(bookingsVM)
            }
            .alert("Upload Error", isPresented: .constant(uploadError != nil)) {
                Button("OK") { uploadError = nil }
            } message: {
                Text(uploadError ?? "")
            }
            .alert("Scan Result", isPresented: .constant(scanError != nil)) {
                Button("OK") { scanError = nil }
            } message: {
                Text(scanError ?? "")
            }
            .alert("Ready for Collection?", isPresented: $showingReadyPrompt) {
                Button("Mark Ready") {
                    if let booking = pendingMoveBooking {
                        moveToStage(booking, .ready)
                    }
                    pendingMoveBooking = nil
                }
                Button("Cancel", role: .cancel) {
                    pendingMoveBooking = nil
                }
            } message: {
                if let booking = pendingMoveBooking {
                    Text("Mark \(booking.name)'s item as ready for collection? This will notify the customer.")
                } else {
                    Text("Mark this item as ready for collection?")
                }
            }
            .alert("Couldn’t Update Collection", isPresented: Binding(
                get: { stageUpdateError != nil },
                set: { if !$0 { stageUpdateError = nil } }
            )) {
                Button("OK") { stageUpdateError = nil }
            } message: {
                Text(stageUpdateError ?? "Please try again.")
            }
            .sheet(isPresented: $showBulkTagSheet) {
                TagSelectionSheet { label, status in
                    applyBulkPhotoTag(label: label, status: status)
                }
                .presentationDetents([.height(280)])
            }
            .onAppear {
                restrictStudioIfNeeded()
            }
        }
    }

    private var availableStudios: [Studio] {
        authVM.staff?.visibleStudios ?? Studio.allCases
    }

    private var isSuperAdmin: Bool {
        authVM.staff?.role == "super_admin"
    }

    private func restrictStudioIfNeeded() {
        if !isSuperAdmin && availableStudios.count == 1 {
            selectedStudio = availableStudios.first
        }
    }

    private func countForStage(_ stage: CollectionStage) -> Int {
        bookingsVM.visibleBookings.filter { $0.status == "completed" && $0.collectionStatus == stage.rawValue }.count
    }

    private func handleScannedCode(_ code: String) {
        scannedCode = nil
        var token: String?
        if let url = URL(string: code), let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            token = components.queryItems?.first(where: { $0.name == "token" })?.value
        } else if code.hasPrefix("token=") {
            token = String(code.dropFirst(6))
        } else {
            token = code
        }

        guard let token = token, !token.isEmpty else {
            scanError = "Invalid QR code — no token found"
            Haptics.error()
            return
        }

        Task {
            if let staff = authVM.staff {
                await bookingsVM.loadBookings(staff: staff)
            }
            await MainActor.run {
                guard let booking = bookingsVM.bookings.first(where: { $0.managementToken == token }) else {
                    scanError = "No booking found for this QR code"
                    Haptics.error()
                    return
                }
                guard booking.status == "completed" else {
                    scanError = "Booking \(booking.name) is not completed (status: \(booking.status))"
                    Haptics.warning()
                    return
                }
                if booking.collectionStatus == CollectionStage.collected.rawValue {
                    scanError = "\(booking.name) is already collected"
                    Haptics.warning()
                    return
                }
                scannedBooking = booking
                Haptics.success()
            }
        }
    }

    private var searchBar: some View {
        VStack(spacing: 8) {
            // Row 1: Name + Phone fields
            HStack(spacing: 8) {
                // Name search
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(AppFont.body(11))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                    TextField("Name", text: $nameSearchText)
                        .font(AppFont.body(12, weight: .semibold))
                        .textInputAutocapitalization(.words)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))

                // Phone search
                HStack(spacing: 6) {
                    Image(systemName: "phone")
                        .font(AppFont.body(11))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                    TextField("Phone", text: $phoneSearchText)
                        .font(AppFont.body(12, weight: .semibold))
                        .keyboardType(.phonePad)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))

            }

            // Row 2: Studio filter + Needs photo + Add Profile + Scan QR + Sort
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    // Studio filter (segmented like web) — only show if staff has access to multiple studios
                    if availableStudios.count > 1 {
                        HStack(spacing: 0) {
                            ForEach(["all"] + availableStudios.map { $0.rawValue }, id: \.self) { s in
                                Button {
                                    Haptics.light()
                                    if s == "all" {
                                        selectedStudio = nil
                                    } else {
                                        selectedStudio = Studio(rawValue: s)
                                    }
                                } label: {
                                    Text(s == "all" ? "All Studios" : s)
                                        .font(AppFont.body(10, weight: .bold))
                                        .foregroundStyle(
                                            (s == "all" && selectedStudio == nil) || (s == selectedStudio?.rawValue) ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.5)
                                        )
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(
                                            (s == "all" && selectedStudio == nil) || (s == selectedStudio?.rawValue) ? PPBrand.sage : Color.white
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))
                    }

                    // Needs photo toggle (painted only)
                    if initialStage == .painted {
                        Button {
                            Haptics.light()
                            needsPhotoOnly.toggle()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.circle")
                                    .font(AppFont.body(10, weight: .bold))
                                Text("Needs photo")
                                    .font(AppFont.body(10, weight: .bold))
                                    .textCase(.uppercase)
                                    .tracking(0.5)
                            }
                            .foregroundStyle(needsPhotoOnly ? Color(red: 0.7, green: 0.4, blue: 0.1) : PPBrand.charcoal.opacity(0.5))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(needsPhotoOnly ? Color(red: 1.0, green: 0.94, blue: 0.85) : Color.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(needsPhotoOnly ? Color(red: 0.85, green: 0.6, blue: 0.2) : PPBrand.charcoal.opacity(0.15), lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }

                    // Add Profile button (only on painted/ready, matching web)
                    if initialStage == .painted || initialStage == .ready {
                        Button {
                            showAddProfile = true
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                    .font(AppFont.body(10, weight: .bold))
                                Text("Add Profile")
                                    .font(AppFont.body(10, weight: .bold))
                                    .textCase(.uppercase)
                                    .tracking(0.5)
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(PPBrand.charcoal)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }

                    // Scan QR button
                    Button {
                        showScanner = true
                        scanResult = nil
                        scanError = nil
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "qrcode.viewfinder")
                                .font(AppFont.body(10, weight: .bold))
                            Text("Scan QR")
                                .font(AppFont.body(10, weight: .bold))
                                .textCase(.uppercase)
                                .tracking(0.5)
                        }
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(PPBrand.sage)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)

                    Spacer(minLength: 4)

                    // Sort toggle (Newest/Oldest like web)
                    HStack(spacing: 0) {
                        Button {
                            Haptics.light()
                            sortOrder = .newest
                        } label: {
                            Text("Newest")
                                .font(AppFont.body(10, weight: .bold))
                                .foregroundStyle(sortOrder == .newest ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.5))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(sortOrder == .newest ? PPBrand.sage : Color.white)
                        }
                        .buttonStyle(.plain)

                        Button {
                            Haptics.light()
                            sortOrder = .oldest
                        } label: {
                            Text("Oldest")
                                .font(AppFont.body(10, weight: .bold))
                                .foregroundStyle(sortOrder == .oldest ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.5))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(sortOrder == .oldest ? PPBrand.sage : Color.white)
                        }
                        .buttonStyle(.plain)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))
                }
            }

            // Clear filters button
            if !nameSearchText.isEmpty || !phoneSearchText.isEmpty || selectedStudio != nil || needsPhotoOnly {
                Button {
                    Haptics.light()
                    nameSearchText = ""
                    phoneSearchText = ""
                    selectedStudio = nil
                    needsPhotoOnly = false
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark")
                            .font(AppFont.body(10, weight: .bold))
                        Text("Clear filters")
                            .font(AppFont.body(10, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.5)
                    }
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .background(Color(red: 0.973, green: 0.98, blue: 0.98))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1))
    }

    private var filterBar: some View {
        EmptyView()
    }

    private var bulkActionBar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("\(selectedIds.count) selected")
                    .font(AppFont.body(12, weight: .bold))
                    .foregroundStyle(.white)

                Spacer()

                // Select all / Deselect all
                Button {
                    Haptics.light()
                    if selectedIds.count == filteredBookings.count {
                        selectedIds.removeAll()
                    } else {
                        selectedIds = Set(filteredBookings.map { $0.id })
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: selectedIds.count == filteredBookings.count ? "checkmark.circle.fill" : "checkmark.circle")
                            .font(AppFont.body(10, weight: .bold))
                        Text(selectedIds.count == filteredBookings.count ? "Deselect all" : "Select all")
                            .font(AppFont.heading(10))
                            .textCase(.uppercase)
                            .tracking(0.5)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)

                Button {
                    Haptics.light()
                    showBulkTagSheet = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "tag")
                            .font(AppFont.body(10, weight: .bold))
                        Text("Tag")
                            .font(AppFont.heading(10))
                            .textCase(.uppercase)
                            .tracking(0.5)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)

                Button {
                    Haptics.light()
                    selectedIds.removeAll()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark")
                            .font(AppFont.body(10, weight: .bold))
                        Text("Clear")
                            .font(AppFont.heading(10))
                            .textCase(.uppercase)
                            .tracking(0.5)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(PPBrand.charcoal)

            // Stage-specific bulk move actions (matching web)
            HStack(spacing: 8) {
                if initialStage == .painted {
                    bulkMoveButton("Mark Ready", icon: "shippingbox", color: Color(red: 0.2, green: 0.5, blue: 0.9)) {
                        bulkMoveToStage(.ready)
                    }
                }
                if initialStage == .ready {
                    bulkMoveButton("Back to Painted", icon: "chevron.left", color: PPBrand.charcoal) {
                        bulkMoveToStage(.painted)
                    }
                    bulkMoveButton("Mark Collected", icon: "checkmark", color: Color(red: 0.1, green: 0.7, blue: 0.4)) {
                        bulkMoveToStage(.collected)
                    }
                }
                if initialStage == .collected {
                    bulkMoveButton("Back to Ready", icon: "chevron.left", color: PPBrand.charcoal) {
                        bulkMoveToStage(.ready)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(PPBrand.charcoal.opacity(0.9))
        }
    }

    private func bulkMoveButton(_ label: String, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            HStack(spacing: 3) {
                Image(systemName: icon)
                    .font(AppFont.body(10, weight: .bold))
                Text(label)
                    .font(AppFont.heading(10))
                    .textCase(.uppercase)
                    .tracking(0.5)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func bulkMoveToStage(_ stage: CollectionStage) {
        guard let staff = authVM.staff else { return }
        let targetBookings = filteredBookings.filter { selectedIds.contains($0.id) }
        Task {
            for booking in targetBookings {
                try? await APIClient.shared.updateCollectionStatus(
                    bookingId: booking.id, studio: booking.studio, status: stage.rawValue, staff: staff
                )
                await MainActor.run {
                    bookingsVM.updateBookingLocally(booking.id, collectionStatus: stage.rawValue)
                }
            }
            await MainActor.run {
                selectedIds.removeAll()
            }
        }
    }

    private func toggleSelection(_ id: String) {
        Haptics.light()
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    private func applyBulkPhotoTag(label: String, status: String) {
        guard let staff = authVM.staff else { return }
        let trimmedLabel = label.trimmingCharacters(in: .whitespaces)
        let targetBookings = filteredBookings.filter { selectedIds.contains($0.id) }
        Haptics.light()
        Task {
            for booking in targetBookings {
                guard let photos = booking.photos, !photos.isEmpty else { continue }
                var updated = booking
                var tags = updated.photoTags ?? [:]
                var changed = false
                for i in 0..<photos.count {
                    let key = String(i)
                    let existing = tags[key] ?? []
                    // Skip if a tag with the same status and label already exists
                    if existing.contains(where: { $0.status == status && ($0.label ?? "") == trimmedLabel }) { continue }
                    var arr = existing
                    arr.append(PhotoTag(id: nil, label: trimmedLabel.isEmpty ? nil : trimmedLabel, status: status, x: 50, y: 50))
                    tags[key] = arr
                    changed = true
                }
                guard changed else { continue }
                updated.photoTags = tags
                do {
                    try await APIClient.shared.updateBooking(updated, staff: staff)
                    await MainActor.run {
                        bookingsVM.updateBookingLocally(updated)
                    }
                } catch {
                    Haptics.error()
                }
            }
            await MainActor.run {
                selectedIds.removeAll()
                selectMode = false
                Haptics.success()
            }
        }
    }

    private func uploadPhoto(data: Data, bookingId: String) {
        guard let staff = authVM.staff, !bookingId.isEmpty else { return }
        isUploading = true
        Task {
            do {
                let url = try await APIClient.shared.uploadPhoto(
                    imageData: data,
                    fileName: "photo_\(Int(Date().timeIntervalSince1970)).jpg",
                    bookingId: bookingId,
                    staff: staff
                )
                if let urlObj = URL(string: url), let img = UIImage(data: data) {
                    CachedAsyncImage.prefetch(url: urlObj, image: img)
                }
                var photos = bookingsVM.bookings.first(where: { $0.id == bookingId })?.photos ?? []
                photos.append(url)
                var updated = bookingsVM.bookings.first(where: { $0.id == bookingId })!
                updated.photos = photos
                try await APIClient.shared.updateBooking(updated, staff: staff)
                await MainActor.run {
                    bookingsVM.updateBookingLocally(updated)
                    isUploading = false
                }
            } catch {
                await MainActor.run {
                    isUploading = false
                    uploadError = "Upload failed: \(error.localizedDescription)"
                    Haptics.error()
                }
            }
        }
    }
}

// MARK: - Collection Card

struct CollectionCard: View {
    let booking: Booking
    let stage: CollectionStage
    let onTap: () -> Void
    var onAddPhoto: (() -> Void)? = nil
    var onMove: ((Booking, CollectionStage) -> Void)? = nil
    var onReadyPrompt: (() -> Void)? = nil
    var selectMode: Bool = false
    var isSelected: Bool = false
    var onToggleSelect: (() -> Void)? = nil
    var onTagPhoto: ((Int, Double, Double) -> Void)? = nil  // photoIndex, xPct, yPct
    var onRemoveLastTag: ((Int) -> Void)? = nil  // photoIndex
    var onSetPaintedFlag: ((Booking, String?) -> Void)? = nil

    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @State private var tagMode = false
    @State private var locationMenuExpanded = false
    @State private var showCollectConfirm = false

    var photoCount: Int { booking.photos?.count ?? 0 }

    private var tagSummary: [String: Int]? {
        guard let tags = booking.photoTags, !tags.isEmpty else { return nil }
        var counts: [String: Int] = [:]
        for (_, photoTags) in tags {
            for tag in photoTags where tag.status != "location" {
                counts[tag.status, default: 0] += 1
            }
        }
        return counts.isEmpty ? nil : counts
    }

    private var locationLabels: [String]? {
        guard let tags = booking.photoTags, !tags.isEmpty else { return nil }
        var labels: [String] = []
        for (_, photoTags) in tags {
            for tag in photoTags {
                if tag.status == "location", let label = tag.label, !label.isEmpty, !labels.contains(label) {
                    labels.append(label)
                }
            }
        }
        return labels.isEmpty ? nil : labels
    }

    private var isOverdue: Bool {
        guard stage != .collected else { return false }
        let ref = booking.collectedAt ?? booking.date
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ref) else { return false }
        return Date().timeIntervalSince(d) > 30 * 24 * 60 * 60
    }

    private func addTagToPhoto(bookingId: String, photoIndex: Int, x: Double, y: Double) {
        guard let staff = authVM.staff else { return }
        var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
        var tags = updated.photoTags ?? [:]
        var existing = tags[String(photoIndex)] ?? []
        existing.append(PhotoTag(id: nil, label: nil, status: "ready", x: x, y: y))
        tags[String(photoIndex)] = existing
        updated.photoTags = tags
        Task { await patchTags(updated, staff: staff) }
    }

    private func setLocation(_ location: String) {
        guard let staff = authVM.staff, photoCount > 0 else { return }
        var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
        var tags = updated.photoTags ?? [:]
        for key in Array(tags.keys) {
            tags[key]?.removeAll { $0.status == "location" }
            if tags[key]?.isEmpty == true {
                tags.removeValue(forKey: key)
            }
        }
        var firstPhotoTags = tags["0"] ?? []
        firstPhotoTags.append(PhotoTag(id: nil, label: location, status: "location", x: 50, y: 50))
        tags["0"] = firstPhotoTags
        updated.photoTags = tags
        Task { await patchTags(updated, staff: staff) }
    }

    private func removeLastTag(bookingId: String, photoIndex: Int) {
        guard let staff = authVM.staff else { return }
        var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
        guard var tags = updated.photoTags, var existing = tags[String(photoIndex)], !existing.isEmpty else { return }
        existing.removeLast()
        if existing.isEmpty {
            tags.removeValue(forKey: String(photoIndex))
        } else {
            tags[String(photoIndex)] = existing
        }
        updated.photoTags = tags
        Task { await patchTags(updated, staff: staff) }
    }

    /// Sends only photo_tags to the server — a stale local copy can never
    /// overwrite notes or other fields.
    private func patchTags(_ booking: Booking, staff: Staff) async {
        guard let tagsObj = try? APIClient.jsonPatchValue(booking.photoTags) else { return }
        await bookingsVM.patchBooking(
            id: booking.id, studio: booking.studio,
            fields: ["photoTags": tagsObj],
            updated: booking, staff: staff
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Top row: name + checkbox + badges
            HStack(alignment: .top, spacing: 6) {
                if selectMode {
                    Button {
                        onToggleSelect?()
                    } label: {
                        Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                            .font(AppFont.body(13, weight: .bold))
                            .foregroundStyle(isSelected ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.3))
                    }
                    .buttonStyle(.plain)
                }
                Text(booking.name)
                    .font(AppFont.body(14, weight: .black))
                    .foregroundStyle(PPBrand.charcoal)
                    .lineLimit(1)
                if booking.paintedFlag == "rush" {
                    HStack(spacing: 2) {
                        Image(systemName: "bolt.fill")
                            .font(AppFont.body(8, weight: .bold))
                        Text("Rush")
                            .font(AppFont.body(8, weight: .black))
                    }
                    .foregroundStyle(Color(red: 0.75, green: 0.45, blue: 0.05))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(red: 1.0, green: 0.94, blue: 0.8))
                    .clipShape(Capsule())
                }
                if booking.paintedFlag == "return_to_finish" {
                    HStack(spacing: 2) {
                        Image(systemName: "arrow.uturn.backward")
                            .font(AppFont.body(8, weight: .bold))
                        Text("Return")
                            .font(AppFont.body(8, weight: .black))
                    }
                    .foregroundStyle(Color(red: 0.15, green: 0.45, blue: 0.75))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(red: 0.85, green: 0.93, blue: 1.0))
                    .clipShape(Capsule())
                }
                Spacer()
                if photoCount > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "camera")
                            .font(AppFont.body(9, weight: .bold))
                        Text("\(photoCount)")
                            .font(AppFont.body(9, weight: .black))
                    }
                    .foregroundStyle(PPBrand.charcoal)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(PPBrand.sage)
                    .clipShape(Capsule())
                }
                if isOverdue {
                    HStack(spacing: 3) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(AppFont.body(9, weight: .bold))
                        Text("30d+")
                            .font(AppFont.body(9, weight: .black))
                    }
                    .foregroundStyle(Color(red: 0.85, green: 0.5, blue: 0.1))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(red: 1.0, green: 0.94, blue: 0.85))
                    .clipShape(Capsule())
                }
            }

            // Info row: time, painters, studio, phone, location
            HStack(spacing: 8) {
                Label(PPDateDisplay.time(booking.time), systemImage: "clock")
                    .font(AppFont.body(10, weight: .semibold))
                Label("\(booking.paintersCount)", systemImage: "person.2")
                    .font(AppFont.body(10, weight: .semibold))
                Label(booking.studio, systemImage: "mappin")
                    .font(AppFont.body(10, weight: .semibold))
                if let phone = booking.phone, !phone.isEmpty {
                    Label(phone, systemImage: "phone")
                        .font(AppFont.body(10, weight: .semibold))
                        .lineLimit(1)
                }
                if stage == .ready, let readyAt = booking.readyAt {
                    Label("Notified \(PPDateDisplay.dateTime(readyAt))", systemImage: "bell")
                        .font(AppFont.body(10, weight: .semibold))
                        .foregroundStyle(Color(red: 0.2, green: 0.5, blue: 0.9))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(PPBrand.charcoal.opacity(0.6))

            // Photos grid (1 column, square, bigger) with tag ticks shown
            if photoCount > 0, let photos = booking.photos {
                // Separate ready tag and booking location controls
                if onTagPhoto != nil {
                    HStack(spacing: 8) {
                        Button {
                            withAnimation(.spring(response: 0.3)) {
                                tagMode.toggle()
                            }
                            Haptics.light()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(AppFont.body(10, weight: .bold))
                                Text(tagMode ? "Done" : "Tag")
                                    .font(AppFont.body(10, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color(red: 0.05, green: 0.7, blue: 0.4))
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)

                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                locationMenuExpanded.toggle()
                            }
                            Haptics.light()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "mappin.circle.fill")
                                    .font(AppFont.body(10, weight: .bold))
                                Text(locationLabels?.first ?? "Location")
                                    .font(AppFont.body(10, weight: .bold))
                                    .lineLimit(1)
                                Image(systemName: locationMenuExpanded ? "chevron.up" : "chevron.down")
                                    .font(AppFont.body(8, weight: .bold))
                            }
                            .foregroundStyle(PPBrand.charcoal)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(PPBrand.sage)
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)

                        if tagMode {
                            Button {
                                Haptics.light()
                                for idx in (0..<photos.count).reversed() {
                                    if let tags = booking.photoTags?[String(idx)], tags.contains(where: { $0.status != "location" }) {
                                        onRemoveLastTag?(idx)
                                        break
                                    }
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "arrow.uturn.backward")
                                        .font(AppFont.body(10, weight: .bold))
                                    Text("Undo")
                                        .font(AppFont.body(10, weight: .bold))
                                }
                                .foregroundStyle(PPBrand.charcoal)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(PPBrand.sage)
                                .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }

                        Spacer()
                    }

                    if locationMenuExpanded {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                            ForEach(LOCATION_OPTIONS, id: \.self) { location in
                                Button {
                                    setLocation(location)
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        locationMenuExpanded = false
                                    }
                                    Haptics.success()
                                } label: {
                                    HStack(spacing: 4) {
                                        Image(systemName: locationLabels?.first == location ? "checkmark.circle.fill" : "mappin.circle")
                                            .font(AppFont.body(10, weight: .bold))
                                        Text(location)
                                            .font(AppFont.body(10, weight: .bold))
                                            .lineLimit(1)
                                    }
                                    .foregroundStyle(PPBrand.charcoal)
                                    .frame(maxWidth: .infinity)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 8)
                                    .background(locationLabels?.first == location ? PPBrand.sage : PPBrand.clay100.opacity(0.7))
                                    .clipShape(RoundedRectangle(cornerRadius: 7))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 7)
                                            .stroke(PPBrand.charcoal.opacity(0.2), lineWidth: 1)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }

                // Swipeable photo cards
                if photos.count == 1 {
                    // Single photo — show as square card
                    let urlStr = photos[0]
                    if let url = URL(string: urlStr), !urlStr.isEmpty {
                        GeometryReader { geo in
                            let w = geo.size.width
                            ZStack {
                                CachedAsyncImage(url: url, contentMode: .fill)
                                    .frame(width: w, height: w)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))

                                if tagMode {
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color(red: 0.05, green: 0.7, blue: 0.4), lineWidth: 2)
                                        .frame(width: w, height: w)
                                }

                                let tags = (booking.photoTags?["0"] ?? []).filter { $0.status != "location" }
                                ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in
                                    PhotoTagBadge(tag: tag, canRemove: false) {}
                                        .position(
                                            x: CGFloat(tag.x) / 100 * w,
                                            y: CGFloat(tag.y) / 100 * w
                                        )
                                }

                                if tagMode && tags.isEmpty {
                                    HStack(spacing: 3) {
                                        Image(systemName: "checkmark.circle")
                                            .font(AppFont.body(9, weight: .bold))
                                        Text("Tap photo to tag")
                                            .font(AppFont.body(8, weight: .bold))
                                    }
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                                    .background(.black.opacity(0.5))
                                    .clipShape(Capsule())
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                                    .padding(6)
                                }
                            }
                            .frame(width: w, height: w)
                            .contentShape(Rectangle())
                            .onTapGesture { location in
                                if tagMode {
                                    Haptics.light()
                                    let xPct = Double(location.x / w * 100)
                                    let yPct = Double(location.y / w * 100)
                                    addTagToPhoto(bookingId: booking.id, photoIndex: 0, x: xPct, y: yPct)
                                }
                            }
                        }
                        .aspectRatio(1, contentMode: .fit)
                    }
                } else {
                    // Multiple photos — swipeable page cards
                    TabView {
                        ForEach(Array(photos.enumerated()), id: \.offset) { idx, urlStr in
                            if let url = URL(string: urlStr), !urlStr.isEmpty {
                                GeometryReader { geo in
                                    let w = geo.size.width
                                    ZStack {
                                        CachedAsyncImage(url: url, contentMode: .fill)
                                            .frame(width: w, height: w)
                                            .clipShape(RoundedRectangle(cornerRadius: 8))
                                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))

                                        if tagMode {
                                            RoundedRectangle(cornerRadius: 8)
                                                .stroke(Color(red: 0.05, green: 0.7, blue: 0.4), lineWidth: 2)
                                                .frame(width: w, height: w)
                                        }

                                        let tags = (booking.photoTags?[String(idx)] ?? []).filter { $0.status != "location" }
                                        ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in
                                            PhotoTagBadge(tag: tag, canRemove: false) {}
                                                .position(
                                                    x: CGFloat(tag.x) / 100 * w,
                                                    y: CGFloat(tag.y) / 100 * w
                                                )
                                        }

                                        if tagMode && tags.isEmpty {
                                            HStack(spacing: 3) {
                                                Image(systemName: "checkmark.circle")
                                                    .font(AppFont.body(9, weight: .bold))
                                                Text("Tap photo to tag")
                                                    .font(AppFont.body(8, weight: .bold))
                                            }
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 3)
                                            .background(.black.opacity(0.5))
                                            .clipShape(Capsule())
                                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                                            .padding(6)
                                        }
                                    }
                                    .frame(width: w, height: w)
                                    .contentShape(Rectangle())
                                    .onTapGesture { location in
                                        if tagMode {
                                            Haptics.light()
                                            let xPct = Double(location.x / w * 100)
                                            let yPct = Double(location.y / w * 100)
                                            addTagToPhoto(bookingId: booking.id, photoIndex: idx, x: xPct, y: yPct)
                                        }
                                    }
                                }
                                .aspectRatio(1, contentMode: .fit)
                            } else {
                                Rectangle()
                                    .fill(PPBrand.clay100)
                                    .aspectRatio(1, contentMode: .fit)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(
                                        Image(systemName: "photo")
                                            .font(.system(size: 18))
                                            .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                                    )
                            }
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .always))
                    .indexViewStyle(.page(backgroundDisplayMode: .always))
                    .aspectRatio(1, contentMode: .fit)
                }
            } else {
                // No photos — show placeholder square same size as photos
                GeometryReader { geo in
                    let w = geo.size.width
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(PPBrand.clay100)
                            .frame(width: w, height: w)
                        VStack(spacing: 6) {
                            Image(systemName: "photo")
                                .font(.system(size: 24))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.25))
                            Text("No photos")
                                .font(AppFont.body(10, weight: .medium))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                        }
                    }
                    .frame(width: w, height: w)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1))
                }
                .aspectRatio(1, contentMode: .fit)
            }

            // Tag summary pills (matching web)
            if let tagSummary = tagSummary, !tagSummary.isEmpty {
                HStack(spacing: 4) {
                    ForEach(tagSummary.sorted(by: { $0.key < $1.key }).indices, id: \.self) { i in
                        let entry = tagSummary.sorted(by: { $0.key < $1.key })[i]
                        HStack(spacing: 2) {
                            Circle()
                                .fill(TAG_COLORS[entry.key] ?? PPBrand.clay100)
                                .frame(width: 6, height: 6)
                            if entry.key == "location", let labels = locationLabels, !labels.isEmpty {
                                Text("\(entry.value) \(labels.joined(separator: "/"))")
                                    .font(AppFont.body(9, weight: .bold))
                            } else {
                                Text("\(entry.value) \(TAG_LABELS[entry.key] ?? entry.key)")
                                    .font(AppFont.body(9, weight: .bold))
                            }
                        }
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(PPBrand.clay100)
                        .clipShape(Capsule())
                    }
                }
            }

            // Action buttons row (matches web)
            HStack(spacing: 6) {
                // ⋯ menu: rush service / return to finish (painted only)
                if stage == .painted, let onSetPaintedFlag {
                    Menu {
                        Button {
                            onSetPaintedFlag(booking, "rush")
                        } label: {
                            Label("Rush service", systemImage: "bolt.fill")
                        }
                        Button {
                            onSetPaintedFlag(booking, "return_to_finish")
                        } label: {
                            Label("Return to finish", systemImage: "arrow.uturn.backward")
                        }
                        if booking.paintedFlag != nil {
                            Divider()
                            Button(role: .destructive) {
                                onSetPaintedFlag(booking, nil)
                            } label: {
                                Label("Remove flag", systemImage: "xmark")
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(AppFont.body(10, weight: .bold))
                            .foregroundStyle(PPBrand.charcoal)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(Color.white)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }

                // Add Photo button
                Button {
                    onAddPhoto?()
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "camera")
                            .font(AppFont.body(10, weight: .bold))
                        Text(photoCount > 0 ? "Add" : "Photos")
                            .font(AppFont.body(9, weight: .bold))
                    }
                    .foregroundStyle(PPBrand.charcoal)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(PPBrand.sage)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)

                // Back button (not on painted)
                if stage != .painted {
                    Button {
                        onMove?(booking, stage == .collected ? .ready : .painted)
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "chevron.left")
                                .font(AppFont.body(10, weight: .bold))
                            Text("Back")
                                .font(AppFont.body(9, weight: .bold))
                        }
                        .foregroundStyle(PPBrand.charcoal)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color.white)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.15), lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }

                Spacer()

                // Customer already collected — skips the ready email/SMS
                if stage == .painted {
                    Button {
                        showCollectConfirm = true
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "checkmark")
                                .font(AppFont.body(10, weight: .bold))
                            Text("Collected")
                                .font(AppFont.body(9, weight: .bold))
                        }
                        .foregroundStyle(Color(red: 0.1, green: 0.55, blue: 0.3))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color(red: 0.1, green: 0.7, blue: 0.4).opacity(0.12))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(red: 0.1, green: 0.7, blue: 0.4).opacity(0.4), lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }

                // Forward button: Painted -> Ready (blue), Ready -> Collected (green)
                if stage == .painted {
                    Button {
                        onReadyPrompt?()
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "shippingbox")
                                .font(AppFont.body(10, weight: .bold))
                            Text("Ready")
                                .font(AppFont.body(9, weight: .bold))
                            Image(systemName: "chevron.right")
                                .font(AppFont.body(10, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color(red: 0.2, green: 0.5, blue: 0.9))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                } else if stage == .ready {
                    Button {
                        onMove?(booking, .collected)
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "checkmark")
                                .font(AppFont.body(10, weight: .bold))
                            Text("Collected")
                                .font(AppFont.body(9, weight: .bold))
                            Image(systemName: "chevron.right")
                                .font(AppFont.body(10, weight: .bold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color(red: 0.1, green: 0.7, blue: 0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                } else if stage == .collected, let collectedAt = booking.collectedAt {
                    Text(PPDateDisplay.dateTime(collectedAt))
                        .font(AppFont.body(9, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                }
            }
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(
                    isOverdue ? Color(red: 1.0, green: 0.8, blue: 0.4) :
                    (selectMode && isSelected ? PPBrand.charcoal : PPBrand.charcoal.opacity(0.15)),
                    lineWidth: selectMode && isSelected ? 2 : 1
                )
        )
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .confirmationDialog(
            "Mark \(booking.name) as collected?",
            isPresented: $showCollectConfirm,
            titleVisibility: .visible
        ) {
            Button("Mark as Collected") { onMove?(booking, .collected) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Skips the ready email/SMS — for customers who already collected.")
        }
    }
}

// MARK: - Collapsible Date Section (matches web date-grouped collapse view)

struct CollapsibleDateSection: View {
    let date: String
    let bookings: [Booking]
    let stage: CollectionStage
    let isExpanded: Bool
    let onToggle: () -> Void
    let onTap: (Booking) -> Void
    let onMove: (Booking, CollectionStage) -> Void
    var onAddPhoto: ((Booking) -> Void)? = nil
    var selectMode: Bool = false
    var selectedIds: Set<String> = []
    var onToggleSelect: ((String) -> Void)? = nil
    var onReadyPrompt: ((Booking) -> Void)? = nil
    var onTagPhoto: ((Booking, Int, Double, Double) -> Void)? = nil  // booking, photoIndex, xPct, yPct
    var onRemoveLastTag: ((Booking, Int) -> Void)? = nil  // booking, photoIndex
    var onSetPaintedFlag: ((Booking, String?) -> Void)? = nil

    private var photoCount: Int {
        bookings.reduce(0) { $0 + ($1.photos?.count ?? 0) }
    }

    private var formattedDate: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: date) else { return date }
        let out = DateFormatter()
        out.dateFormat = "EEE d MMM yyyy"
        return out.string(from: d)
    }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.6))

                    Text(formattedDate)
                        .font(AppFont.heading(13))
                        .foregroundStyle(PPBrand.charcoal)
                        .textCase(.uppercase)
                        .tracking(0.5)

                    Text("\(bookings.count) booking\(bookings.count != 1 ? "s" : "")")
                        .font(AppFont.heading(10))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(PPBrand.charcoal.opacity(0.08))
                        .clipShape(Capsule())

                    if photoCount > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "camera")
                                .font(AppFont.body(9, weight: .bold))
                            Text("\(photoCount) photo\(photoCount != 1 ? "s" : "")")
                                .font(AppFont.heading(10))
                        }
                        .foregroundStyle(Color(red: 0.1, green: 0.6, blue: 0.3))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color(red: 0.94, green: 0.99, blue: 0.94))
                        .clipShape(Capsule())
                    }

                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(red: 0.973, green: 0.98, blue: 0.98))
            }
            .buttonStyle(.plain)

            if isExpanded {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(bookings) { booking in
                        CollectionCard(
                            booking: booking,
                            stage: stage,
                            onTap: { onTap(booking) },
                            onAddPhoto: { onAddPhoto?(booking) },
                            onMove: onMove,
                            onReadyPrompt: { onReadyPrompt?(booking) },
                            selectMode: selectMode,
                            isSelected: selectedIds.contains(booking.id),
                            onToggleSelect: { onToggleSelect?(booking.id) },
                            onTagPhoto: onTagPhoto != nil ? { photoIndex, xPct, yPct in
                                onTagPhoto?(booking, photoIndex, xPct, yPct)
                            } : nil,
                            onRemoveLastTag: onRemoveLastTag != nil ? { photoIndex in
                                onRemoveLastTag?(booking, photoIndex)
                            } : nil,
                            onSetPaintedFlag: onSetPaintedFlag
                        )
                            .contextMenu {
                                if stage == .painted {
                                    Button {
                                        onReadyPrompt?(booking)
                                    } label: {
                                        Label("Ready for Collection", systemImage: "checkmark.circle.fill")
                                    }
                                } else if stage == .ready {
                                    Button {
                                        onMove(booking, .collected)
                                    } label: {
                                        Label("Mark Collected", systemImage: "checkmark.circle.fill")
                                    }
                                    Button {
                                        onMove(booking, .painted)
                                    } label: {
                                        Label("Back to Painted", systemImage: "arrow.uturn.left.circle")
                                    }
                                } else if stage == .collected {
                                    Button {
                                        onMove(booking, .ready)
                                    } label: {
                                        Label("Back to Ready", systemImage: "arrow.uturn.left.circle")
                                    }
                                }
                            }
                    }
                }
                .padding(10)
            }
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1))
    }
}

// MARK: - Photo Tag Types

struct TagPopoverState: Identifiable {
    let id = UUID()
    let photoIndex: Int
    let x: Double
    let y: Double
}

let TAG_STATUSES = ["ready"]
let TAG_LABELS: [String: String] = [
    "ready": "Ready",
    "location": "Location"
]
let TAG_COLORS: [String: Color] = [
    "ready": Color(red: 0.05, green: 0.7, blue: 0.4),     // emerald-500
    "location": PPBrand.charcoal
]
let LOCATION_OPTIONS = ["Kitchen", "Shelf", "Under Air Con", "Box"]

// MARK: - Collection Detail Sheet

struct CollectionDetailSheet: View {
    let booking: Booking
    let stage: CollectionStage
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @Environment(\.dismiss) var dismiss
    @State private var showCamera = false
    @State private var isUploading = false
    @State private var uploadError: String?
    @State private var showReadyPrompt = false
    @State private var showReadyLocationSheet = false
    @State private var selectedLocation: String? = nil
    @State private var showCollectedPrompt = false
    @State private var notificationStatus: String?
    @State private var isSendingNotification = false
    @State private var tagMode = false
    @State private var tagPopover: TagPopoverState?
    @State private var modalImages: [String]? = nil
    @State private var modalIndex: Int = 0
    @State private var modalPhotoTags: [String: [PhotoTag]]? = nil
    @State private var showDeletePhotoConfirm = false
    @State private var pendingDeletePhotoIndex: Int? = nil
    @State private var commLogs: [EmailLog] = []
    @State private var commLoading = false
    @State private var showDeleteBookingConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Status + table badge (like web)
                    statusBadge

                    // Details grid 2x2 (like web)
                    HStack(spacing: 10) {
                        detailCard("Date", PPDateDisplay.date(booking.date))
                        detailCard("Time", PPDateDisplay.time(booking.time))
                    }
                    HStack(spacing: 10) {
                        detailCard("Studio", booking.studio)
                        detailCard("Seats", "\(booking.paintersCount)")
                    }
                    // Session type
                    detailCard("Session Type", sessionLabel)

                    // Meta (like web)
                    metaSection

                    // Contact (like web)
                    contactSection

                    // Notes (like web)
                    notesSection

                    // Floor plan preview (like web)
                    if let tableId = booking.tableId, !tableId.isEmpty {
                        floorPlanPreview
                    }

                    // Party payment (like web)
                    if booking.sessionType == "birthday-party" || booking.sessionType == "baby-shower-hen" || booking.sessionType == "corporate" {
                        partyPaymentSection
                    }

                    photosGrid

                    // Communication history (like web)
                    communicationHistory

                    statusManagementButtons
                    actionButtons

                    // Assign Table button (display-only, like web footer)
                    assignTableButton

                    // Edit + Delete buttons
                    editDeleteButtons
                }
                .padding(16)
            }
            .navigationTitle(booking.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { data in
                    uploadPhoto(data)
                }
            }
            .alert("Upload Error", isPresented: .constant(uploadError != nil)) {
                Button("OK") { uploadError = nil }
            } message: {
                Text(uploadError ?? "")
            }
            .alert("Ready for Collection?", isPresented: $showReadyPrompt) {
                Button("Mark Ready") {
                    showReadyLocationSheet = true
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Move \(booking.name) to Ready and send email/SMS notification?")
            }
            .sheet(isPresented: $showReadyLocationSheet) {
                ReadyLocationSheet(
                    selectedLocation: $selectedLocation,
                    onConfirm: { loc in
                        selectedLocation = loc
                        moveBooking(to: .ready, location: loc)
                    }
                )
            }
            .alert("Mark as Collected?", isPresented: $showCollectedPrompt) {
                Button("Mark Collected") {
                    moveBooking(to: .collected)
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Confirm \(booking.name)'s item has been collected?")
            }
            .fullScreenCover(isPresented: Binding(
                get: { modalImages != nil },
                set: { if !$0 { modalImages = nil; modalPhotoTags = nil } }
            )) {
                if let images = modalImages {
                    ImageModal(
                        images: images,
                        initialIndex: modalIndex,
                        onClose: { modalImages = nil; modalPhotoTags = nil },
                        photoTags: modalPhotoTags,
                        onTagPhoto: { photoIndex, xPct, yPct in
                            addPhotoTag(photoIndex: photoIndex, label: "", status: "ready", x: xPct, y: yPct)
                            // Update the modal's tags so they show immediately
                            modalPhotoTags = bookingsVM.bookings.first(where: { $0.id == booking.id })?.photoTags
                        }
                    )
                }
            }
            .alert("Delete Photo?", isPresented: $showDeletePhotoConfirm) {
                Button("Delete", role: .destructive) {
                    if let index = pendingDeletePhotoIndex {
                        deletePhoto(at: index)
                    }
                    pendingDeletePhotoIndex = nil
                }
                Button("Cancel", role: .cancel) {
                    pendingDeletePhotoIndex = nil
                }
            } message: {
                Text("Remove this photo from the booking?")
            }
            .alert("Delete Booking?", isPresented: $showDeleteBookingConfirm) {
                Button("Delete", role: .destructive) {
                    deleteBooking()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Permanently delete \(booking.name)'s booking? This cannot be undone.")
            }
            .task {
                loadCommLogs()
            }
        }
    }

    private var sessionLabel: String {
        switch booking.sessionType {
        case "painting": return "Painting"
        case "birthday-party": return "Birthday Party"
        case "baby-shower-hen": return "Baby Shower / Hen"
        case "clay-imprints": return "Baby Prints"
        case "corporate": return "Corporate"
        case "exclusive-hire": return "Exclusive Hire"
        default: return booking.sessionType ?? "—"
        }
    }

    // MARK: - Status badge (like web)

    private var statusBadge: some View {
        HStack(spacing: 8) {
            HStack(spacing: 4) {
                Image(systemName: booking.status == "confirmed" ? "checkmark.circle.fill" : booking.status == "cancelled" ? "xmark.circle.fill" : "clock")
                    .font(AppFont.body(10, weight: .bold))
                Text(booking.status == "confirmed" ? "Confirmed" : booking.status == "cancelled" ? "Cancelled" : "Awaiting confirmation")
                    .font(AppFont.body(10, weight: .black))
                    .textCase(.uppercase)
                    .tracking(0.5)
            }
            .foregroundStyle(booking.status == "confirmed" ? Color(red: 0.1, green: 0.5, blue: 0.2) : booking.status == "cancelled" ? Color(red: 0.7, green: 0.15, blue: 0.15) : Color(red: 0.6, green: 0.4, blue: 0.1))
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(booking.status == "confirmed" ? Color(red: 0.94, green: 0.99, blue: 0.94) : booking.status == "cancelled" ? Color(red: 0.99, green: 0.93, blue: 0.93) : Color(red: 0.99, green: 0.96, blue: 0.88))
            .clipShape(Capsule())
            if let tableId = booking.tableId, !tableId.isEmpty {
                Text(tableId)
                    .font(AppFont.body(10, weight: .black))
                    .foregroundStyle(PPBrand.charcoal)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(PPBrand.sage)
                    .clipShape(Capsule())
            }
        }
    }

    // MARK: - Meta section (like web)

    private var metaSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let createdAt = booking.createdAt, !createdAt.isEmpty {
                Text("Booked \(formatCreatedAt(createdAt))")
                    .font(AppFont.body(10, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            }
            Text("Source: \(booking.source ?? "Online")")
                .font(AppFont.body(10, weight: .medium))
                .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            Button {
                Haptics.light()
                UIPasteboard.general.string = booking.id
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "doc.on.doc")
                        .font(AppFont.body(9))
                    Text("Copy reference")
                        .font(AppFont.body(10, weight: .medium))
                }
                .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
        .overlay(
            Rectangle()
                .fill(PPBrand.charcoal.opacity(0.1))
                .frame(height: 1),
            alignment: .top
        )
    }

    // MARK: - Contact section (like web)

    private var contactSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Contact")
                .font(AppFont.body(10, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            if let email = booking.email, !email.isEmpty {
                if let url = URL(string: "mailto:\(email)") {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image(systemName: "envelope")
                                .font(AppFont.body(11))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                            Text(email)
                                .font(AppFont.body(11, weight: .semibold))
                                .foregroundStyle(PPBrand.charcoal)
                        }
                    }
                }
            }
            if let phone = booking.phone, !phone.isEmpty {
                if let url = URL(string: "tel:\(phone)") {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image(systemName: "phone")
                                .font(AppFont.body(11))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                            Text(phone)
                                .font(AppFont.body(11, weight: .semibold))
                                .foregroundStyle(PPBrand.charcoal)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func detailCard(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(AppFont.body(10, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            Text(value)
                .font(AppFont.body(13, weight: .black))
                .foregroundStyle(PPBrand.charcoal)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(red: 0.97, green: 0.98, blue: 0.98))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func formatCreatedAt(_ createdAt: String) -> String {
        PPDateDisplay.dateTime(createdAt)
    }

    private var statusManagementButtons: some View {
        VStack(spacing: 8) {
            let canManage = authVM.staff?.canUpdateStatus == true || authVM.staff?.role == "super_admin"
            if canManage && booking.status != "confirmed" && booking.status != "cancelled" {
                Button {
                    updateBookingStatus("confirmed")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Confirm Booking")
                    }
                    .font(AppFont.body(13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color(red: 0.05, green: 0.6, blue: 0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
            if canManage && booking.status == "confirmed" {
                Button {
                    updateBookingStatus("pending")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "clock")
                        Text("Mark as Awaiting")
                    }
                    .font(AppFont.body(13, weight: .bold))
                    .foregroundStyle(Color(red: 0.6, green: 0.4, blue: 0.1))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color(red: 0.99, green: 0.96, blue: 0.88))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.9, green: 0.8, blue: 0.5), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
            if canManage && booking.status != "cancelled" {
                Button {
                    updateBookingStatus("cancelled")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "xmark.circle.fill")
                        Text("Cancel Booking")
                    }
                    .font(AppFont.body(13, weight: .bold))
                    .foregroundStyle(Color(red: 0.7, green: 0.2, blue: 0.2))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color(red: 0.99, green: 0.93, blue: 0.93))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.95, green: 0.75, blue: 0.75), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func updateBookingStatus(_ newStatus: String) {
        guard let staff = authVM.staff else { return }
        var updated = booking
        updated.status = newStatus
        Task {
            do {
                try await APIClient.shared.updateBookingStatus(id: booking.id, status: newStatus, staff: staff)
                await MainActor.run {
                    bookingsVM.updateBookingLocally(updated)
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    bookingsVM.error = "Failed to update status: \(error.localizedDescription)"
                }
            }
        }
    }

    private var assignTableButton: some View {
        HStack {
            if let tableId = booking.tableId, !tableId.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "table.furniture")
                        .font(AppFont.body(11, weight: .bold))
                    Text("Table: \(tableId)")
                        .font(AppFont.body(11, weight: .bold))
                }
                .foregroundStyle(PPBrand.charcoal)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(PPBrand.sage)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                HStack(spacing: 4) {
                    Image(systemName: "table.furniture")
                        .font(AppFont.body(11, weight: .bold))
                    Text("Assign Table")
                        .font(AppFont.body(11, weight: .bold))
                }
                .foregroundStyle(Color(red: 0.6, green: 0.4, blue: 0.1))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(red: 0.99, green: 0.96, blue: 0.88))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(red: 0.9, green: 0.8, blue: 0.5), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            Spacer()
        }
    }

    // MARK: - Floor plan preview (like web)

    private var notesSection: some View {
        Group {
            if let notes = booking.notes, !notes.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Notes")
                        .font(AppFont.body(10, weight: .bold))
                        .textCase(.uppercase)
                        .tracking(0.5)
                        .foregroundStyle(Color(red: 0.6, green: 0.4, blue: 0.1))
                    Text(notes)
                        .font(AppFont.body(11))
                        .foregroundStyle(Color(red: 0.4, green: 0.3, blue: 0.1))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(red: 0.99, green: 0.96, blue: 0.88))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(red: 0.9, green: 0.8, blue: 0.5), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private var editDeleteButtons: some View {
        VStack(spacing: 8) {
            if authVM.staff?.role == "super_admin" || authVM.staff?.canUpdateStatus == true {
                Button {
                    Haptics.light()
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "pencil")
                        Text("Edit")
                    }
                    .font(AppFont.body(12, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.white)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.2), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
            if authVM.staff?.role == "super_admin" {
                Button {
                    showDeleteBookingConfirm = true
                } label: {
                    Text("Delete booking")
                        .font(AppFont.body(10, weight: .bold))
                        .foregroundStyle(Color(red: 0.7, green: 0.2, blue: 0.2))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Floor plan preview (like web)

    private var floorPlanPreview: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Seating")
                .font(AppFont.body(10, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            FloorPlanView(
                studio: booking.studio,
                bookings: bookingsVM.bookings,
                selectedDate: booking.date,
                selectedTime: booking.time,
                highlightTableId: booking.tableId
            )
            .frame(height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1))
        }
    }

    // MARK: - Party payment section (like web)

    private var partyPaymentSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Party Payment")
                .font(AppFont.body(10, weight: .bold))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))

            let seats = booking.finalSeats ?? booking.paintersCount
            let deposit = booking.depositAmount ?? 50
            let partyPrice = 25.0
            let total = Double(seats) * partyPrice
            let balance = booking.finalBalance ?? max(0, total - deposit)

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Seats")
                        .font(AppFont.body(9, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    Text("\(seats)")
                        .font(AppFont.body(12, weight: .black))
                        .foregroundStyle(PPBrand.charcoal)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Deposit")
                        .font(AppFont.body(9, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    Text(String(format: "£%.2f", deposit))
                        .font(AppFont.body(12, weight: .black))
                        .foregroundStyle(PPBrand.charcoal)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Total")
                        .font(AppFont.body(9, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    Text(String(format: "£%.2f", total))
                        .font(AppFont.body(12, weight: .black))
                        .foregroundStyle(PPBrand.charcoal)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Balance")
                        .font(AppFont.body(9, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                    Text(String(format: "£%.2f", balance))
                        .font(AppFont.body(12, weight: .black))
                        .foregroundStyle(PPBrand.charcoal)
                }
            }

            if let paymentLink = booking.paymentLinkUrl, !paymentLink.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "link")
                        .font(AppFont.body(9))
                    Text("Payment link")
                        .font(AppFont.body(10, weight: .semibold))
                        .underline()
                }
                .foregroundStyle(Color(red: 0.2, green: 0.4, blue: 0.8))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(red: 0.97, green: 0.98, blue: 0.98))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Communication history (like web)

    private var communicationHistory: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Communication History")
                .font(AppFont.body(10, weight: .black))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))

            if commLoading {
                Text("Loading…")
                    .font(AppFont.body(11))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            } else if commLogs.isEmpty {
                Text("No emails or SMS sent for this booking.")
                    .font(AppFont.body(11))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            } else {
                ForEach(commLogs) { log in
                    HStack(alignment: .top, spacing: 8) {
                        Text(log.emailType?.contains("sms") == true ? "SMS" : "Email")
                            .font(AppFont.body(8, weight: .black))
                            .textCase(.uppercase)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(log.emailType?.contains("sms") == true ? PPBrand.charcoal.opacity(0.1) : Color(red: 0.88, green: 0.95, blue: 1.0))
                            .foregroundStyle(log.emailType?.contains("sms") == true ? PPBrand.charcoal.opacity(0.6) : Color(red: 0.1, green: 0.3, blue: 0.7))
                            .clipShape(RoundedRectangle(cornerRadius: 4))

                        VStack(alignment: .leading, spacing: 1) {
                            Text((log.emailType ?? "Unknown").replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(AppFont.body(10, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                            if let created = log.createdAt {
                                Text(formatCommDate(created))
                                    .font(AppFont.body(9))
                                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                            }
                        }

                        Spacer()

                        Text(log.status ?? "")
                            .font(AppFont.body(8, weight: .black))
                            .textCase(.uppercase)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(commStatusColor(log.status))
                            .foregroundStyle(commStatusTextColor(log.status))
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(.top, 8)
        .overlay(
            Rectangle()
                .fill(PPBrand.charcoal.opacity(0.1))
                .frame(height: 1),
            alignment: .top
        )
    }

    private func commStatusColor(_ status: String?) -> Color {
        switch status {
        case "delivered", "sent": return Color(red: 0.94, green: 0.99, blue: 0.94)
        case "failed", "bounced", "undelivered": return Color(red: 0.99, green: 0.93, blue: 0.93)
        case "opened", "clicked": return Color(red: 0.92, green: 0.88, blue: 0.97)
        default: return Color.gray.opacity(0.15)
        }
    }

    private func commStatusTextColor(_ status: String?) -> Color {
        switch status {
        case "delivered", "sent": return Color(red: 0.1, green: 0.5, blue: 0.2)
        case "failed", "bounced", "undelivered": return Color(red: 0.7, green: 0.15, blue: 0.15)
        case "opened", "clicked": return Color(red: 0.4, green: 0.2, blue: 0.6)
        default: return Color.gray
        }
    }

    private func formatCommDate(_ dateStr: String) -> String {
        PPDateDisplay.dateTime(dateStr)
    }

    private func loadCommLogs() {
        guard let staff = authVM.staff else { return }
        commLoading = true
        Task {
            do {
                let logs = try await APIClient.shared.loadEmailLogs(staff: staff, limit: 200)
                let filtered = logs.filter { $0.bookingId == booking.id }
                await MainActor.run {
                    commLogs = filtered
                    commLoading = false
                }
            } catch {
                await MainActor.run {
                    commLoading = false
                }
            }
        }
    }

    private func deleteBooking() {
        guard let staff = authVM.staff else { return }
        Task {
            try? await APIClient.shared.updateBookingStatus(id: booking.id, status: "cancelled", staff: staff)
            await MainActor.run {
                var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
                updated.status = "cancelled"
                bookingsVM.updateBookingLocally(updated)
                dismiss()
            }
        }
    }

    private func deletePhoto(at index: Int) {
        guard let staff = authVM.staff else { return }
        var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
        guard var photos = updated.photos else { return }
        photos.remove(at: index)
        updated.photos = photos
        // Also remove tags for that photo
        if var tags = updated.photoTags {
            tags.removeValue(forKey: String(index))
            // Reindex remaining tags
            var reindexed: [String: [PhotoTag]] = [:]
            for (key, value) in tags {
                if let k = Int(key), k > index {
                    reindexed[String(k - 1)] = value
                } else {
                    reindexed[key] = value
                }
            }
            updated.photoTags = reindexed
        }
        Task {
            guard let photosObj = try? APIClient.jsonPatchValue(updated.photos),
                  let tagsObj = try? APIClient.jsonPatchValue(updated.photoTags) else { return }
            await bookingsVM.patchBooking(
                id: updated.id, studio: updated.studio,
                fields: ["photos": photosObj, "photoTags": tagsObj],
                updated: updated, staff: staff
            )
        }
    }

    private var photosGrid: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Photos")
                    .font(PPBrand.bodyFontSmall.bold())
                Spacer()
                if let photos = booking.photos, !photos.isEmpty, authVM.staff?.canUpdateStatus == true {
                    Button {
                        tagMode.toggle()
                    } label: {
                        Text(tagMode ? "✓ Tag Mode ON" : "Tag Mode")
                            .font(AppFont.heading(9))
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(tagMode ? PPBrand.charcoal : PPBrand.clay100)
                            .foregroundStyle(tagMode ? .white : PPBrand.charcoal)
                            .clipShape(Capsule())
                    }
                }
                Button {
                    showCamera = true
                } label: {
                    Label("Add", systemImage: "camera")
                        .font(PPBrand.bodyFontCaption.bold())
                }
            }

            if let photos = booking.photos, !photos.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(Array(photos.enumerated()), id: \.offset) { index, urlStr in
                        if let url = URL(string: urlStr) {
                            GeometryReader { geo in
                                let w = geo.size.width
                                ZStack {
                                    CachedAsyncImage(url: url, contentMode: .fill)
                                        .frame(width: w, height: w)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))

                                    if tagMode {
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(PPBrand.charcoal.opacity(0.5), lineWidth: 2)
                                            .frame(width: w, height: w)
                                    }

                                    let tags = booking.photoTags?[String(index)] ?? []
                                    ForEach(Array(tags.enumerated()), id: \.offset) { ti, tag in
                                        PhotoTagBadge(tag: tag, canRemove: tagMode && authVM.staff?.canUpdateStatus == true) {
                                            removePhotoTag(photoIndex: index, tagIndex: ti)
                                        }
                                        .position(
                                            x: CGFloat(tag.x) / 100 * w,
                                            y: CGFloat(tag.y) / 100 * w
                                        )
                                    }

                                    // Photo delete button (like web)
                                    if authVM.staff?.canUpdateStatus == true || authVM.staff?.role == "super_admin" {
                                        Button {
                                            Haptics.light()
                                            pendingDeletePhotoIndex = index
                                            showDeletePhotoConfirm = true
                                        } label: {
                                            Text("✕")
                                                .font(AppFont.body(10, weight: .bold))
                                                .foregroundStyle(.white)
                                                .frame(width: 20, height: 20)
                                                .background(Color.red)
                                                .clipShape(Circle())
                                        }
                                        .buttonStyle(.plain)
                                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                                        .padding(6)
                                    }
                                }
                                .frame(width: w, height: w)
                                .contentShape(Rectangle())
                                .onTapGesture { location in
                                    if tagMode {
                                        let xPct = Double(location.x / w * 100)
                                        let yPct = Double(location.y / w * 100)
                                        addPhotoTag(photoIndex: index, label: "", status: "ready", x: xPct, y: yPct)
                                    } else {
                                        modalImages = photos
                                        modalIndex = index
                                        modalPhotoTags = booking.photoTags
                                    }
                                }
                            }
                            .aspectRatio(1, contentMode: .fit)
                        }
                    }
                }
                if tagMode {
                    Text("Tap a photo to add a location or status stamp")
                        .font(AppFont.body(10, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
            } else {
                // No photos — show placeholder square same size as photos
                GeometryReader { geo in
                    let w = geo.size.width
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(PPBrand.clay100)
                            .frame(width: w, height: w)
                        VStack(spacing: 6) {
                            Image(systemName: "photo")
                                .font(.system(size: 24))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.25))
                            Text("No photos yet")
                                .font(AppFont.body(10, weight: .medium))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                        }
                    }
                    .frame(width: w, height: w)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PPBrand.charcoal.opacity(0.1), lineWidth: 1))
                }
                .aspectRatio(1, contentMode: .fit)
            }
        }
        .sheet(item: $tagPopover) { state in
            TagSelectionSheet { label, status in
                addPhotoTag(photoIndex: state.photoIndex, label: label, status: status, x: state.x, y: state.y)
                tagPopover = nil
            }
            .presentationDetents([.height(280)])
        }
    }

    private func presentTagPopover(photoIndex: Int, location: CGPoint) {
        let x = Double(location.x)
        let y = Double(location.y)
        tagPopover = TagPopoverState(photoIndex: photoIndex, x: x, y: y)
    }

    private func addPhotoTag(photoIndex: Int, label: String, status: String, x: Double, y: Double) {
        guard let staff = authVM.staff else { return }
        var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
        var tags = updated.photoTags ?? [:]
        var existing = tags[String(photoIndex)] ?? []
        existing.append(PhotoTag(id: nil, label: label.isEmpty ? nil : label, status: status, x: x, y: y))
        tags[String(photoIndex)] = existing
        updated.photoTags = tags
        Task { await patchTags(updated, staff: staff) }
    }

    private func removePhotoTag(photoIndex: Int, tagIndex: Int) {
        guard let staff = authVM.staff else { return }
        var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
        guard var tags = updated.photoTags, var existing = tags[String(photoIndex)] else { return }
        existing.remove(at: tagIndex)
        if existing.isEmpty {
            tags.removeValue(forKey: String(photoIndex))
        } else {
            tags[String(photoIndex)] = existing
        }
        updated.photoTags = tags
        Task { await patchTags(updated, staff: staff) }
    }

    /// Sends only photo_tags to the server — a stale local copy can never
    /// overwrite notes or other fields.
    private func patchTags(_ booking: Booking, staff: Staff) async {
        guard let tagsObj = try? APIClient.jsonPatchValue(booking.photoTags) else { return }
        await bookingsVM.patchBooking(
            id: booking.id, studio: booking.studio,
            fields: ["photoTags": tagsObj],
            updated: booking, staff: staff
        )
    }

    private var actionButtons: some View {
        VStack(spacing: 8) {
            if stage == .painted, authVM.staff != nil {
                Button {
                    showReadyPrompt = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Ready for Collection")
                    }
                    .font(PPBrand.bodyFont.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(PPBrand.charcoal)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }

            if stage == .ready, authVM.staff != nil {
                Button {
                    showCollectedPrompt = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Mark as Collected")
                    }
                    .font(PPBrand.bodyFont.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.green)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }

            if stage == .ready, let staff = authVM.staff {
                Button {
                    isSendingNotification = true
                    notificationStatus = nil
                    Task {
                        do {
                            try await APIClient.shared.sendCollectionReady(bookingId: booking.id, staff: staff)
                            await MainActor.run {
                                isSendingNotification = false
                                notificationStatus = "Notification sent!"
                                Haptics.success()
                            }
                        } catch {
                            await MainActor.run {
                                isSendingNotification = false
                                notificationStatus = "Failed: \(error.localizedDescription)"
                                Haptics.error()
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if isSendingNotification {
                            ProgressView()
                        } else {
                            Image(systemName: "paperplane.fill")
                        }
                        Text("Send collection ready notification")
                    }
                    .font(PPBrand.bodyFontSmall.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(PPBrand.sage)
                    .foregroundStyle(PPBrand.charcoal)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                if let status = notificationStatus {
                    Text(status)
                        .font(PPBrand.bodyFontCaption)
                        .foregroundStyle(status.hasPrefix("Failed") ? .red : PPBrand.charcoal.opacity(0.6))
                }
            }
        }
    }

    private func uploadPhoto(_ data: Data) {
        guard let staff = authVM.staff else { return }
        isUploading = true
        Task {
            do {
                let url = try await APIClient.shared.uploadPhoto(
                    imageData: data,
                    fileName: "photo_\(Int(Date().timeIntervalSince1970)).jpg",
                    bookingId: booking.id,
                    staff: staff
                )
                if let urlObj = URL(string: url), let img = UIImage(data: data) {
                    CachedAsyncImage.prefetch(url: urlObj, image: img)
                }
                var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
                var photos = updated.photos ?? []
                photos.append(url)
                updated.photos = photos
                try await APIClient.shared.updateBooking(updated, staff: staff)
                await MainActor.run {
                    bookingsVM.updateBookingLocally(updated)
                    isUploading = false
                }
            } catch {
                await MainActor.run {
                    isUploading = false
                    uploadError = "Upload failed: \(error.localizedDescription)"
                    Haptics.error()
                }
            }
        }
    }

    private func moveBooking(to newStage: CollectionStage, location: String? = nil) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                try await APIClient.shared.updateCollectionStatus(
                    bookingId: booking.id,
                    studio: booking.studio,
                    status: newStage.rawValue,
                    staff: staff,
                    location: newStage == .ready ? location : nil
                )
                await MainActor.run {
                    var updated = bookingsVM.bookings.first(where: { $0.id == booking.id }) ?? booking
                    updated.collectionStatus = newStage.rawValue
                    updated.readyAt = newStage == .ready ? ISO8601DateFormatter().string(from: Date())
                        : newStage == .painted ? nil : updated.readyAt
                    updated.collectedAt = newStage == .collected ? ISO8601DateFormatter().string(from: Date()) : nil
                    if newStage == .ready, let loc = location {
                        var tags = updated.photoTags ?? [:]
                        for key in Array(tags.keys) {
                            tags[key]?.removeAll { $0.status == "location" }
                            if tags[key]?.isEmpty == true { tags.removeValue(forKey: key) }
                        }
                        var firstPhotoTags = tags["0"] ?? []
                        firstPhotoTags.append(PhotoTag(id: nil, label: loc, status: "location", x: 50, y: 50))
                        tags["0"] = firstPhotoTags
                        updated.photoTags = tags
                    }
                    bookingsVM.updateBookingLocally(updated)
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    uploadError = "Failed to update: \(error.localizedDescription)"
                    Haptics.error()
                }
            }
        }
    }
}

// MARK: - Scan Result Sheet (focused view after QR scan)

struct ScanResultSheet: View {
    let booking: Booking
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @Environment(\.dismiss) var dismiss
    @State private var isMarking = false
    @State private var alreadyCollected = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let photo = booking.photos?.first, let url = URL(string: photo) {
                        CachedAsyncImage(url: url, contentMode: .fit, maxDimension: 1000)
                            .frame(maxWidth: .infinity)
                            .frame(height: 240)
                            .background(PPBrand.clay100.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    } else {
                        VStack(spacing: 6) {
                            Image(systemName: "camera")
                                .font(AppFont.heading(22))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                            Text("No photo")
                                .font(PPBrand.bodyFontCaption)
                                .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 160)
                        .background(PPBrand.clay100.opacity(0.5))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    HStack(spacing: 8) {
                        Image(systemName: "mappin.circle.fill")
                            .font(AppFont.body(16, weight: .bold))
                        Text("Location")
                            .font(AppFont.body(12, weight: .bold))
                        Spacer()
                        Text(scanBookingLocation ?? "Not set")
                            .font(AppFont.body(14, weight: .bold))
                    }
                    .foregroundStyle(PPBrand.charcoal)
                    .padding(14)
                    .background(PPBrand.sage)
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    // Info card
                    VStack(alignment: .leading, spacing: 10) {
                        scanInfoRow("Name", booking.name, icon: "person.fill")
                        scanInfoRow("Date", PPDateDisplay.date(booking.date), icon: "calendar")
                        scanInfoRow("Phone", booking.phone.flatMap { $0.isEmpty ? nil : $0 } ?? "Not provided", icon: "phone.fill")
                        scanInfoRow("Email", booking.email.flatMap { $0.isEmpty ? nil : $0 } ?? "Not provided", icon: "envelope.fill")
                        scanInfoRow("Tags", scanTagSummary ?? "No tags added", icon: "checkmark.circle.fill")
                    }
                    .padding(16)
                    .background(PPBrand.sage.opacity(0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                    markCollectedButton
                }
                .padding(16)
            }
            .navigationTitle(booking.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func scanInfoRow(_ label: String, _ value: String, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(AppFont.body(12))
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                .frame(width: 20)
            Text(label)
                .font(AppFont.body(11, weight: .bold))
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                .frame(width: 80, alignment: .leading)
            Text(value)
                .font(AppFont.body(12, weight: .semibold))
                .foregroundStyle(PPBrand.charcoal)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func scanSessionLabel(_ session: String) -> String {
        switch session {
        case "painting": return "Painting"
        case "birthday-party": return "Birthday Party"
        case "baby-shower-hen": return "Baby Shower / Hen"
        case "clay-imprints": return "Baby Prints"
        case "corporate": return "Corporate"
        case "exclusive-hire": return "Exclusive Hire"
        default: return session
        }
    }

    private var scanBookingLocation: String? {
        guard let photoTags = booking.photoTags else { return nil }
        for key in photoTags.keys.sorted() {
            if let location = photoTags[key]?.first(where: { $0.status == "location" })?.label, !location.isEmpty {
                return location
            }
        }
        return nil
    }

    private var scanTagSummary: String? {
        guard let photoTags = booking.photoTags else { return nil }
        var counts: [String: Int] = [:]
        for tag in photoTags.values.flatMap({ $0 }) where tag.status != "location" {
            let label = tag.label.flatMap { $0.isEmpty ? nil : $0 } ?? tag.status.replacingOccurrences(of: "_", with: " ").capitalized
            counts[label, default: 0] += 1
        }
        guard !counts.isEmpty else { return nil }
        return counts.keys.sorted().map { counts[$0] == 1 ? $0 : "\(counts[$0]!) × \($0)" }.joined(separator: ", ")
    }

    private func scanCollectionLabel(_ status: String) -> String {
        switch status {
        case CollectionStage.painted.rawValue: return "Painted"
        case CollectionStage.ready.rawValue: return "Ready to Collect"
        case CollectionStage.collected.rawValue: return "Collected"
        default: return status.capitalized
        }
    }

    private var markCollectedButton: some View {
        VStack(spacing: 8) {
            if alreadyCollected {
                Text("Already collected")
                    .font(PPBrand.bodyFontSmall.bold())
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            } else {
                Button {
                    markCollected()
                } label: {
                    HStack(spacing: 8) {
                        if isMarking {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "checkmark.circle.fill")
                        }
                        Text("Mark as Collected")
                    }
                    .font(PPBrand.bodyFont.bold())
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(isMarking ? Color.green.opacity(0.6) : Color.green)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isMarking)
            }
        }
        .padding(.top, 8)
    }

    private func markCollected() {
        guard let staff = authVM.staff else { return }
        isMarking = true
        Haptics.light()
        Task {
            do {
                try await APIClient.shared.updateCollectionStatus(
                    bookingId: booking.id, studio: booking.studio,
                    status: CollectionStage.collected.rawValue, staff: staff
                )
                await MainActor.run {
                    bookingsVM.updateBookingLocally(booking.id, collectionStatus: CollectionStage.collected.rawValue)
                    isMarking = false
                    Haptics.success()
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isMarking = false
                    Haptics.error()
                }
            }
        }
    }
}

// MARK: - Add Profile Sheet

struct AddProfileSheet: View {
    let stage: CollectionStage
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @Environment(\.dismiss) var dismiss
    @State private var name = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var date = Date()
    @State private var studio: Studio = .Putney
    @State private var photos: [String] = []
    @State private var showCamera = false
    @State private var isSaving = false
    @State private var saveError: String?

    private var isSuperAdmin: Bool {
        authVM.staff?.role == "super_admin"
    }

    private var availableStudios: [Studio] {
        authVM.staff?.visibleStudios ?? Studio.allCases
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Customer")) {
                    TextField("Name *", text: $name)
                    TextField("Phone (optional)", text: $phone)
                    TextField("Email (optional)", text: $email)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                }
                Section(header: Text("Details")) {
                    DatePicker("Date of Painting", selection: $date, displayedComponents: .date)
                    if availableStudios.count > 1 {
                        Picker("Studio", selection: $studio) {
                            ForEach(availableStudios, id: \.self) { s in
                                Text(s.rawValue).tag(s)
                            }
                        }
                    }
                }
                Section(header: Text("Photos")) {
                    Button {
                        showCamera = true
                    } label: {
                        Label("Add Photo", systemImage: "camera")
                    }
                    if !photos.isEmpty {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                            ForEach(photos, id: \.self) { urlStr in
                                if let url = URL(string: urlStr) {
                                    CachedAsyncImage(url: url, contentMode: .fit)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 100)
                                        .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Add to \(stage.label)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        saveProfile()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
            }
            .onAppear {
                studio = bookingsVM.selectedStudio.flatMap { availableStudios.contains($0) ? $0 : nil }
                    ?? availableStudios.first ?? .Putney
            }
            .sheet(isPresented: $showCamera) {
                CameraPicker { data in
                    uploadPhoto(data)
                }
            }
            .alert("Could not save profile", isPresented: Binding(
                get: { saveError != nil },
                set: { if !$0 { saveError = nil } }
            )) {
                Button("OK") { saveError = nil }
            } message: {
                Text(saveError ?? "Please try again.")
            }
        }
    }

    private func uploadPhoto(_ data: Data) {
        guard let staff = authVM.staff else { return }
        Task {
            do {
                let url = try await APIClient.shared.uploadPhoto(
                    imageData: data,
                    fileName: "profile_\(Int(Date().timeIntervalSince1970)).jpg",
                    bookingId: "temp_\(UUID().uuidString.prefix(8))",
                    staff: staff
                )
                if let urlObj = URL(string: url), let img = UIImage(data: data) {
                    CachedAsyncImage.prefetch(url: urlObj, image: img)
                }
                await MainActor.run { photos.append(url) }
            } catch {
                print("AddProfile photo upload failed: \(error)")
            }
        }
    }

    private func saveProfile() {
        guard let staff = authVM.staff else { return }
        isSaving = true
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let dateStr = formatter.string(from: date)

        Task {
            do {
                let bookingId = UUID().uuidString
                let booking = Booking(
                    id: bookingId,
                    studio: studio.rawValue,
                    name: name.trimmingCharacters(in: .whitespaces),
                    email: email.trimmingCharacters(in: .whitespaces),
                    phone: phone.trimmingCharacters(in: .whitespaces),
                    date: dateStr,
                    time: "10:00",
                    paintersCount: 1,
                    sessionType: "painting",
                    status: "completed",
                    requestDate: ISO8601DateFormatter().string(from: Date()),
                    photos: photos.isEmpty ? nil : photos,
                    collectionStatus: stage.rawValue
                )
                try await APIClient.shared.createBooking(booking, staff: staff)
                await MainActor.run {
                    bookingsVM.bookings.insert(booking, at: 0)
                    isSaving = false
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isSaving = false
                    saveError = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Photo Tag Badge

struct PhotoTagBadge: View {
    let tag: PhotoTag
    let canRemove: Bool
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 3) {
            if tag.status == "location" {
                Image(systemName: "mappin.circle.fill")
                    .font(AppFont.body(10, weight: .bold))
                Text(displayText)
                    .font(AppFont.body(9, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(0.3)
            } else {
                // Show checkmark for ready and any other status
                Image(systemName: "checkmark.circle.fill")
                    .font(AppFont.body(12, weight: .bold))
            }
            if canRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(AppFont.body(8, weight: .bold))
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(TAG_COLORS[tag.status] ?? Color(red: 0.05, green: 0.7, blue: 0.4))
        .foregroundStyle(.white)
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
    }

    private var displayText: String {
        if tag.status == "location" {
            return tag.label ?? "Location"
        }
        return TAG_LABELS[tag.status] ?? tag.status
    }
}

// MARK: - Tag Selection Sheet

struct TagSelectionSheet: View {
    let onAdd: (String, String) -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Add Ready Stamp")
                    .font(AppFont.heading(16))
                    .foregroundStyle(PPBrand.charcoal)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 60, weight: .bold))
                    .foregroundStyle(Color(red: 0.05, green: 0.7, blue: 0.4))

                Text("A tick stamp will be placed where you tapped on the photo.")
                    .font(AppFont.body(12))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.6))
                    .multilineTextAlignment(.center)

                Button {
                    onAdd("", "ready")
                    dismiss()
                } label: {
                    Text("Add Tick Stamp")
                        .font(AppFont.heading(14))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color(red: 0.05, green: 0.7, blue: 0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                Spacer()
            }
            .padding(16)
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Ready Location Sheet (prompt for location when marking Ready)

struct ReadyLocationSheet: View {
    @Binding var selectedLocation: String?
    let onConfirm: (String?) -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Where is the item located?")
                    .font(AppFont.heading(16))
                    .foregroundStyle(PPBrand.charcoal)

                ForEach(LOCATION_OPTIONS, id: \.self) { loc in
                    Button {
                        onConfirm(loc)
                        dismiss()
                    } label: {
                        HStack {
                            Image(systemName: "mappin.circle.fill")
                                .font(AppFont.body(14))
                                .foregroundStyle(PPBrand.charcoal)
                            Text(loc)
                                .font(AppFont.body(14, weight: .bold))
                                .foregroundStyle(PPBrand.charcoal)
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(PPBrand.clay100)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    onConfirm(nil)
                    dismiss()
                } label: {
                    Text("Skip location")
                        .font(AppFont.body(13, weight: .semibold))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }

                Spacer()
            }
            .padding(16)
            .navigationTitle("Item Location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
