import { useEffect, useMemo, useState } from 'react';
import { BookingInquiry } from '../types';
import { allocateResources, formatResources, isPartySessionType } from '../lib/allocation';

type TableSize = 'small' | 'large';
type ChairSide = 'top' | 'bottom' | 'left' | 'right';
type TableStatus = 'free' | 'partial' | 'full' | 'blocked' | 'selected';

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

const parseTables = (t?: string) => (t ?? '').split(',').map(s => s.trim()).filter(Boolean);

const shortTime = (time: string) => {
  const start = (time.split('-')[0] ?? time).trim();
  const [h, m] = start.split(':');
  const hour = parseInt(h, 10);
  if (isNaN(hour)) return time;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 || 12;
  return m && m !== '00' ? `${h12}:${m}${suffix}` : `${h12}${suffix}`;
};

const byTimeThenName = (a: BookingInquiry, b: BookingInquiry) =>
  a.time.localeCompare(b.time) || a.name.localeCompare(b.name);

interface TableDef {
  id: number;
  size: TableSize;
  chairs: ChairSide[];
  label: string;
  area?: 'main' | 'party1' | 'party2' | 'back';
}

interface PositionedTable extends TableDef {
  x: number;
  y: number;
}

export interface WimbledonFloorPlanProps {
  bookings?: BookingInquiry[];
  selectedDate?: string;
  selectedTime?: string;
  highlightTableId?: string;
  onAssign?: (tableId: string) => void;
  onMoveBooking?: (bookingId: string, tableId: string) => void;
  readOnly?: boolean;
  showTablePanel?: boolean;
  onTableClick?: (tableId: string) => void;
}

interface BlockedTable {
  tableId: string;
  date: string;
  reason: string;
}

// Every table renders at the same size — matches the iOS floor plan.
const TABLE_W = 80;
const TABLE_H = 52;
const BLOCKED_STORAGE_KEY = 'pitter_potter_blocked_tables';

const STATUS_FILL: Record<TableStatus, string> = {
  free: '#FFFFFF',
  partial: '#fef9c3',
  full: '#ef4444',
  blocked: '#6b7280',
  selected: '#1B2D3C',
};
const STATUS_STROKE: Record<TableStatus, string> = {
  free: '#1B2D3C',
  partial: '#ca8a04',
  full: '#b91c1c',
  blocked: '#374151',
  selected: '#1B2D3C',
};
const STATUS_TEXT: Record<TableStatus, string> = {
  free: '#1B2D3C',
  partial: '#854d0e',
  full: '#FFFFFF',
  blocked: '#FFFFFF',
  selected: '#FFFFFF',
};
const STATUS_SUB: Record<TableStatus, string> = {
  free: '#1B2D3C99',
  partial: '#a16207',
  full: '#fecaca',
  blocked: '#d1d5db',
  selected: '#D6E2E9',
};

function tableWidth(_size: TableSize) { return TABLE_W; }
function tableHeight(_size: TableSize) { return TABLE_H; }

function loadBlockedTables(): BlockedTable[] {
  try {
    return JSON.parse(localStorage.getItem(BLOCKED_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveBlockedTables(blocked: BlockedTable[]) {
  localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(blocked));
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

function overlapsTwoHours(timeA: string, timeB: string): boolean {
  return Math.abs(parseTimeToMinutes(timeA) - parseTimeToMinutes(timeB)) < 120;
}

export function findAvailableTable(
  bookings: BookingInquiry[],
  blockedTables: BlockedTable[],
  date: string,
  time: string,
  partyArea?: 'party1' | 'party2'
): string | null {
  const allTables = [...TABLES, ...PARTY_1_TABLES, ...PARTY_2_TABLES, ...BACK_TABLES];
  const candidates = partyArea
    ? allTables.filter(t => t.area === partyArea)
    : allTables.filter(t => !t.area?.startsWith('party'));
  const blockedIds = new Set(blockedTables.filter(b => b.date === date).map(b => b.tableId));
  const assignedIds = new Set(
    bookings.filter(b => b.date === date && b.time && overlapsTwoHours(b.time, time) && b.tableId)
      .flatMap(b => b.tableId!.split(',').map(t => t.trim()))
  );
  for (const t of candidates) {
    const tid = `T${t.id}`;
    if (!blockedIds.has(tid) && !assignedIds.has(tid)) return tid;
  }
  return null;
}

export function findMultipleTables(
  bookings: BookingInquiry[],
  blockedTables: BlockedTable[],
  date: string,
  time: string,
  paintersCount: number,
  partyArea?: 'party1' | 'party2'
): string[] {
  const allTables = [...TABLES, ...PARTY_1_TABLES, ...PARTY_2_TABLES, ...BACK_TABLES];
  const candidates = partyArea
    ? allTables.filter(t => t.area === partyArea)
    : allTables.filter(t => !t.area?.startsWith('party'));
  const blockedIds = new Set(blockedTables.filter(b => b.date === date).map(b => b.tableId));
  const assignedIds = new Set(
    bookings.filter(b => b.date === date && b.time && overlapsTwoHours(b.time, time) && b.tableId)
      .flatMap(b => b.tableId!.split(',').map(t => t.trim()))
  );
  const available = candidates.filter(t => {
    const tid = `T${t.id}`;
    return !blockedIds.has(tid) && !assignedIds.has(tid);
  });
  const result: string[] = [];
  let seated = 0;
  for (const t of available) {
    if (seated >= paintersCount) break;
    result.push(`T${t.id}`);
    seated += t.chairs.length;
  }
  return result;
}

export function useTableAnalytics(bookings: BookingInquiry[] = []) {
  return useMemo(() => {
    const counts: Record<string, number> = {};
    const painterCounts: Record<string, number> = {};
    bookings.forEach(b => {
      if (!b.tableId) return;
      b.tableId.split(',').map(t => t.trim()).filter(Boolean).forEach(tid => {
        counts[tid] = (counts[tid] || 0) + 1;
        painterCounts[tid] = (painterCounts[tid] || 0) + b.paintersCount;
      });
    });
    const entries = Object.entries(counts).map(([tableId, bookingsCount]) => ({
      tableId,
      bookingsCount,
      paintersCount: painterCounts[tableId] || 0,
    }));
    return {
      mostUsed: entries.sort((a, b) => b.bookingsCount - a.bookingsCount).slice(0, 5),
      totalAssignments: entries.reduce((sum, e) => sum + e.bookingsCount, 0),
      tableStats: entries,
    };
  }, [bookings]);
}

function TableShape({
  def, status, occupantLabels, isDropTarget, onClick,
}: {
  def: PositionedTable;
  status: TableStatus;
  occupantLabels: string[];
  isDropTarget?: boolean;
  onClick: () => void;
}) {
  const w = tableWidth(def.size);
  const h = tableHeight(def.size);
  const label = status === 'blocked' ? 'BLOCKED' : 'free';

  return (
    <g onClick={onClick} className="cursor-pointer" role="button" aria-label={`Table ${def.id}`}>
      {isDropTarget && (
        <rect x={def.x - 4} y={def.y - 4} width={w + 8} height={h + 8} rx={6}
          fill="#16a34a22" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 3" />
      )}
      <rect
        x={def.x} y={def.y} width={w} height={h} rx={4}
        fill={STATUS_FILL[status]}
        stroke={STATUS_STROKE[status]}
        strokeWidth={status === 'selected' ? 2.5 : 1.5}
      />
      <text x={def.x + w / 2} y={def.y + h / 2 - (occupantLabels.length ? 10 : 6)} textAnchor="middle" dominantBaseline="middle"
        fontSize={11} fontWeight="800" fill={STATUS_TEXT[status]}>
        T{def.id}
      </text>
      {occupantLabels.length ? (
        occupantLabels.map((l, i) => (
          <text key={i} x={def.x + w / 2} y={def.y + h / 2 + 1 + i * 9} textAnchor="middle" dominantBaseline="middle"
            fontSize={7} fontWeight="700" fill={STATUS_TEXT[status]}>
            {l}
          </text>
        ))
      ) : (
        <text x={def.x + w / 2} y={def.y + h / 2 + 7} textAnchor="middle" dominantBaseline="middle"
          fontSize={8} fill={STATUS_SUB[status]}>
          {label}
        </text>
      )}
    </g>
  );
}

// Layout matching the Wimbledon table spec (same as iOS floor plan):
// Front: T1–T4 down the left, T5–T10 down the right (beam between T8 & T9).
// Bar centre-left between front and back.
// Back: Party Area 1 (T15+T16) and Party Area 2 (T17+T18) on the left;
// T11, T12, T13 down the right, T14 at the bottom.
const TABLES: PositionedTable[] = [
  { id: 1,  size: 'small', chairs: ['top', 'left', 'right'], area: 'main', label: 'T1',  x: 50,  y: 17  },
  { id: 2,  size: 'large', chairs: ['top', 'top', 'bottom', 'left', 'right'], area: 'main', label: 'T2',  x: 50,  y: 87  },
  { id: 3,  size: 'large', chairs: ['top', 'top', 'bottom', 'left', 'right'], area: 'main', label: 'T3',  x: 50,  y: 157 },
  { id: 4,  size: 'large', chairs: ['top', 'top', 'bottom', 'left', 'right'], area: 'main', label: 'T4',  x: 50,  y: 227 },
  { id: 5,  size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'], area: 'main', label: 'T5',  x: 310, y: 17  },
  { id: 6,  size: 'small', chairs: ['top', 'bottom'], area: 'main', label: 'T6',  x: 310, y: 87  },
  { id: 7,  size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'], area: 'main', label: 'T7',  x: 310, y: 157 },
  { id: 8,  size: 'small', chairs: ['top', 'bottom'], area: 'main', label: 'T8',  x: 310, y: 227 },
  { id: 9,  size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'], area: 'main', label: 'T9',  x: 310, y: 297 },
  { id: 10, size: 'small', chairs: ['top', 'left', 'right'], area: 'main', label: 'T10', x: 310, y: 367 },
];

// Back right: normal tables that can also extend the party areas.
const BACK_TABLES: PositionedTable[] = [
  { id: 11, size: 'small', chairs: ['top', 'left', 'right'], area: 'back', label: 'T11', x: 310, y: 447 },
  { id: 12, size: 'small', chairs: ['top', 'left', 'right'], area: 'back', label: 'T12', x: 310, y: 517 },
  { id: 13, size: 'small', chairs: ['top', 'left', 'right'], area: 'back', label: 'T13', x: 310, y: 587 },
  { id: 14, size: 'large', chairs: ['top', 'top', 'bottom', 'left', 'right'], area: 'back', label: 'T14', x: 310, y: 657 },
];

// Party Area 1: T15 + T16 (expandable with T13/T12).
const PARTY_1_TABLES: PositionedTable[] = [
  { id: 15, size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'], area: 'party1', label: 'T15', x: 50,  y: 447 },
  { id: 16, size: 'large', chairs: ['top', 'top', 'bottom', 'left', 'right'], area: 'party1', label: 'T16', x: 170, y: 447 },
];

// Party Area 2: T17 + T18 (expandable with T14).
const PARTY_2_TABLES: PositionedTable[] = [
  { id: 17, size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'], area: 'party2', label: 'T17', x: 50,  y: 517 },
  { id: 18, size: 'large', chairs: ['top', 'top', 'bottom', 'left', 'right'], area: 'party2', label: 'T18', x: 170, y: 517 },
];

export default function WimbledonFloorPlan({
  bookings = [],
  selectedDate,
  selectedTime,
  highlightTableId,
  onAssign,
  onMoveBooking,
  readOnly = false,
  showTablePanel = true,
  onTableClick,
}: WimbledonFloorPlanProps) {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [pendingAssignId, setPendingAssignId] = useState<string | null>(null);
  const [pendingTables, setPendingTables] = useState<string[]>([]);
  const [blockedTables, setBlockedTables] = useState<BlockedTable[]>([]);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockInput, setShowBlockInput] = useState(false);

  useEffect(() => {
    setBlockedTables(loadBlockedTables());
  }, []);

  const allTables = [...TABLES, ...PARTY_1_TABLES, ...PARTY_2_TABLES, ...BACK_TABLES];

  const bookingsByTable = useMemo(() => {
    const map = new Map<string, BookingInquiry[]>();
    if (!selectedDate) return map;
    bookings
      .filter(b => b.date === selectedDate && b.studio === 'Wimbledon' && b.status !== 'cancelled' && b.status !== 'no_show')
      .forEach(b => {
        if (!b.tableId) return;
        b.tableId.split(',').map(t => t.trim()).filter(Boolean).forEach(tid => {
          const list = map.get(tid) || [];
          list.push(b);
          map.set(tid, list);
        });
      });
    return map;
  }, [bookings, selectedDate]);

  const unassignedBookings = useMemo(() => {
    if (!selectedDate) return [];
    return bookings.filter(b => b.date === selectedDate && b.studio === 'Wimbledon' && !b.tableId && b.status !== 'cancelled' && b.status !== 'no_show');
  }, [bookings, selectedDate]);

  const blockedIdsForDate = useMemo(() => {
    return new Set(
      blockedTables
        .filter(b => b.date === selectedDate)
        .flatMap(b => b.tableId.split(',').map(t => t.trim()))
    );
  }, [blockedTables, selectedDate]);

  const highlightIds = useMemo(() => new Set((highlightTableId ?? '').split(',').map(t => t.trim()).filter(Boolean)), [highlightTableId]);

  const getStatus = (tableId: string): TableStatus => {
    if (localSelected === tableId || highlightIds.has(tableId)) return 'selected';
    if (blockedIdsForDate.has(tableId)) return 'blocked';
    const list = bookingsByTable.get(tableId) || [];
    if (list.length === 0) return 'free';
    if (selectedTime && list.some(b => b.time && overlapsTwoHours(b.time, selectedTime))) return 'full';
    return 'partial';
  };

  const handleClick = (id: number) => {
    const tid = `T${id}`;
    // Pending-assign mode: each click toggles that table on the booking,
    // staying in the mode until Done — lets a booking span T5+T6 etc.
    if (pendingAssignId && onMoveBooking) {
      const next = pendingTables.includes(tid)
        ? pendingTables.filter(t => t !== tid)
        : [...pendingTables, tid];
      setPendingTables(next);
      onMoveBooking(pendingAssignId, next.join(', '));
      return;
    }
    if (readOnly) {
      setLocalSelected(prev => prev === tid ? null : tid);
      onTableClick?.(tid);
      return;
    }
    if (blockedIdsForDate.has(tid)) return;
    setLocalSelected(prev => prev === tid ? null : tid);
    onTableClick?.(tid);
    if (onAssign) onAssign(tid);
  };

  const selectedTable = localSelected ? allTables.find(t => `T${t.id}` === localSelected) : null;
  const selectedBookings = localSelected ? (bookingsByTable.get(localSelected) || []).sort((a, b) => a.time.localeCompare(b.time)) : [];
  const selectedBlock = localSelected ? blockedTables.find(b => b.tableId.split(',').map(t => t.trim()).includes(localSelected) && b.date === selectedDate) : null;

  const handleBlock = () => {
    if (!localSelected || !selectedDate) return;
    const reason = blockReason.trim() || 'Blocked';
    const next = [...blockedTables, { tableId: localSelected, date: selectedDate, reason }];
    saveBlockedTables(next);
    setBlockedTables(next);
    setBlockReason('');
    setShowBlockInput(false);
  };

  const handleUnblock = () => {
    if (!localSelected || !selectedDate) return;
    const next = blockedTables.filter(b => !(b.tableId === localSelected && b.date === selectedDate));
    saveBlockedTables(next);
    setBlockedTables(next);
  };

  const bookingLegend = useMemo(() => {
    return bookings
      .filter(b => b.date === selectedDate && b.studio === 'Wimbledon' && b.status !== 'cancelled' && b.status !== 'no_show' && (!selectedTime || (b.time && overlapsTwoHours(b.time, selectedTime))))
      .sort(byTimeThenName)
      .map(b => ({ id: b.id, name: firstName(b.name), painters: b.paintersCount, time: b.time, tableId: b.tableId }));
  }, [bookings, selectedDate, selectedTime]);

  // Dropping appends the table to the booking's set (drag onto T5 then T6
  // gives "T5, T6") and keeps pending mode open for further drops.
  const handleDrop = (tid: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const bookingId = e.dataTransfer.getData('text/plain');
    if (bookingId && onMoveBooking) {
      const base = pendingAssignId === bookingId
        ? pendingTables
        : parseTables(bookings.find(b => b.id === bookingId)?.tableId);
      if (!base.includes(tid)) {
        const next = [...base, tid];
        onMoveBooking(bookingId, next.join(', '));
        setPendingAssignId(bookingId);
        setPendingTables(next);
      }
    }
    setDragTarget(null);
  };

  const togglePending = (bookingId: string, tableId?: string) => {
    if (pendingAssignId === bookingId) {
      setPendingAssignId(null);
      setPendingTables([]);
      return;
    }
    setPendingAssignId(bookingId);
    setPendingTables(parseTables(tableId));
  };

  // Assign every unassigned booking using the allocation engine's seating
  // rules. Simulates against a local copy so sequential picks don't collide.
  const handleAutoAssign = () => {
    if (!onMoveBooking || !selectedDate) return;
    const sim = bookings.map(b => ({
      ...b,
      table_id: b.tableId,
      session_type: b.sessionType,
      painters_count: b.paintersCount,
    })) as (BookingInquiry & { table_id?: string; session_type?: string; painters_count?: number })[];
    const targets = sim
      .filter(b => b.date === selectedDate && b.studio === 'Wimbledon' && b.status !== 'cancelled' && b.status !== 'no_show' && !(b.tableId ?? '').trim())
      .sort(byTimeThenName);
    for (const b of targets) {
      const allocation = allocateResources({
        studio: 'Wimbledon',
        date: b.date,
        time: b.time,
        paintersCount: b.paintersCount,
        sessionType: b.sessionType,
        partyArea: isPartySessionType(b.sessionType) && b.paintersCount > 14 ? 'PA1+PA2' : undefined,
        excludeBookingId: b.id,
      }, sim);
      if (!allocation.success) continue;
      const tableId = formatResources(allocation.resources);
      if (!tableId) continue;
      onMoveBooking(b.id, tableId);
      b.tableId = tableId;
      b.table_id = tableId;
      b.resources = allocation.resources;
    }
  };

  // Clear all of the day's assignments so bookings can be dragged by hand.
  const handleManualAssign = () => {
    if (!onMoveBooking || !selectedDate) return;
    if (!window.confirm('Clear all table assignments for this date? You can then drag bookings onto tables manually.')) return;
    bookings
      .filter(b => b.date === selectedDate && b.studio === 'Wimbledon' && b.status !== 'cancelled' && b.status !== 'no_show' && (b.tableId ?? '').trim())
      .forEach(b => onMoveBooking(b.id, ''));
  };

  const renderTable = (t: PositionedTable) => {
    const tid = `T${t.id}`;
    const status = getStatus(tid);
    const bookingsForTable = bookingsByTable.get(tid) || [];
    const relevantBookings = (selectedTime
      ? bookingsForTable.filter(b => b.time && overlapsTwoHours(b.time, selectedTime))
      : bookingsForTable).sort(byTimeThenName);
    const occupantLabels = relevantBookings
      .slice(0, 2)
      .map(b => `${shortTime(b.time)} ${firstName(b.name)} ${b.paintersCount}p`.slice(0, 18));
    if (relevantBookings.length > 2) occupantLabels.push(`+${relevantBookings.length - 2} more`);
    return (
      <g
        key={t.id}
        onDragOver={onMoveBooking ? (e) => { e.preventDefault(); setDragTarget(tid); } : undefined}
        onDragLeave={onMoveBooking ? () => setDragTarget(null) : undefined}
        onDrop={onMoveBooking ? handleDrop(tid) : undefined}
      >
        <TableShape
          def={t}
          status={status}
          occupantLabels={occupantLabels}
          isDropTarget={dragTarget === tid || (pendingAssignId != null && pendingTables.includes(tid))}
          onClick={() => handleClick(t.id)}
        />
      </g>
    );
  };

  return (
    <div className="bg-white border border-[#1B2D3C]/20 rounded-xl p-4 space-y-4">
      {selectedTable && (
        <div className="flex justify-end">
          <div className="bg-[#DBE7E4] text-[#1B2D3C] px-3 py-1.5 rounded-lg text-xs font-bold">
            {selectedTable.label} selected · {selectedTable.chairs.length} seats
          </div>
        </div>
      )}

      {/* Pending assign banner — click mode alternative to drag & drop */}
      {pendingAssignId && (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2">
          <p className="text-[11px] font-bold text-emerald-800">
            Assigning {firstName(bookings.find(b => b.id === pendingAssignId)?.name || 'booking')}{pendingTables.length ? ` → ${pendingTables.join(', ')}` : ''} — click or drop tables to add/remove
          </p>
          <button
            onClick={() => { setPendingAssignId(null); setPendingTables([]); }}
            className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {/* Unassigned bookings warning */}
      {unassignedBookings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-2">
            {unassignedBookings.length} booking{unassignedBookings.length !== 1 ? 's' : ''} need table assignment
          </p>
          <div className="space-y-1">
            {unassignedBookings.map(b => (
              <div
                key={b.id}
                className={`flex items-center justify-between text-[10px] font-semibold rounded px-1 -mx-1 ${
                  pendingAssignId === b.id
                    ? 'bg-emerald-100 text-emerald-800'
                    : `text-amber-700 ${onMoveBooking ? 'cursor-pointer hover:bg-amber-100' : ''}`
                }`}
                draggable={!!onMoveBooking}
                onDragStart={onMoveBooking ? (e) => e.dataTransfer.setData('text/plain', b.id) : undefined}
                onClick={onMoveBooking ? () => togglePending(b.id, b.tableId) : undefined}
              >
                <span>{firstName(b.name)} · {b.time} · {b.paintersCount}p</span>
                <span className="text-amber-600">
                  {onMoveBooking ? (pendingAssignId === b.id ? 'click tables to add/remove' : 'click or drag onto a table') : b.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {onMoveBooking && selectedDate && (
        <div className="flex gap-2">
          <button
            onClick={handleAutoAssign}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#1B2D3C] text-white hover:bg-[#1B2D3C]/90 cursor-pointer"
          >
            Auto assign
          </button>
          <button
            onClick={handleManualAssign}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-[#1B2D3C]/30 text-[#1B2D3C] hover:bg-[#1B2D3C]/5 cursor-pointer"
          >
            Manual assign
          </button>
        </div>
      )}

      <div className="flex gap-4 items-start">
        {/* Day's bookings — vertical list down the left of the floor plan */}
        <div className="w-44 shrink-0 max-h-[620px] overflow-y-auto space-y-1.5">
          {bookingLegend.length > 0 ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/60 px-0.5 mb-1">
                {bookingLegend.length} booking{bookingLegend.length !== 1 ? 's' : ''}
              </p>
              {bookingLegend.map((b, i) => (
                <div
                  key={i}
                  className={`w-full px-2 py-1.5 rounded-md text-[11px] font-semibold text-[#1B2D3C] ${pendingAssignId === b.id ? 'bg-emerald-100' : 'hover:bg-[#1B2D3C]/5'} ${onMoveBooking ? 'cursor-grab' : 'cursor-pointer'}`}
                  draggable={!!onMoveBooking}
                  onDragStart={onMoveBooking ? (e) => e.dataTransfer.setData('text/plain', b.id) : undefined}
                  onClick={() => {
                    if (onMoveBooking) { togglePending(b.id, b.tableId); return; }
                    const t = (b.tableId ?? '').split(',')[0]?.trim(); if (t) setLocalSelected(t);
                  }}
                  title={onMoveBooking ? "Click to assign tables · drag onto tables to add" : "Click to locate its table"}
                >
                  {shortTime(b.time)} {b.name} {b.painters}p{b.tableId ? ` – ${b.tableId}` : ''}
                </div>
              ))}
            </>
          ) : (
            <div className="space-y-2 text-[10px] font-semibold text-[#1B2D3C]/70">
              <div className="flex items-center gap-1.5"><div className="w-4 h-3 bg-white border border-[#1B2D3C] rounded-sm shrink-0" /><span>Free</span></div>
              <div className="flex items-center gap-1.5"><div className="w-4 h-3 bg-yellow-100 border border-yellow-600 rounded-sm shrink-0" /><span>Has bookings</span></div>
              <div className="flex items-center gap-1.5"><div className="w-4 h-3 bg-red-500 border border-red-700 rounded-sm shrink-0" /><span>Selected slot taken</span></div>
              <div className="flex items-center gap-1.5"><div className="w-4 h-3 bg-gray-500 border border-gray-700 rounded-sm shrink-0" /><span>Blocked</span></div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto flex-1 min-w-0">
          <svg viewBox="0 0 460 745" className="w-full max-w-[460px] h-auto mx-auto" style={{ minHeight: '600px' }}>
          {/* Front area */}
          <rect x={15} y={10} width={430} height={425} rx={8} fill="#F8FAFB" stroke="#1B2D3C" strokeOpacity={0.3} strokeWidth={1} strokeDasharray="4 3" />
          <text x={230} y={28} textAnchor="middle" fontSize={10} fontWeight="700" fill="#1B2D3C99" letterSpacing="2">FRONT</text>

          {/* Bar between front and back, centre-left */}
          <rect x={60} y={322} width={180} height={50} rx={4} fill="#DBE7E4" stroke="#1B2D3C" strokeWidth={1.2} />
          <text x={150} y={350} textAnchor="middle" fontSize={13} fontWeight="800" fill="#1B2D3C" letterSpacing="3">BAR</text>

          {/* Structural beam between T8 and T9 */}
          <rect x={310} y={287} width={50} height={10} rx={2} fill="#1B2D3C" fillOpacity={0.5} />
          <text x={335} y={282} textAnchor="middle" fontSize={8} fontWeight="700" fill="#1B2D3C80">BEAM</text>

          {/* Back area */}
          <rect x={15} y={436} width={430} height={300} rx={8} fill="#F8FAFB" stroke="#1B2D3C" strokeOpacity={0.3} strokeWidth={1} strokeDasharray="4 3" />

          {/* Party Area 1 */}
          <rect x={40} y={442} width={245} height={70} rx={8} fill="#f0fdf4" stroke="#16a34a" strokeWidth={1} strokeDasharray="4 3" />
          {/* Party Area 2 */}
          <rect x={40} y={512} width={245} height={70} rx={8} fill="#f0fdf4" stroke="#16a34a" strokeWidth={1} strokeDasharray="4 3" />
          <text x={300} y={470} textAnchor="start" fontSize={8} fontWeight="700" fill="#16a34a99" transform="rotate(-90 300 470)">PA1</text>
          <text x={300} y={540} textAnchor="start" fontSize={8} fontWeight="700" fill="#16a34a99" transform="rotate(-90 300 540)">PA2</text>

          <text x={385} y={710} textAnchor="middle" fontSize={10} fontWeight="700" fill="#1B2D3C80">Toilets</text>

          {TABLES.map(renderTable)}
          {BACK_TABLES.map(renderTable)}
          {PARTY_1_TABLES.map(renderTable)}
          {PARTY_2_TABLES.map(renderTable)}
        </svg>
        </div>
      </div>

      {showTablePanel && selectedTable && selectedDate && (
        <div className="border border-[#1B2D3C]/20 rounded-xl p-4 bg-[#F8FAFB]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-heading font-black text-[#1B2D3C] text-sm">
              {selectedTable.label} — {selectedDate} schedule
            </h4>
            {!readOnly && (
              <div className="flex gap-2">
                {selectedBlock ? (
                  <button
                    onClick={handleUnblock}
                    className="px-3 py-1.5 bg-white border border-red-300 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-red-50 cursor-pointer"
                  >
                    Unblock ({selectedBlock.reason})
                  </button>
                ) : (
                  <>
                    {showBlockInput ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={blockReason}
                          onChange={e => setBlockReason(e.target.value)}
                          placeholder="Reason"
                          className="px-2 py-1 text-[10px] border border-[#1B2D3C]/20 rounded w-28"
                        />
                        <button onClick={handleBlock} className="px-2 py-1 bg-gray-600 text-white text-[10px] font-bold rounded cursor-pointer">Block</button>
                        <button onClick={() => setShowBlockInput(false)} className="px-2 py-1 text-[10px] font-bold text-[#1B2D3C] cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowBlockInput(true)}
                        className="px-3 py-1.5 bg-gray-200 text-gray-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-gray-300 cursor-pointer"
                      >
                        Block table
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {selectedBlock ? (
            <p className="text-xs text-gray-500 font-semibold">Table blocked: {selectedBlock.reason}</p>
          ) : selectedBookings.length === 0 ? (
            <p className="text-xs text-[#1B2D3C]/50 font-semibold">No bookings on this table for the selected date.</p>
          ) : (
            <div className="space-y-2">
              {selectedBookings.map(b => (
                <div key={b.id} className="flex items-center justify-between bg-white border border-[#1B2D3C]/10 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-[#1B2D3C] bg-[#D6E2E9] px-2 py-0.5 rounded">{b.time}</span>
                    <span className="text-xs font-semibold text-[#1B2D3C]">{firstName(b.name)}</span>
                    <span className="text-[10px] text-[#1B2D3C]/60 font-semibold">{b.paintersCount} painters · {b.sessionType}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${b.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {b.status}
                    </span>
                    {onMoveBooking && (
                      <button
                        onClick={() => onMoveBooking(b.id, '')}
                        className="text-[10px] font-bold text-red-600 hover:text-red-800 cursor-pointer"
                        title="Remove from table"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
