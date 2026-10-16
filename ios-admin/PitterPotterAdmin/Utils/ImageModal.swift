import SwiftUI

struct ImageModal: View {
    let images: [String]
    let initialIndex: Int
    let onClose: () -> Void
    var photoTags: [String: [PhotoTag]]? = nil
    var onTagPhoto: ((Int, Double, Double) -> Void)? = nil  // photoIndex, xPct, yPct

    @State private var index: Int
    @State private var tagMode = false
    @State private var showTagHint = true
    @State private var zoomScale: CGFloat = 1
    @State private var lastZoom: CGFloat = 1
    @State private var panOffset: CGSize = .zero
    @State private var lastPan: CGSize = .zero

    init(images: [String], initialIndex: Int, onClose: @escaping () -> Void, photoTags: [String: [PhotoTag]]? = nil, onTagPhoto: ((Int, Double, Double) -> Void)? = nil) {
        self.images = images
        self.initialIndex = initialIndex
        self.onClose = onClose
        self.photoTags = photoTags
        self.onTagPhoto = onTagPhoto
        self._index = State(initialValue: initialIndex)
    }

    private var tags: [PhotoTag] {
        photoTags?[String(index)] ?? []
    }

    private let tagColors: [String: Color] = [
        "ready": Color(red: 0.05, green: 0.7, blue: 0.4),
        "location": Color(red: 0.6, green: 0.5, blue: 0.3),
        "painted": .blue,
        "glazing": .purple,
        "firing": .orange,
        "needs_touchup": .red,
    ]

    private let tagLabels: [String: String] = [
        "painted": "Painted",
        "glazing": "Glazing",
        "firing": "Firing",
        "ready": "Ready",
        "needs_touchup": "Touch-up",
        "location": "Location",
    ]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // Image with tag overlays
            GeometryReader { geo in
                if let url = URL(string: images[index]) {
                    CachedAsyncImage(url: url, contentMode: .fit, maxDimension: 2048)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .overlay {
                            // Tag overlays
                            ForEach(Array(tags.enumerated()), id: \.offset) { ti, tag in
                                let color = tagColors[tag.status] ?? .white
                                let label = tag.label != nil ? "\(tagLabels[tag.status] ?? tag.status) - \(tag.label!)" : (tagLabels[tag.status] ?? tag.status)
                                HStack(spacing: 3) {
                                    if tag.status == "ready" {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(AppFont.body(14, weight: .bold))
                                    } else if tag.status == "location" {
                                        Image(systemName: "mappin.circle.fill")
                                            .font(AppFont.body(12, weight: .bold))
                                        Text(label)
                                            .font(AppFont.body(10, weight: .bold))
                                            .textCase(.uppercase)
                                    } else {
                                        Text(label)
                                            .font(AppFont.body(10, weight: .bold))
                                            .textCase(.uppercase)
                                    }
                                }
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(color)
                                .clipShape(Capsule())
                                .shadow(color: .black.opacity(0.4), radius: 4, y: 2)
                                .position(
                                    x: CGFloat(tag.x) / 100 * geo.size.width,
                                    y: CGFloat(tag.y) / 100 * geo.size.height
                                )
                            }
                        }
                        .contentShape(Rectangle())
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    zoomScale = max(1, min(6, lastZoom * value))
                                }
                                .onEnded { _ in
                                    lastZoom = zoomScale
                                    if zoomScale == 1 { resetPan() }
                                }
                        )
                        .simultaneousGesture(
                            DragGesture()
                                .onChanged { value in
                                    guard zoomScale > 1 else { return }
                                    panOffset = CGSize(
                                        width: lastPan.width + value.translation.width,
                                        height: lastPan.height + value.translation.height
                                    )
                                }
                                .onEnded { _ in lastPan = panOffset }
                        )
                        .onTapGesture(count: 2) { _ in
                            withAnimation(.easeInOut(duration: 0.2)) {
                                if zoomScale > 1 {
                                    zoomScale = 1
                                    lastZoom = 1
                                    resetPan()
                                } else {
                                    zoomScale = 2.5
                                    lastZoom = 2.5
                                }
                            }
                        }
                        .onTapGesture { location in
                            if tagMode, onTagPhoto != nil {
                                let xPct = Double(location.x / geo.size.width * 100)
                                let yPct = Double(location.y / geo.size.height * 100)
                                onTagPhoto?(index, xPct, yPct)
                                Haptics.light()
                                // Hide hint after first tag
                                if showTagHint {
                                    withAnimation { showTagHint = false }
                                }
                            }
                        }
                        .scaleEffect(zoomScale)
                        .offset(panOffset)
                }
            }

            // Top bar: close + tag mode toggle
            VStack {
                HStack {
                    Button {
                        onClose()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.white.opacity(0.8))
                    }

                    Spacer()

                    if onTagPhoto != nil {
                        Button {
                            withAnimation(.spring(response: 0.3)) {
                                tagMode.toggle()
                            }
                            Haptics.light()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: tagMode ? "checkmark.circle.fill" : "tag.circle.fill")
                                    .font(.system(size: 14, weight: .bold))
                                Text(tagMode ? "Tagging ON" : "Tag")
                                    .font(AppFont.body(12, weight: .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(tagMode ? Color(red: 0.05, green: 0.7, blue: 0.4) : Color.white.opacity(0.2))
                            .clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()

                // Tag hint
                if tagMode && showTagHint && onTagPhoto != nil {
                    Text("Tap on the photo to add a ✓ tick stamp")
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.6))
                        .clipShape(Capsule())
                        .padding(.bottom, 80)
                        .transition(.opacity)
                }
            }

            // Nav arrows
            if images.count > 1 {
                HStack {
                    Button {
                        index = (index - 1 + images.count) % images.count
                    } label: {
                        Image(systemName: "chevron.left.circle.fill")
                            .font(.system(size: 36))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                    Spacer()
                    Button {
                        index = (index + 1) % images.count
                    } label: {
                        Image(systemName: "chevron.right.circle.fill")
                            .font(.system(size: 36))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
                .padding(.horizontal, 12)
            }

            // Counter
            if images.count > 1 {
                VStack {
                    Spacer()
                    Text("\(index + 1) / \(images.count)")
                        .font(AppFont.body(12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.black.opacity(0.5))
                        .clipShape(Capsule())
                        .padding(.bottom, 32)
                }
            }
        }
        .gesture(
            DragGesture()
                .onEnded { value in
                    guard zoomScale <= 1 else { return }
                    if abs(value.translation.width) > 50 {
                        if value.translation.width > 0 {
                            index = (index - 1 + images.count) % images.count
                        } else {
                            index = (index + 1) % images.count
                        }
                    }
                }
        )
        .onChange(of: index) { _ in
            zoomScale = 1
            lastZoom = 1
            resetPan()
        }
    }

    private func resetPan() {
        panOffset = .zero
        lastPan = .zero
    }
}
