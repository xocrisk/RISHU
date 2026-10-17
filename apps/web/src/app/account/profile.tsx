"use client";

import { useEffect, useLayoutEffect, useState, type FormEvent, type ReactNode } from "react";
import { deviceLockAvailable, disableAppLock, enableDeviceLock, lockMode, setPinLock, type LockMode } from "../../lib/app-lock";
import { isNativeApp, useAuthApi } from "../../lib/auth-session";
import { saveTheme, themeChoice, type ThemeChoice } from "../../lib/theme";
import { istDayFullYear } from "./format";
import type { Dashboard, Tab } from "./types";

type Notify = (kind: "ok" | "error", text: string) => void;

function Row({ label, hint, icon, onClick, danger }: { label: string; hint?: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`xq-prow ${danger ? "danger" : ""}`} onClick={onClick} type="button">
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <svg aria-hidden="true" viewBox="0 0 20 20"><path d={icon} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="xq-pgroup"><h2>{title}</h2>{children}</section>;
}

const icons = {
  funds: "M7 4h8M7 8h8M7 4c3 0 5 1.5 5 4s-2 4-5 4h-1l7 6",
  user: "M10 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3.5 17.5c.8-3 3.4-5 6.5-5s5.7 2 6.5 5",
  gear: "M10 13a3 3 0 100-6 3 3 0 000 6zM10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1",
  logout: "M8 3H4v14h4M13 6l4 4-4 4M17 10H8",
  chart: "M3 15l4-5 3 3 7-8M3 17h14",
  book: "M4 3h9l3 3v11H4zM7 8h6M7 11h6M7 14h4",
  pnl: "M4 17V9M10 17V3M16 17v-6",
  bulb: "M7 14h6M8 17h4M10 2a5 5 0 00-3 9v1h6v-1a5 5 0 00-3-9z",
  trophy: "M6 3h8v4a4 4 0 01-8 0zM6 5H3v1a3 3 0 003 3M14 5h3v1a3 3 0 01-3 3M10 11v3M7 17h6M8 14h4v3H8z",
  chat: "M3 4h14v9H8l-4 3v-3H3zM6 8h8M6 10.5h5",
  spark: "M10 2l1.8 4.7L16.5 8.5l-4.7 1.8L10 15l-1.8-4.7L3.5 8.5l4.7-1.8z",
  note: "M5 2h7l4 4v12H5zM12 2v4h4M8 10h5M8 13h5",
  help: "M10 17a7 7 0 100-14 7 7 0 000 14zM8 8a2 2 0 114 0c0 1.5-2 1.5-2 3M10 14h.01",
  phone: "M5 2h3l1.5 4-2 1.5a10 10 0 005 5l1.5-2 4 1.5v3a2 2 0 01-2 2A15 15 0 013 4a2 2 0 012-2z",
  invite: "M8 9a3 3 0 100-6 3 3 0 000 6zM2 17c.6-2.8 3-4.5 6-4.5s5.4 1.7 6 4.5M15 6v6M12 9h6",
};

export function ProfileView({ data, privacy, notify, onPrivacy, onNavigate, onEdit, onLogout }: {
  data: Dashboard; privacy: boolean; notify: Notify;
  onPrivacy: (enabled: boolean) => void; onNavigate: (tab: Tab) => void; onEdit: () => void; onLogout: () => void;
}) {
  const { user } = data;
  const initials = (user.fullName ?? "X").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function invite() {
    const url = typeof window === "undefined" ? "" : window.location.origin;
    const text = `Practice stock trading with ₹1,00,000 virtual money on XOCRISK. Join me! My UID: ${user.uid}`;
    try {
      if (navigator.share) await navigator.share({ title: "XOCRISK", text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); notify("ok", "Invite link copied."); }
    } catch { /* share sheet dismissed */ }
  }

  return (
    <div className="xq-page narrow xq-profile">
      <section className="xq-pcard">
        <div>
          <h1>{user.fullName ?? "XOCRISK trader"}</h1>
          <p><code className="xq-uid">{user.uid}</code> · {user.email}</p>
          <small>{user.college ?? "No college added"} · member since {istDayFullYear.format(new Date(user.memberSince))}</small>
        </div>
        <span aria-hidden="true" className="xq-pavatar">{initials}</span>
        <label className="xq-pprivacy">
          <span><b>Privacy mode</b><small>Blur amounts when someone is looking</small></span>
          <span className="xq-switch">
            <input checked={privacy} onChange={(event) => onPrivacy(event.target.checked)} type="checkbox" />
            <span aria-hidden="true" />
          </span>
        </label>
      </section>

      <Group title="Account">
        <Row hint="Practice cash, margin and P&L" icon={icons.funds} label="Funds" onClick={() => onNavigate("wallet")} />
        <Row hint="Name and mobile number" icon={icons.user} label="Edit profile" onClick={onEdit} />
        <Row hint="Leaderboard, watchlist, reset, delete" icon={icons.gear} label="Settings" onClick={() => onNavigate("settings")} />
      </Group>

      <Group title="Appearance"><ThemePicker /></Group>
      {isNativeApp() && <Group title="Security"><AppLockSettings notify={notify} /></Group>}

      <Group title="Console">
        <Row icon={icons.chart} label="Dashboard" onClick={() => onNavigate("dashboard")} />
        <Row icon={icons.book} label="Tradebook" onClick={() => onNavigate("transactions")} />
        <Row icon={icons.pnl} label="P&L and analytics" onClick={() => onNavigate("analytics")} />
        <Row icon={icons.bulb} label="Insights" onClick={() => onNavigate("insights")} />
        <Row icon={icons.chart} label="Market trends" onClick={() => onNavigate("trends")} />
      </Group>

      <Group title="Community">
        <Row hint="Conducted by LPU · ₹99 entry" icon={icons.trophy} label="LPU Championship" onClick={() => onNavigate("championship")} />
        <Row icon={icons.chat} label="Community chat" onClick={() => onNavigate("community")} />
        <Row icon={icons.spark} label="XOCRISK AI" onClick={() => onNavigate("ai")} />
        <Row icon={icons.note} label="Notes" onClick={() => onNavigate("notes")} />
      </Group>

      <Group title="Support">
        <Row icon={icons.help} label="Help & FAQs" onClick={() => onNavigate("support")} />
        <Row hint="support@xocrisk.com" icon={icons.phone} label="Contact" onClick={() => { window.location.href = "mailto:support@xocrisk.com"; }} />
      </Group>

      <Group title="Others">
        <Row icon={icons.invite} label="Invite friends" onClick={() => void invite()} />
        <Row danger icon={icons.logout} label="Log out" onClick={onLogout} />
      </Group>
    </div>
  );
}

export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>("light");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved choice after hydration
  useLayoutEffect(() => { setChoice(themeChoice()); }, []);
  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => saveTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);
  return (
    <div aria-label="Theme" className="xq-theme" role="radiogroup">
      {([["light", "Light", "M10 14a4 4 0 100-8 4 4 0 000 8zM10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6l1.4 1.4M15 15l1.4 1.4M3.6 16.4L5 15M15 5l1.4-1.4"],
        ["dark", "Dark", "M16 12.5A7 7 0 017.5 4a7 7 0 108.5 8.5z"],
        ["system", "System", "M3 4h14v10H3zM7 17h6M10 14v3"]] as const).map(([value, label, icon]) => (
        <button aria-checked={choice === value} key={value} onClick={() => { setChoice(value); saveTheme(value); }} role="radio" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d={icon} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
          {label}
        </button>
      ))}
    </div>
  );
}

export function AppLockSettings({ notify }: { notify: Notify }) {
  const [mode, setMode] = useState<LockMode>("off");
  const [choosingPin, setChoosingPin] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved lock after hydration
  useLayoutEffect(() => { setMode(lockMode()); }, []);

  async function chooseDevice() {
    setBusy(true);
    try {
      if (!await deviceLockAvailable()) { notify("error", "Set up a fingerprint, face unlock or screen lock on your phone first."); return; }
      if (await enableDeviceLock()) { setMode("device"); setChoosingPin(false); notify("ok", "App lock on: your phone's fingerprint, face or screen lock opens XOCRISK."); }
    } finally {
      setBusy(false);
    }
  }

  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{4}$/.test(pin)) { notify("error", "Enter a 4-digit PIN."); return; }
    if (pin !== confirm) { notify("error", "The two PINs don't match."); return; }
    await setPinLock(pin);
    setMode("pin");
    setChoosingPin(false);
    setPin(""); setConfirm("");
    notify("ok", "App lock on: your XOCRISK PIN opens the app.");
  }

  return (
    <div className="xq-lockset">
      <p className="xq-muted small">You stay signed in on this phone. Choose how XOCRISK unlocks when you open it.</p>
      <div className="xq-lock-options" role="radiogroup" aria-label="App lock">
        <button aria-checked={mode === "device"} disabled={busy} onClick={() => void chooseDevice()} role="radio" type="button">
          <b>Fingerprint / face / phone lock</b><small>Uses your phone&apos;s own unlock</small>
        </button>
        <button aria-checked={mode === "pin" || choosingPin} onClick={() => setChoosingPin(true)} role="radio" type="button">
          <b>XOCRISK PIN</b><small>A 4-digit PIN just for this app</small>
        </button>
        <button aria-checked={mode === "off" && !choosingPin} onClick={() => { disableAppLock(); setMode("off"); setChoosingPin(false); notify("ok", "App lock is off."); }} role="radio" type="button">
          <b>Off</b><small>Open straight to your dashboard</small>
        </button>
      </div>
      {choosingPin && (
        <form className="xq-pin-form" onSubmit={(event) => void savePin(event)}>
          <input aria-label="New PIN" autoComplete="off" inputMode="numeric" maxLength={4} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="New PIN" type="password" value={pin} />
          <input aria-label="Confirm PIN" autoComplete="off" inputMode="numeric" maxLength={4} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ""))} placeholder="Confirm" type="password" value={confirm} />
          <button className="xq-btn primary" type="submit">Save PIN</button>
        </form>
      )}
    </div>
  );
}

export function EditProfile({ data, notify, onClose, onSaved }: { data: Dashboard; notify: Notify; onClose: () => void; onSaved: () => void }) {
  const authFetch = useAuthApi();
  const [fullName, setFullName] = useState(data.user.fullName ?? "");
  const [mobile, setMobile] = useState(data.user.mobile ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fullName.trim().length < 2) { setError("Enter your full name."); return; }
    if (!/^\d{10}$/.test(mobile.replace(/\D/g, "").slice(-10))) { setError("Enter a valid 10-digit mobile number."); return; }
    setSaving(true);
    try {
      const response = await authFetch("/v1/auth/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName, mobile }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(body.message ?? "Your profile couldn't be saved."); return; }
      notify("ok", "Profile updated.");
      onSaved();
      onClose();
    } catch {
      setError("Your profile couldn't be saved. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="xt-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form aria-labelledby="edit-profile-title" aria-modal="true" className="xq-sheet" onSubmit={(event) => void save(event)} role="dialog">
        <span aria-hidden="true" className="xt-order-grip" />
        <h2 id="edit-profile-title">Edit profile</h2>
        <label className="xt-field"><span>Full name</span><input autoComplete="name" maxLength={80} onChange={(event) => { setFullName(event.target.value); setError(""); }} value={fullName} /></label>
        <label className="xt-field"><span>Mobile number</span><input autoComplete="tel" inputMode="tel" maxLength={14} onChange={(event) => { setMobile(event.target.value); setError(""); }} value={mobile} /></label>
        <label className="xt-field"><span>Email <small>can&apos;t be changed</small></span><input disabled value={data.user.email} /></label>
        <label className="xt-field"><span>College <small>can&apos;t be changed</small></span><input disabled value={data.user.college ?? "—"} /></label>
        {error && <p className="xt-order-error" role="alert">{error}</p>}
        <div className="xq-sheet-actions">
          <button className="xt-btn ghost" onClick={onClose} type="button">Cancel</button>
          <button className="xq-btn primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}
