import { useMemo, useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Search, Bell, Camera, Users, Clock, MapPin, Check, Package, Phone, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertCircle, CheckSquare, Square, Plus, QrCode, Tag } from 'lucide-react';
import { BookingInquiry } from '../../types';
import Skeleton from '../Skeleton';
import ImageModal from '../ImageModal';
import { compressImage } from '../../lib/imageCompression';
import QRScanner from '../QRScanner';
import TagPopover, { TAG_COLORS, TAG_LABELS, TAG_STATUSES, getTagColor } from './TagPopover';

export type CollectionStage = 'painted' | 'ready' | 'collected';
export type CollectionStageOrNull = CollectionStage | null;

interface CollectionsTabProps {
  bookings: BookingInquiry[];
  studioFilter: 'all' | 'Putney' | 'Wimbledon';
  onStudioFilterChange: (studio: 'all' | 'Putney' | 'Wimbledon') => void;
  loading: boolean;
  canUpdate: boolean;
  fixedStage: CollectionStage;
  onSetStage: (booking: BookingInquiry, stage: CollectionStage) => void;
  onOpenBooking: (booking: BookingInquiry) => void;
  onUploadPhotos: (booking: BookingInquiry, files: File[]) => void;
  uploadingId: string | null;
  onSetPhotoTag?: (booking: BookingInquiry, photoIndex: number, tag: string) => void;
  onAddPhotoTag?: (booking: BookingInquiry, photoIndex: number, label: string, status: string, x: number, y: number) => void;
  onRemovePhotoTag?: (booking: BookingInquiry, photoIndex: number, tagIndex: number) => void;
  onBulkAddPhotoTag?: (bookings: BookingInquiry[], label: string, status: string) => void;
  onCreateProfile?: (data: { name: string; phone: string; date: string; studio: string; photos: string[] }) => Promise<BookingInquiry>;
}

const STAGE_INFO: Record<CollectionStage, { label: string; empty: string; accent: string; badge: string }> = {
  painted: { label: 'Painted', empty: 'Nothing painted yet', accent: 'text-amber-800', badge: 'bg-amber-100 text-amber-800' },
  ready: { label: 'Ready to Collect', empty: 'Nothing ready to collect', accent: 'text-blue-800', badge: 'bg-blue-100 text-blue-800' },
  collected: { label: 'Collected', empty: 'Nothing collected yet', accent: 'text-emerald-800', badge: 'bg-emerald-100 text-emerald-800' },
};

export function resolveStage(booking: BookingInquiry): CollectionStageOrNull {
  if (booking.collectionStatus) return booking.collectionStatus;
  if (booking.status === 'completed') return 'painted';
  return null;
}

function BookingCard({
  booking,
  stage,
  canUpdate,
  onSetStage,
  onOpenBooking,
  onUploadPhotos,
  uploading,
  selected,
  onSelect,
  onSetPhotoTag,
  onAddPhotoTag,
  onRemovePhotoTag,
  onOpenImage,
}: {
  booking: BookingInquiry;
  stage: CollectionStage;
  canUpdate: boolean;
  onSetStage: (booking: BookingInquiry, stage: CollectionStage) => void;
  onOpenBooking: (booking: BookingInquiry) => void;
  onUploadPhotos: (booking: BookingInquiry, files: File[]) => void;
  uploading: boolean;
  selected: boolean;
  onSelect: (booking: BookingInquiry) => void;
  onSetPhotoTag?: (booking: BookingInquiry, photoIndex: number, tag: string) => void;
  onAddPhotoTag?: (booking: BookingInquiry, photoIndex: number, label: string, status: string, x: number, y: number) => void;
  onRemovePhotoTag?: (booking: BookingInquiry, photoIndex: number, tagIndex: number) => void;
  onOpenImage?: (images: string[], index: number) => void;
}) {
  const photos = booking.photos ?? [];
  const photoTags = booking.photoTags ?? {};
  const [tagMode, setTagMode] = useState(false);
  const [activeTagPopover, setActiveTagPopover] = useState<{ photoIndex: number; x: number; y: number } | null>(null);
  const tagColors = TAG_COLORS;
  const tagLabels = TAG_LABELS;
  const allUsedTags = useMemo(() => {
    const tags = new Set<string>();
    for (const key of Object.keys(photoTags)) {
      for (const t of photoTags[parseInt(key)] || []) {
        const display = t.label || t.status;
        if (display) tags.add(display);
      }
    }
    return Array.from(tags);
  }, [photoTags]);
  const tagSummary = photos.length > 0 ? (() => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < photos.length; i++) {
      const tags = photoTags[i];
      if (tags && tags.length > 0) {
        for (const t of tags) counts[t.status] = (counts[t.status] || 0) + 1;
      } else {
        counts['painted'] = (counts['painted'] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  })() : [];
  const isOverdue = stage !== 'collected' && (() => {
    const ref = booking.collectedAt || booking.date;
    try {
      const d = parseISO(ref);
      return Date.now() - d.getTime() > 30 * 24 * 60 * 60 * 1000;
    } catch { return false; }
  })();

  return (
    <div
      onClick={() => onOpenBooking(booking)}
      className={`bg-white border rounded-xl p-3 space-y-2.5 cursor-pointer transition-all hover:shadow-md ${
        isOverdue ? 'border-amber-300' : selected ? 'border-[#1B2D3C] ring-1 ring-[#1B2D3C]/20' : 'border-[#1B2D3C]/15'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {canUpdate && (
              <button
                onClick={(e) => { e.stopPropagation(); onSelect(booking); }}
                className="shrink-0 cursor-pointer"
              >
                {selected
                  ? <CheckSquare className="w-3.5 h-3.5 text-[#1B2D3C]" />
                  : <Square className="w-3.5 h-3.5 text-[#1B2D3C]/30 hover:text-[#1B2D3C]/60" />}
              </button>
            )}
            <p className="text-sm font-black text-[#1B2D3C] truncate">{booking.name}</p>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] font-semibold text-[#1B2D3C]/60 flex-wrap">
            <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{booking.time}</span>
            <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{booking.paintersCount}</span>
            <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{booking.studio}</span>
            {booking.phone && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{booking.phone}</span>}
            {stage === 'ready' && booking.readyAt && (
              <span className="flex items-center gap-0.5 text-blue-600"><Bell className="w-3 h-3" />Notified {format(parseISO(booking.readyAt), 'd MMM, HH:mm')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {photos.length > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#DBE7E4] text-[#1B2D3C] text-[9px] font-black rounded-full">
              <Camera className="w-2.5 h-2.5" />{photos.length}
            </span>
          )}
          {isOverdue && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black rounded-full" title="Over 30 days">
              <AlertCircle className="w-2.5 h-2.5" />30d+
            </span>
          )}
        </div>
      </div>

      {photos.length > 0 && (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {canUpdate && onAddPhotoTag && (
            <button
              onClick={(e) => { e.stopPropagation(); setTagMode(!tagMode); }}
              className={`text-[8px] font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-colors cursor-pointer ${tagMode ? 'bg-[#1B2D3C] text-white' : 'bg-[#D6E2E9] text-[#1B2D3C]'}`}
            >
              {tagMode ? '✓ Tag Mode ON — tap photo to tag' : 'Tag Mode'}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            {photos.map((url, i) => {
              const tags = photoTags[i] || [];
              return (
                <div
                  key={i}
                  className="relative aspect-square rounded-lg overflow-hidden border border-[#1B2D3C]/15 group cursor-pointer"
                  onClick={(e) => {
                    if (canUpdate && onAddPhotoTag && tagMode) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = ((e.clientX - rect.left) / rect.width) * 100;
                      const y = ((e.clientY - rect.top) / rect.height) * 100;
                      e.stopPropagation();
                      setActiveTagPopover({ photoIndex: i, x, y });
                    } else {
                      onOpenImage?.(photos, i);
                    }
                  }}
                >
                  <div className="block w-full h-full hover:opacity-80 transition-opacity">
                    <img src={url} alt={`${booking.name} painting ${i + 1}`} className="w-full h-full object-cover" />
                  </div>
                  {tags.map((t, ti) => (
                    <div
                      key={ti}
                      className="absolute z-10 flex items-center gap-0.5"
                      style={{ left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-50%, -50%)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className={`px-1 py-0.5 text-[7px] font-black uppercase tracking-wider rounded-full flex items-center gap-0.5 whitespace-nowrap shadow-md ${getTagColor(t.status)}`}
                      >
                        {t.label ? `${tagLabels[t.status] || t.status} - ${t.label}` : (tagLabels[t.status] || t.status)}
                        {canUpdate && onRemovePhotoTag && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemovePhotoTag(booking, i, ti); }}
                            className="hover:text-red-600 cursor-pointer"
                          >
                            <X className="w-2 h-2" />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                  {canUpdate && onAddPhotoTag && tagMode && (
                    <div className="absolute inset-0 ring-2 ring-[#1B2D3C] ring-inset rounded-lg pointer-events-none" />
                  )}
                  {activeTagPopover && activeTagPopover.photoIndex === i && onAddPhotoTag && (
                    <TagPopover
                      x={activeTagPopover.x}
                      y={activeTagPopover.y}
                      existingTags={allUsedTags}
                      onAdd={(label, status) => {
                        onAddPhotoTag(booking, i, label, status, activeTagPopover.x, activeTagPopover.y);
                      }}
                      onClose={() => setActiveTagPopover(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {tagSummary.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tagSummary.map(([tag, count]) => (
                <span key={tag} className={`px-1.5 py-0.5 text-[8px] font-black rounded-full ${tagColors[tag] || 'bg-stone-100 text-stone-600'}`}>
                  {count} {tagLabels[tag] || tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {canUpdate && (
        <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
          <label className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors ${
            uploading
              ? 'bg-[#D6E2E9]/40 text-[#1B2D3C]/50 cursor-wait'
              : 'bg-[#DBE7E4] text-[#1B2D3C] hover:bg-[#D6E2E9] cursor-pointer'
          }`}>
            <Camera className="w-3 h-3" />
            {uploading ? 'Uploading...' : photos.length > 0 ? 'Add' : 'Photos'}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              onChange={(e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                const arr = Array.from(files);
                e.target.value = '';
                onUploadPhotos(booking, arr);
              }}
              className="hidden"
            />
          </label>

          {stage !== 'painted' && (
            <button
              onClick={() => onSetStage(booking, stage === 'collected' ? 'ready' : 'painted')}
              className="inline-flex items-center gap-0.5 px-2 py-1 bg-white border border-[#1B2D3C]/15 text-[#1B2D3C] text-[9px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3 h-3" /> Back
            </button>
          )}

          {stage === 'painted' && (
            <button
              onClick={() => {
                if (window.confirm(`Mark ${booking.name} as collected without sending a ready notification?`)) {
                  onSetStage(booking, 'collected');
                }
              }}
              className="inline-flex items-center gap-0.5 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
              title="Customer already collected — skips the ready email/SMS"
            >
              <Check className="w-3 h-3" /> Collected
            </button>
          )}

          {stage === 'painted' && (
            <button
              onClick={() => onSetStage(booking, 'ready')}
              className="inline-flex items-center gap-0.5 px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-[9px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer ml-auto"
            >
              <Package className="w-3 h-3" /> Ready <ChevronRight className="w-3 h-3" />
            </button>
          )}
          {stage === 'ready' && (
            <button
              onClick={() => onSetStage(booking, 'collected')}
              className="inline-flex items-center gap-0.5 px-2 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer ml-auto"
            >
              <Check className="w-3 h-3" /> Collected <ChevronRight className="w-3 h-3" />
            </button>
          )}
          {stage === 'collected' && booking.collectedAt && (
            <span className="text-[9px] font-semibold text-[#1B2D3C]/40 ml-auto">
              {format(parseISO(booking.collectedAt), 'd MMM, HH:mm')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function CollectionsTab({
  bookings,
  studioFilter,
  onStudioFilterChange,
  loading,
  canUpdate,
  fixedStage,
  onSetStage,
  onOpenBooking,
  onUploadPhotos,
  uploadingId,
  onSetPhotoTag,
  onAddPhotoTag,
  onRemovePhotoTag,
  onBulkAddPhotoTag,
  onCreateProfile,
}: CollectionsTabProps) {
  const [nameQuery, setNameQuery] = useState('');
  const [phoneQuery, setPhoneQuery] = useState('');
  const [dateQuery, setDateQuery] = useState('');
  const [modalImages, setModalImages] = useState<string[] | null>(null);
  const [modalIndex, setModalIndex] = useState(0);
  const [modalPhotoTags, setModalPhotoTags] = useState<Record<number, { label?: string; status: string; x: number; y: number }[]> | undefined>(undefined);
  const [needsPhotoOnly, setNeedsPhotoOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [showNoPhotoGroup, setShowNoPhotoGroup] = useState(false);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileDate, setProfileDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [profileStudio, setProfileStudio] = useState<'Putney' | 'Wimbledon'>('Putney');
  const [profilePhotos, setProfilePhotos] = useState<string[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [scannedBooking, setScannedBooking] = useState<BookingInquiry | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [bulkTagStatus, setBulkTagStatus] = useState('painted');
  const [bulkTagLabel, setBulkTagLabel] = useState('');

  // New collection profiles default to the globally selected studio
  useEffect(() => {
    if (showAddProfile && studioFilter !== 'all') setProfileStudio(studioFilter);
  }, [showAddProfile]);

  const eligible = useMemo(
    () => bookings.filter(b => b.status === 'completed'),
    [bookings],
  );

  const hasFilters = Boolean(nameQuery || phoneQuery || dateQuery || studioFilter !== 'all' || needsPhotoOnly);

  const filtered = useMemo(() => {
    const name = nameQuery.trim().toLowerCase();
    const phone = phoneQuery.replace(/\D/g, '');
    return eligible.filter(b => {
      if (resolveStage(b) !== fixedStage) return false;
      if (name && !b.name.toLowerCase().includes(name)) return false;
      if (phone && !(b.phone ?? '').replace(/\D/g, '').includes(phone)) return false;
      if (dateQuery && b.date !== dateQuery) return false;
      if (studioFilter !== 'all' && b.studio !== studioFilter) return false;
      if (needsPhotoOnly && b.photos && b.photos.length > 0) return false;
      return true;
    });
  }, [eligible, fixedStage, nameQuery, phoneQuery, dateQuery, studioFilter, needsPhotoOnly]);

  // Painted: photo-less bookings are the stale backlog — they live in a
  // collapsed bucket at the bottom so the active ~2-week queue stays short.
  const mainList = useMemo(
    () => fixedStage === 'painted' ? filtered.filter(b => b.photos && b.photos.length > 0) : filtered,
    [filtered, fixedStage],
  );
  const paintedNoPhoto = useMemo(
    () => fixedStage === 'painted' ? filtered.filter(b => !(b.photos && b.photos.length > 0)) : [],
    [filtered, fixedStage],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, BookingInquiry[]>();
    for (const b of mainList) {
      const list = map.get(b.date) ?? [];
      list.push(b);
      map.set(b.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    const entries = [...map.entries()];
    entries.sort((a, b) => sortOrder === 'newest' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
    return entries;
  }, [mainList, sortOrder]);

  const noPhotoGrouped = useMemo(() => {
    const map = new Map<string, BookingInquiry[]>();
    for (const b of paintedNoPhoto) {
      const list = map.get(b.date) ?? [];
      list.push(b);
      map.set(b.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    const entries = [...map.entries()];
    entries.sort((a, b) => b[0].localeCompare(a[0]));
    return entries;
  }, [paintedNoPhoto]);

  // Month collapses wrap the existing date groups — long lists stay short.
  const groupByMonth = (entries: [string, BookingInquiry[]][]) => {
    const byMonth = new Map<string, [string, BookingInquiry[]][]>();
    for (const [date, items] of entries) {
      const month = date.slice(0, 7);
      const list = byMonth.get(month) ?? [];
      list.push([date, items]);
      byMonth.set(month, list);
    }
    return [...byMonth.entries()];
  };
  const groupedByMonth = useMemo(() => groupByMonth(grouped), [grouped]);
  const noPhotoByMonth = useMemo(() => groupByMonth(noPhotoGrouped), [noPhotoGrouped]);

  const clearFilters = () => {
    setNameQuery('');
    setPhoneQuery('');
    setDateQuery('');
    onStudioFilterChange('all');
    setNeedsPhotoOnly(false);
  };

  const handleQRScan = (code: string) => {
    let token: string | null = null;
    try {
      const url = new URL(code);
      token = url.searchParams.get('token');
    } catch {
      if (code.startsWith('token=')) {
        token = code.substring(6);
      } else {
        token = code;
      }
    }

    if (!token) {
      setScanResult({ type: 'error', message: 'Invalid QR code — no token found' });
      return;
    }

    const booking = bookings.find(b => b.managementToken === token);
    if (!booking) {
      setScanResult({ type: 'error', message: 'No booking found for this QR code' });
      return;
    }

    if (booking.status !== 'completed') {
      setScanResult({ type: 'error', message: `${booking.name} is not completed (status: ${booking.status})` });
      return;
    }

    const stage = resolveStage(booking);
    if (stage === 'collected') {
      setScanResult({ type: 'warning', message: `${booking.name} is already collected` });
      return;
    }
    setScannedBooking(booking);
    setScanResult({ type: 'success', message: `${booking.name} found — verify photos and mark collected` });
  };

  const handleMarkCollected = async () => {
    if (!scannedBooking) return;
    setCollecting(true);
    await onSetStage(scannedBooking, 'collected');
    setCollecting(false);
    setScannedBooking(null);
  };

  const isSearching = Boolean(nameQuery.trim() || phoneQuery.trim());

  const info = STAGE_INFO[fixedStage];

  const renderCard = (b: BookingInquiry) => (
    <BookingCard
      key={b.id}
      booking={b}
      stage={fixedStage}
      canUpdate={canUpdate}
      onSetStage={onSetStage}
      onOpenBooking={onOpenBooking}
      onUploadPhotos={onUploadPhotos}
      uploading={uploadingId === b.id}
      selected={selectedIds.has(b.id)}
      onSelect={(booking) => {
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(booking.id)) next.delete(booking.id);
          else next.add(booking.id);
          return next;
        });
      }}
      onSetPhotoTag={onSetPhotoTag}
      onAddPhotoTag={onAddPhotoTag}
      onRemovePhotoTag={onRemovePhotoTag}
      onOpenImage={(images, index) => { setModalImages(images); setModalIndex(index); setModalPhotoTags(b.photoTags); }}
    />
  );

  const renderDateGroup = (date: string, items: BookingInquiry[]) => {
    const isExpanded = expandedDates.has(date);
    const photoCount = items.reduce((sum, b) => sum + (b.photos?.length ?? 0), 0);
    return (
      <div key={date} className="border border-[#1B2D3C]/10 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpandedDates(prev => {
            const next = new Set(prev);
            if (next.has(date)) next.delete(date);
            else next.add(date);
            return next;
          })}
          className="w-full flex items-center gap-2 px-4 py-3 bg-[#F8FAFA] hover:bg-[#DBE7E4]/40 transition-colors cursor-pointer"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4 text-[#1B2D3C]/60" /> : <ChevronDown className="w-4 h-4 text-[#1B2D3C]/60" />}
          <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">
            {format(parseISO(date), 'EEE d MMM yyyy')}
          </h3>
          <span className="px-2 py-0.5 bg-[#1B2D3C]/10 text-[#1B2D3C]/60 text-[10px] font-black rounded-full">
            {items.length} booking{items.length !== 1 ? 's' : ''}
          </span>
          {photoCount > 0 && (
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-black rounded-full">
              {photoCount} photo{photoCount !== 1 ? 's' : ''}
            </span>
          )}
        </button>
        {isExpanded && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
            {items.map(b => renderCard(b))}
          </div>
        )}
      </div>
    );
  };

  const renderMonth = (month: string, dateGroups: [string, BookingInquiry[]][]) => {
    const isExpanded = expandedMonths.has(month);
    const bookingCount = dateGroups.reduce((sum, [, items]) => sum + items.length, 0);
    return (
      <div key={month} className="border border-[#1B2D3C]/10 rounded-xl overflow-hidden">
        <button
          onClick={() => setExpandedMonths(prev => {
            const next = new Set(prev);
            if (next.has(month)) next.delete(month);
            else next.add(month);
            return next;
          })}
          className="w-full flex items-center gap-2 px-4 py-3 bg-[#DBE7E4]/50 hover:bg-[#DBE7E4] transition-colors cursor-pointer"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4 text-[#1B2D3C]/60" /> : <ChevronDown className="w-4 h-4 text-[#1B2D3C]/60" />}
          <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">
            {format(parseISO(`${month}-01`), 'MMMM yyyy')}
          </h3>
          <span className="px-2 py-0.5 bg-[#1B2D3C]/10 text-[#1B2D3C]/60 text-[10px] font-black rounded-full">
            {bookingCount} booking{bookingCount !== 1 ? 's' : ''}
          </span>
        </button>
        {isExpanded && (
          <div className="space-y-3 p-3">
            {dateGroups.map(([date, items]) => renderDateGroup(date, items))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <div className="bg-[#F8FAFA] border border-[#1B2D3C]/10 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#1B2D3C]/40" />
            <input
              type="text"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="Name"
              className="w-full pl-8 pr-3 py-2 text-xs font-semibold text-[#1B2D3C] bg-white border border-[#1B2D3C]/15 rounded-lg focus:outline-none focus:border-[#1B2D3C]/40"
            />
          </div>
          <div className="relative">
            <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#1B2D3C]/40" />
            <input
              type="tel"
              value={phoneQuery}
              onChange={(e) => setPhoneQuery(e.target.value)}
              placeholder="Phone"
              className="w-full pl-8 pr-3 py-2 text-xs font-semibold text-[#1B2D3C] bg-white border border-[#1B2D3C]/15 rounded-lg focus:outline-none focus:border-[#1B2D3C]/40"
            />
          </div>
          <input
            type="date"
            value={dateQuery}
            onChange={(e) => setDateQuery(e.target.value)}
            className="w-full px-3 py-2 text-xs font-semibold text-[#1B2D3C] bg-white border border-[#1B2D3C]/15 rounded-lg focus:outline-none focus:border-[#1B2D3C]/40"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Studio filter */}
          <div className="flex rounded-lg border border-[#1B2D3C]/15 overflow-hidden">
            {(['all', 'Putney', 'Wimbledon'] as const).map(s => (
              <button
                key={s}
                onClick={() => onStudioFilterChange(s)}
                className={`px-2.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
                  studioFilter === s ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/50 hover:text-[#1B2D3C]'
                }`}
              >
                {s === 'all' ? 'All Studios' : s}
              </button>
            ))}
          </div>

          {/* Needs photo toggle (painted only) */}
          {fixedStage === 'painted' && (
            <button
              onClick={() => setNeedsPhotoOnly(v => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${
                needsPhotoOnly
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : 'bg-white text-[#1B2D3C]/50 border-[#1B2D3C]/15 hover:text-[#1B2D3C]'
              }`}
            >
              <AlertCircle className="w-3 h-3" /> Needs photo
            </button>
          )}

          {/* Add Profile button (painted/ready only) */}
          {canUpdate && onCreateProfile && (fixedStage === 'painted' || fixedStage === 'ready') && (
            <button
              onClick={() => setShowAddProfile(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-[#1B2D3C] text-white hover:bg-[#1B2D3C]/90 transition-all cursor-pointer"
            >
              <Plus className="w-3 h-3" /> Add Profile
            </button>
          )}

          {/* QR Scanner button */}
          {canUpdate && (
            <button
              onClick={() => { setShowScanner(true); setScanResult(null); }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg bg-[#DBE7E4] text-[#1B2D3C] hover:bg-[#D6E2E9] transition-all cursor-pointer"
            >
              <QrCode className="w-3 h-3" /> Scan QR
            </button>
          )}

          {/* Sort toggle */}
          <div className="flex rounded-lg border border-[#1B2D3C]/15 overflow-hidden ml-auto">
            <button
              onClick={() => setSortOrder('newest')}
              className={`px-2.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
                sortOrder === 'newest' ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/50 hover:text-[#1B2D3C]'
              }`}
            >
              Newest
            </button>
            <button
              onClick={() => setSortOrder('oldest')}
              className={`px-2.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer ${
                sortOrder === 'oldest' ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/50 hover:text-[#1B2D3C]'
              }`}
            >
              Oldest
            </button>
          </div>
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 hover:text-[#1B2D3C] cursor-pointer"
          >
            <X className="w-3 h-3" /> Clear filters
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className={`px-2.5 py-1 ${info.badge} text-[10px] font-black rounded-full uppercase tracking-wider`}>{info.label}</span>
        <span className="text-xs font-bold text-[#1B2D3C]/50">{filtered.length} booking{filtered.length !== 1 ? 's' : ''}</span>
        {canUpdate && filtered.length > 0 && (
          <button
            onClick={() => {
              if (selectedIds.size === filtered.length) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(filtered.map(b => b.id)));
              }
            }}
            className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 hover:text-[#1B2D3C] cursor-pointer ml-auto"
          >
            {selectedIds.size === filtered.length ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {canUpdate && selectedIds.size > 0 && (
        <div className="sticky top-[104px] z-20 bg-[#1B2D3C] text-white rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-black">{selectedIds.size} selected</span>
          <div className="flex items-center gap-1.5 ml-auto">
            {fixedStage === 'painted' && (
              <button
                onClick={() => {
                  for (const b of filtered) if (selectedIds.has(b.id)) onSetStage(b, 'ready');
                  setSelectedIds(new Set());
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
              >
                <Package className="w-3 h-3" /> Mark Ready
              </button>
            )}
            {fixedStage === 'ready' && (
              <>
                <button
                  onClick={() => {
                    for (const b of filtered) if (selectedIds.has(b.id)) onSetStage(b, 'painted');
                    setSelectedIds(new Set());
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
                >
                  <ChevronLeft className="w-3 h-3" /> Back to Painted
                </button>
                <button
                  onClick={() => {
                    for (const b of filtered) if (selectedIds.has(b.id)) onSetStage(b, 'collected');
                    setSelectedIds(new Set());
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
                >
                  <Check className="w-3 h-3" /> Mark Collected
                </button>
              </>
            )}
            {fixedStage === 'collected' && (
              <button
                onClick={() => {
                  for (const b of filtered) if (selectedIds.has(b.id)) onSetStage(b, 'ready');
                  setSelectedIds(new Set());
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-3 h-3" /> Back to Ready
              </button>
            )}
            {onBulkAddPhotoTag && (
              <button
                onClick={() => setShowBulkTag(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
              >
                <Tag className="w-3 h-3" /> Bulk Tag
              </button>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-colors"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>
      )}

      {/* Bulk tag popover */}
      {canUpdate && showBulkTag && onBulkAddPhotoTag && selectedIds.size > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-5 border border-[#1B2D3C]/20 max-w-sm w-full space-y-4 shadow-lg rounded-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-base font-black text-[#1B2D3C]">Bulk Tag Photos</h3>
              <button onClick={() => setShowBulkTag(false)} className="p-1.5 rounded-full hover:bg-[#D6E2E9] cursor-pointer">
                <X className="w-4 h-4 text-[#1B2D3C]/60" />
              </button>
            </div>
            <p className="text-xs text-[#1B2D3C]/60">Apply a tag to all photos in {selectedIds.size} selected booking{selectedIds.size !== 1 ? 's' : ''}.</p>
            <div>
              <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Tag Status</label>
              <select
                value={bulkTagStatus}
                onChange={(e) => setBulkTagStatus(e.target.value)}
                className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
              >
                {TAG_STATUSES.map(s => (
                  <option key={s} value={s}>{TAG_LABELS[s] || s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Label (optional)</label>
              <input
                type="text"
                value={bulkTagLabel}
                onChange={(e) => setBulkTagLabel(e.target.value)}
                placeholder="e.g. Plate, Mug, Bowl"
                className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowBulkTag(false); setBulkTagLabel(''); }}
                className="flex-1 px-4 py-2 bg-white text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const selectedBookings = filtered.filter(b => selectedIds.has(b.id));
                  onBulkAddPhotoTag(selectedBookings, bulkTagLabel, bulkTagStatus);
                  setShowBulkTag(false);
                  setBulkTagLabel('');
                  setSelectedIds(new Set());
                }}
                className="flex-1 px-4 py-2 bg-[#1B2D3C] text-white font-bold text-xs uppercase tracking-wider hover:bg-[#1B2D3C]/90 transition-all cursor-pointer rounded-lg"
              >
                Apply Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white border border-[#1B2D3C]/15 rounded-xl p-12 text-center">
          <p className="text-sm text-[#1B2D3C]/60 font-semibold">
            {hasFilters ? 'No bookings match your search' : info.empty}
          </p>
        </div>
      ) : isSearching ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(b => renderCard(b))}
        </div>
      ) : (
        <div className="space-y-3">
          {groupedByMonth.map(([month, dateGroups]) => renderMonth(month, dateGroups))}

          {/* Painted: photo-less backlog collapsed into its own bucket */}
          {fixedStage === 'painted' && noPhotoByMonth.length > 0 && (
            <div className="border border-[#1B2D3C]/10 rounded-xl overflow-hidden">
              <button
                onClick={() => setShowNoPhotoGroup(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 bg-stone-50 hover:bg-stone-100 transition-colors cursor-pointer"
              >
                {showNoPhotoGroup ? <ChevronUp className="w-4 h-4 text-[#1B2D3C]/60" /> : <ChevronDown className="w-4 h-4 text-[#1B2D3C]/60" />}
                <h3 className="text-sm font-black text-[#1B2D3C]/70 uppercase tracking-wider">
                  Without photos
                </h3>
                <span className="px-2 py-0.5 bg-[#1B2D3C]/10 text-[#1B2D3C]/60 text-[10px] font-black rounded-full">
                  {paintedNoPhoto.length} booking{paintedNoPhoto.length !== 1 ? 's' : ''}
                </span>
              </button>
              {showNoPhotoGroup && (
                <div className="space-y-3 p-3">
                  {noPhotoByMonth.map(([month, dateGroups]) => renderMonth(month, dateGroups))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {modalImages && (
        <ImageModal
          images={modalImages}
          initialIndex={modalIndex}
          onClose={() => { setModalImages(null); setModalPhotoTags(undefined); }}
          photoTags={modalPhotoTags}
        />
      )}

      {showAddProfile && onCreateProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Add to {info.label}</h3>
              <button onClick={() => { setShowAddProfile(false); setProfilePhotos([]); }} className="p-1.5 rounded-full hover:bg-[#D6E2E9] transition-colors cursor-pointer">
                <X className="w-5 h-5 text-[#1B2D3C]/60" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Name *</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Customer name"
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Phone</label>
                <input
                  type="tel"
                  value={profilePhone}
                  onChange={(e) => setProfilePhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Date of Painting *</label>
                  <input
                    type="date"
                    value={profileDate}
                    onChange={(e) => setProfileDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Studio</label>
                  <select
                    value={profileStudio}
                    onChange={(e) => setProfileStudio(e.target.value as 'Putney' | 'Wimbledon')}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  >
                    <option value="Putney">Putney</option>
                    <option value="Wimbledon">Wimbledon</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Photos</label>
                {profilePhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {profilePhotos.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-[#1B2D3C]/15">
                        <img src={url} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setProfilePhotos(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-[#DBE7E4] text-[#1B2D3C] hover:bg-[#D6E2E9] cursor-pointer transition-colors">
                  <Camera className="w-3 h-3" /> {profilePhotos.length > 0 ? 'Add More' : 'Upload Photos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files || files.length === 0) return;
                      const compressed = await Promise.all(Array.from(files).map(f => compressImage(f)));
                      setProfilePhotos(prev => [...prev, ...compressed]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddProfile(false); setProfilePhotos([]); setProfileName(''); setProfilePhone(''); }}
                className="flex-1 px-4 py-2 bg-white text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer rounded-lg"
              >
                Cancel
              </button>
              <button
                disabled={!profileName.trim() || profileSaving}
                onClick={async () => {
                  if (!profileName.trim()) return;
                  setProfileSaving(true);
                  try {
                    await onCreateProfile({
                      name: profileName.trim(),
                      phone: profilePhone.trim(),
                      date: profileDate,
                      studio: profileStudio,
                      photos: profilePhotos,
                    });
                    setShowAddProfile(false);
                    setProfileName('');
                    setProfilePhone('');
                    setProfilePhotos([]);
                  } finally {
                    setProfileSaving(false);
                  }
                }}
                className="flex-1 px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait rounded-lg"
              >
                {profileSaving ? 'Saving...' : 'Add Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan result toast */}
      {scanResult && !scannedBooking && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg text-xs font-bold uppercase tracking-wider cursor-pointer ${
            scanResult.type === 'success'
              ? 'bg-emerald-500 text-white'
              : scanResult.type === 'warning'
              ? 'bg-amber-500 text-white'
              : 'bg-red-500 text-white'
          }`}
          onClick={() => setScanResult(null)}
        >
          {scanResult.message}
        </div>
      )}

      {/* Scanned booking card with Mark as Collected */}
      {scannedBooking && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => { setScannedBooking(null); setScanResult(null); }}>
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[#1B2D3C]/10">
              <div>
                <p className="text-sm font-black text-[#1B2D3C]">{scannedBooking.name}</p>
                <p className="text-[10px] font-semibold text-[#1B2D3C]/60">
                  {scannedBooking.studio} • {scannedBooking.date} at {scannedBooking.time}
                </p>
              </div>
              <button
                onClick={() => { setScannedBooking(null); setScanResult(null); }}
                className="text-[#1B2D3C]/40 hover:text-[#1B2D3C] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {scannedBooking.photos && scannedBooking.photos.length > 0 ? (
              <div className="p-4">
                <div className="grid grid-cols-1 gap-3 max-h-[60vh] overflow-y-auto">
                  {scannedBooking.photos.map((url, i) => {
                    const tags = scannedBooking.photoTags?.[i] || [];
                    return (
                      <div
                        key={i}
                        className="relative rounded-lg overflow-hidden border border-[#1B2D3C]/15 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => { setModalImages(scannedBooking.photos!); setModalIndex(i); setModalPhotoTags(scannedBooking.photoTags); }}
                      >
                        <img src={url} alt={`Photo ${i + 1}`} className="w-full max-h-48 object-contain bg-[#F8FAFA]" />
                        {tags.map((t, ti) => (
                          <div
                            key={ti}
                            className="absolute flex items-center gap-0.5"
                            style={{ left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-50%, -50%)' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span
                              className={`px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-full whitespace-nowrap shadow-md ${getTagColor(t.status)}`}
                            >
                              {t.label ? `${TAG_LABELS[t.status] || t.status} - ${t.label}` : (TAG_LABELS[t.status] || t.status)}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center">
                <Camera className="w-8 h-8 text-[#1B2D3C]/20 mx-auto mb-2" />
                <p className="text-xs font-semibold text-[#1B2D3C]/50">No photos on file</p>
              </div>
            )}

            <div className="p-4 border-t border-[#1B2D3C]/10 flex items-center gap-2">
              <button
                onClick={() => { onOpenBooking(scannedBooking); setScannedBooking(null); setScanResult(null); }}
                className="flex-1 px-3 py-2.5 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-colors cursor-pointer"
              >
                View Details
              </button>
              <button
                onClick={handleMarkCollected}
                disabled={collecting}
                className="flex-1 px-3 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {collecting ? (
                  <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Marking...</>
                ) : (
                  <><Check className="w-3.5 h-3.5" /> Mark Collected</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner modal */}
      {showScanner && (
        <QRScanner
          onScan={(code) => {
            setShowScanner(false);
            handleQRScan(code);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
