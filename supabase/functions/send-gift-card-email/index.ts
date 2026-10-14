import { createClient } from 'supabase';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

interface GiftCardRow {
  id: string;
  code: string;
  amount: number;
  balance: number;
  recipient_name: string;
  recipient_email: string;
  sender_name: string;
  sender_email: string;
  message: string;
  purchase_date: string;
  expiry_date: string;
  status: string;
  covers?: string | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Activity vouchers (covers set) display what they cover instead of a £ amount
const cardValueHtml = (gc: GiftCardRow) =>
  gc.covers ? escapeHtml(gc.covers) : `&pound;${Number(gc.amount).toFixed(2)}`;
const cardValuePlain = (gc: GiftCardRow) =>
  gc.covers ? gc.covers : `£${Number(gc.amount).toFixed(2)}`;

// pdf-lib's WinAnsi fonts can't encode control chars (\n, \t) or non-Latin1 chars (emoji).
function sanitizePdfText(s: string | null | undefined, fallback = ''): string {
  if (!s) return fallback;
  return s.replace(/[^\x00-\xFF]/g, '').replace(/[\x00-\x1F\x7F-\x9F]+/g, ' ').trim() || fallback;
}

async function generateVoucherPDF(giftCard: GiftCardRow): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  // Background — light cream
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(0.96, 0.95, 0.91),
  });

  // Border — dark teal
  const borderWidth = 3;
  page.drawRectangle({
    x: borderWidth,
    y: borderWidth,
    width: width - borderWidth * 2,
    height: height - borderWidth * 2,
    borderColor: rgb(0.106, 0.176, 0.235),
    borderWidth: 2,
    color: rgb(0.96, 0.95, 0.91),
  });

  // Inner accent border
  page.drawRectangle({
    x: 12,
    y: 12,
    width: width - 24,
    height: height - 24,
    borderColor: rgb(0.839, 0.906, 0.894),
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  // Logo text (since we can't easily embed external images in all environments)
  page.drawText('Pitter Potter', {
    x: width / 2 - 65,
    y: height - 50,
    size: 24,
    font: fontBold,
    color: rgb(0.106, 0.176, 0.235),
  });

  page.drawText('Pottery Painting Studio', {
    x: width / 2 - 70,
    y: height - 68,
    size: 8,
    font: fontRegular,
    color: rgb(0.106, 0.176, 0.235, ),
  });

  // Decorative line
  page.drawRectangle({
    x: 60,
    y: height - 82,
    width: width - 120,
    height: 1,
    color: rgb(0.839, 0.906, 0.894),
  });

  // Gift Voucher title
  page.drawText('GIFT VOUCHER', {
    x: width / 2 - 55,
    y: height - 110,
    size: 18,
    font: fontBold,
    color: rgb(0.106, 0.176, 0.235),
  });

  // Amount — large and centered. Activity vouchers show the covers text.
  if (giftCard.covers) {
    const coversText = (giftCard.covers || 'Studio activity').replace(/[^\x00-\xFF]/g, ' ').trim();
    const size = fontBold.widthOfTextAtSize(coversText, 16) > width - 160 ? 12 : 16;
    const coversWidth = fontBold.widthOfTextAtSize(coversText, size);
    page.drawText(coversText, {
      x: (width - coversWidth) / 2,
      y: height - 160,
      size,
      font: fontBold,
      color: rgb(0.106, 0.176, 0.235),
    });
  } else {
  const amountStr = `\u00A3${Number(giftCard.amount).toFixed(2)}`;
  const amountWidth = fontBold.widthOfTextAtSize(amountStr, 36);
  page.drawText(amountStr, {
    x: (width - amountWidth) / 2,
    y: height - 160,
    size: 36,
    font: fontBold,
    color: rgb(0.106, 0.176, 0.235),
  });
  }

  // Gift card code box
  const codeY = height - 200;
  page.drawRectangle({
    x: 80,
    y: codeY - 6,
    width: width - 160,
    height: 28,
    color: rgb(0.839, 0.906, 0.894),
    borderColor: rgb(0.106, 0.176, 0.235),
    borderWidth: 1,
  });

  const codeLabel = 'Code:  ';
  const codeLabelWidth = fontRegular.widthOfTextAtSize(codeLabel, 14);
  page.drawText(codeLabel, {
    x: 100,
    y: codeY,
    size: 14,
    font: fontRegular,
    color: rgb(0.106, 0.176, 0.235),
  });
  page.drawText(giftCard.code, {
    x: 100 + codeLabelWidth + 4,
    y: codeY,
    size: 14,
    font: fontBold,
    color: rgb(0.106, 0.176, 0.235),
  });

  // From / To
  let y = height - 240;
  const labelX = 80;
  const valueX = 160;

  page.drawText('From:', {
    x: labelX,
    y,
    size: 10,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  page.drawText(sanitizePdfText(giftCard.sender_name, 'Anonymous'), {
    x: valueX,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.106, 0.176, 0.235),
  });

  y -= 18;
  page.drawText('To:', {
    x: labelX,
    y,
    size: 10,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  page.drawText(sanitizePdfText(giftCard.recipient_name, 'Valued Customer'), {
    x: valueX,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.106, 0.176, 0.235),
  });

  // Personal message
  const safeMessage = sanitizePdfText(giftCard.message);
  if (safeMessage) {
    y -= 28;
    page.drawText('Message:', {
      x: labelX,
      y,
      size: 10,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 14;
    // Word wrap the message (split on all whitespace so newlines never reach drawText)
    const maxWidth = width - 160;
    const words = safeMessage.split(/\s+/);
    let line = '';
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (fontOblique.widthOfTextAtSize(testLine, 10) > maxWidth) {
        page.drawText(line, {
          x: 80,
          y,
          size: 10,
          font: fontOblique,
          color: rgb(0.3, 0.3, 0.3),
        });
        y -= 14;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      page.drawText(line, {
        x: 80,
        y,
        size: 10,
        font: fontOblique,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
  }

  // Footer — validity + studios
  y = 40;
  page.drawText(`Valid for 12 months from purchase (${giftCard.purchase_date || new Date().toLocaleDateString('en-GB')})`, {
    x: 80,
    y: y + 10,
    size: 8,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawText('Putney: 234 Upper Richmond Road, SW15 6TG  |  020 8788 1635', {
    x: 80,
    y: y - 2,
    size: 7,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawText('Wimbledon: 52 Wimbledon Hill Road, SW19 7PA  |  020 3770 4499', {
    x: 80,
    y: y - 12,
    size: 7,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawText('www.pitterpotter.co.uk', {
    x: width / 2 - 40,
    y: y - 24,
    size: 8,
    font: fontBold,
    color: rgb(0.106, 0.176, 0.235),
  });

  // Embed QR code if available
  const qrBytes = await generateQRCodeBytes(giftCard.code);
  if (qrBytes) {
    try {
      const qrImage = await pdfDoc.embedPng(qrBytes);
      const qrSize = 60;
      page.drawImage(qrImage, {
        x: width - qrSize - 30,
        y: 30,
        width: qrSize,
        height: qrSize,
      });
      page.drawText('Scan to redeem', {
        x: width - qrSize - 28,
        y: 20,
        size: 6,
        font: fontRegular,
        color: rgb(0.5, 0.5, 0.5),
      });
    } catch (qrErr) {
      console.error('Failed to embed QR code:', qrErr);
    }
  }

  return await pdfDoc.save();
}

function buildRecipientEmail(giftCard: GiftCardRow): string {
  const senderName = giftCard.sender_name || 'Someone';
  const messageHtml = giftCard.message
    ? `<div style="background:#FFFFFF;border-radius:12px;padding:20px;margin:0 0 24px;border:1px solid #D6E2E9;"><p style="font-size:12px;color:#1B2D3C;opacity:0.5;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">A message from ${senderName}</p><p style="font-size:15px;line-height:1.6;color:#1B2D3C;margin:0;font-style:italic;">"${giftCard.message}"</p></div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:'DM Sans','Outfit','Plus Jakarta Sans','Inter',sans-serif;color:#1B2D3C;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <img src="https://www.pitterpotter.co.uk/pp_logo.png" alt="Pitter Potter" style="height:56px;width:auto;margin:0 auto 12px;display:block;" />
      <p style="font-size:11px;color:#1B2D3C;opacity:0.5;margin:0;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Pottery Painting Studio</p>
    </div>

    <div style="background:#FFFFFF;border-radius:16px;padding:32px;border:1px solid #D6E2E9;">
      <h2 style="font-family:'Montserrat','Outfit','Plus Jakarta Sans','Inter',sans-serif;font-size:22px;font-weight:900;color:#1B2D3C;margin:0 0 16px;">You've received a gift card!</h2>

      <p style="font-size:15px;line-height:1.6;color:#1B2D3C;margin:0 0 24px;">Hi ${giftCard.recipient_name},</p>
      <p style="font-size:15px;line-height:1.6;color:#1B2D3C;margin:0 0 24px;"><strong>${senderName}</strong> has sent you a Pitter Potter gift card. You can use it towards any pottery painting session at either of our studios in Putney or Wimbledon.</p>

      <div style="background:#DBE7E4;border-radius:12px;padding:24px;margin:0 0 24px;text-align:center;">
        <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">${giftCard.covers ? 'This voucher covers' : 'Gift Card Value'}</p>
        <p style="font-size:${giftCard.covers ? '18px' : '32px'};font-weight:900;color:#1B2D3C;margin:0 0 12px;">${cardValueHtml(giftCard)}</p>
        <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Code</p>
        <p style="font-size:20px;font-weight:900;color:#1B2D3C;margin:0;font-family:monospace;letter-spacing:2px;">${giftCard.code}</p>
      </div>

      ${messageHtml}

      <div style="background:#FEF3C7;border-radius:12px;padding:16px;margin:0 0 24px;border:1px solid #FDE68A;">
        <p style="font-size:13px;line-height:1.5;margin:0;color:#92400E;">
          <strong>How to use:</strong> Simply enter your gift card code at checkout when booking online, or show this email in studio. Valid for 12 months from purchase.
        </p>
      </div>

      <p style="font-size:15px;line-height:1.6;color:#1B2D3C;margin:0 0 8px;">We can't wait to see what you create!</p>
    </div>

    <div style="text-align:center;margin-top:24px;padding-top:24px;border-top:1px solid #D6E2E9;">
      <p style="font-size:13px;color:#1B2D3C;font-weight:700;margin:0 0 4px;">Pitter Potter</p>
      <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0 0 2px;line-height:1.5;">Putney: 234 Upper Richmond Road, SW15 6TG &middot; 020 8788 1635</p>
      <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0 0 2px;line-height:1.5;">Wimbledon: 52 Wimbledon Hill Road, SW19 7PA &middot; 020 3770 4499</p>
      <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0;">www.pitterpotter.co.uk</p>
    </div>
  </div>
</body>
</html>`;
}

function buildSenderEmail(giftCard: GiftCardRow): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:'DM Sans','Outfit','Plus Jakarta Sans','Inter',sans-serif;color:#1B2D3C;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <img src="https://www.pitterpotter.co.uk/pp_logo.png" alt="Pitter Potter" style="height:56px;width:auto;margin:0 auto 12px;display:block;" />
      <p style="font-size:11px;color:#1B2D3C;opacity:0.5;margin:0;text-transform:uppercase;letter-spacing:2px;font-weight:700;">Pottery Painting Studio</p>
    </div>

    <div style="background:#FFFFFF;border-radius:16px;padding:32px;border:1px solid #D6E2E9;">
      <h2 style="font-family:'Montserrat','Outfit','Plus Jakarta Sans','Inter',sans-serif;font-size:22px;font-weight:900;color:#1B2D3C;margin:0 0 16px;">Gift card purchase confirmed</h2>

      <p style="font-size:15px;line-height:1.6;color:#1B2D3C;margin:0 0 24px;">Hi ${giftCard.sender_name},</p>
      <p style="font-size:15px;line-height:1.6;color:#1B2D3C;margin:0 0 24px;">Thank you for your purchase! Your gift card has been sent to <strong>${giftCard.recipient_name}</strong> at ${giftCard.recipient_email}. They'll receive an email with the gift card code and a printable PDF voucher.</p>

      <div style="background:#DBE7E4;border-radius:12px;padding:24px;margin:0 0 24px;">
        <p style="font-size:14px;line-height:1.8;margin:0;color:#1B2D3C;">
          <strong style="display:inline-block;width:100px;color:#1B2D3C;opacity:0.6;font-size:12px;text-transform:uppercase;letter-spacing:1px;">${giftCard.covers ? 'Covers' : 'Value'}</strong> ${cardValueHtml(giftCard)}<br/>
          <strong style="display:inline-block;width:100px;color:#1B2D3C;opacity:0.6;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Code</strong> <span style="font-family:monospace;font-weight:900;letter-spacing:1px;">${giftCard.code}</span><br/>
          <strong style="display:inline-block;width:100px;color:#1B2D3C;opacity:0.6;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Recipient</strong> ${giftCard.recipient_name}<br/>
          <strong style="display:inline-block;width:100px;color:#1B2D3C;opacity:0.6;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Valid until</strong> 12 months from purchase
        </p>
      </div>

      <p style="font-size:14px;line-height:1.6;color:#1B2D3C;opacity:0.7;margin:0 0 8px;">If you have any questions about your gift card, please contact us at either studio.</p>
    </div>

    <div style="text-align:center;margin-top:24px;padding-top:24px;border-top:1px solid #D6E2E9;">
      <p style="font-size:13px;color:#1B2D3C;font-weight:700;margin:0 0 4px;">Pitter Potter</p>
      <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0 0 2px;line-height:1.5;">Putney: 234 Upper Richmond Road, SW15 6TG &middot; 020 8788 1635</p>
      <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0 0 2px;line-height:1.5;">Wimbledon: 52 Wimbledon Hill Road, SW19 7PA &middot; 020 3770 4499</p>
      <p style="font-size:12px;color:#1B2D3C;opacity:0.6;margin:0;">www.pitterpotter.co.uk</p>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'bookings@pitterpotter.co.uk';
  if (!resendKey) {
    console.warn('RESEND_API_KEY not set; skipping gift card email');
    return new Response(JSON.stringify({ success: false, error: 'Email service not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { giftCardId } = await req.json();
    if (!giftCardId) {
      return new Response(JSON.stringify({ error: 'Missing giftCardId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: giftCard, error } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('id', giftCardId)
      .single() as { data: GiftCardRow | null; error: Error | null };

    if (error || !giftCard) {
      return new Response(JSON.stringify({ error: 'Gift card not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Subject-line wording for activity vouchers vs £ gift cards
    const subjectCardLabel = giftCard.covers
      ? 'a Pitter Potter gift voucher'
      : `a £${Number(giftCard.amount).toFixed(2)} gift card`;

    // Generate PDF voucher
    const pdfBytes = await generateVoucherPDF(giftCard);
    const pdfUint8 = new Uint8Array(pdfBytes);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < pdfUint8.length; i += chunkSize) {
      binary += String.fromCharCode(...pdfUint8.subarray(i, i + chunkSize));
    }
    const pdfBase64 = btoa(binary);

    let recipientSent = false;
    let senderSent = false;

    // 1. Send email to recipient with PDF voucher attached
    if (giftCard.recipient_email) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `Pitter Potter <${fromEmail}>`,
            to: giftCard.recipient_email,
            subject: `You've received ${subjectCardLabel} from ${giftCard.sender_name || 'someone'}!`,
            html: buildRecipientEmail(giftCard),
            attachments: [{
              filename: `pitter-potter-gift-voucher-${giftCard.code}.pdf`,
              content: pdfBase64,
            }],
          }),
        });

        if (response.ok) {
          recipientSent = true;
          const resendData = await response.json().catch(() => ({}));
          // Log to email_logs
          try {
            await supabase.from('email_logs').insert({
              email_type: 'gift_card_recipient',
              recipient: giftCard.recipient_email,
              subject: `You've received ${subjectCardLabel} from ${giftCard.sender_name || 'someone'}!`,
              body: buildRecipientEmail(giftCard),
              resend_id: resendData.id || null,
              status: 'sent',
            });
          } catch (logErr) {
            console.error('Failed to log recipient email:', logErr);
          }
        } else {
          const errData = await response.json().catch(() => ({ message: 'Unknown error' }));
          console.error('Resend recipient error:', errData);
        }
      } catch (err) {
        console.error('Failed to send recipient email:', err);
      }
    }

    // 2. Send confirmation email to sender
    if (giftCard.sender_email) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `Pitter Potter <${fromEmail}>`,
            to: giftCard.sender_email,
            subject: `Gift card purchase confirmed \u2014 ${cardValuePlain(giftCard)}`,
            html: buildSenderEmail(giftCard),
            attachments: [{
              filename: `pitter-potter-gift-voucher-${giftCard.code}.pdf`,
              content: pdfBase64,
            }],
          }),
        });

        if (response.ok) {
          senderSent = true;
          const resendData = await response.json().catch(() => ({}));
          try {
            await supabase.from('email_logs').insert({
              email_type: 'gift_card_sender',
              recipient: giftCard.sender_email,
              subject: `Gift card purchase confirmed \u2014 ${cardValuePlain(giftCard)}`,
              body: buildSenderEmail(giftCard),
              resend_id: resendData.id || null,
              status: 'sent',
            });
          } catch (logErr) {
            console.error('Failed to log sender email:', logErr);
          }
        } else {
          const errData = await response.json().catch(() => ({ message: 'Unknown error' }));
          console.error('Resend sender error:', errData);
        }
      } catch (err) {
        console.error('Failed to send sender email:', err);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      recipientSent,
      senderSent,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Send gift card email error:', err);
    return new Response(JSON.stringify({ error: 'Failed to send gift card emails' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
