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

/** fetch() against the API with whichever credentials this platform uses. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (isNativeApp()) {
    headers.set("X-XOCRISK-Client", "app");
    const token = appToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${authApiOrigin}${path}`, { ...init, headers, credentials: "include" });
}

export function useAuthApi() {
  return useCallback((path: string, init: RequestInit = {}) => apiFetch(path, init), []);
}

export async function createAuthSession(
  path: "/v1/auth/login" | "/v1/auth/signup",
  body: Record<string, unknown>,
): Promise<{ success: true; email: string | null } | { success: false; message: string }> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { user?: { email?: string | null }; token?: string; message?: string };
  if (!response.ok || !result.user) {
    return { success: false, message: result.message ?? "Authentication could not be completed." };
  }
  if (result.token) setAppToken(result.token);
  return { success: true, email: result.user.email ?? null };
}
