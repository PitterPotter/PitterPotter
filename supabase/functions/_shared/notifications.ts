import type { AdminSupabaseClient } from './types.ts';

export type NotificationType =
  | 'booking_new'
  | 'booking_cancelled'
  | 'booking_status_changed'
  | 'booking_walk_in'
  | 'booking_failed'
  | 'gift_card_purchased'
  | 'gift_card_redeemed'
  | 'collection_ready'
  | 'epos_refund'
  | 'staff_action';

export async function createNotification(
  supabase: AdminSupabaseClient,
  params: {
    type: NotificationType;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
    studio?: string;
  },
): Promise<void> {
  try {
    // Check notification settings — look for studio-specific setting first, then 'All'
    const studio = params.studio || 'All';
    const { data: settings } = await supabase
      .from('notification_settings')
      .select('enabled, custom_title, custom_message')
      .eq('type', params.type)
      .in('studio', [studio, 'All'])
      .order('studio', { ascending: false }) // studio-specific first
      .limit(1);

    if (settings && settings.length > 0) {
      const setting = settings[0];
      if (!setting.enabled) return; // Skip if disabled
      // Apply custom title/message if set
      if (setting.custom_title) params.title = setting.custom_title;
      if (setting.custom_message) params.message = setting.custom_message;
    }

    await supabase.from('notifications').insert({
      type: params.type,
      title: params.title,
      message: params.message,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      studio: params.studio || null,
    });
  } catch (err) {
    console.error('createNotification error:', err);
  }
}
