ALTER TABLE subscription_preferences ADD COLUMN phone_display_subscription_id TEXT;
ALTER TABLE subscription_preferences ADD COLUMN phone_display_version INTEGER NOT NULL DEFAULT 0 CHECK(phone_display_version >= 0);
