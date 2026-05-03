import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { eq, sql, desc, gte, lte, and, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  orders, branches, userShopRoles, subscriptions as subscriptionsTable,
  shopNotifications, products, branchStock, stockTransactions,
  customers, shopUnits, promotions, combos, comboItems, orderItems,
  logs, events, paymentLogs, shopSalesSnapshots, shops, appSettings,
} from '../db/schema.js';
import {
  getPeriodRange, getPeriodTrend, getLiveLeaderboard,
  getSnapshot, getAvailablePeriodKeys, takeSnapshot as takeSnapshotRepo,
  type PeriodType,
} from '../repositories/leaderboard.repository.js';
import { triggerManualSnapshot } from '../lib/snapshot-cron.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { subscriptionRepository } from '../repositories/subscription.repository.js';
import { requireDevAdmin, isDevAdmin } from '../lib/dev-guard.js';
import { PLAN_CONFIG, calcExpiresAt } from '../lib/subscription-plans.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { decrypt } from '../lib/crypto.js';

// ── In-memory PIN store (dev reset only) ─────────────────────────────────
const RESET_PIN_EMAIL = 'ipbpower@gmail.com';
const resetPinStore   = new Map<string, { pin: string; expiresAt: number }>();

async function sendResetPinEmail(pin: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`\n⚠️  [DEV RESET] ไม่มี RESEND_API_KEY\n    PIN: ${pin}\n`);
    return { ok: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'NexaPos Dev <onboarding@resend.dev>',
        to:      [RESET_PIN_EMAIL],
        subject: `[POS Dev] รหัส PIN รีเซตข้อมูล: ${pin}`,
        html: `
          <div style="font-family:monospace;background:#09090b;color:#e8f4ff;padding:32px;border-radius:12px;max-width:420px;margin:0 auto">
            <h2 style="color:#ef4444;margin-top:0">☢️ Dev Reset PIN</h2>
            <p>มีการขอรีเซตข้อมูลทดสอบทั้งหมดใน NexaPos</p>
            <div style="background:#1f1f23;border:2px solid #ef4444;border-radius:8px;padding:24px;text-align:center;margin:20px 0">
              <div style="font-size:42px;font-weight:700;letter-spacing:14px;color:#ef4444">${pin}</div>
              <div style="color:#71717a;font-size:12px;margin-top:10px">⏱ หมดอายุใน 10 นาที</div>
            </div>
            <p style="color:#fca5a5;font-size:12px;margin:0">
              ⚠️ การดำเนินการนี้จะลบข้อมูลทั้งหมดในฐานข้อมูลอย่างถาวร<br/>
              ถ้าไม่ได้ขอ PIN นี้ กรุณาเพิกเฉย
            </p>
          </div>`,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      return { ok: false, error: body.message ?? `Resend HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[DEV RESET] Email error:', msg);
    return { ok: false, error: msg };
  }
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function meta(req: { id: string }) {
  return { requestId: req.id, timestamp: new Date().toISOString() };
}

// ── Zod schemas ───────────────────────────────────────────────
const createShopSchema = z.object({
  name:        z.string().min(1, 'name required').max(200).trim(),
  province:    z.string().optional(),
  district:    z.string().optional(),
  postal_code: z.string().regex(/^\d{5}$/, 'postal_code must be 5 digits').optional(),
});

const createBranchSchema = z.object({
  name:    z.string().min(1, 'name required').max(200).trim(),
  address: z.string().optional(),
});

const createUserSchema = z.object({
  email:    z.string().email('invalid email'),
  password: z.string().min(6, 'password must be at least 6 chars'),
  shopId:   z.string().uuid('shopId must be a UUID'),
  role:     z.enum(['owner', 'manager', 'cashier', 'viewer']).default('cashier'),
  branchId: z.string().uuid('branchId must be a UUID').optional(),
});

const upsertSubscriptionSchema = z.object({
  plan:             z.string().default('basic'),
  billing_interval: z.enum(['monthly', 'yearly', 'once']).default('monthly'),
  expires_at:       z.string().nullable().optional(),
});

const setBranchActiveSchema = z.object({
  is_active: z.boolean({ required_error: 'is_active required' }),
});

// ── Routes ────────────────────────────────────────────────────
const devRoutes: FastifyPluginAsync = async (app) => {

  // GET /dev/is-dev
  app.get('/is-dev', { preHandler: [app.auth] }, async (req, reply) => {
    return reply.send({ success: true, data: { isDev: isDevAdmin(req.auth!.email) }, meta: meta(req) });
  });

  // GET /dev/shops
  app.get('/shops', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const list = await shopRepository.getAllShops();
    // Include decrypted promptpay_number for dev search capability
    const withDecrypted = list.map((s) => ({
      ...s,
      promptpay_number: decrypt(s.promptpay_number_encrypted),
      promptpay_number_encrypted: undefined, // strip encrypted blob from response
    }));
    return reply.send({ success: true, data: withDecrypted, meta: meta(req) });
  });

  // POST /dev/shops
  app.post<{ Body: unknown }>('/shops', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const parsed = createShopSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
    const { name, province, district, postal_code } = parsed.data;
    const shop = await shopRepository.createShop(name, { postalCode: postal_code, province, district });
    if (!shop) throw new Error('Create shop failed');
    return reply.status(201).send({ success: true, data: shop, meta: meta(req) });
  });

  // PATCH /dev/shops/:shopId/active — suspend or re-activate a shop
  app.patch<{ Params: { shopId: string }; Body: { is_active: boolean; reason?: string } }>(
    '/shops/:shopId/active', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const { is_active } = req.body;
      if (typeof is_active !== 'boolean') {
        throw new ValidationError({ is_active: ['must be boolean'] });
      }
      const updated = await shopRepository.setShopActive(req.params.shopId, is_active);
      if (!updated) throw new NotFoundError('Shop');
      return reply.send({ success: true, data: updated, meta: meta(req) });
    },
  );

  // PATCH /dev/shops/:shopId/ban — ban or unban a shop
  app.patch<{ Params: { shopId: string }; Body: { is_banned: boolean; reason?: string } }>(
    '/shops/:shopId/ban', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const { is_banned, reason } = req.body;
      if (typeof is_banned !== 'boolean') {
        throw new ValidationError({ is_banned: ['must be boolean'] });
      }
      if (is_banned && !reason?.trim()) {
        throw new ValidationError({ reason: ['กรุณาระบุเหตุผลการแบน'] });
      }
      const updated = await shopRepository.setShopBanned(req.params.shopId, is_banned, reason?.trim() ?? null);
      if (!updated) throw new NotFoundError('Shop');
      return reply.send({ success: true, data: updated, meta: meta(req) });
    },
  );

  // DELETE /dev/shops/:shopId — permanently delete a shop and all its data
  app.delete<{ Params: { shopId: string } }>(
    '/shops/:shopId', { preHandler: [app.auth], config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      await requireDevAdmin(req);
      const deleted = await shopRepository.deleteShop(req.params.shopId);
      if (!deleted) throw new NotFoundError('Shop');
      return reply.send({ success: true, data: { deleted: req.params.shopId }, meta: meta(req) });
    },
  );

  // GET /dev/shops/:shopId/branches — list branches for a shop (dev admin only)
  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/branches', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const list = await shopRepository.getBranchesByShopId(req.params.shopId);
      return reply.send({ success: true, data: list, meta: meta(req) });
    },
  );

  // GET /dev/shops/:shopId/staff — list staff accounts for a shop (dev admin only)
  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/staff', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const list = await userRepository.getStaffByShop(req.params.shopId);
      return reply.send({ success: true, data: list, meta: meta(req) });
    },
  );

  // DELETE /dev/shops/:shopId/staff/:userId — remove a staff account (dev admin only)
  app.delete<{ Params: { shopId: string; userId: string } }>(
    '/shops/:shopId/staff/:userId', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const { shopId, userId } = req.params;
      await userRepository.removeFromShop(userId, shopId);
      await userRepository.deleteUser(userId);
      const admin = getSupabaseAdmin();
      if (admin) await admin.auth.admin.deleteUser(userId);
      return reply.send({ success: true, data: { deleted: userId }, meta: meta(req) });
    },
  );

  // POST /dev/shops/:shopId/branches
  app.post<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/branches', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const parsed = createBranchSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
      const branch = await shopRepository.createBranch(req.params.shopId, parsed.data.name, parsed.data.address);
      if (!branch) throw new Error('Create branch failed');
      return reply.status(201).send({ success: true, data: branch, meta: meta(req) });
    },
  );

  // POST /dev/users
  app.post<{ Body: unknown }>('/users', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const admin = getSupabaseAdmin();
    if (!admin) return reply.status(503).send({ success: false, error: { code: 'SYS_004', message: 'Service role not configured' }, meta: meta(req) });

    const { email, password, shopId, role, branchId } = parsed.data;
    let userId: string;

    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      // "Already registered" edge-case: update the password and reuse the existing user
      const isAlreadyExists =
        authError.message.toLowerCase().includes('already been registered') ||
        authError.message.toLowerCase().includes('already registered') ||
        authError.message.toLowerCase().includes('user already exists');

      if (!isAlreadyExists) {
        throw new ValidationError({ email: [authError.message] }, authError.message);
      }

      const { data: listData } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = listData?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) {
        throw new ValidationError({ email: ['User already exists but could not be found'] }, 'User lookup failed');
      }
      // Reset password and ensure email is confirmed
      await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      userId = existing.id;
    } else {
      if (!authUser.user) throw new Error('Create user failed');
      userId = authUser.user.id;
    }

    await userRepository.upsertUser(userId, email);
    await userRepository.assignToShop(userId, shopId, role, branchId);
    return reply.status(201).send({ success: true, data: { userId, email }, meta: meta(req) });
  });

  // GET /dev/shops/:shopId/users
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/users', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const list = await userRepository.getUsersByShop(req.params.shopId);
    return reply.send({ success: true, data: list, meta: meta(req) });
  });

  // DELETE /dev/users/:userId
  app.delete<{ Params: { userId: string } }>('/users/:userId', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const admin = getSupabaseAdmin();
    if (admin) {
      await admin.auth.admin.deleteUser(req.params.userId);
    }
    await userRepository.deleteUser(req.params.userId);
    return reply.send({ success: true, data: null, meta: meta(req) });
  });

  // GET /dev/shops/:shopId/subscription
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/subscription', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const sub = await subscriptionRepository.getByShopId(req.params.shopId);
    return reply.send({ success: true, data: sub, meta: meta(req) });
  });

  // PUT /dev/shops/:shopId/subscription
  app.put<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/subscription', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const parsed = upsertSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
      const { plan, billing_interval, expires_at } = parsed.data;
      const sub = await subscriptionRepository.upsert(req.params.shopId, {
        plan,
        billing_interval,
        expires_at: expires_at ? new Date(expires_at) : null,
      });
      return reply.send({ success: true, data: sub, meta: meta(req) });
    },
  );

// DELETE /dev/branches/:branchId
  app.delete<{ Params: { branchId: string } }>('/branches/:branchId', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const deleted = await shopRepository.deleteBranch(req.params.branchId);
    if (!deleted) throw new NotFoundError('Branch');
    return reply.send({ success: true, data: null, meta: meta(req) });
  });

  // PATCH /dev/branches/:branchId
  app.patch<{ Params: { branchId: string }; Body: unknown }>(
    '/branches/:branchId', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const parsed = setBranchActiveSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
      const updated = await shopRepository.setBranchActive(req.params.branchId, parsed.data.is_active);
      if (!updated) throw new NotFoundError('Branch');
      return reply.send({ success: true, data: updated, meta: meta(req) });
    },
  );

  // GET /dev/overview?period=day|week|month|year&offset=0
  // offset 0 = current, 1 = previous, …
  app.get<{ Querystring: { period?: string; offset?: string } }>('/overview', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);

    const period = (['day', 'week', 'month', 'year'].includes(req.query.period ?? '')
      ? (req.query.period as PeriodType)
      : 'month');
    const offset = Math.max(0, Number(req.query.offset ?? 0));

    const { from, to, label } = getPeriodRange(period, offset);

    // Fixed "today" boundaries for the today-revenue column (always current day)
    const todayRange = getPeriodRange('day', 0);

    const [allShops, revenueRows, branchRows, userRows, allSubs, trendData] = await Promise.all([
      // 1. All shops
      shopRepository.getAllShops(),

      // 2. Per-shop revenue: selected period + today
      db.select({
        shop_id:            orders.shop_id,
        revenue_period:     sql<string>`COALESCE(SUM(CASE WHEN ${orders.created_at} >= ${from} AND ${orders.created_at} < ${to} THEN ${orders.total}::numeric ELSE 0 END), 0)`,
        revenue_today:      sql<string>`COALESCE(SUM(CASE WHEN ${orders.created_at} >= ${todayRange.from} AND ${orders.created_at} < ${todayRange.to} THEN ${orders.total}::numeric ELSE 0 END), 0)`,
        order_count_period: sql<string>`COUNT(CASE WHEN ${orders.created_at} >= ${from} AND ${orders.created_at} < ${to} THEN 1 END)`,
      }).from(orders).where(eq(orders.status, 'paid')).groupBy(orders.shop_id),

      // 3. Branch count per shop
      db.select({ shop_id: branches.shop_id, count: sql<string>`COUNT(*)` })
        .from(branches).groupBy(branches.shop_id),

      // 4. User count per shop
      db.select({ shop_id: userShopRoles.shop_id, count: sql<string>`COUNT(*)` })
        .from(userShopRoles).groupBy(userShopRoles.shop_id),

      // 5. All subscriptions
      db.select().from(subscriptionsTable),

      // 6. Trend chart (granularity depends on period)
      getPeriodTrend(period, offset),
    ]);

    const revMap    = new Map(revenueRows.map((r) => [r.shop_id, r]));
    const branchMap = new Map(branchRows.map((r)  => [r.shop_id, Number(r.count)]));
    const userMap   = new Map(userRows.map((r)    => [r.shop_id, Number(r.count)]));
    const subMap    = new Map(allSubs.map((s)     => [s.shop_id, s]));

    const shopsData = allShops.map((s) => {
      const rev = revMap.get(s.id);
      const sub = subMap.get(s.id) ?? null;
      return {
        id:                 s.id,
        name:               s.name,
        shop_code:          s.shop_code  ?? null,
        province:           s.province   ?? null,
        created_at:         s.created_at.toISOString(),
        revenue_period:     Number(rev?.revenue_period     ?? 0),
        revenue_today:      Number(rev?.revenue_today      ?? 0),
        order_count_period: Number(rev?.order_count_period ?? 0),
        branch_count:       branchMap.get(s.id) ?? 0,
        user_count:         userMap.get(s.id)   ?? 0,
        subscription: sub ? {
          plan:             sub.plan,
          status:           sub.status,
          billing_interval: sub.billing_interval,
          expires_at:       sub.expires_at?.toISOString() ?? null,
        } : null,
      };
    });

    return reply.send({
      success: true,
      data: {
        period,
        offset,
        period_label:   label,
        period_from:    from.toISOString(),
        period_to:      to.toISOString(),
        total_shops:    allShops.length,
        total_branches: branchRows.reduce((a, r) => a + Number(r.count), 0),
        total_users:    userRows.reduce((a, r)   => a + Number(r.count), 0),
        revenue_today:  shopsData.reduce((a, s)  => a + s.revenue_today,  0),
        revenue_period: shopsData.reduce((a, s)  => a + s.revenue_period, 0),
        shops:          shopsData,
        trend:          trendData,
      },
      meta: meta(req),
    });
  });

  // GET /dev/leaderboard?period=day|week|month|year&offset=0&mode=live|snapshot
  app.get<{ Querystring: { period?: string; offset?: string; mode?: string } }>(
    '/leaderboard', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);

      const period = (['day', 'week', 'month', 'year'].includes(req.query.period ?? '')
        ? (req.query.period as PeriodType)
        : 'day');
      const offset = Math.max(0, Number(req.query.offset ?? 0));
      const mode   = req.query.mode === 'snapshot' ? 'snapshot' : 'live';
      const { key, label } = getPeriodRange(period, offset);

      let entries;
      let snapshotAt: string | null = null;

      if (mode === 'snapshot') {
        entries   = await getSnapshot(period, key);
        snapshotAt = entries[0]?.snapshot_at ?? null;
      } else {
        entries = await getLiveLeaderboard(period, offset);
      }

      return reply.send({
        success: true,
        data: { period, offset, mode, key, label, snapshot_at: snapshotAt, entries },
        meta: meta(req),
      });
    },
  );

  // GET /dev/leaderboard/keys?period=day|week|month|year
  app.get<{ Querystring: { period?: string } }>(
    '/leaderboard/keys', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const period = (['day', 'week', 'month', 'year'].includes(req.query.period ?? '')
        ? (req.query.period as PeriodType)
        : 'day');
      const keys = await getAvailablePeriodKeys(period);
      return reply.send({ success: true, data: keys, meta: meta(req) });
    },
  );

  // POST /dev/snapshot — manual trigger (also called automatically by cron at 23:00)
  app.post('/snapshot', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const results = await triggerManualSnapshot();
    return reply.send({ success: true, data: results, meta: meta(req) });
  });

  // POST /dev/snapshot/:period — snapshot single period type
  app.post<{ Params: { period: string } }>(
    '/snapshot/:period', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const period = req.params.period as PeriodType;
      if (!['day', 'week', 'month', 'year'].includes(period)) {
        throw new ValidationError({ period: ['Must be day, week, month, or year'] });
      }
      const result = await takeSnapshotRepo(period);
      return reply.send({ success: true, data: result, meta: meta(req) });
    },
  );

  // ── Notifications ─────────────────────────────────────────────

  const createNotificationSchema = z.object({
    type:    z.string().min(1).max(50).default('custom'),
    title:   z.string().min(1, 'title required').max(200).trim(),
    message: z.string().max(1000).trim().optional(),
  });

  // GET /dev/shops/:shopId/notifications
  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/notifications', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const rows = await db
        .select()
        .from(shopNotifications)
        .where(eq(shopNotifications.shop_id, req.params.shopId))
        .orderBy(desc(shopNotifications.created_at))
        .limit(50);
      return reply.send({ success: true, data: rows, meta: meta(req) });
    },
  );

  // POST /dev/shops/:shopId/notifications
  app.post<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/notifications', { preHandler: [app.auth] }, async (req, reply) => {
      await requireDevAdmin(req);
      const parsed = createNotificationSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
      const { type, title, message } = parsed.data;
      const [row] = await db
        .insert(shopNotifications)
        .values({ shop_id: req.params.shopId, type, title, message: message ?? null })
        .returning();
      return reply.status(201).send({ success: true, data: row, meta: meta(req) });
    },
  );

  // ── GET /dev/analytics ────────────────────────────────────────────────────
  app.get('/analytics', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86_400_000);

    // Total shops count
    const [shopCountRow] = await db.select({ cnt: count() }).from(shops);
    const totalShops = Number(shopCountRow?.cnt ?? 0);

    // All active subscriptions
    const activeSubs = await db
      .select({ shop_id: subscriptionsTable.shop_id, plan: subscriptionsTable.plan, expires_at: subscriptionsTable.expires_at })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.status, 'active'));

    // Expired subs
    const [expiredRow] = await db.select({ cnt: count() }).from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.status, 'active'), lte(subscriptionsTable.expires_at, now)));
    const expiredSubs = Number(expiredRow?.cnt ?? 0);

    // Cancelled subs
    const [cancelledRow] = await db.select({ cnt: count() }).from(subscriptionsTable)
      .where(eq(subscriptionsTable.status, 'cancelled'));
    const cancelledSubs = Number(cancelledRow?.cnt ?? 0);

    // Shops with any sub record
    const [subShopsRow] = await db.select({ cnt: count() }).from(subscriptionsTable);
    const shopsWithSub = Number(subShopsRow?.cnt ?? 0);
    const noSub = totalShops - shopsWithSub;

    // MRR: sum over active subs (not expired)
    let mrr = 0;
    const planCounts: Record<string, { count: number; mrr: number }> = {};
    for (const sub of activeSubs) {
      if (sub.expires_at && sub.expires_at < now) continue; // skip expired
      const priceMon = PLAN_CONFIG[sub.plan as keyof typeof PLAN_CONFIG]?.price_monthly ?? 0;
      mrr += priceMon;
      const entry = planCounts[sub.plan] ?? { count: 0, mrr: 0 };
      entry.count += 1;
      entry.mrr   += priceMon;
      planCounts[sub.plan] = entry;
    }
    const arr = mrr * 12;

    const planDistribution = Object.entries(planCounts).map(([plan, v]) => ({
      plan,
      count: v.count,
      mrr: v.mrr,
    }));

    // Expiring soon: active, expires_at between now and now+30days
    const expiringSoon = await db
      .select({
        shop_id: subscriptionsTable.shop_id,
        shop_name: shops.name,
        plan: subscriptionsTable.plan,
        expires_at: subscriptionsTable.expires_at,
      })
      .from(subscriptionsTable)
      .innerJoin(shops, eq(shops.id, subscriptionsTable.shop_id))
      .where(and(
        eq(subscriptionsTable.status, 'active'),
        gte(subscriptionsTable.expires_at, now),
        lte(subscriptionsTable.expires_at, thirtyDaysFromNow),
      ));

    const expiringSoonWithDays = expiringSoon.map((row) => ({
      ...row,
      days_left: row.expires_at
        ? Math.ceil((row.expires_at.getTime() - Date.now()) / 86_400_000)
        : null,
    }));

    // New shops by month — last 6 months
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const newShopsByMonth = await db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${shops.created_at}), 'YYYY-MM')`,
        cnt: count(),
      })
      .from(shops)
      .where(gte(shops.created_at, sixMonthsAgo))
      .groupBy(sql`date_trunc('month', ${shops.created_at})`)
      .orderBy(sql`date_trunc('month', ${shops.created_at})`);

    return reply.send({
      success: true,
      data: {
        mrr,
        arr,
        total_shops: totalShops,
        active_subs: activeSubs.filter((s) => !s.expires_at || s.expires_at >= now).length,
        expired_subs: expiredSubs,
        cancelled_subs: cancelledSubs,
        no_sub: noSub,
        plan_distribution: planDistribution,
        expiring_soon: expiringSoonWithDays,
        new_shops_by_month: newShopsByMonth.map((r) => ({ month: r.month, count: Number(r.cnt) })),
      },
      meta: meta(req),
    });
  });

  // ── GET /dev/subscriptions-all ────────────────────────────────────────────
  app.get('/subscriptions-all', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);

    const rows = await db
      .select({
        shop_id:          shops.id,
        shop_name:        shops.name,
        shop_code:        shops.shop_code,
        plan:             subscriptionsTable.plan,
        billing_interval: subscriptionsTable.billing_interval,
        status:           subscriptionsTable.status,
        expires_at:       subscriptionsTable.expires_at,
        sub_id:           subscriptionsTable.id,
        is_whitelisted:   subscriptionsTable.is_whitelisted,
      })
      .from(shops)
      .leftJoin(subscriptionsTable, eq(subscriptionsTable.shop_id, shops.id))
      .orderBy(shops.name);

    const data = rows.map((r) => ({
      shop_id:          r.shop_id,
      shop_name:        r.shop_name,
      shop_code:        r.shop_code,
      plan:             r.plan ?? null,
      billing_interval: r.billing_interval ?? null,
      status:           (r.status ?? 'none') as 'active' | 'cancelled' | 'past_due' | 'none',
      expires_at:       r.expires_at ?? null,
      days_left:        r.expires_at ? Math.ceil((r.expires_at.getTime() - Date.now()) / 86_400_000) : null,
      sub_id:           r.sub_id ?? null,
      is_whitelisted:   r.is_whitelisted ?? false,
    }));

    return reply.send({ success: true, data, meta: meta(req) });
  });

  // ── PATCH /dev/subscriptions/:shopId/quick-action ─────────────────────────
  const quickActionSchema = z.object({
    action: z.enum(['activate', 'cancel', 'extend_30', 'extend_365']),
    plan: z.string().optional(),
  });

  app.patch<{ Params: { shopId: string }; Body: unknown }>(
    '/subscriptions/:shopId/quick-action',
    { preHandler: [app.auth] },
    async (req, reply) => {
      await requireDevAdmin(req);
      const parsed = quickActionSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

      const { action, plan } = parsed.data;
      const { shopId } = req.params;

      if (action === 'activate') {
        await subscriptionRepository.upsert(shopId, {
          plan:             plan ?? 'basic',
          billing_interval: 'monthly',
          status:           'active',
          expires_at:       calcExpiresAt('monthly'),
        });
      } else {
        const current = await subscriptionRepository.getByShopId(shopId);
        if (!current) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบ subscription' }, meta: meta(req) });
        }

        if (action === 'cancel') {
          await db.update(subscriptionsTable)
            .set({ status: 'cancelled', updated_at: new Date() })
            .where(eq(subscriptionsTable.shop_id, shopId));
        } else if (action === 'extend_30' || action === 'extend_365') {
          const days = action === 'extend_30' ? 30 : 365;
          const base = current.expires_at && current.expires_at > new Date() ? current.expires_at : new Date();
          const newExpiry = new Date(base.getTime() + days * 86_400_000);
          const updates: Record<string, unknown> = { expires_at: newExpiry, status: 'active', updated_at: new Date() };
          if (plan) updates['plan'] = plan;
          await db.update(subscriptionsTable)
            .set(updates)
            .where(eq(subscriptionsTable.shop_id, shopId));
        }
      }

      return reply.send({ success: true, data: { ok: true }, meta: meta(req) });
    },
  );

  // ── PATCH /dev/subscriptions/:shopId/whitelist ────────────────────────────
  app.patch<{ Params: { shopId: string }; Body: { is_whitelisted: boolean } }>(
    '/subscriptions/:shopId/whitelist',
    { preHandler: [app.auth] },
    async (req, reply) => {
      await requireDevAdmin(req);
      const { shopId } = req.params;
      const { is_whitelisted } = req.body;
      if (typeof is_whitelisted !== 'boolean') {
        return reply.status(400).send({ success: false, error: { message: 'is_whitelisted must be boolean' }, meta: meta(req) });
      }
      // auto-create subscription if none exists
      let sub = await subscriptionRepository.getByShopId(shopId);
      if (!sub) {
        sub = await subscriptionRepository.upsert(shopId, {
          plan: 'pro', billing_interval: 'once', status: 'active',
          expires_at: new Date(Date.now() + 100 * 365 * 86_400_000), // 100 ปี
        });
      }
      const updated = await subscriptionRepository.setWhitelist(shopId, is_whitelisted);
      return reply.send({ success: true, data: updated, meta: meta(req) });
    },
  );

  // ── GET /dev/logs-all ─────────────────────────────────────────────────────
  app.get<{ Querystring: { shopId?: string; action?: string; limit?: string; offset?: string } }>(
    '/logs-all',
    { preHandler: [app.auth] },
    async (req, reply) => {
      await requireDevAdmin(req);
      const { shopId, action: actionFilter, limit: limitStr = '50', offset: offsetStr = '0' } = req.query;
      const limit  = Math.min(200, Math.max(1, parseInt(limitStr,  10) || 50));
      const offset = Math.max(0, parseInt(offsetStr, 10) || 0);

      const conditions = [];
      if (shopId)      conditions.push(eq(logs.shop_id, shopId));
      if (actionFilter) conditions.push(eq(logs.action, actionFilter));

      const rows = await db
        .select({
          id:          logs.id,
          shop_id:     logs.shop_id,
          shop_name:   shops.name,
          action:      logs.action,
          entity_type: logs.entity_type,
          entity_id:   logs.entity_id,
          payload:     logs.payload,
          user_id:     logs.user_id,
          created_at:  logs.created_at,
        })
        .from(logs)
        .innerJoin(shops, eq(shops.id, logs.shop_id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(logs.created_at))
        .limit(limit)
        .offset(offset);

      return reply.send({ success: true, data: rows, meta: meta(req) });
    },
  );

  // POST /dev/reset/request-pin — ขอ PIN รีเซต (dev only)
  // ── GET /dev/settings ───────────────────────────────────────────────────────
  app.get('/settings', { preHandler: [app.auth] }, async (req, reply) => {
    const rows = await db.select().from(appSettings);
    const data = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return reply.send({ success: true, data, meta: meta(req) });
  });

  // ── PUT /dev/settings ───────────────────────────────────────────────────────
  app.put<{ Body: unknown }>('/settings', { preHandler: [app.auth] }, async (req, reply) => {
    const bodySchema = z.record(z.string(), z.string());
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ success: false, error: { message: 'Invalid body' }, meta: meta(req) });
    }
    for (const [key, value] of Object.entries(parse.data)) {
      await db.insert(appSettings)
        .values({ key, value, updated_at: new Date() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updated_at: new Date() } });
    }
    return reply.send({ success: true, data: parse.data, meta: meta(req) });
  });

  app.post('/reset/request-pin', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);
    const pin = String(Math.floor(1000 + Math.random() * 9000)); // 4 digits 1000-9999
    resetPinStore.set('global', { pin, expiresAt: Date.now() + 10 * 60 * 1000 });
    const result = await sendResetPinEmail(pin);
    if (!result.ok) {
      // ลบ PIN ออกถ้าส่งอีเมลไม่สำเร็จ
      resetPinStore.delete('global');
      return reply.status(500).send({
        success: false,
        error:   { code: 'RESET_EMAIL', message: `ส่งอีเมลไม่สำเร็จ: ${result.error ?? 'unknown error'}` },
        meta:    meta(req),
      });
    }
    return reply.send({
      success: true,
      data:    { sent: true, email: RESET_PIN_EMAIL },
      meta:    meta(req),
    });
  });

  // POST /dev/reset/confirm — ยืนยัน PIN แล้วลบข้อมูลทั้งหมด
  app.post<{ Body: unknown }>('/reset/confirm', { preHandler: [app.auth] }, async (req, reply) => {
    await requireDevAdmin(req);

    const body = req.body as { pin?: string };
    const submitted = String(body?.pin ?? '').trim();
    if (!submitted || submitted.length !== 4) {
      return reply.status(400).send({ success: false, error: { code: 'RESET_001', message: 'PIN ต้องเป็น 4 หลัก' }, meta: meta(req) });
    }

    const stored = resetPinStore.get('global');
    if (!stored) {
      return reply.status(400).send({ success: false, error: { code: 'RESET_002', message: 'ยังไม่ได้ขอ PIN หรือ PIN หมดอายุแล้ว' }, meta: meta(req) });
    }
    if (Date.now() > stored.expiresAt) {
      resetPinStore.delete('global');
      return reply.status(400).send({ success: false, error: { code: 'RESET_003', message: 'PIN หมดอายุแล้ว (10 นาที) กรุณาขอใหม่' }, meta: meta(req) });
    }
    if (submitted !== stored.pin) {
      return reply.status(400).send({ success: false, error: { code: 'RESET_004', message: 'PIN ไม่ถูกต้อง' }, meta: meta(req) });
    }

    // PIN ถูกต้อง — ลบข้อมูลทั้งหมดตามลำดับ FK
    resetPinStore.delete('global');
    const counts: Record<string, number> = {};

    await db.transaction(async (tx) => {
      // ลำดับ: child tables ก่อน parent tables
      const del = async (tableName: string, tbl: Parameters<typeof tx.delete>[0]) => {
        const rows = await tx.delete(tbl).returning();
        counts[tableName] = rows.length;
      };
      await del('payment_logs',         paymentLogs);
      await del('stock_transactions',   stockTransactions);
      await del('shop_notifications',   shopNotifications);
      await del('shop_sales_snapshots', shopSalesSnapshots);
      await del('logs',                 logs);
      await del('events',               events);
      await del('combo_items',          comboItems);
      await del('order_items',          orderItems);
      await del('orders',               orders);
      await del('promotions',           promotions);
      await del('combos',               combos);
      await del('branch_stock',         branchStock);
      await del('products',             products);
      await del('shop_units',           shopUnits);
      await del('customers',            customers);
      await del('branches',             branches);
      await del('subscriptions',        subscriptionsTable);
      await del('user_shop_roles',      userShopRoles);
      await del('shops',                shops);
      // ไม่ลบ users (auth accounts)
    });

    const totalDeleted = Object.values(counts).reduce((a, b) => a + b, 0);
    return reply.send({ success: true, data: { totalDeleted, counts }, meta: meta(req) });
  });
};

export { devRoutes };
