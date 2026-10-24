"use client";

import { useCallback } from "react";

export const authApiOrigin = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

// Inside the Android/iOS app the session is a long-lived token kept on the device (cookies from the API's
// domain don't reach the app's https://localhost pages). On the web it stays an HttpOnly cookie.
const tokenKey = "xocrisk.app.token";

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

export function appToken(): string | null {
  if (!isNativeApp()) return null;
  try { return localStorage.getItem(tokenKey); } catch { return null; }
}

export function setAppToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(tokenKey, token);
    else localStorage.removeItem(tokenKey);
  } catch { /* storage blocked */ }
}

// Set while this device has a session, so the login page can send people straight to the dashboard before it
// even draws (see signedInBootScript). The session itself stays in the HttpOnly cookie / app token.
const signedInKey = "xocrisk.signedIn";

export function markSignedIn(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(signedInKey, "1");
    else localStorage.removeItem(signedInKey);
  } catch { /* storage blocked */ }
}

/** fetch() against the API with whichever credentials this platform uses. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (isNativeApp()) {
    headers.set("X-XOCRISK-Client", "app");
    const token = appToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  // A trailing slash skips the site's slash redirect, which would otherwise add a round trip to every call.
  const [pathname, query] = path.split("?");
  const url = `${authApiOrigin}${pathname.endsWith("/") ? pathname : `${pathname}/`}${query === undefined ? "" : `?${query}`}`;
  return fetch(url, { ...init, headers, credentials: "include" });
}

let lastPreferenceSave = 0;

/** True for a few seconds after a change here, while an older copy of the settings may still be in flight. */
export function preferencesJustChanged(): boolean {
  return Date.now() - lastPreferenceSave < 8000;
}

/** Saves settings on the account (privacy, watchlist) so the app and the website stay the same. */
export function savePreferences(changes: { privacy?: boolean; watchlist?: string[] }): void {
  lastPreferenceSave = Date.now();
  void apiFetch("/v1/auth/preferences", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
  }).catch(() => undefined);
}

export function useAuthApi() {
  return useCallback((path: string, init: RequestInit = {}) => apiFetch(path, init), []);
}

export async function createAuthSession(
  path: "/v1/auth/login" | "/v1/auth/signup",
  body: Record<string, unknown>,
): Promise<{ success: true; email: string | null } | { success: false; message: string }> {
  let response: Response;
  try {
    response = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { success: false, message: "Couldn't reach XOCRISK. Check your connection and try again." };
  }
  const result = await response.json().catch(() => null) as { user?: { email?: string | null }; token?: string; message?: string } | null;
  if (!result || typeof result !== "object") {
    return { success: false, message: "XOCRISK is temporarily unavailable. Try again in a minute." };
  }
  if (!response.ok || !result.user) {
    return { success: false, message: result.message ?? "Authentication could not be completed." };
  }
  if (result.token) setAppToken(result.token);
  markSignedIn(true);
  return { success: true, email: result.user.email ?? null };
}
