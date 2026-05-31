/**
 * audit.ts — Central audit logging library
 *
 * Uses pino for stdout (pretty in dev, JSON in prod) AND
 * persists every event to Supabase `audit_logs` table.
 *
 * Usage:
 *   import { audit } from './lib/audit.js'
 *   audit.login({ request_id, user_id, shop_id, ip, role })
 *   audit.action({ event: 'create_order', ... })
 *   audit.error({ error, request_id, endpoint, ... })
 *   audit.request({ method, endpoint, status, execution_time, ... })
 */

import pino from 'pino';
import { randomUUID } from 'crypto';
import { auditLogRepository } from '../repositories/audit-log.repository.js';

// ─── Logger (stdout) ──────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  isDev
    ? {
        level: process.env.LOG_LEVEL ?? 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
            messageFormat: '{msg} {request_id}',
          },
        },
      }
    : {
        level: process.env.LOG_LEVEL ?? 'info',
        // Production: plain JSON — ready for Datadog / Loki / CloudWatch
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditBase {
  request_id?:     string;
  session_id?:     string;
  shop_id?:        string | null;
  user_id?:        string | null;
  role?:           string | null;
  ip_address?:     string | null;
  user_agent?:     string | null;
  method?:         string | null;
  endpoint?:       string | null;
  execution_time?: number | null;
  metadata?:       Record<string, unknown>;
}

export interface LoginPayload extends AuditBase {
  user_id: string;
  email?: string;
  role?: string;
}

export interface ActionPayload extends AuditBase {
  event: string;
  entity_type?: string;
  entity_id?: string;
  changes?: Record<string, unknown>;
}

export interface RequestPayload extends AuditBase {
  status: 'success' | 'fail' | 'error';
  status_code?: number;
}

export interface ErrorPayload extends AuditBase {
  error: Error | string;
  event?: string;
}

export interface FailedAttemptPayload extends AuditBase {
  reason: string;
  email?: string;
  attempt_count?: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeRequestId() { return randomUUID(); }

// Persist to DB (fire-and-forget — never throw, never block the main flow)
async function persist(
  event: string,
  status: 'success' | 'fail' | 'error',
  payload: AuditBase & { error_message?: string },
): Promise<void> {
  try {
    await auditLogRepository.insert({
      event,
      status,
      request_id:     payload.request_id ?? makeRequestId(),
      session_id:     payload.session_id,
      shop_id:        payload.shop_id ?? null,
      user_id:        payload.user_id ?? null,
      role:           payload.role ?? null,
      ip_address:     payload.ip_address ?? null,
      user_agent:     payload.user_agent ?? null,
      method:         payload.method ?? null,
      endpoint:       payload.endpoint ?? null,
      execution_time: payload.execution_time ?? null,
      error_message:  payload.error_message,
      metadata:       payload.metadata ?? {},
    });
  } catch (err) {
    // DB write failure must NEVER crash the request
    logger.error({ err, event }, '[audit] persist failed');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const audit = {

  /** User successfully logged in */
  login(p: LoginPayload): void {
    logger.info({ ...p, event: 'login' }, `🔑 LOGIN  user=${p.user_id}  role=${p.role ?? '?'}`);
    void persist('login', 'success', {
      ...p,
      metadata: { email: p.email, role: p.role, ...p.metadata },
    });
  },

  /** User logged out */
  logout(p: AuditBase): void {
    logger.info({ ...p, event: 'logout' }, `🚪 LOGOUT  user=${p.user_id ?? '?'}`);
    void persist('logout', 'success', p);
  },

  /** Failed login attempt */
  failedLogin(p: FailedAttemptPayload): void {
    logger.warn({ ...p, event: 'login_failed' }, `⚠️  LOGIN_FAILED  email=${p.email ?? '?'}`);
    void persist('login_failed', 'fail', {
      ...p,
      error_message: p.reason,
      metadata: {
        email:         p.email,
        attempt_count: p.attempt_count,
        reason:        p.reason,
        ...p.metadata,
      },
    });
  },

  /** Any create/update/delete action */
  action(p: ActionPayload): void {
    const icon = p.event.startsWith('create') ? '✅'
                : p.event.startsWith('update') ? '✏️ '
                : p.event.startsWith('delete') ? '🗑️ '
                : p.event.startsWith('page')   ? '📄'
                : '📌';
    logger.info(
      { ...p },
      `${icon} ${p.event.toUpperCase()}  shop=${p.shop_id ?? '?'}  entity=${p.entity_type ?? '?'}/${p.entity_id ?? '?'}`,
    );
    void persist(p.event, 'success', {
      ...p,
      metadata: {
        entity_type: p.entity_type,
        entity_id:   p.entity_id,
        changes:     p.changes,
        ...p.metadata,
      },
    });
  },

  /** Page view (server-side) */
  pageView(p: AuditBase & { path: string }): void {
    logger.debug({ ...p, event: 'page_view' }, `📄 PAGE  ${p.path}`);
    void persist('page_view', 'success', {
      ...p,
      metadata: { path: p.path, ...p.metadata },
    });
  },

  /** Every API request (called in Fastify onResponse hook) */
  request(p: RequestPayload): void {
    const icon = p.status === 'success' ? '→' : p.status === 'fail' ? '⚠' : '✗';
    logger.debug(
      { ...p, event: 'api_call' },
      `${icon} ${p.method ?? 'REQ'} ${p.endpoint ?? '?'}  ${p.status_code ?? ''}  ${p.execution_time ?? '?'}ms`,
    );
    void persist('api_call', p.status, {
      ...p,
      metadata: {
        status_code: p.status_code,
        ...p.metadata,
      },
    });
  },

  /** Admin-only action (elevated logging) */
  adminAction(p: ActionPayload): void {
    logger.warn(
      { ...p, event: `admin_${p.event}` },
      `🔴 ADMIN  ${p.event.toUpperCase()}  user=${p.user_id ?? '?'}`,
    );
    void persist(`admin_${p.event}`, 'success', {
      ...p,
      metadata: {
        entity_type: p.entity_type,
        entity_id:   p.entity_id,
        changes:     p.changes,
        ...p.metadata,
      },
    });
  },

  /** Error / exception */
  error(p: ErrorPayload): void {
    const errMsg = p.error instanceof Error ? p.error.message : String(p.error);
    const errStack = p.error instanceof Error ? p.error.stack : undefined;
    logger.error(
      { ...p, event: p.event ?? 'error', err: p.error },
      `💥 ERROR  ${errMsg}`,
    );
    void persist(p.event ?? 'error', 'error', {
      ...p,
      error_message: errMsg,
      metadata: {
        stack:    errStack,
        ...p.metadata,
      },
    });
  },
};
