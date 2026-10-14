import SwiftUI
import PhotosUI

struct BookingDetailView: View {
    let booking: Booking
    @EnvironmentObject var bookingsVM: BookingsViewModel
    @EnvironmentObject var authVM: AuthViewModel
    @EnvironmentObject var toastManager: ToastManager
    @Environment(\.dismiss) var dismiss
    @State private var showingEdit = false
    @State private var showingPhotoPicker = false
    @State private var showingCamera = false
    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var isUploading = false
    @State private var showingDeleteConfirm = false
    @State private var showingPaymentReminder = false
    @State private var reminderFinalSeats = 1
    @State private var isSendingReminder = false
    @State private var currentBooking: Booking
    @State private var commLogs: [EmailLog] = []
    @State private var commLoading = false
    @State private var tagMode = false
    @State private var tagPopover: TagPopoverState?
    @State private var modalImages: [String]? = nil
    @State private var modalIndex: Int = 0
    @State private var modalPhotoTags: [String: [PhotoTag]]? = nil
    @State private var showingFloorPlan = false

    init(booking: Booking) {
        self.booking = booking
        _currentBooking = State(initialValue: booking)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                statusHeader
                quickStatusActions
                bookingInfoCard
                contactCard
                if isPartyBooking {
                    paymentSection
                }
                notesCard
                photosSection
                communicationHistory
                metaSection
            }
            .padding(20)
        }
        .background(Color.white)
        .navigationTitle(currentBooking.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if authVM.staff?.canEditBookings == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { showingEdit = true }
                }
            }
            if authVM.staff?.canDeleteBookings == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive) {
                        showingDeleteConfirm = true
                    } label: {
                        Image(systemName: "trash")
                    }
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            EditBookingView(booking: currentBooking) { updated in
                guard let staff = authVM.staff else { return "Not signed in" }
                let ok = await bookingsVM.saveBooking(updated, staff: staff)
                if ok {
                    currentBooking = updated
                    toastManager.success("Booking saved")
                    return nil
                }
                return bookingsVM.error ?? "Failed to save booking"
            }
            .environmentObject(authVM)
        }
        .sheet(isPresented: $showingFloorPlan) {
            NavigationStack {
                ScrollView {
                    FloorPlanView(
                        studio: currentBooking.studio,
                        bookings: bookingsVM.bookings,
                        selectedDate: currentBooking.date,
                        selectedTime: currentBooking.time,
                        highlightTableId: currentBooking.tableId,
                        onAssign: { tableId in
                            var updated = currentBooking
                            updated.tableId = tableId
                            if let staff = authVM.staff {
                                Task {
                                    // Patch only table_id — a full update would run
                                    // re-allocation and overwrite the manual pick.
                                    let ok = await bookingsVM.patchBooking(
                                        id: updated.id, studio: updated.studio,
                                        fields: ["tableId": tableId],
                                        updated: updated, staff: staff
                                    )
                                    await MainActor.run {
                                        if ok {
                                            currentBooking = updated
                                            toastManager.success("Assigned to \(tableId)")
                                        } else {
                                            toastManager.error(bookingsVM.error ?? "Failed to assign table")
                                        }
                                    }
                                }
                            }
                        }
                    )
                    .environmentObject(bookingsVM)
                    .environmentObject(authVM)
                    .padding(16)
                }
                .navigationTitle("\(currentBooking.studio) Floor Plan")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { showingFloorPlan = false }
                    }
                }
            }
        }
        .onChange(of: selectedItems) { newItems in
            Task { await uploadPhotos(newItems) }
        }
        .sheet(isPresented: $showingCamera) {
            CameraPicker { imageData in
                Task { await uploadCameraPhoto(imageData) }
            }
        }
        .confirmationDialog("Delete this booking?", isPresented: $showingDeleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let staff = authVM.staff {
                    Task {
                        await bookingsVM.deleteBooking(currentBooking, staff: staff)
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This action cannot be undone. The booking will be permanently removed.")
        }
        .sheet(isPresented: $showingPaymentReminder) {
            PaymentReminderView(
                booking: currentBooking,
                finalSeats: $reminderFinalSeats,
                isSending: $isSendingReminder,
                onSend: {
                    if let staff = authVM.staff {
                        Task {
                            let success = await bookingsVM.sendPaymentReminder(
                                for: currentBooking, finalSeats: reminderFinalSeats, staff: staff
                            )
                            if success {
                                currentBooking = bookingsVM.bookings.first(where: { $0.id == currentBooking.id }) ?? currentBooking
                                showingPaymentReminder = false
                            }
                        }
                    }
                }
            )
            .presentationDetents([.medium])
        }
        .onAppear { loadCommLogs() }
        .fullScreenCover(isPresented: Binding(
            get: { modalImages != nil },
            set: { if !$0 { modalImages = nil; modalPhotoTags = nil } }
        )) {
            if let images = modalImages {
                ImageModal(
                    images: images,
                    initialIndex: modalIndex,
                    onClose: { modalImages = nil; modalPhotoTags = nil },
                    photoTags: modalPhotoTags
                )
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

    private var statusHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(currentBooking.name)
                    .font(AppFont.heading(22))
                    .foregroundStyle(PPBrand.charcoal)
                HStack(spacing: 6) {
                    SessionTypeBadge(sessionType: currentBooking.sessionType)
                    Text("\u{00B7}")
                        .font(AppFont.body(13))
                        .foregroundStyle(PPBrand.clay300)
                    Text(currentBooking.studio)
                        .font(AppFont.body(13, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                StatusBadge(status: currentBooking.bookingStatus ?? .pending)
                if let tableId = currentBooking.tableId {
                    Text(tableId)
                        .font(AppFont.body(11, weight: .bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(PPBrand.charcoal.opacity(0.1))
                        .foregroundStyle(PPBrand.charcoal)
                        .clipShape(Capsule())
                }
                Button {
                    showingFloorPlan = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "table.furniture")
                            .font(AppFont.body(10, weight: .bold))
                        Text(currentBooking.tableId == nil ? "Assign Table" : "Floor Plan")
                            .font(AppFont.body(10, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(PPBrand.charcoal)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(20)
        .webCard()
        
    }

    private var quickStatusActions: some View {
        HStack(spacing: 8) {
            if authVM.staff?.canUpdateStatus == true {
                if currentBooking.status != "confirmed" {
                    Button {
                        updateStatus(.confirmed)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(AppFont.body(18))
                            Text("Confirm")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(.green.opacity(0.12))
                        .foregroundStyle(.green)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                if currentBooking.status == "confirmed" {
                    Button {
                        updateStatus(.seated)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "person.2.fill")
                                .font(AppFont.body(18))
                            Text("Seat")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(.orange.opacity(0.12))
                        .foregroundStyle(.orange)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                if currentBooking.status == "seated" {
                    Button {
                        updateStatus(.completed)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "checkmark.seal.fill")
                                .font(AppFont.body(18))
                            Text("Complete")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(PPBrand.charcoal.opacity(0.1))
                        .foregroundStyle(PPBrand.charcoal)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                if currentBooking.status != "cancelled" && currentBooking.status != "completed" {
                    Button {
                        updateStatus(.cancelled)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "xmark.circle")
                                .font(AppFont.body(18))
                            Text("Cancel")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(.red.opacity(0.1))
                        .foregroundStyle(.red)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                if currentBooking.status != "pending" && currentBooking.status != "completed" && currentBooking.status != "cancelled" {
                    Button {
                        updateStatus(.pending)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "clock.arrow.circlepath")
                                .font(AppFont.body(18))
                            Text("Awaiting")
                                .font(AppFont.body(11, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(PPBrand.pendingBadgeBg)
                        .foregroundStyle(PPBrand.pendingBadgeText)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
    }

    private func updateStatus(_ status: BookingStatus) {
        guard let staff = authVM.staff else { return }
        Task {
            await bookingsVM.optimisticUpdateStatus(booking: currentBooking, status: status, staff: staff)
            await MainActor.run {
                currentBooking = bookingsVM.bookings.first(where: { $0.id == currentBooking.id }) ?? currentBooking
                toastManager.success("\(status.label)")
            }
        }
    }

    private var isPartyBooking: Bool {
        ["birthday-party", "baby-shower-hen", "corporate"].contains(currentBooking.sessionType)
    }

    private var paymentSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "creditcard.fill")
                    .font(AppFont.body(14, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                Text("Payment")
                    .font(AppFont.heading(17))
                    .foregroundStyle(PPBrand.charcoal)
                Spacer()
            }

            if let deposit = currentBooking.depositAmount {
                InfoRow(icon: "sterlingsign.circle", label: "Deposit", value: "£\(String(format: "%.2f", deposit))")
            }
            if let seats = currentBooking.finalSeats {
                InfoRow(icon: "person.2", label: "Final Seats", value: "\(seats)")
            }
            if let balance = currentBooking.finalBalance {
                InfoRow(icon: "creditcard", label: "Balance", value: "£\(String(format: "%.2f", balance))")
            }

            if let link = currentBooking.paymentLinkUrl {
                InfoRow(icon: "link", label: "Payment Link", value: "Sent")
                if let sentAt = currentBooking.paymentLinkSentAt {
                    InfoRow(icon: "clock", label: "Sent At", value: PPDateDisplay.dateTime(sentAt))
                }
                ShareLink(item: URL(string: link) ?? URL(string: "https://pitterpotter.co.uk")!) {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.right.square")
                            .font(AppFont.body(14, weight: .medium))
                        Text("Open Payment Link")
                            .font(AppFont.body(14, weight: .medium))
                    }
                    .foregroundStyle(PPBrand.charcoal)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(PPBrand.charcoal.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            } else {
                Button {
                    reminderFinalSeats = currentBooking.finalSeats ?? currentBooking.paintersCount
                    showingPaymentReminder = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "envelope.badge")
                            .font(AppFont.body(14, weight: .medium))
                        Text("Send Final Payment Reminder")
                            .font(AppFont.body(14, weight: .medium))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(PPBrand.charcoal)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(20)
        .webCard()
        
    }

    private var bookingInfoCard: some View {
        VStack(spacing: 0) {
            InfoRow(icon: "calendar", label: "Date", value: PPDateDisplay.date(currentBooking.date))
            Divider().padding(.leading, 40)
            InfoRow(icon: "clock", label: "Time", value: PPDateDisplay.time(currentBooking.time))
            Divider().padding(.leading, 40)
            InfoRow(icon: "building.2", label: "Studio", value: currentBooking.studio)
            Divider().padding(.leading, 40)
            InfoRow(icon: "person.2", label: "Painters", value: "\(currentBooking.paintersCount)")
            Divider().padding(.leading, 40)
            HStack(spacing: 12) {
                Image(systemName: "paintpalette")
                    .font(AppFont.body(14, weight: .medium))
                    .frame(width: 28, height: 28)
                    .background(PPBrand.charcoal.opacity(0.06))
                    .foregroundStyle(PPBrand.charcoal)
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Text("Session")
                    .font(AppFont.body(14, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                Spacer()
                SessionTypeBadge(sessionType: currentBooking.sessionType)
            }
            .padding(.vertical, 4)
            if let source = currentBooking.source {
                Divider().padding(.leading, 40)
                InfoRow(icon: "arrow.right.circle", label: "Source", value: source)
            }
        }
        .padding(20)
        .webCard()
        
    }

    private var contactCard: some View {
        VStack(spacing: 0) {
            if let email = currentBooking.email, !email.isEmpty {
                Link(destination: URL(string: "mailto:\(email)") ?? URL(string: "mailto:")!) {
                    ContactRow(icon: "envelope", text: email)
                }
                if let phone = currentBooking.phone, !phone.isEmpty {
                    Divider().padding(.leading, 40)
                }
            }
            if let phone = currentBooking.phone, !phone.isEmpty {
                Link(destination: URL(string: "tel:\(phone)") ?? URL(string: "tel:")!) {
                    ContactRow(icon: "phone", text: phone)
                }
            }
        }
        .padding(20)
        .webCard()
        
    }

    @ViewBuilder
    private var notesCard: some View {
        if let notes = currentBooking.notes, !notes.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "note.text")
                        .font(AppFont.body(13, weight: .bold))
                        .foregroundStyle(.orange)
                    Text("Notes")
                        .font(AppFont.body(13, weight: .bold))
                        .foregroundStyle(.orange)
                        .textCase(.uppercase)
                        .tracking(0.5)
                }
                Text(notes)
                    .font(AppFont.body(15))
                    .foregroundStyle(PPBrand.charcoal)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(Color.orange.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.orange.opacity(0.2), lineWidth: 1)
            )
        }
    }

    private var photosSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "camera.fill")
                    .font(AppFont.body(14, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                Text("Painting Photos")
                    .font(AppFont.heading(17))
                    .foregroundStyle(PPBrand.charcoal)
                Spacer()
                if let photos = currentBooking.photos, !photos.isEmpty, authVM.staff?.canUpdateStatus == true {
                    Button {
                        tagMode.toggle()
                    } label: {
                        Text(tagMode ? "✓ Tag Mode ON" : "Tag Mode")
                            .font(AppFont.body(10, weight: .bold))
                            .textCase(.uppercase)
                            .tracking(0.5)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(tagMode ? PPBrand.charcoal : PPBrand.clay100)
                            .foregroundStyle(tagMode ? .white : PPBrand.charcoal)
                            .clipShape(Capsule())
                    }
                }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button {
                        showingCamera = true
                    } label: {
                        Image(systemName: "camera")
                            .font(AppFont.body(16, weight: .medium))
                            .foregroundStyle(PPBrand.charcoal)
                    }
                    .disabled(isUploading || authVM.staff?.canEditBookings != true)
                }
                PhotosPicker(selection: $selectedItems, maxSelectionCount: 10, matching: .images) {
                    Label("Gallery", systemImage: "photo.on.rectangle")
                        .font(AppFont.body(14, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal)
                }
                .disabled(isUploading || authVM.staff?.canEditBookings != true)
            }

            if isUploading {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Uploading...")
                        .font(AppFont.body(14, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
            }

            if let photos = currentBooking.photos, !photos.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(Array(photos.enumerated()), id: \.offset) { index, urlStr in
                        if let url = URL(string: urlStr) {
                            GeometryReader { geo in
                                ZStack {
                                    CachedAsyncImage(url: url, contentMode: .fit)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 140)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))

                                    if tagMode {
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(PPBrand.charcoal.opacity(0.5), lineWidth: 2)
                                            .frame(height: 140)
                                    }

                                    let tags = currentBooking.photoTags?[String(index)] ?? []
                                    ForEach(Array(tags.enumerated()), id: \.offset) { ti, tag in
                                        PhotoTagBadge(tag: tag, canRemove: tagMode && authVM.staff?.canUpdateStatus == true) {
                                            removePhotoTag(photoIndex: index, tagIndex: ti)
                                        }
                                        .position(
                                            x: CGFloat(tag.x) / 100 * geo.size.width,
                                            y: CGFloat(tag.y) / 100 * 140
                                        )
                                    }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture { location in
                                    if tagMode {
                                        let x = Double(location.x)
                                        let y = Double(location.y)
                                        tagPopover = TagPopoverState(photoIndex: index, x: x, y: y)
                                    } else {
                                        modalImages = photos
                                        modalIndex = index
                                        modalPhotoTags = currentBooking.photoTags
                                    }
                                }
                            }
                            .frame(height: 140)
                        }
                    }
                }
                if tagMode {
                    Text("Tap a photo to add a location or status stamp")
                        .font(AppFont.body(10, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.5))
                }
            } else {
                HStack(spacing: 6) {
                    Image(systemName: "photo")
                        .font(AppFont.body(14))
                        .foregroundStyle(PPBrand.clay300)
                    Text("No photos uploaded yet")
                        .font(AppFont.body(14, weight: .medium))
                        .foregroundStyle(PPBrand.clay300)
                }
            }
        }
        .padding(20)
        .webCard()
        
    }

    private func photoThumbnail(url: String, index: Int) -> some View {
        AsyncImage(url: URL(string: url)) { image in
            image
                .resizable()
                .aspectRatio(contentMode: .fill)
        } placeholder: {
            Rectangle()
                .fill(Color(.systemGray5))
                .overlay(ProgressView())
        }
        .frame(height: 100)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .contextMenu {
            Button("Open") {
                if let url = URL(string: url) { UIApplication.shared.open(url) }
            }
            if authVM.staff?.canEditBookings == true {
                Button("Delete", role: .destructive) {
                    Task { await deletePhoto(at: index) }
                }
            }
        }
    }

    private var metaSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("Booking ID: \(currentBooking.id)")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(PPBrand.clay300)
                Button {
                    UIPasteboard.general.string = currentBooking.id
                    Haptics.success()
                    toastManager.success("Booking ID copied")
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(AppFont.body(10, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                }
            }
            if let createdAt = currentBooking.createdAt {
                Text("Created: \(PPDateDisplay.dateTime(createdAt))")
                    .font(AppFont.body(11, weight: .medium))
                    .foregroundStyle(PPBrand.clay300)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }

    private func uploadPhotos(_ items: [PhotosPickerItem]) async {
        guard let staff = authVM.staff, !items.isEmpty else { return }
        isUploading = true
        for item in items {
            do {
                if let data = try await item.loadTransferable(type: Data.self) {
                    let url = try await APIClient.shared.uploadPhoto(
                        imageData: data,
                        fileName: "photo_\(Int(Date().timeIntervalSince1970)).jpg",
                        bookingId: currentBooking.id,
                        staff: staff
                    )
                    await bookingsVM.addPhoto(to: currentBooking, url: url, staff: staff)
                    currentBooking = bookingsVM.bookings.first(where: { $0.id == currentBooking.id }) ?? currentBooking
                }
            } catch {
                bookingsVM.error = "Failed to upload photo: \(error.localizedDescription)"
            }
        }
        selectedItems = []
        isUploading = false
    }

    private func deletePhoto(at index: Int) async {
        guard let staff = authVM.staff else { return }
        await bookingsVM.removePhoto(at: index, from: currentBooking, staff: staff)
        currentBooking = bookingsVM.bookings.first(where: { $0.id == currentBooking.id }) ?? currentBooking
    }

    private func uploadCameraPhoto(_ data: Data) async {
        guard let staff = authVM.staff else { return }
        isUploading = true
        do {
            let url = try await APIClient.shared.uploadPhoto(
                imageData: data,
                fileName: "camera_\(Int(Date().timeIntervalSince1970)).jpg",
                bookingId: currentBooking.id,
                staff: staff
            )
            await bookingsVM.addPhoto(to: currentBooking, url: url, staff: staff)
            currentBooking = bookingsVM.bookings.first(where: { $0.id == currentBooking.id }) ?? currentBooking
            Haptics.success()
        } catch {
            bookingsVM.error = "Failed to upload photo: \(error.localizedDescription)"
            Haptics.error()
        }
        isUploading = false
    }

    // MARK: - Communication History

    private func loadCommLogs() {
        guard let staff = authVM.staff else { return }
        commLoading = true
        Task {
            do {
                let logs = try await APIClient.shared.loadEmailLogs(staff: staff, limit: 200)
                await MainActor.run {
                    commLogs = logs.filter { $0.bookingId == currentBooking.id }
                    commLoading = false
                }
            } catch {
                await MainActor.run { commLoading = false }
            }
        }
    }

    private var communicationHistory: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "envelope.arrow.triangle.branch")
                    .font(AppFont.body(14, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                Text("Communication History")
                    .font(AppFont.heading(15))
                    .foregroundStyle(PPBrand.charcoal)
            }

            if commLoading {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading...")
                        .font(AppFont.body(13, weight: .medium))
                        .foregroundStyle(PPBrand.charcoal.opacity(0.4))
                }
            } else if commLogs.isEmpty {
                Text("No emails or SMS sent for this booking.")
                    .font(AppFont.body(13, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.4))
            } else {
                VStack(spacing: 8) {
                    ForEach(commLogs) { log in
                        CommLogRow(log: log)
                    }
                }
            }
        }
        .padding(20)
        .webCard()
    }

    // MARK: - Photo Tagging

    private func addPhotoTag(photoIndex: Int, label: String, status: String, x: Double, y: Double) {
        guard let staff = authVM.staff else { return }
        var updated = currentBooking
        var tags = updated.photoTags ?? [:]
        var existing = tags[String(photoIndex)] ?? []
        existing.append(PhotoTag(id: nil, label: label.isEmpty ? nil : label, status: status, x: x, y: y))
        tags[String(photoIndex)] = existing
        updated.photoTags = tags
        Task { await patchPhotoTags(updated: updated, staff: staff) }
    }

    private func removePhotoTag(photoIndex: Int, tagIndex: Int) {
        guard let staff = authVM.staff else { return }
        var updated = currentBooking
        guard var tags = updated.photoTags, var existing = tags[String(photoIndex)] else { return }
        existing.remove(at: tagIndex)
        if existing.isEmpty {
            tags.removeValue(forKey: String(photoIndex))
        } else {
            tags[String(photoIndex)] = existing
        }
        updated.photoTags = tags
        Task { await patchPhotoTags(updated: updated, staff: staff) }
    }

    /// Patches only photo_tags on the server so a stale copy can't overwrite
    /// notes or other fields, then refreshes local state on success.
    private func patchPhotoTags(updated: Booking, staff: Staff) async {
        guard let tagsObj = try? APIClient.jsonPatchValue(updated.photoTags) else { return }
        let ok = await bookingsVM.patchBooking(
            id: updated.id, studio: updated.studio,
            fields: ["photoTags": tagsObj],
            updated: updated, staff: staff
        )
        await MainActor.run {
            if ok {
                currentBooking = updated
            } else {
                toastManager.error(bookingsVM.error ?? "Failed to save tag")
            }
        }
    }
}

// MARK: - Subviews

struct InfoRow: View {
    let icon: String
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(AppFont.body(14, weight: .medium))
                .frame(width: 28, height: 28)
                .background(PPBrand.charcoal.opacity(0.06))
                .foregroundStyle(PPBrand.charcoal)
                .clipShape(RoundedRectangle(cornerRadius: 7))
            Text(label)
                .font(AppFont.body(14, weight: .medium))
                .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            Spacer()
            Text(value)
                .font(AppFont.body(14, weight: .medium))
                .foregroundStyle(PPBrand.charcoal)
        }
        .padding(.vertical, 4)
    }
}

struct ContactRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(AppFont.body(14, weight: .medium))
                .frame(width: 28, height: 28)
                .background(PPBrand.charcoal.opacity(0.06))
                .foregroundStyle(PPBrand.charcoal)
                .clipShape(RoundedRectangle(cornerRadius: 7))
            Text(text)
                .font(AppFont.body(15, weight: .medium))
                .foregroundStyle(PPBrand.charcoal)
            Spacer()
            Image(systemName: "chevron.right")
                .font(AppFont.body(12, weight: .medium))
                .foregroundStyle(PPBrand.clay300)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Edit Booking View

struct EditBookingView: View {
    @State private var editingBooking: Booking
    @State private var isSaving = false
    @State private var saveError: String?
    @EnvironmentObject var authVM: AuthViewModel
    @Environment(\.dismiss) var dismiss
    /// Returns an error message on failure, nil on success.
    let onSave: (Booking) async -> String?

    init(booking: Booking, onSave: @escaping (Booking) async -> String?) {
        _editingBooking = State(initialValue: booking)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                if let saveError {
                    Section {
                        Text(saveError)
                            .font(AppFont.body(13, weight: .medium))
                            .foregroundStyle(.red)
                    }
                }
                Section("Customer") {
                    TextField("Name", text: bindingFor(\.name))
                    TextField("Email", text: bindingForOptional(\.email))
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    TextField("Phone", text: bindingForOptional(\.phone))
                        .keyboardType(.phonePad)
                }

                Section("Booking") {
                    Picker("Studio", selection: bindingFor(\.studio)) {
                        ForEach(Studio.allCases, id: \.self) { Text($0.rawValue).tag($0.rawValue) }
                    }
                    DatePicker("Date", selection: Binding(
                        get: {
                            ISO8601DateFormatter().date(from: editingBooking.date + "T00:00:00Z") ?? Date()
                        },
                        set: { newDate in
                            let formatter = DateFormatter()
                            formatter.dateFormat = "yyyy-MM-dd"
                            formatter.timeZone = TimeZone(identifier: "UTC")
                            editingBooking.date = formatter.string(from: newDate)
                        }
                    ), displayedComponents: .date)
                    TextField("Time", text: bindingFor(\.time))
                    Stepper("Painters: \(editingBooking.paintersCount)", value: bindingForInt(\.paintersCount), in: 1...100)
                    Picker("Session Type", selection: bindingFor(\.sessionType)) {
                        ForEach(SessionType.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                    Picker("Status", selection: bindingFor(\.status)) {
                        ForEach(BookingStatus.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                    Picker("Collection Status", selection: bindingForOptionalString(\.collectionStatus)) {
                        Text("None").tag(String?.none)
                        ForEach(CollectionStage.allCases, id: \.self) { stage in
                            Text(stage.label).tag(Optional(stage.rawValue))
                        }
                    }
                }

                Section("Notes") {
                    TextField("Notes", text: bindingForOptional(\.notes), axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Payment") {
                    TextField("Estimated Price", value: bindingForOptionalDouble(\.estimatedPrice), format: .currency(code: "GBP"))
                        .keyboardType(.decimalPad)
                    TextField("Deposit", value: bindingForOptionalDouble(\.depositAmount), format: .currency(code: "GBP"))
                        .keyboardType(.decimalPad)
                    Stepper("Final Seats: \(editingBooking.finalSeats ?? 0)", value: bindingForOptionalInt(\.finalSeats), in: 0...200)
                    TextField("Final Balance", value: bindingForOptionalDouble(\.finalBalance), format: .currency(code: "GBP"))
                        .keyboardType(.decimalPad)
                }

                // Quick status actions
                Section("Quick Actions") {
                    ForEach(BookingStatus.allCases, id: \.self) { status in
                        Button(status.label) {
                            editingBooking = Booking(
                                id: editingBooking.id, studio: editingBooking.studio,
                                name: editingBooking.name, email: editingBooking.email,
                                phone: editingBooking.phone, date: editingBooking.date,
                                time: editingBooking.time, paintersCount: editingBooking.paintersCount,
                                sessionType: editingBooking.sessionType, notes: editingBooking.notes,
                                status: status.rawValue, requestDate: editingBooking.requestDate,
                                estimatedPrice: editingBooking.estimatedPrice, source: editingBooking.source,
                                giftCardCode: editingBooking.giftCardCode, giftCardDiscount: editingBooking.giftCardDiscount,
                                finalPrice: editingBooking.finalPrice, tableId: editingBooking.tableId,
                                depositAmount: editingBooking.depositAmount, finalSeats: editingBooking.finalSeats,
                                finalBalance: editingBooking.finalBalance, paymentLinkUrl: editingBooking.paymentLinkUrl,
                                paymentLinkSentAt: editingBooking.paymentLinkSentAt, paymentStatus: editingBooking.paymentStatus,
                                stripePaymentIntentId: editingBooking.stripePaymentIntentId,
                                managementToken: editingBooking.managementToken, createdAt: editingBooking.createdAt,
                                photos: editingBooking.photos,
                                collectionStatus: editingBooking.collectionStatus,
                                readyAt: editingBooking.readyAt,
                                collectedAt: editingBooking.collectedAt,
                                photoTags: editingBooking.photoTags
                            )
                        }
                    }
                }
            }
            .navigationTitle("Edit Booking")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            isSaving = true
                            saveError = nil
                            Task {
                                let errorMessage = await onSave(editingBooking)
                                isSaving = false
                                if let errorMessage {
                                    saveError = errorMessage
                                    Haptics.error()
                                } else {
                                    Haptics.success()
                                    dismiss()
                                }
                            }
                        }
                        .fontWeight(.bold)
                    }
                }
            }
        }
    }

    // MARK: - Binding Helpers

    private func bindingFor(_ keyPath: WritableKeyPath<Booking, String>) -> Binding<String> {
        Binding(
            get: { editingBooking[keyPath: keyPath] },
            set: { editingBooking[keyPath: keyPath] = $0 }
        )
    }

    private func bindingForOptional(_ keyPath: WritableKeyPath<Booking, String?>) -> Binding<String> {
        Binding(
            get: { editingBooking[keyPath: keyPath] ?? "" },
            set: { editingBooking[keyPath: keyPath] = $0.isEmpty ? nil : $0 }
        )
    }

    private func bindingForInt(_ keyPath: WritableKeyPath<Booking, Int>) -> Binding<Int> {
        Binding(
            get: { editingBooking[keyPath: keyPath] },
            set: { editingBooking[keyPath: keyPath] = $0 }
        )
    }

    private func bindingForOptionalInt(_ keyPath: WritableKeyPath<Booking, Int?>) -> Binding<Int> {
        Binding(
            get: { editingBooking[keyPath: keyPath] ?? 0 },
            set: { editingBooking[keyPath: keyPath] = $0 }
        )
    }

    private func bindingForOptionalDouble(_ keyPath: WritableKeyPath<Booking, Double?>) -> Binding<Double?> {
        Binding(
            get: { editingBooking[keyPath: keyPath] },
            set: { editingBooking[keyPath: keyPath] = $0 }
        )
    }

    private func bindingForOptionalString(_ keyPath: WritableKeyPath<Booking, String?>) -> Binding<String?> {
        Binding(
            get: { editingBooking[keyPath: keyPath] },
            set: { editingBooking[keyPath: keyPath] = $0 }
        )
    }
}

// MARK: - Communication Log Row

struct CommLogRow: View {
    let log: EmailLog

    private var isSMS: Bool {
        (log.emailType ?? "").contains("sms")
    }

    private var statusColors: (bg: Color, text: Color) {
        switch log.status ?? "" {
        case "delivered", "sent": return (PPBrand.confirmedBadgeBg, PPBrand.confirmedBadgeText)
        case "failed", "bounced", "undelivered": return (PPBrand.cancelledBadgeBg, PPBrand.cancelledBadgeText)
        case "opened", "clicked": return (PPBrand.partyBadgeBg, PPBrand.partyBadgeText)
        default: return (PPBrand.clay100, PPBrand.charcoal.opacity(0.6))
        }
    }

    private var formattedDate: String {
        PPDateDisplay.dateTime(log.createdAt ?? "")
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(isSMS ? "SMS" : "Email")
                .font(AppFont.body(9, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(isSMS ? PPBrand.charcoal.opacity(0.6) : Color(hex: 0x1D4ED8))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(isSMS ? PPBrand.charcoal.opacity(0.1) : Color(hex: 0xDBEAFE))
                .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 2) {
                Text((log.emailType ?? "Unknown").replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(AppFont.body(12, weight: .bold))
                    .foregroundStyle(PPBrand.charcoal)
                Text(formattedDate)
                    .font(AppFont.body(10, weight: .medium))
                    .foregroundStyle(PPBrand.charcoal.opacity(0.5))
            }

            Spacer()

            let sc = statusColors
            Text(log.status ?? "unknown")
                .font(AppFont.body(9, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(sc.text)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(sc.bg)
                .clipShape(Capsule())
        }
        .padding(.vertical, 2)
    }
}
