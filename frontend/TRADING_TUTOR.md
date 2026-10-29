# XOCRISK trading tutor

The assistant is a deterministic, curated tutor, not a trained language model. Lessons use the existing dashboard context and local chat history. Market-analysis requests now fetch chart data through the authenticated scanner API; see [market scanner integration](../docs/XOCRISK_MARKET_SCANNER.md). It does not fit model weights, connect a language-model provider or execute trades.

## Using it

- Ask `puri trading sikhao` or `syllabus` for the 23-lesson roadmap.
- Open `lesson 1` or ask a topic such as `RSI kya hai?`, `backtesting`, or `options Greeks`.
- Follow with `example`, `quiz` (answer A/B/C), or `next lesson`.
- Calculate a hypothetical long-equity position with `position size capital 100000 cash 10000 risk 1% entry 500 stop 480 target 540`. Required amounts are explicit; capital is account equity, cash is available buying cash, risk is a user-chosen percentage. Target is optional. No leverage or fees are included. The cash cap and risk cap both apply.
- Ask `sources` for reference URLs. Current tax rates, exchange contract details and prices are not part of this static curriculum.

## Maintaining the curriculum

`src/app/account/trading-knowledge.ts` holds lessons, examples, exercises, questions and source references. `trading-tutor.ts` handles topic matching, follow-ups and sizing. `ai-brain.ts` keeps account-aware answers and routes guardrails before educational and quote responses. `community.tsx` supplies the current chat history. Lessons use numbered headers to recover context from the saved conversation; this is not model memory or a persistent course-completion score.

Topic matching uses bounded phrases, prioritizing the longest alias. It is not general natural-language comprehension: unsupported questions return the existing fallback. English and common Hinglish are supported; complete Hindi translation is not implemented. Numerical lesson examples are hypothetical and do not constitute validated strategies. The scanner computes indicators from delayed completed chart candles; uploaded chart interpretation is not supported.

Sources were checked on 2026-10-28: Investor.gov order mechanics and diversification, CME position sizing, NSE investor risks, and Fidelity's technical-indicator guide. Examples, quizzes, strategy-testing exercises and routing rules are original curriculum material, not claims of exchange endorsement. Review applicable rules at their official source before updating time-sensitive content.

## Validation

Run `node --test frontend/test/ai-brain.test.mjs` from the repository root. Tests exercise every lesson and quiz through the actual assistant, follow-up navigation, Hinglish routing, risk calculations, invalid inputs, guardrail priority, delayed quotes and account-query regressions. Also run the repository typecheck, lint, test and build commands. These checks validate software behavior, not investment performance.
