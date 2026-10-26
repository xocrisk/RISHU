export type LearningProgress = { completed: string[]; quizzes: string[] };
export const chapters = [
  { id: "foundation", title: "Build your foundation", description: "Read a candle, understand context and learn the limits.", badge: "Foundation Builder" },
  { id: "candlestick", title: "Meet the candlesticks", description: "Explore bodies, wicks and the stories behind the shapes.", badge: "Candle Explorer" },
  { id: "chart", title: "See the bigger picture", description: "Connect individual candles into chart structures.", badge: "Chart Explorer" },
] as const;

export const checkpoints = {
  foundation: { question: "What does a candle's body connect?", options: ["The highest and lowest prices", "The opening and closing prices", "Yesterday's and today's highs"], answer: 1, explanation: "The body connects open and close. The wicks extend to the high and low." },
  candlestick: { question: "When should you classify a candle's final shape?", options: ["After the candle closes", "As soon as its color changes", "Halfway through its interval"], answer: 0, explanation: "An unfinished candle can change shape. Use completed candles and consider the surrounding trend." },
  chart: { question: "Does confirmation remove the chance of a false breakout?", options: ["Yes, every time", "Only on a larger chart", "No, confirmed patterns can still fail"], answer: 2, explanation: "Confirmation follows a chosen rule; it cannot eliminate false signals or guarantee an outcome." },
} as const;

export function parseProgress(raw: string | null): LearningProgress {
  try {
    const value = JSON.parse(raw ?? "null");
    const ids = (items: unknown) => Array.isArray(items) ? [...new Set(items.filter((id): id is string => typeof id === "string"))] : [];
    return { completed: ids(value?.completed), quizzes: ids(value?.quizzes).filter(id => chapters.some(chapter => chapter.id === id)) };
  } catch { return { completed: [], quizzes: [] }; }
}

export function completeActivity(progress: LearningProgress, kind: keyof LearningProgress, id: string): LearningProgress {
  return progress[kind].includes(id) ? progress : { ...progress, [kind]: [...progress[kind], id] };
}

export function learningStats(progress: LearningProgress, notes: { id: string }[]) {
  const ids = new Set(notes.map(note => note.id));
  const completed = new Set(progress.completed.filter(id => ids.has(id))).size;
  const quizzes = new Set(progress.quizzes.filter(id => chapters.some(chapter => chapter.id === id))).size;
  const xp = completed * 10 + quizzes * 30;
  return { completed, xp, level: Math.floor(xp / 100) + 1, percent: notes.length ? Math.round(completed / notes.length * 100) : 0 };
}
