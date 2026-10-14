import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { cornerTL, cornerTR, vase, brush, cornerBR, heart, iconCal, iconPin } from './voucher-artwork.ts';

interface VoucherGiftCard {
  code: string;
  amount: number;
  recipient_name: string | null;
  sender_name: string | null;
  message: string | null;
  purchase_date?: string | null;
  expiry_date?: string | null;
  covers?: string | null;
}

async function generateQRCodeBytes(text: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(text)}&bgcolor=FFFFFF&color=31373D&margin=0`);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

function sanitize(s: string | null | undefined, fallback = ''): string {
  if (!s) return fallback;
  return s.replace(/[^\x00-\xFF]/g, '').replace(/[\x00-\x1F\x7F-\x9F]+/g, ' ').trim() || fallback;
}

function formatDate(dateInput: string | null | undefined): string {
  if (!dateInput) return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    return new Date(dateInput).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateInput;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function buildVoucherPDF(giftCard: VoucherGiftCard): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontSerifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  // Palette sampled from the artwork
  const cream = rgb(0.988, 0.969, 0.945);       // #FCF7F1
  const sageFoot = rgb(0.843, 0.867, 0.808);    // #D7DDCE footer band
  const terracotta = rgb(0.84, 0.43, 0.42);     // #D66E6A
  const pinkBlob = rgb(0.961, 0.820, 0.788);    // #F5D1C9
  const olive = rgb(0.42, 0.48, 0.38);          // #6C7A61
  const charcoal = rgb(0.19, 0.22, 0.24);       // #31373D
  const white = rgb(1, 1, 1);

  const footerH = 74;
  const S = width / 1024; // artwork scale factor

  // Cream page
  page.drawRectangle({ x: 0, y: 0, width, height, color: cream });

  // Embed the artwork crops
  const [imgCornerTL, imgCornerTR, imgVase, imgBrush, imgCornerBR, imgHeart, imgCal, imgPin] = await Promise.all(
    [cornerTL, cornerTR, vase, brush, cornerBR, heart, iconCal, iconPin].map(async (b64) => pdfDoc.embedJpg(b64ToBytes(b64))),
  );

  // Corner blobs + vase + brush (behind text)
  page.drawImage(imgCornerTL, { x: 0, y: height - 195 * S, width: 300 * S, height: 195 * S });
  page.drawImage(imgCornerTR, { x: width - 179 * S, y: height - 145 * S, width: 179 * S, height: 145 * S });
  page.drawImage(imgVase, { x: 0, y: height - 470 * S, width: 270 * S, height: 305 * S });
  page.drawImage(imgBrush, { x: width - 269 * S, y: height - 485 * S, width: 269 * S, height: 225 * S });

  // Title: GIFT (terracotta) VOUCHER (olive)
  const titleY = height - 34;
  const giftText = 'GIFT';
  const voucherText = 'VOUCHER';
  const titleSize = 34;
  const giftW = fontSerifBold.widthOfTextAtSize(giftText, titleSize);
  const voucherW = fontSerifBold.widthOfTextAtSize(voucherText, titleSize);
  const titleGap = 10;
  const titleStart = (width - (giftW + voucherW + titleGap)) / 2;

  page.drawText(giftText, { x: titleStart, y: titleY, size: titleSize, font: fontSerifBold, color: terracotta });
  page.drawText(voucherText, { x: titleStart + giftW + titleGap, y: titleY, size: titleSize, font: fontSerifBold, color: olive });

  // Subtitle
  const subtitle = 'POTTERY PAINTING STUDIO';
  const subW = fontRegular.widthOfTextAtSize(subtitle, 9);
  const subtitleY = titleY - 22;
  page.drawText(subtitle, {
    x: (width - subW) / 2,
    y: subtitleY,
    size: 9,
    font: fontRegular,
    color: charcoal,
  });

  // Divider line with the real heart in the centre
  const lineY = subtitleY - 14;
  const lineStart = 140;
  const lineEnd = width - 140;
  const heartW = 26;
  page.drawRectangle({ x: lineStart, y: lineY, width: (lineEnd - lineStart - heartW) / 2, height: 1, color: terracotta });
  page.drawRectangle({ x: lineStart + (lineEnd - lineStart + heartW) / 2, y: lineY, width: (lineEnd - lineStart - heartW) / 2, height: 1, color: terracotta });
  page.drawImage(imgHeart, { x: (width - heartW) / 2, y: lineY - 11, width: heartW, height: heartW * (45 / 50) });

  // Central pink value blob
  const blobMaxW = 360;
  const blobPadding = 40;
  const valueY = lineY - 32;
  let blobBottom = valueY;

  if (giftCard.covers) {
    const coversText = sanitize(giftCard.covers, 'Studio activity');
    let coversSize = 18;
    let lines: string[] = [];

    const wrapAtSize = (size: number): string[] => {
      const out: string[] = [];
      let line = '';
      for (const word of coversText.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (fontSerifBold.widthOfTextAtSize(test, size) > blobMaxW - 2 * blobPadding) {
          if (line) out.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
      return out;
    };

    while (coversSize >= 11) {
      lines = wrapAtSize(coversSize);
      if (lines.length <= 2) break;
      coversSize -= 1;
    }

    const lineH = coversSize + 6;
    const blobH = lines.length * lineH + 24;
    const blobX = (width - blobMaxW) / 2;
    blobBottom = valueY - blobH + 8;

    page.drawRectangle({ x: blobX, y: blobBottom, width: blobMaxW, height: blobH, color: pinkBlob });
    page.drawRectangle({ x: blobX + 14, y: blobBottom + blobH / 2 - 3, width: 14, height: 3, color: terracotta });
    page.drawRectangle({ x: blobX + 14, y: blobBottom + blobH / 2 - 10, width: 10, height: 3, color: terracotta });
    page.drawRectangle({ x: blobX + blobMaxW - 28, y: blobBottom + blobH / 2 - 3, width: 14, height: 3, color: terracotta });
    page.drawRectangle({ x: blobX + blobMaxW - 24, y: blobBottom + blobH / 2 - 10, width: 10, height: 3, color: terracotta });

    lines.forEach((line, i) => {
      const lw = fontSerifBold.widthOfTextAtSize(line, coversSize);
      page.drawText(line, {
        x: blobX + (blobMaxW - lw) / 2,
        y: blobBottom + 12 + (lines.length - 1 - i) * lineH,
        size: coversSize,
        font: fontSerifBold,
        color: charcoal,
      });
    });
  } else {
    const amountStr = `\u00A3${Number(giftCard.amount).toFixed(2)}`;
    const amountSize = 44;
    const amountW = fontSerifBold.widthOfTextAtSize(amountStr, amountSize);
    const blobW = Math.max(blobMaxW, amountW + 2 * blobPadding);
    const blobH = 78;
    const blobX = (width - blobW) / 2;
    blobBottom = valueY - blobH + 8;

    page.drawRectangle({ x: blobX, y: blobBottom, width: blobW, height: blobH, color: pinkBlob });
    page.drawRectangle({ x: blobX + 14, y: blobBottom + blobH / 2 + 2, width: 16, height: 4, color: terracotta });
    page.drawRectangle({ x: blobX + 14, y: blobBottom + blobH / 2 - 8, width: 12, height: 4, color: terracotta });
    page.drawRectangle({ x: blobX + blobW - 30, y: blobBottom + blobH / 2 + 2, width: 16, height: 4, color: terracotta });
    page.drawRectangle({ x: blobX + blobW - 26, y: blobBottom + blobH / 2 - 8, width: 12, height: 4, color: terracotta });
    page.drawText(amountStr, {
      x: blobX + (blobW - amountW) / 2,
      y: blobBottom + 18,
      size: amountSize,
      font: fontSerifBold,
      color: charcoal,
    });
  }

  // Details: left column + message right of divider
  const detailsTop = blobBottom - 24;
  const leftX = 56;
  const labelGap = 50;
  const messageX = 252;
  const messageW = 185;

  const sender = sanitize(giftCard.sender_name, 'Anonymous');
  const recipient = sanitize(giftCard.recipient_name, 'Valued Customer');
  const purchaseDate = formatDate(giftCard.purchase_date);
  const safeMessage = sanitize(giftCard.message, '');

  // Pink vertical divider
  page.drawRectangle({
    x: messageX - 22,
    y: footerH + 16,
    width: 1,
    height: Math.max(detailsTop - footerH - 8, 20),
    color: pinkBlob,
  });

  let leftY = detailsTop;
  const drawDetail = (label: string, value: string) => {
    page.drawText(label, { x: leftX, y: leftY, size: 8, font: fontRegular, color: olive });
    page.drawText(value, { x: leftX + labelGap, y: leftY, size: 11, font: fontBold, color: charcoal });
    leftY -= 22;
  };

  drawDetail('TO:', recipient);
  drawDetail('FROM:', sender);
  drawDetail('DATE:', purchaseDate);

  // Message
  let msgY = detailsTop;
  page.drawText('MESSAGE:', { x: messageX, y: msgY, size: 8, font: fontRegular, color: olive });
  msgY -= 14;

  if (safeMessage) {
    const words = safeMessage.split(/\s+/);
    let currentLine = '';
    let printed = 0;
    const maxLines = 4;

    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (fontOblique.widthOfTextAtSize(test, 10) > messageW) {
        if (currentLine) {
          if (printed >= maxLines) {
            page.drawText(`${currentLine}...`, { x: messageX, y: msgY, size: 10, font: fontOblique, color: charcoal });
            printed += 1;
            currentLine = '';
            break;
          }
          page.drawText(currentLine, { x: messageX, y: msgY, size: 10, font: fontOblique, color: charcoal });
          msgY -= 13;
          printed += 1;
        }
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine && printed < maxLines) {
      page.drawText(currentLine, { x: messageX, y: msgY, size: 10, font: fontOblique, color: charcoal });
    }
  }

  // Light sage footer band
  page.drawRectangle({ x: 0, y: 0, width, height: footerH, color: sageFoot });

  // Orange blob overlapping the footer's right edge (matches the artwork)
  page.drawImage(imgCornerBR, { x: width - 169 * S, y: footerH - 8, width: 169 * S, height: 130 * S });

  // Footer: calendar icon + validity
  page.drawImage(imgCal, { x: 30, y: 27, width: 42, height: 42 });
  let validityText = 'VALID FOR 12 MONTHS FROM PURCHASE';
  if (giftCard.expiry_date) {
    validityText = `VALID UNTIL ${formatDate(giftCard.expiry_date).toUpperCase()}`;
  }
  page.drawText(validityText, { x: 82, y: 48, size: 8, font: fontBold, color: charcoal });
  page.drawText('FROM DATE OF PURCHASE', { x: 82, y: 36, size: 7, font: fontRegular, color: charcoal });

  // Footer: pin icons + addresses
  page.drawImage(imgPin, { x: 198, y: 22, width: 36, height: 36 });
  page.drawText('PUTNEY', { x: 242, y: 52, size: 7, font: fontBold, color: charcoal });
  page.drawText('234 Upper Richmond Road', { x: 242, y: 41, size: 6, font: fontRegular, color: charcoal });
  page.drawText('London SW15 6TG', { x: 242, y: 32, size: 6, font: fontRegular, color: charcoal });
  page.drawText('020 8788 1635', { x: 242, y: 23, size: 6, font: fontRegular, color: charcoal });

  page.drawImage(imgPin, { x: 333, y: 22, width: 36, height: 36 });
  page.drawText('WIMBLEDON', { x: 377, y: 52, size: 7, font: fontBold, color: charcoal });
  page.drawText('52 Wimbledon Hill Road', { x: 377, y: 41, size: 6, font: fontRegular, color: charcoal });
  page.drawText('London SW19 7PA', { x: 377, y: 32, size: 6, font: fontRegular, color: charcoal });
  page.drawText('020 3770 4499', { x: 377, y: 23, size: 6, font: fontRegular, color: charcoal });

  // QR code on a white tile so it scans cleanly over the sage band
  const qrBytes = await generateQRCodeBytes(giftCard.code);
  if (qrBytes) {
    try {
      const qrImage = await pdfDoc.embedPng(qrBytes);
      const qrSize = 44;
      const qrX = width - 62;
      const qrY = 18;
      page.drawRectangle({ x: qrX - 5, y: qrY - 5, width: qrSize + 10, height: qrSize + 10, color: white });
      page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
      const scanText = 'SCAN TO REDEEM';
      const scanW = fontRegular.widthOfTextAtSize(scanText, 5.5);
      page.drawText(scanText, { x: qrX + (qrSize - scanW) / 2, y: 8, size: 5.5, font: fontRegular, color: charcoal });
    } catch (e) {
      console.error('Failed to embed QR code:', e);
    }
  }

  return await pdfDoc.save();
}
