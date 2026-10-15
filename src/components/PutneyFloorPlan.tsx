import { useEffect, useMemo, useState } from 'react';
import { BookingInquiry } from '../types';

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

function overlapsTwoHours(timeA: string, timeB: string): boolean {
  return Math.abs(parseTimeToMinutes(timeA) - parseTimeToMinutes(timeB)) < 120;
}

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
  area?: 'main' | 'party';
}

interface PositionedTable extends TableDef {
  x: number;
  y: number;
}

export interface PutneyFloorPlanProps {
  bookings?: BookingInquiry[];
  selectedDate?: string;
  selectedTime?: string;
  highlightTableId?: string;
  onAssign?: (tableId: string) => void;
  onMoveBooking?: (bookingId: string, tableId: string) => void;
  onSeatBooking?: (bookingId: string) => void;
  onBlockStudio?: (startTime: string, endTime: string, label: string) => void;
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
const BLOCKED_STORAGE_KEY = 'pitter_potter_blocked_tables_putney';

const STATUS_FILL: Record<TableStatus, string> = {
  free: '#FFFFFF', partial: '#fef9c3', full: '#ef4444', blocked: '#6b7280', selected: '#1B2D3C',
};
const STATUS_STROKE: Record<TableStatus, string> = {
  free: '#1B2D3C', partial: '#ca8a04', full: '#b91c1c', blocked: '#374151', selected: '#1B2D3C',
};
const STATUS_TEXT: Record<TableStatus, string> = {
  free: '#1B2D3C', partial: '#854d0e', full: '#FFFFFF', blocked: '#FFFFFF', selected: '#FFFFFF',
};
const STATUS_SUB: Record<TableStatus, string> = {
  free: '#1B2D3C99', partial: '#a16207', full: '#fecaca', blocked: '#d1d5db', selected: '#D6E2E9',
};

function tableWidth(_size: TableSize) { return TABLE_W; }
function tableHeight(_size: TableSize) { return TABLE_H; }

function loadBlockedTables(): BlockedTable[] {
  try { return JSON.parse(localStorage.getItem(BLOCKED_STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveBlockedTables(blocked: BlockedTable[]) {
  localStorage.setItem(BLOCKED_STORAGE_KEY, JSON.stringify(blocked));
}

export function findAvailablePutneyTable(
  bookings: BookingInquiry[],
  blockedTables: BlockedTable[],
  date: string,
  time: string,
): string | null {
  const allTables = [...MAIN_TABLES, ...PARTY_TABLES];
  const blockedIds = new Set(blockedTables.filter(b => b.date === date).map(b => b.tableId));
  const assignedIds = new Set(
    bookings.filter(b => b.date === date && b.time && overlapsTwoHours(b.time, time) && b.tableId)
      .flatMap(b => b.tableId!.split(',').map(t => t.trim()))
  );
  for (const t of allTables) {
    const tid = `T${t.id}`;
    if (!blockedIds.has(tid) && !assignedIds.has(tid)) return tid;
  }
  return null;
}

export function findMultiplePutneyTables(
  bookings: BookingInquiry[],
  blockedTables: BlockedTable[],
  date: string,
  time: string,
  paintersCount: number,
  partyOnly = false,
): string[] {
  const allTables = partyOnly ? PARTY_TABLES : [...MAIN_TABLES, ...PARTY_TABLES];
  const blockedIds = new Set(blockedTables.filter(b => b.date === date).map(b => b.tableId));
  const assignedIds = new Set(
    bookings.filter(b => b.date === date && b.time && overlapsTwoHours(b.time, time) && b.tableId)
      .flatMap(b => b.tableId!.split(',').map(t => t.trim()))
  );
  const available = allTables.filter(t => {
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
      tableId, bookingsCount, paintersCount: painterCounts[tableId] || 0,
    }));
    return {
      mostUsed: entries.sort((a, b) => b.bookingsCount - a.bookingsCount).slice(0, 5),
      totalAssignments: entries.reduce((sum, e) => sum + e.bookingsCount, 0),
      tableStats: entries,
    };
  }, [bookings]);
}

function TableShape({ def, status, occupantLabels, isDropTarget, onClick }: {
  def: PositionedTable; status: TableStatus; occupantLabels: string[]; isDropTarget?: boolean; onClick: () => void;
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
      <rect x={def.x} y={def.y} width={w} height={h} rx={4}
        fill={STATUS_FILL[status]} stroke={STATUS_STROKE[status]} strokeWidth={status === 'selected' ? 2.5 : 1.5} />
      <text x={def.x + w / 2} y={def.y + h / 2 - (occupantLabels.length ? 10 : 6)} textAnchor="middle" dominantBaseline="middle"
        fontSize={11} fontWeight="800" fill={STATUS_TEXT[status]}>T{def.id}</text>
      {occupantLabels.length ? (
        occupantLabels.map((l, i) => (
          <text key={i} x={def.x + w / 2} y={def.y + h / 2 + 1 + i * 9} textAnchor="middle" dominantBaseline="middle"
            fontSize={7} fontWeight="700" fill={STATUS_TEXT[status]}>{l}</text>
        ))
      ) : (
        <text x={def.x + w / 2} y={def.y + h / 2 + 7} textAnchor="middle" dominantBaseline="middle"
          fontSize={8} fill={STATUS_SUB[status]}>{label}</text>
      )}
    </g>
  );
}

// Left column: T1–T4 (small, portrait orientation)
// Right column: T5–T6 (large, landscape)
// Party area: T7 (large), T8 (small), T9 (small), T10 (large)
const MAIN_TABLES: PositionedTable[] = [
  { id: 1, size: 'small', chairs: ['top', 'left', 'left', 'right', 'right'], area: 'main', label: 'T1', x: 55, y: 55 },
  { id: 2, size: 'small', chairs: ['left', 'right'],                          area: 'main', label: 'T2', x: 55, y: 165 },
  { id: 3, size: 'small', chairs: ['left', 'right'],                          area: 'main', label: 'T3', x: 55, y: 255 },
  { id: 4, size: 'small', chairs: ['left', 'left', 'right', 'right', 'bottom'], area: 'main', label: 'T4', x: 55, y: 345 },
  { id: 5, size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'],         area: 'main', label: 'T5', x: 270, y: 55 },
  { id: 6, size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'],         area: 'main', label: 'T6', x: 270, y: 165 },
];

const PARTY_TABLES: PositionedTable[] = [
  { id: 7,  size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'], area: 'party', label: 'T7',  x: 30,  y: 560 },
  { id: 8,  size: 'small', chairs: ['top', 'bottom'],                   area: 'party', label: 'T8',  x: 165, y: 560 },
  { id: 9,  size: 'small', chairs: ['top', 'bottom'],                   area: 'party', label: 'T9',  x: 255, y: 560 },
  { id: 10, size: 'large', chairs: ['top', 'top', 'bottom', 'bottom'], area: 'party', label: 'T10', x: 340, y: 560 },
];

export default function PutneyFloorPlan({
  bookings = [],
  selectedDate,
  selectedTime,
  highlightTableId,
  onAssign,
  onMoveBooking,
  onSeatBooking,
  onBlockStudio,
  readOnly = false,
  showTablePanel = true,
  onTableClick,
}: PutneyFloorPlanProps) {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [pendingAssignId, setPendingAssignId] = useState<string | null>(null);
  const [pendingTables, setPendingTables] = useState<string[]>([]);
  const [showSeated, setShowSeated] = useState(false);
  const [blockedTables, setBlockedTables] = useState<BlockedTable[]>([]);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockInput, setShowBlockInput] = useState(false);
  const [showBlockStudio, setShowBlockStudio] = useState(false);
  const [blockStart, setBlockStart] = useState('10:00');
  const [blockEnd, setBlockEnd] = useState('12:00');
  const [blockLabel, setBlockLabel] = useState('Studio Block');

  useEffect(() => { setBlockedTables(loadBlockedTables()); }, []);

  const allTables = [...MAIN_TABLES, ...PARTY_TABLES];

  const bookingsByTable = useMemo(() => {
    const map = new Map<string, BookingInquiry[]>();
    if (!selectedDate) return map;
    bookings
      .filter(b => b.date === selectedDate && b.studio === 'Putney')
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
    return bookings
      .filter(b => b.date === selectedDate && b.studio === 'Putney' && !b.tableId && (b.status === 'pending' || b.status === 'confirmed'))
      .sort(byTimeThenName);
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

  // Sidebar shows only bookings still waiting to be seated — seated and
  // completed parties drop out of the list like the dashboard columns.
  const bookingLegend = useMemo(() => {
    return bookings
      .filter(b => b.date === selectedDate && b.studio === 'Putney' && (b.status === 'pending' || b.status === 'confirmed') && (!selectedTime || (b.time && overlapsTwoHours(b.time, selectedTime))))
      .sort(byTimeThenName)
      .map(b => ({ id: b.id, name: firstName(b.name), painters: b.paintersCount, time: b.time, tableId: b.tableId, isBlock: b.source === 'block' }));
  }, [bookings, selectedDate, selectedTime]);

  const seatedLegend = useMemo(() => {
    return bookings
      .filter(b => b.date === selectedDate && b.studio === 'Putney' && b.status === 'seated')
      .sort(byTimeThenName)
      .map(b => ({ id: b.id, name: firstName(b.name), painters: b.paintersCount, time: b.time, tableId: b.tableId }));
  }, [bookings, selectedDate]);

  // Dropping appends the table to the booking's set (drag onto T5 then T6
  // gives "T5, T6") and keeps pending mode open for further drops. On
  // today's plan a drop also seats the booking — it's the "they arrived"
  // gesture; for future dates it only assigns, so tomorrow's plan can be
  // laid out without marking people as arrived.
  const handleDrop = (tid: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const bookingId = e.dataTransfer.getData('text/plain');
    const booking = bookings.find(b => b.id === bookingId);
    if (bookingId && booking && onMoveBooking) {
      const base = pendingAssignId === bookingId
        ? pendingTables
        : parseTables(booking.tableId);
      if (!base.includes(tid)) {
        const next = [...base, tid];
        onMoveBooking(bookingId, next.join(', '));
        setPendingAssignId(bookingId);
        setPendingTables(next);
      }
      const isToday = selectedDate === new Date().toISOString().split('T')[0];
      if (onSeatBooking && isToday && (booking.status === 'pending' || booking.status === 'confirmed')) {
        onSeatBooking(bookingId);
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

  // Assign every unassigned booking using the seating rules. Simulates
  // against a local copy so sequential picks don't collide.
  const handleAutoAssign = () => {
    if (!onMoveBooking || !selectedDate) return;
    const sim = bookings.map(b => ({ ...b }));
    const targets = sim
      .filter(b => b.date === selectedDate && b.studio === 'Putney' && b.status !== 'cancelled' && b.status !== 'no_show' && !(b.tableId ?? '').trim())
      .sort(byTimeThenName);
    for (const b of targets) {
      const tableIds = findMultiplePutneyTables(sim, blockedTables, b.date, b.time, b.paintersCount, b.sessionType.includes('party'));
      if (!tableIds.length) continue;
      const tableId = tableIds.join(', ');
      onMoveBooking(b.id, tableId);
      b.tableId = tableId;
    }
  };

  // Clear all of the day's assignments so bookings can be dragged by hand.
  const handleManualAssign = () => {
    if (!onMoveBooking || !selectedDate) return;
    if (!window.confirm('Clear all table assignments for this date? You can then drag bookings onto tables manually.')) return;
    bookings
      .filter(b => b.date === selectedDate && b.studio === 'Putney' && b.status !== 'cancelled' && b.status !== 'no_show' && (b.tableId ?? '').trim())
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
        <div className="flex gap-2 flex-wrap">
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
          {onBlockStudio && (
            <button
              onClick={() => setShowBlockStudio(v => !v)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-red-300 text-red-700 hover:bg-red-50 cursor-pointer"
            >
              Block studio
            </button>
          )}
        </div>
      )}

      {showBlockStudio && onBlockStudio && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <p className="text-[10px] font-bold text-red-800 uppercase tracking-wider">
            Block whole studio on {selectedDate} — online bookings refused for this window
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-[10px] font-bold text-[#1B2D3C]/70">
              From
              <input type="time" value={blockStart} onChange={e => setBlockStart(e.target.value)}
                className="block mt-0.5 px-2 py-1 border border-[#1B2D3C]/20 rounded text-xs bg-white" />
            </label>
            <label className="text-[10px] font-bold text-[#1B2D3C]/70">
              To
              <input type="time" value={blockEnd} onChange={e => setBlockEnd(e.target.value)}
                className="block mt-0.5 px-2 py-1 border border-[#1B2D3C]/20 rounded text-xs bg-white" />
            </label>
            <label className="text-[10px] font-bold text-[#1B2D3C]/70 flex-1 min-w-32">
              Label
              <input type="text" value={blockLabel} onChange={e => setBlockLabel(e.target.value)}
                className="block mt-0.5 w-full px-2 py-1 border border-[#1B2D3C]/20 rounded text-xs bg-white" />
            </label>
            <button
              onClick={() => {
                if (blockEnd <= blockStart) { window.alert('End time must be after start time'); return; }
                onBlockStudio(blockStart, blockEnd, blockLabel.trim() || 'Studio Block');
                setShowBlockStudio(false);
              }}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-600 text-white hover:bg-red-700 cursor-pointer"
            >
              Block
            </button>
            <button
              onClick={() => setShowBlockStudio(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#1B2D3C]/60 hover:text-[#1B2D3C] cursor-pointer"
            >
              Cancel
            </button>
          </div>
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
                  className={`w-full flex items-center justify-between gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold ${b.isBlock ? 'text-red-700 bg-red-50' : 'text-[#1B2D3C]'} ${pendingAssignId === b.id ? 'bg-emerald-100' : 'hover:bg-[#1B2D3C]/5'} ${onMoveBooking ? 'cursor-grab' : 'cursor-pointer'}`}
                  draggable={!!onMoveBooking}
                  onDragStart={onMoveBooking ? (e) => e.dataTransfer.setData('text/plain', b.id) : undefined}
                  onClick={() => {
                    if (onMoveBooking) { togglePending(b.id, b.tableId); return; }
                    const t = (b.tableId ?? '').split(',')[0]?.trim(); if (t) setLocalSelected(t);
                  }}
                  title={onMoveBooking ? "Click to assign tables · drag onto a table to seat them there" : "Click to locate its table"}
                >
                  <span className="truncate">{shortTime(b.time)} {b.name} {b.painters}p{b.tableId ? ` – ${b.tableId}` : ''}</span>
                  {onSeatBooking && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSeatBooking(b.id); }}
                      className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-black uppercase tracking-wider cursor-pointer"
                      title="Mark as seated at the assigned table"
                    >
                      Seat
                    </button>
                  )}
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
          {/* Seated parties — collapsed so they don't clutter the waiting list */}
          {seatedLegend.length > 0 && (
            <div className="pt-1 border-t border-[#1B2D3C]/10">
              <button
                onClick={() => setShowSeated(s => !s)}
                className="w-full text-left text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C]/45 px-0.5 cursor-pointer"
              >
                Seated · {seatedLegend.length} {showSeated ? '▾' : '▸'}
              </button>
              {showSeated && seatedLegend.map((b, i) => (
                <div
                  key={`s${i}`}
                  className={`w-full px-2 py-1 rounded-md text-[11px] font-semibold text-[#1B2D3C]/45 ${pendingAssignId === b.id ? 'bg-emerald-100' : ''} ${onMoveBooking ? 'cursor-grab' : 'cursor-pointer'}`}
                  draggable={!!onMoveBooking}
                  onDragStart={onMoveBooking ? (e) => e.dataTransfer.setData('text/plain', b.id) : undefined}
                  onClick={() => { const t = (b.tableId ?? '').split(',')[0]?.trim(); if (t) setLocalSelected(t); }}
                  title={onMoveBooking ? "Drag onto a table to move them" : "Click to locate its table"}
                >
                  {shortTime(b.time)} {b.name} {b.painters}p{b.tableId ? ` – ${b.tableId}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto flex-1 min-w-0">
          <svg viewBox="0 0 470 700" className="w-full max-w-[470px] h-auto mx-auto" style={{ minHeight: '400px' }}>
          {/* Main area border */}
          <rect x={10} y={10} width={440} height={490} rx={8} fill="#F8FAFB" stroke="#1B2D3C" strokeWidth={1} strokeDasharray="4 3" />
          <text x={225} y={30} textAnchor="middle" fontSize={10} fontWeight="700" fill="#1B2D3C99" letterSpacing="2">MAIN AREA</text>

          {/* Bar fixture — right column, below T6 */}
          <rect x={270} y={270} width={88} height={190} rx={4} fill="#DBE7E4" stroke="#1B2D3C" strokeWidth={1.2} />
          <text x={314} y={370} textAnchor="middle" fontSize={13} fontWeight="800" fill="#1B2D3C" letterSpacing="3">BAR</text>

          {MAIN_TABLES.map(renderTable)}

          {/* Divider line */}
          <line x1={10} y1={510} x2={450} y2={510} stroke="#1B2D3C" strokeWidth={1.5} />

          {/* Party area */}
          <rect x={10} y={520} width={440} height={165} rx={8} fill="#f0fdf4" stroke="#16a34a" strokeWidth={1} strokeDasharray="4 3" />
          <text x={225} y={540} textAnchor="middle" fontSize={10} fontWeight="700" fill="#16a34a99" letterSpacing="2">PARTY AREA</text>

          {PARTY_TABLES.map(renderTable)}
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
                  <button onClick={handleUnblock}
                    className="px-3 py-1.5 bg-white border border-red-300 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-red-50 cursor-pointer">
                    Unblock ({selectedBlock.reason})
                  </button>
                ) : (
                  <>
                    {showBlockInput ? (
                      <div className="flex gap-2">
                        <input type="text" value={blockReason} onChange={e => setBlockReason(e.target.value)}
                          placeholder="Reason" className="px-2 py-1 text-[10px] border border-[#1B2D3C]/20 rounded w-28" />
                        <button onClick={handleBlock} className="px-2 py-1 bg-gray-600 text-white text-[10px] font-bold rounded cursor-pointer">Block</button>
                        <button onClick={() => setShowBlockInput(false)} className="px-2 py-1 text-[10px] font-bold text-[#1B2D3C] cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setShowBlockInput(true)}
                        className="px-3 py-1.5 bg-gray-200 text-gray-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-gray-300 cursor-pointer">
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
