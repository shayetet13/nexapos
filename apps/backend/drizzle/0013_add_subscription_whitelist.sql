-- Migration: Add whitelist flag to subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS is_whitelisted boolean NOT NULL DEFAULT false;
