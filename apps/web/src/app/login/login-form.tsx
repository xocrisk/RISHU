"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { isValidEmail, normalizeIndianMobile } from "@xocrisk/core";
import { apiFetch, authApiOrigin, createAuthSession, isNativeApp } from "../../lib/auth-session";
import { prefetchDashboard } from "../../lib/dashboard-cache";

type Mode = "login" | "request-reset" | "verify-reset";
type Status = { kind: "ok" | "error"; text: string } | null;

const oauthMessages: Record<string, { text: string; error: boolean }> = {
  link: { text: "Provider verified. Log in with your XOCRISK password once to securely link it.", error: false },
  unavailable: { text: "That sign-in provider is not configured yet. Use your password or contact support.", error: true },
  cancelled: { text: "Provider sign-in was cancelled.", error: true },
  failed: { text: "Provider sign-in could not be completed. Try again.", error: true },
  expired: { text: "That provider sign-in expired. Start again.", error: true },
};

function subscribeToLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

async function postJson(path: string, body: Record<string, unknown>): Promise<{ message?: string }> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? "Something went wrong. Try again.");
  return result;
}

function Busy({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return <>{pending && <span aria-hidden="true" className="spinner" />}<span>{pending ? busy : idle}</span></>;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

export default function LoginForm() {
  const router = useRouter();
  const search = useSyncExternalStore(subscribeToLocation, () => window.location.search, () => "");
  const [mode, setMode] = useState<Mode>("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [idError, setIdError] = useState("");
  const [pwError, setPwError] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [pending, setPending] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const oauthResult = oauthMessages[new URLSearchParams(search).get("oauth") ?? ""];
  const visibleStatus: Status = status ?? (oauthResult ? { kind: oauthResult.error ? "error" : "ok", text: oauthResult.text } : null);

  // Load the dashboard's code ahead of time so the jump after logging in is instant.
  useEffect(() => { router.prefetch("/account"); }, [router]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/v1/auth/me")
      .then((response) => {
        if (cancelled || !response.ok) return;
        // The app stays signed in on this device (its app lock protects it), so skip the login form.
        if (isNativeApp()) router.replace("/account");
        else setLoggedIn(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [router]);

  function switchMode(next: Mode) {
    setMode(next);
    setStatus(null);
    setIdError("");
    setPwError("");
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Something went wrong. Try again." });
    } finally {
      setPending(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    const id = identifier.trim();
    const nextIdError = !id ? "Enter your mobile number or email."
      : !isValidEmail(id) && !normalizeIndianMobile(id) ? "That doesn't look like a mobile number or email." : "";
    const nextPwError = password ? "" : "Enter your password.";
    setIdError(nextIdError);
    setPwError(nextPwError);
    if (nextIdError) { document.getElementById("login-id")?.focus(); return; }
    if (nextPwError) { document.getElementById("login-pw")?.focus(); return; }
    await run(async () => {
      const result = await createAuthSession("/v1/auth/login", { identifier: id, password, rememberMe: remember });
      if (!result.success) throw new Error(result.message);
      setPassword("");
      setStatus({ kind: "ok", text: "Logged in. Opening your dashboard…" });
      prefetchDashboard(result.email);
      router.replace("/account");
    });
  }

  async function handleResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = identifier.trim();
    if (!isValidEmail(email)) {
      setIdError("Enter the email address on your account.");
      document.getElementById("login-id")?.focus();
      return;
    }
    setIdError("");
    await run(async () => {
      await postJson("/v1/auth/password-reset/request", { email });
      setMode("verify-reset");
      setStatus({ kind: "ok", text: "If that email has an account, a 6-digit reset code is on its way." });
    });
  }

  async function handleResetComplete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(resetCode)) { setStatus({ kind: "error", text: "Enter the 6-digit code." }); return; }
    if (newPassword.length < 10) { setStatus({ kind: "error", text: "Use at least 10 characters for the new password." }); return; }
    await run(async () => {
      const result = await postJson("/v1/auth/password-reset/complete", {
        email: identifier.trim(), code: resetCode, password: newPassword,
      });
      setMode("login");
      setPassword("");
      setResetCode("");
      setNewPassword("");
      setStatus({ kind: "ok", text: result.message ?? "Password updated. Log in with your new password." });
    });
  }

  function beginProviderLogin(provider: "google" | "microsoft") {
    setPending(true);
    const returnOrigin = encodeURIComponent(window.location.origin);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${authApiOrigin}/v1/auth/oauth/${provider}/start?returnOrigin=${returnOrigin}`;
  }

  const statusBox = (
    <div aria-live="polite" className={`status ${visibleStatus?.kind ?? ""}`} role="status">
      {visibleStatus?.text ?? (loggedIn ? <>You&apos;re already logged in. <Link className="link" href="/account">Open dashboard</Link></> : "")}
    </div>
  );

  const identifierField = (label: string, placeholder: string) => (
    <div className="field">
      <label htmlFor="login-id">{label}</label>
      <input aria-describedby="login-id-err" aria-invalid={idError ? "true" : "false"} autoComplete="username" className="input"
        id="login-id" inputMode="email" name="identifier" onChange={(event) => { setIdentifier(event.target.value); setIdError(""); }}
        placeholder={placeholder} required type="text" value={identifier} />
      <div aria-live="polite" className="err" id="login-id-err">{idError}</div>
    </div>
  );

  if (mode === "request-reset") {
    return (
      <form noValidate onSubmit={handleResetRequest}>
        <p className="hint">Enter the email on your account. We&apos;ll send a 6-digit code to reset your password.</p>
        {identifierField("Email", "you@college.edu")}
        {statusBox}
        <button className="primary" disabled={pending} type="submit"><Busy busy="Sending code" idle="Send reset code" pending={pending} /></button>
        <button className="link centered" onClick={() => switchMode("login")} type="button">Back to log in</button>
      </form>
    );
  }

  if (mode === "verify-reset") {
    return (
      <form noValidate onSubmit={handleResetComplete}>
        <div className="field">
          <label htmlFor="login-code">6-digit code</label>
          <input autoComplete="one-time-code" className="input" id="login-code" inputMode="numeric" maxLength={6}
            onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456" type="text" value={resetCode} />
        </div>
        <div className="field">
          <label htmlFor="login-new-pw">New password</label>
          <div className="control with-btn">
            <input autoComplete="new-password" className="input" id="login-new-pw" maxLength={128}
              onChange={(event) => setNewPassword(event.target.value)} type={showPassword ? "text" : "password"} value={newPassword} />
            <button aria-controls="login-new-pw" aria-pressed={showPassword} className="inline-btn"
              onClick={() => setShowPassword((shown) => !shown)} type="button">{showPassword ? "Hide" : "Show"}</button>
          </div>
          <div className="hint">At least 10 characters.</div>
        </div>
        {statusBox}
        <button className="primary" disabled={pending} type="submit"><Busy busy="Updating" idle="Update password" pending={pending} /></button>
        <button className="link centered" onClick={() => switchMode("request-reset")} type="button">Send a new code</button>
        <button className="link centered" onClick={() => switchMode("login")} type="button">Back to log in</button>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={handleLogin}>
      {identifierField("Mobile number or email", "98765 43210 or you@college.edu")}

      <div className="field">
        <label htmlFor="login-pw">Password</label>
        <div className="control with-btn">
          <input aria-describedby="login-pw-err" aria-invalid={pwError ? "true" : "false"} autoComplete="current-password"
            className="input" id="login-pw" name="password" onChange={(event) => { setPassword(event.target.value); setPwError(""); }}
            required type={showPassword ? "text" : "password"} value={password} />
          <button aria-controls="login-pw" aria-pressed={showPassword} className="inline-btn"
            onClick={() => setShowPassword((shown) => !shown)} type="button">{showPassword ? "Hide" : "Show"}</button>
        </div>
        <div aria-live="polite" className="err" id="login-pw-err">{pwError}</div>
      </div>

      <div className="row">
        <label className="check">
          <input checked={remember} id="remember" name="remember" onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
          {" "}Keep me logged in
        </label>
        <button className="link" onClick={() => switchMode("request-reset")} type="button">Forgot password?</button>
      </div>

      {statusBox}
      <button className="primary" disabled={pending} type="submit"><Busy busy="Logging in" idle="Log in" pending={pending} /></button>

      <div className="divider">or</div>
      <div className="social">
        <button disabled={pending} onClick={() => beginProviderLogin("google")} type="button"><GoogleMark /> Google</button>
        <button disabled={pending} onClick={() => beginProviderLogin("microsoft")} type="button"><MicrosoftMark /> Microsoft</button>
      </div>
    </form>
  );
}
