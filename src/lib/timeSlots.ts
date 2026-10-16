import { supabase, isSupabaseEnabled } from './supabase';

export type SlotSessionType = 'painting' | 'baby-prints' | 'party' | 'sip-and-paint';
export type Studio = 'Putney' | 'Wimbledon';
export type DayType = 'weekday' | 'weekend';

export interface SlotConfig {
  slots: Record<DayType, string[]>;
  availableDays: number[];
  enabled: boolean;
  // Extra slots merged in for a specific day-of-week (0=Sun..6=Sat),
  // e.g. evening painting slots on Sip & Paint nights.
  daySlots?: Record<number, string[]>;
}

export type StudioSlots = Record<SlotSessionType, SlotConfig>;
export type TimeSlotsData = Record<Studio, StudioSlots>;

const STORAGE_KEY = 'pp_time_slots';
const SUPABASE_SETTING_KEY = 'time_slots';

const DEFAULT_AVAILABLE_DAYS: Record<SlotSessionType, number[]> = {
  painting: [0, 2, 3, 4, 5, 6],
  'baby-prints': [0, 2, 3, 4, 5, 6],
  party: [0, 2, 3, 4, 5, 6],
  'sip-and-paint': [4, 5, 6],
};

const SINGLE_STUDIO_DEFAULTS: StudioSlots = {
  painting: {
    slots: {
      weekday: ['10:00', '10:30', '12:00', '12:30', '14:00', '14:30', '16:00', '16:30'],
      weekend: ['10:00', '10:30', '12:00', '12:30', '14:00', '14:30', '16:00', '16:30'],
    },
    availableDays: DEFAULT_AVAILABLE_DAYS.painting,
    enabled: true,
  },
  'sip-and-paint': {
    slots: {
      weekday: ['18:00', '18:30', '19:00'],
      weekend: ['18:30', '19:00'],
    },
    availableDays: DEFAULT_AVAILABLE_DAYS['sip-and-paint'],
    enabled: true,
  },
  'baby-prints': {
    slots: {
      weekday: ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'],
      weekend: ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'],
    },
    availableDays: DEFAULT_AVAILABLE_DAYS['baby-prints'],
    enabled: true,
  },
  party: {
    slots: {
      weekday: ['10:00-12:00', '12:30-14:30', '15:00-17:00'],
      weekend: ['10:00-12:00', '12:30-14:30', '15:00-17:00'],
    },
    availableDays: DEFAULT_AVAILABLE_DAYS.party,
    enabled: true,
  },
};

export const DEFAULT_SLOTS: TimeSlotsData = {
  Putney: JSON.parse(JSON.stringify(SINGLE_STUDIO_DEFAULTS)),
  Wimbledon: JSON.parse(JSON.stringify(SINGLE_STUDIO_DEFAULTS)),
};
DEFAULT_SLOTS.Putney['sip-and-paint'].enabled = false;

function isLegacySlots(value: unknown): value is Partial<Record<SlotSessionType, string[]>> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.painting) ||
    Array.isArray(v['sip-and-paint']) ||
    Array.isArray(v['baby-prints']) ||
    Array.isArray(v.party)
  );
}

function isDayTypeSlots(value: unknown): value is Partial<Record<DayType, string[]>> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.weekday) || Array.isArray(v.weekend);
}

function isSessionConfig(value: unknown): value is { slots: Record<DayType, string[]>; availableDays: number[]; enabled?: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const slots = v.slots;
  if (typeof slots !== 'object' || slots === null) return false;
  const s = slots as Record<string, unknown>;
  return (Array.isArray(s.weekday) || Array.isArray(s.weekend)) && Array.isArray(v.availableDays);
}

function isStudioSlots(value: unknown): value is Partial<TimeSlotsData> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.Putney !== null && typeof v.Putney === 'object') ||
    (v.Wimbledon !== null && typeof v.Wimbledon === 'object')
  );
}

function migrateSessionSlots(slots: unknown, defaultSlots: string[]): Record<DayType, string[]> {
  if (Array.isArray(slots)) {
    return { weekday: sortSlots(slots), weekend: sortSlots(slots) };
  }
  if (isDayTypeSlots(slots)) {
    return {
      weekday: sortSlots(Array.isArray(slots.weekday) ? slots.weekday : defaultSlots),
      weekend: sortSlots(Array.isArray(slots.weekend) ? slots.weekend : defaultSlots),
    };
  }
  return { weekday: sortSlots(defaultSlots), weekend: sortSlots(defaultSlots) };
}

function isDaySlots(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>)
    .every(([k, v]) => /^[0-6]$/.test(k) && Array.isArray(v) && v.every((s) => typeof s === 'string'));
}

function migrateSessionConfig(session: unknown, defaults: SlotConfig): SlotConfig {
  if (isSessionConfig(session)) {
    const rawDaySlots = (session as Record<string, unknown>).daySlots;
    const daySlots: Record<number, string[]> | undefined = isDaySlots(rawDaySlots)
      ? Object.fromEntries(Object.entries(rawDaySlots).map(([k, v]) => [Number(k), sortSlots(v)]))
      : undefined;
    return {
      slots: {
        weekday: sortSlots(session.slots.weekday ?? defaults.slots.weekday),
        weekend: sortSlots(session.slots.weekend ?? defaults.slots.weekend),
      },
      availableDays: Array.isArray(session.availableDays) && session.availableDays.length > 0
        ? session.availableDays
        : defaults.availableDays,
      enabled: typeof session.enabled === 'boolean' ? session.enabled : defaults.enabled,
      ...(daySlots ? { daySlots } : {}),
    };
  }
  return {
    slots: migrateSessionSlots(session, defaults.slots.weekday),
    availableDays: defaults.availableDays,
    enabled: defaults.enabled,
  };
}

function migrateOldStudioSlots(studio: Partial<Record<SlotSessionType, unknown>> | undefined, defaults: StudioSlots): StudioSlots {
  return {
    painting: migrateSessionConfig(studio?.painting, defaults.painting),
    'sip-and-paint': migrateSessionConfig(studio?.['sip-and-paint'], defaults['sip-and-paint']),
    'baby-prints': migrateSessionConfig(studio?.['baby-prints'], defaults['baby-prints']),
    party: migrateSessionConfig(studio?.party, defaults.party),
  };
}

export function sortSlots(slots: string[]): string[] {
  const parseStart = (s: string) => {
    const start = s.split('-')[0]?.trim() ?? s;
    const [h, m] = start.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) return h * 60 + m;
    return Infinity;
  };
  return [...slots].sort((a, b) => parseStart(a) - parseStart(b));
}

function loadAll(): TimeSlotsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isStudioSlots(parsed)) {
        return {
          Putney: migrateOldStudioSlots(parsed.Putney, DEFAULT_SLOTS.Putney),
          Wimbledon: migrateOldStudioSlots(parsed.Wimbledon, DEFAULT_SLOTS.Wimbledon),
        };
      }
      if (isLegacySlots(parsed)) {
        const merged: StudioSlots = {
          painting: migrateSessionConfig(parsed.painting, DEFAULT_SLOTS.Putney.painting),
          'sip-and-paint': migrateSessionConfig(parsed['sip-and-paint'], DEFAULT_SLOTS.Putney['sip-and-paint']),
          'baby-prints': migrateSessionConfig(parsed['baby-prints'], DEFAULT_SLOTS.Putney['baby-prints']),
          party: migrateSessionConfig(parsed.party, DEFAULT_SLOTS.Putney.party),
        };
        return { Putney: JSON.parse(JSON.stringify(merged)), Wimbledon: JSON.parse(JSON.stringify(merged)) };
      }
    }
  } catch (err) { console.error('Failed to load time slots from storage:', err); }
  return JSON.parse(JSON.stringify(DEFAULT_SLOTS));
}

function saveAllToLocalStorage(all: TimeSlotsData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (err) { console.error('Failed to save time slots to storage:', err); }
}

export function getSlots(type: SlotSessionType, studio: Studio, dayType: DayType = 'weekday', day?: number): string[] {
  const config = loadAll()[studio][type];
  let slots = config.slots[dayType];
  // 18:00 is not offered for Sip & Paint on weekend days
  if (type === 'sip-and-paint' && dayType === 'weekend') {
    slots = slots.filter((s) => s !== '18:00');
  }
  if (day !== undefined && config.daySlots?.[day]?.length) {
    slots = [...slots, ...config.daySlots[day].filter((s) => !slots.includes(s))];
  }
  return sortSlots(slots);
}

export function getAvailableDays(type: SlotSessionType, studio: Studio): number[] {
  return [...loadAll()[studio][type].availableDays];
}

export function isSessionEnabled(type: SlotSessionType, studio: Studio): boolean {
  return loadAll()[studio][type].enabled ?? true;
}

export function filterPastSlots(slots: string[], date: Date, minHoursAhead: number = 0): string[] {
  const now = new Date();
  const isSameDay = now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  if (!isSameDay) return slots;

  const minTime = new Date(now.getTime() + minHoursAhead * 60 * 60 * 1000);
  return slots.filter((slot) => {
    const parts = slot.split('-')[0].trim().split(':');
    const slotHour = parseInt(parts[0], 10);
    const slotMin = parseInt(parts[1], 10);
    const slotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), slotHour, slotMin, 0, 0);
    return slotDate >= minTime;
  });
}

export function setSlots(type: SlotSessionType, dayType: DayType, slots: string[], studio: Studio): void {
  const all = loadAll();
  all[studio][type].slots[dayType] = sortSlots(slots);
  saveAllToLocalStorage(all);
}

export function setAvailableDays(type: SlotSessionType, days: number[], studio: Studio): void {
  const all = loadAll();
  all[studio][type].availableDays = [...days].sort((a, b) => a - b);
  saveAllToLocalStorage(all);
}

export function setSessionEnabled(type: SlotSessionType, enabled: boolean, studio: Studio): void {
  const all = loadAll();
  all[studio][type].enabled = enabled;
  saveAllToLocalStorage(all);
}

export function getAllSlots(): TimeSlotsData {
  const all = loadAll();
  return JSON.parse(JSON.stringify(all));
}

export function getStudioSlots(studio: Studio): StudioSlots {
  const all = loadAll();
  return JSON.parse(JSON.stringify(all[studio]));
}

export async function loadSlotsFromSupabase(): Promise<TimeSlotsData> {
  try {
    if (!isSupabaseEnabled() || !supabase) return loadAll();

    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', SUPABASE_SETTING_KEY)
      .maybeSingle();

    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (isStudioSlots(parsed)) {
        const merged: TimeSlotsData = {
          Putney: migrateOldStudioSlots(parsed.Putney, DEFAULT_SLOTS.Putney),
          Wimbledon: migrateOldStudioSlots(parsed.Wimbledon, DEFAULT_SLOTS.Wimbledon),
        };
        saveAllToLocalStorage(merged);
        return merged;
      }
      if (isLegacySlots(parsed)) {
        const studioSlots: StudioSlots = {
          painting: migrateSessionConfig(parsed.painting, DEFAULT_SLOTS.Putney.painting),
          'sip-and-paint': migrateSessionConfig(parsed['sip-and-paint'], DEFAULT_SLOTS.Putney['sip-and-paint']),
          'baby-prints': migrateSessionConfig(parsed['baby-prints'], DEFAULT_SLOTS.Putney['baby-prints']),
          party: migrateSessionConfig(parsed.party, DEFAULT_SLOTS.Putney.party),
        };
        const migrated: TimeSlotsData = { Putney: JSON.parse(JSON.stringify(studioSlots)), Wimbledon: JSON.parse(JSON.stringify(studioSlots)) };
        saveAllToLocalStorage(migrated);
        return migrated;
      }
    }
  } catch (err) { console.error('Failed to load time slots from Supabase:', err); }
  return loadAll();
}

export async function saveSlotsToSupabase(
  all: TimeSlotsData,
  username: string,
  sessionToken: string,
): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return;

  const res = await fetch(`${supabaseUrl}/functions/v1/admin-settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      action: 'update',
      username,
      sessionToken,
      key: SUPABASE_SETTING_KEY,
      value: JSON.stringify(all),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to save time slots');
  }
  saveAllToLocalStorage(all);
}
