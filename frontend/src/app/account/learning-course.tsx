"use client";

import { useEffect, useRef, useState } from "react";
import { chapters, checkpoints, learningStats, type LearningProgress } from "./learning-progress";

type CourseNote = { id: string; title: string; category: string };

export function CandleMark() {
  return <svg viewBox="0 0 160 130" fill="none" aria-hidden="true">
    <path d="M12 110H148M12 74H148M12 38H148" stroke="currentColor" opacity=".12" strokeDasharray="3 5" />
    <g stroke="currentColor" strokeWidth="3"><path d="M34 58V115M78 18V83M122 32V102" />
      <rect x="24" y="72" width="20" height="26" rx="4" fill="currentColor" />
      <rect x="68" y="32" width="20" height="34" rx="4" fill="currentColor" />
      <rect x="112" y="50" width="20" height="30" rx="4" fill="var(--panel)" /></g>
  </svg>;
}

export function LearningCourse({ notes, progress, onStart, onQuiz }: {
  notes: CourseNote[]; progress: LearningProgress;
  onStart: (category: string, id?: string) => void;
  onQuiz: (id: string) => void;
}) {
  const stats = learningStats(progress, notes);
  const next = notes.find(note => !progress.completed.includes(note.id)) ?? notes[0];
  const [quiz, setQuiz] = useState<keyof typeof checkpoints | null>(null);
  const [answer, setAnswer] = useState<number | null>(null);
  const quizHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (quiz) quizHeading.current?.focus(); }, [quiz]);
  const question = quiz ? checkpoints[quiz] : null;
  const correct = question && answer === question.answer;

  return <>
    <section className="xq-course-hero" aria-labelledby="candle-course-title">
      <div className="xq-course-intro">
        <span className="xq-course-eyebrow">LEARNING QUEST · 01</span>
        <h2 id="candle-course-title">CANDLESTICK<br />CHART</h2>
        <p>Small lessons. Sharper observation.<br />Learn to read the story inside a chart.</p>
        <div className="xq-course-cta"><button type="button" className="xq-btn primary" disabled={!next} onClick={() => onStart("all", next?.id)}>
          {stats.completed === notes.length && notes.length ? "Revisit lessons" : stats.completed ? "Continue learning" : "Start learning"} <span aria-hidden="true">↗</span>
        </button><span>{notes.length} lessons · 3 chapters</span></div>
      </div>
      <div className="xq-course-art"><CandleMark /><span>OBSERVE. LEARN. REPEAT.</span></div>
    </section>
    <section className="xq-course-progress" aria-label="Your learning progress">
      <div className="xq-course-level"><span aria-hidden="true">✦</span><div><b>Level {stats.level}</b><small>{stats.xp} learning XP</small></div></div>
      <div className="xq-course-meter"><div><b>Your journey</b><span>{stats.completed}/{notes.length} lessons completed</span></div><progress max={100} value={stats.percent} aria-label="Course completion" /></div>
      <strong className="xq-course-percent">{stats.percent}%</strong>
    </section>
    <div className="xq-course-section-head"><h3>Choose your chapter</h3><span>Learn at your own pace. Every chapter is open.</span></div>
    <div className="xq-course-chapters">
      {chapters.map((chapter, index) => {
        const lessons = notes.filter(note => note.category === chapter.id);
        const done = lessons.filter(note => progress.completed.includes(note.id)).length;
        const nextLesson = lessons.find(note => !progress.completed.includes(note.id)) ?? lessons[0];
        const quizDone = progress.quizzes.includes(chapter.id);
        const badge = lessons.length > 0 && done === lessons.length && quizDone;
        return <section className={`xq-course-chapter${badge ? " is-complete" : ""}`} key={chapter.id}>
          <div className="xq-course-chapter-top"><span className="xq-course-number">0{index + 1}</span><span className="xq-course-pill">{badge ? "✓ Chapter complete" : `${lessons.length} lessons`}</span></div>
          <h4>{chapter.title}</h4><p>{chapter.description}</p>
          <div className="xq-course-chapter-progress"><span>{done}/{lessons.length} complete</span><span>+10 XP / lesson</span></div>
          <progress max={Math.max(lessons.length, 1)} value={done} aria-label={`${chapter.title} completion`} />
          <button className="xq-btn" type="button" disabled={!nextLesson} onClick={() => onStart(chapter.id, nextLesson?.id)}>{done ? "Continue chapter" : "Explore chapter"} <span aria-hidden="true">→</span></button>
          <button className="xq-course-quiz-link" type="button" onClick={() => { setQuiz(chapter.id); setAnswer(null); }}>{quizDone ? "✓ Quiz passed · Practice again" : "Quick quiz · +30 XP"}</button>
          <div className={`xq-course-badge${badge ? " earned" : ""}`}><span aria-hidden="true">✧</span><span>{chapter.badge}<small>{badge ? "Badge earned!" : "Complete the lessons + quiz to earn"}</small></span></div>
        </section>;
      })}
    </div>
    {question && quiz && <section className="xq-course-quiz" aria-labelledby="course-quiz-title">
      <div className="xq-course-section-head"><span className="xq-course-eyebrow">QUICK CHECK · {chapters.find(chapter => chapter.id === quiz)?.title}</span><button className="xq-btn" type="button" onClick={() => setQuiz(null)}>Close quiz</button></div>
      <h3 id="course-quiz-title" tabIndex={-1} ref={quizHeading}>{question.question}</h3>
      <div className="xq-course-options">{question.options.map((option, index) => <button key={option} type="button" disabled={Boolean(correct)} aria-pressed={answer === index} className={answer === index ? correct ? "is-correct" : "is-wrong" : ""} onClick={() => {
        setAnswer(index);
        if (index === question.answer) onQuiz(quiz);
      }}><span aria-hidden="true">{String.fromCharCode(65 + index)}</span>{option}</button>)}</div>
      <div aria-live="polite">{answer !== null && <p className="xq-course-feedback">{correct ? "✓ Correct! " : "Not quite. Try another answer. "}{correct && question.explanation}</p>}</div>
    </section>}
  </>;
}
