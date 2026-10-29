import { lessons, learningSources, type Lesson } from "./trading-knowledge.ts";

export type TutorLine = { from: "user" | "ai"; text: string };
const compact = (text: string) => text.toLowerCase().replace(/(?<=[a-z])[-–](?=[a-z])/g, " ").replace(/\s+/g, " ").trim();
const phrase = (text: string, alias: string) => (` ${text.replace(/[^a-z0-9/& ]/g, " ")} `).includes(` ${alias} `);

function findLesson(text: string): Lesson | undefined {
  const numbered = text.match(/\b(?:lesson|chapter|module)\s+(\d+)\b/);
  if (numbered) return lessons[Number(numbered[1]) - 1];
  // Prefer the most specific phrase, so "implied volatility" wins over "volatility".
  return lessons.flatMap(lesson => lesson.aliases.filter(alias => phrase(text, alias)).map(alias => ({ lesson, score: alias.length })))
    .sort((a, b) => b.score - a.score)[0]?.lesson;
}

function previousLesson(history: TutorLine[]): Lesson | undefined {
  for (const line of [...history].reverse()) {
    if (line.from !== "ai") continue;
    const marker = line.text.match(/^(?:Lesson|Quiz) (\d+)\//);
    if (marker) return lessons[Number(marker[1]) - 1];
  }
}

const heading = (lesson: Lesson, quiz = false) => `${quiz ? "Quiz" : "Lesson"} ${lessons.indexOf(lesson) + 1}/${lessons.length}: ${lesson.title}`;
function showLesson(lesson: Lesson): string {
  return `${heading(lesson)}\n\n${lesson.explanation}\n\nExample: ${lesson.example}\n\nPractice: ${lesson.practice}\n\nAsk “example”, “quiz”, “next lesson” or “sources”. Examples are hypothetical, not stock recommendations.`;
}

function sizePosition(text: string): string | undefined {
  if (!/\b(position siz(?:e|ing)|calculate size|size position)\b/.test(text) || !/\d/.test(text)) return;
  const read = (label: string) => {
    const matches = [...text.matchAll(new RegExp(`\\b(?:${label})\\s*[:=]?\\s*(?:₹|rs\\.?\\s*)?(-?[0-9][0-9,]*(?:\\.[0-9]+)?)(%?)(?![a-z0-9.])`, "g"))];
    if (matches.length !== 1) return undefined;
    return { value: Number(matches[0][1].replace(/,/g, "")), percent: matches[0][2] === "%" };
  };
  const capital = read("capital"), cash = read("cash"), risk = read("risk"), entry = read("entry"), stop = read("stop(?: loss)?"), target = read("target");
  const help = "For a virtual long-equity calculation, use: position size capital 100000 cash 10000 risk 1% entry 500 stop 480 target 540. Capital, available cash, risk %, entry and stop are required; target is optional. Use full rupee amounts (not lakh/k), with each field once.";
  if (!capital || !cash || !risk || !entry || !stop || (/\btarget\b/.test(text) && !target)) return help;
  const values = [capital, cash, risk, entry, stop, ...(target ? [target] : [])];
  if (values.some(v => !Number.isFinite(v.value)) || !risk.percent || [capital, cash, entry, stop, ...(target ? [target] : [])].some(v => v.percent) || capital.value <= 0 || cash.value < 0 || cash.value > capital.value || risk.value <= 0 || risk.value > 100 || stop.value <= 0 || entry.value <= stop.value || (target && target.value <= entry.value)) {
    return `Invalid sizing inputs: require positive capital, 0 ≤ cash ≤ capital, 0 < risk ≤ 100%, and 0 < stop < entry < target (when supplied). ${help}`;
  }
  if (/\b(short|sell|option|options|future|futures|leverage)\b/.test(text)) return "This calculator supports unleveraged long equity only, not short positions or derivative contracts.";
  const budget = capital.value * risk.value / 100;
  const perShare = entry.value - stop.value;
  const riskCap = Math.floor(budget / perShare);
  const cashCap = Math.floor(cash.value / entry.value);
  const quantity = Math.min(riskCap, cashCap);
  if (![budget, perShare, riskCap, cashCap, quantity * entry.value].every(Number.isFinite) || !Number.isSafeInteger(quantity)) return help;
  const fmt = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `Virtual long-equity sizing\nRisk budget: ₹${fmt(budget)} (${risk.value}% chosen by you; not a recommended risk level).\nRisk per share: ₹${fmt(perShare)}.\nRisk cap: ${riskCap} shares; cash cap: ${cashCap} shares.\nQuantity: ${quantity} shares. Position value: ₹${fmt(quantity * entry.value)}. Planned stop-based loss: ₹${fmt(quantity * perShare)}.${target ? `\nPotential reward/risk: ${((target.value - entry.value) / perShare).toFixed(2)}:1 before costs.` : ""}\n${quantity === 0 ? "The supplied cash or risk budget cannot cover one share. " : ""}Fees, gaps and slippage can increase losses; exposure limits may reduce quantity further. XOCRISK does not execute an automatic stop-loss. No order has been placed.`;
}

/** Returns undefined for account/app questions, preserving the existing assistant. */
export function tutorAnswer(input: string, history: TutorLine[] = []): string | undefined {
  const text = compact(input);
  const sizing = sizePosition(text);
  if (sizing) return sizing;
  if (/^(?:sources?|references?|learning sources|source kya hai)[?.! ]*$/.test(text)) {
    return `Learning references (reviewed 2026-10-28):\n${learningSources.map(([title, url]) => `${title}\n${url}`).join("\n\n")}\n\nLessons are curated explanations with hypothetical exercises. Current fees, taxes, contract specifications and market conditions must be verified separately.`;
  }
  if (/\b(syllabus|curriculum|roadmap|full course|complete course|puri trading|poori trading|trading sikhao|trading sikha|trading seekhna|learn trading|beginner|kaha se shuru)\b/.test(text) || /ट्रेडिंग.*(सिखा|सीख)|पूरा.*कोर्स/.test(text)) {
    return `Trading learning roadmap — ${lessons.length} lessons\n${lessons.map((lesson, index) => `${index + 1}. ${lesson.title}`).join("\n")}\n\nStart with “lesson 1”, then use “next lesson”, “example” and “quiz”. You can also ask a topic directly, in English or common Hinglish. This is a curated tutor, not a trained prediction model. Completing lessons does not prove trading competence.`;
  }
  const previous = previousLesson(history);
  const latest = [...history].reverse().find(line => line.from === "ai");
  const choice = text.match(/^(?:answer\s*)?([abc123])[).! ]*$/);
  if (choice && latest?.text.startsWith("Quiz ") && previous) {
    const selected = "abc".includes(choice[1]) ? "abc".indexOf(choice[1]) : Number(choice[1]) - 1;
    return `${heading(previous)}\n${selected === previous.correct ? "Correct." : "Not quite."} ${String.fromCharCode(65 + previous.correct)}: ${previous.choices[previous.correct]}.\n\n${previous.explanation}\n\nAsk “next lesson” to continue or “quiz” to retry.`;
  }
  if (/^(?:next(?: lesson| topic| chapter)?|continue|aage|agla(?: lesson)?)[?.! ]*$/.test(text)) {
    const index = previous ? lessons.indexOf(previous) + 1 : 0;
    return lessons[index] ? showLesson(lessons[index]) : "You've reached the end of this curriculum. Revisit a topic, test yourself with its quiz, or ask about backtesting and review your practice journal. Completion is not evidence of a profitable strategy.";
  }
  const explicit = findLesson(text);
  if (/\b(?:lesson|chapter|module)\s+\d+\b/.test(text) && !explicit) return `Choose a lesson from 1 to ${lessons.length}, or ask for the syllabus.`;
  const followup = /^(?:example(?: do| please)?|explain more|aur batao|samjhao|practice|quiz(?: me)?|test me)[?.! ]*$/.test(text);
  const lesson = explicit ?? (followup ? previous : undefined);
  if (followup && !lesson) return "Pick a topic first, for example “RSI”, “position sizing” or “lesson 1”. Then ask for an example or quiz.";
  if (!lesson) return;
  if (/\b(quiz|test me)\b/.test(text)) return `${heading(lesson, true)}\n${lesson.question}\n${lesson.choices.map((choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`).join("\n")}\nReply A, B or C.`;
  if (followup && /example|practice/.test(text)) return `${heading(lesson)}\nExample: ${lesson.example}\nPractice: ${lesson.practice}`;
  // Personal records and app workflows belong to the account-aware assistant.
  if (/\b(my|mera|meri|mere|today|aaj|cancel|place|rejected|available|supported)\b/.test(text) && !/\b(explain|teach|what is|kya hai)\b/.test(text)) return;
  return showLesson(lesson);
}
