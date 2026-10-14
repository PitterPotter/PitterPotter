import { createClient } from 'supabase';
import { buildVoucherPDF } from '../_shared/gift-voucher-pdf.ts';
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
  return await buildVoucherPDF(giftCard);
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
      if (!isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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

      // Send email if recipient email is provided and not a physical card
      if (!isPhysical && recipientEmail) {
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
        await createNotification(supabase, {
          type: 'gift_card_redeemed',
          title: 'Activity Voucher Redeemed',
          message: `${card.code} (${card.covers}) marked as used by ${staff.name}`,
          entityType: 'gift_card',
          entityId: card.id,
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

      // Create admin notification for gift card redemption
      await createNotification(supabase, {
        type: 'gift_card_redeemed',
        title: 'Gift Card Redeemed',
        message: `${card.code} redeemed for £${discount} by ${staff.name} (balance: £${newBalance})`,
        entityType: 'gift_card',
        entityId: card.id,
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
