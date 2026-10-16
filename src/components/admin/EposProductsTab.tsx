import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { Staff, EposCategory, EposProduct, EposDiscount, EposStudio } from '../../types';
import {
  eposListProductsAdmin, eposSaveProduct, eposDeleteProduct, eposSaveCategory,
  eposDeleteCategory, eposSaveDiscount, eposExportProductsCsv, eposImportProducts,
} from '../../lib/epos';

interface Props {
  staff: Staff;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const VAT_OPTIONS = [
  { value: 'standard', label: 'Standard 20%' },
  { value: 'reduced', label: 'Reduced 5%' },
  { value: 'zero', label: 'Zero-rated 0%' },
  { value: 'exempt', label: 'Exempt' },
] as const;

const emptyProduct = {
  id: undefined as string | undefined, name: '', sku: '', categoryId: '' as string | null,
  price: '', vatTreatment: 'standard', imageUrl: '',
  studios: ['Putney', 'Wimbledon'] as EposStudio[], active: true, sortOrder: 0,
};

export default function EposProductsTab({ staff, showToast }: Props) {
  const [categories, setCategories] = useState<EposCategory[]>([]);
  const [products, setProducts] = useState<EposProduct[]>([]);
  const [discounts, setDiscounts] = useState<EposDiscount[]>([]);
  const [editing, setEditing] = useState<typeof emptyProduct | null>(null);
  const [newCat, setNewCat] = useState({ name: '', color: '#1B2D3C' });
  const [newDisc, setNewDisc] = useState({ name: '', kind: 'percent' as 'percent' | 'fixed', value: '' });
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await eposListProductsAdmin(staff);
      setCategories(d.categories); setProducts(d.products); setDiscounts(d.discounts);
    } catch (e) { showToast((e as Error).message, 'error'); }
  }, [staff, showToast]);

  useEffect(() => { load(); }, [load]);

  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories]);
  const filtered = products.filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));

  const save = async () => {
    if (!editing) return;
    if (!editing.name || !editing.price || isNaN(parseFloat(editing.price))) {
      showToast('Name and a valid price are required', 'error'); return;
    }
    try {
      await eposSaveProduct(staff, {
        id: editing.id, name: editing.name, sku: editing.sku || undefined,
        categoryId: editing.categoryId || null, price: parseFloat(editing.price),
        vatTreatment: editing.vatTreatment, imageUrl: editing.imageUrl || undefined,
        studios: editing.studios, active: editing.active, sortOrder: editing.sortOrder,
      });
      setEditing(null);
      await load();
      showToast('Product saved', 'success');
    } catch (e) { showToast((e as Error).message, 'error'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-black text-[#1B2D3C]">EPOS Products</h2>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…"
          className="px-3 py-1.5 rounded-lg border border-[#1B2D3C]/20 text-sm" />
        <div className="flex-1" />
        <button onClick={async () => {
          try {
            const csv = await eposExportProductsCsv(staff);
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'epos-products.csv'; a.click();
          } catch (e) { showToast((e as Error).message, 'error'); }
        }} className="px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-xs font-bold cursor-pointer">Export CSV</button>
        <button onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-xs font-bold cursor-pointer">Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          const text = await f.text();
          try {
            const r = await eposImportProducts(staff, text);
            showToast(`Imported ${r.imported} products`, 'success'); await load();
          } catch (err) { showToast((err as Error).message, 'error'); }
          e.target.value = '';
        }} />
        <button onClick={() => setEditing({ ...emptyProduct })}
          className="px-4 py-2 rounded-lg bg-[#1B2D3C] text-white text-xs font-bold uppercase cursor-pointer">+ New Product</button>
      </div>

      {/* Product form */}
      {editing && (
        <div className="bg-[#F5F2E8] rounded-2xl p-4 border border-[#1B2D3C]/10 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Product name *"
              className="px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm" />
            <input value={editing.sku} onChange={e => setEditing({ ...editing, sku: e.target.value })} placeholder="SKU / code"
              className="px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm" />
            <input value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} placeholder="Price £ (VAT-inclusive) *" inputMode="decimal"
              className="px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm" />
            <select value={editing.vatTreatment} onChange={e => setEditing({ ...editing, vatTreatment: e.target.value })}
              className="px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm bg-white">
              {VAT_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <select value={editing.categoryId || ''} onChange={e => setEditing({ ...editing, categoryId: e.target.value || null })}
              className="px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm bg-white">
              <option value="">No category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={editing.imageUrl} onChange={e => setEditing({ ...editing, imageUrl: e.target.value })} placeholder="Image URL (optional)"
              className="px-3 py-2.5 rounded-lg border border-[#1B2D3C]/20 text-sm" />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[10px] font-bold uppercase text-[#1B2D3C]/60">Available at:</span>
            {(['Putney', 'Wimbledon'] as const).map(s => (
              <label key={s} className="flex items-center gap-1.5 text-xs font-bold text-[#1B2D3C] cursor-pointer">
                <input type="checkbox" checked={editing.studios.includes(s)}
                  onChange={e => setEditing({ ...editing, studios: e.target.checked ? [...editing.studios, s] : editing.studios.filter(x => x !== s) })}
                  className="w-4 h-4 accent-[#1B2D3C]" />{s}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-xs font-bold text-[#1B2D3C] cursor-pointer ml-4">
              <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })}
                className="w-4 h-4 accent-[#1B2D3C]" />Available on till
            </label>
            <input type="number" value={editing.sortOrder} onChange={e => setEditing({ ...editing, sortOrder: parseInt(e.target.value) || 0 })}
              className="w-20 px-2 py-1.5 rounded-lg border border-[#1B2D3C]/20 text-sm" title="Sort order" />
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="px-5 py-2.5 rounded-xl bg-[#1B2D3C] text-white text-sm font-bold cursor-pointer">Save product</button>
            <button onClick={() => setEditing(null)} className="px-5 py-2.5 rounded-xl border border-[#1B2D3C]/20 text-sm font-bold cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      {/* Product list */}
      <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F5F2E8] text-[10px] uppercase font-bold text-[#1B2D3C]/60">
            <tr>
              <th className="text-left px-4 py-2">Product</th>
              <th className="text-left px-4 py-2">Category</th>
              <th className="text-right px-4 py-2">Price</th>
              <th className="text-left px-4 py-2">VAT</th>
              <th className="text-left px-4 py-2">Studios</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className="border-t border-[#1B2D3C]/5 hover:bg-[#F5F2E8]/40">
                <td className="px-4 py-2.5 font-bold text-[#1B2D3C]">{p.name}{p.sku && <span className="ml-2 text-[10px] text-[#1B2D3C]/40 font-normal">{p.sku}</span>}</td>
                <td className="px-4 py-2.5 text-[#1B2D3C]/70">{catName.get(p.category_id || '') || '—'}</td>
                <td className="px-4 py-2.5 text-right font-bold">£{Number(p.price).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-[#1B2D3C]/70">{VAT_OPTIONS.find(v => v.value === p.vat_treatment)?.label || p.vat_treatment}</td>
                <td className="px-4 py-2.5 text-[#1B2D3C]/70 text-xs">{p.studios.join(' + ')}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.active ? 'Live' : 'Hidden'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => setEditing({
                    id: p.id, name: p.name, sku: p.sku || '', categoryId: p.category_id,
                    price: String(p.price), vatTreatment: p.vat_treatment, imageUrl: p.image_url || '',
                    studios: p.studios, active: p.active, sortOrder: p.sort_order,
                  })} className="text-xs font-bold text-[#1B2D3C] underline cursor-pointer mr-3">Edit</button>
                  <button onClick={async () => {
                    if (!confirm(`Remove "${p.name}"?${''} Products on past orders are kept and just hidden.`)) return;
                    try {
                      const r = await eposDeleteProduct(staff, p.id);
                      showToast(r.deactivated ? 'Product hidden (used on orders)' : 'Product deleted', 'success');
                      await load();
                    } catch (e) { showToast((e as Error).message, 'error'); }
                  }} className="text-xs font-bold text-red-500 underline cursor-pointer">Remove</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-[#1B2D3C]/40">No products yet — add your first one above, or import a CSV</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Categories */}
      <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 p-4">
        <h3 className="font-black text-[#1B2D3C] mb-3">Categories</h3>
        <div className="flex gap-2 mb-3">
          <input value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder="New category name"
            className="px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm" />
          <input type="color" value={newCat.color} onChange={e => setNewCat({ ...newCat, color: e.target.value })}
            className="w-10 h-10 rounded-lg border border-[#1B2D3C]/20 cursor-pointer" />
          <button onClick={async () => {
            if (!newCat.name.trim()) return;
            try { await eposSaveCategory(staff, { name: newCat.name.trim(), color: newCat.color, sortOrder: categories.length + 1 }); setNewCat({ name: '', color: '#1B2D3C' }); await load(); }
            catch (e) { showToast((e as Error).message, 'error'); }
          }} className="px-4 py-2 rounded-lg bg-[#1B2D3C] text-white text-xs font-bold cursor-pointer">Add</button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map(c => (
            <span key={c.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ backgroundColor: c.color }}>
              {c.name}
              <button onClick={async () => {
                try { await eposDeleteCategory(staff, c.id); await load(); } catch (e) { showToast((e as Error).message, 'error'); }
              }} className="opacity-70 hover:opacity-100 cursor-pointer">✕</button>
            </span>
          ))}
        </div>
      </div>

      {/* Discounts */}
      <div className="bg-white rounded-2xl border border-[#1B2D3C]/10 p-4">
        <h3 className="font-black text-[#1B2D3C] mb-3">Preset Discounts</h3>
        <div className="flex gap-2 mb-3 flex-wrap">
          <input value={newDisc.name} onChange={e => setNewDisc({ ...newDisc, name: e.target.value })} placeholder="Name (e.g. Staff 10%)"
            className="px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm" />
          <select value={newDisc.kind} onChange={e => setNewDisc({ ...newDisc, kind: e.target.value as 'percent' | 'fixed' })}
            className="px-2 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm bg-white">
            <option value="percent">% off</option>
            <option value="fixed">£ off</option>
          </select>
          <input value={newDisc.value} onChange={e => setNewDisc({ ...newDisc, value: e.target.value })} placeholder="Value" inputMode="decimal"
            className="w-24 px-3 py-2 rounded-lg border border-[#1B2D3C]/20 text-sm" />
          <button onClick={async () => {
            if (!newDisc.name.trim() || !(parseFloat(newDisc.value) > 0)) return;
            try { await eposSaveDiscount(staff, { name: newDisc.name.trim(), kind: newDisc.kind, value: parseFloat(newDisc.value), sortOrder: discounts.length + 1 }); setNewDisc({ name: '', kind: 'percent', value: '' }); await load(); }
            catch (e) { showToast((e as Error).message, 'error'); }
          }} className="px-4 py-2 rounded-lg bg-[#1B2D3C] text-white text-xs font-bold cursor-pointer">Add</button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {discounts.map(d => (
            <span key={d.id} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold ${d.active ? 'bg-[#D6E2E9] text-[#1B2D3C]' : 'bg-slate-100 text-slate-400 line-through'}`}>
              {d.name} · {d.kind === 'percent' ? `${d.value}%` : `£${d.value}`}
              <button onClick={async () => { await eposSaveDiscount(staff, { id: d.id, name: d.name, kind: d.kind, value: d.value, active: !d.active }); await load(); }}
                className="opacity-60 hover:opacity-100 cursor-pointer">{d.active ? 'hide' : 'show'}</button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
