import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Plus, Minus, ArrowRightLeft, ClipboardList, Search, Download, AlertTriangle } from 'lucide-react';
import type { Staff } from '../types';
import {
  eposStockOverview, eposStockSetLevels, eposStockReceive, eposStockAdjust,
  eposStockTransfer, eposStockMovements, eposStockReorderList, eposStocktakeSubmit,
  eposStocktakeList, eposStockReport,
  type StockRow, type StockMovement, type ReorderRow, type Stocktake, type StockReportRow,
} from '../lib/epos';

interface Props {
  staff: Staff;
  studio: 'all' | 'Putney' | 'Wimbledon';
  isSuperAdmin: boolean;
  canStock: boolean;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

type SubView = 'overview' | 'receive' | 'movements' | 'reorder' | 'stocktake' | 'reports';

const STUDIOS = ['Putney', 'Wimbledon'] as const;
const ADJUST_REASONS = ['Breakage', 'Damaged', 'Missing', 'Stocktake correction', 'Complimentary', 'Staff use', 'Other'];
const MOVEMENT_TYPES = ['sale', 'receive', 'transfer_out', 'transfer_in', 'adjust', 'stocktake'];
const fmt = (n: number) => `£${Number(n).toFixed(2)}`;

const inputCls = 'px-3 py-2 rounded-lg border-2 border-[#1B2D3C]/15 text-sm font-semibold outline-none focus:border-[#1B2D3C]/50 bg-white';
const btnCls = 'px-3 py-2 rounded-lg bg-[#1B2D3C] text-white text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-40';
const cardCls = 'bg-white rounded-2xl border-2 border-[#1B2D3C]/10 p-4';

function QtyBadge({ qty, min, track }: { qty: number; min: number; track: boolean }) {
  if (!track) return <span className="text-[10px] font-bold text-[#1B2D3C]/30 uppercase">no stock</span>;
  const low = qty < 0 || (min > 0 && qty <= min);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black ${qty <= 0 ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
      {qty <= 0 && <AlertTriangle className="w-3 h-3" />}{qty}
    </span>
  );
}

export default function EposStockView({ staff, studio, isSuperAdmin, canStock, showToast }: Props) {
  const [sub, setSub] = useState<SubView>('overview');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [stockStudios, setStockStudios] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [mvType, setMvType] = useState('');
  const [mvStudio, setMvStudio] = useState<string>(studio);
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([]);
  const [report, setReport] = useState<{ products: StockReportRow[]; byStudio: Record<string, { qty: number; revenue: number }> } | null>(null);
  const [reportFrom, setReportFrom] = useState(() => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportStudio, setReportStudio] = useState<string>('all');
  const [reportCategory, setReportCategory] = useState('');
  const [reportSort, setReportSort] = useState<'best' | 'slow'>('best');

  // Per-product modals
  const [adjustTarget, setAdjustTarget] = useState<StockRow | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState(ADJUST_REASONS[0]);
  const [adjustStudio, setAdjustStudio] = useState<string>(studio === 'all' ? 'Putney' : studio);
  const [transferTarget, setTransferTarget] = useState<StockRow | null>(null);
  const [transferQty, setTransferQty] = useState('');
  const [transferDir, setTransferDir] = useState<'Putney>Wimbledon' | 'Wimbledon>Putney'>('Putney>Wimbledon');
  const [transferNote, setTransferNote] = useState('');
  const [levelsTarget, setLevelsTarget] = useState<StockRow | null>(null);
  const [levelsMin, setLevelsMin] = useState('');
  const [levelsReorder, setLevelsReorder] = useState('');
  const [levelsStudio, setLevelsStudio] = useState<string>(studio === 'all' ? 'Putney' : studio);
  const [levelsTrack, setLevelsTrack] = useState(true);

  // Receive form
  const [receiveStudio, setReceiveStudio] = useState<string>(studio === 'all' ? 'Putney' : studio);
  const [receiveLines, setReceiveLines] = useState<{ productId: string; qty: string }[]>([{ productId: '', qty: '' }]);
  const [receiveNote, setReceiveNote] = useState('');

  // Stocktake
  const [takeStudio, setTakeStudio] = useState<string>(studio === 'all' ? 'Putney' : studio);
  const [takeCounts, setTakeCounts] = useState<Record<string, string>>({});
  const [takeNote, setTakeNote] = useState('');

  const overviewStudio = isSuperAdmin ? studio : studio; // single-studio staff already scoped
  const loadOverview = useCallback(async () => {
    try {
      const r = await eposStockOverview(staff, overviewStudio);
      setRows(r.rows); setStockStudios(r.studios);
    } catch (e) { showToast((e as Error).message, 'error'); }
  }, [staff, overviewStudio, showToast]);

  const loadMovements = useCallback(async () => {
    try {
      const r = await eposStockMovements(staff, { studio: mvStudio === 'all' ? undefined : mvStudio, type: mvType || undefined, limit: 300 });
      setMovements(r.movements);
    } catch (e) { showToast((e as Error).message, 'error'); }
  }, [staff, mvStudio, mvType, showToast]);

  const loadReorder = useCallback(async () => {
    try {
      const studios = studio === 'all' ? ['Putney', 'Wimbledon'] : [studio];
      const all: ReorderRow[] = [];
      for (const s of studios) {
        const r = await eposStockReorderList(staff, s);
        all.push(...r.reorder);
      }
      setReorder(all);
    } catch (e) { showToast((e as Error).message, 'error'); }
  }, [staff, studio, showToast]);

  const loadStocktakes = useCallback(async () => {
    try {
      const r = await eposStocktakeList(staff, studio === 'all' ? undefined : studio);
      setStocktakes(r.stocktakes);
    } catch (e) { showToast((e as Error).message, 'error'); }
  }, [staff, studio, showToast]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (sub === 'movements') loadMovements(); }, [sub, loadMovements]);
  useEffect(() => { if (sub === 'reorder') loadReorder(); }, [sub, loadReorder]);
  useEffect(() => { if (sub === 'stocktake') loadStocktakes(); }, [sub, loadStocktakes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => !q || r.name.toLowerCase().includes(q) || (r.sku || '').toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }, [rows, search]);

  const lowCount = rows.reduce((n, r) => n + Object.values(r.studios).filter(s => s.low).length, 0);

  const submitAdjust = async () => {
    if (!adjustTarget) return;
    const q = parseInt(adjustQty, 10);
    if (!Number.isInteger(q) || q === 0) { showToast('Enter a non-zero quantity (negative to remove)', 'error'); return; }
    setBusy(true);
    try {
      await eposStockAdjust(staff, { studio: adjustStudio, productId: adjustTarget.id, changeQty: q, reason: adjustReason });
      showToast(`Adjusted ${adjustTarget.name} by ${q} at ${adjustStudio}`, 'success');
      setAdjustTarget(null); setAdjustQty('');
      await loadOverview();
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const submitTransfer = async () => {
    if (!transferTarget) return;
    const q = parseInt(transferQty, 10);
    if (!Number.isInteger(q) || q <= 0) { showToast('Enter a positive quantity', 'error'); return; }
    const [fromStudio, toStudio] = transferDir.split('>');
    setBusy(true);
    try {
      await eposStockTransfer(staff, { productId: transferTarget.id, fromStudio, toStudio, qty: q, note: transferNote || undefined });
      showToast(`Transferred ${q} × ${transferTarget.name} ${fromStudio} → ${toStudio}`, 'success');
      setTransferTarget(null); setTransferQty(''); setTransferNote('');
      await loadOverview();
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const submitLevels = async () => {
    if (!levelsTarget) return;
    setBusy(true);
    try {
      await eposStockSetLevels(staff, {
        productId: levelsTarget.id, studio: levelsStudio,
        minStock: parseInt(levelsMin, 10) || 0, reorderQty: parseInt(levelsReorder, 10) || 0,
        trackStock: levelsTrack,
      });
      showToast(`Levels saved for ${levelsTarget.name}`, 'success');
      setLevelsTarget(null);
      await loadOverview();
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const submitReceive = async () => {
    const items = receiveLines.filter(l => l.productId && parseInt(l.qty, 10) > 0)
      .map(l => ({ productId: l.productId, qty: parseInt(l.qty, 10) }));
    if (!items.length) { showToast('Add at least one product with a quantity', 'error'); return; }
    setBusy(true);
    try {
      await eposStockReceive(staff, { studio: receiveStudio, items, note: receiveNote || undefined });
      showToast(`Received ${items.length} line${items.length !== 1 ? 's' : ''} into ${receiveStudio}`, 'success');
      setReceiveLines([{ productId: '', qty: '' }]); setReceiveNote('');
      await loadOverview();
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const submitStocktake = async () => {
    const counts = rows.filter(r => r.track_stock).map(r => ({
      productId: r.id, counted: parseInt(takeCounts[r.id] ?? '', 10),
    })).filter(c => Number.isInteger(c.counted));
    if (!counts.length) { showToast('Enter at least one counted quantity', 'error'); return; }
    setBusy(true);
    try {
      const r = await eposStocktakeSubmit(staff, { studio: takeStudio, counts, note: takeNote || undefined });
      showToast(`Stocktake applied — ${r.differences} adjustment${r.differences !== 1 ? 's' : ''} made`, 'success');
      setTakeCounts({}); setTakeNote('');
      await Promise.all([loadOverview(), loadStocktakes()]);
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const loadReport = async () => {
    setBusy(true);
    try {
      const r = await eposStockReport(staff, {
        studio: reportStudio === 'all' ? undefined : reportStudio,
        from: reportFrom, to: reportTo,
        categoryId: reportCategory || undefined,
      });
      setReport(r);
    } catch (e) { showToast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const exportCsv = () => {
    if (!report) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'product,category,qty_sold,revenue,putney_qty,putney_rev,wimbledon_qty,wimbledon_rev,received,breakages,adjustments,transfers_in,transfers_out,stocktake_diff',
      ...report.products.map(p => [
        esc(p.name), esc(p.category), p.qty_sold, p.revenue.toFixed(2),
        p.by_studio.Putney?.qty ?? 0, (p.by_studio.Putney?.revenue ?? 0).toFixed(2),
        p.by_studio.Wimbledon?.qty ?? 0, (p.by_studio.Wimbledon?.revenue ?? 0).toFixed(2),
        p.received, p.breakages, p.adjustments, p.transfers_in, p.transfers_out, p.stocktake,
      ].join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `stock-report-${reportFrom}-to-${reportTo}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const categories = useMemo(() => [...new Set(rows.map(r => r.category))].sort(), [rows]);
  const studioCols = isSuperAdmin && studio === 'all' ? [...STUDIOS] : [stockStudios[0] || (studio === 'all' ? 'Putney' : studio)];
  const trackedRows = rows.filter(r => r.track_stock);

  const subTabs: { v: SubView; label: string; show: boolean }[] = [
    { v: 'overview', label: 'Overview', show: true },
    { v: 'receive', label: 'Receive', show: canStock },
    { v: 'movements', label: 'Movements', show: true },
    { v: 'reorder', label: `Reorder${lowCount ? ` (${lowCount})` : ''}`, show: true },
    { v: 'stocktake', label: 'Stocktake', show: canStock },
    { v: 'reports', label: 'Reports', show: isSuperAdmin },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-white rounded-xl border-2 border-[#1B2D3C]/10 p-1">
          {subTabs.filter(t => t.show).map(t => (
            <button key={t.v} onClick={() => setSub(t.v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer ${sub === t.v ? 'bg-[#1B2D3C] text-white' : 'text-[#1B2D3C]/60 hover:text-[#1B2D3C]'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B2D3C]/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" className={`${inputCls} w-full pl-9`} />
        </div>
        {lowCount > 0 && sub === 'overview' && (
          <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-black">{lowCount} low-stock item{lowCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      {sub === 'overview' && (
        <div className={cardCls + ' p-0 overflow-hidden'}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 border-b-2 border-[#1B2D3C]/10 bg-[#F5F2E8]">
                <th className="px-3 py-2">Product</th>
                {isSuperAdmin && studio === 'all' ? (
                  <>
                    <th className="px-3 py-2 text-center">Putney</th>
                    <th className="px-3 py-2 text-center">Wimbledon</th>
                    <th className="px-3 py-2 text-center">Total</th>
                  </>
                ) : <th className="px-3 py-2 text-center">{studioCols[0]}</th>}
                <th className="px-3 py-2 text-center">Sold</th>
                <th className="px-3 py-2 text-center">Min</th>
                {canStock && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const per = r.studios;
                const totalQty = Object.values(per).reduce((n, s) => n + s.quantity, 0);
                const totalSold = Object.values(per).reduce((n, s) => n + s.qty_sold, 0);
                const anyLow = Object.values(per).some(s => s.low);
                return (
                  <tr key={r.id} className={`border-b border-[#1B2D3C]/5 ${anyLow ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="font-bold text-[#1B2D3C]">{r.name}</div>
                      <div className="text-[10px] text-[#1B2D3C]/50">{r.category} · {fmt(r.price)}{!r.track_stock && ' · not tracked'}</div>
                    </td>
                    {isSuperAdmin && studio === 'all' ? (
                      <>
                        <td className="px-3 py-2 text-center"><QtyBadge qty={per.Putney?.quantity ?? 0} min={per.Putney?.min_stock ?? 0} track={r.track_stock} /></td>
                        <td className="px-3 py-2 text-center"><QtyBadge qty={per.Wimbledon?.quantity ?? 0} min={per.Wimbledon?.min_stock ?? 0} track={r.track_stock} /></td>
                        <td className="px-3 py-2 text-center font-black">{r.track_stock ? totalQty : '—'}</td>
                      </>
                    ) : (
                      <td className="px-3 py-2 text-center"><QtyBadge qty={per[studioCols[0]]?.quantity ?? 0} min={per[studioCols[0]]?.min_stock ?? 0} track={r.track_stock} /></td>
                    )}
                    <td className="px-3 py-2 text-center font-semibold">{totalSold}</td>
                    <td className="px-3 py-2 text-center text-[#1B2D3C]/60">{Object.values(per)[0]?.min_stock ?? 0}</td>
                    {canStock && (
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => { setLevelsTarget(r); const s = per[studioCols[0]]; setLevelsMin(String(s?.min_stock ?? 0)); setLevelsReorder(String(s?.reorder_qty ?? 0)); setLevelsTrack(r.track_stock); }}
                            className="px-2 py-1 rounded-md text-[10px] font-bold bg-[#F5F2E8] text-[#1B2D3C] cursor-pointer">Levels</button>
                          {r.track_stock && <>
                            <button onClick={() => { setAdjustTarget(r); setAdjustStudio(studioCols[0]); }}
                              className="px-2 py-1 rounded-md text-[10px] font-bold bg-[#D6E2E9] text-[#1B2D3C] cursor-pointer">Adjust</button>
                            {isSuperAdmin && studio === 'all' && (
                              <button onClick={() => setTransferTarget(r)}
                                className="px-2 py-1 rounded-md text-[10px] font-bold bg-[#1B2D3C] text-white cursor-pointer"><ArrowRightLeft className="w-3 h-3 inline" /></button>
                            )}
                          </>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-[#1B2D3C]/40 text-sm">No products match</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'receive' && canStock && (
        <div className={cardCls + ' space-y-3 max-w-2xl'}>
          <h3 className="font-black text-[#1B2D3C] text-sm uppercase tracking-wider">Receive delivery</h3>
          <div className="flex gap-2">
            <select value={receiveStudio} onChange={e => setReceiveStudio(e.target.value)} className={inputCls}>
              {(isSuperAdmin ? [...STUDIOS] : stockStudios).map(s => <option key={s}>{s}</option>)}
            </select>
            <input value={receiveNote} onChange={e => setReceiveNote(e.target.value)} placeholder="Delivery note (optional)" className={`${inputCls} flex-1`} />
          </div>
          {receiveLines.map((l, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select value={l.productId} onChange={e => setReceiveLines(receiveLines.map((x, j) => j === i ? { ...x, productId: e.target.value } : x))} className={`${inputCls} flex-1`}>
                <option value="">Select product…</option>
                {trackedRows.map(r => <option key={r.id} value={r.id}>{r.name} ({r.category})</option>)}
              </select>
              <input value={l.qty} onChange={e => setReceiveLines(receiveLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                type="number" min="1" placeholder="Qty" className={`${inputCls} w-24`} />
              <button onClick={() => setReceiveLines(receiveLines.filter((_, j) => j !== i))} className="text-red-400 font-black px-1 cursor-pointer">✕</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setReceiveLines([...receiveLines, { productId: '', qty: '' }])}
              className="px-3 py-2 rounded-lg bg-[#F5F2E8] text-[#1B2D3C] text-xs font-bold cursor-pointer flex items-center gap-1"><Plus className="w-3 h-3" /> Line</button>
            <button onClick={submitReceive} disabled={busy} className={btnCls}>Confirm receipt</button>
          </div>
        </div>
      )}

      {sub === 'movements' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={mvStudio} onChange={e => setMvStudio(e.target.value)} className={inputCls}>
              {isSuperAdmin && <option value="all">All studios</option>}
              {STUDIOS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={mvType} onChange={e => setMvType(e.target.value)} className={inputCls}>
              <option value="">All types</option>
              {MOVEMENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
            <button onClick={loadMovements} className={btnCls}>Refresh</button>
          </div>
          <div className={cardCls + ' p-0 overflow-hidden'}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 border-b-2 border-[#1B2D3C]/10 bg-[#F5F2E8]">
                  <th className="px-3 py-2">When</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Studio</th>
                  <th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2 text-right">After</th><th className="px-3 py-2">By</th><th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id} className="border-b border-[#1B2D3C]/5">
                    <td className="px-3 py-2 text-xs text-[#1B2D3C]/60 whitespace-nowrap">{new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-3 py-2 font-semibold">{m.epos_products?.name || '—'}</td>
                    <td className="px-3 py-2">{m.studio}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${m.type === 'sale' ? 'bg-slate-100 text-slate-600' : m.change_qty > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{m.type.replace('_', ' ')}</span></td>
                    <td className={`px-3 py-2 text-right font-black ${m.change_qty > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{m.change_qty > 0 ? '+' : ''}{m.change_qty}</td>
                    <td className="px-3 py-2 text-right font-semibold">{m.quantity_after}</td>
                    <td className="px-3 py-2 text-xs">{m.staff_name || '—'}</td>
                    <td className="px-3 py-2 text-xs text-[#1B2D3C]/60">{m.reason || '—'}</td>
                  </tr>
                ))}
                {movements.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-[#1B2D3C]/40 text-sm">No movements yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === 'reorder' && (
        <div className={cardCls + ' p-0 overflow-hidden'}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 border-b-2 border-[#1B2D3C]/10 bg-[#F5F2E8]">
                <th className="px-3 py-2">Product</th><th className="px-3 py-2">Studio</th>
                <th className="px-3 py-2 text-center">In stock</th><th className="px-3 py-2 text-center">Min</th>
                <th className="px-3 py-2 text-center">Reorder qty</th>
              </tr>
            </thead>
            <tbody>
              {reorder.map((r, i) => (
                <tr key={`${r.product_id}-${r.studio}-${i}`} className="border-b border-[#1B2D3C]/5">
                  <td className="px-3 py-2 font-semibold">{r.epos_products?.name || '—'}</td>
                  <td className="px-3 py-2">{r.studio}</td>
                  <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-black ${r.quantity <= 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.quantity}</span></td>
                  <td className="px-3 py-2 text-center">{r.min_stock}</td>
                  <td className="px-3 py-2 text-center font-bold">{r.reorder_qty || '—'}</td>
                </tr>
              ))}
              {reorder.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-[#1B2D3C]/40 text-sm">Nothing needs reordering — all stock levels are healthy</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'stocktake' && canStock && (
        <div className="space-y-4">
          <div className={cardCls + ' space-y-3 max-w-2xl'}>
            <h3 className="font-black text-[#1B2D3C] text-sm uppercase tracking-wider flex items-center gap-2"><ClipboardList className="w-4 h-4" /> New stocktake</h3>
            <p className="text-xs text-[#1B2D3C]/60">Enter the physical count for each product at the selected studio. Differences apply immediately and are recorded as stocktake adjustments.</p>
            <select value={takeStudio} onChange={e => setTakeStudio(e.target.value)} className={inputCls}>
              {(isSuperAdmin ? [...STUDIOS] : stockStudios).map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="max-h-72 overflow-y-auto border border-[#1B2D3C]/10 rounded-xl divide-y divide-[#1B2D3C]/5">
              {trackedRows.map(r => {
                const exp = r.studios[takeStudio]?.quantity ?? 0;
                const c = takeCounts[r.id];
                const diff = c !== undefined && c !== '' ? parseInt(c, 10) - exp : null;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[#1B2D3C] truncate">{r.name}</div>
                      <div className="text-[10px] text-[#1B2D3C]/50">Expected: {exp}</div>
                    </div>
                    <input value={c ?? ''} onChange={e => setTakeCounts({ ...takeCounts, [r.id]: e.target.value })}
                      type="number" min="0" placeholder="count" className={`${inputCls} w-20 text-center`} />
                    {diff !== null && Number.isInteger(diff) && (
                      <span className={`text-xs font-black w-10 text-right ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-[#1B2D3C]/40'}`}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <input value={takeNote} onChange={e => setTakeNote(e.target.value)} placeholder="Note (optional)" className={inputCls + ' w-full'} />
            <button onClick={submitStocktake} disabled={busy} className={btnCls}>Submit stocktake</button>
          </div>
          <div className={cardCls + ' p-0 overflow-hidden'}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 border-b-2 border-[#1B2D3C]/10 bg-[#F5F2E8]">
                  <th className="px-3 py-2">Date</th><th className="px-3 py-2">Studio</th><th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Lines</th><th className="px-3 py-2">Adjustments</th><th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {stocktakes.map(s => (
                  <tr key={s.id} className="border-b border-[#1B2D3C]/5">
                    <td className="px-3 py-2 text-xs">{new Date(s.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-3 py-2">{s.studio}</td>
                    <td className="px-3 py-2">{s.staff_name || '—'}</td>
                    <td className="px-3 py-2">{s.epos_stocktake_items?.length ?? '—'}</td>
                    <td className="px-3 py-2">{s.epos_stocktake_items?.filter(i => i.difference !== 0).length ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-[#1B2D3C]/60">{s.note || '—'}</td>
                  </tr>
                ))}
                {stocktakes.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-[#1B2D3C]/40 text-sm">No stocktakes yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sub === 'reports' && isSuperAdmin && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-[10px] font-bold uppercase text-[#1B2D3C]/60">From<input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} className={inputCls + ' block mt-0.5'} /></label>
            <label className="text-[10px] font-bold uppercase text-[#1B2D3C]/60">To<input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} className={inputCls + ' block mt-0.5'} /></label>
            <select value={reportStudio} onChange={e => setReportStudio(e.target.value)} className={inputCls}>
              <option value="all">All studios</option>{STUDIOS.map(s => <option key={s}>{s}</option>)}
            </select>
            <select value={reportCategory} onChange={e => setReportCategory(e.target.value)} className={inputCls}>
              <option value="">All categories</option>{categories.map(c => <option key={c} value={rows.find(r => r.category === c)?.category_id || ''}>{c}</option>)}
            </select>
            <button onClick={loadReport} disabled={busy} className={btnCls}>Run report</button>
            {report && <button onClick={exportCsv} className="px-3 py-2 rounded-lg bg-emerald-50 border-2 border-emerald-500/30 text-emerald-700 text-xs font-bold uppercase cursor-pointer flex items-center gap-1"><Download className="w-3 h-3" /> CSV</button>}
            {report && (
              <button onClick={() => setReportSort(reportSort === 'best' ? 'slow' : 'best')}
                className="px-3 py-2 rounded-lg bg-[#F5F2E8] text-[#1B2D3C] text-xs font-bold cursor-pointer">
                Sort: {reportSort === 'best' ? 'best sellers ↓' : 'slow movers ↑'}
              </button>
            )}
          </div>
          {report && (
            <>
              <div className="grid grid-cols-2 gap-3 max-w-xl">
                {Object.entries(report.byStudio).map(([s, v]) => (
                  <div key={s} className={cardCls}>
                    <div className="text-[10px] font-bold uppercase text-[#1B2D3C]/50">{s}</div>
                    <div className="text-xl font-black text-[#1B2D3C]">{v.qty} sold · {fmt(v.revenue)}</div>
                  </div>
                ))}
              </div>
              <div className={cardCls + ' p-0 overflow-hidden'}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 border-b-2 border-[#1B2D3C]/10 bg-[#F5F2E8]">
                      <th className="px-3 py-2">Product</th><th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2 text-center">Sold</th><th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-center">Received</th><th className="px-3 py-2 text-center">Breakages</th>
                      <th className="px-3 py-2 text-center">Transfers</th><th className="px-3 py-2 text-center">Adjustments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.products].sort((a, b) => reportSort === 'best' ? b.qty_sold - a.qty_sold : a.qty_sold - b.qty_sold).map(p => (
                      <tr key={p.product_id} className="border-b border-[#1B2D3C]/5">
                        <td className="px-3 py-2 font-semibold">{p.name}</td>
                        <td className="px-3 py-2 text-xs text-[#1B2D3C]/60">{p.category}</td>
                        <td className="px-3 py-2 text-center font-black">{p.qty_sold}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmt(p.revenue)}</td>
                        <td className="px-3 py-2 text-center">{p.received || '—'}</td>
                        <td className="px-3 py-2 text-center">{p.breakages ? <span className="text-red-600 font-bold">{p.breakages}</span> : '—'}</td>
                        <td className="px-3 py-2 text-center">{(p.transfers_in || p.transfers_out) ? `${p.transfers_in} in / ${p.transfers_out} out` : '—'}</td>
                        <td className="px-3 py-2 text-center">{p.adjustments || '—'}</td>
                      </tr>
                    ))}
                    {report.products.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-[#1B2D3C]/40 text-sm">No data in this range</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- Adjust modal ---- */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setAdjustTarget(null)}>
          <div className="bg-white rounded-2xl p-5 w-[380px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-3">Adjust — {adjustTarget.name}</h3>
            <select value={adjustStudio} onChange={e => setAdjustStudio(e.target.value)} className={inputCls + ' w-full mb-2'}>
              {stockStudios.map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setAdjustQty(String((parseInt(adjustQty, 10) || 0) - 1))} className="px-3 py-2 rounded-lg bg-[#F5F2E8] font-black cursor-pointer"><Minus className="w-4 h-4" /></button>
              <input value={adjustQty} onChange={e => setAdjustQty(e.target.value)} type="number" placeholder="e.g. -2 or +10" className={inputCls + ' flex-1 text-center'} />
              <button onClick={() => setAdjustQty(String((parseInt(adjustQty, 10) || 0) + 1))} className="px-3 py-2 rounded-lg bg-[#F5F2E8] font-black cursor-pointer"><Plus className="w-4 h-4" /></button>
            </div>
            <select value={adjustReason} onChange={e => setAdjustReason(e.target.value)} className={inputCls + ' w-full mb-3'}>
              {ADJUST_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setAdjustTarget(null)} className="flex-1 py-2 rounded-lg border-2 border-[#1B2D3C]/15 text-xs font-bold cursor-pointer">Cancel</button>
              <button onClick={submitAdjust} disabled={busy} className={btnCls + ' flex-1'}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Transfer modal ---- */}
      {transferTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setTransferTarget(null)}>
          <div className="bg-white rounded-2xl p-5 w-[380px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-3">Transfer — {transferTarget.name}</h3>
            <select value={transferDir} onChange={e => setTransferDir(e.target.value as typeof transferDir)} className={inputCls + ' w-full mb-2'}>
              <option value="Putney>Wimbledon">Putney → Wimbledon</option>
              <option value="Wimbledon>Putney">Wimbledon → Putney</option>
            </select>
            <input value={transferQty} onChange={e => setTransferQty(e.target.value)} type="number" min="1" placeholder="Quantity" className={inputCls + ' w-full mb-2'} />
            <input value={transferNote} onChange={e => setTransferNote(e.target.value)} placeholder="Note (optional)" className={inputCls + ' w-full mb-3'} />
            <div className="flex gap-2">
              <button onClick={() => setTransferTarget(null)} className="flex-1 py-2 rounded-lg border-2 border-[#1B2D3C]/15 text-xs font-bold cursor-pointer">Cancel</button>
              <button onClick={submitTransfer} disabled={busy} className={btnCls + ' flex-1'}>Transfer</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Levels modal ---- */}
      {levelsTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setLevelsTarget(null)}>
          <div className="bg-white rounded-2xl p-5 w-[380px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-3">Stock levels — {levelsTarget.name}</h3>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C] mb-2 cursor-pointer">
              <input type="checkbox" checked={levelsTrack} onChange={e => setLevelsTrack(e.target.checked)} className="w-4 h-4 accent-[#1B2D3C]" />
              Track stock for this product
            </label>
            <select value={levelsStudio} onChange={e => setLevelsStudio(e.target.value)} className={inputCls + ' w-full mb-2'}>
              {stockStudios.map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <label className="text-[10px] font-bold uppercase text-[#1B2D3C]/60">Min level<input value={levelsMin} onChange={e => setLevelsMin(e.target.value)} type="number" min="0" className={inputCls + ' w-full mt-0.5'} /></label>
              <label className="text-[10px] font-bold uppercase text-[#1B2D3C]/60">Reorder qty<input value={levelsReorder} onChange={e => setLevelsReorder(e.target.value)} type="number" min="0" className={inputCls + ' w-full mt-0.5'} /></label>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setLevelsTarget(null)} className="flex-1 py-2 rounded-lg border-2 border-[#1B2D3C]/15 text-xs font-bold cursor-pointer">Cancel</button>
              <button onClick={submitLevels} disabled={busy} className={btnCls + ' flex-1'}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* low-stock banner shortcut */}
      {sub !== 'reorder' && lowCount > 0 && (
        <button onClick={() => setSub('reorder')} className="w-full text-left px-4 py-2.5 rounded-xl bg-amber-50 border-2 border-amber-300/50 text-amber-800 text-xs font-bold cursor-pointer flex items-center gap-2">
          <Package className="w-4 h-4" /> {lowCount} product{lowCount !== 1 ? 's' : ''} at or below minimum stock — view reorder list
        </button>
      )}
    </div>
  );
}
