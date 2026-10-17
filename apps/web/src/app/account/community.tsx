"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { answer, suggestions, type AiContext } from "./ai-brain";
import { istDateTime, istDayFullYear, istOrderTime, istTime, money, percent, tone } from "./format";
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
};

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
      const body = await response.json().catch(() => ({})) as { message?: string };
      notify(response.ok ? "ok" : "error", body.message ?? (response.ok ? "Joined." : "Couldn't join right now."));
      if (response.ok) { await load(); onChanged(); }
    } finally {
      setJoining(false);
    }
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
          </div>
          {championship.joined ? (
            <p className="xq-champ-in">✓ You&apos;re registered{championship.you ? ` · rank #${championship.you.rank} · ${percent(championship.you.returnPercent)}` : ""}</p>
          ) : championship.status !== "ended" ? (
            <button className="xq-btn primary big" disabled={joining} onClick={() => void join(championship.id)} type="button">{joining ? "Joining…" : "Join the championship"}</button>
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
            <li>Portfolio reset is disabled while the championship is live.</li>
            <li>Ranking is by percentage return; ties go to whoever joined first.</li>
            <li>Final standings are taken at the closing bell on {istDayFullYear.format(new Date(championship.endsAt))}.</li>
          </ol>
          <p className="xq-muted small">Practice money only. No entry fee and no real money changes hands.</p>
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

/* ------------------------------------------------------------------ Notes */

type Note = { id: string; title: string; body: string; createdAt: string; updatedAt: string };

export function NotesView({ notify }: { notify: Notify }) {
  const authFetch = useAuthApi();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    authFetch("/v1/notes")
      .then((response) => (response.ok ? response.json() as Promise<{ notes: Note[] }> : Promise.reject()))
      .then((body) => { setNotes(body.notes); setSelectedId(body.notes[0]?.id ?? null); })
      .catch(() => { setNotes([]); notify("error", "Couldn't load your notes."); });
  }, [authFetch, notify]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const selected = notes?.find((note) => note.id === selectedId) ?? null;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notes ?? []).filter((note) => !q || note.title.toLowerCase().includes(q) || note.body.toLowerCase().includes(q));
  }, [notes, query]);

  async function create() {
    const response = await authFetch("/v1/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "", body: "" }) });
    const body = await response.json().catch(() => ({})) as { note?: Note; message?: string };
    if (!response.ok || !body.note) { notify("error", body.message ?? "Couldn't create a note."); return; }
    setNotes((current) => [body.note!, ...(current ?? [])]);
    setSelectedId(body.note.id);
    window.setTimeout(() => document.getElementById("note-title")?.focus(), 0);
  }

  function change(field: "title" | "body", value: string) {
    if (!selected) return;
    const id = selected.id;
    setNotes((current) => (current ?? []).map((note) => (note.id === id ? { ...note, [field]: value, updatedAt: new Date().toISOString() } : note)));
    setSaveState("saving");
    // Autosave shortly after the user stops typing.
    window.clearTimeout(timers.current.get(id));
    timers.current.set(id, window.setTimeout(() => {
      const latest = { ...selected, [field]: value };
      authFetch(`/v1/notes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: latest.title, body: latest.body }) })
        .then((response) => setSaveState(response.ok ? "saved" : "error"))
        .catch(() => setSaveState("error"));
    }, 700));
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete "${selected.title || "Untitled note"}"? This can't be undone.`)) return;
    const id = selected.id;
    window.clearTimeout(timers.current.get(id));
    const response = await authFetch(`/v1/notes/${id}`, { method: "DELETE" });
    if (!response.ok) { notify("error", "Couldn't delete the note."); return; }
    const rest = (notes ?? []).filter((note) => note.id !== id);
    setNotes(rest);
    setSelectedId(rest[0]?.id ?? null);
    notify("ok", "Note deleted.");
  }

  return (
    <div className="xq-page">
      <div className="xq-page-head"><h1>Notes</h1><span className="xq-muted">Private to you · saved automatically</span></div>
      <section className="xq-panel flush xq-notes">
        <aside className="xq-notes-list">
          <div className="xq-notes-tools">
            <input aria-label="Search notes" onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" value={query} />
            <button className="xq-btn primary" onClick={() => void create()} type="button">+ New</button>
          </div>
          {notes === null ? <div className="xq-loading-block"><span className="xq-spinner" /></div> : (
            <ul>
              {visible.map((note) => (
                <li key={note.id}>
                  <button aria-current={note.id === selectedId ? "true" : undefined} onClick={() => setSelectedId(note.id)} type="button">
                    <b>{note.title || "Untitled note"}</b>
                    <small>{note.body.slice(0, 80) || "No text yet"}</small>
                    <time>{istOrderTime.format(new Date(note.updatedAt))}</time>
                  </button>
                </li>
              ))}
              {!visible.length && <li className="xq-muted xq-notes-empty">{notes.length ? "No notes match." : "No notes yet."}</li>}
            </ul>
          )}
        </aside>
        <div className="xq-notes-editor">
          {selected ? (
            <>
              <div className="xq-notes-bar">
                <span className={saveState === "error" ? "down" : "xq-muted"}>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved, retry by typing" : "Saved"}</span>
                <button className="xq-btn danger" onClick={() => void remove()} type="button">Delete</button>
              </div>
              <input aria-label="Note title" className="xq-note-title" id="note-title" maxLength={120} onChange={(event) => change("title", event.target.value)}
                placeholder="Title, e.g. Why I bought TCS" value={selected.title} />
              <textarea aria-label="Note text" className="xq-note-body" maxLength={10000} onChange={(event) => change("body", event.target.value)}
                placeholder={"Entry reason, target, stop-loss, what you learned…"} value={selected.body} />
            </>
          ) : (
            <Empty title="Write your first note">
              <p>Keep a trading journal: why you bought, when you&apos;d exit, and what you learned.</p>
              <button className="xq-btn primary" onClick={() => void create()} type="button">New note</button>
            </Empty>
          )}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ XOCRISK AI */

type ChatLine = { from: "user" | "ai"; text: string; at: number };
const aiKey = "xocrisk.ai.v1";

export function AiView({ data, quotes, indices }: { data: Dashboard; quotes: Map<string, Quote>; indices: Map<string, Quote> }) {
  const [lines, setLines] = useState<ChatLine[]>(() => {
    try {
      const saved = typeof window === "undefined" ? null : localStorage.getItem(aiKey);
      return saved ? JSON.parse(saved) as ChatLine[] : [];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const context: AiContext = useMemo(() => ({ data, quotes, indices }), [data, quotes, indices]);

  useEffect(() => {
    try { localStorage.setItem(aiKey, JSON.stringify(lines.slice(-60))); } catch { /* storage blocked */ }
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, typing]);

  function ask(question: string) {
    const text = question.trim();
    if (!text || typing) return;
    setLines((current) => [...current, { from: "user", text, at: Date.now() }]);
    setDraft("");
    setTyping(true);
    window.setTimeout(() => {
      setLines((current) => [...current, { from: "ai", text: answer(text, context), at: Date.now() }]);
      setTyping(false);
    }, 450);
  }

  return (
    <div className="xq-page narrow">
      <div className="xq-page-head">
        <h1>XOCRISK AI <span className="xq-badge">Beta</span></h1>
        {lines.length > 0 && <button className="xq-btn ghost" onClick={() => setLines([])} type="button">Clear chat</button>}
      </div>
      <section className="xq-panel flush xq-ai">
        <div className="xq-ai-list" ref={listRef}>
          {!lines.length && (
            <div className="xq-ai-welcome">
              <span className="xq-ai-orb" aria-hidden="true">✦</span>
              <h2>Hi {data.user.fullName?.split(" ")[0] ?? "there"}, I&apos;m XOCRISK AI</h2>
              <p>Ask me about the market, trading basics, your account or any NIFTY 500 stock&apos;s price.</p>
            </div>
          )}
          {lines.map((line, index) => (
            <div className={`xq-ai-line ${line.from}`} key={`${line.at}-${index}`}>
              {line.from === "ai" && <span className="xq-ai-orb small" aria-hidden="true">✦</span>}
              <p>{line.text}</p>
            </div>
          ))}
          {typing && <div className="xq-ai-line ai"><span className="xq-ai-orb small" aria-hidden="true">✦</span><p className="xq-typing"><i /><i /><i /></p></div>}
        </div>
        <div className="xq-ai-suggest">
          {suggestions.map((suggestion) => <button key={suggestion} onClick={() => ask(suggestion)} type="button">{suggestion}</button>)}
        </div>
        <form className="xq-chat-input" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
          <textarea aria-label="Ask XOCRISK AI" maxLength={300} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(draft); } }}
            placeholder="Ask anything… e.g. price of TCS" rows={1} value={draft} />
          <div><button className="xq-btn primary" disabled={!draft.trim() || typing} type="submit">Ask</button></div>
        </form>
      </section>
      <p className="xq-muted small">XOCRISK AI gives pre-written answers for learning. It isn&apos;t a financial advisor.</p>
    </div>
  );
}
