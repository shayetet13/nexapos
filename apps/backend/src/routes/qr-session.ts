/**
 * QR Login Sessions — WeChat-style QR login
 *
 * Flow:
 *  1. POS calls POST /auth/qr-session  → gets {token, expires_at}
 *  2. POS opens WebSocket: /ws-qr?t={token} (waits for real-time confirmation)
 *  3. POS shows QR code: <app_url>/qr-auth?t={token}
 *  4. Staff scans with phone → /qr-auth page → logs in → clicks "ยืนยัน"
 *  5a. FIRST SCAN: Phone calls POST /auth/qr-session/:token/confirm with JWT
 *      → Backend confirms, issues device_token (30 days), sends WS event to POS
 *  5b. SECOND SCAN+: Phone sends X-QR-Device-Token header (no Supabase JWT needed)
 *      → Backend validates device_token, refreshes expiry, sends WS event to POS
 *  6. Backend sends QR_CONFIRMED via WebSocket → POS receives instantly
 *  7. POS calls POST /auth/qr-session/:token/exchange {login_token}
 *     → gets {token_hash} → calls supabase.auth.verifyOtp → session established
 *
 * QR expires in 45 seconds, single-use.
 * Device token expires in 30 days, refreshed on each use.
 */

import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { db } from '../db/index.js';
import { qrLoginSessions, qrDeviceTokens } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { verifyJwt } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { NotFoundError } from '../lib/errors.js';

// POS WebSocket connections waiting for QR confirmation: token → WebSocket
const qrWsClients = new Map<string, WebSocket>();

// 30 days in ms
const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Resolve userId from either JWT or X-QR-Device-Token header.
 *  Returns userId or null if neither is valid. */
async function resolveUserId(req: import('fastify').FastifyRequest): Promise<string | null> {
  // Try device token first (second scan path — faster, no Supabase roundtrip after first use)
  const deviceToken = req.headers['x-qr-device-token'];
  if (deviceToken && typeof deviceToken === 'string') {
    const [row] = await db
      .select()
      .from(qrDeviceTokens)
      .where(eq(qrDeviceTokens.token, deviceToken));

    if (!row) return null;
    if (new Date() > row.expires_at) return null; // expired

    // Refresh expiry on use (sliding window)
    await db
      .update(qrDeviceTokens)
      .set({ expires_at: new Date(Date.now() + DEVICE_TOKEN_TTL_MS) })
      .where(eq(qrDeviceTokens.token, deviceToken));

    return row.user_id;
  }

  // Fall back to JWT (first scan)
  try {
    const auth = await verifyJwt(req);
    return auth.userId;
  } catch {
    return null;
  }
}

export const qrSessionRoutes: FastifyPluginAsync = async (app) => {

  // ── POST /auth/qr-session — create new QR session (no auth) ──────
  app.post('/auth/qr-session', async (_req, reply) => {
    const expiresAt = new Date(Date.now() + 45_000); // 45 seconds
    const [session] = await db
      .insert(qrLoginSessions)
      .values({ expires_at: expiresAt })
      .returning({
        token:      qrLoginSessions.token,
        expires_at: qrLoginSessions.expires_at,
      });

    return reply.send({ success: true, data: session });
  });

  // ── GET /ws-qr?t={token} — POS connects via WebSocket to wait for confirmation ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get('/ws-qr', { websocket: true }, async (socket: WebSocket, req: import('fastify').FastifyRequest) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('t') ?? '';

    if (!token) {
      socket.close(1008, 'token required');
      return;
    }

    // Verify session exists and is still pending
    const [session] = await db
      .select()
      .from(qrLoginSessions)
      .where(eq(qrLoginSessions.token, token));

    if (!session || session.status !== 'pending') {
      socket.close(1008, 'invalid or expired session');
      return;
    }

    qrWsClients.set(token, socket);
    socket.on('close', () => qrWsClients.delete(token));
  });

  // ── GET /auth/qr-session/:token — poll status (fallback, no auth) ──
  app.get('/auth/qr-session/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.params);

    const [session] = await db
      .select()
      .from(qrLoginSessions)
      .where(eq(qrLoginSessions.token, token));

    if (!session) {
      return reply.status(404).send({ success: false, error: 'not_found' });
    }

    // Auto-expire stale pending sessions
    if (session.status === 'pending' && new Date() > session.expires_at) {
      await db
        .update(qrLoginSessions)
        .set({ status: 'expired' })
        .where(eq(qrLoginSessions.token, token));
      return reply.send({ success: true, data: { status: 'expired' } });
    }

    return reply.send({
      success: true,
      data: {
        status:      session.status,
        login_token: session.login_token ?? undefined,
      },
    });
  });

  // ── POST /auth/qr-session/:token/confirm ────────────────────────────────────
  // Accepts EITHER:
  //   • Authorization: Bearer <supabase-jwt>  — first scan
  //   • X-QR-Device-Token: <device-uuid>      — second scan and beyond
  app.post('/auth/qr-session/:token/confirm', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.params);

    const userId = await resolveUserId(req);
    if (!userId) {
      return reply.status(401).send({ success: false, error: 'unauthorized', message: 'กรุณาเข้าสู่ระบบก่อน' });
    }

    const [session] = await db
      .select()
      .from(qrLoginSessions)
      .where(eq(qrLoginSessions.token, token));

    if (!session) throw new NotFoundError('QR session not found');

    if (session.status !== 'pending') {
      return reply.status(400).send({ success: false, error: 'already_used', message: 'QR ถูกใช้ไปแล้วหรือหมดอายุ' });
    }

    if (new Date() > session.expires_at) {
      await db.update(qrLoginSessions).set({ status: 'expired' }).where(eq(qrLoginSessions.token, token));
      return reply.status(400).send({ success: false, error: 'expired', message: 'QR หมดอายุแล้ว กรุณาสแกนใหม่' });
    }

    // Generate a one-time login_token for POS to exchange
    const loginToken = crypto.randomUUID();

    await db
      .update(qrLoginSessions)
      .set({
        status:       'confirmed',
        user_id:      userId,
        login_token:  loginToken,
        confirmed_at: new Date(),
      })
      .where(eq(qrLoginSessions.token, token));

    // Notify POS immediately via WebSocket (real-time, no polling needed)
    const ws = qrWsClients.get(token);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'QR_CONFIRMED', login_token: loginToken }));
      ws.close();
      qrWsClients.delete(token);
    }

    // Issue / refresh device token so phone can skip Supabase auth on next scan
    const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS);
    const existingDeviceToken = req.headers['x-qr-device-token'];

    let deviceToken: string;
    if (existingDeviceToken && typeof existingDeviceToken === 'string') {
      // Already refreshed expiry above — return same token
      deviceToken = existingDeviceToken;
    } else {
      // First scan — create new device token
      const [row] = await db
        .insert(qrDeviceTokens)
        .values({ user_id: userId, expires_at: expiresAt })
        .returning({ token: qrDeviceTokens.token });
      deviceToken = row!.token;
    }

    return reply.send({ success: true, data: { confirmed: true, device_token: deviceToken } });
  });

  // ── POST /auth/qr-session/:token/exchange — POS exchanges login_token for magic link ──
  app.post('/auth/qr-session/:token/exchange', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.params);
    const { login_token } = z.object({ login_token: z.string().uuid() }).parse(req.body);

    const [session] = await db
      .select()
      .from(qrLoginSessions)
      .where(
        and(
          eq(qrLoginSessions.token, token),
          eq(qrLoginSessions.login_token, login_token),
        ),
      );

    if (!session) {
      return reply.status(404).send({ success: false, error: 'not_found' });
    }
    if (session.status !== 'confirmed') {
      return reply.status(400).send({ success: false, error: 'not_confirmed' });
    }
    if (!session.user_id) {
      return reply.status(400).send({ success: false, error: 'no_user' });
    }

    // Mark as used (single-use)
    await db
      .update(qrLoginSessions)
      .set({ status: 'used' })
      .where(eq(qrLoginSessions.token, token));

    // Look up user email
    const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(session.user_id);
    if (error || !user?.email) {
      return reply.status(404).send({ success: false, error: 'user_not_found' });
    }

    // Generate magic link → extract token_hash for frontend verifyOtp
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type:  'magiclink',
      email: user.email,
      options: { redirectTo: `${process.env.FRONTEND_URL ?? ''}/qr-login/callback` },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return reply.status(500).send({ success: false, error: 'magic_link_failed' });
    }

    const actionUrl = new URL(linkData.properties.action_link);
    const tokenHash = actionUrl.searchParams.get('token') ?? '';

    return reply.send({
      success: true,
      data: {
        token_hash: tokenHash,
        token_type: 'magiclink',
        email:      user.email,
      },
    });
  });
};
