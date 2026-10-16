import { createClient } from 'supabase';
import bcryptjs from 'bcrypt';
import { isObject, isNonEmptyString } from '../_shared/validate.ts';
import { isRateLimited, rateLimitResponse, getClientIp } from '../_shared/rate-limit.ts';
import type { StaffRecord } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateToken(): string {
  return crypto.randomUUID();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(`login:${clientIp}`, 10, 60_000)) {
    return rateLimitResponse();
  }

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
    const { username, password } = body;
    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
      return new Response(JSON.stringify({ error: 'Missing credentials' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('username', username)
      .single() as { data: StaffRecord | null; error: Error | null };

    if (error || !staff) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let passwordValid = false;
    const storedHash = staff.password_hash || '';
    const isLegacyHash = /^[a-f0-9]{64}$/i.test(storedHash);
    if (isLegacyHash) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const passwordHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      passwordValid = passwordHash.toLowerCase() === storedHash.toLowerCase();
    } else {
      passwordValid = await bcryptjs.compare(password, storedHash);
    }

    if (!passwordValid) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Migrate legacy SHA-256 hashes to bcrypt on successful login
    if (isLegacyHash) {
      try {
        const newHash = await bcryptjs.hash(password, 10);
        await supabase.from('staff').update({ password_hash: newHash }).eq('id', staff.id);
      } catch (err) {
        console.error('Failed to migrate password hash:', err);
      }
    }

    const token = generateToken();

    // Insert into staff_sessions for multi-session support
    const { error: sessionError } = await supabase
      .from('staff_sessions')
      .insert({ staff_id: staff.id, session_token: token });

    if (sessionError) throw sessionError;

    // Also update staff.session_token for backward compatibility
    await supabase
      .from('staff')
      .update({ session_token: token, session_expires_at: null })
      .eq('id', staff.id);

    return new Response(JSON.stringify({
      id: staff.id,
      name: staff.name,
      username: staff.username,
      role: staff.role,
      canUpdateStatus: staff.can_update_status,
      canEditBookings: staff.can_edit_bookings,
      canAddWalkIns: staff.can_add_walk_ins,
      canDeleteBookings: staff.can_delete_bookings,
      canEposRefunds: staff.can_epos_refunds,
      canEposDiscounts: staff.can_epos_discounts,
      canEposManageProducts: staff.can_epos_manage_products,
      allowedStudios: staff.allowed_studios ?? null,
      sessionToken: token,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Staff login error:', err);
    return new Response(JSON.stringify({ error: 'Failed to login' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
