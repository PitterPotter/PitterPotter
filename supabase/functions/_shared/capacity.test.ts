import { describe, it, expect, vi } from 'vitest';
import { computeCapacity, capacityWarning } from './capacity';
import { planAllocation, largestAvailablePartyCapacity } from './allocation.ts';

// The Wimbledon path delegates to the resource-allocation engine, which needs
// real studio_tables/table_configurations/booking_resources rows. Mock the
// engine boundary so these tests exercise computeCapacity, not the planner.
vi.mock('./allocation.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./allocation.ts')>();
  return {
    ...actual,
    loadStudioConfigFromDb: vi.fn(async () => ({
      tables: [],
      configurations: [],
      partySetupBufferMinutes: 0,
      partyCleanupBufferMinutes: 0,
      normalSessionMinutes: 120,
    })),
    planAllocation: vi.fn(async () => ({
      result: { success: true, configuration: null, blockedStart: null, blockedEnd: null, resources: [] },
      moves: [],
    })),
    largestAvailablePartyCapacity: vi.fn(async () => ({ available: 32, total: 32 })),
  };
});

interface Row {
  painters_count?: number;
  session_type?: string;
  booking_id?: string;
  time?: string;
}

function mockSupabase(bookings: Row[], capacity: { session_type: string; max_painters: number }[]) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select: chain,
        eq: chain,
        in: chain,
        neq: chain,
        not: chain,
        is: chain,
        order: chain,
        limit: chain,
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          resolve({ data: table === 'bookings' ? bookings : capacity, error: null }),
      });
      return builder;
    },
  };
}

const CAPACITY = [
  { session_type: 'open', max_painters: 32 },
  { session_type: 'open_restricted', max_painters: 20 },
  { session_type: 'party', max_painters: 16 },
];

const WIMBLEDON_CAPACITY = [
  { session_type: 'open', max_painters: 56 },
  { session_type: 'open_restricted', max_painters: 32 },
  { session_type: 'party', max_painters: 32 },
];

describe('computeCapacity - party bookings', () => {
  it('does not block a party on an empty slot', async () => {
    const supabase = mockSupabase([], CAPACITY);
    const result = await computeCapacity(supabase, 'Putney', '2026-10-18', '12:30-14:30', 'birthday-party');

    expect(result.conflict).toBeUndefined();
    expect(result.remaining).toBe(16);
    // Regression: this was 0, which made create-booking reject every party
    // with "Maximum number of bookings (0) reached for this time slot."
    expect(result.remainingBookings).toBeGreaterThan(0);
  });

  it('blocks a second party at Putney, which has one party space', async () => {
    const supabase = mockSupabase(
      [{ session_type: 'birthday-party', painters_count: 8, time: '12:30-14:30' }],
      CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Putney', '2026-10-18', '12:30-14:30', 'birthday-party');

    expect(result.conflict).toBe('party_session_exists');
  });

  it('allows a second concurrent party at Wimbledon', async () => {
    vi.mocked(largestAvailablePartyCapacity).mockResolvedValueOnce({ available: 19, total: 32 });
    const supabase = mockSupabase(
      [{ session_type: 'birthday-party', painters_count: 13, time: '10:15-12:15' }],
      WIMBLEDON_CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Wimbledon', '2026-09-13', '10:00-12:00', 'birthday-party');

    expect(result.conflict).toBeUndefined();
    expect(result.remaining).toBe(32 - 13);
    expect(result.remainingBookings).toBe(1);
  });

  it('blocks a third concurrent party at Wimbledon', async () => {
    const supabase = mockSupabase(
      [
        { session_type: 'birthday-party', painters_count: 6, time: '10:00-12:00' },
        { session_type: 'birthday-party', painters_count: 13, time: '10:15-12:15' },
      ],
      WIMBLEDON_CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Wimbledon', '2026-09-13', '10:30-12:30', 'birthday-party');

    expect(result.conflict).toBe('party_session_exists');
  });

  it('leaves no party seats when concurrent parties fill the capacity', async () => {
    vi.mocked(planAllocation).mockResolvedValueOnce({
      result: { success: false, configuration: null, blockedStart: null, blockedEnd: null, resources: [], reason: 'no party configuration available' },
      moves: [],
    });
    vi.mocked(largestAvailablePartyCapacity).mockResolvedValueOnce({ available: 0, total: 32 });
    const supabase = mockSupabase(
      [{ session_type: 'birthday-party', painters_count: 32, time: '10:15-12:15' }],
      WIMBLEDON_CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Wimbledon', '2026-09-13', '10:00-12:00', 'birthday-party');

    expect(result.remaining).toBe(0);
  });
});

describe('computeCapacity - party slot time ranges', () => {
  it('treats a range slot as its start time when checking overlap', async () => {
    // 12:30-14:30 was parsed as 12:00, so a 14:00 party looked 120 minutes away
    // and did not register as overlapping.
    const supabase = mockSupabase(
      [{ session_type: 'birthday-party', painters_count: 8, time: '14:00' }],
      CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Putney', '2026-10-17', '12:30-14:30', 'birthday-party');

    expect(result.conflict).toBe('party_session_exists');
  });

  it('does not treat non-overlapping range slots as conflicting', async () => {
    const supabase = mockSupabase(
      [{ session_type: 'birthday-party', painters_count: 8, time: '14:00' }],
      CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Putney', '2026-10-17', '10:00-12:00', 'birthday-party');

    expect(result.conflict).toBeUndefined();
    expect(result.remaining).toBe(16);
  });
});

describe('computeCapacity - open bookings', () => {
  it('uses full studio capacity when no party is present', async () => {
    const supabase = mockSupabase(
      [{ session_type: 'painting', painters_count: 10, time: '10:00' }],
      CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Putney', '2026-10-18', '10:00', 'painting');

    expect(result.hasPartyBooking).toBe(false);
    expect(result.max).toBe(32);
    expect(result.remaining).toBe(22);
  });

  it('falls back to restricted capacity when a party occupies the back area', async () => {
    const supabase = mockSupabase(
      [
        { session_type: 'painting', painters_count: 10, time: '10:00' },
        { session_type: 'birthday-party', painters_count: 8, time: '10:00-12:00' },
      ],
      CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Putney', '2026-10-18', '10:00', 'painting');

    expect(result.hasPartyBooking).toBe(true);
    expect(result.max).toBe(20);
    expect(result.remaining).toBe(10);
  });

  it('excludes the booking being rescheduled from its own capacity check', async () => {
    const supabase = mockSupabase(
      [{ session_type: 'painting', painters_count: 30, time: '10:00', booking_id: 'PP-1' }],
      CAPACITY,
    );
    const result = await computeCapacity(supabase, 'Putney', '2026-10-18', '10:00', 'painting', 'PP-1');

    expect(result.remaining).toBe(32);
  });
});

describe('capacityWarning', () => {
  const baseBooking = {
    studio: 'Putney',
    date: '2026-10-18',
    time: '10:00',
    sessionType: 'painting',
    paintersCount: 4,
  };

  it('stays silent when the booking fits', async () => {
    const supabase = mockSupabase([], CAPACITY);
    expect(await capacityWarning(supabase, baseBooking)).toBeNull();
  });

  it('warns when seats exceed the remaining capacity', async () => {
    const supabase = mockSupabase(
      [{ session_type: 'painting', painters_count: 30, time: '10:00' }],
      CAPACITY,
    );
    const warning = await capacityWarning(supabase, { ...baseBooking, paintersCount: 6 });

    expect(warning).toContain('Over capacity');
    expect(warning).toContain('only 2 of 32 remain');
  });

  it('warns when the studio party spaces are already taken', async () => {
    const supabase = mockSupabase(
      [{ session_type: 'birthday-party', painters_count: 10, time: '10:00' }],
      CAPACITY,
    );
    const warning = await capacityWarning(supabase, {
      ...baseBooking,
      sessionType: 'birthday-party',
      paintersCount: 8,
    });

    expect(warning).toContain('maximum of 1 party');
  });

  it('does not warn about a booking being edited against its own seats', async () => {
    const supabase = mockSupabase(
      [{ session_type: 'painting', painters_count: 30, time: '10:00', booking_id: 'PP-1' }],
      CAPACITY,
    );
    const warning = await capacityWarning(supabase, { ...baseBooking, paintersCount: 30 }, 'PP-1');

    expect(warning).toBeNull();
  });

  it('ignores bookings without a usable studio, date or time', async () => {
    const supabase = mockSupabase([], CAPACITY);

    expect(await capacityWarning(supabase, { ...baseBooking, studio: 'Elsewhere' })).toBeNull();
    expect(await capacityWarning(supabase, { ...baseBooking, date: '' })).toBeNull();
    expect(await capacityWarning(supabase, { ...baseBooking, time: undefined })).toBeNull();
  });

  it('never throws when the capacity lookup fails', async () => {
    const failing = {
      from() {
        throw new Error('database unavailable');
      },
    };

    expect(await capacityWarning(failing, baseBooking)).toBeNull();
  });
});
