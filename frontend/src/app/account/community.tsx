"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { suggestions, type AiContext } from "./ai-brain";
import { answerWithMarket } from "./market-analysis";
import { istDateTime, istDayFullYear, istTime, money, percent, tone } from "./format";
import type { Dashboard, Quote } from "./types";
import { Empty } from "./views";

type Notify = (kind: "ok" | "error", text: string) => void;

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "X";
  const hue = [...name].reduce((total, char) => total + char.charCodeAt(0), 0) % 360;
  return <span aria-hidden="true" className="xq-avatar" style={{ width: size, height: size, background: `hsl(${hue} 70% 94%)`, color: `hsl(${hue} 55% 35%)` }}>{initials}</span>;
}

/* ------------------------------------------------------------------ Championship */

type Entry = { rank: number; displayName: string; uid: string; value: number; returnPercent: number; joinedAt: string; isSelf: boolean };
type Championship = {
  id: string; title: string; organizer: string; description: string; startsAt: string; endsAt: string;
  status: "upcoming" | "live" | "ended"; participantCount: number; joined: boolean; you: Entry | null; leaderboard: Entry[];
  entryFee: number; feePaid: boolean; paymentsEnabled: boolean;
};

type RazorpayOrder = {
  keyId: string; orderId: string; amount: number; currency: string; description: string;
  prefill: { name: string; email: string; contact: string };
};
type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCheckout = new (options: Record<string, unknown>) => { open: () => void; on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void };

/** Loads Razorpay's checkout script once. */
function loadRazorpay(): Promise<RazorpayCheckout> {
  const existing = (window as { Razorpay?: RazorpayCheckout }).Razorpay;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => {
      const loaded = (window as { Razorpay?: RazorpayCheckout }).Razorpay;
      if (loaded) resolve(loaded); else reject(new Error("Razorpay unavailable"));
    };
    script.onerror = () => reject(new Error("Razorpay unavailable"));
    document.head.appendChild(script);
  });
}

function countdown(target: string, now: number) {
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return "0m";
  const days = Math.floor(ms / 86_400_000), hours = Math.floor((ms % 86_400_000) / 3_600_000), minutes = Math.floor((ms % 3_600_000) / 60_000);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function ChampionshipView({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  const authFetch = useAuthApi();
  const [list, setList] = useState<Championship[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [joining, setJoining] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => authFetch("/v1/championships")
    .then((response) => (response.ok ? response.json() as Promise<{ championships: Championship[] }> : Promise.reject()))
    .then((body) => { setList(body.championships); setFailed(false); })
    .catch(() => setFailed(true)), [authFetch]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, [load]);

  async function join(id: string) {
    setJoining(true);
    try {
      const response = await authFetch(`/v1/championships/${encodeURIComponent(id)}/join`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { message?: string; requiresPayment?: boolean };
      if (body.requiresPayment) { await pay(id); return; }
      notify(response.ok ? "ok" : "error", body.message ?? (response.ok ? "Joined." : "Couldn't join right now."));
      if (response.ok) { await load(); onChanged(); }
    } finally {
      setJoining(false);
    }
  }

  // Entry fee: the API creates a Razorpay order, Razorpay's checkout takes the payment (UPI, cards, net banking),
  // and the API verifies the signed result before adding the user to the championship.
  async function pay(id: string) {
    const path = `/v1/championships/${encodeURIComponent(id)}/payment`;
    const response = await authFetch(path, { method: "POST" });
    const order = await response.json().catch(() => ({})) as Partial<RazorpayOrder> & { message?: string };
    if (!response.ok || !order.orderId) { notify("error", order.message ?? "The payment couldn't be started."); return; }
    let Razorpay: RazorpayCheckout;
    try {
      Razorpay = await loadRazorpay();
    } catch {
      notify("error", "Couldn't open the payment window. Check your connection and try again.");
      return;
    }
    await new Promise<void>((done) => {
      const checkout = new Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
        name: "XOCRISK", description: order.description, prefill: order.prefill, theme: { color: "#b8862f" },
        handler: async (result: RazorpayResponse) => {
          const verify = await authFetch(`${path}/verify`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: result.razorpay_order_id, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature }),
          });
          const body = await verify.json().catch(() => ({})) as { message?: string };
          notify(verify.ok ? "ok" : "error", body.message ?? (verify.ok ? "Payment received. You're in!" : "The payment couldn't be verified."));
          if (verify.ok) { await load(); onChanged(); }
          done();
        },
        modal: { ondismiss: () => done() },
      });
      checkout.on("payment.failed", (failure) => notify("error", failure.error?.description ?? "The payment failed. No money was taken."));
      checkout.open();
    });
  }

  if (failed && !list) return <div className="xq-page"><Empty title="Couldn't load the championship"><p>Check your connection and try again.</p></Empty></div>;
  if (!list) return <div className="xq-page"><div className="xq-loading-block"><span className="xq-spinner" /></div></div>;
  const championship = list[0];
  if (!championship) return <div className="xq-page"><Empty title="No championship is running right now" /></div>;

  const statusLabel = championship.status === "live" ? "Live" : championship.status === "upcoming" ? "Registrations open" : "Ended";
  return (
    <div className="xq-page">
      <section className="xq-champ-hero">
        <div className="xq-champ-text">
          <p className="xq-champ-org"><span className="xq-lpu">LPU</span> Conducted by {championship.organizer}</p>
          <h1>{championship.title}</h1>
          <p>{championship.description}</p>
          <div className="xq-champ-meta">
            <span className={`xq-status-chip ${championship.status}`}><i />{statusLabel}</span>
            <span>{istDayFullYear.format(new Date(championship.startsAt))} – {istDayFullYear.format(new Date(championship.endsAt))}</span>
            <span>{championship.participantCount} trader{championship.participantCount === 1 ? "" : "s"} joined</span>
            <span className="xq-fee-chip">{championship.entryFee > 0 ? `Entry ₹${championship.entryFee}` : "Free entry"}</span>
          </div>
          {championship.joined ? (
            <p className="xq-champ-in">✓ You&apos;re registered{championship.you ? ` · rank #${championship.you.rank} · ${percent(championship.you.returnPercent)}` : ""}</p>
          ) : championship.status !== "ended" ? (
            <button className="xq-btn primary big" disabled={joining} onClick={() => void join(championship.id)} type="button">
              {joining ? "Please wait…" : championship.entryFee > 0 && !championship.feePaid ? `Pay ₹${championship.entryFee} & join` : "Join the championship"}
            </button>
          ) : null}
        </div>
        <div className="xq-champ-clock">
          <span>{championship.status === "upcoming" ? "Starts in" : championship.status === "live" ? "Ends in" : "Finished"}</span>
          <strong>{championship.status === "ended" ? "—" : countdown(championship.status === "upcoming" ? championship.startsAt : championship.endsAt, now)}</strong>
          <small>{istDateTime.format(new Date(championship.status === "upcoming" ? championship.startsAt : championship.endsAt))} IST</small>
        </div>
      </section>

      <div className="xq-grid-2 wide-left">
        <section className="xq-panel">
          <h2 className="xq-panel-title">Leaderboard</h2>
          {championship.leaderboard.length ? (
            <div className="xq-table-wrap">
              <table className="xq-table">
                <thead><tr><th>Rank</th><th>Trader</th><th>UID</th><th className="r">Account value</th><th className="r">Return</th></tr></thead>
                <tbody>
                  {championship.leaderboard.map((entry) => (
                    <tr className={entry.isSelf ? "is-self" : ""} key={entry.uid}>
                      <td><span className={`xt-rank r${entry.rank}`}>{entry.rank}</span></td>
                      <td><span className="xq-person"><Avatar name={entry.displayName} size={28} />{entry.displayName}{entry.isSelf && <em>YOU</em>}</span></td>
                      <td><code className="xq-uid">{entry.uid}</code></td>
                      <td className="r">{money(entry.value)}</td>
                      <td className={`r ${tone(entry.returnPercent)}`}><b>{percent(entry.returnPercent)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No one has joined yet"><p>Be the first on the board.</p></Empty>}
        </section>
        <section className="xq-panel">
          <h2 className="xq-panel-title">Rules</h2>
          <ol className="xq-rules">
            <li>Open to every XOCRISK trader. Join once; you can&apos;t leave and re-join.</li>
            <li>Your return is measured from your account value at the moment you join.</li>
            <li>Trade NIFTY 500 stocks with your practice money, on NSE hours (9:15 AM – 3:30 PM IST).</li>
            <li>Your portfolio and trading history are saved permanently; portfolio reset is unavailable.</li>
            <li>Ranking is by percentage return; ties go to whoever joined first.</li>
            <li>Final standings are taken at the closing bell on {istDayFullYear.format(new Date(championship.endsAt))}.</li>
          </ol>
          <p className="xq-muted small">
            {championship.entryFee > 0
              ? `Entry fee ₹${championship.entryFee}, paid once securely through Razorpay (UPI, cards, net banking). Trading itself uses practice money only.`
              : "Free to join. Trading uses practice money only."}
          </p>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Community chat */

type Message = { id: number; body: string; createdAt: string; author: { name: string; uid: string }; isSelf: boolean };

export function CommunityView({ data, notify }: { data: Dashboard; notify: Notify }) {
  const authFetch = useAuthApi();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);
  const stickToBottom = useRef(true);

  const poll = useCallback(async () => {
    const response = await authFetch(`/v1/community/messages${lastId.current ? `?after=${lastId.current}` : ""}`);
    if (!response.ok) return;
    const body = await response.json() as { messages: Message[]; activeToday: number };
    setActive(body.activeToday);
    if (body.messages.length) {
      lastId.current = body.messages[body.messages.length - 1].id;
      setMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        return [...current, ...body.messages.filter((message) => !seen.has(message.id))].slice(-300);
      });
    }
    setLoaded(true);
  }, [authFetch]);

  useEffect(() => {
    void poll().catch(() => setLoaded(true));
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void poll().catch(() => {}); }, 5000);
    return () => window.clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    const element = listRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const response = await authFetch("/v1/community/messages", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
      });
      const result = await response.json().catch(() => ({})) as { message?: Message | string };
      if (!response.ok) { notify("error", typeof result.message === "string" ? result.message : "Message not sent."); return; }
      setDraft("");
      stickToBottom.current = true;
      await poll();
    } catch {
      notify("error", "Message not sent. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  async function remove(id: number) {
    const response = await authFetch(`/v1/community/messages/${id}`, { method: "DELETE" });
    if (response.ok) setMessages((current) => current.filter((message) => message.id !== id));
    else notify("error", "Couldn't delete that message.");
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  return (
    <div className="xq-page">
      <div className="xq-page-head">
        <h1>Community</h1>
        <span className="xq-muted">{active} trader{active === 1 ? "" : "s"} active today · you appear as <b>{data.user.fullName ?? "XOCRISK trader"}</b> <code className="xq-uid">{data.user.uid}</code></span>
      </div>
      <section className="xq-panel flush xq-chat">
        <div className="xq-chat-list" onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }} ref={listRef}>
          {!loaded && <div className="xq-loading-block"><span className="xq-spinner" /></div>}
          {loaded && !messages.length && <Empty title="Say hello to the community"><p>Messages show only your name and UID.</p></Empty>}
          {messages.map((message, index) => {
            const day = istDayFullYear.format(new Date(message.createdAt));
            const previous = index ? istDayFullYear.format(new Date(messages[index - 1].createdAt)) : "";
            const divider = day !== previous ? <div className="xq-chat-day" key={`d-${message.id}`}><span>{day}</span></div> : null;
            return [
              divider,
              <article className={`xq-msg ${message.isSelf ? "self" : ""}`} key={message.id}>
                {!message.isSelf && <Avatar name={message.author.name} size={34} />}
                <div className="xq-msg-bubble">
                  <header>
                    <b>{message.isSelf ? "You" : message.author.name}</b>
                    <code className="xq-uid">{message.author.uid}</code>
                    <time dateTime={message.createdAt}>{istTime.format(new Date(message.createdAt))}</time>
                    {message.isSelf && <button aria-label="Delete message" className="xq-msg-delete" onClick={() => void remove(message.id)} type="button">Delete</button>}
                  </header>
                  <p>{message.body}</p>
                </div>
              </article>,
            ];
          })}
        </div>
        <form className="xq-chat-input" onSubmit={(event) => void send(event)}>
          <textarea aria-label="Message" maxLength={500} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey}
            placeholder="Message the community… (Enter to send, Shift+Enter for a new line)" rows={2} value={draft} />
          <div>
            <small className={draft.length > 450 ? "down" : "xq-muted"}>{draft.length}/500</small>
            <button className="xq-btn primary" disabled={sending || !draft.trim()} type="submit">{sending ? "Sending…" : "Send"}</button>
          </div>
        </form>
      </section>
      <p className="xq-muted small">Be respectful. Don&apos;t share phone numbers, passwords or other personal details, and don&apos;t treat anyone&apos;s message as financial advice.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ XOCRISK AI */

type ChatLine = { from: "user" | "ai"; text: string; at: number };
const aiKey = "xocrisk.ai.v1";

export function AiView({ data, quotes, indices }: { data: Dashboard; quotes: Map<string, Quote>; indices: Map<string, Quote> }) {
  const authFetch = useAuthApi();
  const pending = useRef<AbortController | null>(null);
  const [lines, setLines] = useState<ChatLine[]>(() => {
    try {
      const saved = typeof window === "undefined" ? null : localStorage.getItem(aiKey);
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((line): line is ChatLine => line && (line.from === "user" || line.from === "ai") && typeof line.text === "string" && Number.isFinite(line.at)).slice(-60) : [];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const context: AiContext = useMemo(() => ({ data, quotes, indices }), [data, quotes, indices]);

  useEffect(() => () => { pending.current?.abort(); }, []);

  useEffect(() => {
    try { localStorage.setItem(aiKey, JSON.stringify(lines.slice(-60))); } catch { /* storage blocked */ }
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, typing]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLines((current) => [...current, { from: "user", text, at: Date.now() }]);
    setDraft("");
    setTyping(true);
    try {
      const response = await answerWithMarket(text, context, lines, authFetch, controller.signal);
      if (!controller.signal.aborted) setLines((current) => [...current, { from: "ai", text: response, at: Date.now() }]);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setTyping(false);
    }
  }

  return (
    <div className="xq-page narrow">
      <div className="xq-page-head">
        <h1>XOCRISK AI</h1>
        {lines.length > 0 && <button className="xq-btn ghost" disabled={typing} onClick={() => setLines([])} type="button">Clear chat</button>}
      </div>
      <section className="xq-panel flush xq-ai">
        <div className="xq-ai-list" ref={listRef}>
          {!lines.length && (
            <div className="xq-ai-welcome">
              <span className="xq-ai-orb" aria-hidden="true">✦</span>
              <h2>Hi {data.user.fullName?.split(" ")[0] ?? "there"}, I&apos;m XOCRISK AI</h2>
              <p>Scan NSE stocks, analyze a company&apos;s chart, or learn trading step by step. Try “market scan karo” or “Reliance analyze karo” for analysis from delayed market data.</p>
            </div>
          )}
          {lines.map((line, index) => (
            <div className={`xq-ai-line ${line.from}`} key={`${line.at}-${index}`}>
              {line.from === "ai" && <span className="xq-ai-orb small" aria-hidden="true">✦</span>}
              <p>{line.text}</p>
            </div>
          ))}
          {typing && <div className="xq-ai-line ai" role="status"><span className="xq-ai-orb small" aria-hidden="true">✦</span><p>Preparing your answer… Market scans can take up to 30 seconds.</p></div>}
        </div>
        <div className="xq-ai-suggest">
          {suggestions.map((suggestion) => <button disabled={typing} key={suggestion} onClick={() => void ask(suggestion)} type="button">{suggestion}</button>)}
        </div>
        <form className="xq-chat-input" onSubmit={(event) => { event.preventDefault(); void ask(draft); }}>
          <textarea aria-label="Ask XOCRISK AI" maxLength={300} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(draft); } }}
            placeholder="Try: market scan karo, TCS analyze karo, or RSI kya hai?" rows={1} value={draft} />
          <div><button className="xq-btn primary" disabled={!draft.trim() || typing} type="submit">Ask</button></div>
        </form>
      </section>
      <p className="xq-muted small">Chart analysis uses delayed, unofficial Yahoo Finance data. Coverage and timestamps appear in each scan. Rule matches are educational, not predictions or buy/sell advice.</p>
    </div>
  );
}
