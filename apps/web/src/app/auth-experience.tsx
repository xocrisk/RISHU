"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent } from "react";
import LoginForm from "./login/login-form";
import SignupForm from "./signup/signup-form";

type Tab = "login" | "signup";

const copy: Record<Tab, { title: string; lede: string; pageTitle: string; path: string }> = {
  login: {
    title: "Welcome back",
    lede: "Log in to pick up your practice portfolio where you left it.",
    pageTitle: "Log in · XOCRISK",
    path: "/login/",
  },
  signup: {
    title: "Start practising",
    lede: "Get ₹1,00,000 in practice money. No card, no KYC, no real money ever.",
    pageTitle: "Create account · XOCRISK",
    path: "/signup/",
  },
};

// Sample figures for illustration, not live quotes.
const ticks: [symbol: string, price: string, change: number][] = [
  ["NIFTY 50", "24,812.35", 0.34], ["RELIANCE", "2,947.10", 0.84], ["TCS", "4,102.55", -0.37],
  ["HDFCBANK", "1,688.20", 0.52], ["INFY", "1,512.40", 1.12], ["ICICIBANK", "1,254.75", -0.21],
  ["SBIN", "812.30", 0.66], ["ITC", "468.90", -0.48], ["LT", "3,621.00", 0.29],
  ["BHARTIARTL", "1,595.65", 0.91], ["SENSEX", "81,204.60", 0.31],
];

function TapeTrack() {
  return (
    <div className="tape-view">
      <div className="tape-track">
        {[...ticks, ...ticks].map(([symbol, price, change], index) => (
          <span className="tick" key={index}>
            <b>{symbol}</b>
            <span className="px">{price}</span>
            <span className={change >= 0 ? "chg up" : "chg down"}>
              <svg aria-hidden="true" viewBox="0 0 8 8">
                <path d={change >= 0 ? "M4 1L7.5 7H.5z" : "M4 7L.5 1h7z"} fill="currentColor" />
              </svg>
              {change >= 0 ? "+" : "−"}{Math.abs(change).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function BrandMark() {
  // eslint-disable-next-line @next/next/no-img-element -- tiny static logo; the static app export can't use next/image
  return <img alt="" height="30" src="/icon-192.png" width="30" />;
}

export default function AuthExperience({ initialTab }: { initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    document.title = copy[tab].pageTitle;
  }, [tab]);

  function select(next: Tab, focus = false) {
    setTab(next);
    if (window.location.pathname !== copy[next].path) window.history.replaceState(null, "", copy[next].path);
    if (focus) document.getElementById(`tab-${next}`)?.focus();
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    select(tab === "login" ? "signup" : "login", true);
  }

  return (
    <div className="auth-page">
      <div className="page">
        <main className="auth">
          <div aria-hidden="true" className="tape mobile-tape"><TapeTrack /></div>
          <div className="brand-wrap">
            <Link aria-label="XOCRISK home" className="brand" href="/"><BrandMark />XOCRISK</Link>
            <p className="tagline">AI-powered trading &amp; investment education</p>
          </div>

          <div className="auth-body">
            <h1>{copy[tab].title}</h1>
            <p className="lede">{copy[tab].lede}</p>

            <div aria-label="Account" className="tabs" data-active={tab} role="tablist">
              <span aria-hidden="true" className="tab-thumb" />
              {(["login", "signup"] as const).map((name) => (
                <button aria-controls={`form-${name}`} aria-selected={tab === name} className="tab" id={`tab-${name}`}
                  key={name} onClick={() => select(name)} onKeyDown={handleTabKey} role="tab"
                  tabIndex={tab === name ? 0 : -1} type="button">
                  {name === "login" ? "Log in" : "Create account"}
                </button>
              ))}
            </div>

            <div aria-labelledby="tab-login" hidden={tab !== "login"} id="form-login" role="tabpanel"><LoginForm /></div>
            <div aria-labelledby="tab-signup" hidden={tab !== "signup"} id="form-signup" role="tabpanel"><SignupForm /></div>
          </div>

          <div className="foot">
            <span>@XOCRISK</span>
            <nav aria-label="Footer"><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
          </div>
        </main>

        <aside aria-label="About XOCRISK" className="market">
          <div aria-hidden="true" className="tape"><TapeTrack /></div>

          <div className="market-inner">
            <div>
              <h2 className="pitch">Real market rules. Pretend money.</h2>
              <p className="pitch-sub">
                Every order fills against the order book, with brokerage, STT and GST, the way a real broker does it.
                The only thing you can lose here is a bad habit.
              </p>
            </div>

            <div aria-label="Example practice order" className="slips" role="img">
              <div aria-hidden="true" className="slip back">
                <div className="slip-head"><strong>Practice order</strong><span>Intraday</span></div>
                <dl><dt>Sell TCS</dt><dd>5 × ₹4,102.55</dd><dt>Order value</dt><dd>₹20,512.75</dd></dl>
              </div>
              <div className="slip front">
                <div className="slip-head"><strong>Practice order</strong><span>Equity, delivery</span></div>
                <div aria-hidden="true" className="stamp">FILLED</div>
                <dl>
                  <dt>Buy INFY</dt><dd>10 × ₹1,512.40</dd>
                  <dt>Order value</dt><dd>₹15,124.00</dd>
                  <dt>Charges (simulated)</dt><dd>₹18.42</dd>
                  <dt>Wallet after trade</dt><dd>₹84,857.58</dd>
                  <dt className="total">Real money at risk</dt><dd className="total">₹0.00</dd>
                </dl>
                <div className="slip-foot"><span>XO-24-118932<br />10:42:18 IST</span><span className="barcode" /></div>
              </div>
            </div>
          </div>

          <p className="disclaimer">
            Prices shown are sample figures for illustration. XOCRISK is an education platform and does not give investment advice.
          </p>
        </aside>
      </div>
    </div>
  );
}
