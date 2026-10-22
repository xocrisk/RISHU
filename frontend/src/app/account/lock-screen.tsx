"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { checkPin, lockMode, unlockWithDevice, type LockMode } from "../../lib/app-lock";
import { isNativeApp } from "../../lib/auth-session";

// Lock again if the app was in the background longer than this.
const relockAfterMs = 30_000;
const maxPinAttempts = 5;

/**
 * Covers the app until the owner unlocks it (mobile app only, when an app lock is set).
 * Five wrong PINs, or "Use password instead", sign the user out.
 */
export default function LockScreen({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [mode, setMode] = useState<LockMode>("off");
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState("");
  const hiddenAt = useRef<number | null>(null);
  const prompting = useRef(false);

  // Locked from the first paint when a lock is set (read after hydration so server HTML still matches).
  useLayoutEffect(() => {
    if (!isNativeApp()) return;
    const current = lockMode();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off read of the saved lock before paint
    setMode(current);
    setLocked(current !== "off");
  }, []);

  const promptDevice = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await unlockWithDevice()) { setLocked(false); setMessage(""); }
      else setMessage("Couldn't verify it's you. Try again.");
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    if (locked && mode === "device") void promptDevice();
  }, [locked, mode, promptDevice]);

  // Lock again after the app has been in the background for a while.
  useEffect(() => {
    if (mode === "off") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); return; }
      if (hiddenAt.current && Date.now() - hiddenAt.current > relockAfterMs && lockMode() !== "off") {
        setPin(""); setMessage(""); setLocked(true);
      }
      hiddenAt.current = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [mode]);

  async function press(digit: string) {
    const next = `${pin}${digit}`.slice(0, 4);
    setPin(next);
    setMessage("");
    if (next.length < 4) return;
    if (await checkPin(next)) {
      setLocked(false); setPin(""); setAttempts(0);
      return;
    }
    const used = attempts + 1;
    setAttempts(used);
    setPin("");
    if (used >= maxPinAttempts) { onSignOut(); return; }
    setMessage(`Wrong PIN. ${maxPinAttempts - used} ${maxPinAttempts - used === 1 ? "try" : "tries"} left.`);
  }

  if (!locked) return null;
  return (
    <div aria-label="XOCRISK is locked" aria-modal="true" className="xq-lock" role="dialog">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
      <img alt="" height="64" src="/icon-192.png" width="64" />
      <h1>Welcome back{name ? `, ${name}` : ""}</h1>
      {mode === "device" ? (
        <>
          <p>Unlock with your fingerprint, face or phone screen lock.</p>
          <button className="xq-lock-bio" onClick={() => void promptDevice()} type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a7 7 0 00-7 7v3M19 13v-3a7 7 0 00-3-5.7M9 21c1.5-2 2-4.5 2-7v-2a1 1 0 012 0v2c0 3-.6 5.7-2 8M6 18c.6-1.3 1-2.7 1-4.2V10a5 5 0 0110 0v4c0 1.5-.2 3-.6 4.3M15.5 21c.4-.9.8-2 1-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /></svg>
            Unlock
          </button>
        </>
      ) : (
        <>
          <p>Enter your XOCRISK PIN</p>
          <div aria-label={`${pin.length} of 4 digits entered`} className="xq-lock-dots">
            {[0, 1, 2, 3].map((index) => <i className={index < pin.length ? "on" : ""} key={index} />)}
          </div>
          <div className="xq-lock-pad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button key={digit} onClick={() => void press(digit)} type="button">{digit}</button>
            ))}
            <span />
            <button onClick={() => void press("0")} type="button">0</button>
            <button aria-label="Delete" onClick={() => setPin((current) => current.slice(0, -1))} type="button">⌫</button>
          </div>
        </>
      )}
      {message && <p className="xq-lock-msg" role="alert">{message}</p>}
      <button className="xq-link" onClick={onSignOut} type="button">Use password instead</button>
    </div>
  );
}
