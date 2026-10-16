"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { isValidEmail, normalizeIndianMobile } from "@xocrisk/core";
import { authApiOrigin, createAuthSession } from "../../lib/auth-session";

type LoginFormProps = { initialMessage?: string };
type FormMode = "login" | "request-reset" | "verify-reset";

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

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="google-mark" viewBox="0 0 48 48">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.9 6.1-15Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.2-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
      <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.2 6 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg aria-hidden="true" className="microsoft-mark" viewBox="0 0 24 24">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

export default function LoginForm({ initialMessage = "" }: LoginFormProps) {
  const router = useRouter();
  const search = useSyncExternalStore(subscribeToLocation, () => window.location.search, () => "");
  const [mode, setMode] = useState<FormMode>("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [isError, setIsError] = useState(Boolean(initialMessage));
  const oauthResult = oauthMessages[new URLSearchParams(search).get("oauth") ?? ""];
  const visibleMessage = message || oauthResult?.text || "";
  const visibleIsError = message ? isError : oauthResult?.error ?? isError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedIdentifier = identifier.trim();
    if ((!isValidEmail(normalizedIdentifier) && !normalizeIndianMobile(normalizedIdentifier)) || !password) {
      setMessage("Enter a valid mobile number or email address, and your password.");
      setIsError(true);
      return;
    }
    setPending(true);
    setMessage("");
    setIsError(false);
    try {
      const result = await createAuthSession("/v1/auth/login", {
        identifier: normalizedIdentifier,
        password,
        rememberMe,
      });
      if (!result.success) throw new Error(result.message);
      router.replace("/account");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in. Try again.");
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  async function handleResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch(`${authApiOrigin}/v1/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: resetEmail.trim() }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not send a reset code.");
      setMode("verify-reset");
      setMessage("If that email belongs to an account, a reset code is on its way.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send a reset code. Try again.");
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  async function handleResetComplete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch(`${authApiOrigin}/v1/auth/password-reset/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: resetEmail.trim(), code: resetCode.trim(), password: newPassword }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not update the password.");
      setMode("login");
      setPassword("");
      setMessage(result.message ?? "Password updated. Please log in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the password. Try again.");
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  function beginProviderLogin(provider: "google" | "microsoft") {
    setPending(true);
    const returnOrigin = encodeURIComponent(window.location.origin);
    // This intentionally navigates to the external API OAuth authorization endpoint.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${authApiOrigin}/v1/auth/oauth/${provider}/start?returnOrigin=${returnOrigin}`;
  }

  function showLogin() {
    setMode("login");
    setMessage("");
    setIsError(false);
  }

  if (mode === "request-reset") {
    return (
      <div className="login-form-wrap">
        <p className="recovery-intro">Enter the email address on your account. We’ll send a one-time reset code if it matches.</p>
        <form className="login-form" onSubmit={handleResetRequest}>
          <div className="auth-field">
            <label className="field-label" htmlFor="reset-email">Email address</label>
            <input autoComplete="email" className="text-field" id="reset-email" onChange={(event) => setResetEmail(event.target.value)}
              placeholder="you@college.edu" required type="email" value={resetEmail} />
          </div>
          <div aria-live="polite" className={isError ? "form-message form-error" : "form-message"}>{message}</div>
          <button className="submit-button" disabled={pending} type="submit">{pending ? "Sending..." : "Send reset code"}</button>
          <button className="text-link recovery-back" onClick={showLogin} type="button">Back to log in</button>
        </form>
      </div>
    );
  }

  if (mode === "verify-reset") {
    return (
      <div className="login-form-wrap">
        <p className="recovery-intro">Enter the six-digit code sent to your email and choose a new password.</p>
        <form className="login-form" onSubmit={handleResetComplete}>
          <div className="auth-field">
            <label className="field-label" htmlFor="reset-code">Reset code</label>
            <input autoComplete="one-time-code" className="text-field" id="reset-code" inputMode="numeric"
              maxLength={6} onChange={(event) => setResetCode(event.target.value.replace(/\D/g, ""))}
              pattern="[0-9]{6}" required value={resetCode} />
          </div>
          <div className="auth-field">
            <label className="field-label" htmlFor="reset-new-password">New password</label>
            <input autoComplete="new-password" className="text-field" id="reset-new-password"
              minLength={10} onChange={(event) => setNewPassword(event.target.value)}
              required type="password" value={newPassword} />
          </div>
          <div aria-live="polite" className={isError ? "form-message form-error" : "form-message"}>{message}</div>
          <button className="submit-button" disabled={pending} type="submit">{pending ? "Updating..." : "Update password"}</button>
          <button className="text-link recovery-back" onClick={() => { setMode("request-reset"); setMessage(""); setIsError(false); }} type="button">Send a new code</button>
          <button className="text-link recovery-back" onClick={showLogin} type="button">Back to log in</button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-form-wrap">
      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-field">
          <label className="field-label" htmlFor="login-identifier">Mobile number or email</label>
          <input autoComplete="username" className="text-field" id="login-identifier"
            inputMode="email" onChange={(event) => setIdentifier(event.target.value)}
            placeholder="98765 43210 or you@college.edu" required value={identifier} />
        </div>
        <div className="auth-field">
          <label className="field-label" htmlFor="login-password">Password</label>
          <div className="password-field">
            <input autoComplete="current-password" className="text-field" id="login-password"
              onChange={(event) => setPassword(event.target.value)} required
              type={showPassword ? "text" : "password"} value={password} />
            <button aria-controls="login-password" aria-pressed={showPassword}
              className="text-control" onClick={() => setShowPassword((visible) => !visible)}
              type="button">{showPassword ? "Hide" : "Show"}</button>
          </div>
        </div>
        <div className="remember-row">
          <label className="remember-check" htmlFor="remember-me">
            <input checked={rememberMe} id="remember-me" onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />
            <span>Remember me</span>
          </label>
          <button className="text-link" onClick={() => { setResetEmail(identifier.includes("@") ? identifier.trim() : ""); setMode("request-reset"); setMessage(""); setIsError(false); }} type="button">
            Forgot password?
          </button>
        </div>
        <div aria-live="polite" className={visibleIsError ? "form-message form-error" : "form-message"}>{visibleMessage}</div>
        <button className="submit-button" disabled={pending} type="submit">
          {pending ? "Logging in..." : "Log in"}
        </button>
      </form>
      <div className="auth-divider"><span>or continue with</span></div>
      <div className="auth-providers">
        <button disabled={pending} onClick={() => beginProviderLogin("google")} type="button">
          <GoogleMark /> Google
        </button>
        <button disabled={pending} onClick={() => beginProviderLogin("microsoft")} type="button">
          <MicrosoftMark /> Microsoft
        </button>
      </div>
    </div>
  );
}
