import { useState, FormEvent } from 'react';
import { Gift, Search, AlertCircle, CheckCircle2, ScanLine } from 'lucide-react';
import { Page } from '../types';
import { isSupabaseEnabled } from '../lib/supabase';
import EditableText from './EditableText';
import QRScanner from './QRScanner';

interface GiftCardBalanceViewProps {
  setCurrentPage: (page: Page) => void;
  adminMode?: boolean;
}

interface GiftCardResult {
  code: string;
  amount: number;
  balance: number;
  status: 'active' | 'redeemed' | 'expired';
  expiryDate: string | null;
  covers?: string;
  recipientName?: string;
}

export default function GiftCardBalanceView({ setCurrentPage, adminMode = false }: GiftCardBalanceViewProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GiftCardResult | null>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);

  const handleScan = (scannedCode: string) => {
    setCode(scannedCode);
    setScanning(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);

    if (!code.trim()) {
      setError('Please enter a gift card code');
      return;
    }

    setLoading(true);
    try {
      if (!isSupabaseEnabled()) {
        throw new Error('Gift card lookup unavailable');
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-gift-card`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Gift card not found');
      }

      const expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;

      setResult({
        code: data.code,
        amount: Number(data.amount),
        balance: Number(data.balance),
        status: data.status,
        expiryDate: expiryDate ? expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
        covers: data.covers,
        recipientName: data.recipientName,
      });
    } catch (err) {
      console.error('Balance check error:', err);
      setError(err instanceof Error ? err.message : 'Failed to check balance');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-12">
      <div className="max-w-xl mx-auto bg-white border border-[#1B2D3C]/10 p-6 md:p-8 rounded-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-[#DBE7E4] rounded-full flex items-center justify-center mx-auto">
            <Gift className="w-7 h-7 text-[#1B2D3C]" />
          </div>
          <h1 className="font-heading text-2xl md:text-3xl font-black text-[#1B2D3C]"><EditableText contentKey="giftcardbalance_title" page="gift-card-balance" defaultValue="Gift Card Balance" adminMode={adminMode} className="font-heading text-2xl md:text-3xl text-[#1B2D3C]" /></h1>
          <p className="text-xs text-[#1B2D3C]/70"><EditableText contentKey="giftcardbalance_subtitle" page="gift-card-balance" defaultValue="Enter your gift card code to check the remaining balance." adminMode={adminMode} className="text-xs text-[#1B2D3C]/70" /></p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. PP-ABCD1234EF"
                className="w-full py-3 px-4 pr-12 border border-[#1B2D3C]/20 bg-white text-sm font-bold text-[#1B2D3C] tracking-wider uppercase focus:outline-none focus:bg-[#D6E2E9]/20 rounded-lg"
              />
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1B2D3C]/50" />
            </div>
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="px-4 py-3 bg-[#1B2D3C] text-white rounded-lg hover:bg-[#243B53] transition-colors cursor-pointer flex items-center gap-1.5"
              title="Scan QR code"
            >
              <ScanLine className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">Scan</span>
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 text-red-700 text-xs font-semibold rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest hover:bg-[#D6E2E9] transition-all cursor-pointer rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? <EditableText contentKey="giftcardbalance_checking" page="gift-card-balance" defaultValue="Checking..." adminMode={adminMode} className="text-xs uppercase tracking-widest" /> : <EditableText contentKey="giftcardbalance_check_button" page="gift-card-balance" defaultValue="Check Balance" adminMode={adminMode} className="text-xs uppercase tracking-widest" />}
          </button>
        </form>

        {result && (
          <div className={`p-5 rounded-xl border space-y-3 ${
            result.status === 'expired'
              ? 'bg-red-50 border-red-100'
              : result.status === 'redeemed'
              ? 'bg-stone-50 border-stone-200'
              : 'bg-[#DBE7E4]/20 border-[#DBE7E4]'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-[#1B2D3C]"><EditableText contentKey="giftcardbalance_code_label" page="gift-card-balance" defaultValue="Code" adminMode={adminMode} className="text-xs uppercase tracking-wider text-[#1B2D3C]" /></span>
              <code className="text-sm font-bold text-[#1B2D3C] tracking-wider">{result.code}</code>
            </div>
            {result.covers ? (
              <div className="space-y-1">
                <span className="block text-xs font-black uppercase tracking-wider text-[#1B2D3C]"><EditableText contentKey="giftcardbalance_covers_label" page="gift-card-balance" defaultValue="Voucher Covers" adminMode={adminMode} className="text-xs uppercase tracking-wider text-[#1B2D3C]" /></span>
                <p className="text-base font-bold text-purple-700">{result.covers}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-[#1B2D3C]"><EditableText contentKey="giftcardbalance_balance_label" page="gift-card-balance" defaultValue="Balance" adminMode={adminMode} className="text-xs uppercase tracking-wider text-[#1B2D3C]" /></span>
                  <span className="text-2xl font-black text-[#1B2D3C]">£{result.balance.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-[#1B2D3C]"><EditableText contentKey="giftcardbalance_original_label" page="gift-card-balance" defaultValue="Original Amount" adminMode={adminMode} className="text-xs uppercase tracking-wider text-[#1B2D3C]" /></span>
                  <span className="text-sm font-bold text-[#1B2D3C]">£{result.amount.toFixed(2)}</span>
                </div>
              </>
            )}
            {result.recipientName && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-[#1B2D3C]"><EditableText contentKey="giftcardbalance_recipient_label" page="gift-card-balance" defaultValue="Recipient" adminMode={adminMode} className="text-xs uppercase tracking-wider text-[#1B2D3C]" /></span>
                <span className="text-sm font-bold text-[#1B2D3C]">{result.recipientName}</span>
              </div>
            )}
            {result.expiryDate && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-[#1B2D3C]"><EditableText contentKey="giftcardbalance_expires_label" page="gift-card-balance" defaultValue="Expires" adminMode={adminMode} className="text-xs uppercase tracking-wider text-[#1B2D3C]" /></span>
                <span className="text-sm font-bold text-[#1B2D3C]">{result.expiryDate}</span>
              </div>
            )}
            {result.status === 'active' && (
              <div className="flex justify-center pt-2">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(result.code)}&bgcolor=FFFFFF&color=1B2D3C&margin=0`}
                  alt="Gift card QR code"
                  className="rounded-lg border border-[#1B2D3C]/10"
                  width={120}
                  height={120}
                />
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              {result.status === 'active' && (
                <>
                  <CheckCircle2 className="w-4 h-4 text-green-700" />
                  <span className="text-xs font-bold text-green-700"><EditableText contentKey="giftcardbalance_status_active" page="gift-card-balance" defaultValue="Active" adminMode={adminMode} className="text-xs font-bold text-green-700" /></span>
                </>
              )}
              {result.status === 'expired' && (
                <>
                  <AlertCircle className="w-4 h-4 text-red-700" />
                  <span className="text-xs font-bold text-red-700"><EditableText contentKey="giftcardbalance_status_expired" page="gift-card-balance" defaultValue="Expired" adminMode={adminMode} className="text-xs font-bold text-red-700" /></span>
                </>
              )}
              {result.status === 'redeemed' && (
                <span className="text-xs font-bold text-stone-600"><EditableText contentKey="giftcardbalance_status_redeemed" page="gift-card-balance" defaultValue="Fully redeemed" adminMode={adminMode} className="text-xs font-bold text-stone-600" /></span>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => setCurrentPage('buy-gift-card')}
            className="flex-1 py-3 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-widest hover:bg-[#D6E2E9] cursor-pointer rounded-lg"
          >
            <EditableText contentKey="giftcardbalance_buy_button" page="gift-card-balance" defaultValue="Buy a Gift Card" adminMode={adminMode} className="text-xs uppercase tracking-widest" />
          </button>
          <button
            onClick={() => setCurrentPage('home')}
            className="flex-1 py-3 bg-white border border-[#1B2D3C] text-[#1B2D3C] text-xs font-bold uppercase tracking-widest cursor-pointer rounded-lg"
          >
            <EditableText contentKey="giftcardbalance_home_button" page="gift-card-balance" defaultValue="Home" adminMode={adminMode} className="text-xs uppercase tracking-widest" />
          </button>
        </div>
      </div>

      {scanning && (
        <QRScanner
          onScan={handleScan}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
