"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, markSignedIn, setAppToken } from "../../lib/auth-session";
import { prefetchDashboard } from "../../lib/dashboard-cache";
import { supabase } from "../../lib/supabase";
import "../account/dashboard.css";

// The one-time code can only be exchanged once, so React's dev double-run must not repeat it.
let exchanging: Promise<string | null> | null = null;

async function finishGoogleLogin(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const failure = params.get("error_description") ?? params.get("error");
  if (failure) return failure.includes("cancel") || failure.includes("denied") ? "Google sign-in was cancelled." : "Google sign-in could not be completed. Try again.";
  const code = params.get("code");
  const auth = supabase()?.auth;
  if (!code || !auth) return "Google sign-in could not be completed. Try again.";

  const { data, error } = await auth.exchangeCodeForSession(code);
  if (error || !data.session) return "That Google sign-in link expired. Try again.";
  const response = await apiFetch("/v1/auth/supabase", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: data.session.access_token }),
  });
  // Retain the Supabase session for RLS-protected Friends & Groups and Realtime.
  const body = await response.json().catch(() => ({})) as { message?: string; token?: string; user?: { email?: string | null } };
  if (!response.ok || !body.user) {
    await auth.signOut({ scope: "local" }).catch(() => undefined);
    return body.message ?? "Google sign-in could not be completed. Try again.";
  }
  if (body.token) setAppToken(body.token);
  markSignedIn(true);
  prefetchDashboard(body.user.email ?? null);
  return null;
}

export default function SsoCallback() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    exchanging ??= finishGoogleLogin().catch(() => "Google sign-in could not be completed. Check your connection.");
    let active = true;
    void exchanging.then((problem) => {
      if (!active) return;
      if (problem) setError(problem);
      else router.replace("/account");
    });
    return () => { active = false; };
  }, [router]);

  return (
    <main className="xq-splash">
      {error ? (
        <>
          <h1>Couldn&apos;t sign you in</h1>
          <p>{error}</p>
          <Link className="xq-btn primary" href="/login">Back to log in</Link>
        </>
      ) : (
        <>
          <span className="xq-spinner" />
          <p>Signing you in with Google…</p>
        </>
      )}
    </main>
  );
}
