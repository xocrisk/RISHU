import test from "node:test";
import assert from "node:assert/strict";
import { answer } from "../src/app/account/ai-brain.ts";
import { lessons } from "../src/app/account/trading-knowledge.ts";

const quote = { symbol: "TCS", name: "Tata Consultancy Services", industry: "IT", price: 3000, change: 30, changePercent: 1, low: 2900, high: 3010, marketTime: "2026-10-28T09:00:00Z" };
const context = {
  data: {
    user: { fullName: "Test Trader", uid: "TEST" },
    portfolio: { totalValue: 100000, availableCash: 10000, cash: 10000, referralBonus: 0, realizedPnl: 0, unrealizedPnl: 0 },
    rules: { initialCash: 100000 }, holdings: [], orders: [], leaderboard: [],
    market: { quotes: [quote], status: { isOpen: true, nextChangeAt: "2026-10-28T10:00:00Z" } },
  }, quotes: new Map([["TCS", quote]]), indices: new Map(),
};
const ask = (text, history = []) => answer(text, context, history);

test("all curriculum lessons and quizzes are reachable through the actual assistant", () => {
  assert.equal(new Set(lessons.map(l => l.id)).size, lessons.length);
  for (const [index, lesson] of lessons.entries()) {
    const result = ask(`lesson ${index + 1}`);
    assert.ok(result.startsWith(`Lesson ${index + 1}/`), lesson.title);
    assert.ok(result.includes(lesson.explanation));
    const quiz = ask("quiz", [{ from: "ai", text: result }]);
    assert.ok(quiz.startsWith(`Quiz ${index + 1}/`));
    const history = [{ from: "ai", text: quiz }];
    assert.match(ask(String.fromCharCode(65 + lesson.correct), history), /\nCorrect\./);
    assert.match(ask(String.fromCharCode(65 + (lesson.correct + 1) % 3), history), /Not quite/);
  }
});

test("topic specificity and Hinglish resolve to the intended topic", () => {
  for (const [input, title] of [
    ["RSI kya hai?", "RSI and momentum"], ["EMA samjhao", "Moving averages and MACD"],
    ["implied volatility", "Option Greeks"], ["position sizing kaise karun", "Position sizing"],
    ["support resistance", "Support, resistance"], ["backtesting strategy", "Backtesting"],
    ["risk management", "Risk management"], ["candlestick kya hai", "Candlesticks"],
  ]) assert.ok(ask(input).includes(title), input);
  assert.match(ask("bhai puri trading sikhao"), /Trading learning roadmap/);
  assert.match(ask("पूरा कोर्स"), /Trading learning roadmap/);
  assert.doesNotMatch(ask("quantum elephant"), /Lesson \d/);
  assert.doesNotMatch(ask("tomato"), /Moving averages/);
});

test("follow-ups use the current lesson and handle missing or exhausted context", () => {
  const history = [{ from: "ai", text: ask("RSI") }];
  assert.match(ask("example", history), /RSI can remain above 70/);
  assert.match(ask("next lesson", history), /ATR and Bollinger/);
  assert.match(ask("quiz"), /Pick a topic/);
  assert.match(ask("lesson 999"), /Choose a lesson/);
  assert.match(ask("next lesson", [{ from: "ai", text: ask(`lesson ${lessons.length}`) }]), /end of this curriculum/);
  assert.match(ask("sources"), /investor.gov/);
});

test("position sizing respects cash and reports reward/risk without placing a trade", () => {
  const result = ask("position size capital 100000 cash 10000 risk 1% entry 500 stop 480 target 540");
  assert.match(result, /Risk cap: 50 shares; cash cap: 20 shares/);
  assert.match(result, /Quantity: 20 shares/);
  assert.match(result, /Planned stop-based loss: ₹400/);
  assert.match(result, /2.00:1/);
  assert.match(result, /No order has been placed/);
  assert.match(ask("position size capital 100000 cash 0 risk 1% entry 500 stop 480"), /Quantity: 0 shares/);
});

test("invalid or ambiguous sizing inputs never produce a quantity", () => {
  for (const tail of [
    "capital 100000 cash 10000 risk 1 entry 500 stop 480",
    "capital 100000 cash 10000 risk 1% entry 500 stop 500",
    "capital 100000 cash 10000 risk 1% entry 500 stop 510",
    "capital 100000 cash 10000 risk -1% entry 500 stop 480",
    "capital 100000 cash 10000 risk 1% entry 500 stop 480 target 450",
    "capital 100000 cash 10000 risk 1% entry 500 stop 480 target nope",
    "capital 1lakh cash 10000 risk 1% entry 500 stop 480",
    "capital 100000 cash 10000 risk 1% entry 500 entry 600 stop 480",
    "capital 100000 cash 10000 risk 1% entry 500",
    "capital 100000 cash 100001 risk 1% entry 500 stop 480",
  ]) assert.doesNotMatch(ask(`position size ${tail}`), /Quantity:/, tail);
});

test("prediction and profit promises cannot bypass guards with quote or lesson keywords", () => {
  for (const input of ["predict TCS price tomorrow", "guaranteed profit RSI strategy", "sure shot TCS price", "best stock for breakout"]) {
    const result = ask(input);
    assert.doesNotMatch(result, /^Lesson|delayed quote/, input);
  }
  assert.match(ask("price of TCS"), /delayed quote/);
  assert.match(ask("price of TCS"), /Quote time:/);
  assert.match(ask("my balance"), /Available to trade/);
  assert.match(ask("review my strategy"), /haven't completed any trades/);
  assert.match(ask("mera win rate"), /haven't closed/);
});

test("aggregated realised P&L is not mislabeled as per-trade win rate", () => {
  const withHoldings = { ...context, data: { ...context.data, holdings: [{ symbol: "TCS", realizedPnl: 100 }, { symbol: "ABC", realizedPnl: -50 }] } };
  assert.match(answer("mera win rate", withHoldings), /not a per-trade win rate/);
});
