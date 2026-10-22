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

// ---- answers built from the user's own account
const activeHoldings = ({ data }: AiContext) => data.holdings.filter((holding) => holding.quantity > 0);
const filledOrders = ({ data }: AiContext) => data.orders.filter((order) => order.status === "filled");
const totalReturn = ({ data }: AiContext) => ((data.portfolio.totalValue - data.rules.initialCash) / data.rules.initialCash) * 100;

const bestAndWorst = (context: AiContext) => {
  const results = context.data.holdings
    .map((holding) => ({ symbol: holding.symbol, pnl: holding.realizedPnl + holding.unrealizedPnl }))
    .filter((result) => Math.abs(result.pnl) >= 0.01)
    .sort((a, b) => b.pnl - a.pnl);
  if (!results.length) return "You don't have any trades with a profit or loss yet. Buy a stock in Trade and I'll track your best and worst ones.";
  const best = results[0];
  const worst = results[results.length - 1];
  if (results.length === 1) return `So far you've traded only ${best.symbol}, at ${signed(best.pnl)} (realised + unrealised).`;
  return `Your best stock so far is ${best.symbol} at ${signed(best.pnl)}, and your worst is ${worst.symbol} at ${signed(worst.pnl)} (realised + unrealised P&L per stock). Look at what you did differently in those two: entry timing, position size, and when you exited.`;
};

const winRate = (context: AiContext) => {
  const closed = context.data.holdings.filter((holding) => Math.abs(holding.realizedPnl) >= 0.01);
  const overall = `Your overall return since you started is ${percent(totalReturn(context))}.`;
  if (!closed.length) {
    const open = activeHoldings(context);
    const winning = open.filter((holding) => holding.unrealizedPnl > 0).length;
    return `You haven't closed (sold) any trades yet, so there's no win rate. Of your ${open.length} open position${open.length === 1 ? "" : "s"}, ${winning} ${winning === 1 ? "is" : "are"} in profit right now. ${overall}`;
  }
  const wins = closed.filter((holding) => holding.realizedPnl > 0).length;
  const average = closed.reduce((total, holding) => total + holding.realizedPnl, 0) / closed.length;
  return `Win rate: ${Math.round((wins / closed.length) * 100)}% (${wins} of ${closed.length} stocks you sold ended in profit). Average realised P&L per stock: ${signed(average)}. ${overall} A 40–50% win rate is fine if your winners are bigger than your losers.`;
};

const diversification = (context: AiContext) => {
  const open = activeHoldings(context);
  const intro = "Diversification means spreading money across several stocks and sectors, so one bad stock can't sink your portfolio. A common starting point is 5–10 stocks from different industries, with no single stock above about 20–25%.";
  if (!open.length) return `${intro} You don't hold any stocks right now.`;
  const invested = open.reduce((total, holding) => total + holding.currentValue, 0);
  const sectors = new Set(open.map((holding) => context.quotes.get(holding.symbol)?.industry ?? "Other"));
  const largest = [...open].sort((a, b) => b.currentValue - a.currentValue)[0];
  const weight = invested > 0 ? (largest.currentValue / invested) * 100 : 0;
  const fixes = [
    open.length < 5 && "hold at least 5 stocks",
    sectors.size < 3 && "spread across 3 or more sectors",
    weight > 30 && `bring ${largest.symbol} below about 25%`,
  ].filter(Boolean);
  const verdict = fixes.length ? `That's concentrated. To diversify: ${fixes.join(", ")}.` : "That's reasonably diversified.";
  return `You hold ${open.length} stock${open.length === 1 ? "" : "s"} across ${sectors.size} sector${sectors.size === 1 ? "" : "s"}; your biggest is ${largest.symbol} at ${Math.round(weight)}% of what you've invested. ${verdict}`;
};

const mistakes = (context: AiContext): string[] => {
  const { data } = context;
  const found: string[] = [];
  const rejected = data.orders.filter((order) => order.status === "rejected");
  if (rejected.length) found.push(`${rejected.length} order${rejected.length === 1 ? " was" : "s were"} rejected${rejected[0].rejectionReason ? ` (latest reason: ${rejected[0].rejectionReason})` : ""}. Check market hours, cash and the 20% limit band before ordering.`);
  const open = activeHoldings(context);
  const invested = open.reduce((total, holding) => total + holding.currentValue, 0);
  for (const holding of open) {
    const loss = holding.averageCost > 0 ? ((holding.lastPrice - holding.averageCost) / holding.averageCost) * 100 : 0;
    if (loss <= -8) found.push(`${holding.symbol} is down ${Math.abs(loss).toFixed(1)}% from your buy price. Did you have a stop-loss? Holding a loser and hoping is the most common beginner mistake.`);
  }
  const largest = [...open].sort((a, b) => b.currentValue - a.currentValue)[0];
  if (largest && invested > 0 && open.length > 1 && largest.currentValue / invested > 0.4) found.push(`${largest.symbol} is ${Math.round((largest.currentValue / invested) * 100)}% of your holdings: too much in one stock.`);
  if (open.length === 1 && invested > data.portfolio.totalValue * 0.5) found.push(`More than half your account is in a single stock (${open[0].symbol}).`);
  const today = new Date().toDateString();
  const tradesToday = filledOrders(context).filter((order) => new Date(order.filledAt ?? order.createdAt).toDateString() === today).length;
  if (tradesToday >= 10) found.push(`${tradesToday} trades today looks like overtrading. Fewer, well-planned trades usually do better.`);
  const intraday = filledOrders(context).filter((order) => order.product === "intraday").length;
  if (intraday >= 5 && intraday > filledOrders(context).length * 0.7) found.push("Most of your trades are intraday. Intraday is the hardest style for beginners; try some delivery trades too.");
  return found;
};

const tradeReview = (context: AiContext) => {
  if (!filledOrders(context).length) return "You haven't completed any trades yet, so there's nothing to review. Place a few practice trades with a written plan (entry, target, stop-loss) in Notes, then ask me again.";
  const found = mistakes(context);
  if (!found.length) return "I don't see any obvious mistakes: no rejected orders, no big losers left running, and no single stock dominating. Keep writing down why you enter and exit each trade in Notes.";
  return `Here's what I noticed:\n• ${found.join("\n• ")}`;
};

const strategyReview = (context: AiContext) => {
  const filled = filledOrders(context);
  if (!filled.length) return "You haven't completed any trades yet. Write your strategy in Notes (what you buy, why, your target and stop-loss), trade it here for a few weeks, then ask me to review it.";
  const buys = filled.filter((order) => order.side === "buy").length;
  const intraday = filled.filter((order) => order.product === "intraday").length;
  const limit = filled.filter((order) => order.orderType === "limit").length;
  const stats = `You've completed ${filled.length} trade${filled.length === 1 ? "" : "s"} (${buys} buy${buys === 1 ? "" : "s"}, ${filled.length - buys} sell${filled.length - buys === 1 ? "" : "s"}), ${Math.round((intraday / filled.length) * 100)}% intraday, ${Math.round((limit / filled.length) * 100)}% limit orders. You hold ${activeHoldings(context).length} stock${activeHoldings(context).length === 1 ? "" : "s"} and your return so far is ${percent(totalReturn(context))}.`;
  const found = mistakes(context);
  return `${stats}${found.length ? `\nThings to work on:\n• ${found.join("\n• ")}` : "\nNo red flags in your trades. Judge a strategy over 20+ trades, not just a few."}\nThis is educational feedback on virtual trades, not investment advice.`;
};

const tradeHistory = (context: AiContext) => {
  const recent = context.data.orders.slice(0, 5);
  if (!recent.length) return "You don't have any orders yet. Your full history will appear in Transactions once you trade.";
  const lines = recent.map((order) => {
    const at = order.fillPrice ?? order.limitPrice;
    return `${order.side === "buy" ? "Buy" : "Sell"} ${order.quantity} ${order.symbol}${at ? ` @ ₹${price(Number(at))}` : ""}: ${order.status} (${istDateTime.format(new Date(order.filledAt ?? order.createdAt))})`;
  });
  return `Your last ${recent.length} order${recent.length === 1 ? "" : "s"}:\n• ${lines.join("\n• ")}\nOpen Transactions in the sidebar for the full list with filters.`;
};

const paperTradingIntents: Intent[] = [
  // ---- guardrails: no predictions, no tips, no balance changes, no off-topic
  { patterns: [/\bsure[ -]?shot\b|pakka (tip|stock|profit)|guaranteed? (tip|profit|return)|jackpot|multibagger/],
    answer: "There's no such thing as a sure-shot tip. Anyone who promises guaranteed returns is either guessing or trying to sell you something. I won't give tips. Instead: pick a company you understand, set an entry, target and stop-loss, and test the idea here with virtual money first." },
  { patterns: [/\bkal\b.*(stock|share|upar|niche|badh|gir|jayega|jaega)|tomorrow.*(stock|share|go up|rise|fall)|(which|kaun ?sa|konsa|kaunsa) (stock|share).*(upar|badhega|jayega|go up|rise)|predict|forecast|next (week|month)? ?(price|move)/],
    answer: "No one can reliably predict which stock will go up tomorrow, and I won't guess. Prices react to news, results and global markets that nobody knows in advance. What you can control: your research, position size and stop-loss. Practise those here; it's virtual money, so mistakes are free." },
  { patterns: [/(balance|paisa|paise|money|cash|fund|amount).*(badha|bada|increase|add|de do|dedo|dalo|daal|zyada|double|top ?up)|(badha|increase|add|top ?up|double).*(balance|cash|money|paisa|fund)|free (money|paisa|cash)/],
    answer: "I can't change your balance. Every XOCRISK trader gets the same ₹1,00,000 of virtual money so the leaderboard and championship stay fair. If you've run low, you can sell holdings, or use Reset portfolio (Wallet or Settings) to start again from ₹1,00,000." },
  { patterns: [/(crore|lakh|profit|munafa).*(real|asli).*(lagau|lagaun|lagana|invest|paisa|money|hoga|karu|karun)|(real|asli).*(me|mein|trading).*(bhi )?(hoga|milega|profit)/],
    answer: "Careful: paper-trading profit does not mean you'll make the same in real trading. Here there's no real fear or greed, orders fill at delayed prices with no slippage, and there are no charges or taxes. Many people who do well on paper lose money at first with real cash. If you go real, start very small (money you can afford to lose), keep the same rules, and scale up only after months of consistent results. This is educational guidance, not investment advice." },
  { patterns: [/weather|mausam|barish|cricket|\bipl\b|movie|film|song|gaana|gana|joke|recipe|khana|politic|election|girlfriend|boyfriend|homework/],
    answer: "I'm XOCRISK AI, so I only help with stock-market learning and this app. Ask me about paper trading, orders, your P&L, risk management or market hours!" },

  // ---- paper trading basics
  { patterns: [/(paper|virtual|demo).*(real|asli) (paisa|paise|money|rupee)|(real|asli) (paisa|paise|money).*(lagta|lagega|lagana|need|required|use)/],
    answer: "No. Paper trading uses only virtual money. On XOCRISK you get ₹1,00,000 of practice money; nothing is deposited, withdrawn or charged, and you can't lose real money here." },
  { patterns: [/(paper|virtual|demo).*(kyun|kyu|kyon|why|fayda|benefit|use)|why.*(paper|virtual|demo) trad/],
    answer: "Why paper trade:\n• Learn how orders, P&L and the market work without risking money\n• Test a strategy over many trades before using real cash\n• Make beginner mistakes (overtrading, no stop-loss) for free\n• Build discipline and a trading journal\nIt's practice, so treat the virtual ₹1,00,000 as if it were real; that's where the learning comes from." },
  { patterns: [/(paper|virtual|demo).*(kitne|kitna|how long|kab tak|duration)|(kitne|how long).*(paper|virtual|demo)/],
    answer: "Most beginners should paper trade for at least 2–3 months, or about 30–50 trades, with a written plan for each. Move on only when you're following your rules consistently and understand why you won or lost each trade, not just when you're in profit." },
  { patterns: [/psycholog|emotion|\bdar\b|fear|greed|lalach|discipline|fomo|patience/],
    answer: "Psychology is the biggest difference between paper and real trading. With real money, fear makes people sell winners too early, hope makes them hold losers too long, and FOMO makes them chase stocks after a big jump. Build habits here: follow written rules, accept small losses, and don't revenge-trade after a loss. Then start real trading very small so the emotions are manageable." },
  { patterns: [/(paper|virtual|demo).*(aur|vs|and|or|versus|ya).*(real|live|asli)|(real|live|asli).*(aur|vs|and|or|versus|ya).*(paper|virtual|demo)|difference between (paper|real)/],
    answer: "Paper vs real trading:\n• Money: virtual here, real with a broker\n• Prices: XOCRISK uses delayed NSE prices; real trading is live\n• Execution: no slippage here; in real markets you may get a slightly worse price\n• Costs: zero charges here; real trades pay brokerage, STT, GST and stamp duty\n• Emotions: losing virtual money feels very different from losing your own\nThe skills (analysis, orders, risk rules) carry over; the psychology is the hard part." },
  { patterns: [/brokerage|charges|\bstt\b|\bgst\b|\bfees?\b|\btax|stamp duty/], answer: "No: paper trades on XOCRISK have zero brokerage, STT, GST, stamp duty and taxes, so you can focus on learning. Real trading does have them: brokerage (often ₹0 for delivery and up to ₹20 per order for intraday), STT, exchange charges, GST, SEBI fees, stamp duty, plus capital-gains tax on profits. They can eat a big share of small intraday profits, so remember them before switching to real money." },
  { patterns: [/paper trad|virtual trad|demo trad|mock trad|what is (this )?paper|paper trading (kya|hota)/],
    answer: "Paper trading means practising buying and selling real stocks with virtual money. On XOCRISK you trade NSE stocks at delayed market prices with ₹1,00,000 of practice money, so you learn how the market works with zero real risk." },

  // ---- account & virtual balance
  { patterns: [/(kitna|kitne|how much).*(virtual|starting|initial|shuru).*(balance|paisa|money|cash)|(balance|paisa|money).*(kitna|kitne) (milega|milta|milenge)|how much (virtual|starting|initial) (balance|money|cash)/],
    answer: ({ data }) => `Every account starts with ${money(data.rules.initialCash)} of virtual money. Right now you have ${money(data.portfolio.availableCash)} available to trade and a total account value of ${money(data.portfolio.totalValue)}.` },
  { patterns: [/(balance|paisa|paise|cash|money|fund).*(khatam|finish|over|zero|exhaust|run out|ran out|nahi bacha|kam ho)|out of (money|cash|funds)/],
    answer: "If your virtual cash runs out: sell some holdings to free up cash, cancel open buy limit orders (they reserve cash), or use Reset portfolio in Wallet or Settings to start again from ₹1,00,000. Reset clears your holdings and history, and it's blocked while a championship you joined is running." },
  { patterns: [/\b(choose|select|change|set|apna|khud)\b.*(starting|initial|shuruati)? ?(balance|capital)|starting (balance|capital)/],
    answer: "No, the starting balance is fixed at ₹1,00,000 for everyone. That keeps the leaderboard and the LPU championship fair, since everyone's return is compared from the same start." },
  { patterns: [/demat/],
    answer: "To open a real demat + trading account: choose a SEBI-registered broker, then complete online e-KYC with your PAN, Aadhaar (linked to your mobile), a bank account and a selfie/signature; it usually takes 1–2 days. You must be 18 or older. XOCRISK itself doesn't need a demat account, because it's all practice." },
  { patterns: [/\bkyc\b|account (kaise|kese|kaisay)? ?(bana|banau|banaun|create|open|khol)|(create|open|make) (an |my )?account|sign ?up|register/],
    answer: "Making an XOCRISK account is quick: tap Sign up and enter your name, email, mobile number and college, then set a password. No KYC, PAN, Aadhaar or bank account is needed, because it's virtual money only. (Real trading with a broker does need KYC.)" },

  // ---- orders
  { patterns: [/(portfolio|holding|holdings).*(nahi|nhi|not|missing).*(dikh|show|aaya|aa raha|visible)|(trade|order).*(nahi|not|nhi) (dikh|show)|not (showing|visible)/],
    answer: "If a trade isn't in your portfolio:\n• Check Transactions: a limit order may still be Open (not filled yet), or the order may have been rejected\n• Filled buys appear under Portfolio → Holdings; refresh the page if it was just placed\n• A full sell removes the stock from holdings; it shows in realised P&L instead\nStill missing? Contact Support with the time of the order." },
  { patterns: [/(cancel|modify|edit|change|badal).*order|order.*(cancel|modify|edit|change|badal)/],
    answer: "Cancel: open Transactions → Open and press Cancel next to the order. Only orders that haven't filled can be cancelled. Modify: XOCRISK doesn't edit orders yet; cancel the open order and place a new one with the price or quantity you want." },
  { patterns: [/(execution|fill|execute|order).*price.*(kaise|how|decide|tay)|price.*(decide|determine)|kis (price|rate) (pe|par)/],
    answer: "Execution price on XOCRISK: a market order fills at the latest refreshed price for that stock. A limit order fills at the current price once it reaches your limit or better (at or below for a buy, at or above for a sell). There's no slippage and no charges." },
  { patterns: [/(market|bazaar|bazar).*(band|closed|close|off).*(order|lagau|lagaun|trade|buy|sell|kya hoga)|(order|trade|buy|sell).*(market|bazaar|bazar).*(band|closed)|after (market )?hours|weekend.*(order|trade)/],
    answer: (context) => `If the market is closed: market orders are rejected, because there's no live price to fill them at. Limit orders are accepted and stay Open; they're checked when the market reopens and fill once the price reaches your limit. ${marketLine(context)}` },
  { patterns: [/(market|limit|stop).*order.*(kaise|kese|how|kaam|work|kya|difference|farak|fark)|order types?|types of orders?|stop ?-?loss order/],
    answer: "Order types:\n• Market order: fills straight away at the current price (only while NSE is open, 9:15 AM – 3:30 PM IST)\n• Limit order: you set a price; a buy fills at or below it, a sell at or above it. It waits as Open until then\n• Stop-loss order: an automatic exit when the price falls to a level you set. XOCRISK doesn't have a stop-loss order type yet, so decide your stop-loss price, write it in Notes and sell manually if it's hit." },
  { patterns: [/(execute|executed|fill|filled|complete|pura).*(nahi|nhi|not|na hua|kyun)|(not|nahi|nhi|kyun nahi) (execute|fill|hua)|order (pending|open|stuck|atak|atka)|why.*(not|isn'?t|wasn'?t).*(fill|execut)/],
    answer: "Why an order may not have executed:\n• It's a limit order and the price hasn't reached your limit yet (it stays Open)\n• The market is closed; limit orders are only checked while NSE is open\n• It was rejected: market order outside market hours, not enough cash, selling more shares than you hold, or a limit price more than 20% from the last price\nTransactions shows each order's status and the exact rejection reason." },
  { patterns: [/square ?-?off/],
    answer: "In real trading, brokers auto square-off intraday (MIS) positions around 3:15–3:25 PM if you haven't closed them, often with a fee. XOCRISK doesn't auto square-off: intraday trades stay in your holdings until you sell. To practise real intraday discipline, close them yourself before 3:15 PM." },
  { patterns: [/(buy|sell|order).*(kaise|kese|kaisay|kaise lagau)|order (lagau|lagaun|lagana|place karu)|(buy|sell) order/],
    answer: "To place an order: open Trade (or press Buy/Sell on any stock), choose Delivery or Intraday, pick Market or Limit (enter a price for limit), set the quantity and confirm. You can only sell shares you hold. Market orders fill instantly while NSE is open; limit orders wait for your price." },

  // ---- prices & data
  { patterns: [/(data|price|prices|rate).*(kahan|kaha|where|source|kidhar).*(aata|aate|aati|come|from|se)?|(kahan|kaha|where) (se|from).*(data|price)|source of (data|prices?)/],
    answer: "Prices are NSE stock quotes from public delayed market data (Yahoo Finance), refreshed about every 10 minutes during market hours. They're delayed, not tick-by-tick live, which is fine for learning but not for real trading decisions." },
  { patterns: [/slippage/],
    answer: "Slippage is the gap between the price you expected and the price you actually got, common in fast markets and illiquid stocks. XOCRISK has zero slippage, so expect slightly worse fills in real trading, especially with market orders." },
  { patterns: [/segment|crypto|bitcoin|commodit|forex|currency|(kaun|kaunse|konse|kon se|which).*(stock|share|segment).*(available|milte|hai|trade)|available (stocks|segments)/],
    answer: "XOCRISK covers NSE equity (cash segment): all NIFTY 500 stocks plus the main indices for reference. F&O (futures & options), crypto, commodities and currency aren't available. Search any NIFTY 500 stock in Trade." },

  // ---- portfolio & P&L
  { patterns: [/(aaj|today|todays|today's).*(profit|loss|p ?& ?l|pnl|kamaya|gain|change)|day'?s (p ?& ?l|pnl|change)/],
    answer: ({ data }) => `Today your account is ${signed(data.portfolio.dayChange)} (${percent(data.portfolio.dayChangePercent)}). Total value: ${money(data.portfolio.totalValue)}. Prices refresh about every 10 minutes during market hours.` },
  { patterns: [/(p ?& ?l|pnl|profit|loss).*(calculat|kaise|kese|how|nikala|formula)/],
    answer: ({ data }) => `P&L calculation:\n• Unrealised P&L = (current price − your average buy price) × shares you still hold\n• Realised P&L = (sell price − average buy price) × shares sold\n• Total return = (account value − ₹1,00,000) ÷ ₹1,00,000\nYours now: unrealised ${signed(data.portfolio.unrealizedPnl)}, realised ${signed(data.portfolio.realizedPnl)}, total ${signed(data.portfolio.totalValue - data.rules.initialCash)}. No charges are deducted on XOCRISK.` },
  { patterns: [/(my|meri|mera|mere).*(best|worst|sabse (acchi|achi|buri|kharab|bekar))|(best|worst) trades?|sabse (acchi|achi|buri|kharab) trade/], answer: bestAndWorst },
  { patterns: [/win ?rate|success rate|hit rate|average return|avg return|kitne trades? (profit|jeet)/], answer: winRate },
  { patterns: [/galti|galtiyan|galtiya|mistake|kya galat|went wrong|go wrong|review (my )?trades|trades? review/], answer: tradeReview },
  { patterns: [/history|past (trades|orders)|(show|dikhao|dikha).*(trades|orders)|(trades|orders) (dikhao|dikha|list)/], answer: tradeHistory },

  // ---- charges & realism
  { patterns: [/margin|leverage/],
    answer: "XOCRISK has no margin or leverage: every buy, delivery or intraday, needs the full amount in cash. Real brokers give limited intraday leverage (around 5× under SEBI rules), which multiplies both profits and losses. Beginners should avoid leverage until they're consistently profitable." },
  { patterns: [/short ?-?sell|shorting|\bshort\b|bina (shares|stock|share) ke (sell|bech)/],
    answer: "Short selling (selling shares you don't own, hoping to buy back cheaper) isn't supported on XOCRISK; you can only sell shares you hold. In real Indian markets, intraday shorting is allowed, and it's risky because losses can exceed what you put in." },

  // ---- watchlist & alerts
  { patterns: [/watch ?list/],
    answer: "Watchlist: open Trade or Watchlist, search for a stock and tap its star (☆) to add it. Starred stocks appear in your list with live-updating prices. Tap the star again to remove it; Settings has an option to clear them all." },
  { patterns: [/alert|notify|notification|reminder/],
    answer: "Price alerts aren't available on XOCRISK yet. Workarounds: place a limit order at your target price (it fills automatically when reached), or star the stock in your Watchlist and note your target in Notes." },

  // ---- learning & guidance
  { patterns: [/position ?siz|kitne (shares|share|qty|quantity) (lu|lun|loon|kharidu|kharidun|lena)|how many shares (should|to)/],
    answer: ({ data }) => {
      const risk = data.portfolio.totalValue * 0.01;
      return `Position sizing: decide how much you're willing to lose on one trade (1–2% of your account), then:\nShares = amount you'll risk ÷ (entry price − stop-loss price)\nYour account is ${money(data.portfolio.totalValue)}, so 1% risk is ${money(risk)}. Example: entry ₹500, stop-loss ₹480 → ₹20 risk per share → about ${Math.floor(risk / 20)} shares. Also keep any one stock under about 20–25% of your account.`;
    } },
  { patterns: [/risk management|risk (kaise|kese|manage|control|kam)|manage (my )?risk|risk kya/],
    answer: "Risk management basics:\n• Risk only 1–2% of your account on any one trade\n• Decide your stop-loss before you buy, and respect it\n• Size positions from the stop-loss (ask me \"position sizing\")\n• Diversify: 5–10 stocks across sectors\n• Aim for trades where the target is at least 2× the risk\n• Never average down blindly on a loser\nPractise these on XOCRISK where mistakes cost only virtual money." },
  { patterns: [/\brsi\b|macd|moving average|\b[sde]ma\b|\bdma\b|indicator/],
    answer: "Common indicators:\n• RSI (0–100) measures momentum: above 70 is often called overbought, below 30 oversold. It can stay extreme in strong trends\n• MACD compares a 12- and 26-day moving average; the MACD line crossing above its signal line suggests rising momentum, below suggests falling\n• Moving averages (e.g. 50-day, 200-day) smooth out price; price above a rising MA suggests an uptrend\nNo indicator works alone or every time: combine them with price action, and always use a stop-loss. XOCRISK's chart shows price history you can use to spot trends." },
  { patterns: [/(review|check|dekho).*(strategy|strategies)|(my|meri|mera) (trading )?strateg/], answer: strategyReview },
  { patterns: [/strateg/],
    answer: "Beginner-friendly approaches (for learning, not guaranteed to profit):\n• Buy and hold quality large-caps (NIFTY 50) for months, not days\n• Trend following: buy stocks above a rising 50-day moving average, exit below it\n• Simple SIP-style investing: buy a fixed amount regularly\nWhichever you pick: write the rules in Notes, use a stop-loss, risk 1–2% per trade, and test it over 20+ trades here before using real money. Avoid intraday and F&O until you're consistent." },
  { patterns: [/beginner|naya hu|new to (trading|stock|market)|kaha se shuru|where (do i|to) start|seekhna|learn trading/],
    answer: "Starting out:\n1. Learn the basics: shares, market vs limit orders, P&L (ask me about any)\n2. Buy 2–3 large NIFTY 50 companies you understand, in small quantities\n3. Write why you bought and your exit plan in Notes\n4. Review weekly: ask me \"meri galtiyan\" or \"review my strategy\"\n5. Join the LPU championship once you're comfortable\nIt's all virtual money, so experiment freely." },

  // ---- gamification & community
  { patterns: [/\brank\b|leaderboard/],
    answer: ({ data }) => {
      const self = data.leaderboard.find((entry) => entry.isSelf);
      const mine = self ? `You're #${self.rank} with ${percent(self.returnPercent)}.` : data.user.leaderboardOptIn ? "You're not in the top 20 yet." : "You're not on the leaderboard: turn it on in Insights or Settings.";
      return `Ranks are decided by return %: (account value − ₹1,00,000) ÷ ₹1,00,000, using current prices. The college leaderboard shows traders from your college who opted in. The LPU championship ranks by return from the moment you joined it. ${mine}`;
    } },
  { patterns: [/badge|reward|prize|inaam|certificate|trophy/],
    answer: "XOCRISK doesn't have badges yet. The main competition is the LPU Trading Championship in the sidebar; prizes and certificates for it are announced by LPU. Your best reward is a consistent trading record you can learn from." },
  { patterns: [/friend|dost|compete|competition with|saath/],
    answer: "To compete with friends: everyone joins the LPU championship (Championship in the sidebar) and you compare ranks there, or turn on the college leaderboard in Insights. Share your UID in Community so friends can find you; only name and UID are visible." },

  // ---- moving to real trading
  { patterns: [/(kab|when).*(real|live|asli).*(trad|start|shuru|invest)|(real|live|asli) (trading|investing).*(kab|when|start|shuru)|ready for real/],
    answer: "Consider real trading only when: you've paper traded for 2–3+ months, followed your rules on 30–50 trades, understand why you won or lost each one, and can handle a losing streak calmly. Even then, start with a small amount you can afford to lose. Paper results don't guarantee real results." },

  // ---- technical issues & support
  { patterns: [/password|forgot|bhool/],
    answer: "To reset your password: log out, then on the login page press \"Forgot password?\", enter your account email and we'll send a 6-digit code (valid for 10 minutes). Enter the code and your new password. Already logged in and want to change it? Use the same flow." },
  { patterns: [/(balance|paisa|cash|value|amount).*(galat|wrong|incorrect|sahi nahi|mismatch|kam dikh)|(galat|wrong).*(balance|cash)/],
    answer: ({ data }) => {
      const reserved = data.portfolio.cash - data.portfolio.availableCash;
      return `Your cash is ${money(data.portfolio.cash)}${reserved > 0.005 ? `, of which ${money(reserved)} is reserved for open buy limit orders, leaving ${money(data.portfolio.availableCash)} available` : ""}. Account value ${money(data.portfolio.totalValue)} = cash + holdings at the latest delayed prices, so it moves as prices refresh (about every 10 minutes). If it still looks wrong, refresh the page or contact Support.`;
    } },
  { patterns: [/crash|hang|freeze|slow|not (working|loading|opening)|kaam nahi|load nahi|khul nahi|bug|glitch/],
    answer: "Sorry about that! Try: refresh the page, update your browser or the app, check your internet, then log out and back in. Clearing the site's cache often helps. If it keeps happening, tell us in Support what you were doing and which device you use." },
];

const intents: Intent[] = [
  ...paperTradingIntents,
  // ---- small talk
  { patterns: [/^(hi+|hello+|hey+|hlo|helo|hii|yo|namaste|namaskar|hola)\b/, /^good (morning|afternoon|evening)/],
    answer: (context) => `Hello ${firstName(context)}! How was your day? I'm XOCRISK AI. Ask me about trading, the market, or your account.` },
  { patterns: [/how (are|r) (you|u)/, /kaise ho/, /how('s| is) it going/, /what'?s up/, /wassup/],
    answer: "I'm doing great, thanks for asking! How about you? How's your trading going today?" },
  { patterns: [/^(it was |my day was |day was )?(good|great|fine|nice|awesome|amazing|accha|acha|badhiya|mast|ok|okay|theek)\b/],
    answer: "That's great to hear! A good day is the best time to learn something new. Want to know how limit orders work, or check a stock's price?" },
  { patterns: [/^(it was |my day was )?(bad|not good|sad|terrible|worst|boring|bura|kharab)\b/, /not (so )?(good|great)/],
    answer: "Sorry to hear that. Markets have bad days too, and they recover. Take a break, and when you're ready I can help you review your portfolio." },
  { patterns: [/thank|thanks|\bthx\b|\bty\b|dhanyavad|shukriya/], answer: "You're welcome! Happy trading." },
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
    answer: "Delivery (CNC) means you keep the shares as long as you like. Intraday (MIS) means you plan to buy and sell on the same day. Intraday is riskier because you have very little time for a trade to work. To choose, pick Delivery or Intraday in the order window before you press Buy or Sell. XOCRISK doesn't auto square-off intraday trades, so close them yourself before 3:15 PM to practise like a real intraday trader." },
  { patterns: [/what (is|are) (a )?(stock|share|equity)/],
    answer: "A share (or stock) is a small piece of ownership in a company. If the company grows and earns more, its share price usually rises over time, and you may also receive dividends." },
  { patterns: [/holding(s)? (vs|or|and) position|position(s)? (vs|or|and) holding|what (is|are) (a )?(holding|position)/],
    answer: "Holdings are all the shares you own. Positions are today's trades, netted per stock, with their running profit or loss." },
  { patterns: [/p ?& ?l|pnl|profit and loss|unreali[sz]ed|reali[sz]ed/],
    answer: "P&L means profit and loss. Unrealised P&L is on shares you still hold (it changes with the price). Realised P&L is locked in when you sell." },
  { patterns: [/stop ?loss/], answer: "A stop-loss is a price at which you decide in advance to exit a losing trade, to keep a small loss from becoming a big one. Decide it before you buy and stick to it." },
  { patterns: [/diversif/], answer: diversification },
  { patterns: [/\bipo\b/], answer: "An IPO (Initial Public Offering) is when a company sells its shares to the public for the first time and gets listed on the stock exchange." },
  { patterns: [/dividend/], answer: "A dividend is a share of profits a company pays to its shareholders, usually in cash per share. Not every company pays dividends." },
  { patterns: [/mutual fund|\bsip\b/], answer: "A mutual fund pools money from many investors and a professional manager invests it. An SIP (Systematic Investment Plan) invests a fixed amount every month, which averages out your buying price over time." },
  { patterns: [/bull(ish)?|bear(ish)?/], answer: "A bull market is when prices are rising and people are optimistic. A bear market is when prices fall 20% or more from a recent high and people are pessimistic." },
  { patterns: [/volume/], answer: "Volume is the number of shares traded in a period. High volume means lots of buyers and sellers are active, which makes it easier to trade at a fair price." },
  { patterns: [/52 ?(week|w)/], answer: "The 52-week high and low are the highest and lowest prices of the last year. You'll find them on each stock's Trade page under Performance." },
  { patterns: [/f ?& ?o|futures|options|derivative/], answer: "Futures and options (F&O) are derivative contracts and are much riskier than buying shares. XOCRISK currently supports equity (shares) only." },
  { patterns: [/circuit/], answer: "A circuit limit is the maximum a stock (or the whole market) is allowed to move in a day. When it's hit, trading in that stock pauses or only happens at that price." },

  // ---- app features
  { patterns: [/championship|competition|contest|\blpu\b|lovely professional/],
    answer: "The LPU Trading Championship is conducted by Lovely Professional University. Open Championship (Contest on the phone) and press \"Pay ₹99 & join\": the one-time entry fee is paid securely through Razorpay (UPI, cards, net banking). Trading itself uses practice money. Your return is measured from your account value when you join, and the highest return when it ends wins." },
  { patterns: [/community|chat|talk to (other|people)|connect/],
    answer: "Community is a chat room for all XOCRISK traders. Only your name and UID are shown. Be respectful and don't share personal details." },
  { patterns: [/note/], answer: "Notes is your private notebook. Write down why you bought a stock and when you'd exit. Notes save automatically and only you can see them." },
  { patterns: [/what is xocrisk|about (the )?app|what can (i|you) do/],
    answer: "XOCRISK is a paper-trading app: you trade real NSE stocks at delayed prices with ₹1,00,000 of practice money. Learn, join the LPU championship, chat with the community and keep notes, with no real money at risk." },
  { patterns: [/real money|is (this|it) real|withdraw|deposit/], answer: "No real money is involved. Your ₹1,00,000 is practice money and can't be deposited or withdrawn." },
  { patterns: [/delay|live price|real[ -]?time/], answer: "Prices are delayed NSE quotes, refreshed about every 10 minutes during market hours and once after the close." },

  // ---- advice requests (kept generic on purpose)
  { patterns: [/which stock|what (stock|share) (should|to) (i )?buy|recommend|\btips?\b|best stock|suggest/],
    answer: "I can't give investment advice or stock tips. A good habit: pick a company you understand, read why its price is moving, decide your entry, target and stop-loss, then practise with a small quantity here." },
];

const fallback = "I don't know that one yet. Try asking: \"paper trading kya hai?\", \"is the market open?\", \"price of reliance\", \"market vs limit order\", \"aaj ka P&L\", \"meri galtiyan batao\" or \"risk management kaise seekhun?\" English, Hindi and Hinglish all work.";

// Common misspellings and Hindi (Devanagari) words, rewritten before matching so
// "relience stok kharidna hai" or "पेपर ट्रेडिंग क्या है" find the right answer.
const typos: [RegExp, string][] = [
  [/\b(relience|relaince|reliace|relianse|reliance?s|rilaince|reliens)\b/g, "reliance"],
  [/\b(stok|stoks|stck|stocl|stoke)\b/g, "stock"],
  [/\b(shre|sahre|shar|shere)\b/g, "share"],
  [/\b(markt|maket|markte|markit)\b/g, "market"],
  [/\b(tradng|treding|tradeing|tarding)\b/g, "trading"],
  [/\b(portfolo|portfoilo|portfollio|portpolio)\b/g, "portfolio"],
  [/\b(balence|balanace|balnce|blance)\b/g, "balance"],
  [/\b(ordr|oder|ordar)\b/g, "order"],
  [/\b(profite|proffit|prophit)\b/g, "profit"],
  [/\b(stoploss|stop-loss)\b/g, "stop loss"],
];
const hindi: [string, string][] = [
  ["नमस्ते", "namaste"], ["पेपर", "paper"], ["ट्रेडिंग", "trading"], ["शेयर", "share"], ["स्टॉक", "stock"],
  ["खरीद", "kharid"], ["बेच", "bech"], ["बैलेंस", "balance"], ["मार्केट", "market"], ["बाजार", "bazaar"],
  ["क्या", "kya"], ["कैसे", "kaise"], ["क्यों", "kyun"], ["कब", "kab"], ["कितना", "kitna"], ["कितने", "kitne"],
  ["प्रॉफिट", "profit"], ["मुनाफा", "munafa"], ["लॉस", "loss"], ["ऑर्डर", "order"], ["है", "hai"], ["में", "me"],
  ["असली", "asli"], ["पैसा", "paisa"], ["पैसे", "paise"], ["गलती", "galti"], ["गलतियां", "galtiyan"], ["रिस्क", "risk"],
  ["रणनीति", "strategy"], ["पासवर्ड", "password"], ["खाता", "account"], ["आज", "aaj"], ["कल", "kal"],
];
function normalize(input: string): string {
  let text = input.trim().toLowerCase();
  for (const [word, latin] of hindi) text = text.split(word).join(` ${latin} `);
  for (const [pattern, fixed] of typos) text = text.replace(pattern, fixed);
  return text.replace(/\s+/g, " ").trim();
}

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
  const text = normalize(input);
  if (!text) return fallback;
  // A direct price question wins over topic answers ("price of nifty" should quote it, not explain it).
  if (/\b(price|rate|quote|kitna|trading at)\b/.test(text)) {
    const quote = findQuote(text, context);
    if (quote) return quoteLine(quote);
  }
  // "reliance kharidna hai" / "buy tcs": how to buy that exact stock, with its price.
  if (/\b(kharid|khareed|buy|lena hai|lena h|lu kya|le lu)/.test(text) && !/\b(kaise|how|kab|when|should|chahiye|which|kaun|konsa|kaunsa)\b/.test(text)) {
    const quote = findQuote(text, context);
    if (quote && quote.industry !== "Index") {
      return `${quoteLine(quote)}\nTo buy it: open ${quote.symbol} in Trade (or tap Buy), choose Delivery or Intraday, pick Market or Limit, enter the quantity and confirm. This is a virtual trade with practice money; decide your target and stop-loss first. I can't tell you whether to buy it.`;
    }
  }
  for (const intent of intents) {
    if (intent.patterns.some((pattern) => pattern.test(text))) {
      return typeof intent.answer === "function" ? intent.answer(context, text) : intent.answer;
    }
  }
  const quote = findQuote(text, context);
  if (quote) return quoteLine(quote);
  return fallback;
}

export const suggestions = ["Hi", "Paper trading kya hai?", "Is the market open?", "Price of Reliance", "Aaj ka P&L kitna hai?", "Market vs limit order", "Meri galtiyan batao", "Position sizing kaise karun?", "Top gainers today", "Risk management kaise seekhun?", "Mera win rate kitna hai?", "What is the championship?"];
