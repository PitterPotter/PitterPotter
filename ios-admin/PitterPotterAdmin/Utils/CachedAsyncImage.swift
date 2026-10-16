import SwiftUI
import UIKit

struct CachedAsyncImage: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    var maxDimension: CGFloat = 200  // Downscale images to max 200px for thumbnails

    @State private var image: UIImage?
    @State private var isLoading = false
    @State private var failed = false

    private static let cache: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 80             // Max 80 images in memory
        cache.totalCostLimit = 250_000_000 // Max ~250MB — must hold full-res modal images
        return cache
    }()
    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 5_000_000, diskCapacity: 50_000_000, diskPath: "pp_image_cache")
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: config)
    }()

    static func clearCache() {
        cache.removeAllObjects()
    }

    static func prefetch(url: URL, image: UIImage) {
        cache.setObject(image, forKey: url as NSURL)
    }

    private var displayImage: UIImage? {
        if let image { return image }
        guard let url else { return nil }
        return Self.cached(for: url, minDimension: maxDimension)
    }

    /// Returns the cached image only when it is at least as detailed as the
    /// requested size — a thumbnail must never satisfy a full-screen request.
    private static func cached(for url: URL, minDimension: CGFloat) -> UIImage? {
        guard let img = cache.object(forKey: url as NSURL) else { return nil }
        return max(img.size.width, img.size.height) >= minDimension ? img : nil
    }

    var body: some View {
        Group {
            if let img = displayImage {
                Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if failed {
                Rectangle()
                    .fill(PPBrand.clay100)
                    .overlay(
                        VStack(spacing: 4) {
                            Image(systemName: "photo")
                                .font(.system(size: 20))
                                .foregroundStyle(PPBrand.charcoal.opacity(0.3))
                        }
                    )
            } else {
                Rectangle()
                    .fill(PPBrand.clay100)
                    .overlay(ProgressView())
            }
        }
        .task(id: url?.absoluteString) {
            await loadImage()
        }
    }

    private func loadImage() async {
        guard let url = url else {
            await MainActor.run { failed = true }
            return
        }
        if let cached = Self.cached(for: url, minDimension: maxDimension) {
            await MainActor.run {
                image = cached
                failed = false
            }
            return
        }
        await MainActor.run {
            isLoading = true
            failed = false
        }
        do {
            var request = URLRequest(url: url)
            request.cachePolicy = .returnCacheDataElseLoad
            request.timeoutInterval = 30
            let (data, response) = try await Self.session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                await MainActor.run {
                    isLoading = false
                    failed = true
                }
                return
            }
            guard let raw = UIImage(data: data) else {
                await MainActor.run {
                    isLoading = false
                    failed = true
                }
                return
            }
            // Downscale the image to save memory
            let scaled = downscale(raw, maxDimension: maxDimension)
            let cost = Int(scaled.size.width * scaled.size.height * 4)
            Self.cache.setObject(scaled, forKey: url as NSURL, cost: cost)
            await MainActor.run {
                withAnimation(.easeIn(duration: 0.2)) {
                    image = scaled
                }
                isLoading = false
                failed = false
            }
        } catch {
            await MainActor.run {
                isLoading = false
                failed = true
            }
        }
    }

    private func downscale(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        let maxDim = max(size.width, size.height)
        if maxDim <= maxDimension { return image }
        let scale = maxDimension / maxDim
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
