import { authApiOrigin } from "./auth-session";

// Lets the login and signup forms start loading the dashboard the moment the session exists,
// so /account can render as soon as it mounts instead of starting the request from scratch.
let prefetched: { at: number; response: Promise<Response> } | null = null;
const snapshotKey = "xocrisk.dashboard.v1";

export function prefetchDashboard(email: string | null): void {
  // A saved dashboard from someone else who used this tab must never flash up for the new user.
  const snapshot = readDashboardSnapshot<{ user?: { email?: string } }>();
  if (snapshot && (!email || snapshot.user?.email?.toLowerCase() !== email.toLowerCase())) {
    try { sessionStorage.removeItem(snapshotKey); } catch { /* storage blocked */ }
  }
  prefetched = { at: Date.now(), response: fetch(`${authApiOrigin}/v1/practice/dashboard`, { credentials: "include" }) };
}

/** The prefetched dashboard response, if one was started in the last 30 seconds. Can be taken once. */
export function takePrefetchedDashboard(): Promise<Response> | null {
  if (!prefetched || Date.now() - prefetched.at > 30_000) return null;
  const { response } = prefetched;
  prefetched = null;
  return response;
}

/** Last dashboard seen in this tab, shown instantly while a fresh copy loads. */
export function readDashboardSnapshot<T>(): T | null {
  try {
    const raw = sessionStorage.getItem(snapshotKey);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export function saveDashboardSnapshot(value: unknown): void {
  try { sessionStorage.setItem(snapshotKey, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export function clearDashboardSnapshot(): void {
  prefetched = null;
  try { sessionStorage.removeItem(snapshotKey); } catch { /* storage blocked */ }
}
