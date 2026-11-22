import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { paymentLogs, appSettings } from '../db/schema.js';
import { subscriptionRepository } from '../repositories/subscription.repository.js';
import { eq } from 'drizzle-orm';

// ── Stripe HMAC-SHA256 signature verification (Web Crypto API — no Stripe SDK) ──
async function verifyStripeSignature(
  payload: string,
  header:  string,
  secret:  string,
): Promise<boolean> {
  const parts     = header.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const signature = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig      = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Buffer.from(sig).toString('hex');
  return expected === signature;
}

// ── Stripe event type stubs (avoid Stripe SDK dependency) ──
interface StripeSession {
  id:                    string;
  amount_total:          number | null;
  client_reference_id:   string | null;
  metadata:              Record<string, string> | null;
}

interface StripeEvent {
  type: string;
  data: { object: StripeSession };
}

export const stripeRoutes: FastifyPluginAsync = async (app) => {
  // Override JSON parser within this plugin's scope → return raw Buffer
  // This is required so we can verify Stripe's HMAC-SHA256 signature over the raw body.
  // The override ONLY affects routes registered in this plugin's scope.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => { done(null, body); },
  );

  // ── POST /stripe/webhook ─────────────────────────────────────────────────────
  app.post('/stripe/webhook', async (req, reply) => {
    const rawBody   = (req.body as Buffer).toString('utf-8');
    const sigHeader = (req.headers['stripe-signature'] as string | undefined) ?? '';

    // Load webhook secret from app_settings (fallback to env var)
    const row           = await db.select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'stripe_webhook_secret'))
      .then((r) => r[0] ?? null);
    const webhookSecret = row?.value ?? process.env.STRIPE_WEBHOOK_SECRET ?? '';

    if (!webhookSecret) {
      req.log.warn('Stripe webhook: stripe_webhook_secret not configured');
      // Return 200 so Stripe does not keep retrying unconfigured webhooks
      return reply.send({ received: true });
    }

    if (!sigHeader) {
      req.log.warn('Stripe webhook: missing stripe-signature header');
      return reply.status(400).send({ received: false, error: 'Missing signature' });
    }

    const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
    if (!valid) {
      req.log.warn('Stripe webhook: signature mismatch');
      return reply.status(400).send({ received: false, error: 'Invalid signature' });
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      return reply.status(400).send({ received: false, error: 'Invalid JSON' });
    }

    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object, req.log);
    }

    // Always respond 200 — Stripe requires it
    return reply.send({ received: true });
  });
};

// ── Handle checkout.session.completed ───────────────────────────────────────────
async function handleCheckoutCompleted(
  session: StripeSession,
  log:     { info: (obj: unknown, msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  // client_reference_id format: "{shopId}__{interval}"
  const clientRef = session.client_reference_id ?? '';
  const sepIdx    = clientRef.lastIndexOf('__');

  if (sepIdx < 0) {
    log.warn(`Stripe webhook: invalid client_reference_id "${clientRef}" — skipping`);
    return;
  }

  const shopId   = clientRef.slice(0, sepIdx);
  const rawIv    = clientRef.slice(sepIdx + 2);
  const interval = rawIv === 'yearly' ? 'yearly' : 'monthly' as 'monthly' | 'yearly';

  if (!shopId) {
    log.warn('Stripe webhook: empty shopId in client_reference_id — skipping');
    return;
  }

  // ── Calculate new expiry: end-of-day, 1 year / 1 month from now ──
  const paidAt       = new Date();
  const newExpiresAt = interval === 'yearly'
    ? new Date(paidAt.getFullYear() + 1, paidAt.getMonth(),     paidAt.getDate(), 23, 59, 59, 999)
    : new Date(paidAt.getFullYear(),     paidAt.getMonth() + 1, paidAt.getDate(), 23, 59, 59, 999);

  const amountTotal = session.amount_total ?? 0;

  // ── Upsert subscription ──
  await subscriptionRepository.upsert(shopId, {
    plan:             'pro',
    billing_interval: interval,
    status:           'active',
    expires_at:       newExpiresAt,
  });

  // ── Log payment evidence ──
  await db.insert(paymentLogs).values({
    shop_id:     shopId,
    amount:      String(amountTotal / 100),
    currency:    'THB',
    status:      'completed',
    external_id: session.id,
    metadata: {
      type:           'renewal',
      interval,
      renewed_at:     paidAt.toISOString(),
      new_expires_at: newExpiresAt.toISOString(),
    },
  });

  log.info({ shopId, interval, newExpiresAt: newExpiresAt.toISOString() }, 'Stripe renewal processed');
}
