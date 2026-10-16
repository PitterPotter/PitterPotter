import { createClient } from 'supabase';
import { isObject, isNonEmptyString, isNumber, isBoolean } from '../_shared/validate.ts';
import { logAudit } from '../_shared/audit.ts';
import { verifyStaff } from '../_shared/auth.ts';
import { corsHeaders as makeCorsHeaders, optionsResponse } from '../_shared/cors.ts';
import { createNotification } from '../_shared/notifications.ts';
import {
  computeTotals, toPence, toPounds, vatRateFor, isVatTreatment,
  formatOrderNumber, type VatTreatment,
} from '../_shared/eposMoney.ts';
import { createCardPayment, checkDojoPaymentStatus, createDojoRefund, cardProvider } from '../_shared/eposPayments.ts';
import type { AdminSupabaseClient, StaffRecord } from '../_shared/types.ts';

const STUDIO_DETAILS: Record<string, { address: string; phone: string }> = {
  Putney: { address: '234 Upper Richmond Road, SW15 6TG', phone: '020 8788 1635' },
  Wimbledon: { address: '52 Wimbledon Hill Road, SW19 7PA', phone: '020 3770 4499' },
};

type StaffWithEpos = StaffRecord & {
  can_epos_refunds?: boolean;
  can_epos_discounts?: boolean;
  can_epos_manage_products?: boolean;
  allowed_studios?: string[] | null;
};

const canManageProducts = (s: StaffWithEpos) => s.role === 'super_admin' || !!s.can_epos_manage_products;
const canDiscount = (s: StaffWithEpos) => s.role === 'super_admin' || !!s.can_epos_discounts;
const canRefund = (s: StaffWithEpos) => s.role === 'super_admin' || !!s.can_epos_refunds;
const canAccessStudio = (s: StaffWithEpos, studio: string) =>
  s.role === 'super_admin' || !s.allowed_studios || s.allowed_studios.length === 0 || s.allowed_studios.includes(studio);

function json(data: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const err = (msg: string, corsHeaders: Record<string, string>, status = 400) => json({ error: msg }, corsHeaders, status);

async function nextOrderNumber(supabase: AdminSupabaseClient): Promise<string> {
  const { data, error } = await supabase.rpc('nextval_epos_order_seq' as never);
  if (error || typeof data !== 'number') throw error || new Error('order sequence failed');
  return formatOrderNumber(data as number);
}

/** Recompute order totals from items + payments and update status. */
async function recalcOrder(supabase: AdminSupabaseClient, orderId: string) {
  const { data: order, error: oErr } = await supabase.from('epos_orders').select('*').eq('id', orderId).single();
  if (oErr || !order) throw oErr || new Error('Order not found');
  const { data: items } = await supabase.from('epos_order_items').select('*').eq('order_id', orderId);
  const { data: payments } = await supabase.from('epos_payments').select('*').eq('order_id', orderId);

  const discountPence = toPence(Number(order.discount_total));
  const totals = computeTotals(items || [], discountPence);

  const paidPence = (payments || [])
    .filter((p) => p.status === 'completed' || p.status === 'partially_refunded')
    .reduce((sum, p) => sum + toPence(Number(p.amount) - Number(p.refunded_amount || 0)), 0);

  let status = order.status;
  if (status !== 'void') {
    if (paidPence <= 0) status = 'open';
    else if (paidPence < toPence(totals.total)) status = 'partial';
    else status = 'paid';
  }

  await supabase.from('epos_orders').update({
    subtotal: totals.subtotal,
    vat_total: totals.vatAfterDiscount,
    total: totals.total,
    paid_total: toPounds(paidPence),
    status,
    closed_at: status === 'paid' ? (order.closed_at || new Date().toISOString()) : null,
  }).eq('id', orderId);

  return { ...order, subtotal: totals.subtotal, vat_total: totals.vatAfterDiscount, total: totals.total, paid_total: toPounds(paidPence), status };
}

async function loadOrderFull(supabase: AdminSupabaseClient, orderId: string) {
  const { data: order, error } = await supabase.from('epos_orders').select('*').eq('id', orderId).single();
  if (error || !order) return null;
  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from('epos_order_items').select('*').eq('order_id', orderId).order('created_at'),
    supabase.from('epos_payments').select('*').eq('order_id', orderId).order('created_at'),
  ]);
  return { order, items: items || [], payments: payments || [] };
}

/** Atomic voucher deduction — guarded update prevents double-spend. */
async function redeemVoucher(
  supabase: AdminSupabaseClient, code: string, amountPence: number,
): Promise<{ discount: number; giftCardId: string; code: string } | { error: string }> {
  const { data: card } = await supabase.from('gift_cards').select('*').eq('code', code.trim()).single();
  if (!card) return { error: 'Gift card not found' };
  if (card.status !== 'active') return { error: `Gift card is ${card.status}` };
  if (card.expiry_date && new Date(card.expiry_date) < new Date()) {
    await supabase.from('gift_cards').update({ status: 'expired' }).eq('id', card.id);
    return { error: 'Gift card has expired' };
  }
  if (card.covers) return { error: 'Activity vouchers cannot be used as payment — redeem them on the booking instead' };

  const currentPence = toPence(Number(card.balance));
  if (currentPence <= 0) return { error: 'Gift card has no balance' };
  const discount = Math.min(currentPence, amountPence);
  const newBalancePence = currentPence - discount;

  // Conditional update: only succeeds if balance is unchanged since read.
  const { data: updated, error: updErr } = await supabase.from('gift_cards').update({
    balance: toPounds(newBalancePence),
    status: newBalancePence <= 0 ? 'redeemed' : 'active',
  }).eq('id', card.id).eq('balance', card.balance).select('id');

  if (updErr || !updated || updated.length === 0) {
    // Concurrent update — retry once.
    const { data: card2 } = await supabase.from('gift_cards').select('*').eq('id', card.id).single();
    if (!card2 || card2.status !== 'active') return { error: 'Gift card balance changed — please try again' };
    const cur2 = toPence(Number(card2.balance));
    if (cur2 <= 0) return { error: 'Gift card has no balance' };
    const disc2 = Math.min(cur2, amountPence);
    const { data: upd2, error: e2 } = await supabase.from('gift_cards').update({
      balance: toPounds(cur2 - disc2),
      status: cur2 - disc2 <= 0 ? 'redeemed' : 'active',
    }).eq('id', card2.id).eq('balance', card2.balance).select('id');
    if (e2 || !upd2 || upd2.length === 0) return { error: 'Gift card balance changed — please try again' };
    return { discount: disc2, giftCardId: card2.id, code: card2.code };
  }

  return { discount, giftCardId: card.id, code: card.code };
}

function buildReceiptHtml(order: Record<string, unknown>, items: unknown[], payments: unknown[], vatNumber: string): string {
  const studio = String(order.studio);
  const sd = STUDIO_DETAILS[studio] || { address: '', phone: '' };
  const rows = (items as Record<string, unknown>[]).map((i) =>
    `<tr><td style="padding:4px 8px">${i.name} ×${i.quantity}</td><td style="padding:4px 8px;text-align:right">£${Number(i.line_total).toFixed(2)}</td></tr>`,
  ).join('');
  const payRows = (payments as Record<string, unknown>[])
    .filter((p) => p.status === 'completed' || p.status === 'partially_refunded')
    .map((p) => `<tr><td style="padding:2px 8px">${String(p.method).toUpperCase()}${p.reference ? ` (${p.reference})` : ''}</td><td style="padding:2px 8px;text-align:right">£${Number(p.amount).toFixed(2)}</td></tr>`).join('');
  const discount = Number(order.discount_total) > 0
    ? `<tr><td style="padding:4px 8px">Discount${order.discount_label ? ` (${order.discount_label})` : ''}</td><td style="padding:4px 8px;text-align:right">-£${Number(order.discount_total).toFixed(2)}</td></tr>` : '';
  return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;max-width:360px;margin:auto;color:#1B2D3C">
<div style="text-align:center;border-bottom:2px solid #1B2D3C;padding-bottom:12px">
  <h1 style="margin:0;font-size:22px">Pitter Potter</h1>
  <p style="margin:4px 0;font-size:12px">Pottery Painting Studio — ${studio}</p>
  <p style="margin:0;font-size:11px;color:#666">${sd.address} · ${sd.phone}</p>
  ${vatNumber ? `<p style="margin:0;font-size:11px;color:#666">VAT No: ${vatNumber}</p>` : ''}
</div>
<p style="font-size:12px;margin:10px 0">${order.order_number} · ${new Date(String(order.created_at)).toLocaleString('en-GB')}${order.table_id ? ` · Table ${order.table_id}` : ''}${order.customer_name ? ` · ${order.customer_name}` : ''}</p>
<table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
<table style="width:100%;border-collapse:collapse;font-size:13px;border-top:1px solid #ccc;margin-top:6px">
  ${discount}
  <tr><td style="padding:6px 8px;font-weight:bold;font-size:16px">TOTAL</td><td style="padding:6px 8px;text-align:right;font-weight:bold;font-size:16px">£${Number(order.total).toFixed(2)}</td></tr>
  <tr><td style="padding:2px 8px;color:#666">of which VAT</td><td style="padding:2px 8px;text-align:right;color:#666">£${Number(order.vat_total).toFixed(2)}</td></tr>
</table>
<table style="width:100%;border-collapse:collapse;font-size:12px;border-top:1px dashed #ccc;margin-top:6px">${payRows}</table>
<p style="text-align:center;font-size:11px;color:#888;margin-top:16px">Served by ${order.staff_name || 'Staff'} · www.pitterpotter.co.uk</p>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse(req, true);
  const corsHeaders = makeCorsHeaders(req, true);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    return err('Supabase not configured', corsHeaders, 500);
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    if (!isObject(body)) return err('Invalid request body', corsHeaders);
    const { action, username, sessionToken } = body;
    if (!isNonEmptyString(action) || !isNonEmptyString(username) || !isNonEmptyString(sessionToken)) {
      return err('Missing action, username, or sessionToken', corsHeaders);
    }

    const staff = await verifyStaff(supabase, username, sessionToken) as StaffWithEpos | null;
    if (!staff) return err('Unauthorized', corsHeaders, 401);

    const studioOk = async (orderId: string): Promise<Record<string, unknown> | null> => {
      const { data } = await supabase.from('epos_orders').select('studio').eq('id', orderId).single();
      return data && canAccessStudio(staff, data.studio) ? data : null;
    };

    // ---------- Reads: till data ----------
    if (action === 'bootstrap') {
      const { studio } = body;
      if (!isNonEmptyString(studio) || !canAccessStudio(staff, studio)) return err('Invalid or inaccessible studio', corsHeaders, 403);
      const [{ data: categories }, { data: products }, { data: discounts }] = await Promise.all([
        supabase.from('epos_categories').select('*').eq('active', true).order('sort_order'),
        supabase.from('epos_products').select('*').eq('active', true).contains('studios', [studio]).order('sort_order'),
        supabase.from('epos_discounts').select('*').eq('active', true).order('sort_order'),
      ]);
      return json({ categories: categories || [], products: products || [], discounts: discounts || [], cardProvider: cardProvider() }, corsHeaders);
    }

    if (action === 'listTables') {
      const { studio } = body;
      if (!isNonEmptyString(studio) || !canAccessStudio(staff, studio)) return err('Invalid or inaccessible studio', corsHeaders, 403);
      const { data, error } = await supabase.from('studio_tables').select('table_id,label,area,max_capacity').eq('studio', studio).eq('active', true).order('sort_order');
      if (error) throw error;
      return json({ tables: data || [] }, corsHeaders);
    }

    if (action === 'openOrders') {
      const { studio, tableId } = body;
      if (!isNonEmptyString(studio) || !canAccessStudio(staff, studio)) return err('Invalid or inaccessible studio', corsHeaders, 403);
      let q = supabase.from('epos_orders').select('*').eq('studio', studio).in('status', ['open', 'partial']).order('created_at', { ascending: false });
      if (isNonEmptyString(tableId)) q = q.eq('table_id', tableId);
      const { data, error } = await q;
      if (error) throw error;
      return json({ orders: data || [] }, corsHeaders);
    }

    if (action === 'getOrder') {
      const { orderId } = body;
      if (!isNonEmptyString(orderId)) return err('Missing orderId', corsHeaders);
      if (!(await studioOk(orderId))) return err('Order not found or access denied', corsHeaders, 404);
      const full = await loadOrderFull(supabase, orderId);
      if (!full) return err('Order not found', corsHeaders, 404);
      return json(full, corsHeaders);
    }

    // ---------- Orders ----------
    if (action === 'createOrder') {
      const { studio, tableId, bookingId, customerName, label } = body;
      if (!isNonEmptyString(studio)) return err('Missing studio', corsHeaders);
      if (!canAccessStudio(staff, studio)) return err('No access to this studio', corsHeaders, 403);

      let bookingName: string | null = null;
      if (isNonEmptyString(bookingId)) {
        const { data: b } = await supabase.from('bookings').select('booking_id,name,studio').eq('booking_id', bookingId).single();
        if (!b) return err('Booking not found', corsHeaders, 404);
        if (b.studio !== studio) return err('Booking belongs to a different studio', corsHeaders);
        bookingName = b.name;
      }

      const orderNumber = await nextOrderNumber(supabase);
      const { data: order, error } = await supabase.from('epos_orders').insert({
        order_number: orderNumber,
        studio,
        table_id: isNonEmptyString(tableId) ? tableId : null,
        booking_id: isNonEmptyString(bookingId) ? bookingId : null,
        customer_name: isNonEmptyString(customerName) ? customerName : bookingName,
        label: typeof label === 'string' ? label.slice(0, 60) : null,
        staff_id: staff.id,
        staff_name: staff.name,
      }).select().single();
      if (error) throw error;
      await logAudit(supabase, staff, 'create', 'epos_order', order.id, { order_number: orderNumber, studio, tableId, bookingId });
      return json({ order }, corsHeaders);
    }

    if (action === 'addItem') {
      const { orderId, productId, quantity, customName, customPrice, customVatTreatment } = body;
      if (!isNonEmptyString(orderId)) return err('Missing orderId', corsHeaders);
      const order = await studioOk(orderId);
      if (!order) return err('Order not found or access denied', corsHeaders, 404);
      const qty = isNumber(quantity) && quantity > 0 ? Math.floor(quantity) : 1;

      const { data: ord } = await supabase.from('epos_orders').select('status').eq('id', orderId).single();
      if (!ord || ord.status === 'paid' || ord.status === 'void') return err('Order is closed', corsHeaders);

      let itemRow;
      if (isNonEmptyString(productId)) {
        const { data: product } = await supabase.from('epos_products').select('*').eq('id', productId).single();
        if (!product || !product.active) return err('Product not found', corsHeaders, 404);
        if (!product.studios.includes(order.studio)) return err('Product not available at this studio', corsHeaders);
        // Merge with an existing line for the same product.
        const { data: existing } = await supabase.from('epos_order_items').select('*')
          .eq('order_id', orderId).eq('product_id', productId).eq('unit_price', product.price).maybeSingle();
        if (existing) {
          const newQty = existing.quantity + qty;
          const { data: upd, error: uErr } = await supabase.from('epos_order_items').update({
            quantity: newQty, line_total: toPounds(toPence(product.price * newQty)),
          }).eq('id', existing.id).select().single();
          if (uErr) throw uErr;
          itemRow = upd;
        } else {
          const { data: ins, error: iErr } = await supabase.from('epos_order_items').insert({
            order_id: orderId, product_id: product.id, name: product.name,
            unit_price: product.price, quantity: qty,
            vat_treatment: product.vat_treatment, vat_rate: product.vat_rate,
            line_total: toPounds(toPence(product.price * qty)),
          }).select().single();
          if (iErr) throw iErr;
          itemRow = ins;
        }
      } else {
        // Custom/ad-hoc line — needs a name and price.
        if (!isNonEmptyString(customName) || !isNumber(customPrice) || customPrice < 0) {
          return err('Custom items need a name and price', corsHeaders);
        }
        const treatment = isVatTreatment(customVatTreatment) ? customVatTreatment : 'standard';
        const { data: ins, error: iErr } = await supabase.from('epos_order_items').insert({
          order_id: orderId, product_id: null, name: customName.slice(0, 120),
          unit_price: customPrice, quantity: qty,
          vat_treatment: treatment, vat_rate: vatRateFor(treatment),
          line_total: toPounds(toPence(customPrice * qty)),
        }).select().single();
        if (iErr) throw iErr;
        itemRow = ins;
      }

      const updated = await recalcOrder(supabase, orderId);
      return json({ item: itemRow, order: updated }, corsHeaders);
    }

    if (action === 'updateItemQty' || action === 'removeItem') {
      const { itemId, quantity } = body;
      if (!isNonEmptyString(itemId)) return err('Missing itemId', corsHeaders);
      const { data: item } = await supabase.from('epos_order_items').select('order_id, unit_price').eq('id', itemId).single();
      if (!item) return err('Item not found', corsHeaders, 404);
      if (!(await studioOk(item.order_id))) return err('Access denied', corsHeaders, 403);
      const { data: ord } = await supabase.from('epos_orders').select('status').eq('id', item.order_id).single();
      if (!ord || ord.status === 'paid' || ord.status === 'void') return err('Order is closed', corsHeaders);

      if (action === 'removeItem' || !isNumber(quantity) || quantity <= 0) {
        const { error } = await supabase.from('epos_order_items').delete().eq('id', itemId);
        if (error) throw error;
      } else {
        const qty = Math.floor(quantity);
        const { error } = await supabase.from('epos_order_items').update({
          quantity: qty, line_total: toPounds(toPence(Number(item.unit_price) * qty)),
        }).eq('id', itemId);
        if (error) throw error;
      }
      const updated = await recalcOrder(supabase, item.order_id);
      return json({ order: updated }, corsHeaders);
    }

    if (action === 'applyDiscount') {
      if (!canDiscount(staff)) return err('Forbidden — discount permission required', corsHeaders, 403);
      const { orderId, kind, value, label, discountId } = body;
      if (!isNonEmptyString(orderId)) return err('Missing orderId', corsHeaders);
      if (!(await studioOk(orderId))) return err('Access denied', corsHeaders, 403);

      let discountPence = 0;
      let discountLabel = typeof label === 'string' ? label.slice(0, 80) : 'Discount';

      if (isNonEmptyString(discountId)) {
        const { data: d } = await supabase.from('epos_discounts').select('*').eq('id', discountId).eq('active', true).single();
        if (!d) return err('Discount not found', corsHeaders, 404);
        const { data: ord } = await supabase.from('epos_orders').select('subtotal').eq('id', orderId).single();
        discountPence = d.kind === 'percent' ? Math.round(toPence(Number(ord?.subtotal || 0)) * Number(d.value) / 100) : toPence(Number(d.value));
        discountLabel = d.name;
      } else if (kind === 'percent' && isNumber(value) && value > 0 && value <= 100) {
        const { data: ord } = await supabase.from('epos_orders').select('subtotal').eq('id', orderId).single();
        discountPence = Math.round(toPence(Number(ord?.subtotal || 0)) * value / 100);
      } else if (kind === 'fixed' && isNumber(value) && value > 0) {
        discountPence = toPence(value);
      } else {
        return err('Invalid discount', corsHeaders);
      }

      const { error } = await supabase.from('epos_orders').update({
        discount_total: toPounds(discountPence), discount_label: discountLabel,
      }).eq('id', orderId);
      if (error) throw error;
      const updated = await recalcOrder(supabase, orderId);
      await logAudit(supabase, staff, 'discount', 'epos_order', orderId, { label: discountLabel, amount: toPounds(discountPence) });
      return json({ order: updated }, corsHeaders);
    }

    if (action === 'removeDiscount') {
      if (!canDiscount(staff)) return err('Forbidden — discount permission required', corsHeaders, 403);
      const { orderId } = body;
      if (!isNonEmptyString(orderId)) return err('Missing orderId', corsHeaders);
      if (!(await studioOk(orderId))) return err('Access denied', corsHeaders, 403);
      const { error } = await supabase.from('epos_orders').update({ discount_total: 0, discount_label: null }).eq('id', orderId);
      if (error) throw error;
      const updated = await recalcOrder(supabase, orderId);
      await logAudit(supabase, staff, 'remove_discount', 'epos_order', orderId, {});
      return json({ order: updated }, corsHeaders);
    }

    if (action === 'linkBooking' || action === 'linkTable' || action === 'renameOrder') {
      const { orderId, bookingId, tableId, label, customerName } = body;
      if (!isNonEmptyString(orderId)) return err('Missing orderId', corsHeaders);
      if (!(await studioOk(orderId))) return err('Access denied', corsHeaders, 403);
      const upd: Record<string, unknown> = {};
      if (isNonEmptyString(bookingId)) {
        const { data: b } = await supabase.from('bookings').select('name,studio').eq('booking_id', bookingId).single();
        if (!b) return err('Booking not found', corsHeaders, 404);
        upd.booking_id = bookingId;
        upd.customer_name = b.name;
      }
      if (action === 'linkTable') upd.table_id = isNonEmptyString(tableId) ? tableId : null;
      if (action === 'renameOrder') {
        upd.label = typeof label === 'string' ? label.slice(0, 60) : null;
        if (isNonEmptyString(customerName)) upd.customer_name = customerName.slice(0, 120);
      }
      const { error } = await supabase.from('epos_orders').update(upd).eq('id', orderId);
      if (error) throw error;
      return json({ success: true }, corsHeaders);
    }

    // ---------- Payments ----------
    if (action === 'pay') {
      const { orderId, method, amount, tendered, voucherCode, idempotencyKey } = body;
      if (!isNonEmptyString(orderId) || !isNonEmptyString(method)) return err('Missing orderId or method', corsHeaders);
      if (!['cash', 'card', 'voucher', 'other'].includes(method)) return err('Invalid payment method', corsHeaders);
      if (!isNumber(amount) || amount <= 0) return err('Invalid amount', corsHeaders);
      if (!isNonEmptyString(idempotencyKey)) return err('Missing idempotency key', corsHeaders);
      if (!(await studioOk(orderId))) return err('Access denied', corsHeaders, 403);

      // Idempotency: a retried submission returns the original payment.
      const { data: existing } = await supabase.from('epos_payments').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
      if (existing) {
        const updated = await recalcOrder(supabase, orderId);
        return json({ payment: existing, order: updated, duplicate: true }, corsHeaders);
      }

      const { data: ord } = await supabase.from('epos_orders').select('*').eq('id', orderId).single();
      if (!ord || ord.status === 'paid' || ord.status === 'void') return err('Order is not payable', corsHeaders);

      // A pending terminal payment blocks further payment attempts —
      // prevents double-charging while the customer is on the card machine.
      const { data: pending } = await supabase.from('epos_payments').select('id')
        .eq('order_id', orderId).eq('status', 'pending').limit(1);
      if (pending && pending.length > 0) {
        return err('A card payment is in progress on the terminal — wait or check its status first', corsHeaders, 409);
      }

      const outstandingPence = toPence(Number(ord.total)) - toPence(Number(ord.paid_total));
      const amountPence = toPence(amount);

      let payAmountPence = amountPence;
      let provider = 'manual';
      let reference: string | null = null;
      let giftCardId: string | null = null;
      let changeGiven: number | null = null;
      let payStatus = 'completed';

      if (method === 'cash') {
        if (isNumber(tendered) && tendered >= amount) {
          changeGiven = toPounds(toPence(tendered) - amountPence);
        }
        if (amountPence > outstandingPence) return err('Cash amount exceeds outstanding balance', corsHeaders);
      } else if (method === 'voucher') {
        if (!isNonEmptyString(voucherCode)) return err('Voucher code required', corsHeaders);
        const res = await redeemVoucher(supabase, voucherCode, amountPence);
        if ('error' in res) return err(res.error, corsHeaders);
        payAmountPence = res.discount;
        giftCardId = res.giftCardId;
        reference = res.code;
      } else if (method === 'card') {
        if (amountPence > outstandingPence) return err('Amount exceeds outstanding balance', corsHeaders);
        const result = await createCardPayment(amountPence, ord.order_number, ord.studio);
        if (result.status === 'failed') return err(result.detail || 'Card payment failed', corsHeaders, 402);
        provider = result.provider;
        reference = result.reference;
        payStatus = result.status; // 'completed' (mock) or 'pending' (dojo terminal)
      } else {
        if (amountPence > outstandingPence) return err('Amount exceeds outstanding balance', corsHeaders);
      }

      const { data: payment, error: pErr } = await supabase.from('epos_payments').insert({
        order_id: orderId,
        method,
        provider,
        amount: toPounds(payAmountPence),
        status: payStatus,
        reference,
        gift_card_id: giftCardId,
        change_given: changeGiven,
        idempotency_key: idempotencyKey,
        staff_id: staff.id,
        staff_name: staff.name,
      }).select().single();

      if (pErr) {
        // Unique-violation on idempotency_key → concurrent duplicate; fetch it.
        if (String(pErr.message).includes('idempotency') || String(pErr.code) === '23505') {
          const { data: dup } = await supabase.from('epos_payments').select('*').eq('idempotency_key', idempotencyKey).single();
          const updated = await recalcOrder(supabase, orderId);
          return json({ payment: dup, order: updated, duplicate: true }, corsHeaders);
        }
        throw pErr;
      }

      const updated = await recalcOrder(supabase, orderId);
      await logAudit(supabase, staff, 'payment', 'epos_order', orderId, {
        method, amount: toPounds(payAmountPence), provider, reference,
        order_number: ord.order_number,
      });
      return json({ payment, order: updated }, corsHeaders);
    }

    if (action === 'checkPayment') {
      const { paymentId } = body;
      if (!isNonEmptyString(paymentId)) return err('Missing paymentId', corsHeaders);
      const { data: p } = await supabase.from('epos_payments').select('*').eq('id', paymentId).single();
      if (!p) return err('Payment not found', corsHeaders, 404);
      if (!(await studioOk(p.order_id))) return err('Access denied', corsHeaders, 403);
      if (p.status !== 'pending' || p.provider !== 'dojo') return json({ payment: p }, corsHeaders);
      const apiKey = Deno.env.get('DOJO_API_KEY');
      if (!apiKey || !p.reference) return json({ payment: p }, corsHeaders);
      const intentId = String(p.reference).split('|')[0];
      const status = await checkDojoPaymentStatus(apiKey, intentId);
      if (status !== 'pending') {
        await supabase.from('epos_payments').update({ status }).eq('id', p.id);
        p.status = status;
        await recalcOrder(supabase, p.order_id);
      }
      return json({ payment: p }, corsHeaders);
    }

    if (action === 'voidOrder') {
      const { orderId, reason } = body;
      if (!isNonEmptyString(orderId)) return err('Missing orderId', corsHeaders);
      if (!(await studioOk(orderId))) return err('Access denied', corsHeaders, 403);
      const { data: payments } = await supabase.from('epos_payments').select('id').eq('order_id', orderId).in('status', ['completed', 'partially_refunded']);
      if (payments && payments.length > 0) return err('Order has payments — refund them instead', corsHeaders);
      const { error } = await supabase.from('epos_orders').update({ status: 'void', notes: typeof reason === 'string' ? reason.slice(0, 200) : null }).eq('id', orderId);
      if (error) throw error;
      await logAudit(supabase, staff, 'void', 'epos_order', orderId, { reason });
      return json({ success: true }, corsHeaders);
    }

    if (action === 'refundPayment') {
      if (!canRefund(staff)) return err('Forbidden — refund permission required', corsHeaders, 403);
      const { paymentId, amount } = body;
      if (!isNonEmptyString(paymentId)) return err('Missing paymentId', corsHeaders);
      const { data: p } = await supabase.from('epos_payments').select('*').eq('id', paymentId).single();
      if (!p) return err('Payment not found', corsHeaders, 404);
      if (!(await studioOk(p.order_id))) return err('Access denied', corsHeaders, 403);
      if (p.status !== 'completed' && p.status !== 'partially_refunded') return err('Payment cannot be refunded', corsHeaders);

      const refundablePence = toPence(Number(p.amount) - Number(p.refunded_amount));
      const refundPence = isNumber(amount) && amount > 0 ? Math.min(toPence(amount), refundablePence) : refundablePence;
      if (refundPence <= 0) return err('Nothing left to refund', corsHeaders);

      // Dojo card refunds go back onto the terminal as a matched refund
      // (card present). The full amount is refunded — Dojo matched refunds
      // don't take a partial amount; for partial card refunds staff should
      // use cash/other instead.
      if (p.method === 'card' && p.provider === 'dojo') {
        if (refundPence !== toPence(Number(p.amount))) return err('Dojo terminal refunds are full-amount only', corsHeaders);
        const intentId = String(p.reference || '').split('|')[0];
        if (!intentId) return err('No Dojo payment intent on this payment', corsHeaders);
        const { data: ord } = await supabase.from('epos_orders').select('studio').eq('id', p.order_id).single();
        const res = await createDojoRefund(intentId, ord?.studio);
        if (res.status === 'failed') return err(res.detail || 'Dojo refund failed', corsHeaders, 502);
      }

      // Voucher refunds restore card balance.
      if (p.method === 'voucher' && p.gift_card_id) {
        const { data: card } = await supabase.from('gift_cards').select('balance,status').eq('id', p.gift_card_id).single();
        if (card) {
          await supabase.from('gift_cards').update({
            balance: toPounds(toPence(Number(card.balance)) + refundPence),
            status: 'active',
          }).eq('id', p.gift_card_id);
        }
      }

      const newRefunded = toPence(Number(p.refunded_amount)) + refundPence;
      const newStatus = newRefunded >= toPence(Number(p.amount)) ? 'refunded' : 'partially_refunded';
      const { error } = await supabase.from('epos_payments').update({
        refunded_amount: toPounds(newRefunded), status: newStatus, refunded_at: new Date().toISOString(),
      }).eq('id', p.id);
      if (error) throw error;

      const updated = await recalcOrder(supabase, p.order_id);
      await logAudit(supabase, staff, 'refund', 'epos_payment', p.id, {
        order_id: p.order_id, amount: toPounds(refundPence), method: p.method,
      });
      await createNotification(supabase, {
        type: 'epos_refund',
        title: 'EPOS Refund',
        message: `£${toPounds(refundPence).toFixed(2)} ${p.method} refund on ${updated.order_number} by ${staff.name}`,
        entityType: 'epos_order',
        entityId: p.order_id,
      });
      return json({ success: true, refunded: toPounds(refundPence), order: updated }, corsHeaders);
    }

    // ---------- Product / category / discount management ----------
    if (action === 'listProductsAdmin') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const [{ data: categories }, { data: products }, { data: discounts }] = await Promise.all([
        supabase.from('epos_categories').select('*').order('sort_order'),
        supabase.from('epos_products').select('*').order('sort_order'),
        supabase.from('epos_discounts').select('*').order('sort_order'),
      ]);
      return json({ categories: categories || [], products: products || [], discounts: discounts || [] }, corsHeaders);
    }

    if (action === 'saveProduct') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const { product } = body;
      if (!isObject(product) || !isNonEmptyString(product.name) || !isNumber(product.price) || product.price < 0) {
        return err('Invalid product', corsHeaders);
      }
      const treatment = isVatTreatment(product.vatTreatment) ? product.vatTreatment : 'standard';
      const studios = Array.isArray(product.studios) && product.studios.every((s: unknown) => s === 'Putney' || s === 'Wimbledon') && product.studios.length > 0
        ? product.studios : ['Putney', 'Wimbledon'];
      const row = {
        name: product.name.slice(0, 120),
        sku: typeof product.sku === 'string' ? product.sku.slice(0, 40) : null,
        category_id: isNonEmptyString(product.categoryId) ? product.categoryId : null,
        price: product.price,
        vat_treatment: treatment,
        vat_rate: isNumber(product.vatRate) ? product.vatRate : vatRateFor(treatment),
        image_url: typeof product.imageUrl === 'string' ? product.imageUrl.slice(0, 500) : null,
        studios,
        active: isBoolean(product.active) ? product.active : true,
        sort_order: isNumber(product.sortOrder) ? Math.floor(product.sortOrder) : 0,
        updated_at: new Date().toISOString(),
      };
      if (isNonEmptyString(product.id)) {
        const { data, error } = await supabase.from('epos_products').update(row).eq('id', product.id).select().single();
        if (error) throw error;
        await logAudit(supabase, staff, 'update', 'epos_product', product.id, { name: row.name });
        return json({ product: data }, corsHeaders);
      }
      const { data, error } = await supabase.from('epos_products').insert(row).select().single();
      if (error) throw error;
      await logAudit(supabase, staff, 'create', 'epos_product', data.id, { name: row.name });
      return json({ product: data }, corsHeaders);
    }

    if (action === 'deleteProduct') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const { productId } = body;
      if (!isNonEmptyString(productId)) return err('Missing productId', corsHeaders);
      const { data: used } = await supabase.from('epos_order_items').select('id').eq('product_id', productId).limit(1);
      if (used && used.length > 0) {
        // Keep financial history — deactivate instead of deleting.
        await supabase.from('epos_products').update({ active: false }).eq('id', productId);
        await logAudit(supabase, staff, 'deactivate', 'epos_product', productId, {});
        return json({ success: true, deactivated: true }, corsHeaders);
      }
      const { error } = await supabase.from('epos_products').delete().eq('id', productId);
      if (error) throw error;
      await logAudit(supabase, staff, 'delete', 'epos_product', productId, {});
      return json({ success: true }, corsHeaders);
    }

    if (action === 'saveCategory') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const { category } = body;
      if (!isObject(category) || !isNonEmptyString(category.name)) return err('Invalid category', corsHeaders);
      const slug = category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const row = {
        name: category.name.slice(0, 60),
        color: typeof category.color === 'string' ? category.color.slice(0, 20) : '#1B2D3C',
        sort_order: isNumber(category.sortOrder) ? Math.floor(category.sortOrder) : 0,
        active: isBoolean(category.active) ? category.active : true,
      };
      if (isNonEmptyString(category.id)) {
        const { data, error } = await supabase.from('epos_categories').update(row).eq('id', category.id).select().single();
        if (error) throw error;
        return json({ category: data }, corsHeaders);
      }
      const { data, error } = await supabase.from('epos_categories').insert({ ...row, slug }).select().single();
      if (error) throw error;
      return json({ category: data }, corsHeaders);
    }

    if (action === 'deleteCategory') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const { categoryId } = body;
      if (!isNonEmptyString(categoryId)) return err('Missing categoryId', corsHeaders);
      const { data: used } = await supabase.from('epos_products').select('id').eq('category_id', categoryId).limit(1);
      if (used && used.length > 0) return err('Category has products — reassign them first', corsHeaders);
      const { error } = await supabase.from('epos_categories').delete().eq('id', categoryId);
      if (error) throw error;
      return json({ success: true }, corsHeaders);
    }

    if (action === 'saveDiscount') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const { discount } = body;
      if (!isObject(discount)) return err('Invalid discount', corsHeaders);
      const kind = String(discount.kind ?? '');
      if (!isNonEmptyString(discount.name) ||
          !['percent', 'fixed'].includes(kind) || !isNumber(discount.value) || discount.value <= 0) {
        return err('Invalid discount', corsHeaders);
      }
      const row = {
        name: discount.name.slice(0, 60), kind, value: discount.value,
        active: isBoolean(discount.active) ? discount.active : true,
        sort_order: isNumber(discount.sortOrder) ? Math.floor(discount.sortOrder) : 0,
      };
      if (isNonEmptyString(discount.id)) {
        const { data, error } = await supabase.from('epos_discounts').update(row).eq('id', discount.id).select().single();
        if (error) throw error;
        return json({ discount: data }, corsHeaders);
      }
      const { data, error } = await supabase.from('epos_discounts').insert(row).select().single();
      if (error) throw error;
      return json({ discount: data }, corsHeaders);
    }

    // ---------- CSV ----------
    if (action === 'exportProducts') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const [{ data: products }, { data: cats }] = await Promise.all([
        supabase.from('epos_products').select('*').order('sort_order'),
        supabase.from('epos_categories').select('id,name'),
      ]);
      const catName = new Map((cats || []).map((c) => [c.id, c.name]));
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        'name,sku,category,price,vat_treatment,studios,active,sort_order',
        ...(products || []).map((p) => [
          esc(p.name), esc(p.sku), esc(catName.get(p.category_id) || ''),
          p.price, p.vat_treatment, esc((p.studios || []).join(';')), p.active, p.sort_order,
        ].join(',')),
      ].join('\n');
      return new Response(csv, { headers: { ...corsHeaders, 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="epos-products.csv"' } });
    }

    if (action === 'importProducts') {
      if (!canManageProducts(staff)) return err('Forbidden', corsHeaders, 403);
      const { csv } = body;
      if (!isNonEmptyString(csv)) return err('Missing csv', corsHeaders);
      const { data: cats } = await supabase.from('epos_categories').select('id,name');
      const catByName = new Map((cats || []).map((c) => [String(c.name).toLowerCase(), c.id]));
      const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
      let imported = 0;
      for (const line of lines.slice(1)) {
        // Minimal CSV parse (quoted fields).
        const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim()) || [];
        const [name, sku, category, priceStr, vatStr, studiosStr, activeStr, sortStr] = cols;
        if (!name) continue;
        const treatment: VatTreatment = isVatTreatment(vatStr) ? vatStr : 'standard';
        const studios = (studiosStr || '').split(';').map((s) => s.trim()).filter((s) => s === 'Putney' || s === 'Wimbledon');
        await supabase.from('epos_products').insert({
          name: name.slice(0, 120), sku: sku || null,
          category_id: catByName.get((category || '').toLowerCase()) || null,
          price: parseFloat(priceStr) || 0,
          vat_treatment: treatment, vat_rate: vatRateFor(treatment),
          studios: studios.length ? studios : ['Putney', 'Wimbledon'],
          active: activeStr !== 'false', sort_order: parseInt(sortStr) || 0,
        });
        imported++;
      }
      await logAudit(supabase, staff, 'import_csv', 'epos_product', undefined, { imported });
      return json({ success: true, imported }, corsHeaders);
    }

    // ---------- Receipts ----------
    if (action === 'getReceipt') {
      const { orderId } = body;
      if (!isNonEmptyString(orderId)) return err('Missing orderId', corsHeaders);
      if (!(await studioOk(orderId))) return err('Access denied', corsHeaders, 403);
      const full = await loadOrderFull(supabase, orderId);
      if (!full) return err('Order not found', corsHeaders, 404);
      const { data: vatSetting } = await supabase.from('settings').select('value').eq('key', 'epos_vat_number').maybeSingle();
      const vatNumber = vatSetting?.value || '';
      return json({
        order: full.order, items: full.items, payments: full.payments,
        studio: STUDIO_DETAILS[full.order.studio] || null,
        vatNumber,
        html: buildReceiptHtml(full.order, full.items, full.payments, vatNumber),
      }, corsHeaders);
    }

    if (action === 'emailReceipt') {
      const { orderId, email } = body;
      if (!isNonEmptyString(orderId) || !isNonEmptyString(email)) return err('Missing orderId or email', corsHeaders);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Invalid email', corsHeaders);
      if (!(await studioOk(orderId))) return err('Access denied', corsHeaders, 403);
      const full = await loadOrderFull(supabase, orderId);
      if (!full) return err('Order not found', corsHeaders, 404);
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (!resendKey) return err('Email service not configured', corsHeaders, 500);
      const { data: vatSetting } = await supabase.from('settings').select('value').eq('key', 'epos_vat_number').maybeSingle();
      const html = buildReceiptHtml(full.order, full.items, full.payments, vatSetting?.value || '');
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Pitter Potter <${Deno.env.get('RESEND_FROM_EMAIL') || 'bookings@pitterpotter.co.uk'}>`,
          to: [email],
          subject: `Your Pitter Potter receipt — ${full.order.order_number}`,
          html,
        }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        return err(e.message || 'Failed to send receipt', corsHeaders, 502);
      }
      await logAudit(supabase, staff, 'email_receipt', 'epos_order', orderId, { email });
      return json({ success: true }, corsHeaders);
    }

    // ---------- Reporting ----------
    if (action === 'salesReport') {
      const { studio, from, to } = body;
      if (isNonEmptyString(studio) && studio !== 'all' && !canAccessStudio(staff, studio)) {
        return err('No access to this studio', corsHeaders, 403);
      }
      const fromIso = isNonEmptyString(from) ? `${from}T00:00:00Z` : new Date(Date.now() - 30 * 864e5).toISOString();
      const toIso = isNonEmptyString(to) ? `${to}T23:59:59Z` : new Date().toISOString();

      let oq = supabase.from('epos_orders').select('*').gte('created_at', fromIso).lte('created_at', toIso).neq('status', 'void');
      if (isNonEmptyString(studio) && studio !== 'all') oq = oq.eq('studio', studio);
      const { data: orders } = await oq;
      const orderIds = (orders || []).map((o) => o.id);

      const [{ data: payments }, { data: items }, { data: products }, { data: cats }] = await Promise.all([
        orderIds.length ? supabase.from('epos_payments').select('*').in('order_id', orderIds) : Promise.resolve({ data: [] }),
        orderIds.length ? supabase.from('epos_order_items').select('order_id,name,line_total,quantity,vat_rate,vat_treatment,product_id').in('order_id', orderIds) : Promise.resolve({ data: [] }),
        supabase.from('epos_products').select('id,category_id'),
        supabase.from('epos_categories').select('id,name'),
      ]);
      const prodCat = new Map((products || []).map((p) => [p.id, p.category_id]));
      const catName = new Map((cats || []).map((c) => [c.id, c.name]));
      const orderStudio = new Map((orders || []).map((o) => [o.id, o.studio]));

      const byStudio: Record<string, number> = {};
      const byMethod: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      const byVatRate: Record<string, { net: number; vat: number; gross: number }> = {};
      const byDay: Record<string, number> = {};
      let grossPence = 0, vatPence = 0, discountPence = 0, refundPence = 0, outstandingPence = 0;

      for (const o of orders || []) {
        const day = String(o.created_at).slice(0, 10);
        byStudio[o.studio] = (byStudio[o.studio] || 0) + Number(o.total);
        byDay[day] = (byDay[day] || 0) + Number(o.total);
        grossPence += toPence(Number(o.total));
        vatPence += toPence(Number(o.vat_total));
        discountPence += toPence(Number(o.discount_total));
        outstandingPence += Math.max(0, toPence(Number(o.total)) - toPence(Number(o.paid_total)));
      }
      for (const p of payments || []) {
        const effective = toPence(Number(p.amount)) - toPence(Number(p.refunded_amount || 0));
        if (p.status === 'completed' || p.status === 'partially_refunded') {
          byMethod[p.method] = (byMethod[p.method] || 0) + toPounds(effective);
        }
        refundPence += toPence(Number(p.refunded_amount || 0));
      }
      for (const i of items || []) {
        const cat = catName.get(prodCat.get(i.product_id)) || 'Other';
        byCategory[cat] = (byCategory[cat] || 0) + Number(i.line_total);
        const rate = Number(i.vat_rate);
        const key = `${Math.round(rate * 100)}%`;
        const gross = toPence(Number(i.line_total));
        const vat = i.vat_treatment === 'exempt' ? 0 : gross - Math.round(gross / (1 + rate));
        if (!byVatRate[key]) byVatRate[key] = { net: 0, vat: 0, gross: 0 };
        byVatRate[key].gross += toPounds(gross);
        byVatRate[key].vat += toPounds(Math.max(0, vat));
        byVatRate[key].net += toPounds(gross - Math.max(0, vat));
      }
      void orderStudio;

      return json({
        orders: (orders || []).length,
        gross: toPounds(grossPence), vat: toPounds(vatPence), discounts: toPounds(discountPence),
        refunds: toPounds(refundPence), outstanding: toPounds(outstandingPence),
        byStudio, byMethod, byCategory, byVatRate, byDay,
        rawOrders: orders || [],
      }, corsHeaders);
    }

    return err('Unknown action', corsHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('EPOS error:', msg);
    return json({ error: 'Failed to process request', detail: msg }, corsHeaders, 500);
  }
});
