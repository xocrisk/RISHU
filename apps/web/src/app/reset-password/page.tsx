"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/auth-session";
import "../account/dashboard.css";

type ResetLink = { token: string } | { problem: string } | null;

/** Reads the one-time token Supabase puts after "#" in the reset link, then removes it from the address bar. */
function readResetLink(): ResetLink {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const failure = hash.get("error_description") ?? query.get("error_description");
  const token = hash.get("access_token");
  window.history.replaceState(null, "", window.location.pathname);
  if (failure) return { problem: failure.toLowerCase().includes("expired") ? "This reset link has expired. Request a new one." : "This reset link isn't valid. Request a new one." };
  if (!token) return { problem: "Open this page from the reset link in your email." };
  return { token };
}

export default function ResetPassword() {
  const router = useRouter();
  const [link, setLink] = useState<ResetLink>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [saving, setSaving] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the link lives in the URL, which only exists in the browser
  useEffect(() => { setLink(readResetLink()); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!link || !("token" in link)) return;
    if (password.length < 10) { setError("Use at least 10 characters."); return; }
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/v1/auth/password-reset/link", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: link.token, password }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(body.message ?? "Your password couldn't be updated. Request a new link."); return; }
      setDone(body.message ?? "Password updated. Log in with your new password.");
      window.setTimeout(() => router.replace("/login"), 2500);
    } catch {
      setError("Your password couldn't be updated. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="xq-splash">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
      <img alt="XOCRISK" height="56" src="/icon-192.png" style={{ borderRadius: 14 }} width="56" />
      {!link ? <span className="xq-spinner" /> : "problem" in link ? (
        <>
          <h1>Reset link problem</h1>
          <p>{link.problem}</p>
          <Link className="xq-btn primary" href="/login">Back to log in</Link>
        </>
      ) : done ? (
        <>
          <h1>Password updated</h1>
          <p>{done}</p>
          <Link className="xq-btn primary" href="/login">Log in</Link>
        </>
      ) : (
        <form className="xq-sheet" onSubmit={(event) => void save(event)} style={{ textAlign: "left" }}>
          <h2>Set a new password</h2>
          <label className="xt-field">
            <span>New password <small>at least 10 characters</small></span>
            <input autoComplete="new-password" autoFocus maxLength={128} onChange={(event) => { setPassword(event.target.value); setError(""); }}
              type={show ? "text" : "password"} value={password} />
          </label>
          <label className="xt-field">
            <span>Confirm new password</span>
            <input autoComplete="new-password" maxLength={128} onChange={(event) => { setConfirm(event.target.value); setError(""); }}
              type={show ? "text" : "password"} value={confirm} />
          </label>
          <label className="xq-muted small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input checked={show} onChange={(event) => setShow(event.target.checked)} type="checkbox" /> Show passwords
          </label>
          {error && <p className="xt-order-error" role="alert">{error}</p>}
          <div className="xq-sheet-actions">
            <Link className="xt-btn ghost" href="/login">Cancel</Link>
            <button className="xq-btn primary" disabled={saving} type="submit">{saving ? "Saving…" : "Update password"}</button>
          </div>
        </form>
      )}
    </main>
  );
}
