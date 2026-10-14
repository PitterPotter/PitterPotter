import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
    const response = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(text)}&bgcolor=FFFFFF&color=6B7D63&margin=0`);
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

export async function buildVoucherPDF(giftCard: VoucherGiftCard): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontSerifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  // Soft palette from the flyer
  const cream = rgb(0.976, 0.965, 0.949);
  const sage = rgb(0.69, 0.77, 0.68);
  const sageDark = rgb(0.42, 0.49, 0.39);
  const terracotta = rgb(0.80, 0.49, 0.46);
  const terracottaLight = rgb(0.95, 0.82, 0.80);
  const charcoal = rgb(0.18, 0.18, 0.18);
  const white = rgb(1, 1, 1);
  const grey = rgb(0.52, 0.50, 0.48);

  const footerH = 74;

  // Cream page
  page.drawRectangle({ x: 0, y: 0, width, height, color: cream });

  // Decorative corner shapes
  page.drawRectangle({ x: -10, y: height - 120, width: 120, height: 120, color: sage });
  page.drawRectangle({ x: width - 110, y: -10, width: 120, height: 120, color: terracottaLight });

  // Header title: GIFT in terracotta, VOUCHER in olive
  const titleY = height - 32;
  const giftText = 'GIFT';
  const voucherText = 'VOUCHER';
  const giftSize = 34;
  const voucherSize = 34;
  const giftW = fontSerifBold.widthOfTextAtSize(giftText, giftSize);
  const voucherW = fontSerifBold.widthOfTextAtSize(voucherText, voucherSize);
  const titleGap = 10;
  const titleStart = (width - (giftW + voucherW + titleGap)) / 2;

  page.drawText(giftText, {
    x: titleStart,
    y: titleY,
    size: giftSize,
    font: fontSerifBold,
    color: terracotta,
  });
  page.drawText(voucherText, {
    x: titleStart + giftW + titleGap,
    y: titleY,
    size: voucherSize,
    font: fontSerifBold,
    color: sageDark,
  });

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

  // Decorative line with a small terracotta heart-square marker
  const lineY = subtitleY - 12;
  const lineStart = 140;
  const lineEnd = width - 140;
  page.drawRectangle({ x: lineStart, y: lineY, width: (lineEnd - lineStart - 10) / 2, height: 1, color: terracotta });
  page.drawRectangle({ x: lineStart + (lineEnd - lineStart - 10) / 2 + 10, y: lineY, width: (lineEnd - lineStart - 10) / 2, height: 1, color: terracotta });
  page.drawRectangle({ x: (width - 6) / 2, y: lineY - 2, width: 6, height: 6, color: terracotta });

  // Central pink / terracotta value blob
  const blobMaxW = 360;
  const blobPadding = 40;
  const valueY = lineY - 36;
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
    const blobW = blobMaxW;
    const blobX = (width - blobW) / 2;
    blobBottom = valueY - blobH + 8;

    page.drawRectangle({
      x: blobX,
      y: blobBottom,
      width: blobW,
      height: blobH,
      color: terracottaLight,
    });

    // Soft side spark marks
    page.drawRectangle({ x: blobX + 14, y: blobBottom + blobH / 2 - 3, width: 14, height: 3, color: terracotta });
    page.drawRectangle({ x: blobX + 14, y: blobBottom + blobH / 2 - 10, width: 10, height: 3, color: terracotta });
    page.drawRectangle({ x: blobX + blobW - 28, y: blobBottom + blobH / 2 - 3, width: 14, height: 3, color: terracotta });
    page.drawRectangle({ x: blobX + blobW - 24, y: blobBottom + blobH / 2 - 10, width: 10, height: 3, color: terracotta });

    lines.forEach((line, i) => {
      const lw = fontSerifBold.widthOfTextAtSize(line, coversSize);
      page.drawText(line, {
        x: blobX + (blobW - lw) / 2,
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

    page.drawRectangle({
      x: blobX,
      y: blobBottom,
      width: blobW,
      height: blobH,
      color: terracottaLight,
    });

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

  // Details section
  const detailsTop = blobBottom - 24;
  const leftX = 56;
  const labelGap = 50;
  const messageX = 300;
  const messageW = 250;

  const sender = sanitize(giftCard.sender_name, 'Anonymous');
  const recipient = sanitize(giftCard.recipient_name, 'Valued Customer');
  const purchaseDate = formatDate(giftCard.purchase_date);
  const safeMessage = sanitize(giftCard.message, '');

  // Vertical divider
  page.drawRectangle({
    x: messageX - 16,
    y: footerH + 14,
    width: 1,
    height: detailsTop - footerH - 6,
    color: terracottaLight,
  });

  let leftY = detailsTop;
  const drawDetail = (label: string, value: string) => {
    page.drawText(label, { x: leftX, y: leftY, size: 8, font: fontRegular, color: sageDark });
    page.drawText(value, { x: leftX + labelGap, y: leftY, size: 11, font: fontBold, color: charcoal });
    leftY -= 22;
  };

  drawDetail('TO:', recipient);
  drawDetail('FROM:', sender);
  drawDetail('DATE:', purchaseDate);

  // Message
  let msgY = detailsTop;
  page.drawText('MESSAGE:', { x: messageX, y: msgY, size: 8, font: fontRegular, color: sageDark });
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

  // Footer sage band
  page.drawRectangle({ x: 0, y: 0, width, height: footerH, color: sageDark });

  let validityText = 'VALID FOR 12 MONTHS FROM PURCHASE';
  if (giftCard.expiry_date) {
    validityText = `VALID UNTIL ${formatDate(giftCard.expiry_date).toUpperCase()}`;
  }

  page.drawText(validityText, {
    x: 20,
    y: 56,
    size: 8,
    font: fontBold,
    color: white,
  });
  page.drawText('FROM DATE OF PURCHASE', {
    x: 20,
    y: 44,
    size: 7,
    font: fontRegular,
    color: white,
  });

  // Studio addresses
  const addrY = 56;
  page.drawText('PUTNEY', { x: 215, y: addrY, size: 7, font: fontBold, color: cream });
  page.drawText('234 Upper Richmond Road', { x: 215, y: addrY - 11, size: 6, font: fontRegular, color: white });
  page.drawText('London SW15 6TG', { x: 215, y: addrY - 21, size: 6, font: fontRegular, color: white });
  page.drawText('020 8788 1635', { x: 215, y: addrY - 31, size: 6, font: fontRegular, color: white });

  page.drawText('WIMBLEDON', { x: 365, y: addrY, size: 7, font: fontBold, color: cream });
  page.drawText('52 Wimbledon Hill Road', { x: 365, y: addrY - 11, size: 6, font: fontRegular, color: white });
  page.drawText('London SW19 7PA', { x: 365, y: addrY - 21, size: 6, font: fontRegular, color: white });
  page.drawText('020 3770 4499', { x: 365, y: addrY - 31, size: 6, font: fontRegular, color: white });

  // QR code inside the footer
  const qrBytes = await generateQRCodeBytes(giftCard.code);
  if (qrBytes) {
    try {
      const qrImage = await pdfDoc.embedPng(qrBytes);
      const qrSize = 48;
      const qrX = width - 70;
      const qrY = 14;
      page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
      const scanText = 'SCAN TO REDEEM';
      const scanW = fontRegular.widthOfTextAtSize(scanText, 6);
      page.drawText(scanText, {
        x: qrX + (qrSize - scanW) / 2,
        y: 7,
        size: 6,
        font: fontRegular,
        color: cream,
      });
    } catch (e) {
      console.error('Failed to embed QR code:', e);
    }
  }

  return await pdfDoc.save();
}
