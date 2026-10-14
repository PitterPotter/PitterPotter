import { createClient } from 'supabase';
import { buildVoucherPDF } from '../_shared/gift-voucher-pdf.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  return await buildVoucherPDF(giftCard);
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
