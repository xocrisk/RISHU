"use client";

import { useState, type FormEvent } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { collegesAToZ, searchColleges, type College } from "../signup/college-search";
import type { Dashboard } from "./types";

type Notify = (kind: "ok" | "error", text: string) => void;

const lpuName = "Lovely Professional University";
// The API recognises LPU students by this exact college name.
const lpuApiName = "Lovely Professional University (LPU)";

/** Asked once after Google sign-in: Google shares name and email, not college or mobile number. */
export default function CompleteProfile({ data, notify, onLater, onSaved }: {
  data: Dashboard; notify: Notify; onLater: () => void; onSaved: () => void;
}) {
  const authFetch = useAuthApi();
  const needsMobile = !data.user.mobile;
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<College | "other" | null>(null);
  const [other, setOther] = useState("");
  const [lpu, setLpu] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isLpu = selection !== null && selection !== "other" && selection.name === lpuName;
  const results = (query.trim() ? searchColleges(query) : collegesAToZ).slice(0, 8);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection) { setError("Choose your college or university."); return; }
    if (selection === "other" && other.trim().length < 3) { setError("Enter your college's name."); return; }
    if (isLpu && !/^\d{8}$/.test(lpu)) { setError("Enter all 8 digits of your LPU registration number."); return; }
    if (needsMobile && !/^\d{10}$/.test(mobile.replace(/\D/g, "").slice(-10))) { setError("Enter a valid 10-digit mobile number."); return; }
    const college = selection === "other" ? other.trim() : isLpu ? lpuApiName : selection.name;
    setSaving(true);
    try {
      const response = await authFetch("/v1/auth/profile/details", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ college, ...(isLpu ? { lpuRegistrationNumber: lpu } : {}), ...(needsMobile ? { mobile } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) { setError(body.message ?? "Your details couldn't be saved."); return; }
      notify("ok", "Profile completed. Welcome to XOCRISK!");
      onSaved();
    } catch {
      setError("Your details couldn't be saved. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  const firstName = data.user.fullName?.split(" ")[0];
  return (
    <div className="xt-modal-backdrop">
      <form aria-labelledby="complete-profile-title" aria-modal="true" className="xq-sheet" onSubmit={(event) => void save(event)} role="dialog">
        <span aria-hidden="true" className="xt-order-grip" />
        <h2 id="complete-profile-title">{firstName ? `Welcome, ${firstName}!` : "Welcome!"}</h2>
        <p className="xq-sheet-note">Google shared your name and email. Add your college to join your campus leaderboard and championships.</p>

        <label className="xt-field">
          <span>College or university</span>
          {selection && selection !== "other" ? (
            <div className="xq-pick-chosen">
              <span><b>{selection.name}</b><small>{selection.city}, {selection.state}</small></span>
              <button className="xt-btn ghost" onClick={() => { setSelection(null); setLpu(""); }} type="button">Change</button>
            </div>
          ) : (
            <input autoComplete="off" autoFocus onChange={(event) => { setQuery(event.target.value); setSelection(null); setError(""); }}
              placeholder="Search your college" value={selection === "other" ? "My college isn't listed" : query}
              readOnly={selection === "other"} onClick={() => { if (selection === "other") setSelection(null); }} />
          )}
        </label>
        {!selection && (
          <ul className="xq-pick-list" role="listbox">
            {results.map((college) => (
              <li aria-selected="false" key={college.place} onClick={() => { setSelection(college); setError(""); }} role="option">
                <b>{college.name}</b><small>{college.city}, {college.state}</small>
              </li>
            ))}
            <li aria-selected="false" className="other" onClick={() => { setSelection("other"); setError(""); }} role="option">
              <b>My college isn&apos;t listed</b><small>Type its name yourself</small>
            </li>
          </ul>
        )}
        {selection === "other" && (
          <label className="xt-field"><span>Your college&apos;s name</span>
            <input autoComplete="organization" autoFocus maxLength={160} onChange={(event) => { setOther(event.target.value); setError(""); }}
              placeholder="Full name and city" value={other} />
          </label>
        )}
        {isLpu && (
          <label className="xt-field"><span>LPU registration number <small>8 digits, on your ID card</small></span>
            <input autoFocus inputMode="numeric" maxLength={8} onChange={(event) => { setLpu(event.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
              placeholder="XXXXXXXX" value={lpu} />
          </label>
        )}
        {needsMobile && (
          <label className="xt-field"><span>Mobile number</span>
            <input autoComplete="tel" inputMode="tel" maxLength={14} onChange={(event) => { setMobile(event.target.value); setError(""); }}
              placeholder="98765 43210" value={mobile} />
          </label>
        )}
        {error && <p className="xt-order-error" role="alert">{error}</p>}
        <div className="xq-sheet-actions">
          <button className="xt-btn ghost" onClick={onLater} type="button">Later</button>
          <button className="xq-btn primary" disabled={saving} type="submit">{saving ? "Saving…" : "Continue"}</button>
        </div>
      </form>
    </div>
  );
}
