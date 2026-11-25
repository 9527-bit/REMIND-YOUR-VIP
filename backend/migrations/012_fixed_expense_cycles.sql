-- Allow fixed expenses to use every supported billing cycle without changing existing data.
-- The migration runner disables foreign keys temporarily and checks them before commit.
CREATE TABLE subscriptions_v12 (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL, name TEXT NOT NULL, plan TEXT NOT NULL, category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  cycle TEXT NOT NULL CHECK(cycle IN ('monthly','quarterly','yearly','custom')),
  custom_days INTEGER NOT NULL CHECK(custom_days BETWEEN 1 AND 3650),
  start_date TEXT NOT NULL, end_date TEXT NOT NULL CHECK(end_date > start_date),
  reminder_days INTEGER NOT NULL CHECK(reminder_days BETWEEN 0 AND 365),
  auto_renew INTEGER NOT NULL CHECK(auto_renew IN (0,1)),
  note TEXT NOT NULL, color TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  renewal_anchor_date TEXT NOT NULL DEFAULT '',
  billing_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(billing_amount_cents >= 0),
  billing_currency TEXT NOT NULL DEFAULT 'CNY',
  exchange_rate_micros INTEGER NOT NULL DEFAULT 1000000 CHECK(exchange_rate_micros > 0),
  exchange_rate_date TEXT,
  original_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(original_amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'CNY', purchase_date TEXT NOT NULL DEFAULT '',
  fx_rate_to_cny REAL NOT NULL DEFAULT 1 CHECK(fx_rate_to_cny > 0 AND fx_rate_to_cny <= 100000),
  fx_rate_date TEXT NOT NULL DEFAULT '',
  fx_rate_source TEXT NOT NULL DEFAULT 'manual' CHECK(fx_rate_source IN ('manual','frankfurter')),
  rate_pending INTEGER NOT NULL DEFAULT 0 CHECK(rate_pending IN (0,1)),
  expense_type TEXT NOT NULL DEFAULT 'subscription'
    CHECK(expense_type IN ('subscription','fixed','phone')),
  reminder_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminder_enabled IN (0,1)),
  auto_record INTEGER NOT NULL DEFAULT 0 CHECK(auto_record IN (0,1) AND (auto_record = 0 OR expense_type IN ('fixed','phone'))),
  phone_account_id TEXT,
  phone_charge_type TEXT CHECK(phone_charge_type IS NULL OR phone_charge_type IN ('monthly','yearly','once')),
  PRIMARY KEY(user_id,id),
  FOREIGN KEY(user_id,phone_account_id) REFERENCES phone_accounts(user_id,id),
  CHECK((expense_type = 'phone' AND phone_account_id IS NOT NULL AND phone_charge_type IS NOT NULL)
    OR (expense_type <> 'phone' AND phone_account_id IS NULL AND phone_charge_type IS NULL)),
  CHECK(expense_type <> 'phone' OR
    (phone_charge_type = 'monthly' AND cycle = 'monthly') OR
    (phone_charge_type = 'yearly' AND cycle = 'yearly') OR
    (phone_charge_type = 'once' AND cycle = 'custom' AND custom_days = 1 AND auto_renew = 0 AND reminder_enabled = 0))
) STRICT;

INSERT INTO subscriptions_v12 SELECT * FROM subscriptions;
DROP TABLE subscriptions;
ALTER TABLE subscriptions_v12 RENAME TO subscriptions;
CREATE INDEX idx_subscriptions_owner_end_date ON subscriptions(user_id,end_date);
CREATE INDEX idx_subscriptions_auto_end_date ON subscriptions(auto_renew,end_date);
CREATE INDEX idx_subscriptions_phone ON subscriptions(user_id,phone_account_id);
