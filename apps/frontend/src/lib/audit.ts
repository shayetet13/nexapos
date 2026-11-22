/**
 * lib/audit.ts — Frontend audit helper
 *
 * Thin wrapper that sends audit events to /api/audit (Next.js API route),
 * which proxies them to the Fastify backend.
 *
 * All calls are fire-and-forget — errors are swallowed so they never block the UI.
 *
 * Usage (client components / server actions / API routes):
 *   import { auditClient } from '@/lib/audit'
 *   auditClient.action({ event: 'create_order', shop_id, user_id, entity_id: orderId })
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditClientBase {
  request_id?:  string;
  session_id?:  string;
  shop_id?:     string | null;
  user_id?:     string | null;
  role?:        string | null;
  ip_address?:  string | null;
  user_agent?:  string | null;
  endpoint?:    string | null;
  metadata?:    Record<string, unknown>;
}

export interface AuditActionPayload extends AuditClientBase {
  event:        string;
  entity_type?: string;
  entity_id?:   string;
  changes?:     Record<string, unknown>;
}

export interface AuditErrorPayload extends AuditClientBase {
  error:   string;
  event?:  string;
  endpoint?: string;
}

// ─── Internal send helper ─────────────────────────────────────────────────────

async function send(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch('/api/audit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      // Best-effort — don't keep page alive for this
      keepalive: true,
    });
  } catch {
    // Never throw — audit must not break the UI
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const auditClient = {

  /** Any create/update/delete action (client-side) */
  action(p: AuditActionPayload): void {
    void send({
      type:        'action',
      event:       p.event,
      shop_id:     p.shop_id,
      user_id:     p.user_id,
      role:        p.role,
      entity_type: p.entity_type,
      entity_id:   p.entity_id,
      changes:     p.changes,
      metadata:    p.metadata,
      endpoint:    p.endpoint ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      user_agent:  typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
  },

  /** Client-side error (unhandled exceptions, failed fetches) */
  error(p: AuditErrorPayload): void {
    void send({
      type:      'error',
      event:     p.event ?? 'client_error',
      shop_id:   p.shop_id,
      user_id:   p.user_id,
      error:     p.error,
      endpoint:  p.endpoint ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      metadata:   p.metadata,
    });
  },

  /** Page view (client-side navigation) */
  pageView(p: AuditClientBase & { path: string }): void {
    void send({
      type:      'page_view',
      path:      p.path,
      shop_id:   p.shop_id,
      user_id:   p.user_id,
      role:      p.role,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
  },
};
