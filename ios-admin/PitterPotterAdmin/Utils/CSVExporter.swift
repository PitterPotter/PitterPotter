import Foundation
import UIKit

enum CSVExporter {
    static func exportBookings(_ bookings: [Booking]) {
        let headers = ["ID", "Name", "Email", "Phone", "Studio", "Date", "Time", "Seats", "Session Type", "Status", "Source", "Estimated Price", "Table ID"]
        var rows: [String] = [headers.joined(separator: ",")]

        for b in bookings {
            let row = [
                escape(b.id),
                escape(b.name),
                escape(b.email ?? ""),
                escape(b.phone ?? ""),
                escape(b.studio),
                escape(b.date),
                escape(b.time),
                String(b.paintersCount),
                escape(b.sessionType),
                escape(b.status),
                escape(b.source ?? ""),
                b.estimatedPrice.map { String($0) } ?? "",
                escape(b.tableId ?? ""),
            ]
            rows.append(row.joined(separator: ","))
        }

        saveCSV(rows.joined(separator: "\n"), filename: "bookings_\(todayString()).csv")
    }

    static func exportGiftCards(_ giftCards: [GiftCard]) {
        let headers = ["ID", "Code", "Amount", "Balance", "Status", "Recipient Name", "Recipient Email", "Created At"]
        var rows: [String] = [headers.joined(separator: ",")]

        for c in giftCards {
            let row = [
                escape(c.id),
                escape(c.code),
                String(c.amount),
                c.balance.map { String($0) } ?? "",
                escape(c.status),
                escape(c.recipientName ?? ""),
                escape(c.recipientEmail ?? ""),
                escape(c.createdAt ?? ""),
            ]
            rows.append(row.joined(separator: ","))
        }

        saveCSV(rows.joined(separator: "\n"), filename: "gift_cards_\(todayString()).csv")
    }

    static func exportStockReport(rows: [StockReportRow]) {
        let headers = ["product", "category", "qty_sold", "revenue", "putney_qty", "putney_rev", "wimbledon_qty", "wimbledon_rev", "received", "breakages", "adjustments", "transfers_in", "transfers_out", "stocktake_diff"]
        var lines: [String] = [headers.joined(separator: ",")]
        for p in rows {
            let put = p.by_studio["Putney"]
            let wim = p.by_studio["Wimbledon"]
            lines.append([
                escape(p.name), escape(p.category), String(p.qty_sold), String(format: "%.2f", p.revenue),
                String(put?.qty ?? 0), String(format: "%.2f", put?.revenue ?? 0),
                String(wim?.qty ?? 0), String(format: "%.2f", wim?.revenue ?? 0),
                String(p.received), String(p.breakages), String(p.adjustments),
                String(p.transfers_in), String(p.transfers_out), String(p.stocktake),
            ].joined(separator: ","))
        }
        saveCSV(lines.joined(separator: "\n"), filename: "stock_report_\(todayString()).csv")
    }

    private static func escape(_ value: String) -> String {
        if value.contains(",") || value.contains("\"") || value.contains("\n") {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return value
    }

    private static func todayString() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private static func saveCSV(_ content: String, filename: String) {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try content.data(using: .utf8)?.write(to: tempURL)
            DispatchQueue.main.async {
                let activityVC = UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
                if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                   let root = scene.windows.first?.rootViewController {
                    root.present(activityVC, animated: true)
                }
            }
        } catch {
            // ignore
        }
    }
}
