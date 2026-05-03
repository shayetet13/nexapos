-- ─────────────────────────────────────────────────────────────
-- Migration 0019 — audit_logs table
-- Full audit trail: every user action, API call, login, error
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id"        uuid REFERENCES "shops"("id") ON DELETE CASCADE,
  "request_id"     text NOT NULL,
  "session_id"     text,
  "event"          text NOT NULL,
  "user_id"        uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "role"           text,
  "ip_address"     text,
  "user_agent"     text,
  "method"         text,
  "endpoint"       text,
  "status"         text NOT NULL DEFAULT 'success',
  "execution_time" integer,
  "error_message"  text,
  "metadata"       jsonb NOT NULL DEFAULT '{}',
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_logs_shop_id_idx"    ON "audit_logs"("shop_id");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx"    ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_event_idx"      ON "audit_logs"("event");
CREATE INDEX IF NOT EXISTS "audit_logs_status_idx"     ON "audit_logs"("status");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_request_id_idx" ON "audit_logs"("request_id");
