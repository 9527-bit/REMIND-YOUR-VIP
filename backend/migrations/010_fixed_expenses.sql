ALTER TABLE subscriptions ADD COLUMN expense_type TEXT NOT NULL DEFAULT 'subscription'
  CHECK(expense_type IN ('subscription','fixed') AND (expense_type <> 'fixed' OR cycle = 'monthly'));
ALTER TABLE subscriptions ADD COLUMN reminder_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminder_enabled IN (0,1));
ALTER TABLE subscriptions ADD COLUMN auto_record INTEGER NOT NULL DEFAULT 0
  CHECK(auto_record IN (0,1) AND (auto_record = 0 OR expense_type = 'fixed'));
ALTER TABLE subscription_renewal_logs ADD COLUMN fixed_bill_json TEXT
  CHECK(fixed_bill_json IS NULL OR json_valid(fixed_bill_json));
CREATE UNIQUE INDEX idx_fixed_bill_period ON subscription_renewal_logs(user_id,subscription_id,new_start_date)
  WHERE fixed_bill_json IS NOT NULL;
