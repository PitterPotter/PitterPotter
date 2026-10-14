import { createClient } from 'supabase';
import { isObject, isNonEmptyString, isInteger } from '../_shared/validate.ts';
import { verifyStaff } from '../_shared/auth.ts';
import { corsHeaders as makeCorsHeaders, optionsResponse } from '../_shared/cors.ts';

// The admin feed is deliberately limited to new bookings (online + walk-in),
// paid-deposit failures, voucher purchases, and cancellations. Routine status
// changes (seated/completed/etc.), redemptions and collection-ready alerts are
// no longer created, and older rows of those types stay hidden.
const ACTIVE_TYPES = [
  'booking_new',
  'booking_walk_in',
  'booking_failed',
  'gift_card_purchased',
  'booking_cancelled',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return optionsResponse(req, true);
  }
  const corsHeaders = makeCorsHeaders(req, true);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    if (!isObject(body)) {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { action, username, sessionToken } = body;

    if (!isNonEmptyString(action) || !isNonEmptyString(username) || !isNonEmptyString(sessionToken)) {
      return new Response(JSON.stringify({ error: 'Missing action, username, or sessionToken' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const staff = await verifyStaff(supabase, username, sessionToken);
    if (!staff) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build studio filter for non-super_admin staff
    const studioFilter = staff.role !== 'super_admin' && staff.allowed_studios && staff.allowed_studios.length > 0
      ? staff.allowed_studios
      : null;

    if (action === 'list') {
      const { limit = 50, offset = 0 } = body;
      let query = supabase
        .from('notifications')
        .select('*')
        .in('type', ACTIVE_TYPES)
        .order('created_at', { ascending: false })
        .range(offset, offset + (isInteger(limit) ? limit : 50) - 1);

      if (studioFilter) {
        query = query.in('studio', [...studioFilter, 'All']);
      }

      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ notifications: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'unreadCount') {
      let query = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
        .in('type', ACTIVE_TYPES);

      if (studioFilter) {
        query = query.in('studio', [...studioFilter, 'All']);
      }

      const { count, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ count: count || 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'markRead') {
      const { id } = body;
      if (!isNonEmptyString(id)) {
        return new Response(JSON.stringify({ error: 'Missing notification id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'markAllRead') {
      let query = supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null);

      if (studioFilter) {
        query = query.in('studio', [...studioFilter, 'All']);
      }

      const { error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'loadSettings') {
      if (staff.role !== 'super_admin') {
        return new Response(JSON.stringify({ error: 'Super admin only' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .in('type', ACTIVE_TYPES)
        .order('type', { ascending: true })
        .order('studio', { ascending: true });

      if (error) throw error;
      return new Response(JSON.stringify({ settings: data || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'updateSetting') {
      if (staff.role !== 'super_admin') {
        return new Response(JSON.stringify({ error: 'Super admin only' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { id, enabled, customTitle, customMessage } = body;
      if (!isNonEmptyString(id)) {
        return new Response(JSON.stringify({ error: 'Missing setting id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof enabled === 'boolean') update.enabled = enabled;
      if (customTitle !== undefined) update.custom_title = customTitle || null;
      if (customMessage !== undefined) update.custom_message = customMessage || null;

      const { error } = await supabase
        .from('notification_settings')
        .update(update)
        .eq('id', id);

      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'addSetting') {
      if (staff.role !== 'super_admin') {
        return new Response(JSON.stringify({ error: 'Super admin only' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { type, studio: settingStudio } = body;
      if (!isNonEmptyString(type) || !isNonEmptyString(settingStudio) || !ACTIVE_TYPES.includes(type)) {
        return new Response(JSON.stringify({ error: 'Missing type or studio' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data, error } = await supabase
        .from('notification_settings')
        .upsert({
          type,
          studio: settingStudio,
          enabled: true,
        }, { onConflict: 'type,studio' })
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ setting: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'deleteSetting') {
      if (staff.role !== 'super_admin') {
        return new Response(JSON.stringify({ error: 'Super admin only' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { id } = body;
      if (!isNonEmptyString(id)) {
        return new Response(JSON.stringify({ error: 'Missing setting id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await supabase
        .from('notification_settings')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Admin notifications error:', err);
    return new Response(JSON.stringify({ error: 'Failed to process request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
