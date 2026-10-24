"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFetch, authApiOrigin, isNativeApp } from "./auth-session";
import { getSupabaseClient } from "./supabase/client";
export { supabaseConfigured } from "./supabase/client";
export const supabase = getSupabaseClient;

let ensuring: Promise<string | null> | null = null;

/** Make sure there's a Supabase Auth session for the signed-in trader, so Friends & Groups (RLS/Realtime) works.
 *  Email/password logins never get one from the OAuth flow, and an app reinstall wipes a Google user's stored
 *  session; in both cases we mint a fresh one from the existing trading session. Returns null once a session exists,
 *  otherwise a message to show (e.g. the email still needs verifying). */
export async function ensureSupabaseSession(): Promise<string | null> {
  const auth = supabase()?.auth;
  if (!auth) return "Friends & Groups isn't set up yet. Try again later.";
  const existing = await auth.getUser();
  if (!existing.error && existing.data.user) return null;
  // Dedupe concurrent callers so we only mint and verify one token.
  ensuring ??= mintSupabaseSession(auth).finally(() => { ensuring = null; });
  return ensuring;
}

async function mintSupabaseSession(auth: SupabaseClient["auth"]): Promise<string | null> {
  const failed = "Friends & Groups couldn't connect to your account. Check your connection and try again.";
  let response: Response;
  try {
    response = await apiFetch("/v1/auth/supabase-session", { method: "POST", signal: AbortSignal.timeout(20_000) });
  } catch {
    return failed;
  }
  const body = await response.json().catch(() => null) as { tokenHash?: string; message?: string } | null;
  if (!response.ok || !body?.tokenHash) return body?.message || failed;
  const { error } = await auth.verifyOtp({ type: "magiclink", token_hash: body.tokenHash });
  return error ? failed : null;
}

/** Sends the browser to Google (via Supabase). Comes back to /sso-callback/. */
export async function startGoogleLogin(): Promise<string | null> {
  try {
    return await openGoogleLogin();
  } catch {
    return "Couldn't open Google sign-in. Check your connection and try again.";
  }
}

async function openGoogleLogin(): Promise<string | null> {
  const auth = supabase()?.auth;
  if (!auth) return "Google sign-in isn't set up yet. Use your email and password.";
  if (isNativeApp()) return startGoogleLoginInApp(auth);
  const { error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/sso-callback/`, queryParams: { prompt: "select_account" } },
  });
  return error ? "Couldn't open Google sign-in. Try again." : null;
}

// Google refuses sign-in inside app web views, so the app opens the phone's browser instead. The browser comes
// back through the live site's /v1/auth/app-callback, which reopens the app at com.xocrisk.app://sso-callback
// (handled in NativeDeepLinks). The PKCE verifier stays in the app, which finishes the exchange itself.
async function startGoogleLoginInApp(auth: SupabaseClient["auth"]): Promise<string | null> {
  const { data, error } = await auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${authApiOrigin}/v1/auth/app-callback/`,
      queryParams: { prompt: "select_account" },
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) return "Couldn't open Google sign-in. Try again.";
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover" });
  return null;
}
