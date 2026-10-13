import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, CheckCheck, Calendar, Users, Gift, Camera, UserCog, AlertCircle } from 'lucide-react';
import { AppNotification, NotificationType, Staff } from '../../types';
import { supabase, isSupabaseEnabled } from '../../lib/supabase';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../../lib/notifications';

interface NotificationBellProps {
  staff: Staff;
  studioFilter?: 'all' | 'Putney' | 'Wimbledon';
  onNavigate: (tab: string, entityId?: string) => void;
}

const NOTIFICATION_ICONS: Record<NotificationType, typeof Bell> = {
  booking_new: Calendar,
  booking_cancelled: AlertCircle,
  booking_status_changed: CheckCheck,
  booking_walk_in: Users,
  gift_card_purchased: Gift,
  gift_card_redeemed: Gift,
  collection_ready: Camera,
  staff_action: UserCog,
};

const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  booking_new: 'text-emerald-600 bg-emerald-50',
  booking_cancelled: 'text-red-600 bg-red-50',
  booking_status_changed: 'text-blue-600 bg-blue-50',
  booking_walk_in: 'text-indigo-600 bg-indigo-50',
  gift_card_purchased: 'text-purple-600 bg-purple-50',
  gift_card_redeemed: 'text-amber-600 bg-amber-50',
  collection_ready: 'text-cyan-600 bg-cyan-50',
  staff_action: 'text-stone-600 bg-stone-50',
};

// Persistent audio context — unlocked on first user interaction
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

function playTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  // First tone: 880Hz
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(880, now);
  gain1.gain.setValueAtTime(0.3, now);
  gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
  osc1.start(now);
  osc1.stop(now + 0.15);
  // Second tone: 660Hz (ding-dong)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(660, now + 0.15);
  gain2.gain.setValueAtTime(0, now + 0.14);
  gain2.gain.linearRampToValueAtTime(0.3, now + 0.16);
  gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
  osc2.start(now + 0.15);
  osc2.stop(now + 0.4);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function NotificationBell({ staff, studioFilter = 'all', onNavigate }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Fetch the list (not just a count) so the badge can be scoped to the selected studio.
  // Global/"All" notifications always show regardless of selection.
  const loadNotifications = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const list = await fetchNotifications(staff, 50);
      setNotifications(list);
    } catch {
      // ignore
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [staff]);

  const visibleNotifications = notifications.filter(n =>
    studioFilter === 'all' || !n.studio || n.studio === 'All' || n.studio === studioFilter
  );
  const unreadCount = visibleNotifications.filter(n => !n.read_at).length;

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(() => loadNotifications(), 30_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Unlock audio on first user interaction (browsers require this)
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Play notification sound
  const playNotificationSound = useCallback(() => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => playTone(ctx)).catch(() => {});
      } else {
        playTone(ctx);
      }
    } catch {
      // AudioContext not available
    }
  }, []);

  // Realtime subscription for instant unread count updates
  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase) return;
    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => { playNotificationSound(); loadNotifications(); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        () => { loadNotifications(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadNotifications, playNotificationSound]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleBellClick = () => {
    const newOpen = !open;
    setOpen(newOpen);
    if (newOpen) loadNotifications(true);
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    if (!notif.read_at) {
      await markNotificationRead(staff, notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read_at: new Date().toISOString() } : n));
    }
    setOpen(false);
    if (notif.entity_type === 'booking') {
      if (notif.type === 'collection_ready') {
        onNavigate('ready', notif.entity_id);
      } else {
        onNavigate('bookings', notif.entity_id);
      }
    } else if (notif.entity_type === 'gift_card') {
      onNavigate('gift-cards', notif.entity_id);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead(staff);
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
  };

  return (
    <div className="relative">
      <button
        ref={bellRef}
        onClick={handleBellClick}
        className="relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-[#1B2D3C]/10 transition-all cursor-pointer min-h-[44px]"
        title="Notifications"
      >
        <Bell className="w-5 h-5 text-[#1B2D3C]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[9px] font-black bg-red-500 text-white rounded-full ring-2 ring-[#DBE7E4]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-12 z-[60] w-[380px] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-[#1B2D3C]/10 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1B2D3C]/10 bg-[#DBE7E4]/50">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#1B2D3C]" />
              <span className="font-heading font-black text-sm text-[#1B2D3C]">Notifications</span>
              {unreadCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[8px] font-black bg-red-500 text-white rounded-full">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-[#1B2D3C]/60 hover:text-[#1B2D3C] hover:bg-[#1B2D3C]/5 rounded transition-all cursor-pointer"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3 h-3" /> Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-[#1B2D3C]/40 hover:text-[#1B2D3C] hover:bg-[#1B2D3C]/5 rounded transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-[420px] overflow-y-auto">
            {loading && (
              <div className="px-4 py-8 text-center">
                <div className="inline-block w-6 h-6 border-2 border-[#1B2D3C]/20 border-t-[#1B2D3C] rounded-full animate-spin" />
              </div>
            )}

            {!loading && visibleNotifications.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Bell className="w-8 h-8 text-[#1B2D3C]/20 mx-auto mb-2" />
                <p className="text-xs font-bold text-[#1B2D3C]/40">No notifications yet</p>
              </div>
            )}

            {!loading && visibleNotifications.map((notif) => {
              const Icon = NOTIFICATION_ICONS[notif.type] || Bell;
              const colorClass = NOTIFICATION_COLORS[notif.type] || 'text-stone-600 bg-stone-50';
              const isUnread = !notif.read_at;

              return (
                <button
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-[#1B2D3C]/5 transition-all cursor-pointer hover:bg-[#DBE7E4]/30 ${
                    isUnread ? 'bg-blue-50/30' : ''
                  }`}
                >
                  <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${colorClass}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-[#1B2D3C] truncate">{notif.title}</p>
                      {isUnread && (
                        <span className="shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <p className="text-[11px] text-[#1B2D3C]/60 mt-0.5 line-clamp-2">{notif.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] font-bold text-[#1B2D3C]/30 uppercase tracking-wider">
                        {timeAgo(notif.created_at)}
                      </span>
                      {notif.studio && (
                        <span className="text-[9px] font-bold text-[#1B2D3C]/30 uppercase tracking-wider">
                          · {notif.studio}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
