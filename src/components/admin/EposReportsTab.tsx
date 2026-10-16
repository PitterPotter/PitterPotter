import { useEffect, useState, useCallback } from 'react';
import type { Staff, EposStudio } from '../../types';
import { eposSalesReport, eposGetReceipt, type EposSalesReport, type EposReceipt } from '../../lib/epos';

interface Props {
  staff: Staff;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const fmt = (n: number) => `£${Number(n).toFixed(2)}`;
const todayIso = () => new Date().toISOString().split('T')[0];
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().split('T')[0];

export default function EposReportsTab({ staff, showToast }: Props) {
  const [studio, setStudio] = useState<string>('all');
  const [range, setRange] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [report, setReport] = useState<EposSalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<EposReceipt | null>(null);

  const isSuperAdmin = staff.role === 'super_admin';
  const studios: string[] = isSuperAdmin ? ['all', 'Putney', 'Wimbledon'] : (staff.allowedStudios || ['all']);

  const load = useCallback(async () => {
    setLoading(true);
    const r = range === 'today' ? { from: todayIso(), to: todayIso() }
      : range === 'week' ? { from: daysAgo(6), to: todayIso() }
      : range === 'month' ? { from: daysAgo(29), to: todayIso() }
      : { from, to };
    try {
      setReport(await eposSalesReport(staff, { studio: studio === 'all' ? undefined : studio as EposStudio, ...r }));
    } catch (e) { showToast((e as Error).message, 'error'); }
    setLoading(false);
  }, [staff, studio, range, from, to, showToast]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    if (!report) return;
    const rows = [
      'order_number,studio,status,table,customer,subtotal,discount,vat,total,paid,created_at',
      ...report.rawOrders.map(o => [
        o.order_number, o.studio, o.status, o.table_id || '', `"${(o.customer_name || '').replace(/"/g, '""')}"`,
        o.subtotal, o.discount_total, o.vat_total, o.total, o.paid_total, o.created_at,
      ].join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    a.download = `epos-sales-${range}-${from}-${to}.csv`;
    a.click();
  };

  const Stat = ({ label, value, tone = '' }: { label: string; value: string; tone?: string }) => (
    <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">{label}</div>
      <div className={`text-2xl font-black ${tone || 'text-[#1B2D3C]'}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-black text-[#1B2D3C] mr-2">EPOS Sales</h2>
        {studios.length > 1 && studios.map(s => (
          <button key={s} onClick={() => setStudio(s)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase cursor-pointer ${studio === s ? 'bg-[#1B2D3C] text-white' : 'bg-white border border-[#1B2D3C]/20 text-[#1B2D3C]'}`}>
            {s === 'all' ? 'All Studios' : s}
          </button>
        ))}
        <div className="w-4" />
        {(['today', 'week', 'month', 'custom'] as const).map(r => (
          <button key={r} onClick={() => setRange(r)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase cursor-pointer ${range === r ? 'bg-[#1B2D3C] text-white' : 'bg-white border border-[#1B2D3C]/20 text-[#1B2D3C]'}`}>
            {r === 'today' ? 'Today' : r === 'week' ? '7 Days' : r === 'month' ? '30 Days' : 'Custom'}
          </button>
        ))}
        {range === 'custom' && (
          <>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm" />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm" />
          </>
        )}
        <button onClick={exportCsv} className="ml-auto px-4 py-2 rounded-xl border border-[#1B2D3C]/20 text-xs font-bold cursor-pointer">Export CSV</button>
      </div>

      {loading && <div className="text-[#1B2D3C]/50 text-sm">Loading…</div>}
      {report && (
        <>
          <div className="grid grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="Orders" value={String(report.orders)} />
            <Stat label="Gross sales" value={fmt(report.gross)} />
            <Stat label="VAT collected" value={fmt(report.vat)} />
            <Stat label="Discounts" value={fmt(report.discounts)} />
            <Stat label="Refunds" value={fmt(report.refunds)} tone="text-red-600" />
            <Stat label="Outstanding" value={fmt(report.outstanding)} tone={report.outstanding > 0 ? 'text-amber-600' : ''} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 p-4">
              <h3 className="font-black text-[#1B2D3C] text-sm mb-2 uppercase tracking-wider">By payment method</h3>
              {Object.entries(report.byMethod).map(([m, v]) => (
                <div key={m} className="flex justify-between py-1.5 text-sm border-b border-[#1B2D3C]/5 last:border-0">
                  <span className="font-bold capitalize text-[#1B2D3C]">{m}</span><span className="font-bold">{fmt(v)}</span>
                </div>
              ))}
              {Object.keys(report.byMethod).length === 0 && <p className="text-xs text-[#1B2D3C]/40">No payments</p>}
            </div>
            <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 p-4">
              <h3 className="font-black text-[#1B2D3C] text-sm mb-2 uppercase tracking-wider">By category</h3>
              {Object.entries(report.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                <div key={c} className="flex justify-between py-1.5 text-sm border-b border-[#1B2D3C]/5 last:border-0">
                  <span className="font-bold text-[#1B2D3C]">{c}</span><span className="font-bold">{fmt(v)}</span>
                </div>
              ))}
              {Object.keys(report.byCategory).length === 0 && <p className="text-xs text-[#1B2D3C]/40">No items</p>}
            </div>
            <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 p-4">
              <h3 className="font-black text-[#1B2D3C] text-sm mb-2 uppercase tracking-wider">VAT breakdown</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase text-[#1B2D3C]/50">
                  <th className="text-left py-1">Rate</th><th className="text-right py-1">Net</th><th className="text-right py-1">VAT</th><th className="text-right py-1">Gross</th>
                </tr></thead>
                <tbody>
                  {Object.entries(report.byVatRate).map(([r, v]) => (
                    <tr key={r} className="border-t border-[#1B2D3C]/5">
                      <td className="py-1.5 font-bold">{r}</td>
                      <td className="py-1.5 text-right">{fmt(v.net)}</td>
                      <td className="py-1.5 text-right">{fmt(v.vat)}</td>
                      <td className="py-1.5 text-right font-bold">{fmt(v.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {Object.keys(report.byVatRate).length === 0 && <p className="text-xs text-[#1B2D3C]/40">No sales</p>}
            </div>
            <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 p-4">
              <h3 className="font-black text-[#1B2D3C] text-sm mb-2 uppercase tracking-wider">By studio</h3>
              {Object.entries(report.byStudio).map(([s, v]) => (
                <div key={s} className="flex justify-between py-1.5 text-sm border-b border-[#1B2D3C]/5 last:border-0">
                  <span className="font-bold text-[#1B2D3C]">{s}</span><span className="font-bold">{fmt(v)}</span>
                </div>
              ))}
              <h3 className="font-black text-[#1B2D3C] text-sm mb-2 mt-4 uppercase tracking-wider">Daily</h3>
              <div className="max-h-40 overflow-y-auto">
                {Object.entries(report.byDay).sort().reverse().map(([d, v]) => (
                  <div key={d} className="flex justify-between py-1 text-xs border-b border-[#1B2D3C]/5 last:border-0">
                    <span className="text-[#1B2D3C]/70">{d}</span><span className="font-bold">{fmt(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 overflow-hidden">
            <h3 className="font-black text-[#1B2D3C] text-sm px-4 pt-3 uppercase tracking-wider">Orders</h3>
            <table className="w-full text-sm mt-1">
              <thead className="text-[10px] uppercase font-bold text-[#1B2D3C]/50">
                <tr>
                  <th className="text-left px-4 py-2">Order</th><th className="text-left px-4 py-2">Studio</th>
                  <th className="text-left px-4 py-2">Table / Customer</th><th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Total</th><th className="text-right px-4 py-2">Paid</th><th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {report.rawOrders.map(o => (
                  <tr key={o.id} className="border-t border-[#1B2D3C]/5 hover:bg-[#F5F2E8]/40">
                    <td className="px-4 py-2 font-bold text-[#1B2D3C]">{o.order_number}<div className="text-[10px] text-[#1B2D3C]/40 font-normal">{new Date(o.created_at).toLocaleString('en-GB')}</div></td>
                    <td className="px-4 py-2 text-[#1B2D3C]/70">{o.studio}</td>
                    <td className="px-4 py-2 text-[#1B2D3C]/70">{o.table_id || '—'} {o.customer_name || o.label || ''}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${o.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : o.status === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{o.status}</span></td>
                    <td className="px-4 py-2 text-right font-bold">{fmt(o.total)}</td>
                    <td className="px-4 py-2 text-right">{fmt(o.paid_total)}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={async () => setReceipt(await eposGetReceipt(staff, o.id))} className="text-xs font-bold text-[#1B2D3C] underline cursor-pointer">Receipt</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {receipt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setReceipt(null)}>
          <div className="bg-white rounded-2xl p-5 w-[460px] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-lg text-[#1B2D3C] mb-2">Receipt — {receipt.order.order_number}</h3>
            <iframe title="receipt" srcDoc={receipt.html} className="w-full h-96 border border-[#1B2D3C]/10 rounded-lg" />
            <button onClick={() => setReceipt(null)} className="mt-3 w-full py-2.5 rounded-xl border border-[#1B2D3C]/20 text-sm font-bold cursor-pointer">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
