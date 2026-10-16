import { useState, useEffect, useCallback } from 'react';
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import type { NotificationSetting, NotificationType, Staff } from '../../types';
import {
  fetchNotificationSettings,
  updateNotificationSetting,
  addNotificationSetting,
  deleteNotificationSetting,
} from '../../lib/notifications';

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  booking_new: 'New Booking',
  booking_cancelled: 'Booking Cancelled',
  booking_status_changed: 'Booking Status Changed',
  booking_walk_in: 'Walk-in Booking',
  booking_failed: 'Booking Failed (Paid)',
  gift_card_purchased: 'Gift Card Purchased',
  gift_card_redeemed: 'Gift Card Redeemed',
  collection_ready: 'Collection Ready',
  staff_action: 'Staff Action',
  epos_refund: 'EPOS Refund',
};

// Only types that still produce notifications — status changes, redemptions
// and collection-ready alerts no longer fire, so they can't be configured.
const ALL_TYPES: NotificationType[] = [
  'booking_new',
  'booking_walk_in',
  'booking_cancelled',
  'booking_failed',
  'gift_card_purchased',
];
const STUDIOS = ['All', 'Putney', 'Wimbledon'];

interface Props {
  staff: Staff;
}

export function NotificationSettings({ staff }: Props) {
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [newType, setNewType] = useState<NotificationType>('booking_new');
  const [newStudio, setNewStudio] = useState('All');
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotificationSettings(staff);
      setSettings(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [staff]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (setting: NotificationSetting) => {
    const newEnabled = !setting.enabled;
    setSettings(prev => prev.map(s => s.id === setting.id ? { ...s, enabled: newEnabled } : s));
    try {
      await updateNotificationSetting(staff, setting.id, { enabled: newEnabled });
    } catch {
      setSettings(prev => prev.map(s => s.id === setting.id ? { ...s, enabled: setting.enabled } : s));
    }
  };

  const handleSaveCustom = async (setting: NotificationSetting) => {
    try {
      await updateNotificationSetting(staff, setting.id, {
        customTitle: editTitle.trim() || undefined,
        customMessage: editMessage.trim() || undefined,
      });
      setSettings(prev => prev.map(s => s.id === setting.id ? {
        ...s,
        custom_title: editTitle.trim() || null,
        custom_message: editMessage.trim() || null,
      } : s));
      setEditingId(null);
    } catch {
      // ignore
    }
  };

  const handleAdd = async () => {
    try {
      const newSetting = await addNotificationSetting(staff, newType, newStudio);
      if (newSetting) {
        setSettings(prev => [...prev, newSetting]);
        setShowAdd(false);
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    setSettings(prev => prev.filter(s => s.id !== id));
    try {
      await deleteNotificationSetting(staff, id);
    } catch {
      // ignore
    }
  };

  const startEdit = (setting: NotificationSetting) => {
    setEditingId(setting.id);
    setEditTitle(setting.custom_title || '');
    setEditMessage(setting.custom_message || '');
  };

  // Group settings by type
  const grouped = settings.reduce<Record<string, NotificationSetting[]>>((acc, s) => {
    if (!acc[s.type]) acc[s.type] = [];
    acc[s.type].push(s);
    return acc;
  }, {});

  // Find types that don't have any settings yet
  const availableTypes = ALL_TYPES.filter(t => !grouped[t] || !grouped[t].some(s => s.studio === newStudio));

  return (
    <div className="bg-white border border-[#1B2D3C]/10 p-6 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-[#1B2D3C]" />
          <h3 className="font-heading text-lg font-black text-[#1B2D3C] uppercase tracking-wider">Notification Settings</h3>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1B2D3C] text-white text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-[#243B53] transition-all cursor-pointer"
        >
          <Plus className="w-3 h-3" /> Add Rule
        </button>
      </div>

      <p className="text-xs text-[#1B2D3C]/60">
        Control which notifications are created and customize their title and message. Studio-specific rules override the 'All' rule.
      </p>

      {showAdd && (
        <div className="flex items-center gap-3 p-3 bg-[#D6E2E9]/20 rounded-lg">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as NotificationType)}
            className="text-xs font-bold text-[#1B2D3C] border border-[#1B2D3C]/20 rounded-lg px-2 py-1.5 bg-white"
          >
            {ALL_TYPES.map(t => <option key={t} value={t}>{NOTIFICATION_TYPE_LABELS[t]}</option>)}
          </select>
          <select
            value={newStudio}
            onChange={(e) => setNewStudio(e.target.value)}
            className="text-xs font-bold text-[#1B2D3C] border border-[#1B2D3C]/20 rounded-lg px-2 py-1.5 bg-white"
          >
            {STUDIOS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            onClick={handleAdd}
            disabled={availableTypes.length === 0}
            className="px-3 py-1.5 bg-emerald-500 text-white text-[10px] font-bold uppercase rounded-lg hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Add
          </button>
          <button
            onClick={() => setShowAdd(false)}
            className="px-3 py-1.5 text-[#1B2D3C]/50 text-[10px] font-bold uppercase rounded-lg hover:text-[#1B2D3C] cursor-pointer"
          >
            Cancel
          </button>
          {availableTypes.length === 0 && (
            <span className="text-[10px] text-[#1B2D3C]/40">All types already have a rule for {newStudio}</span>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-[#1B2D3C]/40 py-4 text-center">Loading settings…</p>
      ) : settings.length === 0 ? (
        <p className="text-xs text-[#1B2D3C]/40 py-4 text-center">No notification settings configured.</p>
      ) : (
        <div className="space-y-3">
          {ALL_TYPES.map(type => {
            const typeSettings = grouped[type];
            if (!typeSettings || typeSettings.length === 0) return null;
            return (
              <div key={type} className="border border-[#1B2D3C]/10 rounded-lg overflow-hidden">
                <div className="bg-[#1B2D3C]/5 px-3 py-2">
                  <span className="text-xs font-bold text-[#1B2D3C] uppercase tracking-wider">{NOTIFICATION_TYPE_LABELS[type]}</span>
                </div>
                <div className="divide-y divide-[#1B2D3C]/5">
                  {typeSettings.sort((a, b) => a.studio.localeCompare(b.studio)).map(setting => (
                    <div key={setting.id} className="px-3 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggle(setting)}
                            className="cursor-pointer"
                            title={setting.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                          >
                            {setting.enabled
                              ? <ToggleRight className="w-7 h-7 text-emerald-500" />
                              : <ToggleLeft className="w-7 h-7 text-[#1B2D3C]/30" />}
                          </button>
                          <span className={`text-xs font-bold ${setting.enabled ? 'text-[#1B2D3C]' : 'text-[#1B2D3C]/40'}`}>
                            {setting.studio}
                          </span>
                          {setting.custom_title && (
                            <span className="text-[10px] text-[#1B2D3C]/40 italic">custom title</span>
                          )}
                          {setting.custom_message && (
                            <span className="text-[10px] text-[#1B2D3C]/40 italic">custom message</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => editingId === setting.id ? setEditingId(null) : startEdit(setting)}
                            className="text-[10px] font-bold uppercase text-[#1B2D3C]/50 hover:text-[#1B2D3C] cursor-pointer"
                          >
                            {editingId === setting.id ? 'Close' : 'Customize'}
                          </button>
                          <button
                            onClick={() => handleDelete(setting.id)}
                            className="text-[#1B2D3C]/30 hover:text-red-500 cursor-pointer"
                            title="Delete rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {editingId === setting.id && (
                        <div className="mt-2 space-y-2 pl-9">
                          <div>
                            <label className="text-[10px] font-bold uppercase text-[#1B2D3C]/50 block mb-1">Custom Title</label>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              placeholder="Leave empty to use default"
                              className="w-full px-2 py-1.5 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-semibold rounded-lg focus:outline-none focus:border-[#1B2D3C]/40 bg-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase text-[#1B2D3C]/50 block mb-1">Custom Message</label>
                            <textarea
                              value={editMessage}
                              onChange={(e) => setEditMessage(e.target.value)}
                              placeholder="Leave empty to use default"
                              rows={2}
                              className="w-full px-2 py-1.5 border border-[#1B2D3C]/20 text-xs text-[#1B2D3C] font-semibold rounded-lg focus:outline-none focus:border-[#1B2D3C]/40 bg-white resize-none"
                            />
                          </div>
                          <button
                            onClick={() => handleSaveCustom(setting)}
                            className="px-3 py-1.5 bg-emerald-500 text-white text-[10px] font-bold uppercase rounded-lg hover:bg-emerald-600 cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
