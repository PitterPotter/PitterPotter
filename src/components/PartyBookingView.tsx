import { useState, useEffect } from 'react';
import { Page, BookingInquiry } from '../types';
import Calendar from './Calendar';
import { format, getDay, startOfDay } from 'date-fns';
import { Clock, Calendar as CalendarIcon, ArrowRight, Users, MapPin, Gift, Heart, Briefcase, Copy, Download, Share2 } from 'lucide-react';
import { useToast } from './ToastContext';
import { getRemainingCapacity, getBusyDates } from '../lib/bookings';
import { getSlots, filterPastSlots, DayType } from '../lib/timeSlots';
import { loadClosuresFromSupabase, getClosureDates, ClosureDates, isDateInHolidayRange, getClosedDatesForStudio } from '../lib/closures';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import EditableText from './EditableText';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

type PartyType = 'birthday' | 'baby-shower-hen' | 'corporate';
type Studio = 'Putney' | 'Wimbledon';

interface PartyBookingViewProps {
  partyType: PartyType;
  studio: Studio;
  setCurrentPage: (page: Page) => void;
  adminMode?: boolean;
}

function PaymentForm({ onSuccess, amount, loading, setLoading }: { onSuccess: () => void; amount: number; loading: boolean; setLoading: (v: boolean) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError('');
    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (submitError) {
      setError(submitError.message || 'Payment failed');
      setLoading(false);
      return;
    }
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="border border-[#1B2D3C]/10 rounded-lg p-4 bg-[#FAFAFA]">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
      <button type="submit" disabled={!stripe || loading} className="w-full py-3.5 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest hover:bg-[#D6E2E9] transition-all cursor-pointer rounded-lg disabled:opacity-50">
        {loading ? 'Processing...' : `Pay £${amount.toFixed(2)} deposit`}
      </button>
      <p className="text-[10px] text-[#1B2D3C]/50 text-center">Payments processed securely by Stripe.</p>
    </form>
  );
}

const PARTY_INFO: Record<PartyType, { title: string; price: string; description: string; icon: typeof Gift }> = {
  birthday: {
    title: 'Birthday Party',
    price: '£28.95 per head',
    description: 'A painting party at Pitter Potter is a fun and creative way of celebrating birthdays. We provide the space, materials and help to ensure everything runs smoothly. Included in the cost is the studio fee and an item of pottery up to the value of £22.95.',
    icon: Gift,
  },
  'baby-shower-hen': {
    title: 'Baby Shower / Hen Party',
    price: '£28.95 per head',
    description: 'For the bride, groom or parents to be who are seeking a creative alternative to a traditional celebration. Get everyone to paint a piece for the happy couple or the new addition to the family.',
    icon: Heart,
  },
  corporate: {
    title: 'Corporate Event',
    price: 'Custom Packages',
    description: 'Whether it\'s a team-building exercise or an end-of-year alternative to a Christmas party, Pitter Potter provides a relaxing and meditative activity for your business.',
    icon: Briefcase,
  },
};

const DEFAULT_PARTY_GUEST_LIMIT: Record<Studio, number> = { Putney: 16, Wimbledon: 16 };

function getTimeSlots(date: Date, closures: ClosureDates, studio: 'Putney' | 'Wimbledon'): string[] {
  const day = getDay(date);
  const dateStr = format(date, 'yyyy-MM-dd');
  const isHoliday = isDateInHolidayRange(dateStr, closures.schoolHolidays);
  if (day >= 2 || day === 0 || (day === 1 && isHoliday)) {
    const dayType: DayType = (day === 0 || day === 6) ? 'weekend' : 'weekday';
    return filterPastSlots(getSlots('party', studio, dayType, day), date);
  }
  return [];
}

export default function PartyBookingView({ partyType, studio, setCurrentPage, adminMode = false }: PartyBookingViewProps) {
  const { showToast } = useToast();
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState<string | undefined>(undefined);
  const [guests, setGuests] = useState<number | ''>(8);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [childAge, setChildAge] = useState<number | ''>('');

  const [slotCapacity, setSlotCapacity] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [busyDates, setBusyDates] = useState<Date[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [closures, setClosures] = useState<ClosureDates>(getClosureDates());
  const [partyPrice, setPartyPrice] = useState<number>(28.95);
  const [partyGuestLimit, setPartyGuestLimit] = useState<number>(DEFAULT_PARTY_GUEST_LIMIT[studio]);
  const [depositAmount] = useState<number>(50);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [pendingBooking, setPendingBooking] = useState<BookingInquiry | null>(null);
  const [depositNoticeType, setDepositNoticeType] = useState<'info' | 'warning' | 'success' | 'error'>('info');
  const [redirectConfirming, setRedirectConfirming] = useState(false);
  const [redirectConfirmed, setRedirectConfirmed] = useState(false);

  const info = PARTY_INFO[partyType];
  const IconComponent = info.icon;

  const handleDateSelect = (selectedDate: Date | undefined) => {
    setDate(selectedDate);
    setTime(undefined);
  };

  // Handle return from a bank/3DS redirect — the page reloads with Stripe's
  // payment params, so we must re-confirm server-side to create the booking.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pi = params.get('payment_intent');
    const redirectStatus = params.get('redirect_status');
    if (!pi || !redirectStatus) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (redirectStatus !== 'succeeded') {
      setError('Payment was not completed. Please try again or contact the studio.');
      return;
    }
    setRedirectConfirming(true);
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-party-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ paymentIntentId: pi }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || 'Booking confirmation failed');
        setRedirectConfirmed(true);
        setSubmitted(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Payment succeeded but booking could not be confirmed. Please contact the studio with your payment reference.');
      })
      .finally(() => setRedirectConfirming(false));
  }, []);

  useEffect(() => {
    if (isSupabaseEnabled() && supabase) {
      supabase.from('content').select('value').eq('key', 'deposit_notice_type').eq('page', 'party-booking').maybeSingle().then(({ data }) => {
        if (data?.value && ['info','warning','success','error'].includes(data.value)) {
          setDepositNoticeType(data.value as 'info' | 'warning' | 'success' | 'error');
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!date) {
      setSlotCapacity({});
      return;
    }
    const slots = getTimeSlots(date, closures, studio);
    const dateStr = format(date, 'yyyy-MM-dd');
    const sessionTypeMap: Record<PartyType, string> = {
      birthday: 'birthday-party',
      'baby-shower-hen': 'baby-shower-hen',
      corporate: 'corporate',
    };
    const sType = sessionTypeMap[partyType];
    Promise.all(slots.map(async (slot) => {
      try {
        // Probe with the largest possible party size so the slot list shows the maximum remaining capacity.
        const remaining = await getRemainingCapacity(studio, dateStr, slot, sType, 28);
        return { slot, remaining };
      } catch {
        return { slot, remaining: 0 };
      }
    })).then((results) => {
      const map: Record<string, number> = {};
      results.forEach(({ slot, remaining }) => {
        map[slot] = remaining;
      });
      setSlotCapacity(map);
    });
  }, [date, studio, partyType, closures]);

  useEffect(() => {
    loadClosuresFromSupabase().then(setClosures);
  }, []);

  useEffect(() => {
    getBusyDates(studio, calendarMonth.getFullYear(), calendarMonth.getMonth()).then((dates) => {
      setBusyDates(dates.map((d) => new Date(d)));
    });
  }, [calendarMonth, studio]);

  useEffect(() => {
    const loadPartyPrice = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-party-price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        });
        const data = await response.json();
        if (data.price) setPartyPrice(Number(data.price));
      } catch (err) {
        console.error('Failed to load party price:', err);
      }
    };
    loadPartyPrice();
  }, []);

  useEffect(() => {
    const loadGuestLimit = async () => {
      try {
        const key = `party_guest_limit_${studio.toLowerCase()}`;
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'load', key }),
        });
        const data = await response.json();
        if (data.value) setPartyGuestLimit(Number(data.value));
      } catch (err) {
        console.error('Failed to load party guest limit:', err);
      }
    };
    loadGuestLimit();
  }, [studio]);

  const handleSubmit = async () => {
    setError('');
    if (!date || !time || !name || !phone) {
      const missing = [
        !date && 'Date',
        !time && 'Time',
        !name && 'Name',
        !phone && 'Phone',
      ].filter(Boolean).join(', ');
      setError(`Please fill in the required fields: ${missing}`);
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
      setError('Please enter a valid email address or leave it blank');
      return;
    }

    const guestCount = guests === '' ? 1 : guests;
    const partyLimit = partyGuestLimit;
    if (guestCount > partyLimit) {
      if (studio === 'Putney') {
        setError(`Putney can accommodate up to 16 guests for a party. For larger groups, please call us to discuss arrangements.`);
      } else {
        setError(`This studio can accommodate up to ${partyLimit} guests for a party.`);
      }
      return;
    }
    const sessionTypeMap: Record<PartyType, 'birthday-party' | 'baby-shower-hen' | 'corporate'> = {
      birthday: 'birthday-party',
      'baby-shower-hen': 'baby-shower-hen',
      corporate: 'corporate',
    };

    let remaining: number;
    try {
      remaining = await getRemainingCapacity(studio, format(date, 'yyyy-MM-dd'), time, sessionTypeMap[partyType], guestCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check availability. Please try again.');
      return;
    }
    if (remaining <= 0) {
      setError('This time slot is already booked for a party. Please choose a different time.');
      return;
    }
    if (guestCount > remaining) {
      setError(`This session only has room for ${remaining} more guest${remaining === 1 ? '' : 's'}. Please choose a different time or reduce the group size.`);
      return;
    }

    const bookingId = `PP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;

    const booking: BookingInquiry = {
      id: bookingId,
      studio,
      name,
      email,
      phone,
      date: format(date, 'yyyy-MM-dd'),
      time,
      paintersCount: guestCount,
      sessionType: sessionTypeMap[partyType],
      notes: studio === 'Wimbledon'
        ? (partyType === 'birthday' && childAge !== ''
          ? `[${info.title}] | Age: ${childAge} | ${notes}`.trim()
          : `[${info.title}] | ${notes}`.trim())
        : (partyType === 'birthday' && childAge !== ''
          ? `[${info.title}] Age: ${childAge} | ${notes}`.trim()
          : `[${info.title}] ${notes}`.trim()),
      status: 'pending',
      source: 'online',
      requestDate: new Date().toISOString(),
      depositAmount,
      finalSeats: guestCount,
      finalBalance: Math.max(0, guestCount * partyPrice - depositAmount),
      paymentStatus: 'pending',
    };

    setSubmitting(true);
    try {
      // Do NOT create booking in DB yet — booking is only created after £50 deposit is paid
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-party-deposit-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ bookingId, amount: depositAmount, booking }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setError(data.error || 'Failed to set up deposit payment');
        return;
      }
      setPendingBooking(booking);
      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId);
      setStripePromise(loadStripe(data.publishableKey));
      setShowPayment(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit booking. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSuccess = async () => {
    if (!pendingBooking) return;
    setSubmitting(true);
    try {
      // Confirm payment and create booking in DB (only after £50 deposit is paid)
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-party-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ paymentIntentId }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Payment succeeded but booking failed. Please contact us.');
      }
      setSubmitted(true);
      setShowPayment(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment succeeded but booking failed. Please contact us.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const closedDatesAsDate = getClosedDatesForStudio(closures.closedDates, studio).map(d => new Date(d + 'T00:00:00'));
  const timeSlots = date ? getTimeSlots(date, closures, studio) : [];

  const handleDownloadInvitation = () => {
    const guestCount = guests === '' ? 1 : guests;
    const dateStr = date ? format(date, 'EEEE, do MMMM yyyy') : '';
    const studioAddress = studio === 'Putney'
      ? '234 Upper Richmond Road, London, SW15 6TG'
      : '52 Wimbledon Hill Road, London, SW19 7PA';
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Party Invitation – Pitter Potter</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; background: #fff; }
  @page { size: A5 landscape; margin: 0; }
  .card {
    width: 210mm; height: 148mm;
    background: linear-gradient(135deg, #1B2D3C 0%, #2d4a5e 60%, #1B2D3C 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 28px 40px; position: relative; overflow: hidden;
  }
  .card::before {
    content: ''; position: absolute; top: -60px; right: -60px;
    width: 220px; height: 220px; border-radius: 50%;
    background: rgba(219,231,228,0.08);
  }
  .card::after {
    content: ''; position: absolute; bottom: -40px; left: -40px;
    width: 160px; height: 160px; border-radius: 50%;
    background: rgba(219,231,228,0.06);
  }
  .logo { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 700; color: #DBE7E4; letter-spacing: 6px; text-transform: uppercase; margin-bottom: 6px; }
  .divider { width: 60px; height: 1px; background: #DBE7E4; opacity: 0.4; margin: 0 auto 16px; }
  .you-are-invited { font-family: 'Playfair Display', serif; font-size: 11px; font-weight: 400; color: #DBE7E4; opacity: 0.7; letter-spacing: 4px; text-transform: uppercase; margin-bottom: 10px; }
  .event-title { font-family: 'Playfair Display', serif; font-size: 32px; font-weight: 900; color: #fff; text-align: center; line-height: 1.1; margin-bottom: 20px; }
  .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; width: 100%; margin-bottom: 18px; }
  .detail-item { text-align: center; }
  .detail-label { font-size: 8px; font-weight: 700; color: #DBE7E4; opacity: 0.6; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 3px; }
  .detail-value { font-size: 11px; font-weight: 700; color: #fff; line-height: 1.3; }
  .ref-line { font-size: 8px; color: #DBE7E4; opacity: 0.5; letter-spacing: 1px; margin-top: 4px; }
  .address-line { font-size: 9px; font-weight: 600; color: #DBE7E4; opacity: 0.65; text-align: center; margin-top: 2px; }
  .hosted-by { font-size: 10px; font-weight: 600; color: #DBE7E4; opacity: 0.8; margin-top: 8px; }
  .accent-bar { width: 100%; height: 3px; background: linear-gradient(90deg, transparent, #DBE7E4, transparent); opacity: 0.3; margin: 14px 0; }
</style>
</head>
<body>
<div class="card">
  <p class="logo">Pitter Potter</p>
  <p class="you-are-invited">You're invited</p>
  <div class="divider"></div>
  <h1 class="event-title">${info.title}</h1>
  <div class="details-grid">
    <div class="detail-item">
      <p class="detail-label">Date</p>
      <p class="detail-value">${dateStr}</p>
    </div>
    <div class="detail-item">
      <p class="detail-label">Time</p>
      <p class="detail-value">${time}</p>
    </div>
  </div>
  <div class="accent-bar"></div>
  <p class="detail-label">Location</p>
  <p class="detail-value" style="text-align:center;margin-top:3px">${studio} Studio</p>
  <p class="address-line">${studioAddress}</p>
  <p class="hosted-by">Hosted by ${name}</p>
</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) { win.onload = () => { win.print(); }; }
  };

  const handleShareInvitation = async () => {
    const dateStr = date ? format(date, 'EEEE, do MMMM yyyy') : '';
    const studioAddress = studio === 'Putney'
      ? '234 Upper Richmond Road, London, SW15 6TG'
      : '52 Wimbledon Hill Road, London, SW19 7PA';
    const shareText = [
      `You're invited to a ${info.title} at Pitter Potter ${studio}!`,
      `Date: ${dateStr}`,
      `Time: ${time}`,
      `Address: ${studioAddress}`,
      `Hosted by ${name}`,
    ].join('\n');
    if (navigator.share) {
      try {
        await navigator.share({ title: `${info.title} at Pitter Potter`, text: shareText });
      } catch (err) { console.error('Failed to share invitation:', err); }
    } else {
      await navigator.clipboard.writeText(shareText);
      showToast('Invitation text copied to clipboard!', 'success');
    }
  };

  if (redirectConfirming) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex items-center justify-center px-4 py-20">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="p-4 bg-[#D6E2E9] rounded-full inline-block animate-pulse">
            <IconComponent className="w-8 h-8 text-[#1B2D3C]" />
          </div>
          <h2 className="font-heading text-2xl font-black text-[#1B2D3C]">Confirming your booking…</h2>
          <p className="text-sm text-[#1B2D3C]/70 font-medium">Please wait while we confirm your payment.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex items-center justify-center px-4 py-20">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="p-4 bg-[#D6E2E9] rounded-full inline-block">
            <IconComponent className="w-8 h-8 text-[#1B2D3C]" />
          </div>
          <h2 className="font-heading text-2xl font-black text-[#1B2D3C]"><EditableText contentKey={`party_${partyType}_success_title`} page="party-booking" defaultValue="Booking Confirmed!" adminMode={adminMode} className="font-heading text-2xl text-[#1B2D3C]" /></h2>
          <p className="text-sm text-[#1B2D3C]/70 font-medium">
            <EditableText contentKey={`party_${partyType}_success_message`} page="party-booking" defaultValue={`Your ${info.title.toLowerCase()} booking at our ${studio} studio is confirmed. A confirmation email is on its way.`} adminMode={adminMode} className="text-sm text-[#1B2D3C]/70" />
          </p>
          {!redirectConfirmed && (
            <div className="bg-[#D6E2E9]/30 p-4 rounded-lg text-left space-y-2 text-xs font-semibold text-[#1B2D3C]">
              <p><span className="font-bold"><EditableText contentKey="party_event_label" page="party-booking" defaultValue="Event:" adminMode={adminMode} className="text-xs font-bold text-[#1B2D3C]" /></span> {info.title}</p>
              <p><span className="font-bold"><EditableText contentKey="party_studio_label" page="party-booking" defaultValue="Studio:" adminMode={adminMode} className="text-xs font-bold text-[#1B2D3C]" /></span> {studio}</p>
              <p><span className="font-bold"><EditableText contentKey="party_date_label" page="party-booking" defaultValue="Date:" adminMode={adminMode} className="text-xs font-bold text-[#1B2D3C]" /></span> {date && format(date, 'EEEE, do MMMM yyyy')}</p>
              <p><span className="font-bold"><EditableText contentKey="party_time_label" page="party-booking" defaultValue="Time:" adminMode={adminMode} className="text-xs font-bold text-[#1B2D3C]" /></span> {time}</p>
              <p><span className="font-bold"><EditableText contentKey="party_guests_label" page="party-booking" defaultValue="Guests:" adminMode={adminMode} className="text-xs font-bold text-[#1B2D3C]" /></span> {guests === '' ? 1 : guests}</p>
              <p><span className="font-bold"><EditableText contentKey="party_name_label" page="party-booking" defaultValue="Name:" adminMode={adminMode} className="text-xs font-bold text-[#1B2D3C]" /></span> {name}</p>
              <p><span className="font-bold"><EditableText contentKey="party_phone_label" page="party-booking" defaultValue="Phone:" adminMode={adminMode} className="text-xs font-bold text-[#1B2D3C]" /></span> {phone}</p>
            </div>
          )}

          {/* Invitation actions */}
          {!redirectConfirmed && (
            <div className="bg-[#1B2D3C] rounded-xl p-5 space-y-3">
              <p className="text-white font-black text-sm">Your Party Invitation</p>
              <p className="text-white/60 text-xs font-medium">Download a beautifully designed invitation card to share with your guests.</p>
              <div className="flex gap-3">
                <button
                  onClick={handleDownloadInvitation}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-white transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Download PDF
                </button>
                <button
                  onClick={handleShareInvitation}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-white/20 transition-all cursor-pointer border border-white/20"
                >
                  <Share2 className="w-4 h-4" /> Share
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => setCurrentPage('home')}
            className="w-full py-3 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest hover:bg-[#D6E2E9] transition-all cursor-pointer"
          >
            <EditableText contentKey="party_success_home" page="party-booking" defaultValue="Back to Home" adminMode={adminMode} className="text-xs uppercase tracking-widest" />
          </button>
        </div>
      </div>
    );
  }

  if (showPayment && clientSecret && stripePromise) {
    const guestCount = guests === '' ? 1 : guests;
    return (
      <div className="min-h-screen bg-[#FFFFFF]">
        <section className="max-w-2xl mx-auto px-4 py-12 space-y-6">
          <div className="text-center space-y-2">
            <h2 className="font-heading text-2xl md:text-3xl font-black text-[#1B2D3C]">Pay £{depositAmount.toFixed(2)} deposit</h2>
            <p className="text-sm text-[#1B2D3C]/70 font-medium max-w-md mx-auto">
              Secure your party booking with a £{depositAmount.toFixed(2)} deposit. The remaining balance will be payable 48 hours before your party.
            </p>
          </div>
          <div className="bg-[#D6E2E9]/50 p-4 rounded-lg text-sm font-bold text-[#1B2D3C] space-y-2">
            <p>{info.title} · {studio} Studio</p>
            <p>{date && format(date, 'EEEE, do MMMM yyyy')} · {time}</p>
            <p>{guestCount} guest{guestCount !== 1 ? 's' : ''}</p>
            <p>£{partyPrice.toFixed(2)} per person (includes the £5.95 studio fee)</p>
            <p>Total estimated: £{(guestCount * partyPrice).toFixed(2)}</p>
            <p>Deposit today: £{depositAmount.toFixed(2)}</p>
            <p className="text-[#1B2D3C]/60 text-xs font-medium">Final balance due 48 hours before your party: £{Math.max(0, guestCount * partyPrice - depositAmount).toFixed(2)}</p>
          </div>
          <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg text-xs font-medium text-blue-800">
            <EditableText contentKey="deposit_payment_notice" page="party-booking" defaultValue="We only take a £50 deposit today because final guest numbers can change. We will email you 48 hours before the party to confirm final seats and collect the remaining balance." adminMode={adminMode} className="text-xs font-medium text-blue-800" />
          </div>
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <PaymentForm onSuccess={handlePaymentSuccess} amount={depositAmount} loading={submitting} setLoading={setSubmitting} />
          </Elements>
          <button onClick={() => setShowPayment(false)} className="w-full py-3 bg-white text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 hover:bg-[#D6E2E9]/20 transition-all cursor-pointer rounded-lg">
            Back to booking details
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF]">
      {/* Header */}
      <section className="bg-[#D6E2E9]/30 py-12 px-4">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <div className="p-3 bg-[#D6E2E9] text-[#1B2D3C] border border-[#1B2D3C]/20 rounded-lg">
              <IconComponent className="w-6 h-6 stroke-[2]" />
            </div>
          </div>
          <h1 className="font-heading text-3xl md:text-4xl font-black text-[#1B2D3C]">
            <EditableText contentKey={`party_${partyType}_title`} page="party-booking" defaultValue={info.title} adminMode={adminMode} className="font-heading text-3xl md:text-4xl text-[#1B2D3C]" />
          </h1>
          <div className="flex items-center justify-center gap-2 text-sm font-bold text-[#1B2D3C]/70">
            <MapPin className="w-4 h-4" />
            <span><EditableText contentKey={`party_${studio.toLowerCase()}_studio_label`} page="party-booking" defaultValue={`${studio} Studio`} adminMode={adminMode} className="text-sm font-bold text-[#1B2D3C]/70" /></span>
          </div>
          <p className="text-[#1B2D3C] font-black text-lg"><EditableText contentKey={`party_${partyType}_price`} page="party-booking" defaultValue={info.price} adminMode={adminMode} className="text-lg font-black text-[#1B2D3C]" /></p>
          <p className="text-[#1B2D3C]/85 text-xs sm:text-sm font-medium leading-relaxed max-w-xl mx-auto">
            <EditableText contentKey={`party_${partyType}_description`} page="party-booking" defaultValue={info.description} adminMode={adminMode} className="text-xs sm:text-sm text-[#1B2D3C]/85 leading-relaxed" />
          </p>
        </div>
      </section>

      {/* Booking Form */}
      <section className="max-w-2xl mx-auto px-4 py-12 space-y-8 pb-20">
        {/* Calendar */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-[#1B2D3C]" />
            <h3 className="font-heading text-xl font-black text-[#1B2D3C]"><EditableText contentKey="party_date_heading" page="party-booking" defaultValue="Choose a Date" adminMode={adminMode} className="font-heading text-xl text-[#1B2D3C]" /></h3>
          </div>
          <div className="bg-[#FFFFFF] border border-[#1B2D3C]/10 rounded-lg p-3 flex items-start justify-center">
            <Calendar
              selected={date}
              onSelect={handleDateSelect}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              disabled={[...busyDates, ...closedDatesAsDate]}
              minDate={startOfDay(new Date())}
              dayOfWeekDisabled={[1]}
              schoolHolidayDates={closures.schoolHolidays}
              marks={busyDates}
            />
          </div>
        </div>

        {/* Time Slots */}
        {timeSlots.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#1B2D3C]" />
              <h3 className="font-heading text-lg font-black text-[#1B2D3C]"><EditableText contentKey="party_time_heading" page="party-booking" defaultValue="Choose a Time Slot" adminMode={adminMode} className="font-heading text-lg text-[#1B2D3C]" /></h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {timeSlots.map((slot) => {
                const remaining = slotCapacity[slot] ?? partyGuestLimit;
                const isFull = remaining === 0;
                const isLimited = remaining > 0 && remaining <= 5;
                
                return (
                  <button
                    key={slot}
                    onClick={() => setTime(slot)}
                    disabled={isFull}
                    className={`py-3 px-2 text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer rounded-lg ${
                      time === slot
                        ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C]'
                        : isFull
                          ? 'bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed'
                          : 'bg-white text-[#1B2D3C] border-[#1B2D3C]/20 hover:border-[#1B2D3C]'
                    }`}
                  >
                    <div className="font-bold text-sm">{slot}</div>
                    {isFull && (
                      <div className="text-[11px] font-semibold mt-1 text-stone-400">
                        FULLY BOOKED
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}


        {/* Guests */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#1B2D3C]" />
            <h3 className="font-heading text-lg font-black text-[#1B2D3C]"><EditableText contentKey="party_guests_heading" page="party-booking" defaultValue="Number of Guests" adminMode={adminMode} className="font-heading text-lg text-[#1B2D3C]" /></h3>
          </div>
          <input
            type="number"
            min={1}
            max={partyGuestLimit}
            value={guests}
            onChange={(e) => setGuests(e.target.value === '' ? '' : Math.max(1, Math.min(partyGuestLimit, parseInt(e.target.value) || 1)))}
            className="w-full py-2.5 px-3 border border-[#1B2D3C]/20 bg-white text-sm font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
          />
          {studio === 'Putney' && (
            <p className="text-[10px] text-[#1B2D3C]/60 font-medium">
              <EditableText contentKey="party_putney_guests_hint" page="party-booking" defaultValue="Max 16 guests for a party at Putney. For larger groups, please call us." adminMode={adminMode} className="text-[10px] text-[#1B2D3C]/60" />
            </p>
          )}
          {studio === 'Wimbledon' && (
            <p className="text-[10px] text-[#1B2D3C]/60 font-medium">
              <EditableText contentKey="party_wimbledon_guests_hint" page="party-booking" defaultValue="Each party area accommodates up to 14 guests." adminMode={adminMode} className="text-[10px] text-[#1B2D3C]/60" />
            </p>
          )}
        </div>

        {/* Summary */}
        {date && time && (
          <div className="bg-[#D6E2E9]/50 p-4 rounded-lg text-sm font-bold text-[#1B2D3C] space-y-2">
            <p>{info.title} · {studio} Studio</p>
            <p>{format(date, 'EEEE, do MMMM yyyy')} · {time}</p>
            <p>{guests === '' ? 1 : guests} guest{(guests === '' ? 1 : guests) !== 1 ? 's' : ''}</p>
            <p>£{partyPrice.toFixed(2)} per person (includes the £5.95 studio fee) · estimated total £{((guests === '' ? 1 : guests) * partyPrice).toFixed(2)}</p>
            <p>£{depositAmount.toFixed(2)} deposit today, balance payable 48 hours before the party</p>
          </div>
        )}

        {/* Deposit note */}
        {(() => {
          const noticeTypeRaw = depositNoticeType;
          const styles: Record<string, { wrapper: string; border: string; title: string; body: string; icon: string }> = {
            info:    { wrapper: 'bg-blue-50',   border: 'border-blue-400',  title: 'text-blue-900',  body: 'text-blue-800',  icon: 'ℹ️' },
            warning: { wrapper: 'bg-amber-50',  border: 'border-amber-400', title: 'text-amber-900', body: 'text-amber-800', icon: '⚠️' },
            success: { wrapper: 'bg-green-50',  border: 'border-green-400', title: 'text-green-900', body: 'text-green-800', icon: '✅' },
            error:   { wrapper: 'bg-red-50',    border: 'border-red-400',   title: 'text-red-900',   body: 'text-red-800',   icon: '🚫' },
          };
          const s = styles[noticeTypeRaw] ?? styles.info;
          return (
            <div className={`${s.wrapper} border-l-4 ${s.border} p-4 rounded-r-lg`}>
              <div className="flex gap-3">
                <div className="text-xl flex-shrink-0">{s.icon}</div>
                <div className="space-y-1">
                  <p className={`text-sm font-bold ${s.title}`}>
                    <EditableText contentKey="deposit_notice_title" page="party-booking" defaultValue="£50 deposit only" adminMode={adminMode} className={`text-sm font-bold ${s.title}`} />
                  </p>
                  <p className={`text-xs font-medium ${s.body} leading-relaxed`}>
                    <EditableText contentKey="deposit_notice_body" page="party-booking" defaultValue="We only take a £50 deposit to secure your party. We know RSVPs can change, so we will email you 48 hours before the party to confirm final numbers and collect the remaining balance." adminMode={adminMode} className={`text-xs font-medium ${s.body} leading-relaxed`} />
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Contact Details */}
        <div className="space-y-4 border-t border-[#1B2D3C]/10 pt-8">
          <h3 className="font-heading text-lg font-black text-[#1B2D3C]"><EditableText contentKey="party_details_heading" page="party-booking" defaultValue="Your Details" adminMode={adminMode} className="font-heading text-lg text-[#1B2D3C]" /></h3>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1"><EditableText contentKey="party_name_label" page="party-booking" defaultValue="Name *" adminMode={adminMode} className="text-[10px] uppercase tracking-wider text-[#1B2D3C]" /></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#1B2D3C]/20 text-sm text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1"><EditableText contentKey="party_email_label" page="party-booking" defaultValue="Email" adminMode={adminMode} className="text-[10px] uppercase tracking-wider text-[#1B2D3C]" /></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#1B2D3C]/20 text-sm text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1"><EditableText contentKey="party_phone_label" page="party-booking" defaultValue="Phone *" adminMode={adminMode} className="text-[10px] uppercase tracking-wider text-[#1B2D3C]" /></label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#1B2D3C]/20 text-sm text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                placeholder="07xxx xxxxxx or +49xxx"
              />
            </div>
            {partyType === 'birthday' && (
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1"><EditableText contentKey="party_birthday_age_label" page="party-booking" defaultValue="Birthday Child's Age" adminMode={adminMode} className="text-[10px] uppercase tracking-wider text-[#1B2D3C]" /></label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={childAge}
                  onChange={(e) => setChildAge(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2.5 border border-[#1B2D3C]/20 text-sm text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  placeholder="e.g. 7"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1"><EditableText contentKey="party_notes_label" page="party-booking" defaultValue="Additional Notes" adminMode={adminMode} className="text-[10px] uppercase tracking-wider text-[#1B2D3C]" /></label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 border border-[#1B2D3C]/20 text-sm text-[#1B2D3C] font-medium rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 resize-none"
                placeholder={partyType === 'birthday' 
                  ? "Any special requests or additional information..."
                  : "Any special requests, dietary requirements, etc."}
              />
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!date || !time || !name || !phone || submitting}
          className="w-full py-3.5 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest hover:bg-[#D6E2E9] transition-all cursor-pointer flex items-center justify-center gap-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? <EditableText contentKey="party_submitting" page="party-booking" defaultValue="Submitting..." adminMode={adminMode} className="text-xs uppercase tracking-widest" /> : <><EditableText contentKey={`party_submit_button_${partyType}`} page="party-booking" defaultValue={info.title === 'Corporate Event' ? 'Submit Enquiry' : `Book Party & Pay £${depositAmount.toFixed(2)} Deposit`} adminMode={adminMode} className="text-xs uppercase tracking-widest" /> <ArrowRight className="w-4 h-4" /></>}
        </button>

        <button
          onClick={() => setCurrentPage('parties')}
          className="w-full py-3 bg-white text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 hover:bg-[#D6E2E9]/20 transition-all cursor-pointer rounded-lg"
        >
          <EditableText contentKey="party_back_button" page="party-booking" defaultValue="Back to Parties & Events" adminMode={adminMode} className="text-xs uppercase tracking-widest" />
        </button>
      </section>
    </div>
  );
}
