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
    const response = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(text)}&bgcolor=FFFFFF&color=1B2D3C&margin=0`);
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

  const charcoal = rgb(0.106, 0.176, 0.235); // #1B2D3C
  const sage = rgb(0.839, 0.906, 0.894);     // #D6E2E9
  const sageDeep = rgb(0.65, 0.78, 0.75);
  const cream = rgb(0.97, 0.96, 0.93);
  const white = rgb(1, 1, 1);
  const grey = rgb(0.45, 0.45, 0.45);

  const margin = 10;
  const bannerH = 70;
  const footerH = 52;
  const contentPad = 8;

  const bannerBottom = height - margin - bannerH;
  const contentTop = bannerBottom - contentPad;
  const contentBottom = margin + footerH + contentPad;
  const contentX = margin + contentPad;
  const contentW = width - 2 * (margin + contentPad);

  // Outer cream card
  page.drawRectangle({
    x: margin,
    y: margin,
    width: width - 2 * margin,
    height: height - 2 * margin,
    color: cream,
    borderColor: charcoal,
    borderWidth: 1.5,
  });

  // Top sage banner
  page.drawRectangle({
    x: margin,
    y: bannerBottom,
    width: width - 2 * margin,
    height: bannerH,
    color: sage,
  });
  page.drawRectangle({
    x: margin,
    y: bannerBottom,
    width: width - 2 * margin,
    height: 2,
    color: charcoal,
  });

  // Bottom charcoal footer
  page.drawRectangle({
    x: margin,
    y: margin,
    width: width - 2 * margin,
    height: footerH,
    color: charcoal,
  });

  // Inner white content area
  page.drawRectangle({
    x: contentX,
    y: contentBottom,
    width: contentW,
    height: contentTop - contentBottom,
    color: white,
    borderColor: sageDeep,
    borderWidth: 1,
  });

  // Logo from website
  let logoImg: any = null;
  try {
    const logoResp = await fetch('https://www.pitterpotter.co.uk/pp_logo.png');
    if (logoResp.ok) {
      const logoBytes = new Uint8Array(await logoResp.arrayBuffer());
      logoImg = await pdfDoc.embedPng(logoBytes);
    }
  } catch (e) {
    console.error('Failed to load logo:', e);
  }

  const centerX = width / 2;
  const logoTop = height - margin - 12;

  if (logoImg) {
    const logoH = 32;
    const logoW = (logoImg.width / logoImg.height) * logoH;
    page.drawImage(logoImg, {
      x: centerX - logoW / 2,
      y: logoTop - logoH,
      width: logoW,
      height: logoH,
    });
  } else {
    const fallback = 'Pitter Potter';
    const fw = fontBold.widthOfTextAtSize(fallback, 20);
    page.drawText(fallback, {
      x: centerX - fw / 2,
      y: logoTop - 26,
      size: 20,
      font: fontBold,
      color: charcoal,
    });
  }

  const tagline = 'Pottery Painting Studio';
  const tagW = fontRegular.widthOfTextAtSize(tagline, 9);
  page.drawText(tagline, {
    x: centerX - tagW / 2,
    y: logoTop - 46,
    size: 9,
    font: fontRegular,
    color: charcoal,
  });

  // Gift voucher title
  const titleText = 'GIFT VOUCHER';
  const titleW = fontBold.widthOfTextAtSize(titleText, 16);
  const titleY = contentTop - 24;
  page.drawText(titleText, {
    x: centerX - titleW / 2,
    y: titleY,
    size: 16,
    font: fontBold,
    color: charcoal,
  });

  // Value / covers panel
  const panelPadding = 40;
  const maxPanelWidth = contentW - 2 * panelPadding;
  const valueY = titleY - 14;
  let valuePanelBottom = valueY;

  if (giftCard.covers) {
    const coversText = sanitize(giftCard.covers, 'Studio activity');
    let coversSize = 14;
    let lines: string[] = [];

    const wrapAtSize = (size: number): string[] => {
      const out: string[] = [];
      let line = '';
      for (const word of coversText.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (fontBold.widthOfTextAtSize(test, size) > maxPanelWidth) {
          if (line) out.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
      return out;
    };

    while (coversSize >= 9) {
      lines = wrapAtSize(coversSize);
      if (lines.length <= 2) break;
      coversSize -= 1;
    }

    const lineH = coversSize + 5;
    const panelH = lines.length * lineH + 18;
    const panelW = maxPanelWidth + 2 * panelPadding;
    const panelX = contentX + (contentW - panelW) / 2;
    valuePanelBottom = valueY - panelH;

    page.drawRectangle({
      x: panelX,
      y: valuePanelBottom,
      width: panelW,
      height: panelH,
      color: sage,
      borderColor: sageDeep,
      borderWidth: 1,
    });

    lines.forEach((line, i) => {
      const lw = fontBold.widthOfTextAtSize(line, coversSize);
      page.drawText(line, {
        x: panelX + (panelW - lw) / 2,
        y: valuePanelBottom + 10 + (lines.length - 1 - i) * lineH,
        size: coversSize,
        font: fontBold,
        color: charcoal,
      });
    });
  } else {
    const amountStr = `\u00A3${Number(giftCard.amount).toFixed(2)}`;
    const amountW = fontBold.widthOfTextAtSize(amountStr, 36);
    const panelW = amountW + 2 * panelPadding;
    const panelH = 46;
    const panelX = contentX + (contentW - panelW) / 2;
    valuePanelBottom = valueY - panelH;

    page.drawRectangle({
      x: panelX,
      y: valuePanelBottom,
      width: panelW,
      height: panelH,
      color: sage,
      borderColor: sageDeep,
      borderWidth: 1,
    });
    page.drawText(amountStr, {
      x: panelX + (panelW - amountW) / 2,
      y: valuePanelBottom + 10,
      size: 36,
      font: fontBold,
      color: charcoal,
    });
  }

  // Details section
  const detailsTop = valuePanelBottom - 22;
  const leftX = contentX + 18;
  const labelGap = 44;
  const rightW = 170;
  const rightX = contentX + contentW - rightW - 18;

  const sender = sanitize(giftCard.sender_name, 'Anonymous');
  const recipient = sanitize(giftCard.recipient_name, 'Valued Customer');
  const purchaseDate = formatDate(giftCard.purchase_date);
  const safeMessage = sanitize(giftCard.message, '');

  let leftY = detailsTop;
  const drawDetail = (label: string, value: string) => {
    page.drawText(label, { x: leftX, y: leftY, size: 8, font: fontRegular, color: grey });
    page.drawText(value, { x: leftX + labelGap, y: leftY, size: 10, font: fontBold, color: charcoal });
    leftY -= 18;
  };

  drawDetail('From:', sender);
  drawDetail('To:', recipient);
  drawDetail('Date:', purchaseDate);

  if (safeMessage) {
    leftY -= 4;
    page.drawText('Message:', { x: leftX, y: leftY, size: 8, font: fontRegular, color: grey });
    leftY -= 12;

    const maxMsgW = rightX - leftX - 20;
    const words = safeMessage.split(/\s+/);
    let currentLine = '';
    let printed = 0;
    const maxLines = 4;

    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (fontRegular.widthOfTextAtSize(test, 9) > maxMsgW) {
        if (currentLine) {
          if (printed >= maxLines) {
            page.drawText(`${currentLine}...`, { x: leftX, y: leftY, size: 9, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
            printed += 1;
            currentLine = '';
            break;
          }
          page.drawText(currentLine, { x: leftX, y: leftY, size: 9, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
          leftY -= 12;
          printed += 1;
        }
        currentLine = word;
      } else {
        currentLine = test;
      }
    }

    if (currentLine && printed < maxLines) {
      page.drawText(currentLine, { x: leftX, y: leftY, size: 9, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
    }
  }

  // Right column: voucher code + QR
  const codeBoxH = 30;
  const codeBoxTop = detailsTop;
  page.drawRectangle({
    x: rightX,
    y: codeBoxTop - codeBoxH,
    width: rightW,
    height: codeBoxH,
    color: charcoal,
  });

  page.drawText('Voucher Code', {
    x: rightX + 8,
    y: codeBoxTop - 8,
    size: 8,
    font: fontRegular,
    color: sage,
  });

  const codeText = giftCard.code || '';
  const codeW = fontBold.widthOfTextAtSize(codeText, 11);
  page.drawText(codeText, {
    x: rightX + (rightW - codeW) / 2,
    y: codeBoxTop - 22,
    size: 11,
    font: fontBold,
    color: white,
  });

  const qrBytes = await generateQRCodeBytes(giftCard.code);
  if (qrBytes) {
    try {
      const qrImage = await pdfDoc.embedPng(qrBytes);
      const qrSize = 44;
      const qrY = codeBoxTop - codeBoxH - 54;
      page.drawImage(qrImage, {
        x: rightX + (rightW - qrSize) / 2,
        y: qrY,
        width: qrSize,
        height: qrSize,
      });
      const scanText = 'Scan to redeem';
      const scanW = fontRegular.widthOfTextAtSize(scanText, 6);
      page.drawText(scanText, {
        x: rightX + (rightW - scanW) / 2,
        y: qrY - 8,
        size: 6,
        font: fontRegular,
        color: charcoal,
      });
    } catch (e) {
      console.error('Failed to embed QR code:', e);
    }
  }

  // Footer
  const footerTop = margin + footerH;
  let validityText = 'Valid for 12 months from date of purchase';
  if (giftCard.expiry_date) {
    validityText = `Valid until ${formatDate(giftCard.expiry_date)}`;
  }

  page.drawText(validityText, {
    x: contentX,
    y: footerTop - 12,
    size: 8,
    font: fontRegular,
    color: white,
  });
  page.drawText('Putney: 234 Upper Richmond Road, SW15 6TG | 020 8788 1635', {
    x: contentX,
    y: footerTop - 24,
    size: 6,
    font: fontRegular,
    color: white,
  });
  page.drawText('Wimbledon: 52 Wimbledon Hill Road, SW19 7PA | 020 3770 4499', {
    x: contentX,
    y: footerTop - 34,
    size: 6,
    font: fontRegular,
    color: white,
  });
  const urlText = 'www.pitterpotter.co.uk';
  const urlW = fontBold.widthOfTextAtSize(urlText, 7);
  page.drawText(urlText, {
    x: width - margin - urlW - 12,
    y: footerTop - 44,
    size: 7,
    font: fontBold,
    color: sage,
  });

  return await pdfDoc.save();
}
