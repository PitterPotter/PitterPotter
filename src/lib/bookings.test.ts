import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toBookingInquiry,
  toBookingRow,
  getRemainingCapacity,
  getBusyDates,
  createPublicBooking,
  updateBookingStatus,
} from './bookings';
import { BookingInquiry, Staff } from '../types';

describe('toBookingInquiry', () => {
  it('maps a database row to a BookingInquiry', () => {
    const row = {
      booking_id: 'b-123',
      studio: 'Putney',
      name: 'Alice',
      email: 'alice@example.com',
      phone: '07123456789',
      date: '2025-06-01',
      time: '10:00',
      painters_count: 3,
      session_type: 'painting',
      status: 'confirmed',
      source: 'online',
      request_date: '2025-05-01T10:00:00Z',
    };

    const result = toBookingInquiry(row);

    expect(result).toEqual({
      id: 'b-123',
      studio: 'Putney',
      name: 'Alice',
      email: 'alice@example.com',
      phone: '07123456789',
      date: '2025-06-01',
      time: '10:00',
      paintersCount: 3,
      sessionType: 'painting',
      status: 'confirmed',
      source: 'online',
      requestDate: '2025-05-01T10:00:00Z',
    });
  });
});

describe('toBookingRow', () => {
  it('maps a BookingInquiry to a database row', () => {
    const booking: BookingInquiry = {
      id: 'b-456',
      studio: 'Wimbledon',
      name: 'Bob',
      email: 'bob@example.com',
      phone: '07987654321',
      date: '2025-07-15',
      time: '14:00',
      paintersCount: 2,
      sessionType: 'painting',
      status: 'pending',
      source: 'walk-in',
      requestDate: '2025-06-01T12:00:00Z',
    };

    const result = toBookingRow(booking);

    expect(result).toEqual({
      booking_id: 'b-456',
      studio: 'Wimbledon',
      name: 'Bob',
      email: 'bob@example.com',
      phone: '07987654321',
      date: '2025-07-15',
      time: '14:00',
      painters_count: 2,
      session_type: 'painting',
      status: 'pending',
      source: 'walk-in',
      request_date: '2025-06-01T12:00:00Z',
      notes: null,
      estimated_price: null,
      final_price: null,
      final_balance: null,
      final_seats: null,
      deposit_amount: null,
      gift_card_code: null,
      gift_card_discount: null,
      payment_status: null,
      payment_link_url: null,
      payment_link_sent_at: null,
      stripe_payment_intent_id: null,
      table_id: null,
      management_token: null,
      photos: null,
      collection_status: null,
      collected_at: null,
      deposit_paid_at: null,
      final_paid_at: null,
      ready_at: null,
      painted_flag: null,
    });
  });
});

describe('getRemainingCapacity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns remaining capacity from edge function', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ remaining: 12 }),
    } as Response);

    const remaining = await getRemainingCapacity('Putney', '2025-08-01', '10:00');
    expect(remaining).toBe(12);
  });

  it('falls back to default capacity on edge function error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Failed' }),
    } as Response);

    const remaining = await getRemainingCapacity('Wimbledon', '2025-08-01', '10:00');
    expect(remaining).toBe(58);
  });
});

describe('getBusyDates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns busy dates from edge function', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ busyDates: ['2025-08-01', '2025-08-15'] }),
    } as Response);

    const dates = await getBusyDates('Putney', 2025, 7);
    expect(dates).toEqual(['2025-08-01', '2025-08-15']);
  });

  it('returns empty array when Supabase is not enabled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Offline' }),
    } as Response);

    const dates = await getBusyDates('Putney', 2025, 7);
    expect(dates).toEqual([]);
  });
});

describe('createPublicBooking', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when capacity is insufficient', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Not enough capacity. Only 2 spots remaining for this slot.' }),
    } as Response);

    const booking: BookingInquiry = {
      id: 'b-789',
      studio: 'Putney',
      name: 'Carol',
      email: 'carol@example.com',
      phone: '07111111111',
      date: '2025-08-01',
      time: '10:00',
      paintersCount: 5,
      sessionType: 'painting',
      status: 'pending',
      requestDate: '2025-07-01T10:00:00Z',
    };

    await expect(createPublicBooking(booking)).rejects.toThrow(/Not enough capacity/);
  });
});

describe('updateBookingStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when staff is not provided', async () => {
    await expect(updateBookingStatus('b-123', 'confirmed', null)).rejects.toThrow('Staff required');
  });

  it('calls admin-bookings edge function with updateStatus action', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    const staff: Staff = {
      id: 's-1',
      name: 'Admin',
      username: 'admin',
      passwordHash: 'hash',
      role: 'super_admin',
      canUpdateStatus: true,
      canEditBookings: true,
      canAddWalkIns: true,
      canDeleteBookings: true,
      sessionToken: 'tok',
      sessionExpiresAt: '',
      createdAt: '',
    };
    await updateBookingStatus('b-123', 'confirmed', staff);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/admin-bookings'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"updateStatus"'),
      }),
    );
  });
});
