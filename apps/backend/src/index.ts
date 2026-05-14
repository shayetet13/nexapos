import './env.js';
import { randomUUID } from 'crypto';
import fastifyFactory, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import rateLimit from '@fastify/rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { internalTokenMiddleware } from './middleware/internal-token.js';
import { shopsRoutes } from './routes/shops.js';
import { productsRoutes } from './routes/products.js';
import { ordersRoutes } from './routes/orders.js';
import { receiptsRoutes } from './routes/receipts.js';
import { devRoutes } from './routes/dev.js';
import { authRoutes } from './routes/auth.js';
import { unitsRoutes } from './routes/units.js';
import { reportsRoutes } from './routes/reports.js';
import { customersRoutes } from './routes/customers.js';
import { promotionsRoutes } from './routes/promotions.js';
import { subscriptionRoutes } from './routes/subscription.js';
import { stripeRoutes }       from './routes/stripe.js';
import { publicRoutes } from './routes/public.js';
import { telegramRoutes } from './routes/telegram.js';
import { consumablesRoutes } from './routes/consumables.js';
import { staffQrRoutes }    from './routes/staff-qr.js';
import { withdrawalsRoutes } from './routes/withdrawals.js';
import { qrSessionRoutes }   from './routes/qr-session.js';
import { auditRoutes }        from './routes/audit.js';
import { diningRoutes }       from './routes/dining.js';
import { addClient, removeClient, relayCast, broadcast, getLastDisplayState } from './lib/ws-broadcast.js';
import { audit } from './lib/audit.js';
import { startBirthdayCron } from './lib/birthday-cron.js';
import { startSubscriptionCron } from './lib/subscription-cron.js';
import { AppError } from './lib/errors.js';
import { startSnapshotCron } from './lib/snapshot-cron.js';
import { startAuditCleanupCron } from './lib/audit-cleanup-cron.js';
import { startNotificationCleanupCron } from './lib/notification-cleanup-cron.js';
import { supabaseAdmin } from './lib/supabase-admin.js';
import { shopRepository } from './repositories/shop.repository.js';

const app = fastifyFactory({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    serializers: {
      req(req) {
        return { method: req.method, url: req.url, requestId: req.id };
      },
    },
  },
  genReqId: () => randomUUID(),
});

// ── Security headers on every response ──
app.addHook('onSend', (_req, reply, payload, done) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  done(null, payload);
});

// ── Audit: stamp request start time ──
app.addHook('onRequest', (req: FastifyRequest, _reply: FastifyReply, done) => {
  (req as FastifyRequest & { startTime?: number }).startTime = Date.now();
  done();
});

// ── Audit: log every API response (fire-and-forget) ──
app.addHook('onResponse', (req: FastifyRequest, reply: FastifyReply, done) => {
  const routeUrl = req.routeOptions?.url ?? req.url;

  // Skip: health, WebSocket, and audit endpoints (prevent self-logging noise)
  if (
    req.url === '/api/health'  ||
    req.url.startsWith('/ws')  ||
    routeUrl.includes('/audit')
  ) {
    done();
    return;
  }

  // Skip server-to-server calls from the Next.js proxy (user-agent: node)
  const ua = req.headers['user-agent'] ?? '';
  if (ua.startsWith('node') || ua === '') {
    done();
    return;
  }

  const startTime = (req as FastifyRequest & { startTime?: number }).startTime;
  const executionTime = startTime ? Date.now() - startTime : null;
  const statusCode = reply.statusCode;
  const auditStatus = statusCode < 400 ? 'success' : statusCode < 500 ? 'fail' : 'error';

  // auth middleware sets req.auth (not req.user)
  const auth = (req as FastifyRequest & { auth?: { userId?: string; role?: string } }).auth;

  // Extract shopId from route params (routes: /shops/:shopId/...)
  const params = req.params as Record<string, string> | undefined;
  const shopId = params?.shopId ?? null;

  // shopRole is stamped by requireAdminShop/guardShop — actual DB shop role
  // fallback to JWT role (usually empty for regular users)
  const shopRole = (req as FastifyRequest & { shopRole?: string }).shopRole;
  const role = shopRole ?? auth?.role ?? null;

  audit.request({
    request_id:     req.id,
    method:         req.method,
    endpoint:       routeUrl,
    ip_address:     req.ip,
    user_agent:     ua || null,
    user_id:        auth?.userId ?? null,
    shop_id:        shopId,
    role:           role,
    status:         auditStatus,
    status_code:    statusCode,
    execution_time: executionTime,
  });
  done();
});

// ── Rate limiting (in-memory, 200 req / minute per IP) ──
await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
  errorResponseBuilder: (req: FastifyRequest, context: { after: string }) => ({
    success: false,
    error: {
      code: 'SYS_003',
      message: `Too many requests — retry after ${context.after}`,
    },
    meta: { requestId: req.id, timestamp: new Date().toISOString() },
  }),
});

// ── CORS ──
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());
await app.register(cors, {
  origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    // allow requests with no origin (e.g. curl, mobile apps, Postman)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
});

// ── WebSocket ──
await app.register(fastifyWebsocket);

// ── Internal-token guard (CF Worker → Fastify; skipped in dev if INTERNAL_TOKEN unset) ──
app.addHook('preHandler', internalTokenMiddleware());

// ── Auth decorator ──
app.decorate('auth', authMiddleware());

// ── Global error handler ──
app.setErrorHandler((err, req, reply) => {
  const message = err instanceof Error ? err.message : String(err);
  req.log.error({ err, requestId: req.id }, message);

  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    });
  }

  // Fastify built-in validation errors (JSON Schema)
  if (err instanceof Error && (err as { statusCode?: number }).statusCode === 400) {
    return reply.status(400).send({
      success: false,
      error: { code: 'VAL_001', message: err.message },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    });
  }

  // Unknown errors — never leak internals in production
  const isDev = process.env.NODE_ENV !== 'production';
  return reply.status(500).send({
    success: false,
    error: {
      code: 'SYS_001',
      message: 'An unexpected error occurred',
      ...(isDev ? { detail: message } : {}),
    },
    meta: { requestId: req.id, timestamp: new Date().toISOString() },
  });
});

// ── Routes ──
// ⚠️ stripeRoutes must be registered FIRST — it overrides the JSON content-type parser
// within its own scope to receive the raw body needed for HMAC-SHA256 signature verification.
await app.register(stripeRoutes,   { prefix: '/api/v1' });
await app.register(shopsRoutes,    { prefix: '/api/v1' });
await app.register(productsRoutes, { prefix: '/api/v1' });
await app.register(ordersRoutes,   { prefix: '/api/v1' });
await app.register(diningRoutes,   { prefix: '/api/v1' });
await app.register(receiptsRoutes, { prefix: '/api/v1' }); // public, no auth
await app.register(unitsRoutes,    { prefix: '/api/v1' });
await app.register(devRoutes,      { prefix: '/api/v1/dev' });
await app.register(authRoutes,     { prefix: '/api/v1/auth' });
await app.register(reportsRoutes,   { prefix: '/api/v1' });
await app.register(customersRoutes, { prefix: '/api/v1' });
await app.register(publicRoutes, { prefix: '/api/v1' });
await app.register(promotionsRoutes,   { prefix: '/api/v1' });
await app.register(subscriptionRoutes, { prefix: '/api/v1' });
await app.register(telegramRoutes,     { prefix: '/api/v1' }); // no auth — called by Telegram
await app.register(consumablesRoutes,  { prefix: '/api/v1' });
await app.register(staffQrRoutes,     { prefix: '/api/v1' });
await app.register(withdrawalsRoutes, { prefix: '/api/v1' });
await app.register(qrSessionRoutes,   { prefix: '/api/v1' });
await app.register(auditRoutes,       { prefix: '/api/v1' });

app.get('/api/health', async (req, reply) => {
  let dbOk = false;
  try {
    await shopRepository.healthPing();
    dbOk = true;
  } catch { /* db unreachable */ }

  const status = dbOk ? 200 : 503;
  return reply.status(status).send({
    ok: dbOk,
    db: dbOk ? 'ok' : 'unreachable',
    timestamp: new Date().toISOString(),
    requestId: req.id,
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(app as any).get('/ws', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const shopId = url.searchParams.get('shopId') ?? null;

  // ── JWT Authentication ──
  const rawAuth = req.headers['authorization'] ?? '';
  const token = rawAuth.startsWith('Bearer ')
    ? rawAuth.slice(7)
    : (url.searchParams.get('token') ?? null);

  if (!token) {
    socket.close(1008, 'Unauthorized: missing token');
    return;
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    socket.close(1008, 'Unauthorized: invalid token');
    return;
  }

  // ── Shop membership check ──
  if (!shopId) {
    socket.close(1008, 'Bad request: shopId required');
    return;
  }

  const role = await shopRepository.getUserRoleForShop(user.id, shopId);
  if (!role) {
    socket.close(1008, 'Forbidden: no access to this shop');
    return;
  }

  addClient(socket, shopId);
  socket.on('message', (data: Buffer | string) => {
    const raw = data.toString();
    // Intercept display events sent from POS via WS (fast path — no REST round-trip)
    // Calling broadcast() also persists state for reconnecting display clients
    try {
      const parsed = JSON.parse(raw) as { type?: string; payload?: Record<string, unknown> };
      if (typeof parsed.type === 'string' &&
          ['CHECKOUT_CASH','CHECKOUT_QR','CHECKOUT_PAID','CHECKOUT_CLOSE'].includes(parsed.type)) {
        broadcast(shopId, parsed.type, parsed.payload ?? {});
        return;
      }
    } catch { /* not a display event — fall through to relayCast */ }
    relayCast(shopId, socket, raw);
  });
  socket.on('close', () => removeClient(socket));
});

// ── Customer Display WebSocket (no auth — read-only broadcast receiver) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(app as any).get('/ws-display', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
  const url    = new URL(req.url ?? '', `http://${req.headers.host}`);
  const shopId = url.searchParams.get('shopId') ?? null;

  if (!shopId) {
    socket.close(1008, 'Bad request: shopId required');
    return;
  }

  // Validate shop exists (prevent random shopIds)
  const shop = await shopRepository.getShopById(shopId);
  if (!shop) {
    socket.close(1008, 'Not found: shop does not exist');
    return;
  }

  // Read-only — subscribe to broadcasts but do NOT relay messages from this socket
  addClient(socket, shopId);

  // Push last known display state immediately so a reconnecting screen catches up
  const lastState = getLastDisplayState(shopId);
  if (lastState && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: lastState.type, shopId, payload: lastState.payload }));
  }

  socket.on('close', () => removeClient(socket));
});

const port = Number(process.env.PORT) || 4000;
await app.listen({ port, host: '0.0.0.0' });
console.log(`NexaPos Backend running at http://localhost:${port}`);

// ── Snapshot cron (23:00 Bangkok time daily) ──
startSnapshotCron();
startBirthdayCron();
startSubscriptionCron();
// ── Audit log cleanup (Sunday 00:01 Bangkok time — deletes logs >7 days) ──
startAuditCleanupCron();
// ── Notification cleanup (1st of every month 00:01 Bangkok time — deletes all notifications) ──
startNotificationCleanupCron();

// ── Graceful shutdown ──
async function shutdown(signal: string) {
  app.log.info(`Received ${signal} — shutting down gracefully`);
  try {
    await app.close();
    app.log.info('Server closed');
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
