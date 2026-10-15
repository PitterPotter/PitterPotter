import { createClient } from 'supabase';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { isObject, isNonEmptyString, isOneOf, isNumber } from '../_shared/validate.ts';
import { logAudit } from '../_shared/audit.ts';
import type { AdminSupabaseClient, StaffRecord } from '../_shared/types.ts';
import { verifyStaff } from '../_shared/auth.ts';
import { corsHeaders as makeCorsHeaders, optionsResponse } from '../_shared/cors.ts';
import { createNotification } from '../_shared/notifications.ts';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PP-';
  for (let i = 0; i < 10; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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

interface GiftCardRow {
  id: string;
  code: string;
  amount: number;
  balance: number;
  recipient_name: string | null;
  recipient_email: string | null;
  sender_name: string | null;
  sender_email: string | null;
  message: string | null;
  purchase_date: string | null;
  expiry_date: string | null;
  status: string;
  covers?: string | null;
}

async function generateVoucherPDF(giftCard: GiftCardRow): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  // Brand colors
  const charcoal = rgb(0.106, 0.176, 0.235);    // #1B2D3C
  const sage = rgb(0.839, 0.906, 0.894);        // #D6E2E9
  const sageDeep = rgb(0.65, 0.78, 0.75);       // deeper sage
  const cream = rgb(0.96, 0.95, 0.91);          // #F5F2E8
  const white = rgb(0.98, 0.97, 0.94);          // warm off-white
  const grey = rgb(0.4, 0.4, 0.4);
  const lightGrey = rgb(0.55, 0.55, 0.55);

  // Background — charcoal
  page.drawRectangle({ x: 0, y: 0, width, height, color: charcoal });

  // Inner panel — sage
  page.drawRectangle({
    x: 8, y: 8, width: width - 16, height: height - 16,
    color: sage, borderColor: charcoal, borderWidth: 1,
  });

  // Content card — warm off-white
  page.drawRectangle({
    x: 16, y: 16, width: width - 32, height: height - 32,
    color: white, borderColor: sageDeep, borderWidth: 1,
  });

  // Top accent bar — charcoal
  page.drawRectangle({ x: 16, y: height - 16, width: width - 32, height: 6, color: charcoal });

  // Embed logo from website
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

  if (logoImg) {
    const logoH = 38;
    const logoW = logoImg.width / logoImg.height * logoH;
    page.drawImage(logoImg, {
      x: (width - logoW) / 2, y: height - 58,
      width: logoW, height: logoH,
    });
  } else {
    const logoText = 'Pitter Potter';
    const logoW = fontBold.widthOfTextAtSize(logoText, 22);
    page.drawText(logoText, {
      x: (width - logoW) / 2, y: height - 48, size: 22, font: fontBold, color: charcoal,
    });
  }

  const subText = 'Pottery Painting Studio';
  const subW = fontRegular.widthOfTextAtSize(subText, 8);
  page.drawText(subText, {
    x: (width - subW) / 2, y: height - 70, size: 8, font: fontRegular, color: charcoal,
  });

  // Decorative line
  page.drawRectangle({ x: 80, y: height - 82, width: width - 160, height: 1, color: sageDeep });

  const sanitize = (s: string | null | undefined, fallback: string) => {
    if (!s) return fallback;
    // WinAnsi can't encode control chars (\n, \t) or non-Latin1 chars — strip both
    return s.replace(/[^\x00-\xFF]/g, '').replace(/[\x00-\x1F\x7F-\x9F]+/g, ' ').trim() || fallback;
  };

  // GIFT VOUCHER title
  const voucherText = 'GIFT VOUCHER';
  const voucherW = fontBold.widthOfTextAtSize(voucherText, 18);
  page.drawText(voucherText, {
    x: (width - voucherW) / 2, y: height - 108, size: 18, font: fontBold, color: charcoal,
  });

  // Amount — on a sage panel. Activity vouchers (e.g. school donations)
  // show what the voucher covers instead of a £ amount.
  if (giftCard.covers) {
    const coversText = sanitize(giftCard.covers, 'Studio activity');
    const coversMaxWidth = width - 200;
    // Word-wrap the covers text, shrinking font until it fits in 2 lines
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
    page.drawRectangle({
      x: 80, y: height - 132 - coversPanelH,
      width: width - 160, height: coversPanelH,
      color: sage, borderColor: sageDeep, borderWidth: 1,
    });
    coversLines.forEach((coversLine, i) => {
      const lw = fontBold.widthOfTextAtSize(coversLine, coversSize);
      page.drawText(coversLine, {
        x: (width - lw) / 2,
        y: height - 132 - coversPanelH + 10 + (coversLines.length - 1 - i) * coversLineH,
        size: coversSize, font: fontBold, color: charcoal,
      });
    });
  } else {
  const amountStr = `\u00A3${Number(giftCard.amount).toFixed(2)}`;
  const amountWidth = fontBold.widthOfTextAtSize(amountStr, 36);
  const amountPanelW = amountWidth + 60;
  page.drawRectangle({
    x: (width - amountPanelW) / 2, y: height - 168,
    width: amountPanelW, height: 44,
    color: sage, borderColor: sageDeep, borderWidth: 1,
  });
  page.drawText(amountStr, {
    x: (width - amountWidth) / 2, y: height - 158, size: 36, font: fontBold, color: charcoal,
  });
  }

  // Code box — charcoal background
  const codeY = height - 200;
  page.drawRectangle({
    x: 80, y: codeY - 6, width: width - 160, height: 28,
    color: charcoal,
  });
  const codeLabel = 'Code:  ';
  const codeLabelWidth = fontRegular.widthOfTextAtSize(codeLabel, 14);
  page.drawText(codeLabel, { x: 100, y: codeY, size: 14, font: fontRegular, color: sage });
  page.drawText(giftCard.code, { x: 100 + codeLabelWidth + 4, y: codeY, size: 14, font: fontBold, color: white });

  // From / To / Date
  let y = height - 240;
  const labelX = 80;
  const valueX = 160;

  page.drawText('From:', { x: labelX, y, size: 10, font: fontRegular, color: grey });
  page.drawText(sanitize(giftCard.sender_name, 'Anonymous'), { x: valueX, y, size: 11, font: fontBold, color: charcoal });

  y -= 18;
  page.drawText('To:', { x: labelX, y, size: 10, font: fontRegular, color: grey });
  page.drawText(sanitize(giftCard.recipient_name, 'Valued Customer'), { x: valueX, y, size: 11, font: fontBold, color: charcoal });

  // Date
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
    const maxWidth = width - 160;
    const safeMessage = sanitize(giftCard.message, '');
    if (!safeMessage) {
      // skip message section if nothing left after sanitizing
    } else {
    const words = safeMessage.split(/\s+/);
    let line = '';
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (fontRegular.widthOfTextAtSize(testLine, 10) > maxWidth) {
        page.drawText(line, { x: 80, y, size: 10, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
        y -= 14;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      page.drawText(line, { x: 80, y, size: 10, font: fontRegular, color: rgb(0.3, 0.3, 0.3) });
    }
    }
  }

  // Footer area — sage band
  page.drawRectangle({ x: 16, y: 16, width: width - 32, height: 50, color: sage });
  page.drawRectangle({ x: 16, y: 64, width: width - 32, height: 2, color: sageDeep });

  page.drawText('Valid for 12 months from purchase', {
    x: 80, y: 52, size: 8, font: fontRegular, color: charcoal,
  });
  page.drawText('Putney: 234 Upper Richmond Road, SW15 6TG  |  020 8788 1635', {
    x: 80, y: 40, size: 7, font: fontRegular, color: charcoal,
  });
  page.drawText('Wimbledon: 52 Wimbledon Hill Road, SW19 7PA  |  020 3770 4499', {
    x: 80, y: 28, size: 7, font: fontRegular, color: charcoal,
  });
  const urlText = 'www.pitterpotter.co.uk';
  const urlW = fontBold.widthOfTextAtSize(urlText, 8);
  page.drawText(urlText, {
    x: (width - urlW) / 2, y: 20, size: 8, font: fontBold, color: charcoal,
  });

  // QR code
  const qrBytes = await generateQRCodeBytes(giftCard.code);
  if (qrBytes) {
    try {
      const qrImage = await pdfDoc.embedPng(qrBytes);
      const qrSize = 55;
      page.drawImage(qrImage, { x: width - qrSize - 30, y: 22, width: qrSize, height: qrSize });
      page.drawText('Scan to redeem', { x: width - qrSize - 28, y: 14, size: 6, font: fontRegular, color: charcoal });
    } catch (qrErr) {
      console.error('Failed to embed QR code:', qrErr);
    }
  }

  return await pdfDoc.save();
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return optionsResponse(req, true);
  }
  const corsHeaders = makeCorsHeaders(req, true);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    if (!isObject(body)) {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { action, username, sessionToken, id, status } = body;

    if (!isNonEmptyString(action) || !isNonEmptyString(username) || !isNonEmptyString(sessionToken)) {
      return new Response(JSON.stringify({ error: 'Missing action, username, or sessionToken' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const staff = await verifyStaff(supabase, username, sessionToken);
    if (!staff) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isSuperAdmin = staff.role === 'super_admin';

    if (action === 'list') {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data, error: listError } = await supabase
        .from('gift_cards')
        .select('*')
        .order('created_at', { ascending: false });
      if (listError) throw listError;
      return new Response(JSON.stringify({ giftCards: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create') {
      const { amount, recipientName, recipientEmail, senderName, message, isPhysical, covers } = body;
      const coversText = typeof covers === 'string' ? covers.trim() : '';
      if (coversText) {
        // Activity voucher — no £ amount required
      } else if (!isNumber(amount) || amount <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid amount' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const cardAmount = coversText ? 0 : amount;

      const code = generateCode();
      const purchaseDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      const { data: giftCard, error: insertError } = await supabase.from('gift_cards').insert({
        code,
        amount: cardAmount,
        balance: cardAmount,
        covers: coversText || null,
        recipient_name: recipientName || '',
        recipient_email: recipientEmail || '',
        sender_name: senderName || 'In-store',
        sender_email: '',
        message: message || '',
        status: 'active',
        purchase_date: purchaseDate,
        expiry_date: expiryDate.toISOString(),
        stripe_session_id: isPhysical ? `physical_${Date.now()}` : `admin_${Date.now()}`,
      }).select().single();

      if (insertError) throw insertError;

      await logAudit(supabase, staff, 'create', 'gift_card', giftCard.id, { code, amount: cardAmount, covers: coversText || undefined, isPhysical: !!isPhysical });

      // Create admin notification for gift card creation
      await createNotification(supabase, {
        type: 'gift_card_purchased',
        title: coversText ? 'Activity Voucher Created' : 'Gift Card Created',
        message: coversText
          ? `Activity voucher ${code} (${coversText}) created by ${staff.name}`
          : `£${cardAmount} gift card ${code} created by ${staff.name}${isPhysical ? ' (physical)' : ''}`,
        entityType: 'gift_card',
        entityId: giftCard.id,
      });

      // Send email whenever a recipient address is given — physical/in-store
      // vouchers may also be emailed (e.g. customer paid via Clover in shop)
      if (recipientEmail) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-gift-card-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
            body: JSON.stringify({ giftCardId: giftCard.id }),
          });
        } catch (emailErr) {
          console.error('Failed to send gift card email:', emailErr);
        }
      }

      return new Response(JSON.stringify({
        id: giftCard.id,
        code: giftCard.code,
        amount: Number(giftCard.amount),
        balance: Number(giftCard.balance),
        covers: giftCard.covers || '',
        status: giftCard.status,
        recipient_name: giftCard.recipient_name,
        recipient_email: giftCard.recipient_email,
        created_at: giftCard.created_at,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'balance') {
      const { code } = body;
      if (!isNonEmptyString(code)) {
        return new Response(JSON.stringify({ error: 'Missing code' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: card, error: cardError } = await supabase
        .from('gift_cards')
        .select('*')
        .eq('code', code.trim())
        .single();

      if (cardError || !card) {
        return new Response(JSON.stringify({ error: 'Gift card not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const expiryDate = card.expiry_date ? new Date(card.expiry_date) : null;
      const isExpired = expiryDate ? expiryDate < new Date() : false;

      if (isExpired && card.status === 'active') {
        await supabase.from('gift_cards').update({ status: 'expired' }).eq('id', card.id);
        card.status = 'expired';
      }

      await logAudit(supabase, staff, 'balance_check', 'gift_card', card.id, { code: card.code });

      return new Response(JSON.stringify({
        id: card.id,
        code: card.code,
        amount: Number(card.amount),
        balance: Number(card.balance),
        covers: card.covers || '',
        status: card.status,
        recipient_name: card.recipient_name,
        recipient_email: card.recipient_email,
        expiry_date: card.expiry_date,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'redeem') {
      const { code, amount: redeemAmount } = body;
      if (!isNonEmptyString(code)) {
        return new Response(JSON.stringify({ error: 'Missing code' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: card, error: cardError } = await supabase
        .from('gift_cards')
        .select('*')
        .eq('code', code.trim())
        .single();

      if (cardError || !card) {
        return new Response(JSON.stringify({ error: 'Gift card not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (card.status !== 'active') {
        return new Response(JSON.stringify({ error: `Gift card is ${card.status}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const expiryDate = card.expiry_date ? new Date(card.expiry_date) : null;
      if (expiryDate && expiryDate < new Date()) {
        await supabase.from('gift_cards').update({ status: 'expired' }).eq('id', card.id);
        return new Response(JSON.stringify({ error: 'Gift card has expired' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Activity vouchers (covers set) are single-use — redeeming marks them
      // used with no £ deduction.
      if (card.covers) {
        const { error: useError } = await supabase.from('gift_cards').update({
          status: 'redeemed',
        }).eq('id', card.id);
        if (useError) throw useError;
        await logAudit(supabase, staff, 'redeem', 'gift_card', card.id, {
          code: card.code,
          covers: card.covers,
        });
        return new Response(JSON.stringify({
          success: true,
          code: card.code,
          discount: 0,
          balance: 0,
          status: 'redeemed',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!isNumber(redeemAmount) || redeemAmount <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid amount' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const currentBalance = Number(card.balance);
      const discount = Math.min(currentBalance, redeemAmount);
      const newBalance = currentBalance - discount;
      const newStatus = newBalance <= 0 ? 'redeemed' : 'active';

      const { error: updateError } = await supabase.from('gift_cards').update({
        balance: newBalance,
        status: newStatus,
      }).eq('id', card.id);

      if (updateError) throw updateError;

      await logAudit(supabase, staff, 'redeem', 'gift_card', card.id, {
        code: card.code,
        amount: redeemAmount,
        discount,
        newBalance,
      });

      return new Response(JSON.stringify({
        success: true,
        code: card.code,
        discount,
        balance: newBalance,
        status: newStatus,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'updateStatus') {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!isNonEmptyString(id) || !isOneOf(status, ['active', 'redeemed', 'expired', 'cancelled', 'disabled'] as const)) {
        return new Response(JSON.stringify({ error: 'Invalid id or status' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await supabase.from('gift_cards').update({ status }).eq('id', id);
      if (error) throw error;
      await logAudit(supabase, staff, 'update_status', 'gift_card', id, { status });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'unredeem') {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!isNonEmptyString(id)) {
        return new Response(JSON.stringify({ error: 'Missing id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: card, error: fetchError } = await supabase
        .from('gift_cards')
        .select('id, code, amount, balance, status')
        .eq('id', id)
        .single();
      if (fetchError || !card) {
        return new Response(JSON.stringify({ error: 'Gift card not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (card.status !== 'redeemed') {
        return new Response(JSON.stringify({ error: `Card is not redeemed (status: ${card.status})` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Restore full balance only if the redemption consumed it entirely
      const restoredBalance = Number(card.balance) > 0 ? card.balance : card.amount;
      const { error } = await supabase
        .from('gift_cards')
        .update({ status: 'active', balance: restoredBalance })
        .eq('id', id);
      if (error) throw error;
      await logAudit(supabase, staff, 'unredeem', 'gift_card', id, {
        code: card.code,
        previous_balance: card.balance,
        restored_balance: restoredBalance,
      });
      return new Response(JSON.stringify({ success: true, status: 'active', balance: restoredBalance }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'delete') {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!isNonEmptyString(id)) {
        return new Response(JSON.stringify({ error: 'Missing id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: card, error: fetchError } = await supabase
        .from('gift_cards')
        .select('code, amount, status')
        .eq('id', id)
        .single();
      if (fetchError || !card) {
        return new Response(JSON.stringify({ error: 'Gift card not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error: deleteError } = await supabase.from('gift_cards').delete().eq('id', id);
      if (deleteError) throw deleteError;
      await logAudit(supabase, staff, 'delete', 'gift_card', id, { code: card.code, amount: card.amount, status: card.status });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'resend') {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!isNonEmptyString(id)) {
        return new Response(JSON.stringify({ error: 'Missing id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: card, error: fetchError } = await supabase
        .from('gift_cards')
        .select('code, recipient_email, recipient_name')
        .eq('id', id)
        .single();
      if (fetchError || !card) {
        return new Response(JSON.stringify({ error: 'Gift card not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!card.recipient_email) {
        return new Response(JSON.stringify({ error: 'No recipient email on file' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const resendResponse = await fetch(`${supabaseUrl}/functions/v1/send-gift-card-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ giftCardId: id }),
      });
      if (!resendResponse.ok) {
        const errData = await resendResponse.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: errData.error || 'Failed to resend email' }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await logAudit(supabase, staff, 'resend_email', 'gift_card', id, { code: card.code, recipient_email: card.recipient_email });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'downloadVoucher') {
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!isNonEmptyString(id)) {
        return new Response(JSON.stringify({ error: 'Missing gift card id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: giftCard, error: fetchError } = await supabase
        .from('gift_cards')
        .select('*')
        .eq('id', id)
        .single() as { data: GiftCardRow | null; error: Error | null };
      if (fetchError || !giftCard) {
        return new Response(JSON.stringify({ error: 'Gift card not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const pdfBytes = await generateVoucherPDF(giftCard);
      await logAudit(supabase, staff, 'download_voucher', 'gift_card', id, { code: giftCard.code });
      return new Response(new Blob([pdfBytes], { type: 'application/pdf' }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="pitter-potter-gift-voucher-${giftCard.code}.pdf"`,
        },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('Admin gift cards error:', errMsg);
    return new Response(JSON.stringify({ error: 'Failed to process request', detail: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
