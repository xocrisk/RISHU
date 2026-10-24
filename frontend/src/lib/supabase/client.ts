"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = Boolean(url && anonKey);
let client: SupabaseClient | null = null;

/** One shared Auth/Realtime client. Never use a service-role key in the browser. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!url || !anonKey || typeof window === "undefined") return null;
  client ??= createClient(url, anonKey, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
