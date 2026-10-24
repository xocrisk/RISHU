"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authApiOrigin, isNativeApp } from "./auth-session";
import { getSupabaseClient } from "./supabase/client";
export { supabaseConfigured } from "./supabase/client";
export const supabase = getSupabaseClient;

/** Sends the browser to Google (via Supabase). Comes back to /sso-callback/. */
export async function startGoogleLogin(): Promise<string | null> {
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
