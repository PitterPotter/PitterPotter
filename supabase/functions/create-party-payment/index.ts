import Stripe from 'stripe';
import { createClient } from 'supabase';
import { isObject, isNonEmptyString, isInteger } from '../_shared/validate.ts';
import { isRateLimited, rateLimitResponse, getClientIp } from '../_shared/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(`party-payment:${clientIp}`, 10, 60_000)) {
    return rateLimitResponse();
  }

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

    const { bookingId, finalSeats, action } = body;

    if (!isNonEmptyString(bookingId)) {
      return new Response(JSON.stringify({ error: 'Missing bookingId' }), {
        status: 400,
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

    const { data: priceSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'party_price_per_person')
      .single();
    const partyPrice = Number(priceSetting?.value) || 28.95;
    const depositAmount = Number(booking.deposit_amount) || 50;
    const currentSeats = booking.final_seats || booking.painters_count || 1;
    const currentBalance = Math.max(0, currentSeats * partyPrice - depositAmount);

    if (action === 'info' || (action !== 'deposit' && (finalSeats === undefined || finalSeats === null))) {
      return new Response(JSON.stringify({
        bookingId: booking.booking_id,
        name: booking.name,
        studio: booking.studio,
        date: booking.date,
        time: booking.time,
        paintersCount: booking.painters_count,
        finalSeats: booking.final_seats,
        depositAmount,
        depositPaid: !!booking.deposit_paid_at || (Number(booking.deposit_amount) > 0 && !!booking.stripe_payment_intent_id),
        depositPaidAt: booking.deposit_paid_at || null,
        finalPaidAt: booking.final_paid_at || null,
        partyPrice,
        finalBalance: currentBalance,
        paymentStatus: booking.payment_status || 'pending',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: modeSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'stripe_mode')
      .single();
    const isLive = modeSetting?.value === 'live';
    const secretKey = isLive
      ? Deno.env.get('STRIPE_SECRET_KEY_LIVE')
      : Deno.env.get('STRIPE_SECRET_KEY_SANDBOX');

    if (!secretKey) {
      return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
    const siteUrl = Deno.env.get('SITE_URL') || 'https://pitterpotter.co.uk';

    if (action === 'deposit') {
      // Deposit payment for an existing (usually admin-created) booking.
      const amount = Number(booking.deposit_amount) || 50;
      if (booking.deposit_paid_at || (Number(booking.deposit_amount) > 0 && booking.stripe_payment_intent_id)) {
        return new Response(JSON.stringify({ error: 'Deposit already paid' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              product_data: {
                name: `Party deposit — ${booking.name}`,
                description: `Deposit for party at Pitter Potter ${booking.studio} on ${booking.date.split('-').reverse().join('-')}`,
              },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: booking.email || undefined,
        success_url: `${siteUrl}/party-payment-success?booking=${booking.booking_id}`,
        cancel_url: `${siteUrl}/party-payment?booking=${booking.booking_id}&cancelled=1`,
        metadata: {
          bookingId: booking.booking_id,
          type: 'party_deposit',
          amount: String(amount),
        },
      });

      return new Response(JSON.stringify({ url: session.url, amount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resolvedFinalSeats = isInteger(finalSeats) && finalSeats >= 1 ? finalSeats : booking.painters_count;
    const total = resolvedFinalSeats * partyPrice;
    const finalBalance = Math.max(0, total - depositAmount);

    if (finalBalance <= 0) {
      return new Response(JSON.stringify({ error: 'No balance remaining to pay' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `Party final balance — ${booking.name} (${resolvedFinalSeats} seats)`,
              description: `Final balance for party at Pitter Potter ${booking.studio} on ${booking.date.split('-').reverse().join('-')}`,
            },
            unit_amount: Math.round(finalBalance * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${siteUrl}/party-payment-success?booking=${booking.booking_id}`,
      cancel_url: `${siteUrl}/party-payment?booking=${booking.booking_id}&cancelled=1`,
      metadata: {
        bookingId: booking.booking_id,
        type: 'party_final_balance',
        finalSeats: String(resolvedFinalSeats),
        partyPrice: String(partyPrice),
        depositAmount: String(depositAmount),
        finalBalance: String(finalBalance),
      },
    });

    await supabase.from('bookings').update({
      final_seats: resolvedFinalSeats,
      final_balance: finalBalance,
    }).eq('booking_id', bookingId);

    return new Response(JSON.stringify({ url: session.url, finalBalance, finalSeats: resolvedFinalSeats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Create party payment error:', err);
    return new Response(JSON.stringify({ error: 'Failed to create payment session' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
