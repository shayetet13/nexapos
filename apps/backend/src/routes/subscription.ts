import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requireAdminShop, guardShop } from '../lib/admin-guard.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';
import { PLAN_CONFIG, getPlan, FEATURE_LABEL, getEffectivePlanId, TRIAL_DAYS } from '../lib/subscription-plans.js';
import { subscriptionRepository } from '../repositories/subscription.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { db } from '../db/index.js';
import { branches, products, appSettings, paymentLogs } from '../db/schema.js';
import { eq, sql, inArray, and, desc } from 'drizzle-orm';

const requestUpgradeSchema = z.object({
  target_plan:      z.enum(['free', 'basic', 'pro', 'enterprise']),
  billing_interval: z.enum(['monthly', 'yearly', 'once']).default('monthly'),
  note:             z.string().max(500).optional(),
});

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /subscription/payment-config — public ───────────────────────────
  app.get('/subscription/payment-config', async (req, reply) => {
    const rows = await db.select()
      .from(appSettings)
      .where(inArray(appSettings.key, [
        'stripe_link_monthly', 'stripe_link_yearly',
        'stripe_renewal_link_monthly', 'stripe_renewal_link_yearly',
        'yearly_discount_percent',
      ]));
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    // Renewal links fallback to upgrade links if not set separately
    return reply.send({
      success: true,
      data: {
        stripe_link_monthly:         cfg['stripe_link_monthly']          ?? '',
        stripe_link_yearly:          cfg['stripe_link_yearly']           ?? '',
        stripe_renewal_link_monthly: cfg['stripe_renewal_link_monthly']  || cfg['stripe_link_monthly']  || '',
        stripe_renewal_link_yearly:  cfg['stripe_renewal_link_yearly']   || cfg['stripe_link_yearly']   || '',
        yearly_discount_percent:     Number(cfg['yearly_discount_percent'] ?? '17'),
      },
      meta: meta(req),
    });
  });

  // ── GET /subscription/plans — public ────────────────────────────────────
  app.get('/subscription/plans', async (req, reply) => {
    // อ่าน price override จาก appSettings (ถ้ามี)
    const priceRows = await db.select()
      .from(appSettings)
      .where(inArray(appSettings.key, [
        'plan_pro_price_monthly', 'plan_pro_price_yearly',
      ]));
    const priceMap = Object.fromEntries(priceRows.map((r) => [r.key, r.value]));

    const plans = Object.values(PLAN_CONFIG).map((p) => {
      const price_monthly = p.id === 'pro' && priceMap['plan_pro_price_monthly']
        ? Number(priceMap['plan_pro_price_monthly'])
        : p.price_monthly;
      const price_yearly = p.id === 'pro' && priceMap['plan_pro_price_yearly']
        ? Number(priceMap['plan_pro_price_yearly'])
        : p.price_yearly;
      return {
        ...p,
        price_monthly,
        price_yearly,
        feature_labels: p.features.map((f) => ({
          key:   f,
          label: FEATURE_LABEL[f] ?? f,
        })),
      };
    });
    return reply.send({ success: true, data: plans, meta: meta(req) });
  });

  // ── GET /shops/:shopId/subscription — auth + any shop member ────────────
  app.get('/shops/:shopId/subscription', {
    preHandler: [app.auth, guardShop],
  }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };

    let [sub, shop, branchCount, productCount] = await Promise.all([
      subscriptionRepository.getByShopId(shopId),
      shopRepository.getShopById(shopId),
      db.select({ count: sql<number>`count(*)::int` })
        .from(branches)
        .where(eq(branches.shop_id, shopId))
        .then((r) => r[0]?.count ?? 0),
      db.select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(eq(products.shop_id, shopId))
        .then((r) => r[0]?.count ?? 0),
    ]);

    if (!shop) throw new NotFoundError('Shop not found');

    // ── Auto-create trial subscription ────────────────────────────────────
    // ถ้าไม่มี subscription เลย → สร้าง trial อัตโนมัติ 30 วันนับจากวันนี้
    // (ทั้งร้านใหม่และร้านเก่าที่ยังไม่เคยมี subscription → ได้ 30 วันเต็ม)
    if (!sub) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
      sub = await subscriptionRepository.upsert(shopId, {
        plan:             'trial',
        billing_interval: 'once',
        status:           'active',
        expires_at:       trialEnd,
      });
    }

    // ── Compute effective plan (trial หมดอายุ → คืน free) ─────────────────
    const effectivePlanId = getEffectivePlanId(sub);
    const planConfig      = getPlan(effectivePlanId);

    // ── Trial metadata ─────────────────────────────────────────────────────
    const isTrial       = sub?.plan === 'trial';
    const trialEndsAt   = isTrial ? sub?.expires_at?.toISOString() ?? null : null;
    const trialDaysLeft = (isTrial && sub?.expires_at)
      ? Math.max(0, Math.ceil((sub.expires_at.getTime() - Date.now()) / 86_400_000))
      : null;

    return reply.send({
      success: true,
      data: {
        subscription: sub
          ? {
              plan:             sub.plan,
              status:           sub.status,
              expires_at:       sub.expires_at?.toISOString() ?? null,
              billing_interval: sub.billing_interval,
              is_whitelisted:   sub.is_whitelisted ?? false,
            }
          : null,
        plan_config: {
          ...planConfig,
          feature_labels: planConfig.features.map((f) => ({
            key:   f,
            label: FEATURE_LABEL[f] ?? f,
          })),
        },
        usage: {
          branches: branchCount,
          products: productCount,
        },
        trial: {
          is_trial:       isTrial,
          ends_at:        trialEndsAt,
          days_left:      trialDaysLeft,
          trial_days:     TRIAL_DAYS,
          is_expired:     isTrial && (trialDaysLeft ?? 1) <= 0,
        },
      },
      meta: meta(req),
    });
  });

  // ── POST /shops/:shopId/subscription/request-upgrade — admin + owner/manager
  app.post('/shops/:shopId/subscription/request-upgrade', {
    preHandler: [app.auth, requireAdminShop],
  }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };

    const parseResult = requestUpgradeSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(parseResult.error.flatten().fieldErrors, 'Invalid request body');
    }
    const { target_plan, billing_interval, note } = parseResult.data;

    const [sub, shop] = await Promise.all([
      subscriptionRepository.getByShopId(shopId),
      shopRepository.getShopById(shopId),
    ]);

    if (!shop) throw new NotFoundError('Shop not found');

    const shopName      = shop.name;
    const currentPlan   = sub?.plan ?? 'free';
    const targetPlanCfg = getPlan(target_plan);
    const targetPlanName = targetPlanCfg.name;

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'NexaPos <onboarding@resend.dev>',
          to:      ['ipbpower@gmail.com'],
          subject: `[POS] ขอ Upgrade แผน: ${shopName} → ${target_plan}`,
          html: `<div style="font-family:sans-serif;padding:24px"><h2>ขอ Upgrade Subscription</h2><table><tr><td>ร้าน:</td><td>${shopName}</td></tr><tr><td>Shop ID:</td><td>${shopId}</td></tr><tr><td>แผนปัจจุบัน:</td><td>${currentPlan}</td></tr><tr><td>แผนที่ต้องการ:</td><td>${targetPlanName}</td></tr><tr><td>รอบเรียกเก็บ:</td><td>${billing_interval}</td></tr><tr><td>หมายเหตุ:</td><td>${note ?? '-'}</td></tr></table><p>กรุณาไปที่ Dev Dashboard เพื่ออัปเดต subscription</p></div>`,
        }),
      });
    }

    return reply.status(200).send({
      success: true,
      data:    { message: 'ส่งคำขอ Upgrade เรียบร้อย' },
      meta:    meta(req),
    });
  });

  // ── GET /shops/:shopId/subscription/renewal-history — auth + any member ──
  app.get('/shops/:shopId/subscription/renewal-history', {
    preHandler: [app.auth, guardShop],
  }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };

    const rows = await db.select()
      .from(paymentLogs)
      .where(and(
        eq(paymentLogs.shop_id, shopId),
        sql`${paymentLogs.metadata}->>'type' = 'renewal'`,
      ))
      .orderBy(desc(paymentLogs.created_at));

    const items = rows.map((row) => {
      const m = row.metadata as Record<string, unknown> | null;
      return {
        id:               row.id,
        amount:           Number(row.amount),
        interval:         (m?.interval as string | null) ?? null,
        renewed_at:       (m?.renewed_at as string | null) ?? row.created_at?.toISOString() ?? null,
        new_expires_at:   (m?.new_expires_at as string | null) ?? null,
        stripe_session_id: row.external_id,
      };
    });

    return reply.send({ success: true, data: items, meta: meta(req) });
  });
};
