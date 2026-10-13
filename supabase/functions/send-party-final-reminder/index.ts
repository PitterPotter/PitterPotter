import { createClient } from 'supabase';
import { isObject, isNonEmptyString, isInteger } from '../_shared/validate.ts';
import type { StaffRecord } from '../_shared/types.ts';
import { verifyStaff } from '../_shared/auth.ts';
import { loadEmailTemplate, renderTemplate } from '../_shared/email-template.ts';
import { loadSMSTemplate } from '../_shared/sms-template.ts';
import { getStudioInfo } from '../_shared/studio-info.ts';
import { corsHeaders as makeCorsHeaders, optionsResponse } from '../_shared/cors.ts';
import { getConfiguredSMSProvider, sendSMS } from '../_shared/sms-provider.ts';

const PARTY_TYPES = ['birthday-party', 'baby-shower-hen', 'corporate'];


async function sendReminderEmail(
  details: {
    bookingId: string;
    name: string;
    email: string;
    studio: string;
    date: string;
    time: string;
    finalSeats: number;
    partyPrice: number;
    depositAmount: number;
    finalBalance: number;
    paymentLinkUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'bookings@pitterpotter.co.uk';
  if (!resendKey) {
    console.warn('RESEND_API_KEY not set; skipping reminder email');
    return { success: false, error: 'Email service not configured' };
  }

  const formatDate = (d: string) => {
    const parts = d.split('-');
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d;
  };
  const formattedDate = formatDate(details.date);

  const studioName = `Pitter Potter ${details.studio}`;
  const subject = `Final payment for your party — ${studioName} on ${formattedDate}`;

  const studioInfo = getStudioInfo(details.studio);
  const templateVars: Record<string, string | number | undefined> = {
    bookingId: details.bookingId,
    name: details.name,
    studio: studioName,
    studioAddress: studioInfo.address,
    studioPhone: studioInfo.phone,
    date: formattedDate,
    time: details.time,
    finalSeats: details.finalSeats,
    partyPrice: details.partyPrice.toFixed(2),
    totalAmount: (details.finalSeats * details.partyPrice).toFixed(2),
    depositAmount: details.depositAmount.toFixed(2),
    finalBalance: details.finalBalance.toFixed(2),
    paymentLinkUrl: details.paymentLinkUrl,
  };

  const tpl = await loadEmailTemplate('party_final_reminder');
  const fallbackHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1B2D3C;">
            <h2 style="color: #1B2D3C;">Your party is almost here</h2>
            <p>Hi ${details.name},</p>
            <p>Your party at <strong>${studioName}</strong> is on <strong>${formattedDate}</strong> at <strong>${details.time}</strong>.</p>
            <p>Please confirm your final number of seats so we can prepare everything for you.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr><td style="padding: 8px; border: 1px solid #DBE7E4;"><strong>Final seats</strong></td><td style="padding: 8px; border: 1px solid #DBE7E4;">${details.finalSeats}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #DBE7E4;"><strong>Price per person</strong></td><td style="padding: 8px; border: 1px solid #DBE7E4;">£${details.partyPrice.toFixed(2)}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #DBE7E4;"><strong>Total</strong></td><td style="padding: 8px; border: 1px solid #DBE7E4;">£${(details.finalSeats * details.partyPrice).toFixed(2)}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #DBE7E4;"><strong>Deposit paid</strong></td><td style="padding: 8px; border: 1px solid #DBE7E4;">−£${details.depositAmount.toFixed(2)}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #DBE7E4;"><strong>Final balance</strong></td><td style="padding: 8px; border: 1px solid #DBE7E4;"><strong>£${details.finalBalance.toFixed(2)}</strong></td></tr>
            </table>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${details.paymentLinkUrl}" style="background: #1B2D3C; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Pay final balance</a>
            </p>
            <p>If your numbers have changed, you can adjust them on the payment page before paying.</p>
            <p style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #DBE7E4; font-size: 12px; color: #666;">
              <strong>${studioName}</strong><br/>
              ${studioInfo.address}<br/>
              ${studioInfo.phone}
            </p>
            <p>Pitter Potter</p>
          </div>
        `;
  const html = tpl ? renderTemplate(tpl.html_content, templateVars) : fallbackHtml;
  const finalSubject = tpl ? renderTemplate(tpl.subject, templateVars) : subject;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: details.email,
        subject: finalSubject,
        html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      console.error('Resend error:', errorData);
      return { success: false, error: errorData.message || 'Failed to send email' };
    }

    const resendData = await response.json().catch(() => ({}));

    // Log to email_logs
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseServiceKey) {
        const logClient = createClient(supabaseUrl, supabaseServiceKey);
        await logClient.from('email_logs').insert({
          email_type: 'party_final_reminder',
          recipient: details.email,
          subject: finalSubject,
          body: html,
          resend_id: resendData.id || null,
          status: 'sent',
          booking_id: details.bookingId,
        });
      }
    } catch (logErr) {
      console.error('Failed to log email:', logErr);
    }

    return { success: true };
  } catch (err) {
    console.error('Send reminder email error:', err);
    return { success: false, error: 'Failed to send email' };
  }
}

async function sendReminderSMS(
  details: {
    bookingId: string;
    name: string;
    phone: string;
    studio: string;
    date: string;
    time: string;
    finalBalance: number;
    paymentLinkUrl: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    return { success: false, error: 'Supabase not configured' };
  }
  const optOutClient = createClient(supabaseUrl, supabaseServiceKey);

  const provider = getConfiguredSMSProvider();
  if (provider === 'none') {
    console.warn('No SMS provider configured; skipping reminder SMS');
    return { success: false, error: 'SMS service not configured' };
  }

  let toNumber = details.phone.trim();
  if (toNumber.startsWith('07')) {
    toNumber = '+44' + toNumber.substring(1);
  } else if (toNumber.startsWith('7') && !toNumber.startsWith('+')) {
    toNumber = '+44' + toNumber;
  } else if (!toNumber.startsWith('+')) {
    toNumber = '+44' + toNumber;
  }

  const studioName = `Pitter Potter ${details.studio}`;
  const studioInfo = getStudioInfo(details.studio);

  // Check SMS opt-out
  {
    const { data: optOut } = await optOutClient.from('sms_opt_outs')
      .select('phone').eq('phone', toNumber).is('opted_in_at', null).limit(1);
    if (optOut && optOut.length > 0) {
      console.log(`SMS to ${toNumber} skipped (opted out)`);
      return { success: false, error: 'Recipient has opted out of SMS' };
    }
  }
  const senderId = 'PitterPotte';

  const formatDate = (d: string) => {
    const parts = d.split('-');
    return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d;
  };
  const formattedDate = formatDate(details.date);

  const templateVars: Record<string, string | number | undefined> = {
    name: details.name,
    studio: studioName,
    studioAddress: studioInfo.address,
    studioPhone: studioInfo.phone,
    date: formattedDate,
    time: details.time,
    finalBalance: details.finalBalance.toFixed(2),
    paymentLinkUrl: details.paymentLinkUrl,
  };

  const tpl = await loadSMSTemplate('party_final_reminder');
  let message: string;
  if (tpl) {
    message = renderTemplate(tpl, templateVars).replace(/\\n/g, '\n');
  } else {
    message = `Hi ${details.name}, your party at ${studioName} is on ${formattedDate} at ${details.time}. Final balance: £${details.finalBalance.toFixed(2)}. Pay here: ${details.paymentLinkUrl}. Questions? Call ${studioInfo.phone}`;
  }

  if (message.length > 160) {
    console.warn(`SMS message is ${message.length} chars, will be split into multiple segments`);
  }

  try {
    const result = await sendSMS({
      to: toNumber,
      body: message,
      senderId,
    });

    if (!result.success) {
      console.error('PureSMS SMS error:', result.error);
      return { success: false, error: result.error || 'Failed to send SMS' };
    }

    try {
      await optOutClient.from('email_logs').insert({
        email_type: 'party_final_reminder_sms',
        recipient: toNumber,
        subject: 'Party final reminder SMS',
        body: message,
        resend_id: result.id || null,
        status: 'sent',
        booking_id: details.bookingId,
      });
    } catch (logErr) {
      console.error('Failed to log SMS:', logErr);
    }

    return { success: true };
  } catch (err) {
    console.error('Send reminder SMS error:', err);
    return { success: false, error: 'Failed to send SMS' };
  }
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

    const { username, sessionToken, bookingId, finalSeats } = body;

    if (!isNonEmptyString(bookingId)) {
      return new Response(JSON.stringify({ error: 'Missing bookingId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Automatic final payment links are disabled — only an authenticated staff
    // member can send this reminder manually.
    if (!isNonEmptyString(username) || !isNonEmptyString(sessionToken)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
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

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_id', bookingId)
      .single();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!PARTY_TYPES.includes(booking.session_type)) {
      return new Response(JSON.stringify({ error: 'Not a party booking' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: priceSetting } = await supabase.from('settings').select('value').eq('key', 'party_price_per_person').single();
    const partyPrice = Number(priceSetting?.value) || 28.95;
    const depositAmount = Number(booking.deposit_amount) || 50;
    const resolvedFinalSeats = isInteger(finalSeats) && finalSeats >= 1 ? finalSeats : booking.painters_count;
    const total = resolvedFinalSeats * partyPrice;
    const finalBalance = Math.max(0, total - depositAmount);

    const siteUrl = Deno.env.get('SITE_URL') || 'https://pitterpotter.co.uk';
    const paymentPageUrl = `${siteUrl}/party-payment?booking=${booking.booking_id}`;

    const results: { email?: { success: boolean; error?: string }; sms?: { success: boolean; error?: string } } = {};

    if (booking.email) {
      results.email = await sendReminderEmail({
        bookingId: booking.booking_id,
        name: booking.name,
        email: booking.email,
        studio: booking.studio,
        date: booking.date,
        time: booking.time,
        finalSeats: resolvedFinalSeats,
        partyPrice,
        depositAmount,
        finalBalance,
        paymentLinkUrl: paymentPageUrl,
      });
    }

    if (booking.phone) {
      results.sms = await sendReminderSMS({
        bookingId: booking.booking_id,
        name: booking.name,
        phone: booking.phone,
        studio: booking.studio,
        date: booking.date,
        time: booking.time,
        finalBalance,
        paymentLinkUrl: paymentPageUrl,
      });
    }

    if (!booking.email && !booking.phone) {
      return new Response(JSON.stringify({ error: 'Booking has no email or phone number' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: updateError } = await supabase.from('bookings').update({
      final_seats: resolvedFinalSeats,
      final_balance: finalBalance,
      payment_link_url: paymentPageUrl,
      payment_link_sent_at: new Date().toISOString(),
    }).eq('booking_id', bookingId);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, ...results, paymentLinkUrl: paymentPageUrl, finalBalance }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Send party final reminder error:', err);
    return new Response(JSON.stringify({ error: 'Failed to send reminder' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
