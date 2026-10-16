"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { isValidEmail, normalizeIndianMobile } from "@xocrisk/core";
import { createAuthSession } from "../../lib/auth-session";
import { collegeNotListed, collegeOptions } from "./college-options";

const collegeNotListedLabel = "My college is not listed";

function mobileInputValue(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

type SignupField =
  | "fullName"
  | "email"
  | "mobile"
  | "college"
  | "customCollege"
  | "lpuRegistrationNumber"
  | "password"
  | "adultConsent";

export default function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [college, setCollege] = useState("");
  const [collegeOpen, setCollegeOpen] = useState(false);
  const [customCollege, setCustomCollege] = useState("");
  const [lpuRegistrationNumber, setLpuRegistrationNumber] = useState("");
  const [password, setPassword] = useState("");
  const [adultConsent, setAdultConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({});
  const enteredCollege = college === collegeNotListed ? customCollege.trim() : college;
  const isLpu = enteredCollege === "Lovely Professional University (LPU)";
  const collegeQuery = college === collegeNotListed ? "" : college.trim().toLowerCase();
  const recommendedColleges = collegeOptions
    .filter((collegeName) => collegeName.toLowerCase().includes(collegeQuery))
    .slice(0, 6);

  function chooseCollege(selection: string) {
    if (selection === collegeNotListed) {
      setCustomCollege(college === collegeNotListed ? customCollege : college.trim());
      setCollege(collegeNotListed);
    } else {
      setCollege(selection);
      setCustomCollege("");
    }
    setCollegeOpen(false);
  }

  function validateSignup(): boolean {
    const nextErrors: Partial<Record<SignupField, string>> = {};
    if (fullName.trim().length < 2) nextErrors.fullName = "Enter your full name (at least 2 characters).";
    if (!isValidEmail(email)) nextErrors.email = "Enter a valid email address.";
    if (!normalizeIndianMobile(mobile)) nextErrors.mobile = "Enter a valid 10-digit Indian mobile number.";
    if (!college) nextErrors.college = "Search and select your college or choose the manual-entry option.";
    else if (college !== collegeNotListed && !collegeOptions.includes(college)) {
      nextErrors.college = "Choose a college from the suggestions or select the manual-entry option.";
    }
    if (college === collegeNotListed && customCollege.trim().length < 2) {
      nextErrors.customCollege = "Enter your college or university name.";
    }
    if (isLpu && !/^\d{8}$/.test(lpuRegistrationNumber.trim())) {
      nextErrors.lpuRegistrationNumber = "Enter the 8-digit LPU registration number.";
    }
    if (password.length < 10 || password.length > 128) {
      nextErrors.password = "Use a password between 10 and 128 characters.";
    }
    if (!adultConsent) nextErrors.adultConsent = "Confirm you are 18 or older and accept the terms.";
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setPending(true);
    setMessage("");
    setIsError(false);
    try {
      if (!validateSignup()) {
        setMessage("Please correct the highlighted fields.");
        setIsError(true);
        return;
      }
      const normalizedMobile = normalizeIndianMobile(mobile);
      if (!normalizedMobile) throw new Error("Enter a valid 10-digit Indian mobile number.");
      const result = await createAuthSession("/v1/auth/signup", {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        mobile: normalizedMobile,
        college: enteredCollege,
        ...(isLpu ? { lpuRegistrationNumber: lpuRegistrationNumber.trim() } : {}),
        password,
        adultConsent: true,
      });
      if (!result.success) throw new Error(result.message);
      router.replace("/account");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create your account. Try again.");
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  function fieldError(field: SignupField) {
    const error = errors[field];
    return error ? <span className="field-error" role="alert">{error}</span> : null;
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <label className="field-label" htmlFor="signup-full-name">Full name</label>
      <input aria-invalid={Boolean(errors.fullName)} autoComplete="name" className="text-field"
        id="signup-full-name" maxLength={120} name="fullName" onChange={(event) => setFullName(event.target.value)}
        required value={fullName} />
      {fieldError("fullName")}

      <label className="field-label field-spaced" htmlFor="signup-mobile">Mobile number</label>
      <div aria-invalid={Boolean(errors.mobile)} className="mobile-number-field">
        <span aria-hidden="true">+91</span>
        <input autoComplete="tel-national" className="text-field"
          id="signup-mobile" inputMode="numeric" name="mobile"
          onChange={(event) => setMobile(mobileInputValue(event.target.value))}
          placeholder="98765 43210" required type="tel" value={mobile} />
      </div>
      {fieldError("mobile")}

      <label className="field-label field-spaced" htmlFor="signup-email">Email address</label>
      <input aria-invalid={Boolean(errors.email)} autoComplete="email" className="text-field"
        id="signup-email" name="email" onChange={(event) => setEmail(event.target.value)}
        placeholder="For email and password sign-in" required type="email" value={email} />
      {fieldError("email")}

      <label className="field-label field-spaced" htmlFor="signup-college">College/University</label>
      <div className="college-picker">
        <input aria-autocomplete="list" aria-controls="signup-college-options" aria-expanded={collegeOpen}
          aria-invalid={Boolean(errors.college)} autoComplete="off" className="text-field"
          id="signup-college" name="college"
          onBlur={() => window.setTimeout(() => setCollegeOpen(false), 120)}
          onChange={(event) => setCollege(event.target.value)}
          onFocus={() => setCollegeOpen(true)} onKeyDown={(event) => {
            if (event.key === "Escape") setCollegeOpen(false);
            if (event.key === "Enter" && collegeOpen) {
              event.preventDefault();
              if (recommendedColleges[0]) chooseCollege(recommendedColleges[0]);
              else chooseCollege(collegeNotListed);
            }
          }} placeholder="Search colleges or universities" role="combobox" required
          value={college === collegeNotListed ? collegeNotListedLabel : college} />
        {collegeOpen && college !== collegeNotListed && (
          <div className="college-suggestions" id="signup-college-options" role="listbox">
            {recommendedColleges.map((collegeName) => (
              <button aria-selected={college === collegeName} className="college-suggestion"
                key={collegeName} onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseCollege(collegeName)} role="option" type="button">
                {collegeName}
              </button>
            ))}
            <button aria-selected={college === collegeNotListed} className="college-suggestion college-not-listed"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCollege(collegeNotListed)} role="option" type="button">
              {collegeNotListedLabel}
            </button>
          </div>
        )}
      </div>
      {fieldError("college")}

      {college === collegeNotListed && (
        <>
          <label className="field-label field-spaced" htmlFor="signup-custom-college">College or university name</label>
          <input aria-invalid={Boolean(errors.customCollege)} className="text-field"
            id="signup-custom-college" maxLength={160} name="customCollege"
            onChange={(event) => setCustomCollege(event.target.value)} required value={customCollege} />
          {fieldError("customCollege")}
        </>
      )}

      {isLpu && (
        <>
          <label className="field-label field-spaced" htmlFor="signup-lpu-number">LPU registration number</label>
          <input aria-invalid={Boolean(errors.lpuRegistrationNumber)} className="text-field"
            id="signup-lpu-number" inputMode="numeric" maxLength={8} name="lpuRegistrationNumber"
            onChange={(event) => setLpuRegistrationNumber(event.target.value.replace(/\D/g, ""))}
            required value={lpuRegistrationNumber} />
          {fieldError("lpuRegistrationNumber")}
        </>
      )}

      <label className="field-label field-spaced" htmlFor="signup-password">Password</label>
      <input aria-invalid={Boolean(errors.password)} autoComplete="new-password" className="text-field"
        id="signup-password" maxLength={128} minLength={10} name="password"
        onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
      <span className="field-hint">Use at least 10 characters.</span>
      {fieldError("password")}

      <label className="remember-row consent-row">
        <input aria-invalid={Boolean(errors.adultConsent)} checked={adultConsent}
          onChange={(event) => setAdultConsent(event.target.checked)} type="checkbox" />
        <span>I confirm that I am 18 or older and accept the terms.</span>
      </label>
      {fieldError("adultConsent")}

      <button className="submit-button" disabled={pending} type="submit">
        {pending ? "Creating account..." : "Create account"}<span aria-hidden="true">→</span>
      </button>
      <div aria-live="polite" className={isError ? "form-message form-error" : "form-message"}>
        {message}
      </div>
    </form>
  );
}
