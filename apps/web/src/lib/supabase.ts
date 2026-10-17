"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase Auth only does the Google step here; the XOCRISK API then signs the verified email in.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

export const supabaseConfigured = Boolean(url && publishableKey);

export function supabase(): SupabaseClient | null {
  if (!url || !publishableKey || typeof window === "undefined") return null;
  // PKCE keeps the one-time code verifier in this browser, so the code is useless to anyone else.
  client ??= createClient(url, publishableKey, { auth: { flowType: "pkce", autoRefreshToken: false, detectSessionInUrl: false } });
  return client;
}

/** Sends the browser to Google (via Supabase). Comes back to /sso-callback/. */
export async function startGoogleLogin(): Promise<string | null> {
  const auth = supabase()?.auth;
  if (!auth) return "Google sign-in isn't set up yet. Use your email and password.";
  const { error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/sso-callback/`, queryParams: { prompt: "select_account" } },
  });
  return error ? "Couldn't open Google sign-in. Try again." : null;
}
