CREATE TABLE IF NOT EXISTS referral_rewards (
  referred_user_id UUID PRIMARY KEY REFERENCES users(id),
  inviter_user_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(14,2) NOT NULL DEFAULT 1000 CHECK (amount = 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referred_user_id <> inviter_user_id)
);
CREATE INDEX IF NOT EXISTS referral_rewards_inviter_idx ON referral_rewards(inviter_user_id);

ALTER TABLE practice_portfolios ADD COLUMN IF NOT EXISTS referral_bonus NUMERIC(14,2) NOT NULL DEFAULT 0;
