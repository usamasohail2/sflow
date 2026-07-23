import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type PresenceRow = {
  visitor_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  color: number;
  last_seen: string;
};

export type ChatRow = {
  id: string;
  visitor_id: string;
  name: string;
  text: string;
  color: number;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  created_at: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __isbSupabase: SupabaseClient | undefined;
}

/** True when server-side Supabase credentials are present */
export function hasSupabase(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

/**
 * Server-only Supabase client (service role). Bypasses RLS — use only from
 * API routes / server libs, never expose the service key to the browser.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (globalThis.__isbSupabase) return globalThis.__isbSupabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  globalThis.__isbSupabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return globalThis.__isbSupabase;
}
