"use client";

import { useCallback } from "react";

export const authApiOrigin = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export function useAuthApi() {
  return useCallback(
    (path: string, init: RequestInit = {}) =>
      fetch(`${authApiOrigin}${path}`, { ...init, credentials: "include" }),
    [],
  );
}

export async function createAuthSession(
  path: "/v1/auth/login" | "/v1/auth/signup",
  body: Record<string, unknown>,
): Promise<{ success: true; email: string | null } | { success: false; message: string }> {
  const response = await fetch(`${authApiOrigin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const result = await response.json() as { user?: { email?: string | null }; message?: string };
  if (!response.ok || !result.user) {
    return { success: false, message: result.message ?? "Authentication could not be completed." };
  }
  return { success: true, email: result.user.email ?? null };
}
