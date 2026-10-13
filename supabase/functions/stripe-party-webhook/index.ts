import Stripe from 'stripe';
import { createClient } from 'supabase';
import { allocateAndApply, persistAllocation } from '../_shared/allocation.ts';
import { createNotification } from '../_shared/notifications.ts';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PP-';
  for (let i = 0; i < 10; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing signature' }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: modeSetting } = await supabase.from('settings').select('value').eq('key', 'stripe_mode').single();
  const isLive = modeSetting?.value === 'live';
  const secretKey = isLive ? Deno.env.get('STRIPE_SECRET_KEY_LIVE') : Deno.env.get('STRIPE_SECRET_KEY_SANDBOX');
  const webhookSecret = isLive ? Deno.env.get('STRIPE_WEBHOOK_SECRET_LIVE') : Deno.env.get('STRIPE_WEBHOOK_SECRET_SANDBOX');

  if (!secretKey || !webhookSecret) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), { status: 500 });
  }

  const stripe = new Stripe(secretKey);

  try {
    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const obj = event.data.object as any;
      const metadata = obj.metadata || {};
      const type = metadata.type;

      if (type === 'party_deposit') {
        const bookingId = metadata.bookingId;
        const depositAmount = Number(metadata.amount) || (obj.amount_total ? obj.amount_total / 100 : 50);
        // For checkout sessions, obj.id is the session id — store the payment
        // intent id instead so it links to the charge in Stripe.
        const paymentRef = obj.payment_intent || obj.id;
        const paidAt = new Date().toISOString();
        if (bookingId) {
          // Check if this deposit is for an existing booking (admin-created
          // booking where staff emailed a deposit payment link).
          const { data: existingBooking } = await supabase
            .from('bookings')
            .select('id, management_token, stripe_payment_intent_id')
            .eq('booking_id', bookingId)
            .maybeSingle();

          if (existingBooking) {
            if (existingBooking.stripe_payment_intent_id === paymentRef) {
              console.log('Deposit already recorded for booking:', bookingId);
            } else {
              const { error: updateError } = await supabase.from('bookings').update({
                deposit_amount: depositAmount,
                payment_status: 'paid',
                stripe_payment_intent_id: paymentRef,
                deposit_paid_at: paidAt,
              }).eq('booking_id', bookingId);
              if (updateError) throw updateError;

              // Deposit received — send the booking confirmation email.
              try {
                await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bookingId, managementToken: existingBooking.management_token }),
                });
              } catch (emailErr) {
                console.error('Failed to send confirmation email after deposit:', emailErr);
              }
            }
          } else {
            // Online booking — create the booking now that deposit is paid.
            const managementToken = crypto.randomUUID();

            const { data: insertedBooking, error: insertError } = await supabase.from('bookings').insert({
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
              stripe_payment_intent_id: paymentRef,
              deposit_paid_at: paidAt,
              management_token: managementToken,
            }).select('id').single();

            if (insertError) {
              if (insertError.code === '23505') {
                console.log('Booking already exists for paymentIntent:', obj.id);
              } else {
                // A paid deposit with no booking must never be silent — alert
                // staff before letting the error bubble to Stripe retries.
                console.error('Paid party deposit failed to create booking:', insertError);
                try {
                  await createNotification(supabase, {
                    type: 'booking_failed',
                    title: 'PAID deposit — booking NOT created',
                    message: `${metadata.name || 'Customer'} paid a £${depositAmount} deposit for ${metadata.studio || '?'} on ${metadata.date || '?'} at ${metadata.time || '?'}, but the booking could not be created (${insertError.message || insertError.code || 'unknown error'}). Payment ${obj.id} — check Stripe and add the booking manually.`,
                    entityType: 'booking',
                    entityId: bookingId,
                    studio: metadata.studio,
                  });
                } catch (notifyErr) {
                  console.error('Failed to create failure notification:', notifyErr);
                }
                throw insertError;
              }
            } else {
              // Wimbledon: allocate the physical party-area/tables this booking occupies.
              // Payment is already taken, so allocation failure must not fail the webhook — warn only.
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

              // Send confirmation email
              try {
                await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bookingId, managementToken }),
                });
              } catch (emailErr) {
                console.error('Failed to send confirmation email after deposit:', emailErr);
              }
            }
          }
        }
      } else if (type === 'party_final_balance') {
        // Final balance paid — update booking with final seats and mark as paid
        const bookingId = metadata.bookingId;
        if (bookingId) {
          const updateData: any = {
            payment_status: 'paid',
            final_paid_at: new Date().toISOString(),
          };
          if (metadata.finalSeats) {
            updateData.final_seats = Number(metadata.finalSeats);
          }
          if (metadata.finalBalance) {
            updateData.final_balance = Number(metadata.finalBalance);
          }
          const { error: updateError } = await supabase.from('bookings').update(updateData).eq('booking_id', bookingId);
          if (updateError) throw updateError;
        }
      } else if (type === 'gift_card') {
        // Create gift card if not already created (idempotent)
        const paymentIntentId = obj.id;
        const { data: existing } = await supabase
          .from('gift_cards')
          .select('id')
          .eq('stripe_session_id', paymentIntentId)
          .maybeSingle();

        if (!existing) {
          const amount = Number(metadata.amount) || (obj.amount / 100);
          const code = generateCode();
          const purchaseDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          const expiryDate = new Date();
          expiryDate.setFullYear(expiryDate.getFullYear() + 1);

          const { error: insertError } = await supabase.from('gift_cards').insert({
            code,
            amount,
            balance: amount,
            recipient_name: metadata.recipientName || '',
            recipient_email: metadata.recipientEmail || '',
            sender_name: metadata.senderName || '',
            sender_email: metadata.senderEmail || '',
            message: metadata.message || '',
            status: 'active',
            purchase_date: purchaseDate,
            expiry_date: expiryDate.toISOString(),
            stripe_session_id: paymentIntentId,
          });
          if (insertError) {
            // Race condition: confirm-gift-card-payment may have already created the card
            if (insertError.code === '23505') {
              console.log('Gift card already exists for paymentIntent:', paymentIntentId);
            } else {
              throw insertError;
            }
          }

          // Send gift card emails (recipient gets voucher PDF, sender gets confirmation)
          try {
            const { data: giftCard } = await supabase.from('gift_cards').select('id').eq('stripe_session_id', paymentIntentId).single();
            if (giftCard) {
              await fetch(`${supabaseUrl}/functions/v1/send-gift-card-email`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({ giftCardId: giftCard.id }),
              });
            }
          } catch (emailErr) {
            console.error('Failed to send gift card email:', emailErr);
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    return new Response(JSON.stringify({ error: 'Webhook verification failed' }), { status: 400 });
  }
});
