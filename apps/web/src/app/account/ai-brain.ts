// XOCRISK AI: a rule-based assistant. Every answer is written in advance; a few fill in live numbers
// (prices, market status, the user's account). It never calls a language model.
import { istDateTime, money, percent, price, signed } from "./format";
import type { Dashboard, Quote } from "./types";

export type AiContext = { data: Dashboard; quotes: Map<string, Quote>; indices: Map<string, Quote> };
type Answer = string | ((context: AiContext, text: string) => string);
type Intent = { patterns: RegExp[]; answer: Answer };

const firstName = (context: AiContext) => context.data.user.fullName?.split(" ")[0] ?? "there";
const marketLine = ({ data }: AiContext) => {
  const status = data.market.status;
  return status.isOpen
    ? `The market is open right now and closes at ${istDateTime.format(new Date(status.nextChangeAt))} IST.`
    : `The market is closed${status.reason ? ` (${status.reason})` : ""}. It opens ${istDateTime.format(new Date(status.nextChangeAt))} IST.`;
};
const quoteLine = (quote: Quote) =>
  `${quote.symbol} (${quote.name}) is at ${quote.industry === "Index" ? "" : "₹"}${price(quote.price)}, ${percent(quote.changePercent)} today (${signed(quote.change, price)}). Day range ${price(quote.low)} – ${price(quote.high)}.`;

const intents: Intent[] = [
  // ---- small talk
  { patterns: [/^(hi+|hello+|hey+|hlo|helo|hii|yo|namaste|namaskar|hola)\b/, /^good (morning|afternoon|evening)/],
    answer: (context) => `Hello ${firstName(context)}! How was your day? I'm XOCRISK AI. Ask me about trading, the market, or your account.` },
  { patterns: [/how (are|r) (you|u)/, /kaise ho/, /how('s| is) it going/, /what'?s up/, /wassup/],
    answer: "I'm doing great, thanks for asking! How about you? How's your trading going today?" },
  { patterns: [/^(it was |my day was |day was )?(good|great|fine|nice|awesome|amazing|accha|acha|badhiya|mast|ok|okay|theek)\b/],
    answer: "That's great to hear! A good day is the best time to learn something new. Want to know how limit orders work, or check a stock's price?" },
  { patterns: [/^(it was |my day was )?(bad|not good|sad|terrible|worst|boring|bura|kharab)\b/, /not (so )?(good|great)/],
    answer: "Sorry to hear that. Markets have bad days too, and they recover. Take a break, and when you're ready I can help you review your portfolio." },
  { patterns: [/thank|thanks|thx|ty\b|dhanyavad|shukriya/], answer: "You're welcome! Happy trading." },
  { patterns: [/^(bye|goodbye|see you|cya|good night|gn)\b/], answer: "Bye! See you at the next market open." },
  { patterns: [/who are you|what are you|your name|xocrisk ai/],
    answer: "I'm XOCRISK AI, your practice-trading assistant. I answer common questions about the stock market and this app, and I can look up live prices. I'm rule-based, so I only know the answers I've been taught." },

  // ---- live data
  { patterns: [/(is|are) (the )?market(s)? (open|closed|close)/, /market (timing|time|hours)/, /when (does|will) (the )?market (open|close)/, /trading (hours|time)/],
    answer: (context) => `NSE trades 9:15 AM – 3:30 PM IST, Monday to Friday, except exchange holidays. ${marketLine(context)}` },
  { patterns: [/\bnifty ?50\b|\bnifty\b(?! bank)/], answer: (context) => {
    const index = context.indices.get("NIFTY 50");
    return `NIFTY 50 is an index of 50 of the largest companies on the NSE. It shows how the overall market is doing.${index ? ` Right now: ${quoteLine(index)}` : ""}`;
  } },
  { patterns: [/\bsensex\b/], answer: (context) => {
    const index = context.indices.get("SENSEX");
    return `SENSEX tracks 30 large companies listed on the BSE.${index ? ` Right now: ${quoteLine(index)}` : ""}`;
  } },
  { patterns: [/bank ?nifty|nifty ?bank/], answer: (context) => {
    const index = context.indices.get("NIFTY BANK");
    return `NIFTY BANK tracks the biggest banking stocks on the NSE.${index ? ` Right now: ${quoteLine(index)}` : ""}`;
  } },
  { patterns: [/top gainer|best perform|biggest gain|stocks? (going )?up/], answer: ({ data }) => {
    const top = [...data.market.quotes].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
    return `Today's top gainers in the NIFTY 500: ${top.map((q) => `${q.symbol} ${percent(q.changePercent)}`).join(", ")}. Big moves can reverse quickly, so don't chase them blindly.`;
  } },
  { patterns: [/top loser|worst perform|biggest (loss|fall)|stocks? (going )?down/], answer: ({ data }) => {
    const bottom = [...data.market.quotes].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
    return `Today's top losers in the NIFTY 500: ${bottom.map((q) => `${q.symbol} ${percent(q.changePercent)}`).join(", ")}.`;
  } },
  { patterns: [/my (portfolio|account|balance|money|cash|funds)|how (am i|i am) doing|how much (money|cash)|my (profit|loss|p&l|pnl)/],
    answer: ({ data }) => {
      const p = data.portfolio;
      return `Your account value is ${money(p.totalValue)} (${signed(p.totalValue - data.rules.initialCash)} since you started). Available to trade: ${money(p.availableCash)}. Holdings: ${data.holdings.length}, unrealised P&L ${signed(p.unrealizedPnl)}, realised P&L ${signed(p.realizedPnl)}.`;
    } },
  { patterns: [/my uid|what is (my )?uid|\buid\b/], answer: ({ data }) => `Your XOCRISK UID is ${data.user.uid}. It's unique to you: no one else can ever have the same one. In Community chat, people see only your name and UID.` },

  // ---- how-to
  { patterns: [/how (do i|to|can i) buy|buy (a )?(stock|share)|place (an? )?(buy )?order/],
    answer: "To buy: open Trade (or tap Buy on any stock), choose Delivery or Intraday, pick Market or Limit, enter the quantity and press Buy. Market orders fill instantly while NSE is open; limit orders wait for your price." },
  { patterns: [/how (do i|to|can i) sell|sell (my )?(stock|share)|exit (a )?position/],
    answer: "To sell: go to Portfolio → Holdings and press S next to the stock (or Sell on its Trade page). You can only sell shares you hold. Choose the quantity and order type, then confirm." },
  { patterns: [/cancel (an? |my )?order/], answer: "Open Transactions → Open, then press Cancel next to the order. Only orders that haven't filled yet can be cancelled." },
  { patterns: [/reject/], answer: "Orders are usually rejected because: it was a market order outside 9:15 AM – 3:30 PM IST, you didn't have enough cash, you tried to sell more shares than you hold, or the limit price was more than 20% away from the last price. Transactions shows the exact reason." },
  { patterns: [/reset/], answer: "Go to Wallet or Settings and press Reset portfolio. It returns your balance to ₹1,00,000 and clears holdings, orders and history. You can't reset while a championship you've joined is running." },

  // ---- concepts
  { patterns: [/market (order )?(vs|or|and|versus) limit|limit (order )?(vs|or|and|versus) market|what is (a )?limit order|what is (a )?market order|limit order/],
    answer: "A market order buys or sells straight away at the current price. A limit order sets the worst price you'll accept and waits until the market reaches it. Use limit orders when the price matters more than speed." },
  { patterns: [/intraday|delivery|\bcnc\b|\bmis\b/],
    answer: "Delivery (CNC) means you keep the shares as long as you like. Intraday (MIS) means you plan to buy and sell on the same day. Intraday is riskier because you have very little time for a trade to work." },
  { patterns: [/what (is|are) (a )?(stock|share|equity)/],
    answer: "A share (or stock) is a small piece of ownership in a company. If the company grows and earns more, its share price usually rises over time, and you may also receive dividends." },
  { patterns: [/holding(s)? (vs|or|and) position|position(s)? (vs|or|and) holding|what (is|are) (a )?(holding|position)/],
    answer: "Holdings are all the shares you own. Positions are today's trades, netted per stock, with their running profit or loss." },
  { patterns: [/p ?& ?l|pnl|profit and loss|unreali[sz]ed|reali[sz]ed/],
    answer: "P&L means profit and loss. Unrealised P&L is on shares you still hold (it changes with the price). Realised P&L is locked in when you sell." },
  { patterns: [/stop ?loss/], answer: "A stop-loss is a price at which you decide in advance to exit a losing trade, to keep a small loss from becoming a big one. Decide it before you buy and stick to it." },
  { patterns: [/diversif/], answer: "Diversification means spreading your money across several stocks and sectors, so one bad stock can't sink your whole portfolio. A common starting point is 5–10 stocks from different industries." },
  { patterns: [/\bipo\b/], answer: "An IPO (Initial Public Offering) is when a company sells its shares to the public for the first time and gets listed on the stock exchange." },
  { patterns: [/dividend/], answer: "A dividend is a share of profits a company pays to its shareholders, usually in cash per share. Not every company pays dividends." },
  { patterns: [/mutual fund|\bsip\b/], answer: "A mutual fund pools money from many investors and a professional manager invests it. An SIP (Systematic Investment Plan) invests a fixed amount every month, which averages out your buying price over time." },
  { patterns: [/bull(ish)?|bear(ish)?/], answer: "A bull market is when prices are rising and people are optimistic. A bear market is when prices fall 20% or more from a recent high and people are pessimistic." },
  { patterns: [/volume/], answer: "Volume is the number of shares traded in a period. High volume means lots of buyers and sellers are active, which makes it easier to trade at a fair price." },
  { patterns: [/52 ?(week|w)/], answer: "The 52-week high and low are the highest and lowest prices of the last year. You'll find them on each stock's Trade page under Performance." },
  { patterns: [/demat/], answer: "A demat account holds your shares electronically. To trade real shares in India you need a demat and trading account with a SEBI-registered broker. On XOCRISK you don't need one, because it's all practice." },
  { patterns: [/brokerage|charges|\bstt\b|\bgst\b|fees?/], answer: "Real brokers charge brokerage plus taxes like STT, GST and stamp duty. Practice trades on XOCRISK have zero charges so you can focus on learning." },
  { patterns: [/f ?& ?o|futures|options|derivative/], answer: "Futures and options (F&O) are derivative contracts and are much riskier than buying shares. XOCRISK currently supports equity (shares) only." },
  { patterns: [/circuit/], answer: "A circuit limit is the maximum a stock (or the whole market) is allowed to move in a day. When it's hit, trading in that stock pauses or only happens at that price." },

  // ---- app features
  { patterns: [/championship|competition|contest|\blpu\b|lovely professional/],
    answer: "The LPU Trading Championship is conducted by Lovely Professional University. Open Championship in the sidebar and press Join. Your return is measured from your account value when you join, and the highest return when it ends wins." },
  { patterns: [/community|chat|talk to (other|people)|connect/],
    answer: "Community is a chat room for all XOCRISK traders. Only your name and UID are shown. Be respectful and don't share personal details." },
  { patterns: [/note/], answer: "Notes is your private notebook. Write down why you bought a stock and when you'd exit. Notes save automatically and only you can see them." },
  { patterns: [/what is xocrisk|about (the )?app|what can (i|you) do/],
    answer: "XOCRISK is a paper-trading app: you trade real NSE stocks at delayed prices with ₹1,00,000 of practice money. Learn, join the LPU championship, chat with the community and keep notes, with no real money at risk." },
  { patterns: [/real money|is (this|it) real|withdraw|deposit/], answer: "No real money is involved. Your ₹1,00,000 is practice money and can't be deposited or withdrawn." },
  { patterns: [/delay|live price|real ?time/], answer: "Prices are delayed NSE quotes, refreshed about every 10 minutes during market hours and once after the close." },

  // ---- advice requests (kept generic on purpose)
  { patterns: [/which stock|what (stock|share) (should|to) (i )?buy|recommend|\btips?\b|best stock|suggest/],
    answer: "I can't give investment advice or stock tips. A good habit: pick a company you understand, read why its price is moving, decide your entry, target and stop-loss, then practise with a small quantity here." },
];

const fallback = "I don't know that one yet. Try asking: \"is the market open?\", \"price of reliance\", \"market vs limit order\", \"how do I sell?\" or \"what is the championship?\"";

/** Finds a stock or index the user mentioned, e.g. "price of reliance" or "TCS?". */
function findQuote(text: string, context: AiContext): Quote | undefined {
  const words = text.toUpperCase().replace(/[^A-Z0-9&\- ]/g, " ").split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (word.length >= 2 && context.quotes.has(word)) return context.quotes.get(word);
  }
  const lower = text.toLowerCase();
  for (const index of context.indices.values()) if (lower.includes(index.symbol.toLowerCase())) return index;
  const named = [...context.quotes.values()].find((quote) => {
    const first = quote.name.toLowerCase().split(" ")[0];
    return first.length > 3 && new RegExp(`\\b${first.replace(/[^a-z0-9]/g, "")}\\b`).test(lower);
  });
  return named;
}

export function answer(input: string, context: AiContext): string {
  const text = input.trim().toLowerCase();
  if (!text) return fallback;
  // A direct price question wins over topic answers ("price of nifty" should quote it, not explain it).
  if (/\b(price|rate|quote|kitna|trading at)\b/.test(text)) {
    const quote = findQuote(input, context);
    if (quote) return quoteLine(quote);
  }
  for (const intent of intents) {
    if (intent.patterns.some((pattern) => pattern.test(text))) {
      return typeof intent.answer === "function" ? intent.answer(context, text) : intent.answer;
    }
  }
  const quote = findQuote(input, context);
  if (quote) return quoteLine(quote);
  return fallback;
}

export const suggestions = ["Hi", "Is the market open?", "Price of Reliance", "Market vs limit order", "How am I doing?", "What is the championship?", "Top gainers today", "What is a stop-loss?"];
