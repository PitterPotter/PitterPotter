import { BookingInquiry, Staff } from '../types';
import { supabase, isSupabaseEnabled } from './supabase';

const DEFAULT_MAX_PAINTERS: Record<'Putney' | 'Wimbledon', number> = { Putney: 32, Wimbledon: 58 };

const functionUrl = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

export function toBookingInquiry(row: any): BookingInquiry {
  return {
    id: row.booking_id,
    studio: row.studio,
    name: row.name,
    email: row.email,
    phone: row.phone,
    date: row.date,
    time: row.time,
    paintersCount: row.painters_count,
    sessionType: row.session_type,
    notes: row.notes || undefined,
    status: row.status,
    requestDate: row.request_date,
    estimatedPrice: row.estimated_price ? Number(row.estimated_price) : undefined,
    source: row.source || undefined,
    giftCardCode: row.gift_card_code || undefined,
    giftCardDiscount: row.gift_card_discount ? Number(row.gift_card_discount) : undefined,
    finalPrice: row.final_price ? Number(row.final_price) : undefined,
    tableId: row.table_id || undefined,
    depositAmount: row.deposit_amount ? Number(row.deposit_amount) : undefined,
    finalSeats: row.final_seats || undefined,
    finalBalance: row.final_balance ? Number(row.final_balance) : undefined,
    paymentLinkUrl: row.payment_link_url || undefined,
    paymentLinkSentAt: row.payment_link_sent_at || undefined,
    paymentStatus: row.payment_status || undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id || undefined,
    depositPaidAt: row.deposit_paid_at || undefined,
    finalPaidAt: row.final_paid_at || undefined,
    managementToken: row.management_token || undefined,
    createdAt: row.created_at || undefined,
    photos: row.photos || undefined,
    photoTags: row.photo_tags || undefined,
    collectionStatus: row.collection_status || undefined,
    collectedAt: row.collected_at || undefined,
  };
}

export function toBookingRow(booking: BookingInquiry): any {
  return {
    booking_id: booking.id,
    studio: booking.studio,
    name: booking.name,
    email: booking.email,
    phone: booking.phone,
    date: booking.date,
    time: booking.time,
    painters_count: booking.paintersCount,
    session_type: booking.sessionType,
    notes: booking.notes || null,
    status: booking.status,
    request_date: booking.requestDate,
    estimated_price: booking.estimatedPrice ?? null,
    source: booking.source || null,
    gift_card_code: booking.giftCardCode || null,
    gift_card_discount: booking.giftCardDiscount ?? null,
    final_price: booking.finalPrice ?? null,
    table_id: booking.tableId || null,
    deposit_amount: booking.depositAmount ?? null,
    final_seats: booking.finalSeats ?? null,
    final_balance: booking.finalBalance ?? null,
    payment_link_url: booking.paymentLinkUrl || null,
    payment_link_sent_at: booking.paymentLinkSentAt || null,
    payment_status: booking.paymentStatus || null,
    stripe_payment_intent_id: booking.stripePaymentIntentId || null,
    deposit_paid_at: booking.depositPaidAt || null,
    final_paid_at: booking.finalPaidAt || null,
    photos: booking.photos || null,
    management_token: booking.managementToken || null,
    collection_status: booking.collectionStatus || null,
    collected_at: booking.collectedAt || null,
  };
}

export async function loadBookings(staff?: Staff | null): Promise<BookingInquiry[]> {
  if (!isSupabaseEnabled()) return [];
  if (!staff) return [];

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'load',
      username: staff.username,
      sessionToken: staff.sessionToken,
    }),
  });

  const data = await response.json();
  if (response.status === 401) {
    throw new Error('Unauthorized');
  }
  if (!response.ok || data.error) {
    console.error('Failed to load bookings:', data.error);
    throw new Error(data.error || 'Failed to load bookings');
  }
  return data as BookingInquiry[];
}

export async function getBusyDates(studio: 'Putney' | 'Wimbledon', year: number, month: number): Promise<string[]> {
  if (!isSupabaseEnabled()) return [];
  const response = await fetch(functionUrl('get-busy-dates'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ studio, year, month }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to get busy dates:', data.error);
    return [];
  }
  return data.busyDates || [];
}

export async function getRemainingCapacity(studio: 'Putney' | 'Wimbledon', date: string, time: string, sessionType?: string, paintersCount?: number, excludeBookingId?: string): Promise<number> {
  if (!isSupabaseEnabled()) return DEFAULT_MAX_PAINTERS[studio];
  const response = await fetch(functionUrl('get-capacity'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ studio, date, time, sessionType, paintersCount, excludeBookingId }),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to get capacity:', data.error);
    return DEFAULT_MAX_PAINTERS[studio];
  }
  if (data.conflict === 'party_session_exists') throw new Error('This time slot already has a party booked. Please choose a different time.');
  return data.remaining ?? DEFAULT_MAX_PAINTERS[studio];
}

export async function createPublicBooking(booking: BookingInquiry): Promise<void> {
  if (!isSupabaseEnabled()) return;

  // Route through edge function for server-side validation
  const response = await fetch(functionUrl('create-booking'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ booking }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || 'Failed to create booking');
  }
}

export async function createBooking(booking: BookingInquiry, staff?: Staff | null): Promise<string | null> {
  if (!isSupabaseEnabled()) return null;
  if (!staff) throw new Error('Staff required');

  const remaining = await getRemainingCapacity(booking.studio, booking.date, booking.time, booking.sessionType, booking.paintersCount);
  if (remaining < booking.paintersCount) {
    throw new Error(`Not enough capacity. Only ${remaining} painter spots remaining for this slot.`);
  }

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'create',
      username: staff.username,
      sessionToken: staff.sessionToken,
      booking,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to create booking:', data.error);
    throw new Error(data.error || 'Failed to create booking');
  }
  return data.warning ?? null;
}

export async function updateBooking(booking: BookingInquiry, staff?: Staff | null): Promise<string | null> {
  if (!isSupabaseEnabled()) return null;
  if (!staff) throw new Error('Staff required');

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'update',
      username: staff.username,
      sessionToken: staff.sessionToken,
      booking,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to update booking:', data.error);
    throw new Error(data.error || 'Failed to update booking');
  }
  return data.warning ?? null;
}

export async function patchBooking(id: string, fields: { studio?: string } & Record<string, unknown>, staff?: Staff | null): Promise<void> {
  if (!isSupabaseEnabled()) return;
  if (!staff) throw new Error('Staff required');

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'patch',
      username: staff.username,
      sessionToken: staff.sessionToken,
      booking: { id, ...fields },
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to patch booking:', data.error);
    throw new Error(data.error || 'Failed to update booking');
  }
}

export async function updateBookingStatus(id: string, status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show', staff?: Staff | null): Promise<void> {
  if (!isSupabaseEnabled()) return;
  if (!staff) throw new Error('Staff required');

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'updateStatus',
      username: staff.username,
      sessionToken: staff.sessionToken,
      id,
      status,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to update booking status:', data.error);
    throw new Error(data.error || 'Failed to update booking status');
  }
}

export async function sendDepositLink(id: string, staff?: Staff | null): Promise<void> {
  if (!isSupabaseEnabled()) return;
  if (!staff) throw new Error('Staff required');

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'sendDepositLink',
      username: staff.username,
      sessionToken: staff.sessionToken,
      id,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to send deposit link:', data.error);
    throw new Error(data.error || 'Failed to send deposit link');
  }
}

export interface StripePaymentDetails {
  id: string;
  status: string;
  amount: number | null;
  amountReceived: number | null;
  currency: string;
  created: string | null;
  description: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardCountry: string | null;
  receiptUrl: string | null;
  amountRefunded: number;
  refunded: boolean;
  paid: boolean;
  livemode: boolean;
}

export async function getPaymentDetails(id: string, staff?: Staff | null): Promise<StripePaymentDetails> {
  if (!staff) throw new Error('Staff required');

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'paymentDetails',
      username: staff.username,
      sessionToken: staff.sessionToken,
      id,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || 'Failed to load payment details');
  }
  return data as StripePaymentDetails;
}

export async function deleteBooking(id: string, staff?: Staff | null): Promise<void> {
  if (!isSupabaseEnabled()) return;
  if (!staff) throw new Error('Staff required');

  const response = await fetch(functionUrl('admin-bookings'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: 'delete',
      username: staff.username,
      sessionToken: staff.sessionToken,
      id,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('Failed to delete booking:', data.error);
    throw new Error(data.error || 'Failed to delete booking');
  }
}
