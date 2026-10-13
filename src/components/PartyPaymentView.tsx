import { useState, useEffect } from 'react';
import { Minus, Plus, ArrowRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Page } from '../types';

interface PartyPaymentViewProps {
  setCurrentPage: (page: Page) => void;
  adminMode?: boolean;
  successMode?: boolean;
}

interface BookingData {
  bookingId: string;
  name: string;
  studio: string;
  date: string;
  time: string;
  paintersCount: number;
  finalSeats: number | null;
  depositAmount: number;
  depositPaid: boolean;
  depositPaidAt: string | null;
  finalPaidAt: string | null;
  partyPrice: number;
  finalBalance: number;
  paymentStatus: string;
}

export default function PartyPaymentView({ setCurrentPage, successMode = false }: PartyPaymentViewProps) {
  const [booking, setBooking] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seatCount, setSeatCount] = useState(1);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  const bookingId = new URLSearchParams(window.location.search).get('booking') || '';
  const wasCancelled = new URLSearchParams(window.location.search).get('cancelled') === '1';

  useEffect(() => {
    if (!bookingId) {
      setError('Missing booking reference.');
      setLoading(false);
      return;
    }
    fetchBooking();
  }, [bookingId]);

  const fetchBooking = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-party-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ bookingId, action: 'info' }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to load booking');
        setLoading(false);
        return;
      }
      setBooking(data);
      setSeatCount(data.finalSeats || data.paintersCount || 1);
      if (data.finalPaidAt) {
        setPaid(true);
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to load booking:', err);
      setError('Failed to load booking details.');
      setLoading(false);
    }
  };

  const handlePay = async () => {
    if (!booking) return;
    setPaying(true);
    setError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-party-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ bookingId: booking.bookingId, finalSeats: seatCount }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to start payment');
        setPaying(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Payment error:', err);
      setError('Failed to start payment. Please try again.');
      setPaying(false);
    }
  };

  const handlePayDeposit = async () => {
    if (!booking) return;
    setPaying(true);
    setError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-party-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ bookingId: booking.bookingId, action: 'deposit' }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to start payment');
        setPaying(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Payment error:', err);
      setError('Failed to start payment. Please try again.');
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1B2D3C]/40" />
      </div>
    );
  }

  if (successMode) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-20">
        <div className="text-center space-y-6 max-w-md">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h1 className="font-heading text-2xl font-black text-[#1B2D3C]">Payment Complete</h1>
          <p className="text-sm text-[#1B2D3C]/70">Thank you{booking?.name ? `, ${booking.name}` : ''}! Your payment has been received. We look forward to seeing you{booking?.studio ? ` at our ${booking.studio} studio` : ''}.</p>
          {booking && (
            <div className="bg-[#D6E2E9]/30 p-4 rounded-lg text-left space-y-2 text-xs font-semibold text-[#1B2D3C]">
              <p><span className="font-bold">Booking ref:</span> {booking.bookingId}</p>
              <p><span className="font-bold">Date:</span> {booking.date}</p>
              <p><span className="font-bold">Time:</span> {booking.time}</p>
              <p><span className="font-bold">Seats:</span> {booking.finalSeats || booking.paintersCount}</p>
            </div>
          )}
          <button
            onClick={() => setCurrentPage('home')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (paid) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-20">
        <div className="text-center space-y-6 max-w-md">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h1 className="font-heading text-2xl font-black text-[#1B2D3C]">Payment Complete</h1>
          <p className="text-sm text-[#1B2D3C]/70">Thank you! Your final balance has been paid. We look forward to seeing you at your party.</p>
          <button
            onClick={() => setCurrentPage('home')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-20">
        <div className="text-center space-y-6 max-w-md">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto" />
          <h1 className="font-heading text-2xl font-black text-[#1B2D3C]">Something went wrong</h1>
          <p className="text-sm text-[#1B2D3C]/70">{error}</p>
          <button
            onClick={() => setCurrentPage('home')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!booking) return null;

  if (!booking.depositPaid) {
    return (
      <div className="min-h-[60vh] px-4 py-12">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h1 className="font-heading text-3xl font-black text-[#1B2D3C]">Party Deposit</h1>
            <p className="text-sm text-[#1B2D3C]/70">
              Hi {booking.name}, pay your deposit to confirm your party booking.
            </p>
          </div>

          {wasCancelled && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 text-center">
              Payment was cancelled. You can try again below.
            </div>
          )}

          <div className="bg-white border border-[#1B2D3C]/20 rounded-xl p-6 space-y-5 shadow-sm">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#1B2D3C]/60">Studio</span>
                <span className="font-bold text-[#1B2D3C]">{booking.studio}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#1B2D3C]/60">Date</span>
                <span className="font-bold text-[#1B2D3C]">{booking.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#1B2D3C]/60">Time</span>
                <span className="font-bold text-[#1B2D3C]">{booking.time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#1B2D3C]/60">Party size</span>
                <span className="font-bold text-[#1B2D3C]">{booking.paintersCount} painters</span>
              </div>
            </div>

            <div className="border-t border-[#1B2D3C]/10 pt-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#1B2D3C]/60">Party total ({booking.paintersCount} seats)</span>
                <span className="font-semibold text-[#1B2D3C]">£{(booking.paintersCount * booking.partyPrice).toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#1B2D3C]/10">
                <span className="font-black text-[#1B2D3C]">Deposit due now</span>
                <span className="font-heading text-xl font-black text-[#1B2D3C]">£{booking.depositAmount.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-[#1B2D3C]/50">
                The remaining balance of £{Math.max(0, booking.paintersCount * booking.partyPrice - booking.depositAmount).toFixed(2)} is payable on the day of your party.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 text-center">
                {error}
              </div>
            )}

            <button
              onClick={handlePayDeposit}
              disabled={paying}
              className="w-full py-4 bg-[#1B2D3C] text-white font-bold text-sm uppercase tracking-wider rounded-lg hover:bg-[#486581] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {paying ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
              ) : (
                <>Pay £{booking.depositAmount.toFixed(2)} deposit <ArrowRight className="w-4 h-4" /></>
              )}
            </button>

            <p className="text-center text-[10px] text-[#1B2D3C]/50">
              Secure payment powered by Stripe. Your card details are never stored.
            </p>
          </div>

          <div className="text-center">
            <button
              onClick={() => setCurrentPage('home')}
              className="text-xs text-[#1B2D3C]/60 hover:text-[#1B2D3C] transition-colors cursor-pointer"
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const total = seatCount * booking.partyPrice;
  const balance = Math.max(0, total - booking.depositAmount);

  return (
    <div className="min-h-[60vh] px-4 py-12">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-heading text-3xl font-black text-[#1B2D3C]">Final Party Payment</h1>
          <p className="text-sm text-[#1B2D3C]/70">
            Hi {booking.name}, confirm your final numbers and pay your remaining balance.
          </p>
        </div>

        {wasCancelled && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 text-center">
            Payment was cancelled. You can adjust your numbers and try again.
          </div>
        )}

        <div className="bg-white border border-[#1B2D3C]/20 rounded-xl p-6 space-y-5 shadow-sm">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[#1B2D3C]/60">Studio</span>
              <span className="font-bold text-[#1B2D3C]">{booking.studio}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#1B2D3C]/60">Date</span>
              <span className="font-bold text-[#1B2D3C]">{booking.date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#1B2D3C]/60">Time</span>
              <span className="font-bold text-[#1B2D3C]">{booking.time}</span>
            </div>
          </div>

          <div className="border-t border-[#1B2D3C]/10 pt-5">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#1B2D3C] mb-3">
              Have your numbers changed?
            </label>
            <p className="text-xs text-[#1B2D3C]/60 mb-4">
              You originally booked for {booking.paintersCount} painters. Adjust your final seat count below if needed.
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setSeatCount(Math.max(1, seatCount - 1))}
                className="w-10 h-10 rounded-full border border-[#1B2D3C]/20 flex items-center justify-center hover:bg-[#DBE7E4] transition-colors cursor-pointer"
              >
                <Minus className="w-4 h-4 text-[#1B2D3C]" />
              </button>
              <div className="text-center min-w-[80px]">
                <div className="font-heading text-3xl font-black text-[#1B2D3C]">{seatCount}</div>
                <div className="text-[10px] uppercase tracking-wider text-[#1B2D3C]/50">seats</div>
              </div>
              <button
                onClick={() => setSeatCount(seatCount + 1)}
                className="w-10 h-10 rounded-full border border-[#1B2D3C]/20 flex items-center justify-center hover:bg-[#DBE7E4] transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[#1B2D3C]" />
              </button>
            </div>
            {seatCount !== booking.paintersCount && (
              <p className="text-center text-xs text-[#1B2D3C]/60 mt-3">
                {seatCount > booking.paintersCount
                  ? `+${seatCount - booking.paintersCount} extra seat${seatCount - booking.paintersCount > 1 ? 's' : ''}`
                  : `-${booking.paintersCount - seatCount} fewer seat${booking.paintersCount - seatCount > 1 ? 's' : ''}`}
              </p>
            )}
          </div>

          <div className="border-t border-[#1B2D3C]/10 pt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[#1B2D3C]/60">Price per person</span>
              <span className="font-semibold text-[#1B2D3C]">£{booking.partyPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#1B2D3C]/60">Total ({seatCount} seats)</span>
              <span className="font-semibold text-[#1B2D3C]">£{total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#1B2D3C]/60">Deposit paid</span>
              <span className="font-semibold text-[#1B2D3C]">−£{booking.depositAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-[#1B2D3C]/10">
              <span className="font-black text-[#1B2D3C]">Final balance</span>
              <span className="font-heading text-xl font-black text-[#1B2D3C]">£{balance.toFixed(2)}</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 text-center">
              {error}
            </div>
          )}

          <button
            onClick={handlePay}
            disabled={paying || balance <= 0}
            className="w-full py-4 bg-[#1B2D3C] text-white font-bold text-sm uppercase tracking-wider rounded-lg hover:bg-[#486581] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {paying ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
            ) : balance <= 0 ? (
              'No balance to pay'
            ) : (
              <>Pay £{balance.toFixed(2)} <ArrowRight className="w-4 h-4" /></>
            )}
          </button>

          <p className="text-center text-[10px] text-[#1B2D3C]/50">
            Secure payment powered by Stripe. Your card details are never stored.
          </p>
        </div>

        <div className="text-center">
          <button
            onClick={() => setCurrentPage('home')}
            className="text-xs text-[#1B2D3C]/60 hover:text-[#1B2D3C] transition-colors cursor-pointer"
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
