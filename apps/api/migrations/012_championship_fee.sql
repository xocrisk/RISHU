-- Paid championship entry: a fee per championship and the payments that unlock joining.
ALTER TABLE championships ADD COLUMN IF NOT EXISTS entry_fee_paise INTEGER NOT NULL DEFAULT 0 CHECK (entry_fee_paise >= 0);
UPDATE championships SET entry_fee_paise = 9900 WHERE id = 'lpu-2026';

CREATE TABLE IF NOT EXISTS championship_payments (
  -- The payment gateway's order id.
  order_id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid')),
  payment_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS championship_payments_user_idx ON championship_payments (user_id, championship_id);
