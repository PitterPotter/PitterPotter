import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DashboardOverview from './DashboardOverview';
import ConfirmDialog from './ConfirmDialog';
import FloorPlanView from './FloorPlanView';
import WimbledonFloorPlan from './WimbledonFloorPlan';
import PutneyFloorPlan from './PutneyFloorPlan';
import { allocateResources as allocateResourcesFromBookings, formatResources, isPartySessionType } from '../lib/allocation';
import { findAvailablePutneyTable, findMultiplePutneyTables } from './PutneyFloorPlan';
import { Calendar, Clock, Users, Mail, Phone, LogOut, Trash2, CheckCircle, XCircle, Plus, Copy, Inbox, Gift, ChevronUp, ChevronDown, X as XIcon, Pencil, Lock, Camera, ScanLine, AlertCircle, Package, Check, Wine, Loader2, MapPin, Ban } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { format, isSameDay, parseISO, getDay } from 'date-fns';
import { BookingInquiry, GiftCard, Staff, AuditLog, GiftCardApiRow, StaffApiRow, EmailTemplate, SMSTemplate, EmailLog } from '../types';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { loadBookings, createBooking, updateBooking, patchBooking, updateBookingStatus, deleteBooking, getRemainingCapacity, sendDepositLink, getPaymentDetails, blockStudio } from '../lib/bookings';
import type { StripePaymentDetails } from '../lib/bookings';
import { compressImage } from '../lib/imageCompression';
import QRScanner from './QRScanner';
import { getAllSlots, getSlots, setSlots, DEFAULT_SLOTS, SlotSessionType, Studio, TimeSlotsData, getStudioSlots, sortSlots, loadSlotsFromSupabase, saveSlotsToSupabase, DayType } from '../lib/timeSlots';
import { loadClosuresFromSupabase, saveClosuresToSupabase, getClosureDates, ClosureDates, HolidayRange } from '../lib/closures';
import { useToast } from './ToastContext';
import Skeleton from './Skeleton';
import WysiwygEditor from './WysiwygEditor';
import AnalyticsTab from './admin/AnalyticsTab';
import AuditLogsTab from './admin/AuditLogsTab';
import EmailLogsTab from './admin/EmailLogsTab';
import EmailTemplatesTab from './admin/EmailTemplatesTab';
import WebmasterTab from './admin/WebmasterTab';
import CollectionsTab, { CollectionStage } from './admin/CollectionsTab';
import TagPopover, { TAG_COLORS, TAG_LABELS, getTagColor } from './admin/TagPopover';
import DashboardSummary from './admin/DashboardSummary';
import SMSAdminTab from './admin/SMSAdminTab';
import DocumentationTab from './admin/DocumentationTab';
import ImageModal from './ImageModal';
import NotificationBell from './admin/NotificationBell';
import { NotificationSettings } from './admin/NotificationSettings';
import { SESSION_LABELS as SESSION_LABELS_UTIL, SESSION_BADGE as SESSION_BADGE_UTIL, ROLE_LABEL, AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, AUDIT_ACTION_COLOR, formatAuditDetails as formatAuditDetailsUtil, getBookingAnalytics as getBookingAnalyticsUtil, getGiftCardAnalytics as getGiftCardAnalyticsUtil, exportBookingsCSV as exportBookingsCSVUtil, exportGiftCardsCSV as exportGiftCardsCSVUtil, exportCollectionStatsCSV as exportCollectionStatsCSVUtil, BACKUP_TABLE_OPTIONS } from './admin/adminUtils';
import 'react-day-picker/dist/style.css';

interface AdminDashboardProps {
  staff: Staff;
  onLogout: () => void;
}

const SESSION_LABELS = SESSION_LABELS_UTIL;
const SESSION_BADGE = SESSION_BADGE_UTIL;

const CAPACITY_LABEL: Record<string, string> = {
  open: 'Painting — Full Studio',
  open_restricted: 'Painting — Front Tables Only',
  party: 'Party (Back Tables)',
  sip_and_paint: 'Sip & Paint',
};
const CAPACITY_HINT: Record<string, string> = {
  open: 'Used when no party is booked in the slot (front + back tables).',
  open_restricted: 'Used when a party IS booked in the slot (front tables only; back reserved for the party).',
  party: 'Maximum guests for a party booking (back tables).',
  sip_and_paint: 'Maximum guests for Sip & Paint sessions (uses normal painting tables).',
};

interface SortHeaderProps {
  field: 'date' | 'name' | 'studio' | 'status' | 'added';
  label: string;
  sort: { field: 'date' | 'name' | 'studio' | 'status' | 'added'; direction: 'asc' | 'desc' };
  setSort: (sort: { field: 'date' | 'name' | 'studio' | 'status' | 'added'; direction: 'asc' | 'desc' }) => void;
}

function SortHeader({ field, label, sort, setSort }: SortHeaderProps) {
  const active = sort.field === field;
  const handleClick = () => {
    setSort({ field, direction: active && sort.direction === 'asc' ? 'desc' : 'asc' });
  };
  return (
    <th
      onClick={handleClick}
      className="text-left px-2 sm:px-4 py-2 sm:py-3 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] cursor-pointer select-none hover:bg-[#D6E2E9]"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (sort.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

export default function AdminDashboardView({ staff, onLogout }: AdminDashboardProps) {
  const { showToast } = useToast();
  const [inquiries, setInquiries] = useState<BookingInquiry[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'bookings' | 'painted' | 'ready' | 'collected' | 'gift-cards' | 'floor-plan' | 'settings' | 'analytics' | 'audit-logs' | 'webmaster' | 'email-logs' | 'email-templates' | 'sms' | 'documentation'>(staff.role === 'super_admin' ? 'dashboard' : 'bookings');
  const [floorPlanStudio, setFloorPlanStudio] = useState<'Putney' | 'Wimbledon'>(staff.allowedStudios?.[0] === 'Putney' ? 'Putney' : 'Wimbledon');
  const [floorPlanDate, setFloorPlanDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [collectionUploadingId, setCollectionUploadingId] = useState<string | null>(null);
  const [stripeMode, setStripeMode] = useState<'sandbox' | 'live'>('sandbox');
  const [maintenanceMode, setMaintenanceModeState] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [partyPrice, setPartyPrice] = useState<number>(28.95);
  const [partyGuestLimitPutney, setPartyGuestLimitPutney] = useState<number>(16);
  const [partyGuestLimitWimbledon, setPartyGuestLimitWimbledon] = useState<number>(16);
  const [depositNoticeType, setDepositNoticeTypeState] = useState<'info' | 'warning' | 'success' | 'error'>('info');
  const [tablePlanEnabled, setTablePlanEnabled] = useState<boolean>(false);
  const [partySetupBuffer, setPartySetupBuffer] = useState<number>(30);
  const [partyCleanupBuffer, setPartyCleanupBuffer] = useState<number>(20);
  const [bufferSaving, setBufferSaving] = useState(false);
  const [capacityRows, setCapacityRows] = useState<{ studio: string; session_type: string; max_painters: number }[]>([]);
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [timeSlotConfig, setTimeSlotConfig] = useState<TimeSlotsData>(() => getAllSlots());
  const [timeSlotStudio, setTimeSlotStudio] = useState<Studio>('Putney');
  const [timeSlotDayType, setTimeSlotDayType] = useState<DayType>('weekday');
  const [newSlotInput, setNewSlotInput] = useState<Record<SlotSessionType, string>>({ painting: '', 'sip-and-paint': '', 'baby-prints': '', party: '' });
  const [closures, setClosures] = useState<ClosureDates>(getClosureDates());
  const [newHolidayFrom, setNewHolidayFrom] = useState('');
  const [newHolidayTo, setNewHolidayTo] = useState('');
  const [newHolidayLabel, setNewHolidayLabel] = useState('');
  const [newClosedInput, setNewClosedInput] = useState('');
  const [newClosedStudio, setNewClosedStudio] = useState<'Putney' | 'Wimbledon' | 'Both'>('Both');
  const [showGiftCardModal, setShowGiftCardModal] = useState(false);
  const [newGiftCard, setNewGiftCard] = useState({
    amount: 50,
    recipientName: '',
    recipientEmail: '',
    senderName: '',
    message: '',
    covers: '',
  });
  const [giftCardKind, setGiftCardKind] = useState<'amount' | 'activity'>('amount');
  const [giftCardCreating, setGiftCardCreating] = useState(false);
  const [giftCardIsPhysical, setGiftCardIsPhysical] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemBalanceResult, setRedeemBalanceResult] = useState<{ code: string; amount: number; balance: number; status: string; recipient_name?: string; covers?: string } | null>(null);
  const [redeemChecking, setRedeemChecking] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{ discount: number; balance: number; status: string } | null>(null);
  const [redeemError, setRedeemError] = useState('');
  const [adminScanning, setAdminScanning] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [emailTemplatesLoading, setEmailTemplatesLoading] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState<SMSTemplate[]>([]);
  const [smsTemplatesLoading, setSmsTemplatesLoading] = useState(false);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [modalImages, setModalImages] = useState<string[] | null>(null);
  const [modalIndex, setModalIndex] = useState(0);
  const [modalPhotoTags, setModalPhotoTags] = useState<Record<number, { label?: string; status: string; x: number; y: number }[]> | undefined>(undefined);
  const [drawerTagMode, setDrawerTagMode] = useState(false);
  const [drawerTagPopover, setDrawerTagPopover] = useState<{ photoIndex: number; x: number; y: number } | null>(null);
  const [pageSettings, setPageSettings] = useState<{ page_key: string; enabled: boolean }[]>([]);
  const [pageSettingsLoading, setPageSettingsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled'>('all');
  const [studioFilter, setStudioFilter] = useState<'all' | 'Putney' | 'Wimbledon'>('all');
  const [bookingTypeTab, setBookingTypeTab] = useState<'all' | 'painting' | 'baby-prints' | 'party'>('all');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [giftCardSearchTerm, setGiftCardSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [editingBooking, setEditingBooking] = useState<BookingInquiry | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [sort, setSort] = useState<{ field: 'date' | 'name' | 'studio' | 'status' | 'added'; direction: 'asc' | 'desc' }>({ field: 'added', direction: 'desc' });

  const [showAddModal, setShowAddModal] = useState(false);
  const [lockedSessionType, setLockedSessionType] = useState<string | null>(null);
  const [newCollectionStage, setNewCollectionStage] = useState<'none' | 'painted' | 'ready' | 'collected'>('none');
  const defaultStudio: 'Putney' | 'Wimbledon' = studioFilter !== 'all'
    ? studioFilter
    : (staff.allowedStudios && staff.allowedStudios.length > 0 && staff.role !== 'super_admin')
      ? staff.allowedStudios[0]
      : 'Putney';
  const [newBooking, setNewBooking] = useState<Partial<BookingInquiry>>({
    studio: defaultStudio,
    name: '',
    email: '',
    phone: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: '10:00',
    paintersCount: 1,
    sessionType: 'painting',
    status: 'confirmed',
  });

  const [newBabiesCount, setNewBabiesCount] = useState(1);
  const [newAdultsCount, setNewAdultsCount] = useState(1);
  const [newBookingCapacity, setNewBookingCapacity] = useState<number | null>(null);
  const [newBookingConflict, setNewBookingConflict] = useState<string | null>(null);
  const [editBookingCapacity, setEditBookingCapacity] = useState<number | null>(null);
  const [newBookingPaymentMethod, setNewBookingPaymentMethod] = useState<'payment-link' | 'paid'>('payment-link');
  const [newBookingDepositAmount, setNewBookingDepositAmount] = useState<string>('50');
  const [newBookingFinalPending, setNewBookingFinalPending] = useState<boolean>(true);
  const [showGhostModal, setShowGhostModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockDraft, setBlockDraft] = useState<{ studio: 'Putney' | 'Wimbledon'; date: string; startTime: string; endTime: string; label: string }>({
    studio: 'Wimbledon',
    date: new Date().toISOString().split('T')[0],
    startTime: '10:00',
    endTime: '12:00',
    label: 'Studio Block',
  });
  const [ghostBooking, setGhostBooking] = useState({ seats: 1, studio: defaultStudio });
  const [ghostCapacity, setGhostCapacity] = useState<number | null>(null);
  const [ghostConflict, setGhostConflict] = useState<string | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assignModalBooking, setAssignModalBooking] = useState<BookingInquiry | null>(null);
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerBooking, setDrawerBooking] = useState<BookingInquiry | null>(null);
  const [sendingDepositLink, setSendingDepositLink] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<StripePaymentDetails | null>(null);
  const [paymentDetailsLoading, setPaymentDetailsLoading] = useState(false);
  const [paymentDetailsError, setPaymentDetailsError] = useState('');
  const [staffNotesDraft, setStaffNotesDraft] = useState('');
  const [drawerCommLogs, setDrawerCommLogs] = useState<EmailLog[]>([]);
  const [drawerCommLoading, setDrawerCommLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: 'danger' | 'warning';
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', confirmLabel: 'Confirm', variant: 'danger', onConfirm: () => {} });
  const [photoUploading, setPhotoUploading] = useState(false);

  const showConfirmDialog = (opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'warning'; onConfirm: () => void }) => {
    setConfirmDialog({ isOpen: true, confirmLabel: 'Confirm', variant: 'danger', ...opts });
  };
  const closeConfirmDialog = () => setConfirmDialog(d => ({ ...d, isOpen: false }));

  const handleUnauthorized = () => {
    showToast('Your session has expired. Please log in again.', 'error');
    localStorage.removeItem('pp_current_staff');
    onLogout();
  };

  // Session no longer expires - removed expiry check

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, studioFilter, bookingTypeTab, debouncedSearchTerm, dateRange, sort]);

  const fetchCapacity = useCallback(async (studio: string, date: string, time: string, setter: (v: number | null) => void, sessionType?: string, conflictSetter?: (v: string | null) => void, paintersCount?: number) => {
    if (!studio || !date || !time) { setter(null); if (conflictSetter) conflictSetter(null); return; }
    setCapacityLoading(true);
    try {
      const remaining = await getRemainingCapacity(studio as 'Putney' | 'Wimbledon', date, time, sessionType, paintersCount);
      setter(remaining);
      if (conflictSetter) conflictSetter(null);
    } catch (err) {
      setter(null);
      if (conflictSetter) conflictSetter(err instanceof Error ? err.message : 'Conflict detected');
    } finally {
      setCapacityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showAddModal && newBooking.studio && newBooking.date && newBooking.time) {
      fetchCapacity(newBooking.studio, newBooking.date, newBooking.time, setNewBookingCapacity, newBooking.sessionType, setNewBookingConflict, newBooking.paintersCount);
    }
  }, [showAddModal, newBooking.studio, newBooking.date, newBooking.time, newBooking.sessionType, fetchCapacity]);

  useEffect(() => {
    if (showEditModal && editingBooking?.studio && editingBooking?.date && editingBooking?.time) {
      fetchCapacity(editingBooking.studio, editingBooking.date, editingBooking.time, setEditBookingCapacity, editingBooking.sessionType, undefined, editingBooking.paintersCount);
    }
  }, [showEditModal, editingBooking?.studio, editingBooking?.date, editingBooking?.time, fetchCapacity]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setLoading(true);
      await Promise.all([loadInquiries(), loadGiftCards(), loadStripeMode(), loadPartyPrice(), loadTablePlanEnabled()]);
      if (isMounted) setLoading(false);
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  // Load party buffers once staff is authenticated (initial effect runs before staff is ready)
  useEffect(() => {
    if (staff?.sessionToken) loadPartyBuffers();
  }, [staff?.sessionToken]);

  useEffect(() => {
    let isMounted = true;
    if (activeTab === 'settings') {
      loadCapacity();
      loadPageSettings();
      loadStaffList();
      loadPartyBuffers();
      loadSlotsFromSupabase().then(slots => setTimeSlotConfig(slots));
      loadClosuresFromSupabase().then(setClosures);
    }
    if (activeTab === 'webmaster' && staff.role === 'super_admin') {
      loadDbHealth();
      loadDbBackups();
      loadSampleDataStatus();
    }
    if (activeTab === 'audit-logs' && staff.role === 'super_admin') {
      loadAuditLogs();
    }
    if (activeTab === 'email-logs' && canManageStaff) {
      loadEmailLogs();
    }
    if (activeTab === 'email-templates' && canManageStaff) {
      loadEmailTemplates();
      loadSmsTemplates();
    }
    return () => { isMounted = false; };
  }, [activeTab, staff.role]);

  // Keep staff-notes draft in sync with the opened booking
  useEffect(() => {
    if (drawerBooking) {
      setStaffNotesDraft(drawerBooking.staffNotes || '');
    }
  }, [drawerBooking]);

  // Fetch communication logs when drawer opens
  useEffect(() => {
    if (!drawerBooking || !staff?.sessionToken) { setDrawerCommLogs([]); return; }
    setDrawerCommLoading(true);
    const fetchCommLogs = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'getEmailLogs', username: staff.username, sessionToken: staff.sessionToken, limit: 500 }),
        });
        const data = await res.json();
        if (data.logs) {
          const bookingLogs = data.logs.filter((l: EmailLog) => l.booking_id === drawerBooking.id);
          setDrawerCommLogs(bookingLogs);
        }
      } catch { /* ignore */ } finally { setDrawerCommLoading(false); }
    };
    fetchCommLogs();
  }, [drawerBooking, staff]);

  // Persist dashboard filters
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pp_admin_filters');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.filter) setFilter(parsed.filter);
        if (parsed.studioFilter) setStudioFilter(parsed.studioFilter);
        if (parsed.bookingTypeTab) setBookingTypeTab(parsed.bookingTypeTab);
        if (parsed.dateRange) setDateRange(parsed.dateRange);
        if (parsed.sort) setSort(parsed.sort);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('pp_admin_filters', JSON.stringify({
        filter,
        studioFilter,
        bookingTypeTab,
        dateRange,
        sort,
      }));
    } catch {
      // ignore storage errors
    }
  }, [filter, studioFilter, bookingTypeTab, dateRange, sort]);

  // Auto-refresh bookings and gift cards every 60s while dashboard is active
  useEffect(() => {
    if (activeTab !== 'dashboard' && activeTab !== 'bookings' && activeTab !== 'gift-cards' && activeTab !== 'floor-plan') return;
    const refresh = async () => {
      if (activeTab === 'dashboard' || activeTab === 'bookings' || activeTab === 'floor-plan') await loadInquiries();
      if (activeTab === 'gift-cards') await loadGiftCards();
      setLastUpdated(new Date());
    };
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Set up Supabase Realtime subscription for bookings, gift cards, and audit logs
  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase) return;

    let isMounted = true;
    const channel = supabase
      .channel('admin-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => { if (isMounted) loadInquiries(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gift_cards' },
        () => { if (isMounted) loadGiftCards(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'audit_logs' },
        () => { if (isMounted && canManageStaff) loadAuditLogs(); }
      )
      .subscribe((status) => {
        if (isMounted) {
          if (status === 'SUBSCRIBED') {
            setRealtimeConnected(true);
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setRealtimeConnected(false);
          }
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadStripeMode = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'stripe_mode' }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Failed to load stripe mode:', data.error);
        return;
      }
      if (data.value === 'live') setStripeMode('live');
    } catch (err) {
      console.error('Failed to load stripe mode:', err);
    }
    try {
      const r2 = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'maintenance_mode' }),
      });
      const d2 = await r2.json();
      if (d2.value === 'true') setMaintenanceModeState(true);
    } catch (err) { console.error('Failed to load maintenance mode:', err); }
  };

  const toggleMaintenanceMode = async (enabled: boolean) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setMaintenanceSaving(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, key: 'maintenance_mode', value: String(enabled) }),
      });
      if (!res.ok) throw new Error();
      setMaintenanceModeState(enabled);
      showToast(enabled ? 'Maintenance mode ON — site hidden from public' : 'Maintenance mode OFF — site is live', enabled ? 'error' : 'success');
    } catch {
      showToast('Failed to update maintenance mode', 'error');
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const updateStripeMode = async (mode: 'sandbox' | 'live') => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, key: 'stripe_mode', value: mode }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        console.error('Failed to update stripe mode:', data.error);
        showToast('Failed to update Stripe mode', 'error');
        return;
      }
      setStripeMode(mode);
    } catch (err) {
      console.error('Failed to update stripe mode:', err);
      showToast('Failed to update Stripe mode', 'error');
    }
  };

  const loadPartyPrice = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'party_price_per_person' }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Failed to load party price:', data.error);
        return;
      }
      if (data.value) setPartyPrice(Number(data.value));
    } catch (err) {
      console.error('Failed to load party price:', err);
    }
    if (isSupabaseEnabled() && supabase) {
      const { data: noticeData } = await supabase.from('content').select('value').eq('key', 'deposit_notice_type').eq('page', 'party-booking').maybeSingle();
      if (noticeData?.value && ['info','warning','success','error'].includes(noticeData.value)) {
        setDepositNoticeTypeState(noticeData.value as 'info' | 'warning' | 'success' | 'error');
      }
    }

    // Load party guest limits
    try {
      const [putneyRes, wimbledonRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'party_guest_limit_putney' }),
        }),
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'party_guest_limit_wimbledon' }),
        }),
      ]);
      const putneyData = await putneyRes.json();
      if (putneyData.value) setPartyGuestLimitPutney(Number(putneyData.value));
      const wimbledonData = await wimbledonRes.json();
      if (wimbledonData.value) setPartyGuestLimitWimbledon(Number(wimbledonData.value));
    } catch (err) {
      console.error('Failed to load party guest limits:', err);
    }
  };

  const updatePartyGuestLimit = async (studio: 'putney' | 'wimbledon', value: number) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, key: `party_guest_limit_${studio}`, value: String(value) }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        showToast('Failed to update party guest limit', 'error');
        return;
      }
      if (studio === 'putney') setPartyGuestLimitPutney(value);
      else setPartyGuestLimitWimbledon(value);
      showToast('Party guest limit updated', 'success');
    } catch (err) {
      console.error('Failed to update party guest limit:', err);
      showToast('Failed to update party guest limit', 'error');
    }
  };

  const updatePartyPrice = async (value: number) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, key: 'party_price_per_person', value: String(value) }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        showToast('Failed to update party price', 'error');
        return;
      }
      setPartyPrice(value);
      showToast('Party price updated', 'success');
    } catch (err) {
      console.error('Failed to update party price:', err);
      showToast('Failed to update party price', 'error');
    }
  };

  const loadTablePlanEnabled = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'table_plan_enabled' }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Failed to load table plan setting:', data.error);
        return;
      }
      setTablePlanEnabled(data.value === 'true');
    } catch (err) {
      console.error('Failed to load table plan setting:', err);
    }
  };

  const updateTablePlanEnabled = async (enabled: boolean) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, key: 'table_plan_enabled', value: String(enabled) }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        showToast('Failed to update table plan setting', 'error');
        return;
      }
      setTablePlanEnabled(enabled);
      showToast(`Table plan ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      console.error('Failed to update table plan setting:', err);
      showToast('Failed to update table plan setting', 'error');
    }
  };

  const loadPartyBuffers = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const [setupRes, cleanupRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'party_setup_buffer_minutes' }),
        }),
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'load', username: staff.username, sessionToken: staff.sessionToken, key: 'party_cleanup_buffer_minutes' }),
        }),
      ]);
      const setup = await setupRes.json().catch(() => ({}));
      const cleanup = await cleanupRes.json().catch(() => ({}));
      if (setup.value) setPartySetupBuffer(Number(setup.value) || 30);
      if (cleanup.value) setPartyCleanupBuffer(Number(cleanup.value) || 20);
    } catch (err) {
      console.error('Failed to load party buffer settings:', err);
    }
  };

  const savePartyBuffers = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setBufferSaving(true);
    try {
      const [setupRes, cleanupRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, key: 'party_setup_buffer_minutes', value: String(partySetupBuffer) }),
        }),
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, key: 'party_cleanup_buffer_minutes', value: String(partyCleanupBuffer) }),
        }),
      ]);
      if (!setupRes.ok || !cleanupRes.ok) throw new Error('Failed to save');
      showToast('Party buffer settings saved', 'success');
    } catch (err) {
      console.error('Failed to save party buffer settings:', err);
      showToast('Failed to save party buffer settings', 'error');
    } finally {
      setBufferSaving(false);
    }
  };

  const loadCapacity = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'loadCapacity', username: staff.username, sessionToken: staff.sessionToken }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Failed to load capacity:', data.error);
        return;
      }
      const order: Record<string, number> = { open: 0, open_restricted: 1, party: 2, sip_and_paint: 3 };
      const sorted = [...(data.capacity || [])].sort((a, b) => {
        if (a.studio !== b.studio) return a.studio.localeCompare(b.studio);
        return (order[a.session_type] ?? 99) - (order[b.session_type] ?? 99);
      });
      setCapacityRows(sorted);
    } catch (err) {
      console.error('Failed to load capacity:', err);
    }
  };

  const loadPageSettings = async () => {
    if (!isSupabaseEnabled()) return;
    setPageSettingsLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/page-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'load' }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        console.error('Failed to load page settings:', data.error);
        return;
      }
      setPageSettings(data.settings || []);
    } catch (err) {
      console.error('Failed to load page settings:', err);
    } finally {
      setPageSettingsLoading(false);
    }
  };

  const updatePageSetting = async (pageKey: string, enabled: boolean) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/page-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'update', username: staff.username, sessionToken: staff.sessionToken, pageKey, enabled }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to update page setting', 'error');
        return;
      }
      setPageSettings(prev => prev.map(s => s.page_key === pageKey ? { ...s, enabled } : s));
      window.dispatchEvent(new CustomEvent('pp-page-settings-changed'));
      showToast('Page setting updated', 'success');
    } catch (err) {
      console.error('Failed to update page setting:', err);
      showToast('Failed to update page setting', 'error');
    }
  };

  const updateCapacity = async (row: { studio: string; session_type: string; max_painters: number }) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setCapacitySaving(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'updateCapacity',
          username: staff.username,
          sessionToken: staff.sessionToken,
          studio: row.studio,
          sessionType: row.session_type,
          maxPainters: row.max_painters,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        console.error('Failed to update capacity:', data.error);
        showToast('Failed to update capacity', 'error');
        return;
      }
      showToast('Capacity updated', 'success');
      await loadCapacity();
    } catch (err) {
      console.error('Failed to update capacity:', err);
      showToast('Failed to update capacity', 'error');
    } finally {
      setCapacitySaving(false);
    }
  };

  const loadInquiries = async () => {
    try {
      let bookings = await loadBookings(staff);
      if (staffAllowedStudios) {
        bookings = bookings.filter(b => staffAllowedStudios.includes(b.studio));
      }
      setInquiries(bookings);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : '';
      if (msg === 'Unauthorized') { handleUnauthorized(); return; }
      console.error('Failed to load inquiries:', err);
    }
  };

  const loadAuditLogs = async () => {
    if (!canManageStaff || !staff?.sessionToken) return;
    setAuditLogsLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'getAuditLogs',
          username: staff.username,
          sessionToken: staff.sessionToken,
        }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Audit logs error:', data.error);
        return;
      }
      setAuditLogs(data.logs || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setAuditLogsLoading(false);
    }
  };

  const loadEmailLogs = async () => {
    if (!canManageStaff || !staff?.sessionToken) return;
    setEmailLogsLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'getEmailLogs',
          username: staff.username,
          sessionToken: staff.sessionToken,
        }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Email logs error:', data.error);
        return;
      }
      setEmailLogs(data.logs || []);
    } catch (err) {
      console.error('Failed to load email logs:', err);
    } finally {
      setEmailLogsLoading(false);
    }
  };

  const resendEmail = async (logId: string): Promise<{ success: boolean; error?: string }> => {
    if (!staff?.sessionToken) return { success: false, error: 'Not authenticated' };
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'resendEmail', logId, staff: { username: staff.username, sessionToken: staff.sessionToken } }),
      });
      const data = await res.json();
      if (res.status === 401) { handleUnauthorized(); return { success: false, error: 'Unauthorized' }; }
      if (!res.ok || data.error) return { success: false, error: data.error || 'Failed to resend' };
      return { success: true };
    } catch {
      return { success: false, error: 'Failed to resend' };
    }
  };

  const loadEmailTemplates = async () => {
    if (!canManageStaff || !staff?.sessionToken) return;
    setEmailTemplatesLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-email-templates`, {
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
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Email templates error:', data.error);
        return;
      }
      setEmailTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to load email templates:', err);
    } finally {
      setEmailTemplatesLoading(false);
    }
  };

  const saveEmailTemplate = async (templateKey: string, subject: string, htmlContent: string) => {
    if (!staff?.sessionToken) return;
    setTemplateSaving(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-email-templates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'update',
          username: staff.username,
          sessionToken: staff.sessionToken,
          templateKey,
          subject,
          htmlContent,
        }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to save template', 'error');
        return;
      }
      showToast('Email template saved', 'success');
      setEditingTemplate(null);
      loadEmailTemplates();
    } catch (err) {
      console.error('Failed to save email template:', err);
      showToast('Failed to save template', 'error');
    } finally {
      setTemplateSaving(false);
    }
  };

  const resetEmailTemplate = async (templateKey: string) => {
    if (!staff?.sessionToken) return;
    if (!confirm('Reset this template to its default content? Any custom edits will be lost.')) return;
    setTemplateSaving(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-email-templates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'reset',
          username: staff.username,
          sessionToken: staff.sessionToken,
          templateKey,
        }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to reset template', 'error');
        return;
      }
      showToast('Template reset to default', 'success');
      loadEmailTemplates();
    } catch (err) {
      console.error('Failed to reset email template:', err);
      showToast('Failed to reset template', 'error');
    } finally {
      setTemplateSaving(false);
    }
  };

  const loadSmsTemplates = async () => {
    if (!canManageStaff || !staff?.sessionToken) return;
    setSmsTemplatesLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'listTemplates', staff: { username: staff.username, sessionToken: staff.sessionToken } }),
      });
      const data = await res.json();
      if (res.status === 401) { handleUnauthorized(); return; }
      if (data.templates) setSmsTemplates(data.templates);
    } catch (err) {
      console.error('Failed to load SMS templates:', err);
    } finally {
      setSmsTemplatesLoading(false);
    }
  };

  const saveSmsTemplate = async (templateKey: string, body: string) => {
    if (!staff?.sessionToken) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'updateTemplate', templateKey, body, staff: { username: staff.username, sessionToken: staff.sessionToken } }),
      });
      const data = await res.json();
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok || data.error) {
        showToast(data.error || 'Failed to save SMS template', 'error');
        return;
      }
      showToast('SMS template saved', 'success');
      loadSmsTemplates();
    } catch (err) {
      console.error('Failed to save SMS template:', err);
      showToast('Failed to save SMS template', 'error');
    }
  };

  const loadGiftCards = async () => {
    if (!isSuperAdmin) return;
    if (isSupabaseEnabled() && staff?.sessionToken) {
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ action: 'list', username: staff.username, sessionToken: staff.sessionToken }),
        });
        const data = await response.json();
        if (response.status === 401) { handleUnauthorized(); return; }
        if (response.status === 403) { return; }
        if (!response.ok || data.error) {
          console.error('Gift cards list error:', data.error);
        } else if (data.giftCards) {
          const mapped: GiftCard[] = data.giftCards.map((row: GiftCardApiRow) => ({
            id: row.id,
            code: row.code,
            amount: Number(row.amount),
            balance: Number(row.balance),
            covers: row.covers || undefined,
            recipientName: row.recipient_name || '',
            recipientEmail: row.recipient_email || '',
            senderName: row.sender_name || '',
            message: row.message,
            purchaseDate: row.purchase_date ? new Date(row.purchase_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
            expiryDate: row.expiry_date ? new Date(row.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined,
            status: row.status,
          }));
          setGiftCards(mapped);
          localStorage.setItem('pp_gift_cards', JSON.stringify(mapped));
          setLastUpdated(new Date());
          return;
        }
      } catch (err) {
        console.error('Gift cards request failed:', err);
      }
    }

    const saved = localStorage.getItem('pp_gift_cards');
    if (saved) {
      try {
        setGiftCards(JSON.parse(saved));
      } catch (err) {
        console.error('Failed to load gift cards:', err);
      }
    }
  };

  const getBookingAnalytics = () => getBookingAnalyticsUtil(inquiries);
  const getGiftCardAnalytics = () => getGiftCardAnalyticsUtil(giftCards);
  const exportBookingsCSV = () => exportBookingsCSVUtil(inquiries);

  const exportGiftCardsCSV = () => exportGiftCardsCSVUtil(giftCards);

  const exportCollectionStats = () => exportCollectionStatsCSVUtil(inquiries);

  const createGiftCardCheckout = async () => {
    if (!newGiftCard.amount || newGiftCard.amount <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }
    setGiftCardCreating(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-gift-card-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          amount: newGiftCard.amount,
          recipientName: newGiftCard.recipientName,
          recipientEmail: newGiftCard.recipientEmail,
          senderName: newGiftCard.senderName,
          message: newGiftCard.message,
          successUrl: `${window.location.origin}/gift-card-success`,
          cancelUrl: `${window.location.origin}/admin`,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to create checkout', 'error');
        return;
      }
      window.location.href = data.url;
    } catch {
      showToast('Failed to create checkout', 'error');
    } finally {
      setGiftCardCreating(false);
    }
  };

  const updateGiftCardStatus = async (id: string, status: 'active' | 'redeemed' | 'expired' | 'cancelled' | 'disabled') => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) {
      showToast('Gift card update unavailable', 'error');
      return;
    }
    if (status === 'expired') {
      showConfirmDialog({
        title: 'Expire Gift Card',
        message: 'This will mark the gift card as expired. This cannot be undone.',
        confirmLabel: 'Expire',
        variant: 'warning',
        onConfirm: () => { closeConfirmDialog(); updateGiftCardStatus(id, status); },
      });
      return;
    }
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
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
        throw new Error(data.error || 'Failed to update gift card');
      }
      setGiftCards(giftCards.map((c) => c.id === id ? { ...c, status } : c));
      showToast(`Gift card marked as ${status}`, 'success');
    } catch (err) {
      console.error('Failed to update gift card status:', err);
      showToast('Failed to update gift card status', 'error');
    }
  };

  const unredeemGiftCard = async (id: string, code: string) => {
    showConfirmDialog({
      title: 'Un-redeem Gift Card',
      message: `Restore gift card ${code} to active? If its balance was fully used, it will be restored to the full amount.`,
      confirmLabel: 'Restore',
      variant: 'warning',
      onConfirm: async () => {
        closeConfirmDialog();
        try {
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action: 'unredeem', username: staff.username, sessionToken: staff.sessionToken, id }),
          });
          const data = await response.json();
          if (!response.ok || data.error) throw new Error(data.error || 'Failed to un-redeem');
          setGiftCards(giftCards.map((c) => c.id === id ? { ...c, status: 'active', balance: data.balance } : c));
          showToast(`Gift card ${code} restored to active`, 'success');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to un-redeem gift card', 'error');
        }
      },
    });
  };

  const deleteGiftCard = async (id: string, code: string) => {
    showConfirmDialog({
      title: 'Delete Gift Card',
      message: `Are you sure you want to permanently delete gift card ${code}? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirmDialog();
        try {
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action: 'delete', username: staff.username, sessionToken: staff.sessionToken, id }),
          });
          const data = await response.json();
          if (!response.ok || data.error) throw new Error(data.error || 'Failed to delete');
          setGiftCards(giftCards.filter((c) => c.id !== id));
          showToast('Gift card deleted', 'success');
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to delete gift card', 'error');
        }
      },
    });
  };

  const resendGiftCard = async (id: string, code: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'resend', username: staff.username, sessionToken: staff.sessionToken, id }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Failed to resend');
      showToast(`Gift card ${code} email resent`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resend email', 'error');
    }
  };

  const downloadGiftCardVoucher = async (id: string, code: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'downloadVoucher', username: staff.username, sessionToken: staff.sessionToken, id }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to download voucher');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `pitter-potter-gift-voucher-${code}.pdf`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast(`Voucher ${code} downloaded`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to download voucher', 'error');
    }
  };

  const checkRedeemBalance = async (codeOverride?: string) => {
    const codeToUse = codeOverride ?? redeemCode;
    if (!codeToUse.trim()) return;
    setRedeemChecking(true);
    setRedeemError('');
    setRedeemBalanceResult(null);
    setRedeemResult(null);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'balance', username: staff.username, sessionToken: staff.sessionToken, code: codeToUse.trim() }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Gift card not found');
      setRedeemBalanceResult(data);
    } catch (err) {
      setRedeemError(err instanceof Error ? err.message : 'Failed to check balance');
    } finally {
      setRedeemChecking(false);
    }
  };

  const redeemGiftCard = async () => {
    const amount = parseFloat(redeemAmount);
    const isActivityVoucher = !!redeemBalanceResult?.covers;
    if (!redeemCode.trim() || (!isActivityVoucher && (!amount || amount <= 0))) return;
    setRedeeming(true);
    setRedeemError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'redeem', username: staff.username, sessionToken: staff.sessionToken, code: redeemCode.trim(), amount }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Failed to redeem');
      setRedeemResult({ discount: data.discount, balance: data.balance, status: data.status });
      if (redeemBalanceResult) {
        setRedeemBalanceResult({ ...redeemBalanceResult, balance: data.balance, status: data.status });
      }
      showToast(isActivityVoucher ? 'Activity voucher marked as used' : `Redeemed £${data.discount.toFixed(2)} from gift card`, 'success');
      loadGiftCards();
    } catch (err) {
      setRedeemError(err instanceof Error ? err.message : 'Failed to redeem gift card');
    } finally {
      setRedeeming(false);
    }
  };

  const createGiftCardInStore = async () => {
    const isActivity = giftCardKind === 'activity';
    if (isActivity && !newGiftCard.covers.trim()) {
      showToast('Please enter what the voucher covers', 'error');
      return;
    }
    if (!isActivity && (!newGiftCard.amount || newGiftCard.amount <= 0)) {
      showToast('Please enter a valid amount', 'error');
      return;
    }
    setGiftCardCreating(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          action: 'create',
          username: staff.username,
          sessionToken: staff.sessionToken,
          amount: isActivity ? 0 : newGiftCard.amount,
          covers: isActivity ? newGiftCard.covers.trim() : '',
          recipientName: newGiftCard.recipientName,
          recipientEmail: giftCardIsPhysical ? '' : newGiftCard.recipientEmail,
          senderName: newGiftCard.senderName || 'In-store',
          message: newGiftCard.message,
          isPhysical: giftCardIsPhysical || isActivity && !newGiftCard.recipientEmail,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Failed to create gift card');
      showToast(`${isActivity ? 'Activity voucher' : 'Gift card'} ${data.code} created${giftCardIsPhysical ? ' (physical)' : ''}`, 'success');
      setShowGiftCardModal(false);
      setNewGiftCard({ amount: 50, recipientName: '', recipientEmail: '', senderName: '', message: '', covers: '' });
      setGiftCardKind('amount');
      setGiftCardIsPhysical(false);
      loadGiftCards();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create gift card', 'error');
    } finally {
      setGiftCardCreating(false);
    }
  };

  const openRedeemModal = (code?: string, autoScan: boolean = false) => {
    setRedeemCode(code || '');
    setRedeemAmount('');
    setRedeemBalanceResult(null);
    setRedeemResult(null);
    setRedeemError('');
    setAdminScanning(autoScan);
    setShowRedeemModal(true);
  };

  const handleAdminScan = (scannedCode: string) => {
    setRedeemCode(scannedCode);
    setAdminScanning(false);
    checkRedeemBalance(scannedCode);
  };

  const loadStaffList = async () => {
    if (!canManageStaff || !staff?.sessionToken) return;

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-management`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'list', username: staff.username, sessionToken: staff.sessionToken }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Staff list error:', data.error);
      } else if (data.staff) {
        const mapped: Staff[] = data.staff.map((row: StaffApiRow) => ({
          id: row.id,
          name: row.name,
          username: row.username,
          passwordHash: '',
          role: row.role,
          canUpdateStatus: row.can_update_status,
          canEditBookings: row.can_edit_bookings,
          canAddWalkIns: row.can_add_walk_ins,
          canDeleteBookings: row.can_delete_bookings,
          allowedStudios: row.allowed_studios && row.allowed_studios.length > 0 ? row.allowed_studios : undefined,
          createdAt: row.created_at,
        }));
        setStaffList(mapped);
      }
    } catch (err) {
      console.error('Staff list request failed:', err);
    }
  };

  const updateBookingTable = async (bookingId: string, tableId: string | null) => {
    try {
      const booking = inquiries.find(i => i.id === bookingId);
      if (!booking) return;
      const updated = { ...booking, tableId: tableId ?? undefined };
      // Patch only table_id — a full update would run Wimbledon re-allocation
      // and overwrite the staff's manual table pick.
      await patchBooking(bookingId, { studio: booking.studio, tableId }, staff);
      setInquiries(inquiries.map(i => i.id === bookingId ? updated : i));
      setAssignModalBooking(null);
      showToast(tableId ? `Table ${tableId} assigned` : 'Table unassigned', 'success');
    } catch {
      showToast('Failed to update table assignment', 'error');
    }
  };

  const handleBlockStudio = async (studio: 'Putney' | 'Wimbledon', date: string, startTime: string, endTime: string, label: string) => {
    try {
      await blockStudio(studio, date, startTime, endTime, label, staff);
      await loadInquiries();
      showToast(`${label} — ${studio} blocked ${startTime}–${endTime}. Cancel the "${label}" booking to unblock.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to block studio', 'error');
    }
  };

  const autoAssignTable = async (booking: BookingInquiry, silent = false): Promise<string | null> => {
    try {
      let tableId = '';
      if (booking.studio === 'Wimbledon') {
        const allocation = allocateResourcesFromBookings({
          studio: booking.studio,
          date: booking.date,
          time: booking.time,
          paintersCount: booking.paintersCount,
          sessionType: booking.sessionType,
          partyArea: isPartySessionType(booking.sessionType) ? (booking.paintersCount > 14 ? 'PA1+PA2' : undefined) : undefined,
          excludeBookingId: booking.id,
        }, inquiries);
        if (!allocation.success) {
          if (!silent) showToast(allocation.reason || 'No available table configuration', 'error');
          return null;
        }
        tableId = formatResources(allocation.resources);
      } else {
        const blocked = JSON.parse(localStorage.getItem('pitter_potter_blocked_tables_putney') || '[]');
        const partyOnly = booking.sessionType.includes('party');
        const tableIds = findMultiplePutneyTables(inquiries, blocked, booking.date, booking.time, booking.paintersCount, partyOnly);
        if (!tableIds.length) {
          if (!silent) showToast('No available tables found', 'error');
          return null;
        }
        tableId = tableIds.join(', ');
      }
      if (!tableId) {
        if (!silent) showToast('No available tables found', 'error');
        return null;
      }
      const updated = { ...booking, tableId };
      await updateBooking(updated, staff);
      setInquiries(prev => prev.map(i => i.id === booking.id ? updated : i));
      if (!silent) showToast(`Table${tableId.includes(',') ? 's' : ''} ${tableId} assigned`, 'success');
      return tableId;
    } catch {
      if (!silent) showToast('Auto-assign failed', 'error');
      return null;
    }
  };

  const deleteInquiry = (id: string) => {
    showConfirmDialog({
      title: 'Delete Booking',
      message: 'This will permanently remove the booking. This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirmDialog();
        try {
          await deleteBooking(id, staff);
          setInquiries(inquiries.filter((i) => i.id !== id));
          showToast('Booking deleted', 'success');
        } catch {
          showToast('Failed to delete booking', 'error');
        }
      },
    });
  };

  const updateStatus = async (id: string, status: 'confirmed' | 'pending' | 'seated' | 'completed' | 'cancelled' | 'no_show') => {
    setConfirmingIds(prev => new Set(prev).add(id));
    try {
      if (status === 'confirmed') {
        const booking = inquiries.find(i => i.id === id);
        if (tablePlanEnabled && booking && !booking.tableId) {
          const assigned = await autoAssignTable(booking, true);
          if (!assigned) {
            showToast('No tables available — studio may be full', 'error');
            return;
          }
          showToast(`Table ${assigned} auto-assigned`, 'success');
        }
      }
      await updateBookingStatus(id, status, staff);
      setInquiries(prev => prev.map((i) => (i.id === id ? { ...i, status } : i)));
      showToast(status === 'confirmed' ? 'Booking confirmed' : status === 'cancelled' ? 'Booking cancelled' : status === 'seated' ? 'Marked as seated' : status === 'completed' ? 'Marked as complete' : status === 'no_show' ? 'Marked as no-show' : 'Booking marked as awaiting', 'success');
    } catch {
      showToast('Failed to update status', 'error');
    } finally {
      setConfirmingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  // Global location scope — the header switcher drives `studioFilter` and every studio-specific
  // surface reads from `scopedInquiries`. Keep `inquiries` (unfiltered) for id/token lookups so a
  // booking stays actionable after switching location mid-task.
  const scopedInquiries = useMemo(() =>
    studioFilter === 'all' ? inquiries : inquiries.filter((i) => i.studio === studioFilter),
  [inquiries, studioFilter]);

  // Studio-scoped settings data — kept index-safe so edits/deletes still hit the right row
  const visibleCapacityRows = capacityRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => studioFilter === 'all' || row.studio === studioFilter);
  const visibleClosedDates = closures.closedDates
    .map((entry, idx) => ({ entry, idx }))
    .filter(({ entry }) => studioFilter === 'all' || entry.studio === 'Both' || entry.studio === studioFilter);

  const filteredInquiries = useMemo(() => inquiries
    .filter((inq) => {
      const statusMatch = filter === 'all' || inq.status === (filter === 'cancelled' ? 'cancelled' : filter);
      const studioMatch = studioFilter === 'all' || inq.studio === studioFilter;
      const searchMatch = debouncedSearchTerm === '' ||
        inq.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        inq.email.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        inq.phone.includes(debouncedSearchTerm) ||
        inq.id.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
      const dateMatch = (!dateRange.start || inq.date >= dateRange.start) && (!dateRange.end || inq.date <= dateRange.end);
      const typeMatch = bookingTypeTab === 'all' ||
        (bookingTypeTab === 'painting' && ['painting', 'sip-and-paint'].includes(inq.sessionType || '')) ||
        (bookingTypeTab === 'baby-prints' && inq.sessionType === 'clay-imprints') ||
        (bookingTypeTab === 'party' && ['birthday-party', 'baby-shower-hen', 'corporate'].includes(inq.sessionType || ''));
      return statusMatch && studioMatch && searchMatch && dateMatch && typeMatch;
    })
    .sort((a, b) => {
      const dir = sort.direction === 'asc' ? 1 : -1;
      if (sort.field === 'added') {
        const dateA = new Date(a.createdAt || a.requestDate || a.date).getTime();
        const dateB = new Date(b.createdAt || b.requestDate || b.date).getTime();
        return (dateA - dateB) * dir;
      }
      if (sort.field === 'date') {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateA === dateB ? a.time.localeCompare(b.time) * dir : (dateA - dateB) * dir;
      }
      if (sort.field === 'name') return a.name.localeCompare(b.name) * dir;
      if (sort.field === 'studio') return a.studio.localeCompare(b.studio) * dir;
      return a.status.localeCompare(b.status) * dir;
    }), [inquiries, filter, studioFilter, bookingTypeTab, debouncedSearchTerm, dateRange, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredInquiries.length / ITEMS_PER_PAGE));
  const paginatedInquiries = filteredInquiries.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const getBookingsForDate = (date: Date) => {
    return inquiries.filter((inq) => {
      const bookingDate = parseISO(inq.date);
      const dateMatch = isSameDay(bookingDate, date);
      const studioMatch = studioFilter === 'all' || inq.studio === studioFilter;
      return dateMatch && studioMatch;
    });
  };

  const bookingsForSelectedDate = selectedDate ? getBookingsForDate(selectedDate) : [];

  const stats = {
    total: scopedInquiries.length,
    pending: scopedInquiries.filter((i) => i.status === 'pending').length,
    confirmed: scopedInquiries.filter((i) => i.status === 'confirmed').length,
    paintedNoPhoto: scopedInquiries.filter(i =>
      i.status === 'completed' &&
      (!i.collectionStatus || i.collectionStatus === 'painted') &&
      (!i.photos || i.photos.length === 0)
    ).length,
  };

  const giftCardStats = {
    total: giftCards.length,
    active: giftCards.filter((c) => c.status === 'active').length,
    totalValue: giftCards.reduce((sum, c) => sum + c.amount, 0),
    remainingValue: giftCards.reduce((sum, c) => sum + c.balance, 0),
  };

  const filteredGiftCards = useMemo(() => {
    if (!giftCardSearchTerm) return giftCards;
    const q = giftCardSearchTerm.toLowerCase();
    return giftCards.filter((c) =>
      c.code.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      (c.recipientName || '').toLowerCase().includes(q) ||
      (c.recipientEmail || '').toLowerCase().includes(q)
    );
  }, [giftCards, giftCardSearchTerm]);

  const roleLabel = ROLE_LABEL;

  const auditActionLabel = AUDIT_ACTION_LABEL;
  const auditEntityLabel = AUDIT_ENTITY_LABEL;
  const auditActionColor = AUDIT_ACTION_COLOR;
  const formatAuditDetails = formatAuditDetailsUtil;

  const isSuperAdmin = staff.role === 'super_admin';

  const staffAllowedStudios: ('Putney' | 'Wimbledon')[] | null =
    isSuperAdmin ? null : (staff.allowedStudios && staff.allowedStudios.length > 0 ? staff.allowedStudios : null);

  // Studios this staff member may see — super admins get both, everyone else their allowed list
  const visibleStudios: ('Putney' | 'Wimbledon')[] = staffAllowedStudios ?? ['Putney', 'Wimbledon'];

  // Clamp the global selection if it falls outside this staff member's visible studios
  useEffect(() => {
    if (studioFilter !== 'all' && !visibleStudios.includes(studioFilter)) setStudioFilter('all');
  }, [studioFilter, staff]);

  // Floor plan, time slots, and closures follow the global switcher when a studio is picked
  const effectiveFloorPlanStudio: 'Putney' | 'Wimbledon' =
    studioFilter !== 'all' ? studioFilter : floorPlanStudio;
  useEffect(() => {
    if (studioFilter !== 'all' && studioFilter !== timeSlotStudio) setTimeSlotStudio(studioFilter);
    if (studioFilter !== 'all') setNewClosedStudio(studioFilter);
  }, [studioFilter]);

  // New-booking and ghost-booking forms default to the globally selected studio
  useEffect(() => {
    if (showAddModal && studioFilter !== 'all' && newBooking.sessionType !== 'sip-and-paint') {
      setNewBooking(prev => prev.studio === studioFilter ? prev : { ...prev, studio: studioFilter });
    }
  }, [showAddModal]);
  useEffect(() => {
    if (showGhostModal && studioFilter !== 'all') {
      setGhostBooking(prev => prev.studio === studioFilter ? prev : { ...prev, studio: studioFilter });
    }
  }, [showGhostModal]);

  const canEdit = isSuperAdmin || staff.canEditBookings;
  const canUpdateStatus = isSuperAdmin || staff.canUpdateStatus;
  const canDelete = isSuperAdmin || staff.canDeleteBookings;
  const canAddWalkIn = isSuperAdmin || staff.canAddWalkIns;
  const canManageStaff = isSuperAdmin;

  const canManageBooking = (booking: BookingInquiry) => {
    if (isSuperAdmin) return true;
    if (!staffAllowedStudios) return true;
    return staffAllowedStudios.includes(booking.studio as 'Putney' | 'Wimbledon');
  };

  const handleCreateProfile = async (data: { name: string; phone: string; date: string; studio: string; photos: string[] }, stage: 'painted' | 'ready'): Promise<BookingInquiry> => {
    const bookingId = crypto.randomUUID();
    const uploadedPhotos: string[] = [];
    for (let i = 0; i < data.photos.length; i++) {
      const dataUrl = data.photos[i];
      if (isSupabaseEnabled() && staff?.sessionToken) {
        try {
          const uploadRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action: 'upload', username: staff.username, sessionToken: staff.sessionToken, key: `booking_${bookingId}_photo_${Date.now()}_${i}`, page: 'booking-photos', fileData: dataUrl, fileName: `profile_${data.name}_${i + 1}.jpg` }),
          });
          const uploadData = await uploadRes.json();
          if (uploadRes.ok && uploadData.url) {
            uploadedPhotos.push(uploadData.url);
          } else {
            uploadedPhotos.push(dataUrl);
          }
        } catch {
          uploadedPhotos.push(dataUrl);
        }
      } else {
        uploadedPhotos.push(dataUrl);
      }
    }
    const booking: BookingInquiry = {
      id: bookingId,
      studio: data.studio as 'Putney' | 'Wimbledon',
      name: data.name,
      email: '',
      phone: data.phone,
      date: data.date,
      time: '10:00',
      paintersCount: 1,
      sessionType: 'painting',
      status: 'completed',
      collectionStatus: stage,
      photos: uploadedPhotos,
      requestDate: new Date().toISOString(),
      source: 'walk-in',
    };
    await createBooking(booking, staff);
    setInquiries(prev => [booking, ...prev]);
    showToast(`Profile added to ${stage === 'painted' ? 'Painted' : 'Ready to Collect'}`, 'success');
    return booking;
  };

  const exportToCSV = () => {
    const headers = ['ID', 'Name', 'Email', 'Phone', 'Studio', 'Date', 'Time', 'Seats', 'Session Type', 'Status', 'Request Date'];
    const csvContent = [
      headers.join(','),
      ...filteredInquiries.map(inq => [
        inq.id,
        inq.name,
        inq.email,
        inq.phone,
        inq.studio,
        inq.date,
        inq.time,
        inq.paintersCount,
        inq.sessionType,
        inq.status,
        inq.requestDate
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookings_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleEditBooking = (booking: BookingInquiry) => {
    setEditingBooking(booking);
    setShowEditModal(true);
  };

  const uploadPhotosToBooking = async (booking: BookingInquiry, fileArr: File[]): Promise<BookingInquiry | null> => {
    if (fileArr.length === 0) return null;
    setPhotoUploading(true);
    try {
      const newPhotoUrls: string[] = [];
      for (const file of fileArr) {
        const dataUrl = await compressImage(file);
        let imageUrl = dataUrl;
        if (isSupabaseEnabled() && staff?.sessionToken) {
          const uploadRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action: 'upload', username: staff.username, sessionToken: staff.sessionToken, key: `booking_${booking.id}_photo_${Date.now()}`, page: 'booking-photos', fileData: dataUrl, fileName: file.name }),
          });
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok || uploadData.error || !uploadData.url) {
            throw new Error(uploadData.error || 'Upload failed');
          }
          imageUrl = uploadData.url;
        }
        newPhotoUrls.push(imageUrl);
      }
      const updatedBooking = { ...booking, photos: [...(booking.photos || []), ...newPhotoUrls] };
      await updateBooking(updatedBooking, staff);
      setInquiries(inquiries.map((i) => i.id === updatedBooking.id ? updatedBooking : i));
      showToast(`${newPhotoUrls.length} photo${newPhotoUrls.length > 1 ? 's' : ''} added`, 'success');
      return updatedBooking;
    } catch (err) {
      console.error('Failed to upload photo:', err);
      showToast('Failed to upload photo', 'error');
      return null;
    } finally {
      setPhotoUploading(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !editingBooking) return;
    e.target.value = '';
    const updated = await uploadPhotosToBooking(editingBooking, Array.from(files));
    if (updated) setEditingBooking(updated);
  };

  const handleDeletePhoto = async (index: number) => {
    if (!editingBooking || !editingBooking.photos) return;
    if (!canManageBooking(editingBooking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    const updatedPhotos = editingBooking.photos.filter((_, i) => i !== index);
    const updatedBooking = { ...editingBooking, photos: updatedPhotos.length > 0 ? updatedPhotos : undefined };
    setEditingBooking(updatedBooking);
    try {
      await updateBooking(updatedBooking, staff);
      setInquiries(inquiries.map((i) => i.id === updatedBooking.id ? updatedBooking : i));
      showToast('Photo removed', 'success');
    } catch {
      showToast('Failed to remove photo', 'error');
    }
  };

  const handleDrawerPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !drawerBooking) return;
    if (!canManageBooking(drawerBooking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    const fileArr = Array.from(files);
    e.target.value = '';
    setPhotoUploading(true);
    try {
      const newPhotoUrls: string[] = [];
      for (const file of fileArr) {
        const dataUrl = await compressImage(file);
        let imageUrl = dataUrl;
        if (isSupabaseEnabled() && staff?.sessionToken) {
          const uploadRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action: 'upload', username: staff.username, sessionToken: staff.sessionToken, key: `booking_${drawerBooking.id}_photo_${Date.now()}`, page: 'booking-photos', fileData: dataUrl, fileName: file.name }),
          });
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok || uploadData.error || !uploadData.url) {
            throw new Error(uploadData.error || 'Upload failed');
          }
          imageUrl = uploadData.url;
        }
        newPhotoUrls.push(imageUrl);
      }
      const updatedBooking = { ...drawerBooking, photos: [...(drawerBooking.photos || []), ...newPhotoUrls] };
      setDrawerBooking(updatedBooking);
      setInquiries(inquiries.map((i) => i.id === updatedBooking.id ? updatedBooking : i));
      await updateBooking(updatedBooking, staff);
      showToast(`${newPhotoUrls.length} photo${newPhotoUrls.length > 1 ? 's' : ''} added`, 'success');
    } catch (err) {
      console.error('Failed to upload photo:', err);
      showToast('Failed to upload photo', 'error');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleDrawerDeletePhoto = async (index: number) => {
    if (!drawerBooking || !drawerBooking.photos) return;
    if (!canManageBooking(drawerBooking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    const updatedPhotos = drawerBooking.photos.filter((_, i) => i !== index);
    const updatedBooking = { ...drawerBooking, photos: updatedPhotos.length > 0 ? updatedPhotos : undefined };
    setDrawerBooking(updatedBooking);
    try {
      await updateBooking(updatedBooking, staff);
      setInquiries(inquiries.map((i) => i.id === updatedBooking.id ? updatedBooking : i));
      showToast('Photo removed', 'success');
    } catch {
      showToast('Failed to remove photo', 'error');
    }
  };

  const handleAddPhotoTag = async (booking: BookingInquiry, photoIndex: number, label: string, status: string, x: number, y: number) => {
    if (!canManageBooking(booking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    const updatedTags = { ...(booking.photoTags || {}) };
    const existing = updatedTags[photoIndex] || [];
    updatedTags[photoIndex] = [...existing, { label: label.trim() || undefined, status, x, y }];
    const updatedBooking = { ...booking, photoTags: updatedTags };
    if (drawerBooking?.id === booking.id) setDrawerBooking(updatedBooking);
    setInquiries(prev => prev.map(i => i.id === updatedBooking.id ? updatedBooking : i));
    try {
      await updateBooking(updatedBooking, staff);
    } catch {
      showToast('Failed to add photo tag', 'error');
    }
  };

  const handleRemovePhotoTag = async (booking: BookingInquiry, photoIndex: number, tagIndex: number) => {
    if (!canManageBooking(booking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    const updatedTags = { ...(booking.photoTags || {}) };
    const existing = updatedTags[photoIndex] || [];
    updatedTags[photoIndex] = existing.filter((_, i) => i !== tagIndex);
    if (updatedTags[photoIndex].length === 0) delete updatedTags[photoIndex];
    const updatedBooking = { ...booking, photoTags: Object.keys(updatedTags).length > 0 ? updatedTags : undefined };
    if (drawerBooking?.id === booking.id) setDrawerBooking(updatedBooking);
    setInquiries(prev => prev.map(i => i.id === updatedBooking.id ? updatedBooking : i));
    try {
      await updateBooking(updatedBooking, staff);
    } catch {
      showToast('Failed to remove photo tag', 'error');
    }
  };

  const handleBulkAddPhotoTag = async (bookings: BookingInquiry[], label: string, status: string) => {
    let successCount = 0;
    let failCount = 0;
    for (const booking of bookings) {
      if (!canManageBooking(booking)) { failCount++; continue; }
      const photos = booking.photos ?? [];
      if (photos.length === 0) continue;
      const updatedTags = { ...(booking.photoTags || {}) };
      for (let i = 0; i < photos.length; i++) {
        const existing = updatedTags[i] || [];
        if (existing.some(t => t.status === status && (t.label || '') === (label.trim() || ''))) continue;
        updatedTags[i] = [...existing, { label: label.trim() || undefined, status, x: 50, y: 50 }];
      }
      const updatedBooking = { ...booking, photoTags: updatedTags };
      if (drawerBooking?.id === booking.id) setDrawerBooking(updatedBooking);
      setInquiries(prev => prev.map(i => i.id === updatedBooking.id ? updatedBooking : i));
      try {
        await updateBooking(updatedBooking, staff);
        successCount++;
      } catch {
        failCount++;
      }
    }
    if (failCount > 0) {
      showToast(`Tagged ${successCount} booking(s), ${failCount} failed`, 'error');
    } else {
      showToast(`Tagged all photos in ${successCount} booking(s)`, 'success');
    }
  };

  const saveStaffNotes = async () => {
    if (!drawerBooking || !staff) return;
    if (!canManageBooking(drawerBooking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    const updated = { ...drawerBooking, staffNotes: staffNotesDraft };
    try {
      await updateBooking(updated, staff);
      setInquiries(prev => prev.map(i => i.id === updated.id ? updated : i));
      setDrawerBooking(updated);
      showToast('Staff notes saved', 'success');
    } catch {
      showToast('Failed to save staff notes', 'error');
    }
  };

  const handleSetCollectionStage = async (booking: BookingInquiry, stage: CollectionStage) => {
    if (!canManageBooking(booking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    if (stage === 'ready') {
      const confirmed = window.confirm(`Move ${booking.name} to Ready and send email/SMS notification?`);
      if (!confirmed) return;
    }
    const updatedBooking: BookingInquiry = {
      ...booking,
      collectionStatus: stage,
      readyAt: stage === 'ready' ? new Date().toISOString()
        : stage === 'painted' ? undefined : booking.readyAt,
      collectedAt: stage === 'collected' ? new Date().toISOString() : undefined,
    };
    setInquiries(prev => prev.map(i => i.id === updatedBooking.id ? updatedBooking : i));
    try {
      await updateBooking(updatedBooking, staff);
      showToast(
        stage === 'collected' ? 'Marked as collected'
        : stage === 'ready' ? 'Marked ready to collect — notification sent'
        : 'Moved back to painted',
        'success',
      );
    } catch {
      setInquiries(prev => prev.map(i => i.id === booking.id ? booking : i));
      showToast('Failed to update collection status', 'error');
    }
  };

  const handleCollectionPhotoUpload = async (booking: BookingInquiry, files: File[]) => {
    if (files.length === 0) return;
    if (!canManageBooking(booking)) { showToast('You can only manage bookings for your assigned studio', 'error'); return; }
    setCollectionUploadingId(booking.id);
    try {
      const newPhotoUrls: string[] = [];
      for (const file of files) {
        const dataUrl = await compressImage(file);
        let imageUrl = dataUrl;
        if (isSupabaseEnabled() && staff?.sessionToken) {
          const uploadRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ action: 'upload', username: staff.username, sessionToken: staff.sessionToken, key: `booking_${booking.id}_photo_${Date.now()}`, page: 'booking-photos', fileData: dataUrl, fileName: file.name }),
          });
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok || uploadData.error || !uploadData.url) {
            throw new Error(uploadData.error || 'Upload failed');
          }
          imageUrl = uploadData.url;
        }
        newPhotoUrls.push(imageUrl);
      }
      const updatedBooking = { ...booking, photos: [...(booking.photos || []), ...newPhotoUrls] };
      setInquiries(prev => prev.map(i => i.id === updatedBooking.id ? updatedBooking : i));
      await updateBooking(updatedBooking, staff);
      showToast(`${newPhotoUrls.length} photo${newPhotoUrls.length > 1 ? 's' : ''} added`, 'success');
    } catch (err) {
      console.error('Failed to upload photo:', err);
      showToast('Failed to upload photo', 'error');
    } finally {
      setCollectionUploadingId(null);
    }
  };

  const saveBookingEdit = async (updatedBooking: BookingInquiry) => {
    const oldBooking = inquiries.find((i) => i.id === updatedBooking.id);
    let remaining = 0;
    try {
      remaining = await getRemainingCapacity(updatedBooking.studio, updatedBooking.date, updatedBooking.time, updatedBooking.sessionType, updatedBooking.paintersCount, updatedBooking.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cannot save: time slot conflict', 'error');
      return;
    }
    if (remaining < updatedBooking.paintersCount) {
      showToast(`This session only has room for ${remaining} seat${remaining === 1 ? '' : 's'} after this edit.`, 'error');
      return;
    }
    if (!oldBooking) {
      showToast('Original booking not found', 'error');
      return;
    }

    const isParty = ['birthday-party', 'baby-shower-hen', 'corporate'].includes(updatedBooking.sessionType);
    const bookingToSave = isParty ? updatedBooking : {
      ...updatedBooking,
      depositAmount: undefined,
      finalSeats: undefined,
      finalBalance: undefined,
      paymentStatus: undefined,
      paymentLinkUrl: undefined,
      paymentLinkSentAt: undefined,
      stripePaymentIntentId: undefined,
    };

    try {
      const warning = await updateBooking(bookingToSave, staff);
      setInquiries(inquiries.map((i) => i.id === bookingToSave.id ? bookingToSave : i));
      setShowEditModal(false);
      setEditingBooking(null);
      showToast(warning ? `Booking updated — ${warning}` : 'Booking updated', warning ? 'error' : 'success');
    } catch {
      showToast('Failed to update booking', 'error');
    }
  };

  const handleSendDepositLink = async () => {
    if (!drawerBooking) return;
    setSendingDepositLink(true);
    try {
      await sendDepositLink(drawerBooking.id, staff);
      const now = new Date().toISOString();
      const updated = { ...drawerBooking, paymentLinkUrl: `https://www.pitterpotter.co.uk/party-payment?booking=${drawerBooking.id}`, paymentLinkSentAt: now };
      setDrawerBooking(updated);
      setInquiries(inquiries.map((i) => i.id === updated.id ? updated : i));
      showToast('Deposit link emailed to customer', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send deposit link', 'error');
    } finally {
      setSendingDepositLink(false);
    }
  };

  const handleViewPaymentDetails = async () => {
    if (!drawerBooking) return;
    setShowPaymentModal(true);
    setPaymentDetailsLoading(true);
    setPaymentDetailsError('');
    setPaymentDetails(null);
    try {
      setPaymentDetails(await getPaymentDetails(drawerBooking.id, staff));
    } catch (err) {
      setPaymentDetailsError(err instanceof Error ? err.message : 'Failed to load payment details');
    } finally {
      setPaymentDetailsLoading(false);
    }
  };

  const saveNewBooking = async () => {
    if (!newBooking.name || !newBooking.date || !newBooking.time) {
      showToast('Please fill in name, date, and time', 'error');
      return;
    }
    // Validate email format if provided
    if (newBooking.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newBooking.email)) {
        showToast('Please enter a valid email address', 'error');
        return;
      }
    }
    // Validate phone format if provided
    if (newBooking.phone) {
      const phoneRegex = /^\+?\d[\d\s\-()]{6,29}$/;
      if (!phoneRegex.test(newBooking.phone.trim())) {
        showToast('Please enter a valid phone number (e.g. 07xxx or +49xxx)', 'error');
        return;
      }
    }
    // Validate date is not in the past (unless back-dating with a collection stage)
    const bookingDate = new Date(newBooking.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today && newCollectionStage === 'none') {
      showToast('Booking date cannot be in the past', 'error');
      return;
    }
    // Validate seats count
    if (!newBooking.paintersCount || newBooking.paintersCount < 1 || newBooking.paintersCount > 50) {
      showToast('Number of seats must be between 1 and 50', 'error');
      return;
    }
    // Block if party conflict detected
    if (newBookingConflict) {
      showToast(newBookingConflict, 'error');
      return;
    }
    try {
      const isParty = ['birthday-party', 'baby-shower-hen', 'corporate'].includes(newBooking.sessionType || 'painting');
      const seats = newBooking.sessionType === 'clay-imprints' ? newBabiesCount : (newBooking.paintersCount || 1);
      const booking: BookingInquiry = {
        id: crypto.randomUUID(),
        studio: newBooking.studio || 'Putney',
        name: newBooking.name,
        email: newBooking.email,
        phone: newBooking.phone,
        date: newBooking.date,
        time: newBooking.time,
        paintersCount: seats,
        sessionType: newBooking.sessionType || 'painting',
        notes: newBooking.sessionType === 'clay-imprints'
          ? `Babies: ${newBabiesCount}, Adults: ${newAdultsCount}${newBooking.notes ? ` | ${newBooking.notes}` : ''}`
          : newBooking.notes,
        status: newCollectionStage !== 'none' ? 'completed' : 'confirmed',
        requestDate: new Date().toISOString(),
        source: 'walk-in',
        ...(newCollectionStage !== 'none' ? {
          collectionStatus: newCollectionStage as 'painted' | 'ready' | 'collected',
          ...(newCollectionStage === 'collected' ? { collectedAt: new Date().toISOString() } : {}),
        } : {}),
        ...(isParty ? {
          depositAmount: newBookingPaymentMethod === 'paid' ? Math.max(0, Number(newBookingDepositAmount) || 0) : undefined,
          finalSeats: seats,
          finalBalance: newBookingPaymentMethod === 'paid'
            ? Math.max(0, seats * partyPrice - (Math.max(0, Number(newBookingDepositAmount) || 0)))
            : Math.max(0, seats * partyPrice - 50),
          paymentStatus: newBookingPaymentMethod === 'paid'
            ? (newBookingFinalPending ? 'pending' : 'paid')
            : 'pending',
          ...(newBookingPaymentMethod === 'paid' ? {
            depositPaidAt: new Date().toISOString(),
            ...(!newBookingFinalPending ? { finalPaidAt: new Date().toISOString() } : {}),
          } : {}),
          sendDepositLink: newBookingPaymentMethod === 'payment-link' && !!newBooking.email,
        } : {}),
      };
      const warning = await createBooking(booking, staff);
      setInquiries([booking, ...inquiries]);
      setShowAddModal(false);
      setLockedSessionType(null);
      setNewCollectionStage('none');
      setNewBooking({
        studio: defaultStudio,
        name: '',
        email: '',
        phone: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: '10:00',
        paintersCount: 1,
        sessionType: 'painting',
        status: 'pending',
      });
      setNewBabiesCount(1);
      setNewAdultsCount(1);
      showToast(warning ? `Booking added — ${warning}` : 'Booking added successfully', warning ? 'error' : 'success');
    } catch (err) {
      console.error('Failed to add booking:', err);
      showToast((err as Error).message || 'Failed to add booking', 'error');
    }
  };

  useEffect(() => {
    if (showGhostModal && ghostBooking.studio) {
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      fetchCapacity(ghostBooking.studio, format(now, 'yyyy-MM-dd'), time, setGhostCapacity, 'painting', setGhostConflict);
    }
  }, [showGhostModal, ghostBooking.studio, fetchCapacity]);

  const saveGhostBooking = async () => {
    if (!ghostBooking.seats || ghostBooking.seats < 1 || ghostBooking.seats > 50) {
      showToast('Seats must be between 1 and 50', 'error');
      return;
    }
    if (ghostConflict) {
      showToast(ghostConflict, 'error');
      return;
    }
    if (ghostCapacity !== null && ghostCapacity < ghostBooking.seats) {
      showToast(`Only ${ghostCapacity} spots remaining for this slot`, 'error');
      return;
    }
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dateStr = format(now, 'yyyy-MM-dd');
    try {
      const booking: BookingInquiry = {
        id: crypto.randomUUID(),
        studio: ghostBooking.studio as 'Putney' | 'Wimbledon',
        name: 'Walk-in',
        email: '',
        phone: '',
        date: dateStr,
        time,
        paintersCount: ghostBooking.seats,
        sessionType: 'painting',
        notes: `Walk-in: ${ghostBooking.seats} painter${ghostBooking.seats !== 1 ? 's' : ''}`,
        status: 'confirmed',
        requestDate: now.toISOString(),
        source: 'walk-in',
      };
      const warning = await createBooking(booking, staff);
      setInquiries([booking, ...inquiries]);
      setShowGhostModal(false);
      setGhostBooking({ seats: 1, studio: defaultStudio });
      showToast(
        warning
          ? `Walk-in added — ${warning}`
          : `${ghostBooking.seats} seat${ghostBooking.seats !== 1 ? 's' : ''} blocked as walk-in`,
        warning ? 'error' : 'success',
      );
    } catch (err) {
      console.error('Failed to add ghost booking:', err);
      showToast((err as Error).message || 'Failed to add walk-in', 'error');
    }
  };

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [newStaff, setNewStaff] = useState({
    name: '',
    username: '',
    password: '',
    role: 'staff' as Staff['role'],
    canUpdateStatus: false,
    canEditBookings: false,
    canAddWalkIns: false,
    canDeleteBookings: false,
    allowedStudios: [] as ('Putney' | 'Wimbledon')[],
  });
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [passwordChangeTarget, setPasswordChangeTarget] = useState<Staff | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dbHealth, setDbHealth] = useState<{ healthy: boolean; tables: Record<string, { exists: boolean; rows: number }>; issues: string[] } | null>(null);
  const [dbHealthLoading, setDbHealthLoading] = useState(false);
  const [dbBackups, setDbBackups] = useState<{ id: string; name: string; created_at: string; created_by?: { username: string; name: string }; tables?: string[] }[]>([]);
  const [dbBackupLoading, setDbBackupLoading] = useState(false);
  const [selectedBackupTables, setSelectedBackupTables] = useState<string[]>(BACKUP_TABLE_OPTIONS.map((t) => t.value));
  const [restoreModal, setRestoreModal] = useState<{ isOpen: boolean; backupId: string | null; name: string; tables: string[]; selected: string[] }>({
    isOpen: false,
    backupId: null,
    name: '',
    tables: [],
    selected: [],
  });
  const [sampleDataStatus, setSampleDataStatus] = useState<{ sampleBookings: number; sampleGiftCards: number } | null>(null);
  const [sampleDataLoading, setSampleDataLoading] = useState(false);

  const handleEditStaff = (staffMember: Staff) => {
    setEditingStaff(staffMember);
    setNewStaff({
      name: staffMember.name,
      username: staffMember.username,
      password: '',
      role: staffMember.role,
      canUpdateStatus: staffMember.canUpdateStatus,
      canEditBookings: staffMember.canEditBookings,
      canAddWalkIns: staffMember.canAddWalkIns,
      canDeleteBookings: staffMember.canDeleteBookings,
      allowedStudios: staffMember.allowedStudios || [],
    });
    setShowStaffModal(true);
  };

  const addStaffMember = async () => {
    if (!canManageStaff || !staff?.sessionToken) {
      showToast('Only super admins can manage staff', 'error');
      return;
    }
    if (!newStaff.name || !newStaff.username) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    if (!editingStaff && !newStaff.password) {
      showToast('Password is required for new staff', 'error');
      return;
    }
    if (newStaff.role === 'staff' && newStaff.allowedStudios.length === 0) {
      showToast('Please select a studio (Putney, Wimbledon, or Both)', 'error');
      return;
    }

    if (isSupabaseEnabled()) {
      try {
        const action = editingStaff ? 'update' : 'create';
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-management`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            action,
            username: staff.username,
            sessionToken: staff.sessionToken,
            staff: {
              id: editingStaff?.id,
              name: newStaff.name,
              username: newStaff.username,
              password: newStaff.password || undefined,
              role: newStaff.role,
              canUpdateStatus: newStaff.canUpdateStatus,
              canEditBookings: newStaff.canEditBookings,
              canAddWalkIns: newStaff.canAddWalkIns,
              canDeleteBookings: newStaff.canDeleteBookings,
              allowedStudios: newStaff.role === 'super_admin' ? null : (newStaff.allowedStudios.length > 0 ? newStaff.allowedStudios : null),
            },
          }),
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          console.error('Staff error:', data.error);
          showToast(data.error || `Failed to ${editingStaff ? 'update' : 'add'} staff member`, 'error');
          return;
        }
      } catch (err) {
        console.error('Staff request failed:', err);
        showToast(`Failed to ${editingStaff ? 'update' : 'add'} staff member`, 'error');
        return;
      }
    }

    await loadStaffList();
    setNewStaff({
      name: '',
      username: '',
      password: '',
      role: 'staff',
      canUpdateStatus: false,
      canEditBookings: false,
      canAddWalkIns: false,
      canDeleteBookings: false,
      allowedStudios: [],
    });
    setEditingStaff(null);
    setShowStaffModal(false);
    showToast(editingStaff ? 'Staff member updated' : 'Staff member added', 'success');
  };

  const deleteStaffMember = async (id: string) => {
    if (!canManageStaff) {
      showToast('Only super admins can manage staff', 'error');
      return;
    }
    if (id === staff.id) {
      showToast('You cannot delete your own account', 'error');
      return;
    }
    showConfirmDialog({
      title: 'Remove Staff Member',
      message: 'This will permanently remove this staff member. They will lose all access.',
      confirmLabel: 'Remove',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirmDialog();
        if (isSupabaseEnabled()) {
          try {
            const { error } = await supabase!.from('staff').delete().eq('id', id);
            if (error) console.error('Supabase delete staff error:', error);
          } catch (err) {
            console.error('Supabase delete staff failed:', err);
          }
        }
        await loadStaffList();
      },
    });
    return;

  };

  const handleChangePassword = (target: Staff) => {
    setPasswordChangeTarget(target);
    setNewPassword('');
    setConfirmPassword('');
    setShowChangePasswordModal(true);
  };

  const submitPasswordChange = async () => {
    if (!passwordChangeTarget) return;
    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-management`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'update',
          username: staff.username,
          sessionToken: staff.sessionToken,
          staff: {
            id: passwordChangeTarget.id,
            name: passwordChangeTarget.name,
            role: passwordChangeTarget.role,
            password: newPassword,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to change password', 'error');
        return;
      }
      setShowChangePasswordModal(false);
      setPasswordChangeTarget(null);
      setNewPassword('');
      setConfirmPassword('');
      showToast('Password changed successfully', 'success');
      await loadStaffList();
    } catch (err) {
      console.error('Failed to change password:', err);
      showToast('Failed to change password', 'error');
    }
  };

  const loadDbHealth = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setDbHealthLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/db-health`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ username: staff.username, sessionToken: staff.sessionToken }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('DB health error:', data.error);
        return;
      }
      setDbHealth(data);
    } catch (err) {
      console.error('Failed to load DB health:', err);
    } finally {
      setDbHealthLoading(false);
    }
  };

  const loadDbBackups = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setDbBackupLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/db-backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'list', username: staff.username, sessionToken: staff.sessionToken }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('DB backups error:', data.error);
        return;
      }
      setDbBackups(data.backups || []);
    } catch (err) {
      console.error('Failed to load DB backups:', err);
    } finally {
      setDbBackupLoading(false);
    }
  };

  const createDbBackup = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setDbBackupLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/db-backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'create', username: staff.username, sessionToken: staff.sessionToken, tables: selectedBackupTables }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to create backup', 'error');
        return;
      }
      showToast(`Backup created (${selectedBackupTables.length} tables)`, 'success');
      await loadDbBackups();
    } catch (err) {
      console.error('Failed to create backup:', err);
      showToast('Failed to create backup', 'error');
    } finally {
      setDbBackupLoading(false);
    }
  };

  const downloadDbBackup = async (backupId: string, name: string) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/db-backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'download', username: staff.username, sessionToken: staff.sessionToken, backupId }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to download backup', 'error');
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/\s+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download backup:', err);
      showToast('Failed to download backup', 'error');
    }
  };

  const deleteDbBackup = async (backupId: string) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/db-backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'delete', username: staff.username, sessionToken: staff.sessionToken, backupId }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to delete backup', 'error');
        return;
      }
      showToast('Backup deleted', 'success');
      await loadDbBackups();
    } catch (err) {
      console.error('Failed to delete backup:', err);
      showToast('Failed to delete backup', 'error');
    }
  };

  const restoreDbBackup = async (backupId: string, tables: string[]) => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setDbBackupLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/db-backup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'restore', username: staff.username, sessionToken: staff.sessionToken, backupId, tables }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Restore backup failed:', data);
        showToast(data.details || data.error || 'Failed to restore backup', 'error');
        return;
      }
      showToast(`Backup restored (${tables.length} tables). Reloading data...`, 'success');
      await Promise.all([
        loadInquiries(),
        loadStaffList(),
        loadCapacity(),
        loadPageSettings(),
        loadDbHealth(),
        loadDbBackups(),
      ]);
    } catch (err) {
      console.error('Failed to restore backup:', err);
      showToast('Failed to restore backup', 'error');
    } finally {
      setDbBackupLoading(false);
    }
  };

  const loadSampleDataStatus = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setSampleDataLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sample-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'status', username: staff.username, sessionToken: staff.sessionToken }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        console.error('Sample data status error:', data.error);
        return;
      }
      setSampleDataStatus(data);
    } catch (err) {
      console.error('Failed to load sample data status:', err);
    } finally {
      setSampleDataLoading(false);
    }
  };

  const addSampleData = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setSampleDataLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sample-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'add', username: staff.username, sessionToken: staff.sessionToken }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to add sample data', 'error');
        return;
      }
      showToast(data.message || 'Sample data added', 'success');
      await loadSampleDataStatus();
      await loadInquiries();
      await loadGiftCards();
    } catch (err) {
      console.error('Failed to add sample data:', err);
      showToast('Failed to add sample data', 'error');
    } finally {
      setSampleDataLoading(false);
    }
  };

  const removeSampleData = async () => {
    if (!isSupabaseEnabled() || !staff?.sessionToken) return;
    setSampleDataLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sample-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'remove', username: staff.username, sessionToken: staff.sessionToken }),
      });
      const data = await response.json();
      if (response.status === 401) { handleUnauthorized(); return; }
      if (!response.ok || data.error) {
        showToast(data.error || 'Failed to remove sample data', 'error');
        return;
      }
      showToast(data.message || 'Sample data removed', 'success');
      await loadSampleDataStatus();
      await loadInquiries();
      await loadGiftCards();
    } catch (err) {
      console.error('Failed to remove sample data:', err);
      showToast('Failed to remove sample data', 'error');
    } finally {
      setSampleDataLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF]">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#DBE7E4] text-[#1B2D3C] py-3 px-4 sm:px-6 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
            <div className="w-8 h-8 rounded-lg bg-[#1B2D3C]/10 flex items-center justify-center shrink-0">
              <span className="font-heading font-black text-sm">PP</span>
            </div>
            <div className="min-w-0">
              <p className="font-heading font-black text-sm leading-tight">Pitter Potter</p>
              <p className="text-[10px] text-[#1B2D3C]/60 truncate hidden sm:block">{staff.name} · {roleLabel[staff.role]}</p>
              <p className="text-[10px] text-[#1B2D3C]/60 truncate sm:hidden">{staff.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {canAddWalkIn && (
              <>
                <button
                  onClick={() => { setActiveTab('dashboard'); setShowGhostModal(true); }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#1B2D3C] hover:bg-[#486581] text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
                >
                  <Users className="w-4 h-4" /> <span className="hidden sm:inline">Walk-in</span>
                </button>
                <button
                  onClick={() => { setActiveTab('dashboard'); setNewBooking(prev => ({ ...prev, sessionType: 'painting' })); setLockedSessionType('painting'); setShowAddModal(true); }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
                >
                  <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Booking</span><span className="sm:hidden">Booking</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab('dashboard');
                    setNewBooking(prev => ({ ...prev, sessionType: 'birthday-party' }));
                    setLockedSessionType('party-group');
                    setShowAddModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
                >
                  <Gift className="w-4 h-4" /> <span className="hidden sm:inline">New Party</span><span className="sm:hidden">Party</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab('dashboard');
                    setNewBooking(prev => ({ ...prev, sessionType: 'clay-imprints' }));
                    setLockedSessionType('clay-imprints');
                    setShowAddModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
                >
                  <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Baby Print</span><span className="sm:hidden">Baby</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab('dashboard');
                    setNewBooking(prev => ({ ...prev, studio: 'Wimbledon', sessionType: 'sip-and-paint' }));
                    setLockedSessionType('sip-and-paint');
                    setShowAddModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
                >
                  <Wine className="w-4 h-4" /> <span className="hidden sm:inline">New Sip & Paint</span><span className="sm:hidden">Sip & Paint</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab('dashboard');
                    setNewBooking(prev => ({ ...prev, sessionType: 'exclusive-hire', time: '' }));
                    setLockedSessionType(null);
                    setShowAddModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
                >
                  <Clock className="w-4 h-4" /> <span className="hidden sm:inline">Exclusive Hire</span><span className="sm:hidden">Hire</span>
                </button>
              </>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setBlockDraft(prev => ({
                    ...prev,
                    studio: studioFilter !== 'all' ? studioFilter : (staff.allowedStudios?.[0] ?? 'Wimbledon'),
                    date: floorPlanDate,
                  }));
                  setShowBlockModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
              >
                <Ban className="w-4 h-4" /> <span className="hidden sm:inline">Block Studio</span><span className="sm:hidden">Block</span>
              </button>
            )}
            <NotificationBell
              staff={staff}
              studioFilter={studioFilter}
              onNavigate={(tab, entityId) => {
                setActiveTab(tab as typeof activeTab);
                if (entityId && tab === 'bookings') {
                  setSearchTerm(entityId);
                } else if (entityId && tab === 'gift-cards') {
                  setGiftCardSearchTerm(entityId);
                } else if (entityId && tab === 'ready') {
                  setSearchTerm(entityId);
                }
              }}
            />
            {isSuperAdmin && (
              <button
                onClick={() => {
                  localStorage.setItem('pp_activate_edit_mode', '1');
                  window.open('/', '_blank');
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
              >
                <Pencil className="w-4 h-4" /> <span className="hidden sm:inline">Editor</span>
              </button>
            )}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold rounded-lg transition-all cursor-pointer min-h-[44px]"
            >
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
        {visibleStudios.length > 1 && (
          <div className="max-w-7xl mx-auto flex items-center gap-1.5 mt-2.5">
            <MapPin className="w-3.5 h-3.5 text-[#1B2D3C]/50" />
            {(['all', ...visibleStudios] as ('all' | 'Putney' | 'Wimbledon')[]).map((s) => (
              <button
                key={s}
                onClick={() => setStudioFilter(s)}
                className={`px-3 py-1.5 text-[10px] font-bold rounded-full transition-all cursor-pointer border ${
                  studioFilter === s
                    ? 'bg-[#1B2D3C] text-white border-[#1B2D3C]'
                    : 'bg-white/60 text-[#1B2D3C]/60 border-[#1B2D3C]/10 hover:bg-white hover:text-[#1B2D3C]'
                }`}
              >
                {s === 'all' ? 'All Locations' : s}
              </button>
            ))}
          </div>
        )}
      </div>

      {!isOnline && (
        <div className="bg-red-600 text-white text-center py-2 px-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4" /> You are offline — changes may not save until connection is restored
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-8">
        {/* Admin Tabs — Grouped Navigation */}
        <div className="sticky top-[56px] z-30 bg-white border-b border-[#1B2D3C]/10 mb-6">
          <div className="flex items-center gap-1 scrollbar-hide">
            {/* Main tabs */}
            {[
              ...(isSuperAdmin ? [{ value: 'dashboard', label: 'Dashboard', badge: stats.pending > 0 ? stats.pending : null }] : []),
              { value: 'bookings', label: isSuperAdmin ? 'Bookings' : 'Dashboard', badge: isSuperAdmin ? null : (stats.pending > 0 ? stats.pending : null) },
              { value: 'painted', label: 'Painted', badge: stats.paintedNoPhoto > 0 ? stats.paintedNoPhoto : null },
              { value: 'ready', label: 'Ready', badge: null },
              { value: 'collected', label: 'Collected', badge: null },
              ...(isSuperAdmin ? [{ value: 'gift-cards', label: 'Gift Vouchers', badge: null }] : []),
              { value: 'floor-plan', label: 'Floor Plan', badge: null },
              ...(isSuperAdmin ? [{ value: 'sms', label: 'SMS', badge: null }] : []),
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value as typeof activeTab)}
                className={`relative shrink-0 px-4 py-3 text-xs font-bold tracking-wide border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === tab.value
                    ? 'border-[#1B2D3C] text-[#1B2D3C]'
                    : 'border-transparent text-[#1B2D3C]/50 hover:text-[#1B2D3C]'
                }`}
              >
                {tab.label}
                {tab.badge !== null && tab.badge !== undefined && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[9px] font-black bg-red-500 text-white rounded-full">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                )}
              </button>
            ))}

            {/* Redeem Card — opens the scanner/redeem modal, styled like a tab */}
            <button
              onClick={() => openRedeemModal(undefined, true)}
              className="relative shrink-0 px-4 py-3 text-xs font-bold tracking-wide border-b-2 border-transparent text-[#1B2D3C]/50 hover:text-[#1B2D3C] transition-all cursor-pointer flex items-center gap-2"
              title="Scan QR code to redeem gift card"
            >
              <ScanLine className="w-3.5 h-3.5" /> Redeem Card
            </button>

            {/* Logs dropdown */}
            {canManageStaff && (
              <LogsDropdown
                activeTab={activeTab}
                setActiveTab={(t) => setActiveTab(t as typeof activeTab)}
                isSuperAdmin={isSuperAdmin}
              />
            )}

            {/* Admin dropdown */}
            {canManageStaff && (
              <AdminDropdown
                activeTab={activeTab}
                setActiveTab={(t) => setActiveTab(t as typeof activeTab)}
                isSuperAdmin={isSuperAdmin}
              />
            )}
          </div>
        </div>

        {loading && (
          <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <Skeleton className="h-8 w-48" />
            <div className="space-y-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </div>
        )}

        {!loading && activeTab === 'dashboard' && (
          <DashboardSummary
            bookings={scopedInquiries}
            giftCards={giftCards}
            isSuperAdmin={isSuperAdmin}
            staffAllowedStudios={staffAllowedStudios}
            studioToggle={studioFilter}
            onStudioToggleChange={setStudioFilter}
            onNavigateToBookings={() => setActiveTab('bookings')}
            onNavigateToPainted={() => setActiveTab('painted')}
            onNavigateToReady={() => setActiveTab('ready')}
            onNavigateToCollected={() => setActiveTab('collected')}
            onNavigateToAddBooking={() => setShowAddModal(true)}
          />
        )}


        {activeTab === 'gift-cards' && (
          <div className="bg-white p-6 border border-[#1B2D3C]/20 shadow-sm mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg font-black text-[#1B2D3C] uppercase tracking-wider">Gift Cards</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search code or recipient…"
                  value={giftCardSearchTerm}
                  onChange={(e) => setGiftCardSearchTerm(e.target.value)}
                  className="w-48 pl-3 pr-8 py-1.5 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-semibold rounded-lg focus:outline-none focus:border-[#1B2D3C]/40 bg-white"
                />
                {giftCardSearchTerm && (
                  <button onClick={() => setGiftCardSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#1B2D3C]/30 hover:text-[#1B2D3C] cursor-pointer">×</button>
                )}
              </div>
              <button
                onClick={() => openRedeemModal()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1B2D3C] text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#243B53] transition-all cursor-pointer"
              >
                <Gift className="w-3 h-3" /> Redeem
              </button>
              <button
                onClick={() => setShowGiftCardModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#DBE7E4] text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Create Gift Card
              </button>
              <button
                onClick={exportGiftCardsCSV}
                className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] hover:text-[#486581] underline"
              >
                Export CSV
              </button>
              <button
                onClick={() => loadGiftCards()}
                className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] hover:text-[#486581] underline"
              >
                Refresh
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="bg-[#D6E2E9]/30 p-3 rounded-lg">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Total Sold</p>
              <p className="text-xl font-black text-[#1B2D3C]">{giftCardStats.total}</p>
            </div>
            <div className="bg-[#D6E2E9]/30 p-3 rounded-lg">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Active</p>
              <p className="text-xl font-black text-[#1B2D3C]">{giftCardStats.active}</p>
            </div>
            <div className="bg-[#D6E2E9]/30 p-3 rounded-lg">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Total Value</p>
              <p className="text-xl font-black text-[#1B2D3C]">£{giftCardStats.totalValue.toFixed(2)}</p>
            </div>
            <div className="bg-[#D6E2E9]/30 p-3 rounded-lg">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Remaining Balance</p>
              <p className="text-xl font-black text-[#1B2D3C]">£{giftCardStats.remainingValue.toFixed(2)}</p>
            </div>
          </div>
          {giftCardSearchTerm && (
            <div className="mb-3 text-xs font-bold text-[#1B2D3C]/50">
              Showing {filteredGiftCards.length} of {giftCards.length} gift cards
            </div>
          )}
          {giftCards.length > 0 ? (
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full text-left min-w-[600px]">
                <thead>
                  <tr className="border-b border-[#1B2D3C]/10">
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Code</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Amount</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Balance</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Recipient</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Sender</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Status</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Purchased</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Expires</th>
                    <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-xs font-semibold text-[#1B2D3C]">
                  {filteredGiftCards.map((card) => (
                    <tr key={card.id} className="border-b border-[#1B2D3C]/5">
                      <td className="py-2 font-mono">{card.code}</td>
                      <td className="py-2">
                        {card.covers
                          ? <span className="inline-block max-w-[160px] truncate text-purple-700" title={card.covers}>{card.covers}</span>
                          : `£${card.amount.toFixed(2)}`}
                      </td>
                      <td className="py-2">{card.covers ? '—' : `£${card.balance.toFixed(2)}`}</td>
                      <td className="py-2">{card.recipientName}</td>
                      <td className="py-2">{card.senderName}</td>
                      <td className="py-2">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                          card.status === 'active' ? 'bg-emerald-100 text-emerald-700' : card.status === 'expired' ? 'bg-red-100 text-red-700' : card.status === 'disabled' ? 'bg-orange-100 text-orange-700' : 'bg-stone-100 text-stone-500'
                        }`}>
                          {card.status}
                        </span>
                      </td>
                      <td className="py-2">{card.purchaseDate}</td>
                      <td className="py-2">{card.expiryDate || '-'}</td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(card.code);
                              showToast('Gift card code copied', 'success');
                            }}
                            className="px-2 py-1 bg-[#D6E2E9]/50 text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded hover:bg-[#D6E2E9] cursor-pointer"
                          >
                            Copy
                          </button>
                          {card.status === 'active' && (card.balance > 0 || !!card.covers) && (
                            <button
                              onClick={() => openRedeemModal(card.code)}
                              className="px-2 py-1 bg-[#1B2D3C] text-white text-[10px] font-bold uppercase tracking-wider rounded hover:bg-[#243B53] cursor-pointer"
                            >
                              Redeem
                            </button>
                          )}
                          {staff.role === 'super_admin' && card.status === 'active' && (
                            <button
                              onClick={() => updateGiftCardStatus(card.id, 'disabled')}
                              className="px-2 py-1 bg-orange-50 text-orange-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-orange-100 cursor-pointer"
                            >
                              Disable
                            </button>
                          )}
                          {staff.role === 'super_admin' && card.status === 'disabled' && (
                            <button
                              onClick={() => updateGiftCardStatus(card.id, 'active')}
                              className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-emerald-100 cursor-pointer"
                            >
                              Enable
                            </button>
                          )}
                          {staff.role === 'super_admin' && card.status === 'active' && (
                            <button
                              onClick={() => updateGiftCardStatus(card.id, 'expired')}
                              className="px-2 py-1 bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-red-100 cursor-pointer"
                            >
                              Expire
                            </button>
                          )}
                          {card.status === 'redeemed' && (
                            <button
                              onClick={() => unredeemGiftCard(card.id, card.code)}
                              className="px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-emerald-100 cursor-pointer"
                            >
                              Un-redeem
                            </button>
                          )}
                          {staff.role === 'super_admin' && card.recipientEmail && (
                            <button
                              onClick={() => resendGiftCard(card.id, card.code)}
                              className="px-2 py-1 bg-[#D6E2E9]/50 text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded hover:bg-[#D6E2E9] cursor-pointer"
                            >
                              Resend
                            </button>
                          )}
                          {staff.role === 'super_admin' && (
                            <button
                              onClick={() => downloadGiftCardVoucher(card.id, card.code)}
                              className="px-2 py-1 bg-[#DBE7E4] text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded hover:bg-[#D6E2E9] cursor-pointer"
                            >
                              Download
                            </button>
                          )}
                          {staff.role === 'super_admin' && (
                            <button
                              onClick={() => deleteGiftCard(card.id, card.code)}
                              className="px-2 py-1 bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded hover:bg-red-100 cursor-pointer"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-10">
              <Gift className="w-10 h-10 text-stone-300 mx-auto mb-3" />
              <p className="text-sm text-stone-500 font-semibold">No gift cards sold yet</p>
              <p className="text-xs text-stone-400 mt-1">Gift cards will appear here once purchased</p>
            </div>
          )}
        </div>
        )}

        {activeTab === 'bookings' && (
          <>
        <DashboardOverview
          bookings={scopedInquiries}
          onAssignTable={(bookingId, tableId) => {
            const booking = inquiries.find(i => i.id === bookingId);
            if (!booking) return;
            const updated = { ...booking, tableId: tableId ?? undefined };
            updateBooking(updated, staff).then(() => {
              setInquiries(inquiries.map(i => i.id === bookingId ? updated : i));
              showToast(tableId ? `Table ${tableId} assigned` : 'Table unassigned', 'success');
            }).catch(() => showToast('Failed to update table', 'error'));
          }}
          onConfirm={(bookingId) => updateStatus(bookingId, 'confirmed')}
          onBulkConfirm={async (ids) => {
            let confirmed = 0;
            let failed = 0;
            for (const id of ids) {
              const booking = inquiries.find(i => i.id === id);
              if (!booking) continue;
              if (tablePlanEnabled && !booking.tableId) {
                const assigned = await autoAssignTable(booking, true);
                if (!assigned) { failed++; continue; }
              }
              try {
                await updateBookingStatus(id, 'confirmed', staff);
                setInquiries(prev => prev.map(i => i.id === id ? { ...i, status: 'confirmed' } : i));
                confirmed++;
              } catch { failed++; }
            }
            if (confirmed > 0) showToast(`${confirmed} booking${confirmed !== 1 ? 's' : ''} confirmed`, 'success');
            if (failed > 0) showToast(`${failed} could not be confirmed — studio may be full`, 'error');
          }}
          onNavigateToBookings={(date) => {
            if (date) setDateRange({ start: date, end: date });
          }}
          onNavigateToAddBooking={(opts) => {
            setNewBooking(prev => ({
              ...prev,
              date: opts?.date ?? prev.date,
              sessionType: (opts?.sessionType as BookingInquiry['sessionType']) ?? prev.sessionType,
            }));
            setLockedSessionType(opts?.sessionType ?? null);
            setShowAddModal(true);
          }}
          onUpdateStatus={(id, status) => updateStatus(id, status)}
          onEditBooking={(booking) => handleEditBooking(booking)}
          onAddWalkIn={() => setShowGhostModal(true)}
          onUploadPhoto={(booking, files) => { uploadPhotosToBooking(booking, files); }}
          canUpdateStatus={canUpdateStatus}
          canAddWalkIn={canAddWalkIn}
        />

        {/* Booking type tabs */}
        <div className="flex gap-2 mb-3 mt-6 sticky top-[104px] z-10 bg-[#FFFFFF] py-2">
          {([
            { value: 'all', label: 'All Bookings' },
            { value: 'painting', label: 'Painting' },
            { value: 'baby-prints', label: 'Baby Prints' },
            { value: 'party', label: 'Party' },
          ] as const).map(({ value, label }) => {
            const count = value === 'all' ? scopedInquiries.length
              : value === 'painting' ? scopedInquiries.filter(i => ['painting', 'sip-and-paint'].includes(i.sessionType || '')).length
              : value === 'baby-prints' ? scopedInquiries.filter(i => i.sessionType === 'clay-imprints').length
              : scopedInquiries.filter(i => ['birthday-party','baby-shower-hen','corporate'].includes(i.sessionType || '')).length;
            return (
              <button
                key={value}
                onClick={() => setBookingTypeTab(value)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                  bookingTypeTab === value
                    ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C]'
                    : 'bg-white text-[#1B2D3C]/60 border-[#1B2D3C]/20 hover:text-[#1B2D3C] hover:border-[#1B2D3C]/40'
                }`}
              >
                {label}
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                  bookingTypeTab === value ? 'bg-white/20 text-[#1B2D3C]' : 'bg-[#1B2D3C]/10 text-[#1B2D3C]/70'
                }`}>{count}</span>
              </button>
            );
          })}
        </div>
        {/* Bookings toolbar — all filters in one row */}
        <div className="flex flex-wrap items-center gap-2 mb-4 sticky top-[148px] z-10 bg-[#FFFFFF] py-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <input
              type="text"
              placeholder="Search name, email or phone…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-8 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-semibold rounded-lg focus:outline-none focus:border-[#1B2D3C]/40 bg-white"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#1B2D3C]/30 hover:text-[#1B2D3C] cursor-pointer">×</button>
            )}
          </div>
          {/* Status filter */}
          <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
            {([['all','All'],['pending','Awaiting'],['confirmed','Confirmed'],['seated','Seated'],['completed','Complete'],['cancelled','Cancelled']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)}
                className={`px-3 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                  filter === val ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                }`}>{label}</button>
            ))}
          </div>
          {/* Studio filter — only show for super admin */}
          {!staffAllowedStudios && (
            <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
              {([['all','All Studios'],['Putney','Putney'],['Wimbledon','Wimbledon']] as const).map(([val, label]) => (
                <button key={val} onClick={() => setStudioFilter(val)}
                  className={`px-3 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                    studioFilter === val ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                  }`}>{label}</button>
              ))}
            </div>
          )}
          {/* Date range */}
          <input type="date" value={dateRange.start}
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="px-2 py-2 border border-[#1B2D3C]/20 text-[10px] text-[#1B2D3C] font-semibold rounded-lg focus:outline-none bg-white" aria-label="From date" />
          <span className="text-[#1B2D3C]/30 text-xs">→</span>
          <input type="date" value={dateRange.end}
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="px-2 py-2 border border-[#1B2D3C]/20 text-[10px] text-[#1B2D3C] font-semibold rounded-lg focus:outline-none bg-white" aria-label="To date" />
          {/* Export */}
          <button onClick={exportToCSV}
            className="ml-auto px-3 py-2 border border-[#1B2D3C]/20 text-[10px] font-bold text-[#1B2D3C] rounded-lg hover:bg-[#DBE7E4] transition-all cursor-pointer">
            Export CSV
          </button>
          <button onClick={exportCollectionStats}
            className="px-3 py-2 border border-[#1B2D3C]/20 text-[10px] font-bold text-[#1B2D3C] rounded-lg hover:bg-[#DBE7E4] transition-all cursor-pointer">
            Collection Stats CSV
          </button>
        </div>


        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-[#DBE7E4] text-[#1B2D3C] rounded-xl">
            <span className="text-xs font-black">{selectedIds.size} selected</span>
            <div className="flex-1" />
            {canUpdateStatus && (
              <>
                <button
                  onClick={async () => {
                    const ids = [...selectedIds].filter(id => inquiries.find(i => i.id === id)?.status !== 'confirmed');
                    for (const id of ids) await updateStatus(id, 'confirmed');
                    setSelectedIds(new Set());
                  }}
                  className="px-4 py-2 sm:px-3 sm:py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5 min-h-[44px]"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Confirm All
                </button>
                <button
                  onClick={async () => {
                    const ids = [...selectedIds].filter(id => inquiries.find(i => i.id === id)?.status !== 'cancelled');
                    for (const id of ids) await updateStatus(id, 'cancelled');
                    setSelectedIds(new Set());
                  }}
                  className="px-4 py-2 sm:px-3 sm:py-1.5 bg-red-500 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5 min-h-[44px]"
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel All
                </button>
              </>
            )}
            <button
              onClick={() => {
                const rows = filteredInquiries.filter(i => selectedIds.has(i.id));
                const csv = ['Date,Time,Studio,Name,Email,Phone,Seats,Session,Status,Table',
                  ...rows.map(i => [i.date,i.time,i.studio,i.name,i.email,i.phone,i.paintersCount,i.sessionType,i.status,i.tableId||''].join(','))
                ].join('\n');
                const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='bookings-selection.csv'; a.click();
              }}
              className="px-4 py-2 sm:px-3 sm:py-1.5 bg-white/20 hover:bg-white/30 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer min-h-[44px]"
            >
              Export CSV
            </button>
            {canDelete && (
              <button
                onClick={() => {
                  const count = selectedIds.size;
                  showConfirmDialog({
                    title: `Delete ${count} booking${count !== 1 ? 's' : ''}?`,
                    message: `This will permanently delete ${count} booking${count !== 1 ? 's' : ''}. This cannot be undone.`,
                    confirmLabel: `Delete ${count}`,
                    variant: 'danger',
                    onConfirm: async () => {
                      closeConfirmDialog();
                      const ids = [...selectedIds];
                      const idsSet = new Set(ids);
                      let deleted = 0;
                      for (const id of ids) {
                        try {
                          await deleteBooking(id, staff);
                          deleted++;
                        } catch { /* continue */ }
                      }
                      setInquiries(prev => prev.filter(i => !idsSet.has(i.id)));
                      setSelectedIds(new Set());
                      showToast(`${deleted} booking${deleted !== 1 ? 's' : ''} deleted`, 'success');
                    },
                  });
                }}
                className="px-4 py-2 sm:px-3 sm:py-1.5 bg-red-500 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5 min-h-[44px]"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            <button onClick={() => setSelectedIds(new Set())} className="text-white/60 hover:text-white text-xs cursor-pointer">✕ Clear</button>
          </div>
        )}

        {/* Bookings count */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-[#1B2D3C]/50">
            {filteredInquiries.length} booking{filteredInquiries.length !== 1 ? 's' : ''}
            {filter !== 'all' || studioFilter !== 'all' || searchTerm || dateRange.start ? ' (filtered)' : ''}
          </p>
          {lastUpdated && (
            <p className="text-[10px] font-medium text-[#1B2D3C]/40">
              Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <div className="bg-white border border-[#1B2D3C]/20 shadow-sm overflow-hidden rounded-xl">
          {filteredInquiries.length === 0 ? (
            <div className="p-10 sm:p-14 text-center">
              <Inbox className="w-10 h-10 text-stone-300 mx-auto mb-3" />
              <p className="text-sm text-stone-500 font-semibold">No bookings found</p>
              <p className="text-xs text-stone-400 mt-1">Adjust your filters or add a new booking</p>
            </div>
          ) : (
            <>
              {/* ── Mobile cards (< md) ── */}
              <div className="md:hidden divide-y divide-[#1B2D3C]/10">
                {paginatedInquiries.map((inq) => (
                  <div key={inq.id}
                    onClick={() => setDrawerBooking(inq)}
                    className={`p-4 space-y-2 cursor-pointer transition-colors ${selectedIds.has(inq.id) ? 'bg-[#D6E2E9]/30' : 'hover:bg-stone-50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(inq.id)}
                          onChange={e => setSelectedIds(prev => { const s = new Set(prev); e.target.checked ? s.add(inq.id) : s.delete(inq.id); return s; })}
                          className="w-4 h-4 accent-[#1B2D3C] shrink-0 cursor-pointer" />
                        <div className="min-w-0">
                          <p className="text-sm font-black text-[#1B2D3C] truncate">{inq.name}</p>
                          <a href={`tel:${inq.phone}`} onClick={e => e.stopPropagation()} className="text-[11px] text-[#1B2D3C]/50 font-semibold hover:text-[#1B2D3C] hover:underline">{inq.phone}</a>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black uppercase tracking-wider rounded-full ${
                          inq.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : inq.status === 'cancelled' ? 'bg-red-100 text-red-700' : inq.status === 'seated' ? 'bg-amber-100 text-amber-800' : inq.status === 'completed' ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {inq.status === 'confirmed' ? <CheckCircle className="w-3 h-3" /> : inq.status === 'cancelled' ? <XCircle className="w-3 h-3" /> : inq.status === 'seated' ? <Users className="w-3 h-3" /> : inq.status === 'completed' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {inq.status === 'confirmed' ? 'Confirmed' : inq.status === 'cancelled' ? 'Cancelled' : inq.status === 'seated' ? 'Seated' : inq.status === 'completed' ? 'Complete' : 'Awaiting'}
                        </span>
                        <button onClick={() => setDrawerBooking(inq)} className="text-[#1B2D3C]/30 hover:text-[#1B2D3C] text-base font-black cursor-pointer transition-colors">⋯</button>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap text-[11px] text-[#1B2D3C]/70 font-semibold">
                      <span className="font-black text-[#1B2D3C]">{inq.studio}</span>
                      <span>{inq.date ? format(parseISO(inq.date), 'dd MMM yyyy') : '—'}</span>
                      <span>{inq.time}</span>
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#D6E2E9] text-[#1B2D3C] rounded-full text-[10px] font-black"><Users className="w-2.5 h-2.5" />{inq.paintersCount}</span>
                      {inq.source === 'walk-in' && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold">Walk-in</span>}
                      {inq.source === 'block' && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">Block</span>}
                      {tablePlanEnabled && inq.tableId && <span className="px-1.5 py-0.5 bg-[#DBE7E4] text-[#1B2D3C] rounded-full text-[10px] font-bold">{inq.tableId}</span>}
                    </div>
                    {inq.photos && inq.photos.length > 0 && (
                      <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                        {inq.photos.slice(0, 5).map((url, i) => (
                          <img key={i} src={url} alt={`Photo ${i + 1}`} className="w-12 h-12 object-cover rounded-md border border-[#1B2D3C]/10 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setDrawerBooking(inq)} />
                        ))}
                        {inq.photos.length > 5 && (
                          <div className="w-12 h-12 rounded-md border border-[#1B2D3C]/10 bg-[#D6E2E9] flex items-center justify-center text-[10px] font-black text-[#1B2D3C]/60">+{inq.photos.length - 5}</div>
                        )}
                      </div>
                    )}
                    {canUpdateStatus && inq.status !== 'cancelled' && (
                      <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                        {inq.status !== 'confirmed' && (
                          <button
                            onClick={() => updateStatus(inq.id, 'confirmed')}
                            disabled={confirmingIds.has(inq.id)}
                            className="flex-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black rounded-lg transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1"
                          >
                            <CheckCircle className="w-3 h-3" /> Confirm
                          </button>
                        )}
                        {inq.status !== 'pending' && inq.status !== 'confirmed' && (
                          <button
                            onClick={() => updateStatus(inq.id, 'pending')}
                            disabled={confirmingIds.has(inq.id)}
                            className="flex-1 px-2 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-black rounded-lg transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1"
                          >
                            <Clock className="w-3 h-3" /> Awaiting
                          </button>
                        )}
                        <button
                          onClick={() => updateStatus(inq.id, 'cancelled')}
                          disabled={confirmingIds.has(inq.id)}
                          className="flex-1 px-2 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-[10px] font-black rounded-lg transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1"
                        >
                          <XCircle className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Desktop table (>= md) ── */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="bg-[#D6E2E9] border-b border-[#1B2D3C]/20">
                    <tr>
                      <th className="px-4 py-3">
                        <input type="checkbox"
                          checked={paginatedInquiries.length > 0 && paginatedInquiries.every(i => selectedIds.has(i.id))}
                          onChange={e => {
                            if (e.target.checked) setSelectedIds(prev => new Set([...prev, ...paginatedInquiries.map(i => i.id)]));
                            else setSelectedIds(prev => { const s = new Set(prev); paginatedInquiries.forEach(i => s.delete(i.id)); return s; });
                          }}
                          className="w-4 h-4 accent-[#1B2D3C] cursor-pointer" />
                      </th>
                      <SortHeader field="added" label="Added" sort={sort} setSort={setSort} />
                      <SortHeader field="date" label="Date" sort={sort} setSort={setSort} />
                      <SortHeader field="name" label="Guest" sort={sort} setSort={setSort} />
                      <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] hidden lg:table-cell">Session</th>
                      <SortHeader field="status" label="Status" sort={sort} setSort={setSort} />
                      {tablePlanEnabled && <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]">Table</th>}
                      <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedInquiries.map((inq) => (
                      <tr key={inq.id}
                        onClick={() => setDrawerBooking(inq)}
                        className={`border-b border-[#1B2D3C]/10 transition-colors cursor-pointer ${
                          selectedIds.has(inq.id) ? 'bg-[#D6E2E9]/30' : 'hover:bg-stone-50'
                        }`}>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(inq.id)}
                            onChange={e => setSelectedIds(prev => { const s = new Set(prev); e.target.checked ? s.add(inq.id) : s.delete(inq.id); return s; })}
                            className="w-4 h-4 accent-[#1B2D3C] cursor-pointer" />
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-black text-[#1B2D3C]">{inq.requestDate ? format(new Date(inq.requestDate), 'dd MMM yyyy, HH:mm') : '—'}</p>
                          <p className="text-[10px] text-[#1B2D3C]/50 font-semibold">{inq.studio}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-black text-[#1B2D3C]">{inq.date ? format(parseISO(inq.date), 'dd MMM yyyy') : '—'}</p>
                          <p className="text-[10px] text-[#1B2D3C]/50 font-semibold">{inq.time}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs font-black text-[#1B2D3C]">{inq.name}</p>
                          <a href={`mailto:${inq.email}`} onClick={e => e.stopPropagation()} className="text-[10px] text-[#1B2D3C]/50 font-semibold hidden lg:block hover:text-[#1B2D3C] hover:underline">{inq.email}</a>
                          <a href={`tel:${inq.phone}`} onClick={e => e.stopPropagation()} className="text-[10px] text-[#1B2D3C]/50 font-semibold hover:text-[#1B2D3C] hover:underline">{inq.phone}</a>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#D6E2E9] text-[#1B2D3C] rounded-full text-[10px] font-black"><Users className="w-2.5 h-2.5" />{inq.paintersCount}</span>
                            {inq.source === 'walk-in' && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold">Walk-in</span>}
                      {inq.source === 'block' && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">Block</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${SESSION_BADGE[inq.sessionType] ?? 'bg-gray-100 text-gray-600'}`}>
                            {SESSION_LABELS[inq.sessionType] ?? inq.sessionType}
                          </span>
                          {inq.photos && inq.photos.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {inq.photos.slice(0, 3).map((url, i) => (
                                <img key={i} src={url} alt={`Photo ${i + 1}`} className="w-10 h-10 object-cover rounded-md border border-[#1B2D3C]/10" />
                              ))}
                              {inq.photos.length > 3 && (
                                <div className="w-10 h-10 rounded-md border border-[#1B2D3C]/10 bg-[#D6E2E9] flex items-center justify-center text-[9px] font-black text-[#1B2D3C]/60">+{inq.photos.length - 3}</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black uppercase tracking-wider rounded-full ${
                            inq.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800'
                              : inq.status === 'cancelled' ? 'bg-red-100 text-red-700'
                              : inq.status === 'seated' ? 'bg-amber-100 text-amber-800'
                              : inq.status === 'completed' ? 'bg-teal-100 text-teal-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {inq.status === 'confirmed' ? <CheckCircle className="w-3 h-3" /> : inq.status === 'cancelled' ? <XCircle className="w-3 h-3" /> : inq.status === 'seated' ? <Users className="w-3 h-3" /> : inq.status === 'completed' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                            {inq.status === 'confirmed' ? 'Confirmed' : inq.status === 'cancelled' ? 'Cancelled' : inq.status === 'seated' ? 'Seated' : inq.status === 'completed' ? 'Complete' : 'Awaiting'}
                          </span>
                        </td>
                        {tablePlanEnabled && (
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <button onClick={() => setAssignModalBooking(inq)}
                              className={`px-2 py-1 text-[10px] font-bold border transition-all cursor-pointer rounded-lg ${
                                inq.tableId ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C] hover:bg-[#D6E2E9]' : 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                              }`}>
                              {inq.tableId ?? (inq.studio === 'Wimbledon' && inq.status !== 'cancelled' && inq.status !== 'no_show' ? '⚠ No table' : 'Assign')}
                            </button>
                          </td>
                        )}
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            {canUpdateStatus && inq.status !== 'confirmed' && inq.status !== 'cancelled' && (
                              <button
                                onClick={() => updateStatus(inq.id, 'confirmed')}
                                disabled={confirmingIds.has(inq.id)}
                                title="Confirm"
                                className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all cursor-pointer disabled:opacity-60"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canUpdateStatus && inq.status === 'confirmed' && (
                              <button
                                onClick={() => updateStatus(inq.id, 'pending')}
                                disabled={confirmingIds.has(inq.id)}
                                title="Mark as awaiting"
                                className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg transition-all cursor-pointer disabled:opacity-60"
                              >
                                <Clock className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canUpdateStatus && inq.status !== 'cancelled' && (
                              <button
                                onClick={() => updateStatus(inq.id, 'cancelled')}
                                disabled={confirmingIds.has(inq.id)}
                                title="Cancel"
                                className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg transition-all cursor-pointer disabled:opacity-60"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={() => setDrawerBooking(inq)} className="text-[#1B2D3C]/30 hover:text-[#1B2D3C] text-base font-black ml-1 cursor-pointer transition-colors">⋯</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {filteredInquiries.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#1B2D3C]/10 bg-white">
              <span className="text-xs font-semibold text-[#1B2D3C]/70">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredInquiries.length)} of {filteredInquiries.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 sm:px-3 sm:py-1 text-xs font-bold uppercase tracking-wider border border-[#1B2D3C]/20 rounded hover:bg-[#D6E2E9] disabled:opacity-50 cursor-pointer min-h-[44px]"
                >
                  Previous
                </button>
                <span className="text-xs font-bold text-[#1B2D3C]">{currentPage} / {totalPages}</span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 sm:px-3 sm:py-1 text-xs font-bold uppercase tracking-wider border border-[#1B2D3C]/20 rounded hover:bg-[#D6E2E9] disabled:opacity-50 cursor-pointer min-h-[44px]"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
          </>
        )}

        {activeTab === 'floor-plan' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 bg-white border border-[#1B2D3C]/10 p-4 rounded-xl">
              <h2 className="font-heading text-lg font-black text-[#1B2D3C] mr-2">Floor Plan</h2>
              {(() => {
                // Only offer a local studio picker while the global switcher is on "All Locations"
                return studioFilter === 'all' && visibleStudios.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold uppercase text-[#1B2D3C]/60">Studio</label>
                    <select
                      value={effectiveFloorPlanStudio}
                      onChange={(e) => setFloorPlanStudio(e.target.value as 'Putney' | 'Wimbledon')}
                      className="px-3 py-2 border border-[#1B2D3C]/20 rounded-lg text-xs font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/50 cursor-pointer"
                    >
                      {visibleStudios.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                ) : null;
              })()}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold uppercase text-[#1B2D3C]/60">Date</label>
                <input
                  type="date"
                  value={floorPlanDate}
                  onChange={(e) => setFloorPlanDate(e.target.value)}
                  className="px-3 py-2 border border-[#1B2D3C]/20 rounded-lg text-xs font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/50"
                />
                <button
                  onClick={() => setFloorPlanDate(new Date().toISOString().split('T')[0])}
                  className="px-2.5 py-2 text-[10px] font-bold text-[#1B2D3C]/70 border border-[#1B2D3C]/20 rounded-lg hover:bg-[#DBE7E4] cursor-pointer"
                >
                  Today
                </button>
              </div>
              <p className="text-[10px] text-[#1B2D3C]/40 font-semibold ml-auto">Click a table or chip for details · click an unassigned booking then a table (or drag) to assign</p>
            </div>
            <div className="bg-white border border-[#1B2D3C]/10 p-4 rounded-xl overflow-x-auto">
              {effectiveFloorPlanStudio === 'Wimbledon' ? (
                <WimbledonFloorPlan
                  bookings={scopedInquiries}
                  selectedDate={floorPlanDate}
                  readOnly
                  onMoveBooking={(bookingId, tableId) => updateBookingTable(bookingId, tableId)}
                  onSeatBooking={canUpdateStatus ? (bookingId) => updateStatus(bookingId, 'seated') : undefined}
                  onBlockStudio={canEdit ? (s, e, l) => handleBlockStudio('Wimbledon', floorPlanDate, s, e, l) : undefined}
                />
              ) : (
                <PutneyFloorPlan
                  bookings={scopedInquiries}
                  selectedDate={floorPlanDate}
                  readOnly
                  onMoveBooking={(bookingId, tableId) => updateBookingTable(bookingId, tableId)}
                  onSeatBooking={canUpdateStatus ? (bookingId) => updateStatus(bookingId, 'seated') : undefined}
                  onBlockStudio={canEdit ? (s, e, l) => handleBlockStudio('Putney', floorPlanDate, s, e, l) : undefined}
                />
              )}
            </div>
          </div>
        )}

        {/* Settings tab — Staff + Capacity + Stripe + Page Visibility + Table Plan */}
        {activeTab === 'settings' && canManageStaff && (
          <>
          <div className="flex items-center gap-2 flex-wrap mb-4 sticky top-[104px] z-10 bg-[#FFFFFF] py-2">
            <span className="text-xs font-bold text-[#1B2D3C]/40">Settings</span>
            <span className="text-xs text-[#1B2D3C]/30">›</span>
            {['Staff', 'Capacity', 'Time Slots', 'Closures', 'Stripe', 'Pages', 'Table Plan', 'Notifications'].map((section) => (
              <a
                key={section}
                href={`#settings-${section.toLowerCase().replace(/\s+/g, '-')}`}
                className="px-2.5 py-1 text-[10px] font-bold text-[#1B2D3C]/60 hover:text-[#1B2D3C] hover:bg-[#DBE7E4] rounded transition-all cursor-pointer"
              >
                {section}
              </a>
            ))}
          </div>
          <div id="settings-staff" className="bg-white p-6 border border-[#1B2D3C]/20 shadow-sm scroll-mt-[140px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-lg font-black text-[#1B2D3C] uppercase tracking-wider">Staff Management</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleChangePassword(staff)}
                  className="px-4 py-2 bg-white text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" /> My Password
                </button>
                <button
                  onClick={() => { setShowStaffModal(true); }}
                  className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add Staff
                </button>
              </div>
            </div>
            {staffList.length > 0 ? (
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <table className="w-full text-left min-w-[500px]">
                  <thead>
                    <tr className="border-b border-[#1B2D3C]/10">
                      <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Name</th>
                      <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Username</th>
                      <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Role</th>
                      <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Studios</th>
                      <th className="text-[9px] font-bold uppercase tracking-wider text-[#1B2D3C] py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-semibold text-[#1B2D3C]">
                    {staffList.map((member) => (
                      <tr key={member.id} className="border-b border-[#1B2D3C]/5">
                        <td className="py-2">{member.name}</td>
                        <td className="py-2">{member.username}</td>
                        <td className="py-2">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                            member.role === 'super_admin' ? 'bg-purple-100 text-purple-700' : 'bg-stone-100 text-stone-600'
                          }`}>
                            {roleLabel[member.role]}
                          </span>
                        </td>
                        <td className="py-2">
                          {member.role === 'super_admin' ? (
                            <span className="text-[10px] text-purple-600 font-bold">All</span>
                          ) : member.allowedStudios && member.allowedStudios.length > 0 ? (
                            <div className="flex gap-1">
                              {member.allowedStudios.map(s => (
                                <span key={s} className="px-1.5 py-0.5 bg-[#DBE7E4] text-[#1B2D3C] text-[9px] font-bold rounded">{s}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[10px] text-[#1B2D3C]/50 font-semibold">All</span>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEditStaff(member)}
                              className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] hover:text-[#486581] underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleChangePassword(member)}
                              className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] hover:text-[#486581] underline"
                            >
                              Password
                            </button>
                            <button
                              onClick={() => deleteStaffMember(member.id)}
                              disabled={member.id === staff.id}
                              className={`text-[10px] font-bold uppercase tracking-wider ${
                                member.id === staff.id ? 'text-stone-400 cursor-not-allowed' : 'text-red-600 hover:text-red-700 underline'
                              }`}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-stone-500 font-medium">No staff members loaded.</p>
            )}
          </div>
          </>
        )}
      </div>

      {/* Payment Details Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60] sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Stripe Payment</h3>
              <button onClick={() => setShowPaymentModal(false)} className="p-1.5 rounded-full hover:bg-[#D6E2E9] transition-colors cursor-pointer">
                <XIcon className="w-5 h-5 text-[#1B2D3C]/60" />
              </button>
            </div>
            {paymentDetailsLoading ? (
              <div className="py-8 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#1B2D3C]/40" />
              </div>
            ) : paymentDetailsError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 text-center">
                {paymentDetailsError}
              </div>
            ) : paymentDetails && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-full ${
                    paymentDetails.refunded ? 'bg-red-100 text-red-700'
                    : paymentDetails.status === 'succeeded' ? 'bg-emerald-100 text-emerald-700'
                    : paymentDetails.status === 'requires_payment_method' || paymentDetails.status === 'canceled' ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
                  }`}>
                    {paymentDetails.refunded ? 'Refunded' : paymentDetails.status === 'succeeded' ? 'Succeeded' : paymentDetails.status.replace(/_/g, ' ')}
                  </span>
                  {!paymentDetails.livemode && (
                    <span className="px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded bg-amber-50 text-amber-700 border border-amber-200">Test mode</span>
                  )}
                </div>
                <div className="text-center py-3 bg-[#F8FAFA] rounded-lg">
                  <p className="font-heading text-3xl font-black text-[#1B2D3C]">
                    £{(paymentDetails.amountReceived ?? paymentDetails.amount ?? 0).toFixed(2)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-[#1B2D3C]/50 mt-1">
                    {paymentDetails.paymentType === 'party_deposit' ? 'Party deposit'
                      : paymentDetails.paymentType === 'party_final_balance' ? 'Party final balance'
                      : paymentDetails.description || 'Payment'}
                  </p>
                </div>
                <div className="space-y-2 text-xs font-semibold text-[#1B2D3C]">
                  {paymentDetails.created && (
                    <div className="flex justify-between">
                      <span className="text-[#1B2D3C]/50">Paid</span>
                      <span>{new Date(paymentDetails.created).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                  )}
                  {(paymentDetails.cardBrand || paymentDetails.cardLast4) && (
                    <div className="flex justify-between">
                      <span className="text-[#1B2D3C]/50">Card</span>
                      <span className="capitalize">{paymentDetails.cardBrand} ···· {paymentDetails.cardLast4}</span>
                    </div>
                  )}
                  {paymentDetails.paymentMethod && paymentDetails.paymentMethod !== 'card' && (
                    <div className="flex justify-between">
                      <span className="text-[#1B2D3C]/50">Method</span>
                      <span className="capitalize">{paymentDetails.paymentMethod.replace(/_/g, ' ')}</span>
                    </div>
                  )}
                  {paymentDetails.amountRefunded > 0 && (
                    <div className="flex justify-between text-red-700">
                      <span>Refunded</span>
                      <span>−£{paymentDetails.amountRefunded.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-[#1B2D3C]/50 shrink-0">Reference</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(paymentDetails.id); showToast('Copied', 'success'); }}
                      className="font-mono text-[10px] break-all text-right hover:text-[#1B2D3C]/70 cursor-pointer"
                      title="Click to copy"
                    >{paymentDetails.id}</button>
                  </div>
                </div>
                {paymentDetails.receiptUrl && (
                  <a
                    href={paymentDetails.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] bg-[#DBE7E4] rounded-lg hover:bg-[#D6E2E9] transition-all"
                  >
                    View receipt
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Booking Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Add Booking</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-full hover:bg-[#D6E2E9] transition-colors cursor-pointer">
                <XIcon className="w-5 h-5 text-[#1B2D3C]/60" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Studio *</label>
                <select
                  value={newBooking.studio}
                  onChange={(e) => setNewBooking({ ...newBooking, studio: e.target.value as 'Putney' | 'Wimbledon' })}
                  disabled={!!staffAllowedStudios && staffAllowedStudios.length === 1}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {(staffAllowedStudios ?? ['Putney', 'Wimbledon']).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Date *</label>
                <input
                  type="date"
                  min={newCollectionStage === 'none' ? format(new Date(), 'yyyy-MM-dd') : undefined}
                  value={newBooking.date}
                  onChange={(e) => setNewBooking({ ...newBooking, date: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Collection Stage</label>
                <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
                  {(['none', 'painted', 'ready', 'collected'] as const).map((stage) => {
                    const labels: Record<string, string> = { none: 'New Booking', painted: 'Painted', ready: 'Ready to Collect', collected: 'Collected' };
                    return (
                      <button key={stage} type="button"
                        onClick={() => setNewCollectionStage(stage)}
                        className={`flex-1 px-2 py-2 text-[9px] font-bold transition-all cursor-pointer ${
                          newCollectionStage === stage ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                        }`}
                      >{labels[stage]}</button>
                    );
                  })}
                </div>
                {newCollectionStage !== 'none' && (
                  <p className="text-[9px] text-amber-700 font-semibold mt-1">Back-dating allowed — booking will be created as completed.</p>
                )}
              </div>
              {lockedSessionType === 'party-group' ? (
                <div>
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Party Type *</label>
                  <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
                    {(['birthday-party','baby-shower-hen','corporate'] as const).map((t) => {
                      const labels: Record<string,string> = { 'birthday-party': 'Birthday', 'baby-shower-hen': 'Baby Shower / Hen', 'corporate': 'Corporate' };
                      return (
                        <button key={t} type="button"
                          onClick={() => setNewBooking(prev => ({ ...prev, sessionType: t, time: undefined }))}
                          className={`flex-1 px-2 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                            newBooking.sessionType === t ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                          }`}>{labels[t]}</button>
                      );
                    })}
                  </div>
                </div>
              ) : lockedSessionType ? (
                <div className="px-3 py-2 rounded-lg bg-[#DBE7E4]/50 border border-[#1B2D3C]/10 text-xs font-bold text-[#1B2D3C]">
                  Session: {{
                    'painting': 'Painting',
                    'birthday-party': 'Birthday Party',
                    'baby-shower-hen': 'Baby Shower / Hen Party',
                    'corporate': 'Corporate Event',
                    'clay-imprints': 'Baby Prints',
                    'sip-and-paint': 'Sip & Paint',
                  }[lockedSessionType] ?? lockedSessionType}
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Session Type *</label>
                  <select
                    value={newBooking.sessionType}
                    onChange={(e) => setNewBooking({ ...newBooking, sessionType: e.target.value as BookingInquiry['sessionType'], time: undefined })}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  >
                    <option value="painting">Painting</option>
                    <option value="birthday-party">Birthday Party</option>
                    <option value="baby-shower-hen">Baby Shower / Hen Party</option>
                    <option value="corporate">Corporate Event</option>
                    <option value="clay-imprints">Baby Prints</option>
                    <option value="exclusive-hire">Exclusive Hire (Private / Evening)</option>
                    <option value="sip-and-paint">Sip & Paint</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Time *</label>
                {newBooking.sessionType === 'exclusive-hire' ? (
                  <input
                    type="time"
                    value={newBooking.time || ''}
                    onChange={(e) => setNewBooking({ ...newBooking, time: e.target.value })}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                ) : (
                  <select
                    value={newBooking.time}
                    onChange={(e) => setNewBooking({ ...newBooking, time: e.target.value })}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  >
                    {(() => {
                      const sType = newBooking.sessionType || 'painting';
                      const slotKey: SlotSessionType = ['birthday-party','baby-shower-hen','corporate'].includes(sType) ? 'party' : sType === 'clay-imprints' ? 'baby-prints' : sType === 'sip-and-paint' ? 'sip-and-paint' : 'painting';
                      const dt: DayType = newBooking.date ? ((d => d === 0 || d === 6)(getDay(parseISO(newBooking.date))) ? 'weekend' : 'weekday') : 'weekday';
                      return getSlots(slotKey, newBooking.studio || 'Putney', dt).map(s => <option key={s} value={s}>{s}</option>);
                    })()}
                  </select>
                )}
                {newBooking.sessionType === 'exclusive-hire' && (
                  <p className="text-[10px] text-[#1B2D3C]/50 mt-1">Choose any time for private/evening sessions.</p>
                )}
              </div>
              {newBooking.date && newBooking.time && (
                <>
                  {newBookingConflict ? (
                    <div className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 bg-red-50 text-red-700 border border-red-200">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      {newBookingConflict}
                    </div>
                  ) : (
                    <div className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                      capacityLoading ? 'bg-[#D6E2E9]/30 text-[#1B2D3C]/60' :
                      newBookingCapacity !== null && newBookingCapacity <= 0 ? 'bg-red-50 text-red-700 border border-red-200' :
                      newBookingCapacity !== null && newBookingCapacity <= 5 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      <Users className="w-3.5 h-3.5" />
                      {capacityLoading ? 'Checking capacity...' :
                       newBookingCapacity !== null ? `${newBookingCapacity} spots remaining` : 'Unable to check capacity'}
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Name *</label>
                <input
                  type="text"
                  value={newBooking.name}
                  onChange={(e) => setNewBooking({ ...newBooking, name: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Email</label>
                <input
                  type="email"
                  value={newBooking.email}
                  onChange={(e) => setNewBooking({ ...newBooking, email: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Phone</label>
                <input
                  type="tel"
                  value={newBooking.phone}
                  onChange={(e) => setNewBooking({ ...newBooking, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              {newBooking.sessionType === 'clay-imprints' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Babies *</label>
                    <div className="flex items-center border border-[#1B2D3C]/20 rounded-lg overflow-hidden">
                      <button type="button" onClick={() => setNewBabiesCount(c => Math.max(1, c - 1))} className="px-3 py-2 text-sm font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer">−</button>
                      <span className="flex-1 text-center text-xs font-black text-[#1B2D3C]">{newBabiesCount}</span>
                      <button type="button" onClick={() => setNewBabiesCount(c => c + 1)} className="px-3 py-2 text-sm font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer">+</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Adults</label>
                    <div className="flex items-center border border-[#1B2D3C]/20 rounded-lg overflow-hidden">
                      <button type="button" onClick={() => setNewAdultsCount(c => Math.max(0, c - 1))} className="px-3 py-2 text-sm font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer">−</button>
                      <span className="flex-1 text-center text-xs font-black text-[#1B2D3C]">{newAdultsCount}</span>
                      <button type="button" onClick={() => setNewAdultsCount(c => c + 1)} className="px-3 py-2 text-sm font-black text-[#1B2D3C] hover:bg-[#D6E2E9]/40 cursor-pointer">+</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Seats *</label>
                  <input
                    type="number"
                    value={newBooking.paintersCount ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setNewBooking({ ...newBooking, paintersCount: undefined });
                      } else {
                        const parsed = parseInt(val, 10);
                        if (!isNaN(parsed) && parsed >= 0) {
                          setNewBooking({ ...newBooking, paintersCount: parsed });
                        }
                      }
                    }}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={newBooking.notes ?? ''}
                  onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
                  placeholder="Allergies, special requests, etc."
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 resize-none"
                />
              </div>
              {['birthday-party', 'baby-shower-hen', 'corporate'].includes(newBooking.sessionType || '') && (
                <div className="space-y-3 p-3 rounded-lg bg-[#F8FAFA] border border-[#1B2D3C]/10">
                  <div>
                    <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1.5">Deposit Payment</label>
                    <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
                      <button type="button"
                        onClick={() => setNewBookingPaymentMethod('payment-link')}
                        className={`flex-1 px-3 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                          newBookingPaymentMethod === 'payment-link' ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                        }`}
                      >
                        Email Payment Link
                      </button>
                      <button type="button"
                        onClick={() => setNewBookingPaymentMethod('paid')}
                        className={`flex-1 px-3 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                          newBookingPaymentMethod === 'paid' ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                        }`}
                      >
                        Mark as Paid
                      </button>
                    </div>
                  </div>
                  {newBookingPaymentMethod === 'paid' && (
                    <>
                      <div>
                        <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Deposit Amount (£)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newBookingDepositAmount}
                          onChange={(e) => setNewBookingDepositAmount(e.target.value)}
                          className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1.5">Final Payment Status</label>
                        <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
                          <button type="button"
                            onClick={() => setNewBookingFinalPending(true)}
                            className={`flex-1 px-3 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                              newBookingFinalPending ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                            }`}
                          >
                            Still Needs Final Payment
                          </button>
                          <button type="button"
                            onClick={() => setNewBookingFinalPending(false)}
                            className={`flex-1 px-3 py-2 text-[10px] font-bold transition-all cursor-pointer ${
                              !newBookingFinalPending ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                            }`}
                          >
                            Fully Paid
                          </button>
                        </div>
                      </div>
                      <div className="text-[10px] text-[#1B2D3C]/60 font-semibold">
                        Total: £{((newBooking.paintersCount || 1) * partyPrice).toFixed(2)} · Deposit: £{(Number(newBookingDepositAmount) || 0).toFixed(2)} · Balance: £{Math.max(0, (newBooking.paintersCount || 1) * partyPrice - (Number(newBookingDepositAmount) || 0)).toFixed(2)}
                      </div>
                    </>
                  )}
                  {newBookingPaymentMethod === 'payment-link' && (
                    <p className="text-[10px] text-[#1B2D3C]/60 font-semibold">
                      A £50 Stripe deposit link will be emailed to the customer.{!newBooking.email && ' No email address entered — the link cannot be sent.'} Remaining balance of £{Math.max(0, (newBooking.paintersCount || 1) * partyPrice - 50).toFixed(2)} is payable on the day.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddModal(false); setLockedSessionType(null); setNewCollectionStage('none'); }}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={saveNewBooking}
                className="flex-1 px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Add Booking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Walk-in / Ghost Booking Modal */}
      {showGhostModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-sm w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Quick Walk-in</h3>
              <button onClick={() => setShowGhostModal(false)} className="p-1.5 rounded-full hover:bg-[#D6E2E9] transition-colors cursor-pointer">
                <XIcon className="w-5 h-5 text-[#1B2D3C]/60" />
              </button>
            </div>
            <p className="text-[10px] text-[#1B2D3C]/60 font-semibold">Blocks seats from now for a 2-hour session — for walk-in painters.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Studio *</label>
                <select
                  value={ghostBooking.studio}
                  onChange={(e) => setGhostBooking({ ...ghostBooking, studio: e.target.value as 'Putney' | 'Wimbledon' })}
                  disabled={!!staffAllowedStudios && staffAllowedStudios.length === 1}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {(staffAllowedStudios ?? ['Putney', 'Wimbledon']).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Seats *</label>
                <input
                  type="number"
                  value={ghostBooking.seats ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setGhostBooking({ ...ghostBooking, seats: 0 });
                    } else {
                      const parsed = parseInt(val, 10);
                      if (!isNaN(parsed) && parsed >= 0) {
                        setGhostBooking({ ...ghostBooking, seats: parsed });
                      }
                    }
                  }}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              {ghostBooking.studio && (
                <>
                  {ghostConflict ? (
                    <div className="px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 bg-red-50 text-red-700 border border-red-200">
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      {ghostConflict}
                    </div>
                  ) : (
                    <div className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                      capacityLoading ? 'bg-[#D6E2E9]/30 text-[#1B2D3C]/60' :
                      ghostCapacity !== null && ghostCapacity <= 0 ? 'bg-red-50 text-red-700 border border-red-200' :
                      ghostCapacity !== null && ghostCapacity <= 5 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      <Users className="w-3.5 h-3.5" />
                      {capacityLoading ? 'Checking capacity...' :
                       ghostCapacity !== null ? `${ghostCapacity} spots remaining` : 'Unable to check capacity'}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowGhostModal(false)}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={saveGhostBooking}
                className="flex-1 px-4 py-2 bg-[#1B2D3C] text-white font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#486581] transition-all cursor-pointer"
              >
                Block Seats
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Studio Modal — reserves every table for the window so online bookings are refused */}
      {showBlockModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-sm w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Block Studio</h3>
              <button onClick={() => setShowBlockModal(false)} className="p-1.5 rounded-full hover:bg-[#D6E2E9] transition-colors cursor-pointer">
                <XIcon className="w-5 h-5 text-[#1B2D3C]/60" />
              </button>
            </div>
            <p className="text-[10px] text-[#1B2D3C]/60 font-semibold">
              Reserves every table for the window — online bookings are refused. Cancel the block booking to unblock.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Studio *</label>
                <select
                  value={blockDraft.studio}
                  onChange={(e) => setBlockDraft({ ...blockDraft, studio: e.target.value as 'Putney' | 'Wimbledon' })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 bg-white"
                >
                  {(isSuperAdmin || !staff.allowedStudios?.length ? ['Putney', 'Wimbledon'] : staff.allowedStudios).map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Date *</label>
                <input
                  type="date"
                  value={blockDraft.date}
                  onChange={(e) => setBlockDraft({ ...blockDraft, date: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 bg-white"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">From *</label>
                  <input
                    type="time"
                    value={blockDraft.startTime}
                    onChange={(e) => setBlockDraft({ ...blockDraft, startTime: e.target.value })}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 bg-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">To *</label>
                  <input
                    type="time"
                    value={blockDraft.endTime}
                    onChange={(e) => setBlockDraft({ ...blockDraft, endTime: e.target.value })}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Label</label>
                <input
                  type="text"
                  value={blockDraft.label}
                  onChange={(e) => setBlockDraft({ ...blockDraft, label: e.target.value })}
                  placeholder="Studio Block"
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <button
                onClick={async () => {
                  if (!blockDraft.date || !blockDraft.startTime || !blockDraft.endTime) { showToast('Date and times are required', 'error'); return; }
                  if (blockDraft.endTime <= blockDraft.startTime) { showToast('End time must be after start time', 'error'); return; }
                  await handleBlockStudio(blockDraft.studio, blockDraft.date, blockDraft.startTime, blockDraft.endTime, blockDraft.label.trim() || 'Studio Block');
                  setShowBlockModal(false);
                }}
                className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Block Studio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Booking Modal */}
      {showEditModal && editingBooking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Edit Booking</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Name</label>
                <input
                  type="text"
                  value={editingBooking.name}
                  onChange={(e) => setEditingBooking({ ...editingBooking, name: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Email</label>
                <input
                  type="email"
                  value={editingBooking.email}
                  onChange={(e) => setEditingBooking({ ...editingBooking, email: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Phone</label>
                <input
                  type="tel"
                  value={editingBooking.phone}
                  onChange={(e) => setEditingBooking({ ...editingBooking, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Session Type *</label>
                <select
                  value={editingBooking.sessionType}
                  onChange={(e) => setEditingBooking({ ...editingBooking, sessionType: e.target.value as BookingInquiry['sessionType'], time: undefined })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                >
                  <option value="painting">Painting</option>
                  <option value="sip-and-paint">Sip & Paint</option>
                  <option value="birthday-party">Birthday Party</option>
                  <option value="baby-shower-hen">Baby Shower / Hen Party</option>
                  <option value="corporate">Corporate Event</option>
                  <option value="clay-imprints">Baby Prints</option>
                  <option value="exclusive-hire">Exclusive Hire (Private / Evening)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Date</label>
                <input
                  type="date"
                  min={format(new Date(), 'yyyy-MM-dd')}
                  value={editingBooking.date}
                  onChange={(e) => setEditingBooking({ ...editingBooking, date: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Time</label>
                {editingBooking.sessionType === 'exclusive-hire' ? (
                  <input
                    type="time"
                    value={editingBooking.time || ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, time: e.target.value })}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                ) : (
                  <select
                    value={editingBooking.time}
                    onChange={(e) => setEditingBooking({ ...editingBooking, time: e.target.value })}
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  >
                    {(() => {
                      const sType = editingBooking.sessionType || 'painting';
                      const slotKey: SlotSessionType = ['birthday-party','baby-shower-hen','corporate'].includes(sType) ? 'party' : sType === 'clay-imprints' ? 'baby-prints' : sType === 'sip-and-paint' ? 'sip-and-paint' : 'painting';
                      const dt: DayType = editingBooking.date ? ((d => d === 0 || d === 6)(getDay(parseISO(editingBooking.date))) ? 'weekend' : 'weekday') : 'weekday';
                      const slots = getSlots(slotKey, editingBooking.studio || 'Putney', dt);
                      const existing = editingBooking.time;
                      const allSlots = existing && !slots.includes(existing) ? [existing, ...slots] : slots;
                      return allSlots.map(s => <option key={s} value={s}>{s}</option>);
                    })()}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Seats</label>
                <input
                  type="number"
                  min="1"
                                    value={editingBooking.paintersCount}
                  onChange={(e) => setEditingBooking({ ...editingBooking, paintersCount: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Customer Notes</label>
                <textarea
                  rows={2}
                  value={editingBooking.notes ?? ''}
                  onChange={(e) => setEditingBooking({ ...editingBooking, notes: e.target.value })}
                  placeholder="Allergies, special requests, etc."
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Staff Notes</label>
                <textarea
                  rows={2}
                  value={editingBooking.staffNotes ?? ''}
                  onChange={(e) => setEditingBooking({ ...editingBooking, staffNotes: e.target.value })}
                  placeholder="Internal notes — only visible to staff"
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 resize-none"
                />
              </div>
              {editingBooking.date && editingBooking.time && (
                <div className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                  capacityLoading ? 'bg-[#D6E2E9]/30 text-[#1B2D3C]/60' :
                  editBookingCapacity !== null && editBookingCapacity <= 0 ? 'bg-red-50 text-red-700 border border-red-200' :
                  editBookingCapacity !== null && editBookingCapacity <= 5 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                  'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  <Users className="w-3.5 h-3.5" />
                  {capacityLoading ? 'Checking capacity...' :
                   editBookingCapacity !== null ? `${editBookingCapacity} spots remaining` : 'Unable to check capacity'}
                </div>
              )}
            </div>

            {/* Photos Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider">Painting Photos</label>
                <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all ${
                  photoUploading
                    ? 'bg-[#D6E2E9]/40 text-[#1B2D3C]/50 cursor-wait'
                    : 'bg-[#DBE7E4] text-[#1B2D3C] hover:bg-[#D6E2E9]'
                }`}>
                  <Camera className="w-3.5 h-3.5" />
                  {photoUploading ? 'Uploading...' : 'Add Photos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    disabled={photoUploading}
                    className="hidden"
                  />
                </label>
              </div>
              {editingBooking.photos && editingBooking.photos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {editingBooking.photos.map((url, i) => (
                    <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-[#1B2D3C]/20 cursor-pointer" onClick={() => { setModalImages(editingBooking.photos!); setModalIndex(i); setModalPhotoTags(editingBooking.photoTags); }}>
                      <img src={url} alt={`Painting ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePhoto(i); }}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center transition-opacity cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-[#1B2D3C]/50 font-medium">No photos uploaded yet.</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => saveBookingEdit(editingBooking)}
                className="flex-1 px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Table Modal */}
      {tablePlanEnabled && assignModalBooking && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white border border-[#1B2D3C]/20 max-w-lg w-full shadow-xl rounded-xl overflow-hidden max-h-[90vh] flex flex-col sm:rounded-xl">
            <div className="px-6 py-4 border-b border-[#1B2D3C]/10 flex items-center justify-between">
              <div>
                <h3 className="font-heading text-lg font-black text-[#1B2D3C]">Assign Table</h3>
                <p className="text-[10px] text-[#1B2D3C]/60 font-semibold mt-0.5">
                  {assignModalBooking.name} · {assignModalBooking.date} · {assignModalBooking.time}
                </p>
              </div>
              <button onClick={() => setAssignModalBooking(null)} className="text-[#1B2D3C]/40 hover:text-[#1B2D3C] text-xl font-bold cursor-pointer">✕</button>
            </div>
            <div className="overflow-y-auto p-4 flex-1">
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={async () => {
                    const assigned = await autoAssignTable(assignModalBooking, false);
                    if (assigned) setAssignModalBooking(prev => prev ? { ...prev, tableId: assigned } : null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black rounded-lg transition-all cursor-pointer"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Auto-assign ({assignModalBooking.paintersCount} seats)
                </button>
                <span className="text-[10px] text-[#1B2D3C]/50 font-semibold">or click a table below</span>
              </div>
              {assignModalBooking.tableId && (
                <div className="mb-3 flex items-center justify-between bg-[#DBE7E4] text-[#1B2D3C] px-4 py-2 rounded-lg text-xs font-bold">
                  <span>Currently assigned: {assignModalBooking.tableId}</span>
                  <button
                    onClick={() => updateBookingTable(assignModalBooking.id, null)}
                    className="underline text-white/80 hover:text-white cursor-pointer"
                  >
                    Unassign
                  </button>
                </div>
              )}
              {assignModalBooking.studio === 'Wimbledon' ? (
                <WimbledonFloorPlan
                  bookings={inquiries}
                  selectedDate={assignModalBooking.date}
                  selectedTime={assignModalBooking.time}
                  highlightTableId={assignModalBooking.tableId}
                  onAssign={(tableId) => updateBookingTable(assignModalBooking.id, tableId)}
                />
              ) : (
                <PutneyFloorPlan
                  bookings={inquiries}
                  selectedDate={assignModalBooking.date}
                  selectedTime={assignModalBooking.time}
                  highlightTableId={assignModalBooking.tableId}
                  onAssign={(tableId) => updateBookingTable(assignModalBooking.id, tableId)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showStaffModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <h3 className="font-heading text-xl font-black text-[#1B2D3C]">{editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Name *</label>
                <input
                  type="text"
                  value={newStaff.name}
                  onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Username *</label>
                <input
                  type="text"
                  value={newStaff.username}
                  onChange={(e) => setNewStaff({ ...newStaff, username: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Password {editingStaff ? '(leave blank to keep current)' : '*'}</label>
                <input
                  type="password"
                  value={newStaff.password}
                  onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                  placeholder={editingStaff ? '••••••••' : ''}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Role *</label>
                <select
                  value={newStaff.role}
                  onChange={(e) => {
                    const role = e.target.value as Staff['role'];
                    if (role === 'super_admin') {
                      setNewStaff({
                        ...newStaff,
                        role,
                        canUpdateStatus: true,
                        canEditBookings: true,
                        canAddWalkIns: true,
                        canDeleteBookings: true,
                      });
                    } else {
                      setNewStaff({ ...newStaff, role });
                    }
                  }}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                >
                  <option value="staff">Staff</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              {newStaff.role === 'staff' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider">Studio Access *</label>
                    <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
                      {([
                        { label: 'Putney', value: ['Putney'] as ('Putney' | 'Wimbledon')[] },
                        { label: 'Wimbledon', value: ['Wimbledon'] as ('Putney' | 'Wimbledon')[] },
                        { label: 'Both', value: ['Putney', 'Wimbledon'] as ('Putney' | 'Wimbledon')[] },
                      ]).map(opt => {
                        const isSelected = opt.value.length === newStaff.allowedStudios.length &&
                          opt.value.every(v => newStaff.allowedStudios.includes(v));
                        return (
                          <button key={opt.label} type="button"
                            onClick={() => setNewStaff({ ...newStaff, allowedStudios: opt.value })}
                            className={`flex-1 py-2 text-xs font-bold transition-all cursor-pointer ${
                              isSelected ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                            }`}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider">Permission Presets</label>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { label: 'Manager', permissions: { canUpdateStatus: true, canEditBookings: true, canAddWalkIns: true, canDeleteBookings: true } },
                        { label: 'Front Desk', permissions: { canUpdateStatus: true, canEditBookings: false, canAddWalkIns: true, canDeleteBookings: false } },
                        { label: 'Studio Assistant', permissions: { canUpdateStatus: false, canEditBookings: false, canAddWalkIns: true, canDeleteBookings: false } },
                      ].map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setNewStaff({ ...newStaff, ...preset.permissions })}
                          className="px-3 py-1.5 text-[10px] font-bold border border-[#1B2D3C]/20 rounded-lg hover:bg-[#D6E2E9] transition-all cursor-pointer text-[#1B2D3C]"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider">Individual Permissions</label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newStaff.canUpdateStatus}
                      onChange={(e) => setNewStaff({ ...newStaff, canUpdateStatus: e.target.checked })}
                      className="w-4 h-4 accent-[#1B2D3C]"
                    />
                    Update booking status
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newStaff.canEditBookings}
                      onChange={(e) => setNewStaff({ ...newStaff, canEditBookings: e.target.checked })}
                      className="w-4 h-4 accent-[#1B2D3C]"
                    />
                    Edit bookings
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newStaff.canAddWalkIns}
                      onChange={(e) => setNewStaff({ ...newStaff, canAddWalkIns: e.target.checked })}
                      className="w-4 h-4 accent-[#1B2D3C]"
                    />
                    Add bookings
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newStaff.canDeleteBookings}
                      onChange={(e) => setNewStaff({ ...newStaff, canDeleteBookings: e.target.checked })}
                      className="w-4 h-4 accent-[#1B2D3C]"
                    />
                    Delete bookings
                  </label>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowStaffModal(false); setEditingStaff(null); }}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={addStaffMember}
                className="flex-1 px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                {editingStaff ? 'Save Changes' : 'Add Staff'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePasswordModal && passwordChangeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg sm:rounded-xl">
            <h3 className="font-heading text-xl font-black text-[#1B2D3C]">
              Change Password · {passwordChangeTarget.name}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">New Password *</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Confirm Password *</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowChangePasswordModal(false); setPasswordChangeTarget(null); setNewPassword(''); setConfirmPassword(''); }}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={submitPasswordChange}
                className="flex-1 px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Change Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Backup Modal */}
      {restoreModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Restore Backup</h3>
            <p className="text-xs text-[#1B2D3C]/70">
              Choose which tables to restore from <span className="font-bold">{restoreModal.name}</span>. Your current staff login will be preserved. This cannot be undone.
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Tables to restore</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setRestoreModal((m) => ({ ...m, selected: m.tables }))}
                    className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] bg-[#DBE7E4]/50 rounded hover:bg-[#D6E2E9] transition-colors cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setRestoreModal((m) => ({ ...m, selected: [] }))}
                    className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] bg-[#DBE7E4]/50 rounded hover:bg-[#D6E2E9] transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {restoreModal.tables.map((tableValue) => {
                  const label = BACKUP_TABLE_OPTIONS.find((t) => t.value === tableValue)?.label || tableValue;
                  return (
                    <label key={tableValue} className="flex items-center gap-2 p-2 rounded-lg border border-[#1B2D3C]/10 cursor-pointer hover:bg-[#DBE7E4]/30 transition-colors">
                      <input
                        type="checkbox"
                        checked={restoreModal.selected.includes(tableValue)}
                        onChange={(e) => {
                          setRestoreModal((m) => ({
                            ...m,
                            selected: e.target.checked ? [...m.selected, tableValue] : m.selected.filter((t) => t !== tableValue),
                          }));
                        }}
                        className="w-4 h-4 accent-[#1B2D3C] cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-[#1B2D3C]">{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setRestoreModal({ isOpen: false, backupId: null, name: '', tables: [], selected: [] })}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (restoreModal.backupId && restoreModal.selected.length > 0) {
                    restoreDbBackup(restoreModal.backupId, restoreModal.selected);
                    setRestoreModal({ isOpen: false, backupId: null, name: '', tables: [], selected: [] });
                  }
                }}
                disabled={restoreModal.selected.length === 0 || dbBackupLoading}
                className="flex-1 px-4 py-2 bg-amber-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-amber-600 transition-all cursor-pointer disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gift Card Creation Modal */}
      {showGiftCardModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Create Gift Card</h3>
            <div className="space-y-3">
              <div className="flex rounded-lg border border-[#1B2D3C]/15 overflow-hidden">
                {(['amount', 'activity'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setGiftCardKind(k);
                      if (k === 'activity' && !newGiftCard.covers) {
                        setNewGiftCard({ ...newGiftCard, covers: 'One studio fee + one small animal to paint' });
                      }
                    }}
                    className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      giftCardKind === k ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/50 hover:text-[#1B2D3C]'
                    }`}
                  >
                    {k === 'amount' ? '£ Amount' : 'Activity Voucher'}
                  </button>
                ))}
              </div>
              {giftCardKind === 'activity' ? (
                <div>
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Voucher Covers *</label>
                  <input
                    type="text"
                    value={newGiftCard.covers}
                    onChange={(e) => setNewGiftCard({ ...newGiftCard, covers: e.target.value })}
                    placeholder="e.g. One studio fee + one small animal to paint"
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                  <p className="text-[10px] text-[#1B2D3C]/50 mt-1">Shown on the voucher instead of a £ amount — e.g. school donation vouchers. Put the school name in Recipient Name.</p>
                </div>
              ) : (
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Amount (£) *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={newGiftCard.amount}
                  onChange={(e) => setNewGiftCard({ ...newGiftCard, amount: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Recipient Name{giftCardKind === 'activity' && ' (e.g. school name)'}</label>
                <input
                  type="text"
                  value={newGiftCard.recipientName}
                  onChange={(e) => setNewGiftCard({ ...newGiftCard, recipientName: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Recipient Email{giftCardIsPhysical && ' (skipped for physical)'}</label>
                <input
                  type="email"
                  value={newGiftCard.recipientEmail}
                  onChange={(e) => setNewGiftCard({ ...newGiftCard, recipientEmail: e.target.value })}
                  disabled={giftCardIsPhysical}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 disabled:opacity-40"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Sender Name</label>
                <input
                  type="text"
                  value={newGiftCard.senderName}
                  onChange={(e) => setNewGiftCard({ ...newGiftCard, senderName: e.target.value })}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Message</label>
                <textarea
                  value={newGiftCard.message}
                  onChange={(e) => setNewGiftCard({ ...newGiftCard, message: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 resize-none"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={giftCardIsPhysical}
                  onChange={(e) => setGiftCardIsPhysical(e.target.checked)}
                  className="w-4 h-4 accent-[#1B2D3C]"
                />
                <span className="text-xs font-bold text-[#1B2D3C]">Physical card (in-store, no payment)</span>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowGiftCardModal(false); setGiftCardIsPhysical(false); setGiftCardKind('amount'); }}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={giftCardKind === 'activity' || giftCardIsPhysical ? createGiftCardInStore : createGiftCardCheckout}
                disabled={giftCardCreating}
                className="flex-1 px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer disabled:opacity-50"
              >
                {giftCardCreating ? 'Creating...' : giftCardKind === 'activity' ? 'Create Voucher' : giftCardIsPhysical ? 'Create (No Payment)' : 'Proceed to Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gift Card Redemption Modal */}
      {showRedeemModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 sm:p-6">
          <div className="bg-white p-6 border border-[#1B2D3C]/20 max-w-md w-full space-y-4 shadow-lg max-h-[90vh] overflow-y-auto sm:rounded-xl">
            <h3 className="font-heading text-xl font-black text-[#1B2D3C]">Redeem Gift Card</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Gift Card Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={redeemCode}
                    onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                    placeholder="PP-XXXXXXXXXX"
                    className="flex-1 px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold font-mono rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setAdminScanning(true)}
                    className="px-3 py-2 bg-[#1B2D3C] text-white rounded-lg hover:bg-[#243B53] transition-colors cursor-pointer flex items-center gap-1"
                    title="Scan QR code"
                  >
                    <ScanLine className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => checkRedeemBalance()}
                    disabled={!redeemCode.trim() || redeemChecking}
                    className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] cursor-pointer disabled:opacity-50"
                  >
                    {redeemChecking ? 'Checking...' : 'Check'}
                  </button>
                </div>
              </div>

              {redeemError && (
                <div className="p-3 bg-red-50 border border-red-100 text-red-700 text-xs font-semibold rounded-lg">
                  {redeemError}
                </div>
              )}

              {redeemBalanceResult && (
                <div className="bg-[#DBE7E4]/30 p-4 rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Code</span>
                    <span className="text-xs font-mono font-bold text-[#1B2D3C]">{redeemBalanceResult.code}</span>
                  </div>
                  {redeemBalanceResult.covers ? (
                    <div className="flex justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Covers</span>
                      <span className="text-xs font-bold text-purple-700 text-right">{redeemBalanceResult.covers}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Original Amount</span>
                        <span className="text-xs font-bold text-[#1B2D3C]">£{redeemBalanceResult.amount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Balance</span>
                        <span className="text-lg font-black text-[#1B2D3C]">£{redeemBalanceResult.balance.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/70">Status</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      redeemBalanceResult.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                      redeemBalanceResult.status === 'expired' ? 'bg-red-100 text-red-700' :
                      'bg-stone-100 text-stone-500'
                    }`}>{redeemBalanceResult.status}</span>
                  </div>
                </div>
              )}

              {redeemBalanceResult && redeemBalanceResult.status === 'active' && redeemBalanceResult.covers && (
                <button
                  onClick={redeemGiftCard}
                  disabled={redeeming}
                  className="w-full px-4 py-2.5 bg-purple-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-purple-800 transition-all cursor-pointer disabled:opacity-50"
                >
                  {redeeming ? 'Marking...' : 'Mark as Used'}
                </button>
              )}

              {redeemBalanceResult && redeemBalanceResult.status === 'active' && !redeemBalanceResult.covers && redeemBalanceResult.balance > 0 && (
                <div className="space-y-2">
                  <label className="block text-[10px] font-bold text-[#1B2D3C] uppercase tracking-wider mb-1">Amount to Redeem (£)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={redeemAmount}
                      onChange={(e) => setRedeemAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                    />
                    <button
                      onClick={() => setRedeemAmount(redeemBalanceResult.balance.toFixed(2))}
                      className="px-3 py-2 bg-[#D6E2E9]/50 text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] cursor-pointer whitespace-nowrap"
                    >
                      Full Balance
                    </button>
                  </div>
                  <button
                    onClick={redeemGiftCard}
                    disabled={redeeming || !redeemAmount}
                    className="w-full px-4 py-2.5 bg-[#1B2D3C] text-white font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#243B53] transition-all cursor-pointer disabled:opacity-50"
                  >
                    {redeeming ? 'Redeeming...' : 'Redeem'}
                  </button>
                </div>
              )}

              {redeemResult && (
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg space-y-2">
                  <p className="text-xs font-bold text-emerald-800">Redemption Successful</p>
                  {redeemBalanceResult?.covers ? (
                    <p className="text-[11px] font-bold text-emerald-800">Activity voucher marked as used.</p>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-bold uppercase text-emerald-700">Discount Applied</span>
                        <span className="text-sm font-black text-emerald-800">£{redeemResult.discount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] font-bold uppercase text-emerald-700">Remaining Balance</span>
                        <span className="text-sm font-bold text-emerald-800">£{redeemResult.balance.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[10px] font-bold uppercase text-emerald-700">Status</span>
                    <span className="text-[10px] font-bold uppercase text-emerald-700">{redeemResult.status}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRedeemModal(false)}
                className="flex-1 px-4 py-2 bg-[#FFFFFF] text-[#1B2D3C] font-bold text-xs uppercase tracking-wider border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                {redeemResult ? 'Done' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin QR Scanner for gift card redemption */}
      {adminScanning && (
        <QRScanner
          onScan={handleAdminScan}
          onClose={() => setAdminScanning(false)}
        />
      )}

      {/* Capacity section — inside settings tab */}
      {activeTab === 'settings' && canManageStaff && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 pb-8 space-y-6">
          {/* Capacity */}
          <div id="settings-capacity" className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 scroll-mt-[140px]">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Capacity</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Maximum seats per studio and session type.</p>
            </div>
            {visibleCapacityRows.length === 0 ? (
              <div className="space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : (
              <div className="space-y-3">
                {visibleCapacityRows.map(({ row, index }) => (
                  <div key={`${row.studio}-${row.session_type}`} className="flex items-center gap-4 p-4 bg-[#DBE7E4]/30 rounded-lg">
                    <div className="flex-1">
                      <p className="text-[10px] font-bold uppercase text-[#1B2D3C]/50">Studio</p>
                      <p className="text-sm font-bold text-[#1B2D3C]">{row.studio}</p>
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] font-bold uppercase text-[#1B2D3C]/50">Session Type</p>
                      <p className="text-sm font-bold text-[#1B2D3C]">{CAPACITY_LABEL[row.session_type] ?? row.session_type}</p>
                      <p className="text-[10px] text-[#1B2D3C]/50 mt-0.5">{CAPACITY_HINT[row.session_type] ?? ''}</p>
                    </div>
                    <div className="w-28">
                      <p className="text-[10px] font-bold uppercase text-[#1B2D3C]/50">Max Seats</p>
                      <input
                        type="number"
                        min={1}
                        value={row.max_painters}
                        onChange={(e) => {
                          const value = parseInt(e.target.value, 10);
                          const updated = [...capacityRows];
                          updated[index] = { ...row, max_painters: Number.isNaN(value) ? row.max_painters : value };
                          setCapacityRows(updated);
                        }}
                        className="w-full px-2 py-1 border-2 border-[#1B2D3C] bg-white text-[#1B2D3C] text-sm font-bold focus:outline-none mt-0.5"
                      />
                    </div>
                    <button
                      onClick={() => updateCapacity(capacityRows[index])}
                      disabled={capacitySaving}
                      className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider hover:bg-[#D6E2E9] disabled:opacity-50 cursor-pointer rounded-lg"
                    >
                      Save
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Time Slots */}
          <div id="settings-time-slots" className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-6 scroll-mt-[140px]">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Time Slots</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Configure available booking times per studio, session type, and weekday/weekend. Changes are saved globally and apply to all users.</p>
            </div>

            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex gap-2">
                {(studioFilter === 'all' ? visibleStudios : [studioFilter]).map((studio) => (
                  <button
                    key={studio}
                    onClick={() => setTimeSlotStudio(studio)}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg cursor-pointer border transition-colors ${
                      timeSlotStudio === studio
                        ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C]'
                        : 'bg-white text-[#1B2D3C] border-[#1B2D3C]/20 hover:bg-[#D6E2E9]/20'
                    }`}
                  >
                    {studio}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {(['weekday', 'weekend'] as DayType[]).map((dt) => (
                  <button
                    key={dt}
                    onClick={() => setTimeSlotDayType(dt)}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg cursor-pointer border transition-colors ${
                      timeSlotDayType === dt
                        ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C]'
                        : 'bg-white text-[#1B2D3C] border-[#1B2D3C]/20 hover:bg-[#D6E2E9]/20'
                    }`}
                  >
                    {dt === 'weekday' ? 'Weekdays' : 'Weekends'}
                  </button>
                ))}
              </div>
            </div>

            {(['painting', 'sip-and-paint', 'baby-prints', 'party'] as SlotSessionType[]).map((type) => {
              const labels: Record<SlotSessionType, string> = { painting: 'Painting', 'sip-and-paint': 'Sip & Paint', 'baby-prints': 'Baby Prints', party: 'Party' };
              const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

              const applyConfigChange = (nextConfig: TimeSlotsData) => {
                setTimeSlotConfig(nextConfig);
                saveSlotsToSupabase(nextConfig, staff.username, staff.sessionToken ?? '').catch(() => {
                  showToast('Failed to save time slots', 'error');
                });
              };

              const currentSlots = timeSlotConfig[timeSlotStudio][type].slots[timeSlotDayType];
              const currentDays = timeSlotConfig[timeSlotStudio][type].availableDays;
              const currentEnabled = timeSlotConfig[timeSlotStudio][type].enabled ?? true;

              return (
                <div key={`${timeSlotStudio}-${timeSlotDayType}-${type}`} className={`space-y-3 ${currentEnabled ? '' : 'opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">{labels[type]}</h3>
                      <button
                        onClick={() => {
                          const nextConfig = { ...timeSlotConfig, [timeSlotStudio]: { ...timeSlotConfig[timeSlotStudio], [type]: { ...timeSlotConfig[timeSlotStudio][type], enabled: !currentEnabled } } };
                          applyConfigChange(nextConfig);
                          showToast(`${labels[type]} ${currentEnabled ? 'disabled' : 'enabled'} for ${timeSlotStudio}`, 'success');
                        }}
                        className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-colors cursor-pointer ${
                          currentEnabled ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-stone-100 text-stone-500 border-stone-300'
                        }`}
                      >
                        {currentEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        const reset = DEFAULT_SLOTS[timeSlotStudio][type].slots[timeSlotDayType];
                        const nextConfig = { ...timeSlotConfig, [timeSlotStudio]: { ...timeSlotConfig[timeSlotStudio], [type]: { ...timeSlotConfig[timeSlotStudio][type], slots: { ...timeSlotConfig[timeSlotStudio][type].slots, [timeSlotDayType]: reset } } } };
                        applyConfigChange(nextConfig);
                        showToast(`${labels[type]} slots reset to default`, 'success');
                      }}
                      className="text-[10px] font-bold text-[#1B2D3C]/50 hover:text-[#1B2D3C] uppercase tracking-wider cursor-pointer"
                    >
                      Reset to default
                    </button>
                  </div>

                  <div>
                    <p className="text-[10px] font-black text-[#1B2D3C]/50 uppercase tracking-wider mb-2">Available days</p>
                    <div className="flex flex-wrap gap-2">
                      {dayLabels.map((label, idx) => {
                        const active = currentDays.includes(idx);
                        return (
                          <button
                            key={label}
                            onClick={() => {
                              const nextDays = active ? currentDays.filter((d) => d !== idx) : [...currentDays, idx].sort((a, b) => a - b);
                              const nextConfig = { ...timeSlotConfig, [timeSlotStudio]: { ...timeSlotConfig[timeSlotStudio], [type]: { ...timeSlotConfig[timeSlotStudio][type], availableDays: nextDays } } };
                              applyConfigChange(nextConfig);
                            }}
                            className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border cursor-pointer transition-colors ${
                              active ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/50 border-[#1B2D3C]/20 hover:bg-[#D6E2E9]/20'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {currentSlots.map((slot) => (
                      <span key={slot} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold rounded-lg">
                        {slot}
                        <button
                          onClick={() => {
                            const updated = currentSlots.filter(s => s !== slot);
                            const nextConfig = { ...timeSlotConfig, [timeSlotStudio]: { ...timeSlotConfig[timeSlotStudio], [type]: { ...timeSlotConfig[timeSlotStudio][type], slots: { ...timeSlotConfig[timeSlotStudio][type].slots, [timeSlotDayType]: sortSlots(updated) } } } };
                            applyConfigChange(nextConfig);
                          }}
                          className="ml-0.5 hover:text-red-600 cursor-pointer"
                        >
                          <XIcon className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSlotInput[type]}
                      onChange={e => setNewSlotInput(prev => ({ ...prev, [type]: e.target.value }))}
                      placeholder={type === 'party' ? 'e.g. 10:00-12:00' : 'e.g. 10:00'}
                      className="flex-1 px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = newSlotInput[type].trim();
                          if (!val || currentSlots.includes(val)) return;
                          const updated = sortSlots([...currentSlots, val]);
                          const nextConfig = { ...timeSlotConfig, [timeSlotStudio]: { ...timeSlotConfig[timeSlotStudio], [type]: { ...timeSlotConfig[timeSlotStudio][type], slots: { ...timeSlotConfig[timeSlotStudio][type].slots, [timeSlotDayType]: updated } } } };
                          applyConfigChange(nextConfig);
                          setNewSlotInput(prev => ({ ...prev, [type]: '' }));
                          showToast(`Slot added to ${labels[type]}`, 'success');
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const val = newSlotInput[type].trim();
                        if (!val || currentSlots.includes(val)) return;
                        const updated = sortSlots([...currentSlots, val]);
                        const nextConfig = { ...timeSlotConfig, [timeSlotStudio]: { ...timeSlotConfig[timeSlotStudio], [type]: { ...timeSlotConfig[timeSlotStudio][type], slots: { ...timeSlotConfig[timeSlotStudio][type].slots, [timeSlotDayType]: updated } } } };
                        applyConfigChange(nextConfig);
                        setNewSlotInput(prev => ({ ...prev, [type]: '' }));
                        showToast(`Slot added to ${labels[type]}`, 'success');
                      }}
                      className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] cursor-pointer flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* School Holidays & Closed Dates */}
          <div className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-6">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">School Holidays & Closed Dates</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">School holiday Mondays will open for bookings. Closed dates block all bookings on that day regardless of day of week.</p>
            </div>

            {/* School Holidays */}
            <div className="space-y-3">
              <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">School Holiday Periods <span className="text-[#1B2D3C]/40 font-medium normal-case tracking-normal">(Mondays within range open)</span></h3>
              <div className="flex flex-wrap gap-2">
                {closures.schoolHolidays.length === 0 && <p className="text-xs text-[#1B2D3C]/40 italic">No school holiday periods set</p>}
                {(closures.schoolHolidays as HolidayRange[]).map((range, idx) => (
                  <span key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg">
                    {range.label && <span className="text-emerald-600">{range.label}:</span>}
                    {range.from} → {range.to}
                    <button onClick={() => {
                      const next: ClosureDates = { ...closures, schoolHolidays: (closures.schoolHolidays as HolidayRange[]).filter((_, i) => i !== idx) };
                      setClosures(next);
                      saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                    }} className="ml-0.5 hover:text-red-600 cursor-pointer"><XIcon className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <input
                  type="text"
                  placeholder="Label (e.g. Summer)"
                  value={newHolidayLabel}
                  onChange={e => setNewHolidayLabel(e.target.value)}
                  className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                />
                <input
                  type="date"
                  value={newHolidayFrom}
                  onChange={e => setNewHolidayFrom(e.target.value)}
                  className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                />
                <input
                  type="date"
                  value={newHolidayTo}
                  onChange={e => setNewHolidayTo(e.target.value)}
                  className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                />
                <button
                  onClick={() => {
                    if (!newHolidayFrom || !newHolidayTo || newHolidayFrom > newHolidayTo) {
                      showToast('Please set a valid from and to date', 'error');
                      return;
                    }
                    const range: HolidayRange = { from: newHolidayFrom, to: newHolidayTo, ...(newHolidayLabel.trim() ? { label: newHolidayLabel.trim() } : {}) };
                    const next: ClosureDates = { ...closures, schoolHolidays: [...(closures.schoolHolidays as HolidayRange[]), range].sort((a, b) => a.from.localeCompare(b.from)) };
                    setClosures(next);
                    setNewHolidayFrom('');
                    setNewHolidayTo('');
                    setNewHolidayLabel('');
                    saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                    showToast('School holiday period added', 'success');
                  }}
                  className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] cursor-pointer flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Period
                </button>
              </div>
            </div>

            {/* Closed Dates */}
            <div className="space-y-3">
              <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">Closed Dates <span className="text-[#1B2D3C]/40 font-medium normal-case tracking-normal">(no bookings on that day)</span></h3>
              <div className="flex flex-wrap gap-2">
                {visibleClosedDates.length === 0 && <p className="text-xs text-[#1B2D3C]/40 italic">No closed dates set</p>}
                {visibleClosedDates.map(({ entry, idx }) => (
                  <span key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-100 text-red-800 text-xs font-bold rounded-lg">
                    {entry.date}
                    <span className="px-1.5 py-0.5 bg-red-200 text-red-700 text-[10px] rounded">{entry.studio}</span>
                    <button onClick={() => {
                      const next = { ...closures, closedDates: closures.closedDates.filter((_, i) => i !== idx) };
                      setClosures(next);
                      saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                    }} className="ml-0.5 hover:text-red-600 cursor-pointer"><XIcon className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                <input
                  type="date"
                  value={newClosedInput}
                  onChange={e => setNewClosedInput(e.target.value)}
                  className="flex-1 min-w-[140px] px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                />
                <select
                  value={newClosedStudio}
                  onChange={e => setNewClosedStudio(e.target.value as 'Putney' | 'Wimbledon' | 'Both')}
                  className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50 cursor-pointer"
                >
                  {studioFilter === 'all' ? (
                    <>
                      <option value="Both">Both Studios</option>
                      <option value="Putney">Putney Only</option>
                      <option value="Wimbledon">Wimbledon Only</option>
                    </>
                  ) : (
                    <>
                      <option value={studioFilter}>{studioFilter} Only</option>
                      <option value="Both">Both Studios</option>
                    </>
                  )}
                </select>
                <button
                  onClick={async () => {
                    const val = newClosedInput.trim();
                    if (!val) return;
                    const alreadyExists = closures.closedDates.some(e => e.date === val && e.studio === newClosedStudio);
                    if (alreadyExists) return;
                    const existingOnDate = inquiries.filter(b => b.date === val && (newClosedStudio === 'Both' || b.studio === newClosedStudio));
                    if (existingOnDate.length > 0) {
                      showToast(`Warning: ${existingOnDate.length} booking(s) already exist on ${val} for ${newClosedStudio}. Date closed anyway — contact customers manually.`, 'error');
                    }
                    const next = { ...closures, closedDates: [...closures.closedDates, { date: val, studio: newClosedStudio }].sort((a, b) => a.date.localeCompare(b.date)) };
                    setClosures(next);
                    setNewClosedInput('');
                    saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                    if (existingOnDate.length === 0) showToast('Closed date added', 'success');
                  }}
                  className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            </div>
          </div>

          {/* Maintenance Mode */}
          <div className={`border p-6 rounded-xl space-y-4 max-w-xl ${maintenanceMode ? 'bg-red-50 border-red-200' : 'bg-white border-[#1B2D3C]/10'}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Maintenance Mode</h2>
                <p className="text-xs text-[#1B2D3C]/70 mt-1">When ON, the public site shows a maintenance page with studio contact details. Only logged-in staff can access the site.</p>
              </div>
              <button
                onClick={() => toggleMaintenanceMode(!maintenanceMode)}
                disabled={maintenanceSaving}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  maintenanceMode ? 'bg-red-500' : 'bg-[#1B2D3C]/20'
                } ${maintenanceSaving ? 'opacity-50' : ''}`}
              >
                <span className={`pointer-events-none inline-block h-6 w-6 rounded-full bg-white shadow transform transition-transform duration-200 ${
                  maintenanceMode ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
            {maintenanceMode && (
              <div className="flex items-center gap-2 p-3 bg-red-100 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse inline-block flex-shrink-0" />
                <p className="text-xs font-bold text-red-700">Site is currently in maintenance — public visitors see the maintenance page</p>
              </div>
            )}
          </div>

          {/* Stripe Mode */}
          <div id="settings-stripe" className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 scroll-mt-[140px] max-w-xl">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Stripe Mode</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Switch between sandbox (test) and live payments.</p>
            </div>
            <div className="flex rounded-lg border border-[#1B2D3C]/20 overflow-hidden">
              {(['sandbox', 'live'] as const).map(mode => (
                <button key={mode} onClick={() => updateStripeMode(mode)}
                  className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    stripeMode === mode ? 'bg-[#DBE7E4] text-[#1B2D3C]' : 'bg-white text-[#1B2D3C]/60 hover:text-[#1B2D3C]'
                  }`}>
                  {mode}
                </button>
              ))}
            </div>
            <div className={`p-3 rounded-lg text-xs font-bold ${stripeMode === 'live' ? 'bg-red-50 text-red-700' : 'bg-[#DBE7E4]/30 text-[#1B2D3C]'}`}>
              {stripeMode === 'live'
                ? 'Live mode active — real payments will be processed.'
                : 'Sandbox mode active — use test card details.'}
            </div>
          </div>

          {/* Party Price */}
          <div className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 max-w-xl">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Party Price</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Price per person for party bookings (birthday, baby shower/hen, corporate). This includes the £5.95 studio fee.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#1B2D3C]">£</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={partyPrice}
                onChange={(e) => setPartyPrice(Math.max(0, Number(e.target.value)))}
                className="flex-1 px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
              />
              <button
                onClick={() => updatePartyPrice(partyPrice)}
                className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-all cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>

          {/* Party Guest Limit */}
          <div className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 max-w-xl">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Party Guest Limit</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Maximum number of guests per party booking at each studio.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#1B2D3C] uppercase tracking-wider">Putney</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={partyGuestLimitPutney}
                    onChange={(e) => setPartyGuestLimitPutney(Math.max(1, Number(e.target.value)))}
                    className="flex-1 px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                  <button
                    onClick={() => updatePartyGuestLimit('putney', partyGuestLimitPutney)}
                    className="px-3 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-all cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#1B2D3C] uppercase tracking-wider">Wimbledon</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="80"
                    value={partyGuestLimitWimbledon}
                    onChange={(e) => setPartyGuestLimitWimbledon(Math.max(1, Number(e.target.value)))}
                    className="flex-1 px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20"
                  />
                  <button
                    onClick={() => updatePartyGuestLimit('wimbledon', partyGuestLimitWimbledon)}
                    className="px-3 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] transition-all cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Deposit Notice Type */}
          <div className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 max-w-xl">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Deposit Notice Style</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Controls the colour and icon of the deposit notice shown on the party booking form.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['info', 'warning', 'success', 'error'] as const).map(type => {
                const meta = { info: { label: 'Info', bg: 'bg-blue-100 text-blue-900 border-blue-300' }, warning: { label: 'Warning', bg: 'bg-amber-100 text-amber-900 border-amber-300' }, success: { label: 'Success', bg: 'bg-green-100 text-green-900 border-green-300' }, error: { label: 'Error', bg: 'bg-red-100 text-red-900 border-red-300' } }[type];
                const icons = { info: 'ℹ️', warning: '⚠️', success: '✅', error: '🚫' };
                return (
                  <button
                    key={type}
                    onClick={async () => {
                      setDepositNoticeTypeState(type);
                      try {
                        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-content`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
                          body: JSON.stringify({ action: 'save', username: staff.username, sessionToken: staff.sessionToken, key: 'deposit_notice_type', page: 'party-booking', value: type, type: 'text' }),
                        });
                        showToast('Notice style updated', 'success');
                      } catch { showToast('Failed to save notice style', 'error'); }
                    }}
                    className={`px-4 py-2 border rounded-lg text-xs font-bold cursor-pointer transition-all ${meta.bg} ${depositNoticeType === type ? 'ring-2 ring-offset-1 ring-[#1B2D3C]' : 'opacity-60 hover:opacity-100'}`}
                  >
                    {icons[type]} {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Page Visibility */}
          {staff.role === 'super_admin' && (
            <div id="settings-pages" className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 scroll-mt-[140px]">
              <div>
                <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Page Visibility</h2>
                <p className="text-xs text-[#1B2D3C]/70 mt-1">Enable or disable pages from the public site. Disabled pages will show a maintenance message.</p>
              </div>
              {pageSettingsLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : (
                <div className="space-y-2">
                  {[
                    { key: 'pottery-painting', label: 'Pottery Painting' },
                    { key: 'baby-prints', label: 'Baby Prints' },
                    { key: 'parties', label: 'Parties & Events' },
                    { key: 'pricing', label: 'Prices' },
                    { key: 'price-list', label: 'Price List' },
                    { key: 'food-drink', label: 'Food & Drink' },
                    { key: 'buy-gift-card', label: 'Gift Cards' },
                    { key: 'faqs', label: 'FAQs' },
                    { key: 'gallery', label: 'Gallery' },
                    { key: 'contact-info', label: 'Contact' },
                    { key: 'putney', label: 'Putney Studio' },
                    { key: 'wimbledon', label: 'Wimbledon Studio' },
                  ].map(({ key, label }) => {
                    const dbSetting = pageSettings.find(s => s.page_key === key);
                    const enabled = dbSetting ? dbSetting.enabled : true;
                    return (
                      <div key={key} className="flex items-center justify-between p-3 bg-[#DBE7E4]/30 rounded-lg">
                        <div>
                          <p className="text-sm font-bold text-[#1B2D3C]">{label}</p>
                          <p className="text-[10px] text-[#1B2D3C]/50">{enabled ? 'Visible to public' : 'Hidden from public'}</p>
                        </div>
                        <button
                          onClick={() => updatePageSetting(key, !enabled)}
                          className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${
                            enabled ? 'bg-[#1B2D3C]' : 'bg-[#1B2D3C]/30'
                          }`}
                        >
                          <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                            enabled ? 'translate-x-6' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'documentation' && (
        <DocumentationTab />
      )}

      {activeTab === 'webmaster' && staff.role === 'super_admin' && (
        <WebmasterTab
          dbHealth={dbHealth}
          dbHealthLoading={dbHealthLoading}
          onLoadDbHealth={loadDbHealth}
          dbBackups={dbBackups}
          dbBackupLoading={dbBackupLoading}
          onCreateBackup={createDbBackup}
          onDownloadBackup={downloadDbBackup}
          onDeleteBackup={deleteDbBackup}
          onRestoreBackup={(backupId, name, tables) => setRestoreModal({ isOpen: true, backupId, name, tables, selected: tables })}
          selectedBackupTables={selectedBackupTables}
          onSelectBackupTables={setSelectedBackupTables}
          sampleDataStatus={sampleDataStatus}
          sampleDataLoading={sampleDataLoading}
          onLoadSampleData={loadSampleDataStatus}
          onAddSampleData={addSampleData}
          onRemoveSampleData={removeSampleData}
        />
      )}

      {activeTab === 'settings' && canManageStaff && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 pb-8 space-y-6">

          {/* Closures */}
          <div id="settings-closures" className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-6 scroll-mt-[140px]">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Closures</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Configure school holidays and closed dates for each studio.</p>
            </div>
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">School Holiday Periods <span className="text-[#1B2D3C]/40 font-medium normal-case tracking-normal">(Mondays within range open)</span></h3>
                <div className="flex flex-wrap gap-2">
                  {closures.schoolHolidays.length === 0 && <p className="text-xs text-[#1B2D3C]/40 italic">No school holiday periods set</p>}
                  {(closures.schoolHolidays as HolidayRange[]).map((range, idx) => (
                    <span key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg">
                      {range.label && <span className="text-emerald-600">{range.label}:</span>}
                      {range.from} → {range.to}
                      <button onClick={() => {
                        const next: ClosureDates = { ...closures, schoolHolidays: (closures.schoolHolidays as HolidayRange[]).filter((_, i) => i !== idx) };
                        setClosures(next);
                        saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                      }} className="ml-0.5 hover:text-red-600 cursor-pointer"><XIcon className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="text"
                    placeholder="Label (e.g. Summer)"
                    value={newHolidayLabel}
                    onChange={e => setNewHolidayLabel(e.target.value)}
                    className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                  />
                  <input
                    type="date"
                    value={newHolidayFrom}
                    onChange={e => setNewHolidayFrom(e.target.value)}
                    className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                  />
                  <input
                    type="date"
                    value={newHolidayTo}
                    onChange={e => setNewHolidayTo(e.target.value)}
                    className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                  />
                  <button
                    onClick={() => {
                      if (!newHolidayFrom || !newHolidayTo || newHolidayFrom > newHolidayTo) {
                        showToast('Please set a valid from and to date', 'error');
                        return;
                      }
                      const range: HolidayRange = { from: newHolidayFrom, to: newHolidayTo, ...(newHolidayLabel.trim() ? { label: newHolidayLabel.trim() } : {}) };
                      const next: ClosureDates = { ...closures, schoolHolidays: [...(closures.schoolHolidays as HolidayRange[]), range].sort((a, b) => a.from.localeCompare(b.from)) };
                      setClosures(next);
                      setNewHolidayFrom('');
                      setNewHolidayTo('');
                      setNewHolidayLabel('');
                      saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                      showToast('School holiday period added', 'success');
                    }}
                    className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Period
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-black text-[#1B2D3C] uppercase tracking-wider">Closed Dates <span className="text-[#1B2D3C]/40 font-medium normal-case tracking-normal">(no bookings on that day)</span></h3>
                <div className="flex flex-wrap gap-2">
                  {visibleClosedDates.length === 0 && <p className="text-xs text-[#1B2D3C]/40 italic">No closed dates set</p>}
                  {visibleClosedDates.map(({ entry, idx }) => (
                    <span key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-100 text-red-800 text-xs font-bold rounded-lg">
                      {entry.date}
                      <span className="px-1.5 py-0.5 bg-red-200 text-red-700 text-[10px] rounded">{entry.studio}</span>
                      <button onClick={() => {
                        const next = { ...closures, closedDates: closures.closedDates.filter((_, i) => i !== idx) };
                        setClosures(next);
                        saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                      }} className="ml-0.5 hover:text-red-600 cursor-pointer"><XIcon className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="date"
                    value={newClosedInput}
                    onChange={e => setNewClosedInput(e.target.value)}
                    className="flex-1 min-w-[140px] px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50"
                  />
                  <select
                    value={newClosedStudio}
                    onChange={e => setNewClosedStudio(e.target.value as 'Putney' | 'Wimbledon' | 'Both')}
                    className="px-3 py-2 border border-[#1B2D3C]/20 text-xs font-bold text-[#1B2D3C] rounded-lg focus:outline-none focus:border-[#1B2D3C]/50 cursor-pointer"
                  >
                    {studioFilter === 'all' ? (
                      <>
                        <option value="Both">Both Studios</option>
                        <option value="Putney">Putney Only</option>
                        <option value="Wimbledon">Wimbledon Only</option>
                      </>
                    ) : (
                      <>
                        <option value={studioFilter}>{studioFilter} Only</option>
                        <option value="Both">Both Studios</option>
                      </>
                    )}
                  </select>
                  <button
                    onClick={async () => {
                      const val = newClosedInput.trim();
                      if (!val) return;
                      const alreadyExists = closures.closedDates.some(e => e.date === val && e.studio === newClosedStudio);
                      if (alreadyExists) return;
                      const existingOnDate = inquiries.filter(b => b.date === val && (newClosedStudio === 'Both' || b.studio === newClosedStudio));
                      if (existingOnDate.length > 0) {
                        showToast(`Warning: ${existingOnDate.length} booking(s) already exist on ${val} for ${newClosedStudio}. Date closed anyway — contact customers manually.`, 'error');
                      }
                      const next = { ...closures, closedDates: [...closures.closedDates, { date: val, studio: newClosedStudio }].sort((a, b) => a.date.localeCompare(b.date)) };
                      setClosures(next);
                      setNewClosedInput('');
                      saveClosuresToSupabase(next, staff.username, staff.sessionToken ?? '').catch(() => showToast('Failed to save', 'error'));
                      if (existingOnDate.length === 0) showToast('Closed date added', 'success');
                    }}
                    className="px-4 py-2 bg-[#DBE7E4] text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#D6E2E9] cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Table Plan */}
          <div id="settings-table-plan" className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 scroll-mt-[140px] max-w-xl">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Table Plan</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Show table assignment and floor plan controls in the admin dashboard.</p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-[#1B2D3C]/20">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${tablePlanEnabled ? 'bg-emerald-500' : 'bg-stone-400'}`} />
                <span className="text-xs font-bold text-[#1B2D3C]">{tablePlanEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <button
                onClick={() => updateTablePlanEnabled(!tablePlanEnabled)}
                className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                  tablePlanEnabled
                    ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {tablePlanEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          {/* Party Buffers */}
          <div id="settings-party-buffers" className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4 scroll-mt-[140px] max-w-xl">
            <div>
              <h2 className="font-heading text-lg font-black text-[#1B2D3C]">Party Buffers</h2>
              <p className="text-xs text-[#1B2D3C]/70 mt-1">Minutes before and after a party to block the allocated tables for setup and cleanup.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-[#1B2D3C]/70">Setup buffer (min)</label>
                <input
                  type="number"
                  min={0}
                  value={partySetupBuffer}
                  onChange={(e) => setPartySetupBuffer(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 rounded-lg text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-[#1B2D3C]/70">Cleanup buffer (min)</label>
                <input
                  type="number"
                  min={0}
                  value={partyCleanupBuffer}
                  onChange={(e) => setPartyCleanupBuffer(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 border border-[#1B2D3C]/20 rounded-lg text-sm font-bold text-[#1B2D3C] focus:outline-none focus:border-[#1B2D3C]/50"
                />
              </div>
            </div>
            <button
              onClick={savePartyBuffers}
              disabled={bufferSaving}
              className="px-4 py-2 bg-[#1B2D3C] text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#243B53] disabled:opacity-50 cursor-pointer"
            >
              {bufferSaving ? 'Saving...' : 'Save Buffers'}
            </button>
          </div>

          {/* Notification Settings — super admin only */}
          {isSuperAdmin && (
            <div id="settings-notifications" className="scroll-mt-[140px]">
              <NotificationSettings staff={staff} />
            </div>
          )}

        </div>
      )}

      {activeTab === 'painted' && (
        <CollectionsTab
          bookings={scopedInquiries}
          studioFilter={studioFilter}
          onStudioFilterChange={setStudioFilter}
          loading={loading}
          canUpdate={canEdit}
          fixedStage="painted"
          onSetStage={handleSetCollectionStage}
          onOpenBooking={(booking) => setDrawerBooking(booking)}
          onUploadPhotos={handleCollectionPhotoUpload}
          uploadingId={collectionUploadingId}
          onAddPhotoTag={handleAddPhotoTag}
          onRemovePhotoTag={handleRemovePhotoTag}
          onBulkAddPhotoTag={handleBulkAddPhotoTag}
          onCreateProfile={(data) => handleCreateProfile(data, 'painted')}
        />
      )}

      {activeTab === 'ready' && (
        <CollectionsTab
          bookings={scopedInquiries}
          studioFilter={studioFilter}
          onStudioFilterChange={setStudioFilter}
          loading={loading}
          canUpdate={canEdit}
          fixedStage="ready"
          onSetStage={handleSetCollectionStage}
          onOpenBooking={(booking) => setDrawerBooking(booking)}
          onUploadPhotos={handleCollectionPhotoUpload}
          uploadingId={collectionUploadingId}
          onAddPhotoTag={handleAddPhotoTag}
          onRemovePhotoTag={handleRemovePhotoTag}
          onBulkAddPhotoTag={handleBulkAddPhotoTag}
          onCreateProfile={(data) => handleCreateProfile(data, 'ready')}
        />
      )}

      {activeTab === 'collected' && (
        <CollectionsTab
          bookings={scopedInquiries}
          studioFilter={studioFilter}
          onStudioFilterChange={setStudioFilter}
          loading={loading}
          canUpdate={canEdit}
          fixedStage="collected"
          onSetStage={handleSetCollectionStage}
          onOpenBooking={(booking) => setDrawerBooking(booking)}
          onUploadPhotos={handleCollectionPhotoUpload}
          uploadingId={collectionUploadingId}
          onAddPhotoTag={handleAddPhotoTag}
          onRemovePhotoTag={handleRemovePhotoTag}
          onBulkAddPhotoTag={handleBulkAddPhotoTag}
        />
      )}

      {activeTab === 'analytics' && canManageStaff && (
        <AnalyticsTab inquiries={scopedInquiries} giftCards={giftCards} />
      )}

      {activeTab === 'audit-logs' && canManageStaff && (
        <>
          {auditLogsLoading && auditLogs.length === 0 ? (
            <TabSkeleton rows={6} />
          ) : (
            <AuditLogsTab auditLogs={auditLogs} auditLogsLoading={auditLogsLoading} />
          )}
        </>
      )}

      {activeTab === 'email-logs' && canManageStaff && (
        <>
          {emailLogsLoading && emailLogs.length === 0 ? (
            <TabSkeleton rows={6} />
          ) : (
            <EmailLogsTab emailLogs={emailLogs} emailLogsLoading={emailLogsLoading} onRefresh={loadEmailLogs} onResendEmail={resendEmail} />
          )}
        </>
      )}

      {activeTab === 'sms' && isSuperAdmin && (
        <SMSAdminTab staff={staff} />
      )}

      {activeTab === 'email-templates' && canManageStaff && (
        <EmailTemplatesTab
          emailTemplates={emailTemplates}
          emailTemplatesLoading={emailTemplatesLoading}
          templateSaving={templateSaving}
          editingTemplate={editingTemplate}
          onRefresh={() => { loadEmailTemplates(); loadSmsTemplates(); }}
          onEditTemplate={(tpl) => setEditingTemplate(tpl)}
          onCancelEdit={() => setEditingTemplate(null)}
          onUpdateEditingTemplate={(tpl) => setEditingTemplate(tpl)}
          onSaveTemplate={saveEmailTemplate}
          onResetTemplate={resetEmailTemplate}
          smsTemplates={smsTemplates}
          smsTemplatesLoading={smsTemplatesLoading}
          onSaveSMSTemplate={saveSmsTemplate}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />

      {modalImages && (
        <ImageModal
          images={modalImages}
          initialIndex={modalIndex}
          onClose={() => { setModalImages(null); setModalPhotoTags(undefined); }}
          photoTags={modalPhotoTags}
        />
      )}

      {/* Booking detail drawer */}
      {drawerBooking && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => { setDrawerBooking(null); setDrawerTagMode(false); }} />
          <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 bg-[#DBE7E4] text-[#1B2D3C] flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#1B2D3C]/50 mb-0.5">Booking</p>
                <p className="font-heading font-black text-lg leading-tight">{drawerBooking.name}</p>
                <p className="text-xs text-[#1B2D3C]/60 mt-0.5">{drawerBooking.id}</p>
              </div>
              <button onClick={() => { setDrawerBooking(null); setDrawerTagMode(false); }} className="text-[#1B2D3C]/50 hover:text-[#1B2D3C] text-2xl leading-none cursor-pointer mt-1">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Status badge */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-full ${
                  drawerBooking.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800'
                  : drawerBooking.status === 'cancelled' ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-800'
                }`}>
                  {drawerBooking.status === 'confirmed' ? <CheckCircle className="w-3.5 h-3.5" /> : drawerBooking.status === 'cancelled' ? <XCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  {drawerBooking.status === 'confirmed' ? 'Confirmed' : drawerBooking.status === 'cancelled' ? 'Cancelled' : 'Awaiting confirmation'}
                </span>
                {drawerBooking.tableId && (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-black bg-[#DBE7E4] text-[#1B2D3C] rounded-full">
                    {drawerBooking.tableId}
                  </span>
                )}
              </div>

              {/* Details */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#F8FAFA] rounded-lg p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Date</p>
                    <p className="text-sm font-black text-[#1B2D3C]">{drawerBooking.date}</p>
                  </div>
                  <div className="bg-[#F8FAFA] rounded-lg p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Time</p>
                    <p className="text-sm font-black text-[#1B2D3C]">{drawerBooking.time}</p>
                  </div>
                  <div className="bg-[#F8FAFA] rounded-lg p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Studio</p>
                    <p className="text-sm font-black text-[#1B2D3C]">{drawerBooking.studio}</p>
                  </div>
                  <div className="bg-[#F8FAFA] rounded-lg p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Seats</p>
                    <p className="text-sm font-black text-[#1B2D3C]">{drawerBooking.paintersCount}</p>
                  </div>
                </div>
                <div className="bg-[#F8FAFA] rounded-lg p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Session Type</p>
                  <p className="text-sm font-black text-[#1B2D3C]">{SESSION_LABELS[drawerBooking.sessionType] ?? drawerBooking.sessionType}</p>
                </div>
              </div>

              {/* Contact */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-2">Contact</p>
                <div className="space-y-2">
                  <a href={`mailto:${drawerBooking.email}`} className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C] hover:underline">
                    <Mail className="w-3.5 h-3.5 text-[#1B2D3C]/40 shrink-0" />{drawerBooking.email}
                  </a>
                  <a href={`tel:${drawerBooking.phone}`} className="flex items-center gap-2 text-xs font-semibold text-[#1B2D3C] hover:underline">
                    <Phone className="w-3.5 h-3.5 text-[#1B2D3C]/40 shrink-0" />{drawerBooking.phone}
                  </a>
                </div>
              </div>

              {/* Notes */}
              {drawerBooking.notes && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">Customer Notes</p>
                  <p className="text-xs text-amber-900">{drawerBooking.notes}</p>
                </div>
              )}

              {/* Staff Notes */}
              {canEdit && (
                <div className="bg-[#F8FAFA] rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Staff Notes</p>
                  <textarea
                    rows={3}
                    value={staffNotesDraft}
                    onChange={(e) => setStaffNotesDraft(e.target.value)}
                    placeholder="Internal notes — only visible to staff"
                    className="w-full px-3 py-2 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-bold rounded-lg focus:outline-none focus:bg-[#D6E2E9]/20 resize-none"
                  />
                  <button
                    onClick={saveStaffNotes}
                    className="w-full py-2 bg-[#DBE7E4] hover:bg-[#D6E2E9] text-[#1B2D3C] text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                  >
                    Save staff notes
                  </button>
                </div>
              )}

              {/* Painting Photos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50">Painting Photos</p>
                  <div className="flex items-center gap-2">
                    {canEdit && canManageBooking(drawerBooking) && (
                      <button
                        onClick={() => setDrawerTagMode(!drawerTagMode)}
                        className={`text-[8px] font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-colors cursor-pointer ${drawerTagMode ? 'bg-[#1B2D3C] text-white' : 'bg-[#D6E2E9] text-[#1B2D3C]'}`}
                      >
                        {drawerTagMode ? '✓ Tag Mode' : 'Tag Mode'}
                      </button>
                    )}
                    {canEdit && canManageBooking(drawerBooking) && (
                    <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all ${
                      photoUploading
                        ? 'bg-[#D6E2E9]/40 text-[#1B2D3C]/50 cursor-wait'
                        : 'bg-[#DBE7E4] text-[#1B2D3C] hover:bg-[#D6E2E9]'
                    }`}>
                      <Camera className="w-3.5 h-3.5" />
                      {photoUploading ? 'Uploading...' : 'Add Photos'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleDrawerPhotoUpload}
                        disabled={photoUploading}
                        className="hidden"
                      />
                    </label>
                    )}
                  </div>
                </div>
                {drawerBooking.photos && drawerBooking.photos.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {drawerBooking.photos.map((url, i) => {
                      const tags = drawerBooking.photoTags?.[i] || [];
                      const tagColors: Record<string, string> = {
                        painted: 'bg-blue-100 text-blue-700',
                        glazing: 'bg-purple-100 text-purple-700',
                        firing: 'bg-orange-100 text-orange-700',
                        ready: 'bg-emerald-100 text-emerald-700',
                        needs_touchup: 'bg-red-100 text-red-700',
                      };
                      const tagLabels: Record<string, string> = {
                        painted: 'Painted',
                        glazing: 'Glazing',
                        firing: 'Firing',
                        ready: 'Ready',
                        needs_touchup: 'Touch-up',
                      };
                      return (
                        <div
                          key={i}
                          className="relative group aspect-square rounded-lg overflow-hidden border border-[#1B2D3C]/20"
                          onClick={(e) => {
                            if (canEdit && canManageBooking(drawerBooking) && drawerTagMode) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const x = ((e.clientX - rect.left) / rect.width) * 100;
                              const y = ((e.clientY - rect.top) / rect.height) * 100;
                              setDrawerTagPopover({ photoIndex: i, x, y });
                            } else {
                              setModalImages(drawerBooking.photos!); setModalIndex(i); setModalPhotoTags(drawerBooking.photoTags);
                            }
                          }}
                        >
                          <div className="block w-full h-full hover:opacity-80 transition-opacity cursor-pointer">
                            <img src={url} alt={`Painting ${i + 1}`} className="w-full h-full object-cover" />
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
                                {canEdit && canManageBooking(drawerBooking) && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRemovePhotoTag(drawerBooking, i, ti); }}
                                    className="hover:text-red-600 cursor-pointer"
                                  >
                                    <XIcon className="w-2 h-2" />
                                  </button>
                                )}
                              </span>
                            </div>
                          ))}
                          {canEdit && canManageBooking(drawerBooking) && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDrawerDeletePhoto(i); }}
                                className="absolute top-1 right-1 z-20 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-bold transition-opacity cursor-pointer flex items-center justify-center"
                              >
                                ✕
                              </button>
                              {drawerTagMode && (
                                <div className="absolute inset-0 ring-2 ring-[#1B2D3C] ring-inset rounded-lg pointer-events-none" />
                              )}
                              {drawerTagPopover && drawerTagPopover.photoIndex === i && (
                                <TagPopover
                                  x={drawerTagPopover.x}
                                  y={drawerTagPopover.y}
                                  existingTags={Array.from(new Set(Object.values(drawerBooking.photoTags || {}).flat().map(t => t.label || t.status).filter(Boolean))) as string[]}
                                  onAdd={(label, status) => {
                                    handleAddPhotoTag(drawerBooking, i, label, status, drawerTagPopover.x, drawerTagPopover.y);
                                  }}
                                  onClose={() => setDrawerTagPopover(null)}
                                />
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-[#1B2D3C]/50 font-medium">No photos uploaded yet.</p>
                )}
              </div>

              {/* Meta */}
              <div className="text-[10px] text-[#1B2D3C]/40 space-y-1 border-t border-[#1B2D3C]/10 pt-3">
                {drawerBooking.requestDate && <p>Booked on {format(new Date(drawerBooking.requestDate), 'dd MMM yyyy, HH:mm')}</p>}
                {drawerBooking.source && <p>Source: {drawerBooking.source}</p>}
                <button onClick={() => { navigator.clipboard.writeText(drawerBooking.id); showToast('Reference copied', 'success'); }}
                  className="flex items-center gap-1 text-[#1B2D3C]/40 hover:text-[#1B2D3C] cursor-pointer">
                  <Copy className="w-3 h-3" /> Copy reference
                </button>
              </div>

              {/* Payment Info */}
              {(drawerBooking.estimatedPrice != null || drawerBooking.finalPrice != null || drawerBooking.giftCardCode || drawerBooking.depositAmount != null || drawerBooking.finalBalance != null || drawerBooking.paymentStatus || drawerBooking.stripePaymentIntentId || drawerBooking.paymentLinkUrl) && (
                <div className="bg-[#F8FAFA] rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Payment Info</p>
                  <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[#1B2D3C]">
                    {drawerBooking.estimatedPrice != null && (
                      <div><span className="text-[#1B2D3C]/50">Estimated</span> £{drawerBooking.estimatedPrice.toFixed(2)}</div>
                    )}
                    {drawerBooking.finalPrice != null && (
                      <div><span className="text-[#1B2D3C]/50">Final price</span> £{drawerBooking.finalPrice.toFixed(2)}</div>
                    )}
                    {drawerBooking.giftCardDiscount != null && (
                      <div><span className="text-[#1B2D3C]/50">Gift card discount</span> -£{drawerBooking.giftCardDiscount.toFixed(2)}</div>
                    )}
                    {drawerBooking.depositAmount != null && (
                      <div><span className="text-[#1B2D3C]/50">Deposit</span> £{drawerBooking.depositAmount.toFixed(2)}</div>
                    )}
                    {drawerBooking.depositPaidAt && (
                      <div><span className="text-[#1B2D3C]/50">Deposit paid</span> {new Date(drawerBooking.depositPaidAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</div>
                    )}
                    {drawerBooking.finalBalance != null && (
                      <div><span className="text-[#1B2D3C]/50">Balance</span> £{drawerBooking.finalBalance.toFixed(2)}</div>
                    )}
                    {drawerBooking.finalPaidAt && (
                      <div><span className="text-[#1B2D3C]/50">Balance paid</span> {new Date(drawerBooking.finalPaidAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</div>
                    )}
                    {drawerBooking.paymentStatus && (
                      <div><span className="text-[#1B2D3C]/50">Status</span> <span className={`capitalize ${drawerBooking.paymentStatus === 'paid' ? 'text-emerald-700' : drawerBooking.paymentStatus === 'refunded' ? 'text-red-700' : 'text-amber-700'}`}>{drawerBooking.paymentStatus}</span></div>
                    )}
                  </div>
                  {drawerBooking.giftCardCode && (
                    <p className="text-[10px] text-[#1B2D3C]/60 font-medium">Gift card: <span className="font-mono text-[#1B2D3C]">{drawerBooking.giftCardCode}</span></p>
                  )}
                  {drawerBooking.stripePaymentIntentId && (
                    <button
                      onClick={handleViewPaymentDetails}
                      className="w-full px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C] bg-white border border-[#1B2D3C]/20 rounded-lg hover:bg-[#D6E2E9]/40 transition-all cursor-pointer"
                    >
                      View Stripe payment details
                    </button>
                  )}
                  {drawerBooking.paymentLinkUrl && (
                    <div className="text-[10px] text-[#1B2D3C]/60 font-medium space-y-0.5">
                      <a href={drawerBooking.paymentLinkUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">Payment link</a>
                      {drawerBooking.paymentLinkSentAt && (
                        <p>Sent {new Date(drawerBooking.paymentLinkSentAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Party payment */}
              {['birthday-party', 'baby-shower-hen', 'corporate'].includes(drawerBooking.sessionType) && (
                <div className="bg-[#F8FAFA] rounded-lg p-3 space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#1B2D3C]/50 mb-1">Party Payment</p>
                  <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[#1B2D3C]">
                    <div><span className="text-[#1B2D3C]/50">Seats</span> {drawerBooking.finalSeats ?? drawerBooking.paintersCount}</div>
                    <div>
                      <span className="text-[#1B2D3C]/50">Deposit</span> £{(drawerBooking.depositAmount ?? 50).toFixed(2)}{' '}
                      {drawerBooking.depositPaidAt
                        ? <span className="text-emerald-700">· received {new Date(drawerBooking.depositPaidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                        : <span className="text-amber-700">· unpaid</span>}
                    </div>
                    <div><span className="text-[#1B2D3C]/50">Total</span> £{((drawerBooking.finalSeats ?? drawerBooking.paintersCount) * partyPrice).toFixed(2)}</div>
                    <div>
                      <span className="text-[#1B2D3C]/50">Balance</span> £{(drawerBooking.finalBalance ?? Math.max(0, (drawerBooking.finalSeats ?? drawerBooking.paintersCount) * partyPrice - (drawerBooking.depositAmount ?? 50))).toFixed(2)}{' '}
                      {drawerBooking.finalPaidAt
                        ? <span className="text-emerald-700">· paid {new Date(drawerBooking.finalPaidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                        : <span className="text-amber-700">· due</span>}
                    </div>
                  </div>
                  {drawerBooking.paymentLinkUrl && (
                    <div className="text-[10px] text-[#1B2D3C]/60">
                      Link sent: {drawerBooking.paymentLinkSentAt ? new Date(drawerBooking.paymentLinkSentAt).toLocaleDateString('en-GB') : '—'}
                      <br />
                      <a href={drawerBooking.paymentLinkUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">Payment link</a>
                    </div>
                  )}
                  {!drawerBooking.depositPaidAt && !drawerBooking.stripePaymentIntentId && drawerBooking.email && (
                    <button
                      onClick={handleSendDepositLink}
                      disabled={sendingDepositLink}
                      className="w-full px-3 py-2 bg-[#1B2D3C] text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#1B2D3C]/90 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {sendingDepositLink ? 'Sending…' : `Email £${(drawerBooking.depositAmount ?? 50).toFixed(0)} deposit link`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Communication History */}
            <div className="border-t border-[#1B2D3C]/10 pt-4">
              <h4 className="text-[10px] font-black uppercase tracking-wider text-[#1B2D3C]/50 mb-3">Communication History</h4>
              {drawerCommLoading ? (
                <p className="text-xs text-[#1B2D3C]/40">Loading…</p>
              ) : drawerCommLogs.length === 0 ? (
                <p className="text-xs text-[#1B2D3C]/40">No emails or SMS sent for this booking.</p>
              ) : (
                <div className="space-y-2">
                  {drawerCommLogs.map(log => {
                    const isSMS = log.email_type.includes('sms');
                    return (
                      <div key={log.id} className="flex items-start gap-2 text-[10px]">
                        <span className={`shrink-0 px-1.5 py-0.5 font-black uppercase rounded ${isSMS ? 'bg-[#1B2D3C]/10 text-[#1B2D3C]/60' : 'bg-blue-100 text-blue-700'}`}>
                          {isSMS ? 'SMS' : 'Email'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-[#1B2D3C]">{log.email_type.replace(/_/g, ' ')}</p>
                          <p className="text-[#1B2D3C]/50">{new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <span className={`shrink-0 px-1.5 py-0.5 text-[9px] font-black uppercase rounded-full ${
                          log.status === 'delivered' || log.status === 'sent' ? 'bg-emerald-100 text-emerald-700'
                          : log.status === 'failed' || log.status === 'bounced' || log.status === 'undelivered' ? 'bg-red-100 text-red-700'
                          : log.status === 'opened' || log.status === 'clicked' ? 'bg-purple-100 text-purple-700'
                          : 'bg-stone-100 text-stone-600'
                        }`}>
                          {log.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action footer */}
            <div className="border-t border-[#1B2D3C]/10 p-4 space-y-2">
              <div className="flex gap-2">
                {tablePlanEnabled && (
                  <button onClick={() => { setAssignModalBooking(drawerBooking); setDrawerBooking(null); }}
                    className={`flex-1 px-3 py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${drawerBooking.tableId ? 'bg-[#DBE7E4] text-[#1B2D3C] border-[#1B2D3C]' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {drawerBooking.tableId ? `Tables: ${drawerBooking.tableId}` : 'Assign Table'}
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => { handleEditBooking(drawerBooking); setDrawerBooking(null); }}
                    className="px-3 py-2 text-xs font-bold rounded-lg border border-[#1B2D3C]/20 hover:bg-[#D6E2E9] transition-all cursor-pointer">
                    Edit
                  </button>
                )}
              </div>
              {canUpdateStatus && drawerBooking.status !== 'confirmed' && drawerBooking.status !== 'cancelled' && (
                <button onClick={async () => { await updateStatus(drawerBooking.id, 'confirmed'); setDrawerBooking(prev => prev ? { ...prev, status: 'confirmed' } : null); }}
                  disabled={confirmingIds.has(drawerBooking.id)}
                  className="w-full px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60">
                  <CheckCircle className="w-4 h-4" /> Confirm Booking
                </button>
              )}
              {canUpdateStatus && drawerBooking.status === 'confirmed' && (
                <button onClick={async () => { await updateStatus(drawerBooking.id, 'pending'); setDrawerBooking(prev => prev ? { ...prev, status: 'pending' } : null); }}
                  className="w-full px-3 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2">
                  <XCircle className="w-4 h-4" /> Mark as Awaiting
                </button>
              )}
              {canUpdateStatus && drawerBooking.status !== 'cancelled' && (
                <button onClick={async () => { await updateStatus(drawerBooking.id, 'cancelled'); setDrawerBooking(prev => prev ? { ...prev, status: 'cancelled' } : null); }}
                  className="w-full px-3 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2">
                  <XCircle className="w-4 h-4" /> Cancel Booking
                </button>
              )}
              {/* Collection stage actions for completed bookings */}
              {canEdit && drawerBooking.status === 'completed' && (() => {
                const stage = drawerBooking.collectionStatus ?? 'painted';
                return (
                  <>
                    {stage === 'painted' && (
                      <button onClick={async () => {
                        const updated = { ...drawerBooking, collectionStatus: 'ready' as CollectionStage };
                        setDrawerBooking(updated);
                        await handleSetCollectionStage(drawerBooking, 'ready');
                      }}
                        className="w-full px-3 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2">
                        <Package className="w-4 h-4" /> Mark as Ready to Collect
                      </button>
                    )}
                    {stage === 'ready' && (
                      <button onClick={async () => {
                        const updated = { ...drawerBooking, collectionStatus: 'collected' as CollectionStage, collectedAt: new Date().toISOString() };
                        setDrawerBooking(updated);
                        await handleSetCollectionStage(drawerBooking, 'collected');
                      }}
                        className="w-full px-3 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" /> Mark as Collected
                      </button>
                    )}
                    {stage === 'collected' && (
                      <button onClick={async () => {
                        const updated = { ...drawerBooking, collectionStatus: 'ready' as CollectionStage, collectedAt: undefined };
                        setDrawerBooking(updated);
                        await handleSetCollectionStage(drawerBooking, 'ready');
                      }}
                        className="w-full px-3 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2">
                        <ChevronDown className="w-4 h-4" /> Move Back to Ready
                      </button>
                    )}
                  </>
                );
              })()}
              {canDelete && (
                <button onClick={() => { deleteInquiry(drawerBooking.id); setDrawerBooking(null); }}
                  className="w-full px-3 py-2 text-[10px] font-bold text-red-400 hover:text-red-600 transition-all cursor-pointer text-center">
                  Delete booking
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Admin Footer */}
      <div className="border-t border-[#1B2D3C]/10 mt-8 px-4 py-3 flex items-center justify-between text-[10px] font-bold text-[#1B2D3C]/40 uppercase tracking-wider">
        <span>Pitter Potter Admin</span>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-stone-300'}`} />
          <span className={realtimeConnected ? 'text-emerald-600' : 'text-stone-400'}>{realtimeConnected ? 'Realtime Connected' : 'Realtime Disconnected'}</span>
        </div>
      </div>
    </div>
  );
}

// --- Grouped Navigation Dropdowns ---

type TabValue = 'dashboard' | 'bookings' | 'painted' | 'ready' | 'collected' | 'gift-cards' | 'floor-plan' | 'settings' | 'analytics' | 'audit-logs' | 'webmaster' | 'email-logs' | 'email-templates' | 'sms' | 'documentation';

function NavDropdown({
  label,
  items,
  activeTab,
  setActiveTab,
}: {
  label: string;
  items: { value: TabValue; label: string }[];
  activeTab: TabValue;
  setActiveTab: (t: TabValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeItem = items.find((i) => i.value === activeTab);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative px-4 py-3 text-xs font-bold tracking-wide border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
          activeItem
            ? 'border-[#1B2D3C] text-[#1B2D3C]'
            : 'border-transparent text-[#1B2D3C]/50 hover:text-[#1B2D3C]'
        }`}
      >
        {activeItem ? activeItem.label : label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0 min-w-[180px] bg-white border border-[#1B2D3C]/15 shadow-lg rounded-b-lg overflow-hidden z-50">
          {items.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setActiveTab(item.value);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-all cursor-pointer ${
                activeTab === item.value
                  ? 'bg-[#DBE7E4] text-[#1B2D3C]'
                  : 'text-[#1B2D3C]/70 hover:bg-[#DBE7E4]/40 hover:text-[#1B2D3C]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LogsDropdown({
  activeTab,
  setActiveTab,
  isSuperAdmin,
}: {
  activeTab: TabValue;
  setActiveTab: (t: TabValue) => void;
  isSuperAdmin: boolean;
}) {
  const items: { value: TabValue; label: string }[] = [
    { value: 'audit-logs', label: 'Audit Logs' },
    { value: 'email-logs', label: 'Email Logs' },
    { value: 'email-templates', label: 'Email & SMS Templates' },
  ];
  return <NavDropdown label="Logs" items={items} activeTab={activeTab} setActiveTab={setActiveTab} />;
}

function AdminDropdown({
  activeTab,
  setActiveTab,
  isSuperAdmin,
}: {
  activeTab: TabValue;
  setActiveTab: (t: TabValue) => void;
  isSuperAdmin: boolean;
}) {
  const items: { value: TabValue; label: string }[] = [
    { value: 'analytics', label: 'Analytics' },
    { value: 'settings', label: 'Settings' },
    { value: 'documentation', label: 'Documentation' },
    ...(isSuperAdmin ? [{ value: 'webmaster' as TabValue, label: 'Webmaster' }] : []),
  ];
  return <NavDropdown label="Admin" items={items} activeTab={activeTab} setActiveTab={setActiveTab} />;
}

function TabSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      <Skeleton className="h-8 w-48" />
      <div className="bg-white border border-[#1B2D3C]/10 rounded-xl p-6 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}
