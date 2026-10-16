"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import LoginForm from "./login/login-form";
import SignupForm from "./signup/signup-form";

type AuthExperienceProps = { initialTab: "login" | "signup"; loginMessage?: string };

const tapeItems = [
  ["NIFTY 50 · DEMO DATA", "22,450.00  +0.42%"],
  ["SENSEX · DEMO DATA", "74,120.00  +0.36%"],
  ["MARKET QUOTES", "ILLUSTRATIVE · NOT LIVE"],
  ["PRACTICE MODE", "VIRTUAL FUNDS ONLY"],
];

function MarketTape() {
  const items = [...tapeItems, ...tapeItems];
  return (
    <div aria-hidden="true" className="auth-tape">
      <div className="auth-tape-track">
        {items.map(([label, value], index) => (
          <span className="auth-tick" key={`${label}-${index}`}>
            <span>{label}</span><strong>{value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function MarketIllustration() {
  return (
    <div aria-label="Illustrative practice order slip" className="auth-slips" role="img">
      <div aria-hidden="true" className="auth-slip auth-slip-back">
        <div className="auth-slip-head"><strong>Practice order</strong><span>Intraday</span></div>
        <dl><dt>Sell TCS</dt><dd>5 × ₹4,102.55</dd><dt>Order value</dt><dd>₹20,512.75</dd></dl>
      </div>
      <div className="auth-slip auth-slip-front">
        <div className="auth-slip-head"><strong>Practice order</strong><span>Equity · delivery</span></div>
        <span aria-hidden="true" className="auth-stamp">FILLED</span>
        <dl>
          <dt>Buy INFY</dt><dd>10 × ₹1,512.40</dd>
          <dt>Order value</dt><dd>₹15,124.00</dd>
          <dt>Charges (simulated)</dt><dd>₹18.42</dd>
          <dt>Wallet after trade</dt><dd>₹84,857.58</dd>
          <dt className="auth-slip-total">Real money at risk</dt>
          <dd className="auth-slip-total auth-slip-zero">₹0.00</dd>
        </dl>
        <div className="auth-slip-foot">
          <span>ILLUSTRATIVE<br />PRACTICE ONLY</span>
          <span aria-hidden="true" className="auth-barcode" />
        </div>
      </div>
    </div>
  );
}

export default function AuthExperience({ initialTab, loginMessage }: AuthExperienceProps) {
  const router = useRouter();
  const isSignup = initialTab === "signup";

  function selectTab(tab: "login" | "signup") {
    if (tab !== initialTab) router.push(tab === "login" ? "/login" : "/signup");
  }

  return (
    <main className={`auth-experience${isSignup ? "" : " auth-login"}`}>
      <section className="auth-primary" aria-label={isSignup ? "Create an account" : "Log in"}>
        <div className="auth-mobile-tape"><MarketTape /></div>
        <header className="auth-brand-wrap">
          <Link aria-label="XOCRISK home" className="auth-brand" href="/">
            <svg aria-hidden="true" viewBox="0 0 28 28">
              <g transform="rotate(40 14 14)">
                <rect fill="var(--auth-up)" height="27" rx=".7" width="1.4" x="13.3" y=".5" />
                <rect fill="var(--auth-up)" height="9.5" rx="1.2" width="6" x="11" y="2.5" />
              </g>
              <g transform="rotate(-40 14 14)">
                <rect fill="var(--auth-down)" height="27" rx=".7" width="1.4" x="13.3" y=".5" />
                <rect fill="var(--auth-down)" height="9.5" rx="1.2" width="6" x="11" y="16" />
              </g>
            </svg>
            XOCRISK
          </Link>
        </header>

        <div className="auth-primary-body">
          <h1>{isSignup ? "Start practising" : "Welcome back"}</h1>
          <p className="auth-lede">
            {isSignup
              ? "Get ₹1,00,000 in practice money. No card, no KYC, no real money ever."
              : "Log in to pick up your practice portfolio where you left it."}
          </p>
          <div aria-label="Account" className="auth-account-tabs" role="tablist">
            <button aria-controls="auth-form-panel" aria-selected={!isSignup}
              className={!isSignup ? "is-active" : ""} id="auth-tab-login"
              onClick={() => selectTab("login")} role="tab" type="button">Log in</button>
            <button aria-controls="auth-form-panel" aria-selected={isSignup}
              className={isSignup ? "is-active" : ""} id="auth-tab-signup"
              onClick={() => selectTab("signup")} role="tab" type="button">Create account</button>
            <span aria-hidden="true" className={isSignup ? "auth-tab-thumb signup" : "auth-tab-thumb"} />
          </div>
          <div aria-labelledby={isSignup ? "auth-tab-signup" : "auth-tab-login"}
            className="auth-form-panel" id="auth-form-panel" role="tabpanel">
            {isSignup ? <SignupForm /> : <LoginForm initialMessage={loginMessage} />}
          </div>
          {isSignup && (
            <p className="auth-practice-note">
              You start with ₹1,00,000 in practice money. It can’t be deposited or withdrawn.
            </p>
          )}
        </div>

        <footer className="auth-footer">
          {isSignup ? (
            <>
              <span>@XOCRISK</span>
              <nav aria-label="Footer">
                <Link href="/help">Help</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>
              </nav>
            </>
          ) : (
            <span>@XOCRISK</span>
          )}
        </footer>
      </section>

      <aside aria-label="About XOCRISK" className="auth-market">
        <MarketTape />
        <div className="auth-market-inner">
          <div>
            <h2>Real market rules. Pretend money.</h2>
            <p className="auth-market-copy">
              Learn how orders and simulated charges work, without putting real money at risk.
              Market prices shown are illustrative demo data, not live quotes.
            </p>
          </div>
          <MarketIllustration />
        </div>
        <p className="auth-market-disclaimer">
          Figures shown are illustrative only. XOCRISK is a practice platform and does not give investment advice.
        </p>
      </aside>
    </main>
  );
}
