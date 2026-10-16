import { useState, useEffect, useMemo } from 'react';
import { ArrowRight, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { useToast } from './ToastContext';
import { format, getDay, isBefore, startOfDay } from 'date-fns';
import { BookingInquiry, Page } from '../types';
import { createPublicBooking, getBusyDates, getRemainingCapacity } from '../lib/bookings';
import { getSlots, filterPastSlots, DayType } from '../lib/timeSlots';
import { loadClosuresFromSupabase, getClosureDates, ClosureDates, isDateInHolidayRange, getClosedDatesForStudio } from '../lib/closures';
import Calendar from './Calendar';
import EditableText from './EditableText';

interface BabyPrintsBookingViewProps {
  adminMode?: boolean;
  setCurrentPage?: (page: Page) => void;
}

function getTimeSlots(date: Date, closures: ClosureDates, studio: 'Putney' | 'Wimbledon'): string[] {
  const day = getDay(date);
  const dateStr = format(date, 'yyyy-MM-dd');
  const isHoliday = isDateInHolidayRange(dateStr, closures.schoolHolidays);
  if (day >= 2 || day === 0 || (day === 1 && isHoliday)) {
    const dayType: DayType = (day === 0 || day === 6) ? 'weekend' : 'weekday';
    return filterPastSlots(getSlots('baby-prints', studio, dayType, day), date);
  }
  return [];
}

export default function BabyPrintsBookingView({ adminMode = false, setCurrentPage }: BabyPrintsBookingViewProps) {
  const { showToast } = useToast();
  const [studio, setStudio] = useState<'Putney' | 'Wimbledon'>('Putney');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState<string>('');
  const [babiesCount, setBabiesCount] = useState<number>(1);
  const [adultsCount, setAdultsCount] = useState<number>(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [busyDates, setBusyDates] = useState<Date[]>([]);
  const [closures, setClosures] = useState<ClosureDates>(getClosureDates());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedBooking, setSubmittedBooking] = useState<BookingInquiry | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    loadClosuresFromSupabase().then(setClosures);
  }, []);

  useEffect(() => {
    getBusyDates(studio, calendarMonth.getFullYear(), calendarMonth.getMonth()).then((dates) => {
      setBusyDates(dates.map((d) => new Date(d)));
    });
  }, [calendarMonth, studio]);

  const minDate = useMemo(() => startOfDay(new Date()), []);
  const closedDatesAsDate = useMemo(() => getClosedDatesForStudio(closures.closedDates, studio).map(d => new Date(d + 'T00:00:00')), [closures.closedDates, studio]);
  const disabledDates = useMemo(() => [...busyDates, ...closedDatesAsDate], [busyDates, closedDatesAsDate]);
  const timeSlots = date ? getTimeSlots(date, closures, studio) : [];
  const today = new Date();
  const dayOfWeekDisabled = [1]; // Monday

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const missing = [
      !name && 'Name',
      !email && 'Email',
      !phone && 'Phone',
      !date && 'Date',
      !time && 'Time',
    ].filter(Boolean).join(', ');

    if (missing) {
      setError(`Please fill in the required fields: ${missing}`);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    if (!date || isBefore(date, minDate)) {
      setError('Please select a future date');
      return;
    }

    const dateStr = format(date, 'yyyy-MM-dd');
    const remaining = await getRemainingCapacity(studio, dateStr, time, 'clay-imprints');
    if (babiesCount > remaining) {
      setError(`This session only has room for ${remaining} more seat${remaining === 1 ? '' : 's'}. Please choose a different time or reduce the number of babies.`);
      return;
    }

    const booking: BookingInquiry = {
      id: `PP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
      studio,
      name,
      email,
      phone,
      date: dateStr,
      time,
      paintersCount: babiesCount,
      sessionType: 'clay-imprints',
      status: 'confirmed',
      source: 'online',
      requestDate: new Date().toISOString(),
      notes: `Babies: ${babiesCount}, Adults: ${adultsCount}${notes ? ` | ${notes}` : ''}`,
    };

    setSubmitting(true);
    try {
      await createPublicBooking(booking);
      setSubmittedBooking(booking);
      setShowSuccess(true);
      setName('');
      setEmail('');
      setPhone('');
      setDate(undefined);
      setTime('');
      setBabiesCount(1);
      setAdultsCount(1);
      setNotes('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save booking. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="baby-prints-booking" className="pb-20 pt-6">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="font-heading text-3xl md:text-4xl font-black tracking-tight text-[#1B2D3C]">
            <EditableText contentKey="babyprints_book_title" page="baby-prints-book" defaultValue="Book a Baby Print Session" adminMode={adminMode} className="font-heading text-3xl md:text-4xl text-[#1B2D3C]" />
          </h1>
          <p className="text-xs text-stone-500 mt-2 font-semibold">
            <EditableText contentKey="babyprints_book_subtitle" page="baby-prints-book" defaultValue="Choose your studio, date and let us know how many little ones to expect." adminMode={adminMode} className="text-xs text-stone-500" />
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-[#1B2D3C]/20 rounded-2xl p-6 md:p-8 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
              {error}
            </div>
          )}

          {/* Location */}
          <div className="space-y-2">
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">Studio Location *</label>
            <div className="relative">
              <select
                value={studio}
                onChange={(e) => setStudio(e.target.value as 'Putney' | 'Wimbledon')}
                className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60 appearance-none cursor-pointer"
              >
                <option value="Putney">Putney</option>
                <option value="Wimbledon">Wimbledon</option>
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg className="w-4 h-4 text-[#1B2D3C]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>
          </div>

          {/* Date and Time */}
          <div className="space-y-4">
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">Date &amp; Time *</label>
            <Calendar
              selected={date}
              onSelect={(d) => { setDate(d); setTime(''); }}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              disabled={disabledDates}
              minDate={minDate}
              dayOfWeekDisabled={dayOfWeekDisabled}
              schoolHolidayDates={closures.schoolHolidays}
              marks={busyDates}
            />
            {date && (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]/70">Available slots</p>
                <div className="flex flex-wrap gap-2">
                  {timeSlots.length === 0 ? (
                    <p className="text-xs text-stone-500">No available slots on this date.</p>
                  ) : (
                    timeSlots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setTime(slot)}
                        className={`px-3 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                          time === slot ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C]' : 'bg-white text-[#1B2D3C] border-[#1B2D3C]/20 hover:border-[#1B2D3C]/60'
                        }`}
                      >
                        {slot} – {parseInt(slot.split(':')[0], 10) + 2}:00
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Babies and Adults */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">How many babies? *</label>
              <div className="flex items-center border border-[#1B2D3C]/20 bg-white overflow-hidden rounded-lg max-w-[180px]">
                <button type="button" onClick={() => setBabiesCount((c) => Math.max(1, c - 1))} className="px-5 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 transition-all cursor-pointer select-none">−</button>
                <span className="flex-1 text-center text-sm font-black text-[#1B2D3C]">{babiesCount}</span>
                <button type="button" onClick={() => setBabiesCount((c) => c + 1)} className="px-5 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 transition-all cursor-pointer select-none">+</button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">How many adults?</label>
              <div className="flex items-center border border-[#1B2D3C]/20 bg-white overflow-hidden rounded-lg max-w-[180px]">
                <button type="button" onClick={() => setAdultsCount((c) => Math.max(0, c - 1))} className="px-5 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 transition-all cursor-pointer select-none">−</button>
                <span className="flex-1 text-center text-sm font-black text-[#1B2D3C]">{adultsCount}</span>
                <button type="button" onClick={() => setAdultsCount((c) => c + 1)} className="px-5 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 transition-all cursor-pointer select-none">+</button>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="space-y-4">
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">Your Details *</label>
            <div className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number"
                className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">Additional Notes <span className="text-[#1B2D3C]/40 font-semibold normal-case tracking-normal">(optional)</span></label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else we should know?"
              rows={3}
              className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-4 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-sm uppercase tracking-widest rounded-xl hover:bg-[#D6E2E9] transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : <>Confirm Booking <ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>
      </div>

      {/* Success Modal */}
      {showSuccess && submittedBooking && (
        <div className="fixed inset-0 bg-[#1B2D3C]/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#1B2D3C]/20 p-8 max-w-md w-full space-y-4 rounded-xl">
            <div className="text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
              <h3 className="font-heading text-2xl font-black text-[#1B2D3C] mb-2">Booking Confirmed!</h3>
              <p className="text-xs text-[#1B2D3C] font-semibold leading-relaxed">
                Thank you {name}! Your baby print session on {format(new Date(submittedBooking.date), 'PPP')} at {submittedBooking.time} is confirmed.
              </p>
              <p className="text-xs text-stone-500 font-semibold leading-relaxed mt-2">
                A confirmation email is on its way to you with a link to reschedule or cancel if needed.
              </p>
            </div>
            <button
              onClick={() => {
                setShowSuccess(false);
                if (setCurrentPage) setCurrentPage('home');
              }}
              className="w-full py-3 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 hover:translate-x-[2px] hover:translate-y-[2px] transition-all cursor-pointer"
            >
              Back to Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
