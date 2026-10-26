"use client";

import "./learning-course.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { Diagram } from "../../components/market-pattern-library/MarketPatternLibrary";
import library from "../../components/market-pattern-library/patterns.json";
import { istOrderTime } from "./format";
import { Empty } from "./views";
import { LearningCourse } from "./learning-course";
import { completeActivity, learningStats, parseProgress, type LearningProgress } from "./learning-progress";

type Note = {
  id: string; title: string; body: string; category: "foundation" | "candlestick" | "chart";
  illustrations: (typeof library.patterns)[number]["illustrations"];
  version: number; createdAt: string; updatedAt: string;
};
type Draft = { id?: string; title: string; body: string; version?: number };
type Notify = (kind: "ok" | "error", text: string) => void;
const categories = { foundation: "Foundations", candlestick: "Candlestick patterns", chart: "Chart patterns" };

export function NotesView({ notify, scope }: { notify: Notify; scope: string }) {
  const authFetch = useAuthApi();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inCourse, setInCourse] = useState(false);
  const [progress, setProgress] = useState<LearningProgress>({ completed: [], quizzes: [] });
  const [storageError, setStorageError] = useState(false);
  const progressKey = `xocrisk.learning.candlestick.v1.${scope}`;

  const load = useCallback(() => authFetch("/v1/notes", { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error("Could not load learning notes. Please retry.");
      return response.json() as Promise<{ notes: Note[]; canEdit: boolean }>;
    })
    .then(body => {
      try { setProgress(parseProgress(localStorage.getItem(progressKey))); } catch { setStorageError(true); }
      setNotes(body.notes);
      setCanEdit(body.canEdit === true);
      setSelectedId(current => body.notes.some(note => note.id === current) ? current : body.notes[0]?.id ?? null);
      setError("");
    })
    .catch(() => {
      setCanEdit(false);
      setError("Could not load learning notes. Please retry.");
    }), [authFetch, progressKey]);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => (notes ?? []).filter(note =>
    (category === "all" || note.category === category)
    && `${note.title} ${note.body}`.toLowerCase().includes(query.trim().toLowerCase())), [notes, query, category]);
  const selected = visible.find(note => note.id === selectedId) ?? visible[0] ?? null;
  const stats = learningStats(progress, notes ?? []);

  function award(kind: keyof LearningProgress, id: string) {
    if (progress[kind].includes(id)) return;
    const updated = completeActivity(progress, kind, id);
    setProgress(updated);
    try { localStorage.setItem(progressKey, JSON.stringify(updated)); } catch { setStorageError(true); }
    notify("ok", kind === "completed" ? "Lesson complete! +10 learning XP" : "Quiz passed! +30 learning XP");
  }

  function startChapter(nextCategory: string, id?: string) {
    setCategory(nextCategory);
    setQuery("");
    setSelectedId(id ?? null);
    setInCourse(true);
  }

  async function save() {
    if (!canEdit || !draft || busy || !draft.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(draft.id ? `/v1/notes/${draft.id}` : "/v1/notes", {
        method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title.trim(), body: draft.body, ...(draft.id ? { version: draft.version } : {}) }),
      });
      const body = await response.json() as { note?: Note; message?: string };
      if (response.status === 403 || response.status === 401) setCanEdit(false);
      if (!response.ok || !body.note) throw new Error(body.message ?? "Could not save this note.");
      const saved = body.note;
      setNotes(current => draft.id ? (current ?? []).map(note => note.id === saved.id ? saved : note) : [...(current ?? []), saved]);
      setSelectedId(saved.id);
      setQuery("");
      setCategory("all");
      setDraft(null);
      notify("ok", "Learning note saved for everyone.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save. Your draft is still here; try again.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!canEdit || !selected || busy || !window.confirm(`Delete "${selected.title}" for everyone?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(`/v1/notes/${selected.id}?version=${selected.version}`, { method: "DELETE" });
      const body = await response.json() as { message?: string };
      if (response.status === 403 || response.status === 401) setCanEdit(false);
      if (!response.ok) throw new Error(body.message ?? "Could not delete this note.");
      setNotes(current => (current ?? []).filter(note => note.id !== selected.id));
      setSelectedId(null);
      notify("ok", "Learning note deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this note. Please retry.");
    } finally { setBusy(false); }
  }

  return (
    <div className="xq-page xq-learning">
      <div className="xq-page-head">
        <h1>Notes</h1>
        {canEdit ? <button className="xq-btn" type="button" disabled={Boolean(draft) || busy} onClick={() => { setInCourse(true); setDraft({ title: "", body: "" }); }}>+ New lesson</button> : <span className="xq-muted">Your learning space</span>}
      </div>
      {error && <div className="xq-notes-error" role="alert">
        <p>{error}</p>
        <button className="xq-btn" disabled={busy} onClick={() => {
          if (draft && !window.confirm("Discard this draft and reload the latest notes?")) return;
          setDraft(null); void load();
        }} type="button">Reload notes</button>
      </div>}
      {!inCourse && (notes ? <LearningCourse notes={notes} progress={progress} onStart={startChapter} onQuiz={id => award("quizzes", id)} /> : !error && <div className="xq-loading-block" role="status"><span className="xq-spinner" /><span>Loading your learning quest…</span></div>)}
      {inCourse && <>
      <div className="xq-course-reader-head"><button type="button" className="xq-btn" disabled={Boolean(draft) || busy} onClick={() => setInCourse(false)}>← All chapters</button><div><b>CANDLESTICK CHART</b><span>Level {stats.level} · {stats.xp} XP</span></div></div>
      <section className="xq-panel flush xq-notes">
        <aside className="xq-notes-list" aria-label="Learning notes">
          <div className="xq-notes-tools">
            <input aria-label="Search learning notes" disabled={Boolean(draft) || busy} onChange={event => setQuery(event.target.value)} placeholder="Search patterns or lessons" value={query} />
            {canEdit && <button className="xq-btn primary" disabled={Boolean(draft) || busy} onClick={() => setDraft({ title: "", body: "" })} type="button">+ New</button>}
          </div>
          <div className="xq-notes-filter">
            <label htmlFor="notes-category">Category</label>
            <select id="notes-category" disabled={Boolean(draft) || busy} value={category} onChange={event => setCategory(event.target.value)}>
              <option value="all">All learning notes</option>
              {Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {notes && <small role="status">{visible.length} of {notes.length} notes</small>}
          </div>
          {notes === null ? !error && <div className="xq-loading-block" role="status"><span className="xq-spinner" /><span>Loading notes…</span></div> : <ul>
            {visible.map(note => <li key={note.id}>
              <button aria-current={note.id === selected?.id ? "true" : undefined} disabled={Boolean(draft) || busy} onClick={() => setSelectedId(note.id)} type="button">
                <b>{progress.completed.includes(note.id) && <span className="xq-lesson-check" aria-label="Completed">✓ </span>}{note.title}</b><small>{categories[note.category]} · {progress.completed.includes(note.id) ? "Completed" : "+10 XP"}</small>
              </button>
            </li>)}
            {!visible.length && <li className="xq-muted xq-notes-empty">{notes.length ? "No notes match these filters." : "No learning notes published yet."}</li>}
          </ul>}
        </aside>
        <div className="xq-notes-editor">
          {draft ? <form className="xq-note-form" onSubmit={event => { event.preventDefault(); void save(); }}>
            <div className="xq-notes-bar">
              <span>Admin editor · {draft.id ? "Edit shared note" : "New shared note"}</span>
              <div className="xq-notes-actions">
                <button className="xq-btn" disabled={busy} onClick={() => {
                  if (window.confirm("Discard this draft?")) setDraft(null);
                }} type="button">Cancel</button>
                <button className="xq-btn primary" disabled={busy || !canEdit || !draft.title.trim()} type="submit">{busy ? "Saving…" : "Save for everyone"}</button>
              </div>
            </div>
            <input aria-label="Note title" autoFocus className="xq-note-title" disabled={busy || !canEdit} maxLength={120} required placeholder="Note title" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
            <textarea aria-label="Note text" className="xq-note-body" disabled={busy || !canEdit} maxLength={10000} placeholder="Learning content" value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} />
          </form> : selected ? <>
            <div className="xq-notes-bar">
              <span className="xq-muted">{categories[selected.category]} · Updated {istOrderTime.format(new Date(selected.updatedAt))}</span>
              {canEdit && <div className="xq-notes-actions">
                <button className="xq-btn" disabled={busy} onClick={() => setDraft({ id: selected.id, title: selected.title, body: selected.body, version: selected.version })} type="button">Edit</button>
                <button className="xq-btn danger" disabled={busy} onClick={() => void remove()} type="button">Delete</button>
              </div>}
            </div>
            <article key={selected.id} className="xq-note-reading" aria-labelledby="learning-note-title" tabIndex={0}>
              <h2 id="learning-note-title">{selected.title}</h2>
              {selected.illustrations.map((drawing, index) => <Diagram key={index} drawing={drawing} />)}
              <div className="xq-note-text">{selected.body}</div>
              <div className="xq-lesson-finish">
                <div><b>{progress.completed.includes(selected.id) ? "✓ Lesson completed" : "One lesson closer."}</b><p>{progress.completed.includes(selected.id) ? "Your 10 XP is already counted. Revisit anytime." : "Finished reading? Mark this lesson complete to earn 10 XP."}</p></div>
                <button className="xq-btn primary" type="button" disabled={progress.completed.includes(selected.id)} onClick={() => award("completed", selected.id)}>{progress.completed.includes(selected.id) ? "Completed ✓" : "Complete lesson · +10 XP"}</button>
                {visible[visible.indexOf(selected) + 1] && <button className="xq-btn" type="button" onClick={() => setSelectedId(visible[visible.indexOf(selected) + 1].id)}>Next lesson →</button>}
              </div>
            </article>
          </> : <Empty title={notes === null ? "Learning notes" : "No learning note selected"}><p>{notes === null ? "Your learning library will appear here." : "Choose a note or change your search filters."}</p></Empty>}
        </div>
      </section>
      </>}
      <p className="xq-course-footnote" role={storageError ? "status" : undefined}>{storageError ? "Browser storage is unavailable. Progress will last only for this visit." : "Progress is saved for your account in this browser. Learning XP has no cash or trading value."}</p>
      <p className="xq-muted xq-course-footnote">{library.notice}</p>
      <details className="xq-notes-references"><summary>References and content notes</summary>
        <p>{library.rightsNote}</p>
        <ul>{library.references.map(reference => <li key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a> — {reference.purpose}</li>)}</ul>
      </details>
    </div>
  );
}
