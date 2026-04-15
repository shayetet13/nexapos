import { createClient } from '@supabase/supabase-js';

const supabaseUrl         = process.env.SUPABASE_URL              ?? '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !supabaseServiceRole) {
  console.warn('[supabase-admin] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
}

/**
 * Admin client — bypasses Row Level Security.
 * Use ONLY on the server side for trusted operations (e.g. creating users).
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession:   false,
  },
});
