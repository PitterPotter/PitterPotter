import { useState } from 'react';
import { format } from 'date-fns';
import { BookingInquiry } from '../types';
import AdminCalendar from './AdminCalendar';
import DayDashboard from './DayDashboard';

interface DashboardOverviewProps {
  bookings: BookingInquiry[];
  onAssignTable: (bookingId: string, tableId: string | null) => void;
  onConfirm?: (bookingId: string) => void;
  onBulkConfirm?: (bookingIds: string[]) => void;
  onNavigateToBookings?: (date?: string) => void;
  onNavigateToAddBooking?: (opts?: { date?: string; sessionType?: string }) => void;
  onUpdateStatus?: (id: string, status: BookingInquiry['status']) => void;
  onEditBooking?: (booking: BookingInquiry) => void;
  onAddWalkIn?: () => void;
  onUploadPhoto?: (booking: BookingInquiry, files: File[]) => void;
  canUpdateStatus?: boolean;
  canAddWalkIn?: boolean;
}

export default function DashboardOverview({
  bookings,
  onConfirm,
  onBulkConfirm,
  onNavigateToBookings,
  onNavigateToAddBooking,
  onUpdateStatus,
  onEditBooking,
  onAddWalkIn,
  onUploadPhoto,
  canUpdateStatus,
  canAddWalkIn,
}: DashboardOverviewProps) {
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {selectedDate ? (
        <DayDashboard
          date={selectedDate}
          bookings={bookings}
          onBack={() => setSelectedDate(null)}
          onUpdateStatus={(id, status) => onUpdateStatus?.(id, status)}
          onEditBooking={(booking) => onEditBooking?.(booking)}
          onAddWalkIn={() => onAddWalkIn?.()}
          onUploadPhoto={onUploadPhoto}
          onAddBooking={(sessionType) => onNavigateToAddBooking?.({ date: selectedDate, sessionType })}
          canUpdateStatus={canUpdateStatus ?? false}
          canAddWalkIn={canAddWalkIn ?? false}
        />
      ) : (
        <AdminCalendar
          bookings={bookings}
          selectedDate={selectedDate ? new Date(selectedDate) : undefined}
          onSelectDate={(date) => setSelectedDate(format(date, 'yyyy-MM-dd'))}
          month={calendarMonth}
          onMonthChange={setCalendarMonth}
        />
      )}
    </div>
  );
}
