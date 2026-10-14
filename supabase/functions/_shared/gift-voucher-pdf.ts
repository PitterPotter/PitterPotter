import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { voucherImageBase64 } from './voucher-tiles.ts';

interface VoucherGiftCard {
  code: string;
  amount: number;
  recipient_name: string | null;
  sender_name: string | null;
  message: string | null;
  purchase_date?: string | null;
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

function sanitize(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback;
  return s.replace(/[^\x00-\xFF]/g, '').replace(/[\x00-\x1F\x7F-\x9F]+/g, ' ').trim() || fallback;
}

export async function buildVoucherPDF(giftCard: VoucherGiftCard): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const charcoal = rgb(0.106, 0.176, 0.235);
  const sage = rgb(0.839, 0.906, 0.894);
  const sageDeep = rgb(0.65, 0.78, 0.75);
  const cream = rgb(0.96, 0.95, 0.91);
  const white = rgb(1, 1, 1);
  const grey = rgb(0.4, 0.4, 0.4);

  // Decode and embed tile photo
  const raw = atob(voucherImageBase64);
  const tileBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) tileBytes[i] = raw.charCodeAt(i);
  const tileImg = await pdfDoc.embedJpg(tileBytes);
  const imgW = tileImg.width;
  const imgH = tileImg.height;
  const drawH = height;
  const drawW = (drawH / imgH) * imgW;
  const imgX = -(drawW - 180) / 2;
  page.drawImage(tileImg, { x: imgX, y: 0, width: drawW, height: drawH });

  // White content panel on the right
  page.drawRectangle({
    x: 180, y: 0, width: width - 180, height: height,
    color: cream, borderColor: charcoal, borderWidth: 1,
  });
  page.drawRectangle({
    x: 186, y: 6, width: width - 192, height: height - 12,
    color: white, borderColor: sageDeep, borderWidth: 1,
  });

  // Logo
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

  const panelLeft = 200;
  const panelRight = width - 30;

  if (logoImg) {
    const logoH = 30;
    const logoW = logoImg.width / logoImg.height * logoH;
    page.drawImage(logoImg, {
      x: panelLeft + (panelRight - panelLeft - logoW) / 2,
      y: height - 50, width: logoW, height: logoH,
    });
  } else {
    const logoText = 'Pitter Potter';
    const logoW = fontBold.widthOfTextAtSize(logoText, 20);
    page.drawText(logoText, {
      x: panelLeft + (panelRight - panelLeft - logoW) / 2,
      y: height - 50, size: 20, font: fontBold, color: charcoal,
    });
  }

  const subText = 'Pottery Painting Studio';
  const subW = fontRegular.widthOfTextAtSize(subText, 8);
  page.drawText(subText, {
    x: panelLeft + (panelRight - panelLeft - subW) / 2,
    y: height - 64, size: 8, font: fontRegular, color: charcoal,
  });

  // Decorative line
  page.drawRectangle({
    x: panelLeft + 20, y: height - 74,
    width: panelRight - panelLeft - 40, height: 1, color: sageDeep,
  });

  const voucherText = 'GIFT VOUCHER';
  const voucherW = fontBold.widthOfTextAtSize(voucherText, 18);
  page.drawText(voucherText, {
    x: panelLeft + (panelRight - panelLeft - voucherW) / 2,
    y: height - 96, size: 18, font: fontBold, color: charcoal,
  });

  // Amount / covers
  if (giftCard.covers) {
    const coversText = sanitize(giftCard.covers, 'Studio activity');
    const coversMaxWidth = panelRight - panelLeft - 40;
    let coversSize = 16;
    let coversLines: string[] = [];
    const wrapCovers = (size: number): string[] => {
      const lines: string[] = [];
      let line = '';
      for (const word of coversText.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (fontBold.widthOfTextAtSize(test, size) > coversMaxWidth) {
          if (line) lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    };
    while (coversSize > 9) {
      coversLines = wrapCovers(coversSize);
      if (coversLines.length <= 2) break;
      coversSize -= 1;
    }
    const coversLineH = coversSize + 6;
    const coversPanelH = coversLines.length * coversLineH + 14;
    const coversY = height - 108;
    page.drawRectangle({
      x: panelLeft + 20, y: coversY - coversPanelH,
      width: panelRight - panelLeft - 40, height: coversPanelH,
      color: sage, borderColor: sageDeep, borderWidth: 1,
    });
    coversLines.forEach((coversLine, i) => {
      const lw = fontBold.widthOfTextAtSize(coversLine, coversSize);
      page.drawText(coversLine, {
        x: panelLeft + 20 + (panelRight - panelLeft - 40 - lw) / 2,
        y: coversY - coversPanelH + 10 + (coversLines.length - 1 - i) * coversLineH,
        size: coversSize, font: fontBold, color: charcoal,
      });
    });
  } else {
    const amountStr = `\u00A3${Number(giftCard.amount).toFixed(2)}`;
    const amountWidth = fontBold.widthOfTextAtSize(amountStr, 36);
    const amountPanelW = amountWidth + 40;
    page.drawRectangle({
      x: panelLeft + (panelRight - panelLeft - amountPanelW) / 2,
      y: height - 156, width: amountPanelW, height: 38,
      color: sage, borderColor: sageDeep, borderWidth: 1,
    });
    page.drawText(amountStr, {
      x: panelLeft + (panelRight - panelLeft - amountWidth) / 2,
      y: height - 148, size: 36, font: fontBold, color: charcoal,
    });
  }

  // Code box
  const codeY = height - 190;
  page.drawRectangle({
    x: panelLeft + 20, y: codeY - 6,
    width: panelRight - panelLeft - 40, height: 28,
    color: charcoal,
  });
  const codeLabel = 'Code:  ';
  const codeLabelWidth = fontRegular.widthOfTextAtSize(codeLabel, 14);
  page.drawText(codeLabel, { x: panelLeft + 36, y: codeY, size: 14, font: fontRegular, color: sage });
  page.drawText(giftCard.code, { x: panelLeft + 36 + codeLabelWidth + 4, y: codeY, size: 14, font: fontBold, color: white });

  // From / To / Date
  let y = height - 230;
  const labelX = panelLeft + 30;
  const valueX = panelLeft + 80;

  page.drawText('From:', { x: labelX, y, size: 10, font: fontRegular, color: grey });
  page.drawText(sanitize(giftCard.sender_name, 'Anonymous'), { x: valueX, y, size: 11, font: fontBold, color: charcoal });

  y -= 18;
  page.drawText('To:', { x: labelX, y, size: 10, font: fontRegular, color: grey });
  page.drawText(sanitize(giftCard.recipient_name, 'Valued Customer'), { x: valueX, y, size: 11, font: fontBold, color: charcoal });

  y -= 18;
  page.drawText('Date:', { x: labelX, y, size: 10, font: fontRegular, color: grey });
  let dateStr = '';
  if (giftCard.purchase_date) {
    try {
      dateStr = new Date(giftCard.purchase_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      dateStr = giftCard.purchase_date;
    }
  } else {
    dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  page.drawText(dateStr, { x: valueX, y, size: 11, font: fontBold, color: charcoal });

  // Personal message
  if (giftCard.message) {
    y -= 28;
    page.drawText('Message:', { x: labelX, y, size: 10, font: fontRegular, color: grey });
    y -= 14;
    const maxWidth = panelRight - panelLeft - 60;
    const safeMessage = sanitize(giftCard.message, '');
    if (safeMessage) {
      const words = safeMessage.split(/\s+/);
      let line = '';
      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        if (fontRegular.widthOfTextAtSize(testLine, 10) > maxWidth) {
          page.drawText(line, { x: labelX, y, size: 10, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
          y -= 14;
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) {
        page.drawText(line, { x: labelX, y, size: 10, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
      }
    }
  }

  // Footer
  page.drawRectangle({ x: 180, y: 0, width: width - 180, height: 56, color: sage });
  page.drawRectangle({ x: 180, y: 56, width: width - 180, height: 2, color: sageDeep });

  page.drawText('Valid for 12 months from purchase', {
    x: panelLeft + 20, y: 42, size: 8, font: fontRegular, color: charcoal,
  });
  page.drawText('Putney: 234 Upper Richmond Road, SW15 6TG  |  020 8788 1635', {
    x: panelLeft + 20, y: 30, size: 7, font: fontRegular, color: charcoal,
  });
  page.drawText('Wimbledon: 52 Wimbledon Hill Road, SW19 7PA  |  020 3770 4499', {
    x: panelLeft + 20, y: 18, size: 7, font: fontRegular, color: charcoal,
  });
  const urlText = 'www.pitterpotter.co.uk';
  const urlW = fontBold.widthOfTextAtSize(urlText, 8);
  page.drawText(urlText, {
    x: panelLeft + (panelRight - panelLeft - urlW) / 2,
    y: 8, size: 8, font: fontBold, color: charcoal,
  });

  // QR code
  const qrBytes = await generateQRCodeBytes(giftCard.code);
  if (qrBytes) {
    try {
      const qrImage = await pdfDoc.embedPng(qrBytes);
      const qrSize = 45;
      page.drawImage(qrImage, { x: panelRight - qrSize - 10, y: 10, width: qrSize, height: qrSize });
      page.drawText('Scan to redeem', { x: panelRight - qrSize - 22, y: 6, size: 5, font: fontRegular, color: charcoal });
    } catch (qrErr) {
      console.error('Failed to embed QR code:', qrErr);
    }
  }

  return await pdfDoc.save();
}
