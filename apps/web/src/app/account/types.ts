export type Quote = {
  symbol: string; name: string; industry: string; price: number; change: number; changePercent: number;
  /** Day open; null until fetched for the latest session. */
  open: number | null; high: number; low: number;
  /** Previous session close. */
  close: number; volume: number; marketTime: string;
};

export type Holding = {
  symbol: string; name: string; quantity: number; averageCost: number; lastPrice: number;
  currentValue: number; unrealizedPnl: number; realizedPnl: number;
};

export type Side = "buy" | "sell";
export type Product = "delivery" | "intraday";
export type OrderType = "market" | "limit";

export type Order = {
  id: string; symbol: string; side: Side; product: Product; orderType: OrderType; quantity: number;
  limitPrice: string | number | null; fillPrice: string | number | null;
  status: "open" | "filled" | "cancelled" | "rejected";
  rejectionReason?: string | null; createdAt: string; filledAt?: string | null;
};

export type MarketStatus = { isOpen: boolean; reason: string | null; nextChangeAt: string };

export type Dashboard = {
  user: {
    fullName: string | null; college: string | null; leaderboardOptIn: boolean;
    email: string; mobile: string | null; memberSince: string; lastLoginAt: string | null;
  };
  market: { dataMode: "DELAYED"; lastUpdatedAt: string | null; status: MarketStatus; quotes: Quote[]; indices: Quote[]; nifty50: string[] };
  portfolio: {
    totalValue: number; dayChange: number; dayChangePercent: number; availableCash: number;
    cash: number; investedValue: number; unrealizedPnl: number; realizedPnl: number;
    trend: { value: number; time: string }[];
  };
  holdings: Holding[];
  orders: Order[];
  leaderboard: { rank: number; displayName: string; returnPercent: number; isSelf: boolean }[];
  rules: { initialCash: number; charges: number; slippage: number; limitBandPercent: number };
};

export type Tab = "dashboard" | "portfolio" | "wallet" | "watchlist" | "trade" | "transactions"
  | "insights" | "analytics" | "trends" | "support" | "settings";

export type OrderTicket = { symbol: string; side: Side; quantity?: number; product?: Product; orderType?: OrderType; price?: number };

export type ChartRange = "1D" | "1W" | "1M" | "6M" | "1Y" | "5Y";
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Chart = {
  symbol: string; range: ChartRange; previousClose: number | null;
  fiftyTwoWeekHigh: number | null; fiftyTwoWeekLow: number | null; candles: Candle[];
};
