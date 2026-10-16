ALTER TABLE users
  ADD COLUMN IF NOT EXISTS leaderboard_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS practice_portfolios (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cash NUMERIC(14, 2) NOT NULL DEFAULT 100000.00 CHECK (cash >= 0),
  realized_pnl NUMERIC(14, 2) NOT NULL DEFAULT 0,
  day_start_value NUMERIC(14, 2) NOT NULL DEFAULT 100000.00,
  day_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_holdings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  average_cost NUMERIC(14, 2) NOT NULL CHECK (average_cost >= 0),
  realized_pnl NUMERIC(14, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS practice_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  product TEXT NOT NULL CHECK (product IN ('delivery', 'intraday')),
  order_type TEXT NOT NULL CHECK (order_type IN ('market', 'limit')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  limit_price NUMERIC(14, 2),
  fill_price NUMERIC(14, 2),
  status TEXT NOT NULL CHECK (status IN ('open', 'filled', 'cancelled', 'rejected')),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at TIMESTAMPTZ,
  CHECK (
    status = 'rejected' OR
    (order_type = 'limit' AND limit_price > 0) OR
    (order_type = 'market' AND limit_price IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS practice_orders_user_created_idx
  ON practice_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS practice_orders_open_idx
  ON practice_orders(status, symbol) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS practice_portfolio_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_value NUMERIC(14, 2) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_snapshots_user_created_idx
  ON practice_portfolio_snapshots(user_id, created_at DESC);
