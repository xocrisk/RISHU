"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { isValidEmail, normalizeIndianMobile } from "@xocrisk/core";
import { createAuthSession } from "../../lib/auth-session";
import { collegesAToZ, highlightParts, searchColleges, type College } from "./college-search";

const lpuName = "Lovely Professional University";
// The API recognises LPU students by this exact college name.
const lpuApiName = "Lovely Professional University (LPU)";
const notListedLabel = "My college isn't listed";
const commonPasswords = ["password123", "qwerty12345", "1234567890", "iloveyou123", "xocrisk1234"];

type Field = "name" | "email" | "phone" | "college" | "collegeOther" | "lpu" | "password" | "terms";
type Selection = College | "other" | null;

const fieldIds: Record<Field, string> = {
  name: "su-name", email: "su-email", phone: "su-phone", college: "su-college",
  collegeOther: "su-college-other", lpu: "su-lpu", password: "su-pw", terms: "su-terms",
};

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((part, index) =>
    part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}

export default function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [collegeText, setCollegeText] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [listOpen, setListOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [collegeOther, setCollegeOther] = useState("");
  const [lpu, setLpu] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const lpuRef = useRef<HTMLInputElement>(null);

  const isLpu = selection !== null && selection !== "other" && selection.name === lpuName;
  const query = showAll ? "" : collegeText.trim();
  const results = query ? searchColleges(query) : collegesAToZ;
  const optionCount = results.length + 1; // + "not listed"

  useEffect(() => {
    if (!listOpen || !listRef.current) return;
    const target = activeIndex >= 0
      ? listRef.current.querySelector<HTMLElement>(`#college-opt-${activeIndex === results.length ? "other" : activeIndex}`)
      : listRef.current.querySelector<HTMLElement>("li.current");
    if (activeIndex >= 0) target?.scrollIntoView({ block: "nearest" });
    else if (target) target.scrollIntoView({ block: "center" });
    else listRef.current.scrollTop = 0;
  }, [listOpen, activeIndex, query, results.length]);

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function openList(all: boolean) {
    setShowAll(all);
    setActiveIndex(-1);
    setListOpen(true);
  }

  function choose(index: number) {
    if (index === results.length) {
      setSelection("other");
      setCollegeText(notListedLabel);
      setLpu("");
      setListOpen(false);
      clearError("college");
      window.setTimeout(() => otherRef.current?.focus(), 0);
      return;
    }
    const college = results[index];
    if (!college) return;
    setSelection(college);
    setCollegeText(college.name);
    setListOpen(false);
    clearError("college");
    if (college.name === lpuName) window.setTimeout(() => lpuRef.current?.focus(), 220);
    else setLpu("");
  }

  function clearCollege() {
    setCollegeText("");
    setSelection(null);
    setLpu("");
    document.getElementById(fieldIds.college)?.focus();
    openList(true);
  }

  function handleCollegeKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!listOpen) openList(selection !== null);
      else setActiveIndex((index) => (index + 1) % optionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + optionCount) % optionCount);
    } else if (event.key === "Enter" && listOpen) {
      event.preventDefault();
      if (activeIndex >= 0) choose(activeIndex);
      else if (results.length) choose(0);
    } else if (event.key === "Escape") {
      setListOpen(false);
    }
  }

  function validate(): Partial<Record<Field, string>> {
    const next: Partial<Record<Field, string>> = {};
    if (name.trim().length < 2) next.name = "Enter your full name.";
    if (!isValidEmail(email.trim())) next.email = "Enter a valid email address.";
    if (!normalizeIndianMobile(phone)) next.phone = "Enter a 10-digit Indian mobile number.";
    if (!selection) {
      next.college = collegeText.trim()
        ? "Pick your college from the list, or choose \"My college isn't listed\"."
        : "Choose your college or university.";
    }
    if (selection === "other" && collegeOther.trim().length < 3) next.collegeOther = "Enter your college's name.";
    if (isLpu) {
      if (!lpu) next.lpu = "Enter your LPU registration number.";
      else if (!/^\d{8}$/.test(lpu)) next.lpu = "Enter all 8 digits of your LPU registration number.";
    }
    if (password.length < 10) next.password = "Use at least 10 characters.";
    else if (password.length > 128) next.password = "Use 128 characters or fewer.";
    else if (commonPasswords.includes(password.toLowerCase())) next.password = "That password is too common. Pick another.";
    if (!terms) next.terms = "Confirm you're 18 or older and accept the terms.";
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    const next = validate();
    setErrors(next);
    const firstInvalid = (Object.keys(fieldIds) as Field[]).find((field) => next[field]);
    if (firstInvalid) {
      document.getElementById(fieldIds[firstInvalid])?.focus();
      return;
    }
    const mobile = normalizeIndianMobile(phone);
    if (!mobile || !selection) return;
    const college = selection === "other" ? collegeOther.trim() : isLpu ? lpuApiName : selection.name;
    setPending(true);
    try {
      const result = await createAuthSession("/v1/auth/signup", {
        fullName: name.trim(),
        email: email.trim().toLowerCase(),
        mobile,
        college,
        ...(isLpu ? { lpuRegistrationNumber: lpu } : {}),
        password,
        adultConsent: true,
      });
      if (!result.success) throw new Error(result.message);
      setPassword("");
      setStatus({ kind: "ok", text: "Account created with ₹1,00,000 practice money. Opening your dashboard…" });
      window.setTimeout(() => router.replace("/account"), 600);
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Something went wrong. Try again." });
    } finally {
      setPending(false);
    }
  }

  const invalid = (field: Field) => (errors[field] ? "true" : "false");
  const errorText = (field: Field) => (
    <div aria-live="polite" className="err" id={`${fieldIds[field]}-err`}>{errors[field] ?? ""}</div>
  );

  return (
    <form noValidate onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="su-name">Full name</label>
        <input aria-describedby="su-name-err" aria-invalid={invalid("name")} autoComplete="name" className="input"
          id="su-name" maxLength={120} name="name" onChange={(event) => { setName(event.target.value); clearError("name"); }}
          placeholder="As it should appear on your certificates" required type="text" value={name} />
        {errorText("name")}
      </div>

      <div className="field">
        <label htmlFor="su-email">Email</label>
        <input aria-describedby="su-email-err" aria-invalid={invalid("email")} autoComplete="email" className="input"
          id="su-email" name="email" onChange={(event) => { setEmail(event.target.value); clearError("email"); }}
          placeholder="you@college.edu" required type="email" value={email} />
        {errorText("email")}
      </div>

      <div className="field">
        <label htmlFor="su-phone">Mobile number</label>
        <div className="control with-prefix">
          <span aria-hidden="true" className="prefix">+91</span>
          <input aria-describedby="su-phone-err" aria-invalid={invalid("phone")} autoComplete="tel-national" className="input"
            id="su-phone" inputMode="numeric" maxLength={11} name="phone"
            onChange={(event) => { setPhone(event.target.value); clearError("phone"); }}
            placeholder="98765 43210" required type="tel" value={phone} />
        </div>
        {errorText("phone")}
      </div>

      <div className="field">
        <label htmlFor="su-college" id="su-college-label">College or university</label>
        <div className="combo">
          <input aria-activedescendant={listOpen && activeIndex >= 0
            ? `college-opt-${activeIndex === results.length ? "other" : activeIndex}` : undefined}
            aria-autocomplete="list" aria-controls="college-list" aria-describedby="su-college-err"
            aria-expanded={listOpen} aria-invalid={invalid("college")} autoComplete="off" className="input"
            id="su-college" onBlur={() => window.setTimeout(() => setListOpen(false), 120)}
            onChange={(event) => {
              if (selection) { setSelection(null); setLpu(""); }
              setCollegeText(event.target.value);
              openList(false);
            }}
            onClick={() => { if (!listOpen) openList(selection !== null); }}
            onFocus={() => openList(selection !== null)} onKeyDown={handleCollegeKey}
            placeholder="Select or type to search" role="combobox" spellCheck={false} type="text" value={collegeText} />
          {collegeText ? (
            <button aria-label="Clear college" className="combo-clear" onClick={clearCollege} type="button">
              <svg aria-hidden="true" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
            </button>
          ) : (
            <svg aria-hidden="true" className={listOpen ? "combo-chevron up" : "combo-chevron"} viewBox="0 0 16 16">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
          )}
          {listOpen && (
            <ul aria-labelledby="su-college-label" className="listbox" id="college-list" ref={listRef} role="listbox"
              onMouseDown={(event) => event.preventDefault()}>
              {query ? (
                !results.length && <li className="note" role="presentation">No NIRF-ranked match for &quot;{query}&quot;.</li>
              ) : (
                <li className="count" role="presentation">{collegesAToZ.length} NIRF-ranked colleges and universities, A to Z</li>
              )}
              {results.map((college, index) => (
                <li aria-selected={activeIndex === index} className={selection === college ? "current" : undefined}
                  id={`college-opt-${index}`} key={college.place} onClick={() => choose(index)} role="option">
                  <span className="n"><Highlighted query={query} text={college.name} /></span>
                  <span className="m">{college.city}, {college.state}</span>
                </li>
              ))}
              <li aria-selected={activeIndex === results.length} className="other" id="college-opt-other"
                onClick={() => choose(results.length)} role="option">
                <span className="n">{notListedLabel}</span>
                <span className="m">Type its name yourself</span>
              </li>
            </ul>
          )}
        </div>
        {errorText("college")}

        {selection === "other" && (
          <div className="field">
            <label htmlFor="su-college-other">Your college&apos;s name</label>
            <input aria-describedby="su-college-other-err" aria-invalid={invalid("collegeOther")} autoComplete="organization"
              className="input" id="su-college-other" maxLength={160} name="college_other"
              onChange={(event) => { setCollegeOther(event.target.value); clearError("collegeOther"); }}
              placeholder="Full name and city" ref={otherRef} type="text" value={collegeOther} />
            {errorText("collegeOther")}
          </div>
        )}

        <div aria-hidden={!isLpu} className={isLpu ? "reveal open" : "reveal"}>
          <div>
            <div className="lpu-card">
              <label htmlFor="su-lpu">LPU registration number</label>
              <input aria-describedby="su-lpu-hint su-lpu-err" aria-invalid={invalid("lpu")} autoComplete="off" className="input"
                disabled={!isLpu} id="su-lpu" inputMode="numeric" maxLength={8} name="lpu_registration_no"
                onChange={(event) => { setLpu(event.target.value.replace(/\D/g, "").slice(0, 8)); clearError("lpu"); }}
                placeholder="XXXXXXXX" ref={lpuRef} required={isLpu} type="text" value={lpu} />
              <div className="hint" id="su-lpu-hint">8 digits. You&apos;ll find it on your LPU ID card and in UMS.</div>
              {errorText("lpu")}
            </div>
          </div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="su-pw">Create a password</label>
        <div className="control with-btn">
          <input aria-describedby="su-pw-hint su-pw-err" aria-invalid={invalid("password")} autoComplete="new-password"
            className="input" id="su-pw" maxLength={128} name="password"
            onChange={(event) => { setPassword(event.target.value); clearError("password"); }}
            required type={showPassword ? "text" : "password"} value={password} />
          <button aria-controls="su-pw" aria-pressed={showPassword} className="inline-btn"
            onClick={() => setShowPassword((shown) => !shown)} type="button">{showPassword ? "Hide" : "Show"}</button>
        </div>
        <div className="hint" id="su-pw-hint">At least 10 characters. A short phrase is easier to remember.</div>
        {errorText("password")}
      </div>

      <div className="field">
        <label className="check">
          <input aria-describedby="su-terms-err" aria-invalid={invalid("terms")} checked={terms} id="su-terms" name="terms"
            onChange={(event) => { setTerms(event.target.checked); clearError("terms"); }} type="checkbox" />
          <span>I&apos;m 18 or older and agree to the <Link className="link" href="/terms">Terms</Link> and{" "}
            <Link className="link" href="/privacy">Privacy Policy</Link>.</span>
        </label>
        {errorText("terms")}
      </div>

      <div aria-live="polite" className={`status ${status?.kind ?? ""}`} role="status">{status?.text ?? ""}</div>
      <button className="primary" disabled={pending} type="submit">
        {pending && <span aria-hidden="true" className="spinner" />}
        <span>{pending ? "Creating account" : "Create account"}</span>
      </button>
      <p className="fine">You start with ₹1,00,000 in practice money. It can&apos;t be deposited or withdrawn.</p>
    </form>
  );
}
