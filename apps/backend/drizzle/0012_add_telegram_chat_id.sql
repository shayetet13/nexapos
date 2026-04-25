-- Migration: Add telegram_chat_id to shops table
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;
