import Foundation
import SwiftUI

@MainActor
class BookingsViewModel: ObservableObject {
    @Published var bookings: [Booking] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var isOffline = false

    // Filters
    /// Global studio filter — drives the location switcher in the header and
    /// is shared by all views. nil means "All studios". Persisted so the
    /// chosen location survives app restarts.
    @Published var selectedStudio: Studio? = nil {
        didSet {
            UserDefaults.standard.set(selectedStudio?.rawValue, forKey: Self.studioDefaultsKey)
        }
    }
    @Published var selectedStatus: BookingStatus? = nil
    @Published var searchText: String = ""
    @Published var selectedDate: Date? = nil
    @Published var showTodayOnly: Bool = false
    @Published var sortOption: SortOption = .dateDesc
    @Published var dateRangeStart: Date? = nil
    @Published var dateRangeEnd: Date? = nil
    @Published var selectedBookingIds: Set<String> = []
    @Published var isBulkSelectMode: Bool = false
    @Published var selectedSessionType: String? = nil

    enum SortOption: String, CaseIterable {
        case dateDesc = "Newest Date"
        case dateAsc = "Oldest Date"
        case nameAsc = "Name A-Z"
        case nameDesc = "Name Z-A"
        case statusAsc = "Status"
        case createdDesc = "Recently Created"
    }

    private static let studioDefaultsKey = "pp_active_studio"

    private let cacheURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("bookings_cache.json")
    private static let sharedDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    init() {
        if let raw = UserDefaults.standard.string(forKey: Self.studioDefaultsKey) {
            selectedStudio = Studio(rawValue: raw)
        }
    }

    /// Bookings scoped to the active location (selectedStudio). All display
    /// surfaces should use this; `bookings` stays unfiltered for id/token
    /// lookups (scanner, detail fetches, status updates).
    var visibleBookings: [Booking] {
        guard let studio = selectedStudio else { return bookings }
        return bookings.filter { $0.studio == studio.rawValue }
    }

    var filteredBookings: [Booking] {
        let todayStr = Self.sharedDateFormatter.string(from: Date())
        return bookings.filter { booking in
            if showTodayOnly {
                if booking.date != todayStr { return false }
            }
            if let studio = selectedStudio, booking.studio != studio.rawValue { return false }
            if let status = selectedStatus, booking.status != status.rawValue { return false }
            if let sessionType = selectedSessionType, booking.sessionType != sessionType { return false }
            if !searchText.isEmpty {
                let q = searchText.lowercased()
                if !booking.name.lowercased().contains(q)
                    && !(booking.email ?? "").lowercased().contains(q)
                    && !(booking.phone ?? "").lowercased().contains(q)
                    && !booking.id.lowercased().contains(q) {
                    return false
                }
            }
            if let date = selectedDate {
                let dateStr = Self.sharedDateFormatter.string(from: date)
                if booking.date != dateStr { return false }
            }
            if let rangeStart = dateRangeStart {
                let startStr = Self.sharedDateFormatter.string(from: rangeStart)
                if booking.date < startStr { return false }
            }
            if let rangeEnd = dateRangeEnd {
                let endStr = Self.sharedDateFormatter.string(from: rangeEnd)
                if booking.date > endStr { return false }
            }
            return true
        }
        .sorted { a, b in
            switch sortOption {
            case .dateDesc:
                return a.date > b.date || (a.date == b.date && a.time > b.time)
            case .dateAsc:
                return a.date < b.date || (a.date == b.date && a.time < b.time)
            case .nameAsc:
                return a.name.lowercased() < b.name.lowercased()
            case .nameDesc:
                return a.name.lowercased() > b.name.lowercased()
            case .statusAsc:
                return a.status < b.status
            case .createdDesc:
                return (a.createdAt ?? "") > (b.createdAt ?? "")
            }
        }
    }

    // MARK: - Offline Cache

    func saveToCache() {
        do {
            let data = try JSONEncoder().encode(bookings)
            try data.write(to: cacheURL)
        } catch {
            print("Failed to cache bookings: \(error)")
        }
    }

    func loadFromCache() {
        guard FileManager.default.fileExists(atPath: cacheURL.path) else { return }
        do {
            let data = try Data(contentsOf: cacheURL)
            bookings = try JSONDecoder().decode([Booking].self, from: data)
        } catch {
            print("Failed to load cached bookings: \(error)")
        }
    }

    func loadBookings(staff: Staff) async {
        isLoading = true
        error = nil
        do {
            let newBookings = try await APIClient.shared.loadBookings(staff: staff)
            // Always replace — skipping on an unchanged ID set left stale copies
            // (notes, tables, statuses edited elsewhere never refreshed).
            bookings = newBookings
            saveToCache()
            isOffline = false
        } catch let err as APIError {
            isOffline = true
            if bookings.isEmpty {
                loadFromCache()
            }
            self.error = bookings.isEmpty ? err.errorDescription : "Offline — showing cached data (\(err.errorDescription ?? ""))"
        } catch let err {
            isOffline = true
            if bookings.isEmpty {
                loadFromCache()
            }
            self.error = bookings.isEmpty ? "Failed to load: \(err.localizedDescription)" : "Offline — showing cached data (\(err.localizedDescription))"
        }
        isLoading = false
    }

    func updateStatus(booking: Booking, status: BookingStatus, staff: Staff) async {
        do {
            try await APIClient.shared.updateBookingStatus(id: booking.id, status: status.rawValue, staff: staff)
            if let idx = bookings.firstIndex(where: { $0.id == booking.id }) {
                bookings[idx] = Booking(
                    id: booking.id, studio: booking.studio, name: booking.name,
                    email: booking.email, phone: booking.phone, date: booking.date,
                    time: booking.time, paintersCount: booking.paintersCount,
                    sessionType: booking.sessionType, notes: booking.notes,
                    status: status.rawValue, requestDate: booking.requestDate,
                    estimatedPrice: booking.estimatedPrice, source: booking.source,
                    giftCardCode: booking.giftCardCode, giftCardDiscount: booking.giftCardDiscount,
                    finalPrice: booking.finalPrice, tableId: booking.tableId,
                    depositAmount: booking.depositAmount, finalSeats: booking.finalSeats,
                    finalBalance: booking.finalBalance, paymentLinkUrl: booking.paymentLinkUrl,
                    paymentLinkSentAt: booking.paymentLinkSentAt, paymentStatus: booking.paymentStatus,
                    stripePaymentIntentId: booking.stripePaymentIntentId,
                    managementToken: booking.managementToken, createdAt: booking.createdAt,
                    photos: booking.photos,
                    collectionStatus: booking.collectionStatus,
                    readyAt: booking.readyAt,
                    collectedAt: booking.collectedAt,
                    photoTags: booking.photoTags
                )
            }
            Haptics.light()
        } catch let err as APIError {
            self.error = err.errorDescription
            Haptics.error()
        } catch let err {
            self.error = "Failed to update status: \(err.localizedDescription)"
            Haptics.error()
        }
    }

    @discardableResult
    func saveBooking(_ booking: Booking, staff: Staff) async -> Bool {
        do {
            try await APIClient.shared.updateBooking(booking, staff: staff)
            if let idx = bookings.firstIndex(where: { $0.id == booking.id }) {
                bookings[idx] = booking
            }
            error = nil
            return true
        } catch let err as APIError {
            self.error = err.errorDescription
        } catch let err {
            self.error = "Failed to save: \(err.localizedDescription)"
        }
        return false
    }

    /// Writes only `fields` to the server so unrelated columns can't be
    /// clobbered by a stale copy, then applies `updated` locally on success.
    @discardableResult
    func patchBooking(id: String, studio: String, fields: [String: Any], updated: Booking, staff: Staff) async -> Bool {
        do {
            try await APIClient.shared.updateBookingFields(id: id, studio: studio, fields: fields, staff: staff)
            updateBookingLocally(updated)
            error = nil
            return true
        } catch let err as APIError {
            self.error = err.errorDescription
        } catch let err {
            self.error = "Failed to save: \(err.localizedDescription)"
        }
        return false
    }

    func createWalkIn(_ booking: Booking, staff: Staff) async -> Bool {
        do {
            try await APIClient.shared.createBooking(booking, staff: staff)
            await loadBookings(staff: staff)
            Haptics.success()
            return true
        } catch let err as APIError {
            self.error = err.errorDescription
            Haptics.error()
            return false
        } catch let err {
            self.error = "Failed to create booking: \(err.localizedDescription)"
            Haptics.error()
            return false
        }
    }

    func deleteBooking(_ booking: Booking, staff: Staff) async {
        do {
            try await APIClient.shared.deleteBooking(id: booking.id, staff: staff)
            bookings.removeAll { $0.id == booking.id }
            saveToCache()
            Haptics.success()
        } catch let err as APIError {
            self.error = err.errorDescription
            Haptics.error()
        } catch let err {
            self.error = "Failed to delete: \(err.localizedDescription)"
            Haptics.error()
        }
    }

    // MARK: - Realtime (polling)

    private var realtimeTask: Task<Void, Never>?

    func sendPaymentReminder(for booking: Booking, finalSeats: Int, staff: Staff) async -> Bool {
        do {
            let result = try await APIClient.shared.sendPaymentReminder(
                bookingId: booking.id, finalSeats: finalSeats, staff: staff
            )
            if let idx = bookings.firstIndex(where: { $0.id == booking.id }) {
                var updated = bookings[idx]
                updated.finalSeats = finalSeats
                updated.finalBalance = result.finalBalance ?? updated.finalBalance
                updated.paymentLinkUrl = result.paymentLinkUrl ?? updated.paymentLinkUrl
                updated.paymentLinkSentAt = ISO8601DateFormatter().string(from: Date())
                bookings[idx] = updated
            }
            saveToCache()
            Haptics.success()
            Analytics.bookingAction("payment_reminder", bookingId: booking.id)
            return true
        } catch let err as APIError {
            self.error = err.errorDescription
            Haptics.error()
            return false
        } catch let err {
            self.error = "Failed to send reminder: \(err.localizedDescription)"
            Haptics.error()
            return false
        }
    }

    // MARK: - Bulk Actions

    func bulkUpdateStatus(status: BookingStatus, staff: Staff) async {
        let ids = Array(selectedBookingIds)
        for id in ids {
            if let booking = bookings.first(where: { $0.id == id }) {
                await updateStatus(booking: booking, status: status, staff: staff)
            }
        }
        selectedBookingIds.removeAll()
        isBulkSelectMode = false
        Analytics.track("bulk_status_update", properties: ["count": ids.count, "status": status.rawValue])
    }

    func toggleSelection(_ id: String) {
        if selectedBookingIds.contains(id) {
            selectedBookingIds.remove(id)
        } else {
            selectedBookingIds.insert(id)
        }
    }

    func bulkDelete(staff: Staff) async {
        let ids = Array(selectedBookingIds)
        for id in ids {
            if let booking = bookings.first(where: { $0.id == id }) {
                await deleteBooking(booking, staff: staff)
            }
        }
        selectedBookingIds.removeAll()
        isBulkSelectMode = false
    }

    func exportSelectedCSV() {
        let selected = bookings.filter { selectedBookingIds.contains($0.id) }
        CSVExporter.exportBookings(selected)
    }

    // MARK: - Optimistic Updates

    func updateBookingLocally(_ booking: Booking) {
        if let idx = bookings.firstIndex(where: { $0.id == booking.id }) {
            bookings[idx] = booking
        } else {
            bookings.insert(booking, at: 0)
        }
    }

    func updateBookingLocally(_ bookingId: String, collectionStatus: String) {
        if let idx = bookings.firstIndex(where: { $0.id == bookingId }) {
            bookings[idx].collectionStatus = collectionStatus
            bookings[idx].readyAt = collectionStatus == CollectionStage.ready.rawValue
                ? ISO8601DateFormatter().string(from: Date())
                : collectionStatus == CollectionStage.painted.rawValue ? nil : bookings[idx].readyAt
            bookings[idx].collectedAt = collectionStatus == CollectionStage.collected.rawValue
                ? ISO8601DateFormatter().string(from: Date())
                : nil
        }
    }

    func optimisticUpdateStatus(booking: Booking, status: BookingStatus, staff: Staff) async {
        guard let idx = bookings.firstIndex(where: { $0.id == booking.id }) else { return }
        let original = bookings[idx]
        bookings[idx] = Booking(
            id: booking.id, studio: booking.studio, name: booking.name,
            email: booking.email, phone: booking.phone, date: booking.date,
            time: booking.time, paintersCount: booking.paintersCount,
            sessionType: booking.sessionType, notes: booking.notes,
            status: status.rawValue, requestDate: booking.requestDate,
            estimatedPrice: booking.estimatedPrice, source: booking.source,
            giftCardCode: booking.giftCardCode, giftCardDiscount: booking.giftCardDiscount,
            finalPrice: booking.finalPrice, tableId: booking.tableId,
            depositAmount: booking.depositAmount, finalSeats: booking.finalSeats,
            finalBalance: booking.finalBalance, paymentLinkUrl: booking.paymentLinkUrl,
            paymentLinkSentAt: booking.paymentLinkSentAt, paymentStatus: booking.paymentStatus,
            stripePaymentIntentId: booking.stripePaymentIntentId,
            managementToken: booking.managementToken, createdAt: booking.createdAt,
            photos: booking.photos,
            collectionStatus: booking.collectionStatus,
            readyAt: booking.readyAt,
            collectedAt: booking.collectedAt,
            photoTags: booking.photoTags
        )
        Haptics.light()

        do {
            try await APIClient.shared.updateBookingStatus(id: booking.id, status: status.rawValue, staff: staff)
            Analytics.bookingAction("status_update", bookingId: booking.id)
        } catch {
            bookings[idx] = original
            self.error = "Failed to update status — reverted"
            Haptics.error()
        }
    }

    // MARK: - Retry with backoff

    func loadBookingsWithRetry(staff: Staff, maxAttempts: Int = 3) async {
        for attempt in 1...maxAttempts {
            do {
                let newBookings = try await APIClient.shared.loadBookings(staff: staff)
                bookings = newBookings
                saveToCache()
                isOffline = false
                error = nil
                return
            } catch {
                if attempt == maxAttempts {
                    isOffline = true
                    if bookings.isEmpty {
                        loadFromCache()
                    }
                    if !bookings.isEmpty {
                        self.error = "You're offline. Showing cached data."
                    } else if let err = error as? APIError {
                        self.error = err.errorDescription
                    } else {
                        self.error = "Failed to load after \(maxAttempts) attempts"
                    }
                } else {
                    let delay = UInt64(attempt) * 1_000_000_000
                    try? await Task.sleep(nanoseconds: delay)
                }
            }
        }
        isLoading = false
    }

    func startRealtime(staff: Staff) {
        realtimeTask?.cancel()
        let staffCopy = staff
        realtimeTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000) // 60 seconds
                guard !Task.isCancelled else { break }
                await self?.loadBookings(staff: staffCopy)
            }
        }
    }

    func stopRealtime() {
        realtimeTask?.cancel()
        realtimeTask = nil
    }

    func addPhoto(to booking: Booking, url: String, staff: Staff) async {
        var photos = booking.photos ?? []
        photos.append(url)
        var updated = booking
        updated.photos = photos
        guard let photosObj = try? APIClient.jsonPatchValue(photos) else { return }
        await patchBooking(id: booking.id, studio: booking.studio, fields: ["photos": photosObj], updated: updated, staff: staff)
    }

    func removePhoto(at index: Int, from booking: Booking, staff: Staff) async {
        var photos = booking.photos ?? []
        guard index < photos.count else { return }
        photos.remove(at: index)
        var updated = booking
        updated.photos = photos
        guard let photosObj = try? APIClient.jsonPatchValue(photos) else { return }
        await patchBooking(id: booking.id, studio: booking.studio, fields: ["photos": photosObj], updated: updated, staff: staff)
    }
}
