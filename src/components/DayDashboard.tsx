import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowLeft, Users, CheckCircle, Clock, MapPin, Phone, Mail, Gift,
  FileText, X, ChevronRight, ChevronLeft, UserCheck, Camera,
} from 'lucide-react';
import { BookingInquiry } from '../types';

interface DayDashboardProps {
  date: string;
  bookings: BookingInquiry[];
  onBack: () => void;
  onUpdateStatus: (id: string, status: BookingInquiry['status']) => void;
  onEditBooking: (booking: BookingInquiry) => void;
  onAddWalkIn: () => void;
  onAddBooking: (sessionType: string) => void;
  onUploadPhoto?: (booking: BookingInquiry, files: File[]) => void;
  canUpdateStatus: boolean;
  canAddWalkIn: boolean;
}

const SESSION_LABELS: Record<string, string> = {
  'painting': 'Painting',
  'birthday-party': 'Birthday Party',
  'baby-shower-hen': 'Baby Shower / Hen',
  'clay-imprints': 'Baby Prints',
  'corporate': 'Corporate',
  'exclusive-hire': 'Exclusive Hire',
};

const SESSION_BADGE: Record<string, string> = {
  'painting': 'bg-blue-100 text-blue-800',
  'birthday-party': 'bg-pink-100 text-pink-800',
  'baby-shower-hen': 'bg-purple-100 text-purple-800',
  'clay-imprints': 'bg-orange-100 text-orange-800',
  'corporate': 'bg-slate-100 text-slate-800',
  'exclusive-hire': 'bg-indigo-100 text-indigo-800',
};

function StatBubble({
  label, value, colour,
}: {
  label: string;
  value: number;
  colour: 'slate' | 'amber' | 'green' | 'red';
}) {
  const colourMap = {
    slate: 'bg-[#F8FAFB] border-[#1B2D3C]/10 text-[#1B2D3C]',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    red: 'bg-rose-50 border-rose-200 text-rose-700',
  };
  return (
    <div className={`text-center px-4 py-3 rounded-2xl border ${colourMap[colour]}`}>
      <p className="text-2xl font-black leading-none">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wider mt-1 opacity-70">{label}</p>
    </div>
  );
}

function BookingCard({
  booking,
  column,
  canUpdate,
  showStudio,
  onMove,
  onNoShow,
  onCancel,
  onAddPhoto,
  onClick,
}: {
  booking: BookingInquiry;
  column: 'bookings' | 'seated' | 'complete' | 'noshow';
  canUpdate: boolean;
  showStudio: boolean;
  onMove: (id: string, direction: 'forward' | 'back') => void;
  onNoShow?: (id: string) => void;
  onCancel?: (id: string) => void;
  onAddPhoto?: (booking: BookingInquiry) => void;
  onClick: (booking: BookingInquiry) => void;
}) {
  return (
    <div
      onClick={() => onClick(booking)}
      className={`rounded-xl border p-3 cursor-pointer transition-all hover:shadow-md ${
        column === 'bookings'
          ? 'bg-rose-50/40 border-rose-200/60'
          : column === 'seated'
          ? 'bg-amber-50/40 border-amber-200/60'
          : column === 'noshow'
          ? 'bg-stone-50/40 border-stone-300/60'
          : 'bg-emerald-50/40 border-emerald-200/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-[#1B2D3C] truncate">{booking.name}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${SESSION_BADGE[booking.sessionType] || 'bg-gray-100 text-gray-700'}`}>
              {SESSION_LABELS[booking.sessionType] || booking.sessionType}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-[10px] font-semibold text-[#1B2D3C]/70">
            <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{booking.paintersCount}</span>
            <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{booking.time}</span>
            {showStudio && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{booking.studio}</span>}
          </div>
        </div>
      </div>
      {booking.photos && booking.photos.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {booking.photos.slice(0, 4).map((url, i) => (
            <img key={i} src={url} alt={`Photo ${i + 1}`} className="w-10 h-10 object-cover rounded-md border border-[#1B2D3C]/10" />
          ))}
          {booking.photos.length > 4 && (
            <div className="w-10 h-10 rounded-md border border-[#1B2D3C]/10 bg-[#D6E2E9] flex items-center justify-center text-[9px] font-black text-[#1B2D3C]/60">
              +{booking.photos.length - 4}
            </div>
          )}
        </div>
      )}
      {canUpdate && (
        <div className="flex items-center gap-1.5 mt-2.5">
          {column !== 'bookings' && (
            <button
              onClick={(e) => { e.stopPropagation(); onMove(booking.id, 'back'); }}
              className="flex items-center gap-0.5 px-2 py-1 bg-white/80 border border-[#1B2D3C]/15 text-[#1B2D3C] text-[9px] font-bold uppercase tracking-wider rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3 h-3" /> Back
            </button>
          )}
          {column === 'bookings' && onNoShow && (
            <button
              onClick={(e) => { e.stopPropagation(); onNoShow(booking.id); }}
              className="flex items-center gap-0.5 px-2 py-1 bg-stone-200 hover:bg-stone-300 text-stone-700 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" /> No-Show
            </button>
          )}
          {column === 'bookings' && onCancel && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(booking.id); }}
              className="flex items-center gap-0.5 px-2 py-1 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          )}
          {column === 'seated' && onAddPhoto && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddPhoto(booking); }}
              className="flex items-center gap-0.5 px-2 py-1 bg-[#DBE7E4] hover:bg-[#D6E2E9] border border-[#1B2D3C]/10 text-[#1B2D3C] text-[9px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
            >
              <Camera className="w-3 h-3" /> Photo
            </button>
          )}
          {column !== 'complete' && column !== 'noshow' && (
            <button
              onClick={(e) => { e.stopPropagation(); onMove(booking.id, 'forward'); }}
              className={`flex items-center gap-0.5 px-2 py-1 text-white text-[9px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer ml-auto ${
                column === 'bookings'
                  ? 'bg-amber-500 hover:bg-amber-600'
                  : 'bg-emerald-500 hover:bg-emerald-600'
              }`}
            >
              {column === 'bookings' ? 'Seat' : 'Complete'} <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BookingDetailModal({
  booking,
  onClose,
  onEdit,
}: {
  booking: BookingInquiry;
  onClose: () => void;
  onEdit: (booking: BookingInquiry) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1B2D3C]/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1B2D3C]/10">
          <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Booking Details</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#D6E2E9] transition-colors" aria-label="Close">
            <X className="w-5 h-5 text-[#1B2D3C]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Name</p>
            <p className="text-sm font-black text-[#1B2D3C]">{booking.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${SESSION_BADGE[booking.sessionType] || 'bg-gray-100 text-gray-700'}`}>
              {SESSION_LABELS[booking.sessionType] || booking.sessionType}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              booking.status === 'pending' ? 'bg-amber-100 text-amber-700'
              : booking.status === 'confirmed' ? 'bg-blue-100 text-blue-700'
              : booking.status === 'seated' ? 'bg-amber-100 text-amber-700'
              : booking.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
              : 'bg-stone-100 text-stone-600'
            }`}>
              {booking.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Date</p>
              <p className="text-sm font-bold text-[#1B2D3C]">{booking.date}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Time</p>
              <p className="text-sm font-bold text-[#1B2D3C]">{booking.time}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Seats</p>
              <p className="text-sm font-bold text-[#1B2D3C]">{booking.paintersCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Studio</p>
              <p className="text-sm font-bold text-[#1B2D3C]">{booking.studio}</p>
            </div>
          </div>
          {booking.phone && (
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C]/70">
              <Phone className="w-3.5 h-3.5" /> {booking.phone}
            </div>
          )}
          {booking.email && (
            <div className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C]/70">
              <Mail className="w-3.5 h-3.5" /> {booking.email}
            </div>
          )}
          {booking.giftCardCode && (
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <Gift className="w-3.5 h-3.5" /> {booking.giftCardCode}
            </div>
          )}
          {booking.notes && (
            <div className="flex items-start gap-2 text-xs text-[#1B2D3C]/70 font-semibold">
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {booking.notes}
            </div>
          )}
          {booking.tableId && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Table</p>
              <p className="text-sm font-bold text-[#1B2D3C]">{booking.tableId}</p>
            </div>
          )}
          {booking.photos && booking.photos.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-2">Photos</p>
              <div className="grid grid-cols-3 gap-2">
                {booking.photos.map((url, i) => (
                  <img key={i} src={url} alt={`Photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg border border-[#1B2D3C]/10" />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-[#1B2D3C]/10">
          <button
            onClick={() => onEdit(booking)}
            className="w-full py-2.5 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-colors cursor-pointer"
          >
            Edit Booking
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DayDashboard({
  date,
  bookings,
  onBack,
  onUpdateStatus,
  onEditBooking,
  onUploadPhoto,
  canUpdateStatus,
}: DayDashboardProps) {
  const [selectedBooking, setSelectedBooking] = useState<BookingInquiry | null>(null);

  const dayBookings = useMemo(() => {
    return bookings.filter(b => b.date === date && b.status !== 'cancelled');
  }, [bookings, date]);

  const sortedDayBookings = useMemo(() => {
    return [...dayBookings].sort((a, b) => a.time.localeCompare(b.time));
  }, [dayBookings]);

  const bookingsColumn = sortedDayBookings.filter(b => b.status === 'pending' || b.status === 'confirmed');
  const seatedColumn = sortedDayBookings.filter(b => b.status === 'seated');
  const completeColumn = sortedDayBookings.filter(b => b.status === 'completed');
  const noshowColumn = sortedDayBookings.filter(b => b.status === 'no_show');

  const activeDayBookings = dayBookings.filter(b => b.status !== 'no_show');
  const totalSeats = activeDayBookings.reduce((s, b) => s + b.paintersCount, 0);
  // Studio tag only earns its space when cards can come from both locations
  const showStudio = new Set(dayBookings.map(b => b.studio)).size > 1;

  const handleMove = (id: string, direction: 'forward' | 'back') => {
    const booking = bookings.find(b => b.id === id);
    if (!booking) return;
    if (direction === 'forward') {
      if (booking.status === 'pending' || booking.status === 'confirmed') {
        onUpdateStatus(id, 'seated');
      } else if (booking.status === 'seated') {
        onUpdateStatus(id, 'completed');
      }
    } else {
      if (booking.status === 'seated') {
        onUpdateStatus(id, 'confirmed');
      } else if (booking.status === 'completed') {
        onUpdateStatus(id, 'seated');
      } else if (booking.status === 'no_show') {
        onUpdateStatus(id, 'confirmed');
      }
    }
  };

  const handleNoShow = (id: string) => {
    onUpdateStatus(id, 'no_show');
  };

  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<BookingInquiry | null>(null);
  const handleAddPhoto = (booking: BookingInquiry) => {
    photoTarget.current = booking;
    photoInputRef.current?.click();
  };

  const handleCancel = (id: string) => {
    const booking = bookings.find(b => b.id === id);
    if (!booking) return;
    if (window.confirm(`Cancel ${booking.name}'s booking?`)) {
      onUpdateStatus(id, 'cancelled');
    }
  };

  const handleEdit = (booking: BookingInquiry) => {
    setSelectedBooking(null);
    onEditBooking(booking);
  };

  return (
    <div className="space-y-5">
      {/* Back button + date header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#1B2D3C]/20 text-[#1B2D3C] text-xs font-bold rounded-lg hover:bg-[#D6E2E9] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Calendar
        </button>
        <div>
          <h2 className="font-heading text-xl font-black text-[#1B2D3C]">
            {format(new Date(date), 'EEEE do MMMM yyyy')}
          </h2>
        </div>
      </div>

      {/* Stat bubbles */}
      <div className="grid grid-cols-5 gap-3">
        <StatBubble label="Bookings" value={activeDayBookings.length} colour="slate" />
        <StatBubble label="Seats" value={totalSeats} colour="slate" />
        <StatBubble label="Seated" value={seatedColumn.length} colour="amber" />
        <StatBubble label="Complete" value={completeColumn.length} colour="green" />
        <StatBubble label="No-Show" value={noshowColumn.length} colour="red" />
      </div>

      {/* 3-column kanban — no-shows are rare; the count stays in the stat bubble */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Bookings column (left) — light red */}
        <div className="bg-rose-50/50 border border-rose-200/60 rounded-xl p-4 space-y-3 min-h-[300px]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-rose-800 uppercase tracking-wider">Bookings</h3>
            <span className="px-2 py-0.5 bg-rose-200/60 text-rose-800 text-[10px] font-black rounded-full">{bookingsColumn.length}</span>
          </div>
          {bookingsColumn.length === 0 ? (
            <p className="text-xs text-rose-400/60 font-semibold text-center py-8">No bookings waiting</p>
          ) : (
            bookingsColumn.map(b => (
              <BookingCard
                key={b.id}
                booking={b}
                column="bookings"
                canUpdate={canUpdateStatus}
                showStudio={showStudio}
                onMove={handleMove}
                onNoShow={handleNoShow}
                onCancel={handleCancel}
                onClick={setSelectedBooking}
              />
            ))
          )}
        </div>

        {/* Seated column (middle) — light amber */}
        <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-4 space-y-3 min-h-[300px]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-amber-800 uppercase tracking-wider">Seated</h3>
            <span className="px-2 py-0.5 bg-amber-200/60 text-amber-800 text-[10px] font-black rounded-full">{seatedColumn.length}</span>
          </div>
          {seatedColumn.length === 0 ? (
            <p className="text-xs text-amber-400/60 font-semibold text-center py-8">No one seated yet</p>
          ) : (
            seatedColumn.map(b => (
              <BookingCard
                key={b.id}
                booking={b}
                column="seated"
                canUpdate={canUpdateStatus}
                showStudio={showStudio}
                onMove={handleMove}
                onAddPhoto={handleAddPhoto}
                onClick={setSelectedBooking}
              />
            ))
          )}
        </div>

        {/* Complete column (right) — light green */}
        <div className="bg-emerald-50/50 border border-emerald-200/60 rounded-xl p-4 space-y-3 min-h-[300px]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-emerald-800 uppercase tracking-wider">Complete</h3>
            <span className="px-2 py-0.5 bg-emerald-200/60 text-emerald-800 text-[10px] font-black rounded-full">{completeColumn.length}</span>
          </div>
          {completeColumn.length === 0 ? (
            <p className="text-xs text-emerald-400/60 font-semibold text-center py-8">Nothing completed yet</p>
          ) : (
            completeColumn.map(b => (
              <BookingCard
                key={b.id}
                booking={b}
                column="complete"
                canUpdate={canUpdateStatus}
                showStudio={showStudio}
                onMove={handleMove}
                onClick={setSelectedBooking}
              />
            ))
          )}
        </div>

      </div>

      {/* Hidden photo picker — seated cards' Photo button targets this */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const target = photoTarget.current;
          if (target && e.target.files?.length) onUploadPhoto?.(target, Array.from(e.target.files));
          e.target.value = '';
          photoTarget.current = null;
        }}
      />

      {/* Booking detail modal */}
      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onEdit={handleEdit}
        />
      )}
    </div>
  );
}
