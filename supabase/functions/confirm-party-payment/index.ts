import Stripe from 'stripe';
import { createClient } from 'supabase';
import { isRateLimited, rateLimitResponse, getClientIp } from '../_shared/rate-limit.ts';
import { createNotification } from '../_shared/notifications.ts';
import { allocateAndApply, persistAllocation } from '../_shared/allocation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(`confirm-party:${clientIp}`, 10, 60_000)) {
    return rateLimitResponse();
  }

  try {
    const { paymentIntentId } = await req.json();
    if (!paymentIntentId) {
      return new Response(JSON.stringify({ error: 'Missing payment intent id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if booking already exists for this payment intent (idempotent — webhook may have created it)
    const { data: existing } = await supabase
      .from('bookings')
      .select('booking_id')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ success: true, bookingId: existing.booking_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get stripe mode and verify payment
    const { data: settings } = await supabase.from('settings').select('value').eq('key', 'stripe_mode').single();
    const isLive = settings?.value === 'live';

    const secretKey = isLive
      ? Deno.env.get('STRIPE_SECRET_KEY_LIVE')
      : Deno.env.get('STRIPE_SECRET_KEY_SANDBOX');

    if (!secretKey) {
      return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(secretKey);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return new Response(JSON.stringify({ error: 'Payment not completed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const metadata = paymentIntent.metadata || {};
    if (metadata.type !== 'party_deposit') {
      return new Response(JSON.stringify({ error: 'Invalid payment type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create the booking now that payment is confirmed
    const managementToken = crypto.randomUUID();
    const bookingId = metadata.bookingId;
    const depositAmount = Number(metadata.amount) || 50;

    const bookingRow = {
      booking_id: bookingId,
      studio: metadata.studio,
      name: metadata.name,
      email: metadata.email || null,
      phone: metadata.phone,
      date: metadata.date,
      time: metadata.time,
      painters_count: Number(metadata.paintersCount) || 1,
      session_type: metadata.sessionType,
      notes: metadata.notes || null,
      status: 'confirmed',
      request_date: metadata.requestDate || new Date().toISOString().split('T')[0],
      source: metadata.source || 'online',
      deposit_amount: depositAmount,
      final_seats: Number(metadata.finalSeats) || null,
      final_balance: Number(metadata.finalBalance) || null,
      payment_status: 'paid',
      stripe_payment_intent_id: paymentIntentId,
      deposit_paid_at: new Date().toISOString(),
      management_token: managementToken,
    };

    const { data: insertedBooking, error: insertError } = await supabase.from('bookings').insert(bookingRow).select('id').single();

    if (insertError) {
      // Race condition: webhook may have already created the booking
      if (insertError.code === '23505') {
        const { data: existingBooking } = await supabase
          .from('bookings')
          .select('booking_id')
          .eq('stripe_payment_intent_id', paymentIntentId)
          .maybeSingle();
        if (existingBooking) {
          return new Response(JSON.stringify({ success: true, bookingId: existingBooking.booking_id }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      console.error('Booking insert error:', insertError);
      // A paid deposit with no booking must never be silent — alert staff.
      try {
        await createNotification(supabase, {
          type: 'booking_failed',
          title: 'PAID deposit — booking NOT created',
          message: `${metadata.name || 'Customer'} paid a £${depositAmount} deposit for ${metadata.studio || '?'} on ${metadata.date || '?'} at ${metadata.time || '?'}, but the booking could not be created (${insertError.message || insertError.code || 'unknown error'}). Payment ${paymentIntentId} — check Stripe and add the booking manually.`,
          entityType: 'booking',
          entityId: bookingId,
          studio: metadata.studio,
        });
      } catch (notifyErr) {
        console.error('Failed to create failure notification:', notifyErr);
      }
      return new Response(JSON.stringify({ error: 'Failed to create booking' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Wimbledon: allocate the physical party-area/tables this booking occupies.
    // Payment is already taken, so allocation failure must not fail the booking — warn only.
    if (metadata.studio === 'Wimbledon' && insertedBooking?.id) {
      try {
        const allocation = await allocateAndApply(supabase, {
          studio: 'Wimbledon',
          date: metadata.date,
          time: metadata.time,
          paintersCount: Number(metadata.paintersCount) || 1,
          sessionType: metadata.sessionType,
        });
        if (allocation.success) {
          await persistAllocation(supabase, insertedBooking.id, allocation);
        } else {
          console.warn('Party booking could not be auto-allocated:', allocation.reason);
        }
      } catch (allocErr) {
        console.error('Allocation error for party booking:', allocErr);
      }
    }

    // Create admin notification
    await createNotification(supabase, {
      type: 'booking_new',
      title: 'New Party Booking',
      message: `${metadata.name} — ${metadata.studio}, ${metadata.date} at ${metadata.time} (${metadata.paintersCount} painters)`,
      entityType: 'booking',
      entityId: bookingId,
      studio: metadata.studio,
    });

    // Send confirmation email
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, managementToken }),
      });
    } catch (emailErr) {
      console.error('Failed to send confirmation email:', emailErr);
    }

    return new Response(JSON.stringify({ success: true, bookingId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Confirm party payment error:', err);
    return new Response(JSON.stringify({ error: 'Failed to confirm payment' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
