import { useEffect, useMemo, useState, useCallback } from 'react';
import type {
  Staff, EposCategory, EposProduct, EposDiscount, EposOrder,
  EposOrderItem, EposPayment, EposTable, EposStudio, BookingInquiry, EposPaymentMethod,
} from '../types';
import {
  eposBootstrap, eposListTables, eposOpenOrders, eposCreateOrder, eposGetOrder,
  eposAddItem, eposUpdateItemQty, eposRemoveItem, eposApplyDiscount, eposRemoveDiscount,
  eposPay, eposCheckPayment, eposVoidOrder, eposRefundPayment, eposLinkTable,
  eposGetReceipt, eposEmailReceipt, type EposReceipt,
} from '../lib/epos';

interface Props {
  staff: Staff;
  studio: EposStudio;
  bookings: BookingInquiry[];            // today's + future bookings at this studio
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onNavigateToFloorPlan?: () => void;
  billBooking?: BookingInquiry | null;   // "Bill" pressed on a day-view card
  onBillHandled?: () => void;
}

const fmt = (n: number) => `£${Number(n).toFixed(2)}`;

export default function EposView({ staff, studio, bookings, showToast, billBooking, onBillHandled }: Props) {
  const [categories, setCategories] = useState<EposCategory[]>([]);
  const [products, setProducts] = useState<EposProduct[]>([]);
  const [discounts, setDiscounts] = useState<EposDiscount[]>([]);
  const [cardProvider, setCardProvider] = useState<'mock' | 'dojo'>('mock');
  const [tables, setTables] = useState<EposTable[]>([]);
  const [openOrders, setOpenOrders] = useState<EposOrder[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [order, setOrder] = useState<EposOrder | null>(null);
  const [items, setItems] = useState<EposOrderItem[]>([]);
  const [payments, setPayments] = useState<EposPayment[]>([]);
  const [busy, setBusy] = useState(false);
  const [booted, setBooted] = useState(false);

  const [view, setView] = useState<'till' | 'tables'>('till');
  const [payModal, setPayModal] = useState<null | { method: EposPaymentMethod }>(null);
  const [tendered, setTendered] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [receipt, setReceipt] = useState<EposReceipt | null>(null);
  const [receiptEmail, setReceiptEmail] = useState('');
  const [discountModal, setDiscountModal] = useState(false);
  const [customModal, setCustomModal] = useState(false);
  const [customItem, setCustomItem] = useState({ name: '', price: '', vat: 'standard' });
  const [newOrderModal, setNewOrderModal] = useState<null | { tableId?: string }>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [newOrder, setNewOrder] = useState({ label: '', customerName: '', bookingId: '' });
  const [refundTarget, setRefundTarget] = useState<EposPayment | null>(null);

  const canDiscount = staff.role === 'super_admin' || staff.canEposDiscounts;
  const canRefund = staff.role === 'super_admin' || staff.canEposRefunds;

  const loadBootstrap = useCallback(async () => {
    try {
      const b = await eposBootstrap(staff, studio);
      setCategories(b.categories);
      setProducts(b.products);
      setDiscounts(b.discounts);
      setCardProvider(b.cardProvider);
      const [t, o] = await Promise.all([eposListTables(staff, studio), eposOpenOrders(staff, studio)]);
      setTables(t.tables);
      setOpenOrders(o.orders);
      setBooted(true);
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  }, [staff, studio, showToast]);

  useEffect(() => { setBooted(false); loadBootstrap(); }, [loadBootstrap]);

  const refreshOrder = useCallback(async (orderId: string) => {
    const full = await eposGetOrder(staff, orderId);
    setOrder(full.order); setItems(full.items); setPayments(full.payments);
    const o = await eposOpenOrders(staff, studio);
    setOpenOrders(o.orders);
  }, [staff, studio]);

  const selectOrder = async (o: EposOrder) => {
    try { await refreshOrder(o.id); } catch (e) { showToast((e as Error).message, 'error'); }
  };

  // "Bill" pressed on a day-view card — open the booking's order (or create it).
  useEffect(() => {
    if (!billBooking || !booted) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const o = await eposOpenOrders(staff, billBooking.studio || studio);
        if (cancelled) return;
        setOpenOrders(o.orders);
        const existing = o.orders.find(ord => ord.booking_id === billBooking.id);
        if (existing) {
          await refreshOrder(existing.id);
          setView('till');
          showToast(`Opened ${existing.order_number} for ${billBooking.name}`, 'success');
        } else {
          const tableId = (billBooking.tableId || '').split(',').map(s => s.trim()).filter(Boolean)[0];
          const res = await eposCreateOrder(staff, {
            studio: billBooking.studio || studio,
            tableId: tableId || undefined,
            bookingId: billBooking.id,
            customerName: billBooking.name,
          });
          if (cancelled) return;
          await refreshOrder(res.order.id);
          setView('till');
          showToast(`Order ${res.order.order_number} opened for ${billBooking.name}`, 'success');
        }
      } catch (e) {
        if (!cancelled) showToast((e as Error).message, 'error');
      }
      if (!cancelled) { setBusy(false); onBillHandled?.(); }
    })();
    return () => { cancelled = true; };
  }, [billBooking, booted]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date().toISOString().split('T')[0];
  const todaysBookings = useMemo(
    () => bookings.filter(b => b.date === today && ['confirmed', 'seated', 'completed'].includes(b.status)),
    [bookings, today],
  );

  const bookingsAtTable = useCallback((tableId: string) =>
    todaysBookings.filter(b => {
      const ids = (b.tableId || '').split(',').map(s => s.trim()).filter(Boolean);
      return ids.includes(tableId);
    }), [todaysBookings]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p =>
      (activeCategory === 'all' || p.category_id === activeCategory) &&
      (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)),
    );
  }, [products, activeCategory, search]);

  const outstanding = order ? Math.max(0, order.total - order.paid_total) : 0;

  const addProduct = async (productId: string) => {
    if (!order) { showToast('Select or create an order first', 'error'); return; }
    setBusy(true);
    try {
      const res = await eposAddItem(staff, order.id, { productId, quantity: 1 });
      setOrder(res.order);
      const full = await eposGetOrder(staff, order.id);
      setItems(full.items);
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const createOrder = async () => {
    setBusy(true);
    try {
      const res = await eposCreateOrder(staff, {
        studio,
        tableId: newOrderModal?.tableId,
        bookingId: newOrder.bookingId || undefined,
        customerName: newOrder.customerName || undefined,
        label: newOrder.label || undefined,
      });
      setNewOrderModal(null);
      setNewOrder({ label: '', customerName: '', bookingId: '' });
      await refreshOrder(res.order.id);
      showToast(`Order ${res.order.order_number} created`, 'success');
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const submitPayment = async () => {
    if (!order || !payModal) return;
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { showToast('Enter an amount', 'error'); return; }
    if (payModal.method === 'voucher' && !voucherCode.trim()) { showToast('Enter the voucher code', 'error'); return; }
    setBusy(true);
    try {
      const res = await eposPay(staff, order.id, {
        method: payModal.method,
        amount: amt,
        tendered: payModal.method === 'cash' ? parseFloat(tendered) || undefined : undefined,
        voucherCode: payModal.method === 'voucher' ? voucherCode.trim() : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setPayModal(null); setPayAmount(''); setTendered(''); setVoucherCode('');
      await refreshOrder(order.id);
      if (res.payment.status === 'pending') {
        showToast('Sent to card terminal — waiting for customer', 'success');
        // Poll for terminal completion (dojo).
        const pid = res.payment.id;
        const poll = async () => {
          try {
            const r = await eposCheckPayment(staff, pid);
            if (r.payment.status === 'completed') { showToast('Card payment approved', 'success'); await refreshOrder(order.id); return; }
            if (r.payment.status === 'failed') { showToast('Card payment failed/declined', 'error'); await refreshOrder(order.id); return; }
            setTimeout(poll, 3000);
          } catch { /* keep polling quietly */ setTimeout(poll, 5000); }
        };
        setTimeout(poll, 3000);
      } else {
        showToast(`${fmt(res.payment.amount)} ${res.payment.method} payment recorded`, 'success');
      }
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const openReceipt = async (orderId: string) => {
    try {
      const r = await eposGetReceipt(staff, orderId);
      setReceipt(r);
    } catch (e) { showToast((e as Error).message, 'error'); }
  };

  // ---------- render ----------
  const productTile = (p: EposProduct) => (
    <button
      key={p.id}
      onClick={() => addProduct(p.id)}
      disabled={busy || !order || order.status === 'paid' || order.status === 'void'}
      className="bg-white rounded-xl border-2 border-[#1B2D3C]/10 p-3 text-left hover:border-[#1B2D3C]/40 active:scale-95 transition-all disabled:opacity-50 min-h-[72px] flex flex-col justify-between"
    >
      <span className="text-sm font-bold text-[#1B2D3C] leading-tight line-clamp-2">{p.name}</span>
      <span className="text-base font-black text-[#1B2D3C]">{fmt(p.price)}</span>
    </button>
  );

  return (
    <div className="flex gap-4 h-full">
      {/* LEFT: catalogue */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex gap-2 mb-3 items-center">
          <button
            onClick={() => setView(view === 'till' ? 'tables' : 'till')}
            className="px-4 py-2.5 rounded-xl bg-[#1B2D3C] text-white text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            {view === 'till' ? `Tables` : '← Till'}
          </button>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="flex-1 px-4 py-2.5 rounded-xl border-2 border-[#1B2D3C]/15 text-sm font-semibold outline-none focus:border-[#1B2D3C]/50"
          />
        </div>

        {view === 'tables' ? (
          <div className="grid grid-cols-4 gap-3 overflow-y-auto">
            {tables.map(t => {
              const tableOrders = openOrders.filter(o => o.table_id === t.table_id);
              const tableBookings = bookingsAtTable(t.table_id);
              return (
                <div key={t.table_id} className="bg-white rounded-xl border-2 border-[#1B2D3C]/10 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-black text-[#1B2D3C] text-lg">{t.label}</span>
                    <span className="text-[10px] text-[#1B2D3C]/50 uppercase">{t.area}</span>
                  </div>
                  {tableBookings.map(b => (
                    <div key={b.id} className="text-xs text-[#1B2D3C]/80 font-semibold truncate">
                      {b.name} · {b.time} · {b.paintersCount}p
                    </div>
                  ))}
                  {tableOrders.map(o => (
                    <button key={o.id} onClick={() => { selectOrder(o); setView('till'); }}
                      className="mt-1 w-full text-left px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 cursor-pointer">
                      {o.order_number} {o.label ? `· ${o.label}` : ''} · {fmt(o.total)} <span className="uppercase">({o.status})</span>
                    </button>
                  ))}
                  <button onClick={() => { setNewOrderModal({ tableId: t.table_id }); setNewOrder({ label: '', customerName: '', bookingId: '' }); }}
                    className="mt-2 w-full px-2 py-1.5 rounded-lg bg-[#1B2D3C] text-white text-[10px] font-bold uppercase cursor-pointer">
                    + New Order
                  </button>
                </div>
              );
            })}
            {tables.length === 0 && <div className="col-span-4 text-center text-[#1B2D3C]/50 py-10">No tables configured for {studio}</div>}
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer ${activeCategory === 'all' ? 'bg-[#1B2D3C] text-white' : 'bg-white border-2 border-[#1B2D3C]/15 text-[#1B2D3C]'}`}
              >All</button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setActiveCategory(c.id)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer ${activeCategory === c.id ? 'text-white' : 'bg-white border-2 border-[#1B2D3C]/15 text-[#1B2D3C]'}`}
                  style={activeCategory === c.id ? { backgroundColor: c.color } : {}}>
                  {c.name}
                </button>
              ))}
              <button onClick={() => setCustomModal(true)}
                className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer bg-emerald-50 border-2 border-emerald-500/30 text-emerald-700">
                + Custom
              </button>
            </div>
            {/* Product grid stays collapsed until staff search or pick a category —
                keeps the till compact so payment buttons are never off-screen. */}
            {(() => {
              const showGrid = search.trim() !== '' || activeCategory !== 'all';
              if (!showGrid) {
                return (
                  <div className="text-center text-[#1B2D3C]/40 py-16 text-sm font-semibold">
                    Search above or tap a category to show products
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-3 xl:grid-cols-4 gap-3 overflow-y-auto">
                  {filteredProducts.map(productTile)}
                  {filteredProducts.length === 0 && (
                    <div className="col-span-full text-center text-[#1B2D3C]/50 py-12 text-sm">
                      {products.length === 0 ? 'No products yet — add them under Admin → EPOS Products' : 'No matching products'}
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* RIGHT: order panel */}
      <div className="w-[380px] shrink-0 bg-white rounded-2xl border-2 border-[#1B2D3C]/10 flex flex-col overflow-hidden">
        <div className="p-3 border-b-2 border-[#1B2D3C]/10 bg-[#F5F2E8]">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                value={orderSearch}
                onFocus={() => setFindOpen(true)}
                onBlur={() => setTimeout(() => setFindOpen(false), 150)}
                onChange={e => { setOrderSearch(e.target.value); setFindOpen(true); }}
                placeholder="Find bill — name, table or order #…"
                className="w-full px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm font-bold text-[#1B2D3C] bg-white"
              />
              {findOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-white border border-[#1B2D3C]/15 rounded-xl shadow-lg max-h-72 overflow-y-auto">
                  {(() => {
                    const q = orderSearch.trim().toLowerCase();
                    const matches = openOrders.filter(o =>
                      !q ||
                      o.order_number.toLowerCase().includes(q) ||
                      (o.customer_name || '').toLowerCase().includes(q) ||
                      (o.label || '').toLowerCase().includes(q) ||
                      (o.table_id || '').toLowerCase().includes(q));
                    if (matches.length === 0) {
                      return <div className="px-3 py-3 text-xs font-semibold text-[#1B2D3C]/40">No open bills match</div>;
                    }
                    return matches.map(o => (
                      <button
                        key={o.id}
                        onMouseDown={e => { e.preventDefault(); setOrderSearch(''); setFindOpen(false); selectOrder(o); setView('till'); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#F5F2E8] border-b border-[#1B2D3C]/5 last:border-0 cursor-pointer"
                      >
                        <div className="text-sm font-black text-[#1B2D3C] truncate">
                          {o.customer_name || o.label || o.order_number}
                        </div>
                        <div className="text-[10px] font-semibold text-[#1B2D3C]/50">
                          {o.order_number}{o.table_id ? ` · ${o.table_id}` : ''}{o.label && o.customer_name ? ` · ${o.label}` : ''} · {fmt(o.total)}
                        </div>
                      </button>
                    ));
                  })()}
                </div>
              )}
            </div>
            <button onClick={() => { setNewOrderModal({}); setNewOrder({ label: '', customerName: '', bookingId: '' }); }}
              className="px-3 py-2 rounded-lg bg-[#1B2D3C] text-white text-xs font-bold cursor-pointer">+</button>
          </div>
          {order && (
            <div className="mt-2 text-xs text-[#1B2D3C]/70 font-semibold">
              {order.order_number}
              {order.table_id && <> · Table {order.table_id}</>}
              {order.customer_name && <> · {order.customer_name}</>}
              {order.label && <> · {order.label}</>}
              <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${order.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : order.status === 'partial' ? 'bg-amber-100 text-amber-700' : order.status === 'void' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{order.status}</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {!order && <div className="text-center text-[#1B2D3C]/40 text-sm py-10">Create an order or pick an open order / table</div>}
          {items.map(i => (
            <div key={i.id} className="flex items-center gap-2 bg-[#F5F2E8]/60 rounded-xl p-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-[#1B2D3C] truncate">{i.name}</div>
                <div className="text-xs text-[#1B2D3C]/50">{fmt(i.unit_price)} each{i.vat_treatment !== 'standard' && ` · ${i.vat_treatment}`}</div>
              </div>
              <div className="flex items-center gap-1">
                <button disabled={order?.status === 'paid' || order?.status === 'void'} onClick={async () => { const r = await eposUpdateItemQty(staff, i.id, i.quantity - 1); setOrder(r.order); const f = await eposGetOrder(staff, order!.id); setItems(f.items); }}
                  className="w-8 h-8 rounded-lg bg-white border border-[#1B2D3C]/20 font-black text-[#1B2D3C] disabled:opacity-40 cursor-pointer">−</button>
                <span className="w-7 text-center font-bold text-sm">{i.quantity}</span>
                <button disabled={order?.status === 'paid' || order?.status === 'void'} onClick={async () => { const r = await eposUpdateItemQty(staff, i.id, i.quantity + 1); setOrder(r.order); const f = await eposGetOrder(staff, order!.id); setItems(f.items); }}
                  className="w-8 h-8 rounded-lg bg-white border border-[#1B2D3C]/20 font-black text-[#1B2D3C] disabled:opacity-40 cursor-pointer">+</button>
              </div>
              <div className="w-16 text-right font-black text-sm text-[#1B2D3C]">{fmt(i.line_total)}</div>
              <button disabled={order?.status === 'paid' || order?.status === 'void'} onClick={async () => { const r = await eposRemoveItem(staff, i.id); setOrder(r.order); const f = await eposGetOrder(staff, order!.id); setItems(f.items); }}
                className="text-red-400 hover:text-red-600 font-black px-1 disabled:opacity-30 cursor-pointer">✕</button>
            </div>
          ))}
        </div>

        {order && (
          <div className="border-t-2 border-[#1B2D3C]/10 p-3 space-y-2">
            <div className="flex justify-between text-xs font-semibold text-[#1B2D3C]/70">
              <span>Subtotal</span><span>{fmt(order.subtotal)}</span>
            </div>
            {order.discount_total > 0 && (
              <div className="flex justify-between text-xs font-semibold text-emerald-700">
                <span>Discount {order.discount_label ? `(${order.discount_label})` : ''}</span>
                <span>-{fmt(order.discount_total)}
                  {canDiscount && order.status !== 'paid' && (
                    <button onClick={async () => { const r = await eposRemoveDiscount(staff, order.id); setOrder(r.order); }} className="ml-1 text-red-500 cursor-pointer">✕</button>
                  )}
                </span>
              </div>
            )}
            <div className="flex justify-between text-xs font-semibold text-[#1B2D3C]/50">
              <span>of which VAT</span><span>{fmt(order.vat_total)}</span>
            </div>
            <div className="flex justify-between text-xl font-black text-[#1B2D3C]">
              <span>Total</span><span>{fmt(order.total)}</span>
            </div>
            {order.paid_total > 0 && (
              <div className="flex justify-between text-sm font-bold text-emerald-700">
                <span>Paid</span><span>{fmt(order.paid_total)}</span>
              </div>
            )}
            {outstanding > 0 && order.paid_total > 0 && (
              <div className="flex justify-between text-sm font-black text-amber-700">
                <span>Outstanding</span><span>{fmt(outstanding)}</span>
              </div>
            )}

            {payments.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-dashed border-[#1B2D3C]/15">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className={`font-bold uppercase ${p.status === 'refunded' ? 'text-red-500 line-through' : p.status === 'pending' ? 'text-amber-600' : 'text-[#1B2D3C]/70'}`}>
                      {p.method} {p.status === 'pending' && '(on terminal…)'}
                      {p.reference && p.method !== 'voucher' ? '' : p.reference ? `· ${p.reference}` : ''}
                    </span>
                    <span className="font-bold text-[#1B2D3C]">
                      {fmt(p.amount)}
                      {canRefund && (p.status === 'completed' || p.status === 'partially_refunded') && (
                        <button onClick={() => setRefundTarget(p)} className="ml-2 text-[10px] text-red-500 underline cursor-pointer">refund</button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              {order.status !== 'paid' && order.status !== 'void' && (
                <>
                  {canDiscount && (
                    <button onClick={() => setDiscountModal(true)} className="col-span-2 py-2 rounded-lg bg-[#D6E2E9] text-[#1B2D3C] text-xs font-bold uppercase cursor-pointer">
                      Discount
                    </button>
                  )}
                  {(['cash', 'card', 'voucher', 'other'] as const).map(m => (
                    <button key={m} disabled={outstanding <= 0}
                      onClick={() => { setPayModal({ method: m }); setPayAmount(String(outstanding.toFixed(2))); setTendered(''); setVoucherCode(''); }}
                      className="py-3 rounded-xl text-white text-xs font-black uppercase tracking-wider cursor-pointer disabled:opacity-30"
                      style={{ backgroundColor: m === 'cash' ? '#059669' : m === 'card' ? '#1B2D3C' : m === 'voucher' ? '#DB2777' : '#64748B' }}
                    >
                      {m === 'card' ? (cardProvider === 'dojo' ? 'Card (Dojo)' : 'Card') : m === 'voucher' ? 'Voucher' : m === 'other' ? 'Other' : 'Cash'}
                    </button>
                  ))}
                  {/* Park the bill — items are saved on the server as they're added,
                      so "Save" just puts it back into open bills (retrievable via
                      Find Bill or the table card) while the customer keeps painting. */}
                  <button onClick={() => { setOrder(null); setItems([]); setPayments([]); setOrderSearch(''); showToast(`Order ${order.order_number} saved — find it by name at checkout`, 'success'); }}
                    className="col-span-2 py-2.5 rounded-lg bg-emerald-50 border-2 border-emerald-500/30 text-emerald-700 text-xs font-black uppercase tracking-wider cursor-pointer">
                    Save Order
                  </button>
                  <button onClick={() => { if (confirm('Void this order? (only possible while unpaid)')) eposVoidOrder(staff, order.id, 'voided from till').then(() => { setOrder(null); setItems([]); setPayments([]); loadBootstrap(); }).catch(e => showToast((e as Error).message, 'error')); }}
                    className="col-span-2 py-1.5 rounded-lg text-red-500 text-[10px] font-bold uppercase cursor-pointer">Void order</button>
                </>
              )}
              {order.status === 'paid' && (
                <button onClick={() => openReceipt(order.id)} className="col-span-2 py-3 rounded-xl bg-[#1B2D3C] text-white text-xs font-black uppercase tracking-wider cursor-pointer">
                  Receipt / Email
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---- New order modal ---- */}
      {newOrderModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setNewOrderModal(null)}>
          <div className="bg-white rounded-2xl p-5 w-[420px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-3">New Order {newOrderModal.tableId && `— Table ${newOrderModal.tableId}`}</h3>
            <label className="block text-[10px] font-bold uppercase text-[#1B2D3C]/60 mb-1">Order label (e.g. "Seat 2" / payer name)</label>
            <input value={newOrder.label} onChange={e => setNewOrder({ ...newOrder, label: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm mb-2" placeholder="Optional" />
            <label className="block text-[10px] font-bold uppercase text-[#1B2D3C]/60 mb-1">Customer name</label>
            <input value={newOrder.customerName} onChange={e => setNewOrder({ ...newOrder, customerName: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm mb-2" placeholder="Walk-in customer" />
            <label className="block text-[10px] font-bold uppercase text-[#1B2D3C]/60 mb-1">Link to booking</label>
            <select value={newOrder.bookingId} onChange={e => setNewOrder({ ...newOrder, bookingId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm mb-3 bg-white">
              <option value="">None (walk-in)</option>
              {(newOrderModal.tableId ? bookingsAtTable(newOrderModal.tableId) : todaysBookings).map(b => (
                <option key={b.id} value={b.id}>{b.name} · {b.time} · {b.paintersCount}p</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setNewOrderModal(null)} className="flex-1 py-2.5 rounded-xl border border-[#1B2D3C]/20 text-sm font-bold cursor-pointer">Cancel</button>
              <button onClick={createOrder} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-[#1B2D3C] text-white text-sm font-bold cursor-pointer disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Payment modal ---- */}
      {payModal && order && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setPayModal(null)}>
          <div className="bg-white rounded-2xl p-5 w-[420px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-1 capitalize">{payModal.method} payment</h3>
            <p className="text-xs text-[#1B2D3C]/60 mb-3">Outstanding: <b>{fmt(outstanding)}</b> on {order.order_number}</p>
            <label className="block text-[10px] font-bold uppercase text-[#1B2D3C]/60 mb-1">Amount (£)</label>
            <input value={payAmount} onChange={e => setPayAmount(e.target.value)} inputMode="decimal"
              className="w-full px-3 py-3 rounded-lg border-2 border-[#1B2D3C]/20 text-2xl font-black mb-3" />
            {payModal.method === 'cash' && (
              <>
                <label className="block text-[10px] font-bold uppercase text-[#1B2D3C]/60 mb-1">Cash tendered (£)</label>
                <input value={tendered} onChange={e => setTendered(e.target.value)} inputMode="decimal"
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-[#1B2D3C]/20 text-lg font-bold mb-2" />
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  {[5, 10, 20, 50].map(n => (
                    <button key={n} onClick={() => setTendered(String(n))} className="px-3 py-1.5 rounded-lg bg-[#D6E2E9] text-xs font-bold cursor-pointer">£{n}</button>
                  ))}
                  <button onClick={() => setTendered(payAmount)} className="px-3 py-1.5 rounded-lg bg-[#D6E2E9] text-xs font-bold cursor-pointer">Exact</button>
                </div>
                {tendered && parseFloat(tendered) >= parseFloat(payAmount || '0') && (
                  <div className="mb-3 p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 font-black text-lg">
                    Change: {fmt(parseFloat(tendered) - parseFloat(payAmount || '0'))}
                  </div>
                )}
              </>
            )}
            {payModal.method === 'voucher' && (
              <>
                <label className="block text-[10px] font-bold uppercase text-[#1B2D3C]/60 mb-1">Gift voucher code</label>
                <input value={voucherCode} onChange={e => setVoucherCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-[#1B2D3C]/20 text-lg font-bold mb-3" placeholder="PP-XXXX…" />
              </>
            )}
            {payModal.method === 'card' && cardProvider === 'mock' && (
              <div className="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold">
                Mock card mode — no real charge. Dojo terminal integration is not yet configured.
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setPayModal(null)} className="flex-1 py-3 rounded-xl border border-[#1B2D3C]/20 text-sm font-bold cursor-pointer">Cancel</button>
              <button onClick={submitPayment} disabled={busy} className="flex-1 py-3 rounded-xl bg-[#1B2D3C] text-white text-sm font-black cursor-pointer disabled:opacity-50">
                {busy ? 'Processing…' : payModal.method === 'card' && cardProvider === 'dojo' ? 'Send to terminal' : `Take ${fmt(parseFloat(payAmount) || 0)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Discount modal ---- */}
      {discountModal && order && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDiscountModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-[400px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-3">Apply discount</h3>
            {discounts.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-3">
                {discounts.map(d => (
                  <button key={d.id}
                    onClick={async () => { const r = await eposApplyDiscount(staff, order.id, { discountId: d.id }); setOrder(r.order); setDiscountModal(false); }}
                    className="px-3 py-2 rounded-lg bg-[#D6E2E9] text-xs font-bold cursor-pointer">
                    {d.name} ({d.kind === 'percent' ? `${d.value}%` : fmt(d.value)})
                  </button>
                ))}
              </div>
            )}
            <DiscountCustom onApply={async (kind, value, label) => {
              const r = await eposApplyDiscount(staff, order.id, { kind, value, label });
              setOrder(r.order); setDiscountModal(false);
            }} />
          </div>
        </div>
      )}

      {/* ---- Custom item modal ---- */}
      {customModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setCustomModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-[400px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-3">Custom item</h3>
            <input value={customItem.name} onChange={e => setCustomItem({ ...customItem, name: e.target.value })} placeholder="Description"
              className="w-full px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm mb-2" />
            <input value={customItem.price} onChange={e => setCustomItem({ ...customItem, price: e.target.value })} placeholder="Price £" inputMode="decimal"
              className="w-full px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm mb-2" />
            <select value={customItem.vat} onChange={e => setCustomItem({ ...customItem, vat: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm mb-3 bg-white">
              <option value="standard">VAT 20%</option>
              <option value="reduced">VAT 5%</option>
              <option value="zero">VAT 0% (zero-rated)</option>
              <option value="exempt">VAT exempt</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setCustomModal(false)} className="flex-1 py-2.5 rounded-xl border border-[#1B2D3C]/20 text-sm font-bold cursor-pointer">Cancel</button>
              <button onClick={async () => {
                if (!order) { showToast('Select or create an order first', 'error'); return; }
                try {
                  const r = await eposAddItem(staff, order.id, { customName: customItem.name, customPrice: parseFloat(customItem.price) || 0, customVatTreatment: customItem.vat });
                  setOrder(r.order);
                  const f = await eposGetOrder(staff, order.id); setItems(f.items);
                  setCustomModal(false); setCustomItem({ name: '', price: '', vat: 'standard' });
                } catch (e) { showToast((e as Error).message, 'error'); }
              }} className="flex-1 py-2.5 rounded-xl bg-[#1B2D3C] text-white text-sm font-bold cursor-pointer">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Refund modal ---- */}
      {refundTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setRefundTarget(null)}>
          <div className="bg-white rounded-2xl p-5 w-[380px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-2">Refund {refundTarget.method} payment</h3>
            <p className="text-sm text-[#1B2D3C]/70 mb-3">
              Paid {fmt(refundTarget.amount)} · refundable {fmt(refundTarget.amount - refundTarget.refunded_amount)}
              {refundTarget.method === 'voucher' && ' — restores voucher balance'}
              {refundTarget.method === 'card' && refundTarget.provider === 'mock' && ' — mock payment, refund is a record only'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setRefundTarget(null)} className="flex-1 py-2.5 rounded-xl border border-[#1B2D3C]/20 text-sm font-bold cursor-pointer">Cancel</button>
              <button onClick={async () => {
                try {
                  await eposRefundPayment(staff, refundTarget.id);
                  setRefundTarget(null);
                  if (order) await refreshOrder(order.id);
                  showToast('Refund recorded', 'success');
                } catch (e) { showToast((e as Error).message, 'error'); }
              }} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold cursor-pointer">Refund full amount</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Receipt modal ---- */}
      {receipt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setReceipt(null)}>
          <div className="bg-white rounded-2xl p-5 w-[460px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-2">Receipt — {receipt.order.order_number}</h3>
            <iframe title="receipt" srcDoc={receipt.html} className="w-full h-72 border border-[#1B2D3C]/10 rounded-lg bg-white" />
            <div className="flex gap-2 mt-3">
              <input value={receiptEmail} onChange={e => setReceiptEmail(e.target.value)} placeholder="customer@email.com"
                className="flex-1 px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm" />
              <button onClick={async () => {
                try {
                  await eposEmailReceipt(staff, receipt.order.id, receiptEmail);
                  showToast('Receipt emailed', 'success'); setReceiptEmail('');
                } catch (e) { showToast((e as Error).message, 'error'); }
              }} className="px-4 py-2.5 rounded-lg bg-[#1B2D3C] text-white text-xs font-bold cursor-pointer">Email</button>
            </div>
            <button onClick={() => setReceipt(null)} className="mt-3 w-full py-2.5 rounded-xl border border-[#1B2D3C]/20 text-sm font-bold cursor-pointer">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DiscountCustom({ onApply }: { onApply: (kind: 'percent' | 'fixed', value: number, label: string) => void }) {
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  return (
    <div className="border-t border-[#1B2D3C]/10 pt-3">
      <div className="text-[10px] font-bold uppercase text-[#1B2D3C]/60 mb-2">Custom discount</div>
      <div className="flex gap-2 mb-2">
        <select value={kind} onChange={e => setKind(e.target.value as 'percent' | 'fixed')} className="px-2 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm bg-white">
          <option value="percent">%</option>
          <option value="fixed">£ off</option>
        </select>
        <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" placeholder="Amount"
          className="flex-1 px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm" />
      </div>
      <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Reason (optional)"
        className="w-full px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm mb-2" />
      <button onClick={() => { const v = parseFloat(value); if (v > 0) onApply(kind, v, label || (kind === 'percent' ? `${v}% off` : 'Discount')); }}
        className="w-full py-2.5 rounded-xl bg-[#1B2D3C] text-white text-sm font-bold cursor-pointer">Apply</button>
    </div>
  );
}
