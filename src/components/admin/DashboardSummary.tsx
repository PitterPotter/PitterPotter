import { useMemo } from 'react';
import { format, parseISO, isToday, isFuture, isPast, differenceInCalendarDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { Calendar, Users, Clock, Package, Check, Camera, Gift, TrendingUp, ChevronRight, MapPin, DollarSign } from 'lucide-react';
import { BookingInquiry, GiftCard } from '../../types';
import { resolveStage, CollectionStage } from './CollectionsTab';

interface DashboardSummaryProps {
  bookings: BookingInquiry[];
  giftCards: GiftCard[];
  isSuperAdmin: boolean;
  staffAllowedStudios: ('Putney' | 'Wimbledon')[] | null;
  studioToggle: 'all' | 'Putney' | 'Wimbledon';
  onStudioToggleChange: (studio: 'all' | 'Putney' | 'Wimbledon') => void;
  onNavigateToBookings: () => void;
  onNavigateToPainted: () => void;
  onNavigateToReady: () => void;
  onNavigateToCollected: () => void;
  onNavigateToAddBooking: () => void;
}

const STAGE_LABEL: Record<CollectionStage, string> = {
  painted: 'Painted',
  ready: 'Ready to Collect',
  collected: 'Collected',
};

const STAGE_BADGE: Record<CollectionStage, string> = {
  painted: 'bg-amber-100 text-amber-800',
  ready: 'bg-blue-100 text-blue-800',
  collected: 'bg-emerald-100 text-emerald-800',
};

export default function DashboardSummary({
  bookings,
  giftCards,
  isSuperAdmin,
  staffAllowedStudios,
  studioToggle,
  onStudioToggleChange,
  onNavigateToBookings,
  onNavigateToPainted,
  onNavigateToReady,
  onNavigateToCollected,
  onNavigateToAddBooking,
}: DashboardSummaryProps) {

  const scopedBookings = useMemo(() => {
    let result = bookings;
    if (staffAllowedStudios && staffAllowedStudios.length > 0) {
      result = result.filter(b => staffAllowedStudios.includes(b.studio as 'Putney' | 'Wimbledon'));
    }
    if (studioToggle !== 'all') {
      result = result.filter(b => b.studio === studioToggle);
    }
    return result;
  }, [bookings, staffAllowedStudios, studioToggle]);

  const scopedGiftCards = useMemo(() => {
    if (isSuperAdmin) return giftCards;
    return [];
  }, [giftCards, isSuperAdmin]);

  const stats = useMemo(() => {
    const active = scopedBookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show');
    const todayBookings = active.filter(b => {
      try { return isToday(parseISO(b.date)); } catch { return false; }
    });
    const upcoming = active.filter(b => {
      try { return isFuture(parseISO(b.date)) && !isToday(parseISO(b.date)); } catch { return false; }
    });
    const pending = active.filter(b => b.status === 'pending');
    const confirmed = active.filter(b => b.status === 'confirmed');

    const collectionCounts = { painted: 0, ready: 0, collected: 0 } as Record<CollectionStage, number>;
    const noPhotoAlerts: BookingInquiry[] = [];
    for (const b of active) {
      const stage = resolveStage(b);
      if (stage) collectionCounts[stage]++;
      if (b.status === 'completed' && (!b.collectionStatus || b.collectionStatus === 'painted') && (!b.photos || b.photos.length === 0)) {
        noPhotoAlerts.push(b);
      }
    }

    const totalPainters = active.reduce((sum, b) => sum + b.paintersCount, 0);
    const todayPainters = todayBookings.reduce((sum, b) => sum + b.paintersCount, 0);

    const getBookingRevenue = (b: BookingInquiry) => b.finalPrice ?? b.estimatedPrice ?? 0;

    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const revenueToday = todayBookings.reduce((sum, b) => sum + getBookingRevenue(b), 0);
    const revenueThisWeek = active.filter(b => {
      try { return isWithinInterval(parseISO(b.date), { start: weekStart, end: weekEnd }); } catch { return false; }
    }).reduce((sum, b) => sum + getBookingRevenue(b), 0);
    const revenueThisMonth = active.filter(b => {
      try { return isWithinInterval(parseISO(b.date), { start: monthStart, end: monthEnd }); } catch { return false; }
    }).reduce((sum, b) => sum + getBookingRevenue(b), 0);

    const forecastDates = active.filter(b => {
      try { return isFuture(parseISO(b.date)) || isToday(parseISO(b.date)); } catch { return false; }
    }).sort((a, b) => a.date.localeCompare(b.date));

    const forecastByDate = new Map<string, { date: string; painters: number; bookings: number }>();
    for (const b of forecastDates) {
      const existing = forecastByDate.get(b.date);
      if (existing) {
        existing.painters += b.paintersCount;
        existing.bookings += 1;
      } else {
        forecastByDate.set(b.date, { date: b.date, painters: b.paintersCount, bookings: 1 });
      }
    }
    const forecast = [...forecastByDate.values()].slice(0, 7);

    return {
      total: active.length,
      today: todayBookings.length,
      todayPainters,
      upcoming: upcoming.length,
      pending: pending.length,
      confirmed: confirmed.length,
      totalPainters,
      collection: collectionCounts,
      noPhotoAlerts,
      revenueToday,
      revenueThisWeek,
      revenueThisMonth,
      forecast,
    };
  }, [scopedBookings]);

  const giftCardStats = useMemo(() => {
    if (!isSuperAdmin) return null;
    return {
      total: scopedGiftCards.length,
      active: scopedGiftCards.filter(c => c.status === 'active').length,
      totalValue: scopedGiftCards.reduce((sum, c) => sum + c.amount, 0),
      remainingValue: scopedGiftCards.reduce((sum, c) => sum + c.balance, 0),
    };
  }, [scopedGiftCards, isSuperAdmin]);

  const studioLabel = staffAllowedStudios && staffAllowedStudios.length > 0
    ? staffAllowedStudios.join(' + ')
    : (isSuperAdmin ? 'All Studios' : 'All Studios (no assignment)');

  const todayBookings = useMemo(() => {
    return scopedBookings
      .filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
      .filter(b => { try { return isToday(parseISO(b.date)); } catch { return false; } })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [scopedBookings]);

  const upcomingBookings = useMemo(() => {
    return scopedBookings
      .filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
      .filter(b => { try { return isFuture(parseISO(b.date)) && !isToday(parseISO(b.date)); } catch { return false; } })
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      .slice(0, 5);
  }, [scopedBookings]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-black text-[#1B2D3C]">Dashboard Summary</h2>
          <p className="text-xs text-[#1B2D3C]/60 mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> {studioToggle === 'all' ? studioLabel : studioToggle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(isSuperAdmin || (staffAllowedStudios && staffAllowedStudios.length > 1)) && (
            <div className="flex rounded-lg border border-[#1B2D3C]/15 overflow-hidden">
              {(['all', 'Putney', 'Wimbledon'] as const)
                .filter(s => s === 'all' || isSuperAdmin || (staffAllowedStudios?.includes(s as 'Putney' | 'Wimbledon')))
                .map(s => (
                  <button
                    key={s}
                    onClick={() => onStudioToggleChange(s)}
                    className={`px-2.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
                      studioToggle === s ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/50 hover:text-[#1B2D3C]'
                    }`}
                  >
                    {s === 'all' ? 'All' : s}
                  </button>
                ))}
            </div>
          )}
          <button
            onClick={onNavigateToAddBooking}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-all cursor-pointer"
          >
            + Add Booking
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Today" value={stats.today} sub={`${stats.todayPainters} painters`} icon={<Calendar className="w-4 h-4" />} onClick={onNavigateToBookings} />
        <StatCard label="Upcoming" value={stats.upcoming} sub="future bookings" icon={<Clock className="w-4 h-4" />} onClick={onNavigateToBookings} />
        <StatCard label="Awaiting" value={stats.pending} sub="needs confirmation" icon={<Users className="w-4 h-4" />} onClick={onNavigateToBookings} highlight={stats.pending > 0} />
        <StatCard label="Confirmed" value={stats.confirmed} sub="ready to go" icon={<Check className="w-4 h-4" />} onClick={onNavigateToBookings} />
      </div>

      {/* Revenue summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3.5 h-3.5 text-[#1B2D3C]/40" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Today</span>
          </div>
          <p className="text-xl font-black text-[#1B2D3C]">£{stats.revenueToday.toFixed(0)}</p>
        </div>
        <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3.5 h-3.5 text-[#1B2D3C]/40" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">This Week</span>
          </div>
          <p className="text-xl font-black text-[#1B2D3C]">£{stats.revenueThisWeek.toFixed(0)}</p>
        </div>
        <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign className="w-3.5 h-3.5 text-[#1B2D3C]/40" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">This Month</span>
          </div>
          <p className="text-xl font-black text-[#1B2D3C]">£{stats.revenueThisMonth.toFixed(0)}</p>
        </div>
      </div>

      {/* Painter forecast */}
      {stats.forecast.length > 0 && (
        <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
          <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Users className="w-4 h-4" /> Painter Forecast (Next 7 Days)
          </h3>
          <div className="space-y-2">
            {stats.forecast.map(f => {
              try {
                const d = parseISO(f.date);
                const isTodayDate = isToday(d);
                return (
                  <div key={f.date} className={`flex items-center gap-3 py-1.5 px-2 rounded-lg ${isTodayDate ? 'bg-[#DBE7E4]/50' : ''}`}>
                    <span className="text-xs font-black text-[#1B2D3C] w-20 shrink-0">
                      {format(d, 'EEE d MMM')}
                    </span>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 bg-[#1B2D3C]/10 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-[#1B2D3C] h-full rounded-full"
                          style={{ width: `${Math.min(100, (f.painters / 40) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-black text-[#1B2D3C] shrink-0">{f.painters} painters</span>
                      <span className="text-[10px] font-semibold text-[#1B2D3C]/40 shrink-0">{f.bookings} booking{f.bookings !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                );
              } catch { return null; }
            })}
          </div>
        </div>
      )}

      {/* Photo alerts */}
      {stats.noPhotoAlerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-black text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
              <Camera className="w-4 h-4" /> {stats.noPhotoAlerts.length} completed booking{stats.noPhotoAlerts.length !== 1 ? 's' : ''} need photo{stats.noPhotoAlerts.length !== 1 ? 's' : ''}
            </h3>
            <button
              onClick={onNavigateToPainted}
              className="text-[10px] font-bold uppercase tracking-wider text-amber-800 hover:text-amber-900 cursor-pointer flex items-center gap-0.5"
            >
              Go to Painted <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1.5">
            {stats.noPhotoAlerts.slice(0, 4).map(b => (
              <div key={b.id} className="flex items-center gap-3 py-1">
                <span className="text-[10px] font-semibold text-amber-700/70 shrink-0">
                  {b.date ? format(parseISO(b.date), 'dd MMM') : '—'}
                </span>
                <span className="text-xs font-black text-amber-900 truncate flex-1">{b.name}</span>
                <span className="text-[10px] font-bold text-amber-700/70 shrink-0">{b.studio}</span>
              </div>
            ))}
            {stats.noPhotoAlerts.length > 4 && (
              <p className="text-[10px] font-semibold text-amber-700/70 pt-1">
                +{stats.noPhotoAlerts.length - 4} more…
              </p>
            )}
          </div>
        </div>
      )}

      {/* Collection summary */}
      <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
        <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider mb-3">Collections</h3>
        <div className="grid grid-cols-3 gap-3">
          <CollectionStat label="Painted" count={stats.collection.painted} badgeClass={STAGE_BADGE.painted} icon={<Camera className="w-4 h-4" />} onClick={onNavigateToPainted} />
          <CollectionStat label="Ready to Collect" count={stats.collection.ready} badgeClass={STAGE_BADGE.ready} icon={<Package className="w-4 h-4" />} onClick={onNavigateToReady} />
          <CollectionStat label="Collected" count={stats.collection.collected} badgeClass={STAGE_BADGE.collected} icon={<Check className="w-4 h-4" />} onClick={onNavigateToCollected} />
        </div>
      </div>

      {/* Today's bookings */}
      <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">Today's Bookings</h3>
          <button onClick={onNavigateToBookings} className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 hover:text-[#1B2D3C] cursor-pointer flex items-center gap-0.5">
            View all <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {todayBookings.length === 0 ? (
          <p className="text-xs text-[#1B2D3C]/40 font-semibold py-4 text-center">No bookings today</p>
        ) : (
          <div className="space-y-2">
            {todayBookings.map(b => (
              <BookingLine key={b.id} booking={b} />
            ))}
          </div>
        )}
      </div>

      {/* Upcoming bookings */}
      <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">Upcoming</h3>
          <button onClick={onNavigateToBookings} className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 hover:text-[#1B2D3C] cursor-pointer flex items-center gap-0.5">
            View all <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {upcomingBookings.length === 0 ? (
          <p className="text-xs text-[#1B2D3C]/40 font-semibold py-4 text-center">No upcoming bookings</p>
        ) : (
          <div className="space-y-2">
            {upcomingBookings.map(b => (
              <BookingLine key={b.id} booking={b} showDate />
            ))}
          </div>
        )}
      </div>

      {/* Gift card summary (super admin only) */}
      {giftCardStats && (
        <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider flex items-center gap-1.5">
              <Gift className="w-4 h-4" /> Gift Vouchers
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">
              <TrendingUp className="w-3 h-3 inline mr-0.5" />
              £{giftCardStats.totalValue.toFixed(0)} sold
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MiniStat label="Total" value={giftCardStats.total} />
            <MiniStat label="Active" value={giftCardStats.active} />
            <MiniStat label="Remaining" value={`£${giftCardStats.remainingValue.toFixed(0)}`} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon, onClick, highlight }: {
  label: string;
  value: number | string;
  sub: string;
  icon: React.ReactNode;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all hover:shadow-md cursor-pointer ${
        highlight ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#1B2D3C]/15'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/60">{label}</span>
        <span className="text-[#1B2D3C]/30">{icon}</span>
      </div>
      <p className="text-2xl font-black text-[#1B2D3C]">{value}</p>
      <p className="text-[10px] font-semibold text-[#1B2D3C]/40 mt-0.5">{sub}</p>
    </button>
  );
}

function CollectionStat({ label, count, badgeClass, icon, onClick }: {
  label: string;
  count: number;
  badgeClass: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left p-3 rounded-lg border border-[#1B2D3C]/10 hover:border-[#1B2D3C]/30 transition-all hover:shadow-sm cursor-pointer"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`px-1.5 py-0.5 ${badgeClass} text-[9px] font-black rounded uppercase tracking-wider`}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[#1B2D3C]/30">{icon}</span>
        <p className="text-xl font-black text-[#1B2D3C]">{count}</p>
      </div>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-[#D6E2E9]/30 p-2.5 rounded-lg">
      <p className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C]/60">{label}</p>
      <p className="text-lg font-black text-[#1B2D3C]">{value}</p>
    </div>
  );
}

function BookingLine({ booking, showDate }: { booking: BookingInquiry; showDate?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex items-center gap-1.5 shrink-0">
        <Clock className="w-3 h-3 text-[#1B2D3C]/40" />
        <span className="text-xs font-bold text-[#1B2D3C]">{booking.time}</span>
      </div>
      {showDate && (
        <span className="text-[10px] font-semibold text-[#1B2D3C]/50 shrink-0">
          {booking.date ? format(parseISO(booking.date), 'dd MMM') : '—'}
        </span>
      )}
      <span className="text-xs font-black text-[#1B2D3C] truncate flex-1">{booking.name}</span>
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#D6E2E9] text-[#1B2D3C] rounded-full text-[10px] font-black shrink-0">
        <Users className="w-2.5 h-2.5" />{booking.paintersCount}
      </span>
      <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-full shrink-0 ${
        booking.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800'
        : booking.status === 'cancelled' ? 'bg-red-100 text-red-700'
        : booking.status === 'seated' ? 'bg-amber-100 text-amber-800'
        : booking.status === 'completed' ? 'bg-teal-100 text-teal-800'
        : 'bg-amber-100 text-amber-800'
      }`}>
        {booking.status === 'confirmed' ? 'Confirmed' : booking.status === 'cancelled' ? 'Cancelled' : booking.status === 'seated' ? 'Seated' : booking.status === 'completed' ? 'Complete' : 'Awaiting'}
      </span>
    </div>
  );
}
