import { useState, useEffect, useMemo, useRef, FormEvent } from 'react';
import { format, getDay, startOfDay, isBefore, addDays, subDays, isSameDay } from 'date-fns';
import { Page, BookingInquiry } from '../types';
import Calendar from './Calendar';
import { getRemainingCapacity, getBusyDates, createPublicBooking } from '../lib/bookings';
import { getSlots, getAvailableDays, isSessionEnabled, filterPastSlots, DayType } from '../lib/timeSlots';
import { loadClosuresFromSupabase, getClosureDates, ClosureDates, isDateInHolidayRange, getClosedDatesForStudio } from '../lib/closures';
import { useToast } from './ToastContext';

interface BookViewProps {
  setCurrentPage: (page: Page) => void;
  adminMode?: boolean;
}

type Studio = 'Putney' | 'Wimbledon';
type SessionTypeValue = 'painting' | 'clay-imprints' | 'sip-and-paint' | 'birthday-party' | 'baby-shower-hen' | 'corporate';

interface SessionOption {
  value: SessionTypeValue;
  label: string;
  description: string;
  studios: Studio[];
  isParty?: boolean;
  contactOnly?: boolean;
}

const SESSION_OPTIONS: SessionOption[] = [
  { value: 'painting', label: 'Pottery Painting', description: 'Pick a piece, paint it your way — we glaze and fire it for you.', studios: ['Putney', 'Wimbledon'] },
  { value: 'clay-imprints', label: 'Baby Prints', description: 'Capture tiny hands and feet in beautiful keepsakes.', studios: ['Putney', 'Wimbledon'] },
  { value: 'sip-and-paint', label: 'Sip & Paint', description: 'Paint pottery with a glass in hand — the perfect creative night out.', studios: ['Wimbledon'] },
  { value: 'birthday-party', label: 'Birthday Party', description: 'A creative, mess-free birthday with dedicated party hosts.', studios: ['Putney', 'Wimbledon'], isParty: true },
  { value: 'baby-shower-hen', label: 'Baby Shower / Hen Party', description: 'A fun, creative group experience for showers and hens.', studios: ['Putney', 'Wimbledon'], isParty: true },
  { value: 'corporate', label: 'Corporate Event', description: 'Team building and client events with a creative twist.', studios: ['Putney', 'Wimbledon'], contactOnly: true },
];

const SESSION_TYPE_LABELS: Record<string, string> = {
  'painting': 'Pottery Painting',
  'clay-imprints': 'Baby Prints',
  'sip-and-paint': 'Sip & Paint',
  'birthday-party': 'Birthday Party',
  'baby-shower-hen': 'Baby Shower / Hen Party',
  'corporate': 'Corporate Event',
};

const SLOT_SESSION_KEY = (sessionType: SessionTypeValue): 'painting' | 'baby-prints' | 'party' | 'sip-and-paint' => {
  if (['birthday-party', 'baby-shower-hen', 'corporate'].includes(sessionType)) return 'party';
  if (sessionType === 'clay-imprints') return 'baby-prints';
  if (sessionType === 'sip-and-paint') return 'sip-and-paint';
  return 'painting';
};

function disabledWeekDays(sessionType: SessionTypeValue, studio: Studio): number[] {
  const available = getAvailableDays(SLOT_SESSION_KEY(sessionType), studio);
  const disabled = [0, 1, 2, 3, 4, 5, 6].filter((d) => !available.includes(d));
  // For painting-style sessions, keep Monday in the disabled list unless the
  // admin explicitly made it available; the calendar will still enable holiday
  // Mondays through its school-holiday override.
  if (sessionType !== 'sip-and-paint' && !disabled.includes(1) && !available.includes(1)) {
    disabled.push(1);
  }
  return disabled.sort((a, b) => a - b);
}

function isThisWeekend(date: Date): boolean {
  const today = startOfDay(new Date());
  const day = today.getDay();
  const saturday = day === 0
    ? subDays(today, 1)
    : day === 6
      ? today
      : addDays(today, 6 - day);
  const sunday = addDays(saturday, 1);
  const d = startOfDay(date);
  return d >= saturday && d <= sunday;
}

function getTimeSlots(date: Date, closures: ClosureDates, studio: Studio, sessionType: SessionTypeValue): string[] {
  const day = getDay(date);
  const dateStr = format(date, 'yyyy-MM-dd');
  const isHoliday = isDateInHolidayRange(dateStr, closures.schoolHolidays);
  if (sessionType === 'sip-and-paint' && studio === 'Wimbledon' && isThisWeekend(date)) {
    return [];
  }
  const availableDays = getAvailableDays(SLOT_SESSION_KEY(sessionType), studio);

  const baseAvailable = availableDays.includes(day);
  // Painting-style sessions can open on school-holiday Mondays even if
  // Monday is not normally in their available days.
  const holidayMondayAvailable = sessionType !== 'sip-and-paint' && day === 1 && isHoliday;
  if (!baseAvailable && !holidayMondayAvailable) return [];

  const dayType: DayType = (day === 0 || day === 6) ? 'weekend' : 'weekday';
  return filterPastSlots(getSlots(SLOT_SESSION_KEY(sessionType), studio, dayType), date);
}

const STEPS = ['Location', 'Session', 'Date & Time', 'Your Details', 'Review'];

export default function BookView({ setCurrentPage, adminMode = false }: BookViewProps) {
  const { showToast } = useToast();

  const [step, setStep] = useState(1);
  const [studio, setStudio] = useState<Studio>('Wimbledon');
  const [sessionType, setSessionType] = useState<SessionTypeValue>('painting');
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState<string>('');
  const [paintersCount, setPaintersCount] = useState(1);
  // Baby prints extras
  const [babiesCount, setBabiesCount] = useState(1);
  const [adultsCount, setAdultsCount] = useState(1);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [busyDates, setBusyDates] = useState<Date[]>([]);
  const [closures, setClosures] = useState<ClosureDates>(getClosureDates());
  const [slotCapacity, setSlotCapacity] = useState<Record<string, number>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedBooking, setSubmittedBooking] = useState<BookingInquiry | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const preselectedSessionRef = useRef<string | null>(null);

  useEffect(() => { loadClosuresFromSupabase().then(setClosures); }, []);

  // Pre-select studio/session from other pages and skip the relevant steps
  useEffect(() => {
    let nextStep = 1;
    const preSelectedStudio = localStorage.getItem('pp_book_studio') as Studio | null;
    if (preSelectedStudio && (preSelectedStudio === 'Putney' || preSelectedStudio === 'Wimbledon')) {
      setStudio(preSelectedStudio);
      nextStep = 2;
      localStorage.removeItem('pp_book_studio');
    }
    const preSelectedSession = localStorage.getItem('pp_book_session_type') as SessionTypeValue | null;
    if (preSelectedSession && SESSION_OPTIONS.some(s => s.value === preSelectedSession)) {
      setSessionType(preSelectedSession);
      preselectedSessionRef.current = preSelectedSession;
      // If only a session was preselected, start at location (step 1) and then
      // jump past session selection to date/time.
      if (!preSelectedStudio) {
        nextStep = 1;
      }
      localStorage.removeItem('pp_book_session_type');
    }
    if (preSelectedStudio && preSelectedSession) {
      nextStep = 3;
    }
    if (nextStep > 1) {
      setStep(nextStep);
    }
  }, []);

  useEffect(() => {
    getBusyDates(studio, calendarMonth.getFullYear(), calendarMonth.getMonth()).then((dates) => {
      setBusyDates(dates.map((d) => new Date(d)));
    });
  }, [calendarMonth, studio]);

  useEffect(() => {
    if (!date) { setSlotCapacity({}); return; }
    const slots = getTimeSlots(date, closures, studio, sessionType);
    const dateStr = format(date, 'yyyy-MM-dd');
    Promise.all(slots.map(async (slot) => ({
      slot,
      remaining: await getRemainingCapacity(studio, dateStr, slot, sessionType),
    }))).then((results) => {
      const map: Record<string, number> = {};
      results.forEach(({ slot, remaining }) => { map[slot] = remaining; });
      setSlotCapacity(map);
    });
  }, [date, studio, sessionType, closures]);

  const minDate = useMemo(() => startOfDay(new Date()), []);
  const closedDatesAsDate = useMemo(() => getClosedDatesForStudio(closures.closedDates, studio).map(d => new Date(d + 'T00:00:00')), [closures.closedDates, studio]);
  const timeSlots = date ? getTimeSlots(date, closures, studio, sessionType) : [];

  const availableSessionTypes = useMemo(() => SESSION_OPTIONS.filter(s => {
    if (!s.studios.includes(studio)) return false;
    return isSessionEnabled(SLOT_SESSION_KEY(s.value), studio);
  }), [studio]);

  // When studio changes, reset session if not available
  useEffect(() => {
    const available = SESSION_OPTIONS.filter(s => s.studios.includes(studio));
    if (!available.find(s => s.value === sessionType)) {
      setSessionType(available[0]?.value || 'painting');
    }
  }, [studio]);

  // Scroll to top when step changes
  useEffect(() => {
    const el = document.getElementById('book-view');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const handleNext = () => {
    setError('');
    if (step === 1) {
      if (preselectedSessionRef.current) {
        setStep(3);
      } else {
        setStep(2);
      }
    } else if (step === 2) {
      const opt = SESSION_OPTIONS.find(s => s.value === sessionType);
      // Corporate / contact-only: no calendar, just show enquiry info
      if (opt?.contactOnly) {
        setStep(6); // special contact-enquiry step
        return;
      }
      // For party types, redirect to the party booking page
      if (opt?.isParty) {
        const partyTypeKey = sessionType === 'birthday-party' ? 'birthday' : sessionType === 'baby-shower-hen' ? 'babyshower' : 'corporate';
        const studioKey = studio.toLowerCase();
        const pageKey = `party-${partyTypeKey}-${studioKey}` as Page;
        setCurrentPage(pageKey);
        return;
      }
      // Reset date/time when moving to step 3
      setDate(undefined);
      setTime('');
      setStep(3);
    } else if (step === 3) {
      if (!date || !time) { setError('Please select a date and time slot.'); return; }
      setStep(4);
    } else if (step === 4) {
      if (!name || !phone) {
        setError(`Please fill in: ${[!name && 'Name', !phone && 'Phone'].filter(Boolean).join(', ')}`);
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailRegex.test(email)) { setError('Please enter a valid email address.'); return; }
      setStep(5);
    }
  };

  const seatsCount = sessionType === 'clay-imprints' ? babiesCount : paintersCount;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name || !email || !phone || !date || !time) {
      setError('Missing required fields.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { setError('Please enter a valid email address.'); return; }

    setSubmitting(true);
    try {
      const remaining = await getRemainingCapacity(studio, format(date, 'yyyy-MM-dd'), time, sessionType, seatsCount);
      if (seatsCount > remaining) {
        setError(`This session only has room for ${remaining} more seat${remaining === 1 ? '' : 's'}. Please choose a different time.`);
        setSubmitting(false);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check availability.');
      setSubmitting(false);
      return;
    }

    const booking: BookingInquiry = {
      id: `PP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
      studio,
      name,
      email,
      phone,
      date: format(date, 'yyyy-MM-dd'),
      time,
      paintersCount: seatsCount,
      sessionType,
      status: 'confirmed',
      source: 'online',
      requestDate: new Date().toISOString(),
      notes: sessionType === 'clay-imprints'
        ? `Babies: ${babiesCount}, Adults: ${adultsCount}${notes ? ` | ${notes}` : ''}`
        : notes || undefined,
    };

    try {
      await createPublicBooking(booking);
      setSubmittedBooking(booking);
      setShowSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking.');
    }
    setSubmitting(false);
  };

  const MAX_CAPACITY = studio === 'Putney' ? 32 : 58;

  return (
    <div id="book-view" className="pb-20 pt-6">
      {/* Title + Step Progress */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 mb-8">
        <h1 className="font-heading text-3xl md:text-4xl font-black tracking-tight text-[#1B2D3C] text-center mb-6">
          Book a Session
        </h1>
        <div className="flex items-center gap-0">
          {STEPS.map((label, i) => {
            const num = i + 1;
            const isActive = step === num;
            const isDone = step > num;
            return (
              <div key={num} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all ${
                    isDone ? 'bg-[#DBE7E4] border-[#1B2D3C] text-[#1B2D3C]'
                    : isActive ? 'bg-white border-[#1B2D3C] text-[#1B2D3C]'
                    : 'bg-white border-[#1B2D3C]/20 text-[#1B2D3C]/30'
                  }`}>
                    {num}
                  </div>
                  <span className={`font-heading text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${
                    isActive ? 'text-[#1B2D3C]' : isDone ? 'text-[#1B2D3C]/60' : 'text-[#1B2D3C]/30'
                  }`}>{label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mb-5 transition-all ${
                    step > num ? 'bg-[#1B2D3C]' : 'bg-[#1B2D3C]/15'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="bg-white border border-[#1B2D3C]/20 rounded-2xl p-6 md:p-8 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">

            {/* ── STEP 1: Location ── */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="border-b-2 border-[#1B2D3C]/10 pb-3">
                  <h2 className="font-heading text-xl font-black text-[#1B2D3C]">Choose your studio</h2>
                  <p className="text-xs text-stone-500 mt-1 font-semibold">Select which location you'd like to visit.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(['Putney', 'Wimbledon'] as const).map((loc) => (
                    <button key={loc} type="button" onClick={() => { setStudio(loc); setError(''); }}
                      className={`p-5 border text-left transition-all cursor-pointer rounded-xl ${
                        studio === loc ? 'border-[#1B2D3C]/40 bg-[#DBE7E4] text-[#1B2D3C]' : 'border-[#1B2D3C]/20 bg-white text-[#1B2D3C] hover:border-[#1B2D3C]/60'
                      }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-heading font-black text-base">{loc} Studio</span>
                      </div>
                      <p className={`text-[11px] font-semibold ${studio === loc ? 'text-[#1B2D3C]' : 'text-[#1B2D3C]/50'}`}>
                        {loc === 'Putney' ? '234 Upper Richmond Road, SW15 6TG' : '52 Wimbledon Hill Road, SW19 7PA'}
                      </p>
                    </button>
                  ))}
                </div>
                <button type="button" onClick={handleNext}
                  className="w-full py-4 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer">
                  Continue
                </button>
              </div>
            )}

            {/* ── STEP 2: Session Type ── */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="border-b-2 border-[#1B2D3C]/10 pb-3">
                  <h2 className="font-heading text-xl font-black text-[#1B2D3C]">What would you like to do?</h2>
                  <p className="text-xs text-stone-500 mt-1 font-semibold">Choose your session type at {studio}.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {availableSessionTypes.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => { setSessionType(opt.value); setError(''); }}
                      className={`p-5 border text-left transition-all cursor-pointer rounded-xl ${
                        sessionType === opt.value ? 'border-[#1B2D3C]/40 bg-[#DBE7E4] text-[#1B2D3C]' : 'border-[#1B2D3C]/20 bg-white text-[#1B2D3C] hover:border-[#1B2D3C]/60'
                      }`}>
                      <div>
                        <p className="font-heading font-black text-base">{opt.label}</p>
                        <p className={`text-[11px] font-semibold mt-1 ${sessionType === opt.value ? 'text-[#1B2D3C]/80' : 'text-[#1B2D3C]/50'}`}>{opt.description}</p>
                        {opt.isParty && <p className="font-heading text-[10px] font-bold text-purple-600 mt-1 uppercase tracking-wider">Deposit required</p>}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setStep(1); setError(''); }}
                    className="flex items-center gap-2 px-5 py-3 border border-[#1B2D3C]/20 text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-[#D6E2E9]/40 transition-all cursor-pointer">
                    Back
                  </button>
                  <button type="button" onClick={handleNext}
                    className="flex-1 py-4 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2">
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Date & Time ── */}
            {step === 3 && (
              <div className="space-y-6">
                <div className="border-b-2 border-[#1B2D3C]/10 pb-3">
                  <h2 className="font-heading text-xl font-black text-[#1B2D3C]">Pick a date & time</h2>
                  <p className="text-xs text-stone-500 mt-1 font-semibold">{studio} &middot; {SESSION_TYPE_LABELS[sessionType]}</p>
                </div>

                <div className="flex items-start justify-center">
                  <Calendar
                    selected={date}
                    onSelect={(d) => { setDate(d); setTime(''); }}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    disabled={[...busyDates, ...closedDatesAsDate]}
                    minDate={minDate}
                    dayOfWeekDisabled={disabledWeekDays(sessionType, studio)}
                    schoolHolidayDates={closures.schoolHolidays}
                    disableHolidayMonday={sessionType === 'sip-and-paint'}
                    marks={busyDates}
                  />
                </div>

                {date && timeSlots.length > 0 && (
                  <div className="space-y-2">
                    <span className="font-heading text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">Available slots</span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {timeSlots.map((slot) => {
                        const remaining = slotCapacity[slot] ?? MAX_CAPACITY;
                        const isFull = remaining === 0;
                        return (
                          <button key={slot} type="button"
                            onClick={() => !isFull && setTime(slot)}
                            disabled={isFull}
                            className={`py-3 text-xs font-bold uppercase tracking-wider border transition-all cursor-pointer rounded-lg ${
                              time === slot ? `bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] border-[#1B2D3C]`
                              : isFull ? 'bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed'
                              : 'bg-white text-[#1B2D3C] border-[#1B2D3C]/20 hover:border-[#1B2D3C]'
                            }`}>
                            {slot}
                            {isFull && <span className="block text-[9px] font-normal normal-case tracking-normal mt-0.5">Full</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {date && timeSlots.length === 0 && (
                  <p className="text-xs text-stone-500 font-semibold">No available slots on this date.</p>
                )}

                {/* Seats */}
                {sessionType === 'clay-imprints' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block font-heading text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">How many babies?</label>
                      <div className="flex items-center border border-[#1B2D3C]/20 bg-white overflow-hidden rounded-lg">
                        <button type="button" onClick={() => setBabiesCount(c => Math.max(1, c - 1))} className="px-4 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer select-none">-</button>
                        <span className="flex-1 text-center text-sm font-black text-[#1B2D3C]">{babiesCount}</span>
                        <button type="button" onClick={() => setBabiesCount(c => c + 1)} className="px-4 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer select-none">+</button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="block font-heading text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">How many adults?</label>
                      <div className="flex items-center border border-[#1B2D3C]/20 bg-white overflow-hidden rounded-lg">
                        <button type="button" onClick={() => setAdultsCount(c => Math.max(0, c - 1))} className="px-4 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer select-none">-</button>
                        <span className="flex-1 text-center text-sm font-black text-[#1B2D3C]">{adultsCount}</span>
                        <button type="button" onClick={() => setAdultsCount(c => c + 1)} className="px-4 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer select-none">+</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block font-heading text-[10px] font-black uppercase tracking-widest text-[#1B2D3C]">Number of seats</label>
                    <div className="flex items-center border border-[#1B2D3C]/20 bg-white overflow-hidden rounded-lg max-w-[180px]">
                      <button type="button" onClick={() => setPaintersCount(p => Math.max(1, p - 1))} className="px-5 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer select-none">-</button>
                      <span className="flex-1 text-center text-sm font-black text-[#1B2D3C]">{paintersCount}</span>
                      <button type="button" onClick={() => setPaintersCount(p => Math.min(MAX_CAPACITY, p + 1))} className="px-5 py-3 text-lg font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer select-none">+</button>
                    </div>
                  </div>
                )}

                {date && time && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs font-bold text-emerald-800">
                    {format(date, 'EEEE, do MMMM yyyy')} &middot; {time} &ndash; {parseInt(time.split(':')[0], 10) + 2}:00 &middot; {seatsCount} seat{seatsCount !== 1 ? 's' : ''}
                  </div>
                )}

                <div className="flex gap-3">
                  <button type="button" onClick={() => { setStep(preselectedSessionRef.current ? 1 : 2); setError(''); }}
                    className="flex items-center gap-2 px-5 py-3 border border-[#1B2D3C]/20 text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-[#D6E2E9]/40 transition-all cursor-pointer">
                    Back
                  </button>
                  <button type="button" onClick={handleNext}
                    className="flex-1 py-4 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2">
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Contact Details ── */}
            {step === 4 && (
              <div className="space-y-6">
                <div className="border-b-2 border-[#1B2D3C]/10 pb-3">
                  <h2 className="font-heading text-xl font-black text-[#1B2D3C]">Your details</h2>
                  <p className="text-xs text-stone-500 mt-1 font-semibold">We'll use these for your booking confirmation.</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block font-heading text-[10px] font-bold text-[#1B2D3C] uppercase tracking-widest">Full Name *</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60" />
                  </div>
                  <div className="space-y-2">
                    <label className="block font-heading text-[10px] font-bold text-[#1B2D3C] uppercase tracking-widest">Email Address *</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60" />
                  </div>
                  <div className="space-y-2">
                    <label className="block font-heading text-[10px] font-bold text-[#1B2D3C] uppercase tracking-widest">Phone Number *</label>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="07xxx xxx xxx"
                      className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60" />
                  </div>
                  {sessionType === 'clay-imprints' && (
                    <div className="space-y-2">
                      <label className="block font-heading text-[10px] font-bold text-[#1B2D3C] uppercase tracking-widest">Additional Notes <span className="text-[#1B2D3C]/40 font-semibold normal-case tracking-normal">(optional)</span></label>
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                        placeholder="Anything else we should know?"
                        rows={3}
                        className="w-full py-3 px-4 border border-[#1B2D3C]/20 rounded-lg bg-white text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/60 resize-none" />
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setStep(3); setError(''); }}
                    className="flex items-center gap-2 px-5 py-3 border border-[#1B2D3C]/20 text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-[#D6E2E9]/40 transition-all cursor-pointer">
                    Back
                  </button>
                  <button type="button" onClick={handleNext}
                    className="flex-1 py-4 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2">
                    Review Booking
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 5: Review & Confirm ── */}
            {step === 5 && (
              <div className="space-y-6">
                <div className="border-b-2 border-[#1B2D3C]/10 pb-3">
                  <h2 className="font-heading text-xl font-black text-[#1B2D3C]">Review & confirm</h2>
                  <p className="text-xs text-stone-500 mt-1 font-semibold">Check everything looks right before submitting.</p>
                </div>
                <div className="bg-[#D6E2E9]/40 border border-[#1B2D3C]/15 rounded-xl p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-semibold text-[#1B2D3C]">
                    <div><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Studio</span>{studio}</div>
                    <div><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Session</span>{SESSION_TYPE_LABELS[sessionType]}</div>
                    <div><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Date</span>{date ? format(date, 'EEE d MMM yyyy') : '-'}</div>
                    <div><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Time</span>{time} - {parseInt(time.split(':')[0], 10) + 2}:00</div>
                    <div><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Seats</span>{seatsCount}</div>
                    <div><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Name</span><span className="break-all">{name}</span></div>
                    <div className="col-span-2"><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Email</span><span className="break-all">{email || '-'}</span></div>
                    <div className="col-span-2"><span className="font-heading text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 block mb-0.5">Phone</span>{phone}</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setStep(4); setError(''); }}
                    className="flex items-center gap-2 px-5 py-3 border border-[#1B2D3C]/20 text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-[#D6E2E9]/40 transition-all cursor-pointer">
                    Back
                  </button>
                  <button type="submit" disabled={submitting}
                    className={`flex-1 py-4 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] font-bold text-sm uppercase tracking-widest rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}>
                    {submitting ? 'Submitting...' : 'Confirm Booking'}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 6: Contact-only enquiry (Corporate) ── */}
            {step === 6 && (
              <div className="space-y-6">
                <div className="border-b-2 border-[#1B2D3C]/10 pb-3">
                  <h2 className="font-heading text-xl font-black text-[#1B2D3C]">Corporate Events</h2>
                  <p className="text-xs text-stone-500 mt-1 font-semibold">{studio} Studio</p>
                </div>
                <div className="bg-[#D6E2E9]/40 border border-[#1B2D3C]/15 rounded-xl p-6 text-center space-y-4">
                  <h3 className="font-heading text-lg font-black text-[#1B2D3C]">Contact us to enquire</h3>
                  <p className="text-sm text-[#1B2D3C]/70 font-medium leading-relaxed max-w-md mx-auto">
                    Corporate events are tailored to your group. Get in touch and we'll put together the perfect creative experience for your team.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                    <a href="mailto:info@pitterpotter.co.uk"
                      className={`inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest rounded-xl transition-all`}>
                      Email Us
                    </a>
                    <a href="tel:02037704499"
                      className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-[#1B2D3C]/20 text-[#1B2D3C] font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-[#D6E2E9]/40 transition-all">
                      Call Us
                    </a>
                  </div>
                </div>
                <button type="button" onClick={() => { setStep(2); setError(''); }}
                  className="flex items-center gap-2 px-5 py-3 border border-[#1B2D3C]/20 text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-[#D6E2E9]/40 transition-all cursor-pointer">
                  Back
                </button>
              </div>
            )}

          </form>
        </div>
      </div>

      {/* Success Modal */}
      {showSuccess && submittedBooking && (
        <div className="fixed inset-0 bg-[#1B2D3C]/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#1B2D3C]/20 p-8 max-w-md w-full space-y-4 rounded-xl">
            <div className="text-center">
              <h3 className="font-heading text-2xl font-black text-[#1B2D3C] mb-2">Booking Confirmed!</h3>
              <p className="text-xs text-[#1B2D3C] font-semibold leading-relaxed">
                Thank you {submittedBooking.name}! Your {SESSION_TYPE_LABELS[submittedBooking.sessionType]} session at {submittedBooking.studio} on {format(new Date(submittedBooking.date), 'PPP')} at {submittedBooking.time} is confirmed.
              </p>
              <p className="text-xs text-stone-500 font-semibold leading-relaxed mt-2">
                A confirmation email is on its way to you with a link to reschedule or cancel if needed.
              </p>
            </div>
            <button
              onClick={() => {
                setShowSuccess(false);
                setCurrentPage('home');
              }}
              className={`w-full py-3 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] font-bold text-xs uppercase tracking-widest border border-[#1B2D3C]/20 rounded-lg transition-all cursor-pointer`}
            >
              Back to Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
