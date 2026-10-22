-- Latest delayed NSE quote per stock, refreshed by the API's market feed.
CREATE TABLE IF NOT EXISTS market_quotes (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(14, 2) NOT NULL CHECK (price > 0),
  previous_close NUMERIC(14, 2) NOT NULL,
  high NUMERIC(14, 2) NOT NULL,
  low NUMERIC(14, 2) NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  -- When the exchange last traded the stock (from the data source), not when we fetched it.
  market_time TIMESTAMPTZ NOT NULL,
  -- Day open, fetched separately once per session; open_date is the IST session date it belongs to.
  open NUMERIC(14, 2),
  open_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
