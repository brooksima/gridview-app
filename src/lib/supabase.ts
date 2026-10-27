import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_ANON_KEY || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const BUCKET = 'photos';

/** Always-anonymous client for the public demo: never reads or writes the signed-in session,
 *  so the demo only ever sees what the anon RLS policies allow (the Demo company). */
let demo: SupabaseClient | null = null;
export const demoClient = () => demo ??= createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_ANON_KEY || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'gv-demo-anon' },
});

/** True when the URL is the public demo: /demo, /demo/ or #/demo. */
export const isDemoRoute = () =>
  /\/demo\/?$/.test(window.location.pathname) || /^#\/?demo\b/.test(window.location.hash);
