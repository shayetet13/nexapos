/**
 * PromptPay auto-verify ต่อร้าน
 *  - owner ตั้งเฉพาะพร้อมเพย์ที่รับเงิน + เปิด/ปิดใช้งาน — เก็บเข้ารหัส ไม่คืน plaintext
 *  - Bot/แชทธนาคารถูกผูกโดย dev (routes/dev-promptpay-verify.ts) เพราะ API key ของ platform
 *    (env LINEJS_API_KEY) เห็น bot/payment ของทุกร้าน — owner จึงเห็นเฉพาะ bot ที่ถูกผูกกับร้านตัวเอง
 *  - สร้าง/poll/cancel payment (cashier ขึ้นไป) — ทุก query scope ด้วย shop_id จาก path ที่ผ่าน guard แล้ว
 *    และอ่าน/ยกเลิกได้เฉพาะ payment ที่ร้านนี้สร้างเอง (แถวใน promptpay_payments)
 */
import { z } from 'zod';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireOwnerShop, requireAdminShop, guardShop } from '../lib/admin-guard.js';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { meta } from '../lib/response.js';
import { audit, logger } from '../lib/audit.js';
import { verifyPromptPayPayload } from '../lib/promptpay-qr.js';
import { promptpayVerifyApi, getPlatformStatus, type ExternalPayment } from '../lib/promptpay-verify-api.js';
import {
  ABANDONED_PENDING_MS, STALE_PENDING_MS, TERMINAL_STATUSES as TERMINAL, isVerifyReady as isReady, platformReady, resolveRange, settleStatus,
} from '../lib/promptpay-verify-logic.js';
import { promptpayVerifyRepository, type VerifyConfigRow, type PaymentRow } from '../repositories/promptpay-verify.repository.js';
import { bkkDayStart, bkkMonthStart, bkkYearStart } from '../lib/bkk-time.js';

const last4  = (v: string) => v.slice(-4);

const MAX_AMOUNT_BAHT = 1_000_000;
const MAX_RECONCILE_PER_REQUEST = 10;

const idByType = {
  phone:       /^0\d{9}$/,
  national_id: /^\d{13}$/,
  ewallet:     /^\d{15}$/,
} as const;

// .strict(): client เก่าที่ยังส่ง api_key / bot_id / source_target_id จะได้ 400 ชัดเจน (ไม่ถูกเมินเงียบ ๆ)
const configSchema = z.object({
  enabled:           z.boolean().optional(),
  promptpay_id_type: z.enum(['phone', 'national_id', 'ewallet']).optional(),
  promptpay_id:      z.string().trim().regex(/^\d{10,15}$/, 'หมายเลขพร้อมเพย์ไม่ถูกต้อง').optional(),
  destination_last4: z.string().regex(/^\d{4}$/).nullable().optional(),
}).strict();

// ทศนิยมไม่เกิน 2 ตำแหน่ง — ไม่ปัดเศษเงียบ ๆ (ยอดใน QR ต้องเท่ากับที่แคชเชียร์เห็น)
const createPaymentSchema = z.object({
  amount: z.number().positive().max(MAX_AMOUNT_BAHT)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'ยอดเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง'),
}).strict();

// from/to = วันที่ตามเวลาไทย (YYYY-MM-DD, รวมวัน to) — ไม่ส่ง = วันนี้ (ตรวจช่วงใน resolveRange)
const rangeQuerySchema = z.object({
  from: z.string().optional(),
  to:   z.string().optional(),
}).strict();

const historyQuerySchema = rangeQuerySchema.extend({
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

type PlatformStatus = Awaited<ReturnType<typeof getPlatformStatus>>;

function publicConfig(c: VerifyConfigRow | null, platform: PlatformStatus) {
  return {
    api_base_configured: platform.base_url_configured,
    api_key_configured:  platform.api_key_configured,
    enabled:             c?.enabled ?? false,
    ready:               isReady(c) && platformReady(platform),
    bot_id:              c?.bot_id ?? null,
    bot_name:            c?.bot_name ?? null,
    source_target_id:    c?.source_target_id ?? null,
    source_target_name:  c?.source_target_name ?? null,
    promptpay_id_type:   c?.promptpay_id_type ?? null,
    promptpay_id_last4:  c?.promptpay_id_encrypted ? last4(decrypt(c.promptpay_id_encrypted) ?? '') : null,
    destination_last4:   c?.destination_last4 ?? null,
  };
}

function publicPayment(p: PaymentRow) {
  return {
    id:             p.id,
    status:         p.status,
    amount_satang:  p.amount_satang,
    // ห้ามแสดง QR ตอน queued — ยังจ่ายไม่ได้จริง
    qr_payload:     p.status === 'pending' ? p.qr_payload : null,
    bank:           p.bank,
    // ไม่ส่ง payer_name ในเส้นทาง POS (cashier/viewer ไม่ต้องใช้) — ดูได้เฉพาะ owner/manager ในประวัติ
    transaction_at: p.transaction_at?.toISOString() ?? null,
    expires_at:     p.expires_at?.toISOString() ?? null,
  };
}

/** แถวประวัติ (ไม่มี qr_payload — ไม่จำเป็นหลังจบรายการ) */
function publicHistoryPayment(p: PaymentRow) {
  return {
    id:             p.id,
    status:         p.status,
    amount_satang:  p.amount_satang,
    bank:           p.bank,
    payer_name:     p.payer_name,
    transaction_at: p.transaction_at?.toISOString() ?? null,
    created_at:     p.created_at.toISOString(),
    expires_at:     p.expires_at?.toISOString() ?? null,
  };
}

function auditCtx(req: FastifyRequest, shopId: string) {
  return {
    request_id: req.id,
    shop_id:    shopId,
    user_id:    req.auth?.userId ?? null,
    ip_address: req.ip,
    role:       (req as FastifyRequest & { shopRole?: string }).shopRole ?? null,
  };
}

// rate limit ทำงานก่อน auth — key ด้วย shop + IP เพื่อไม่ให้คนนอกที่รู้แค่ shopId ใช้โควตาของร้านจนหมด
const shopRateKey = (req: FastifyRequest) => `ppv:${(req.params as { shopId: string }).shopId}:${req.ip}`;

type StatusSource = 'poll' | 'cancel' | 'reconcile';

const promptpayVerifyRoutes: FastifyPluginAsync = async (app) => {
  const base = '/shops/:shopId/promptpay-verify';
  type P = { Params: { shopId: string } };

  const boundBotId = async (shopId: string): Promise<string | null> =>
    (await promptpayVerifyRepository.getConfig(shopId))?.bot_id ?? null;

  /**
   * ซิงก์สถานะจาก platform ลง DB แบบ compare-and-set (poll / cancel / reconcile ที่ซ้อนกันไม่เขียนทับและไม่ audit ซ้ำ)
   * ค่า bank/payer/transaction_at เดิมไม่ถูกเขียนทับด้วย null เมื่อ platform ไม่ส่งมา
   */
  const applyExternal = async (
    req: FastifyRequest, shopId: string, row: PaymentRow, ext: ExternalPayment, source: StatusSource,
    /** bot ที่ผูกกับร้านตอนนี้ — เรียกเฉพาะตอนจะเขียน DB (poll ที่ไม่มีอะไรเปลี่ยนไม่ต้องเสีย query) */
    expectedBot: () => Promise<string | null>,
  ): Promise<PaymentRow> => {
    // key ของ platform ใช้ร่วมกันทุกร้าน — ต้องเป็นรายการเดียวกับที่ถามถึง และเป็นของ bot ที่ผูกกับร้านนี้เท่านั้น
    // (ไม่ตรง = ไม่แตะ DB; ไม่ยกเลิกอะไรบน platform เพราะอาจเป็นรายการของร้านอื่น)
    const mismatch = (): never => {
      logger.warn({ shop_id: shopId, payment_id: row.id, source }, 'promptpay verify: platform response does not match this shop');
      throw new AppError('ข้อมูลจากบริการตรวจสอบไม่ตรงกับรายการของร้านนี้ (อาจเปลี่ยน Bot ระหว่างชำระ) — สร้าง QR ใหม่', 502, 'SYS_001');
    };
    if (ext.id !== row.external_id) mismatch();
    const status = settleStatus(row.amount_satang, ext);
    const bank   = ext.bank ?? row.bank;
    const payer  = ext.payerName ?? row.payer_name;
    const txAt   = ext.transactionAt ? new Date(ext.transactionAt) : row.transaction_at;
    const unchanged = status === row.status && bank === row.bank && payer === row.payer_name
      && txAt?.getTime() === row.transaction_at?.getTime();
    if (unchanged) return row;

    const botId = await expectedBot();
    if (botId !== null && ext.botId !== botId) mismatch();

    const updated = await promptpayVerifyRepository.updatePayment(
      shopId, row.id,
      // จบสถานะแล้ว QR (มีเลขพร้อมเพย์เต็ม) ไม่จำเป็นอีก → ไม่เก็บค้างเป็น plaintext
      { status, bank, payer_name: payer, transaction_at: txAt, ...(TERMINAL.has(status) ? { qr_payload: '' } : {}) },
      row.status,
    );
    // null = มีคำขออื่นเปลี่ยนสถานะไปก่อนแล้ว → ใช้ค่าล่าสุดใน DB และไม่ audit ซ้ำ
    if (!updated) return (await promptpayVerifyRepository.getPayment(shopId, row.id)) ?? row;

    if (status !== row.status) {
      audit.action({ ...auditCtx(req, shopId),
        event: status === 'succeeded' ? 'update_promptpay_payment_succeeded' : `promptpay_payment_${status}`,
        entity_type: 'promptpay_payment', entity_id: updated.id,
        changes: { from_status: row.status, to_status: status, source, amount_satang: updated.amount_satang, bank: updated.bank } });
    }
    return updated;
  };

  /**
   * รายการที่ค้าง queued/pending หลังผู้ใช้ปิดหน้าจอ (ไม่มีใคร poll) จะไม่เคยถูกอัปเดต → ยอด/ประวัติตกหล่น
   * ก่อนแสดงประวัติ/สถิติ จึงซิงก์รายการที่เก่ากว่า STALE_PENDING_MS กับ platform (ร้านละ 1 รอบพร้อมกัน)
   */
  const reconciling = new Map<string, Promise<void>>();
  const reconcileStale = (req: FastifyRequest, shopId: string): Promise<void> => {
    const running = reconciling.get(shopId);
    if (running) return running;
    const task = (async () => {
      if (!platformReady(await getPlatformStatus())) return;
      const expectedBotId = await boundBotId(shopId);
      const stale = await promptpayVerifyRepository.listStalePending(
        shopId, new Date(Date.now() - STALE_PENDING_MS), MAX_RECONCILE_PER_REQUEST,
      );
      await Promise.allSettled(stale.map(async (row) => {
        try {
          await applyExternal(req, shopId, row, await promptpayVerifyApi.getPayment(row.external_id), 'reconcile', async () => expectedBotId);
        } catch (err) {
          logger.warn({ shop_id: shopId, payment_id: row.id, err: err instanceof Error ? err.message : String(err) },
            'promptpay verify: reconcile failed');
          // ปิดเป็น expired ฝั่งเราเฉพาะกรณี platform ยืนยันว่า "ไม่รู้จักรายการนี้" (404) และผ่านมานานแล้วเท่านั้น
          // error อื่น (key ผิด/5xx/เครือข่าย) อาจเป็นแค่ชั่วคราว — ห้ามปิด เพราะ platform อาจยังจับเงินเข้าได้
          const notFound = err instanceof AppError && err.statusCode === 404;
          if (!notFound || Date.now() - row.created_at.getTime() <= ABANDONED_PENDING_MS) return;
          const closed = await promptpayVerifyRepository.updatePayment(shopId, row.id, { status: 'expired', qr_payload: '' }, row.status);
          if (closed) {
            audit.action({ ...auditCtx(req, shopId), event: 'promptpay_payment_expired',
              entity_type: 'promptpay_payment', entity_id: row.id,
              changes: { from_status: row.status, to_status: 'expired', source: 'reconcile_abandoned' } });
          }
        }
      }));
    })().finally(() => reconciling.delete(shopId));
    reconciling.set(shopId, task);
    return task;
  };

  // GET config (masked) — owner/manager
  app.get<P>(base, { preHandler: [app.auth] }, async (req, reply) => {
    await requireAdminShop(req);
    const cfg = await promptpayVerifyRepository.getConfig(req.params.shopId);
    return reply.send({ success: true, data: publicConfig(cfg, await getPlatformStatus()), meta: meta(req) });
  });

  // GET status — ทุก role ในร้าน (POS ใช้ตัดสินใจว่าจะใช้ auto-verify หรือไม่)
  app.get<P>(`${base}/status`, { preHandler: [app.auth] }, async (req, reply) => {
    await guardShop(req);
    const cfg = await promptpayVerifyRepository.getConfig(req.params.shopId);
    return reply.send({
      success: true,
      data: { ready: isReady(cfg) && platformReady(await getPlatformStatus()), enabled: cfg?.enabled === true },
      meta: meta(req),
    });
  });

  // PUT config — owner (เฉพาะพร้อมเพย์/เปิด-ปิด; การผูก Bot เป็นของ dev)
  app.put<P & { Body: unknown }>(base, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const { shopId } = req.params;
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
    const d = parsed.data;

    const current = await promptpayVerifyRepository.getConfig(shopId);
    const type = d.promptpay_id_type ?? current?.promptpay_id_type ?? null;
    if (d.promptpay_id) {
      if (!type || !idByType[type].test(d.promptpay_id)) {
        throw new ValidationError({ promptpay_id: ['รูปแบบหมายเลขไม่ตรงกับประเภทที่เลือก'] });
      }
    }

    const patch: Parameters<typeof promptpayVerifyRepository.upsertConfig>[1] = {};
    if (d.enabled           !== undefined) patch.enabled           = d.enabled;
    if (d.promptpay_id_type !== undefined) patch.promptpay_id_type = d.promptpay_id_type;
    if (d.destination_last4 !== undefined) patch.destination_last4 = d.destination_last4;
    if (d.promptpay_id) patch.promptpay_id_encrypted = encrypt(d.promptpay_id);

    // เปิดใช้งานได้เมื่อ dev ผูก Bot แล้ว และตั้งพร้อมเพย์ครบเท่านั้น
    if (patch.enabled === true) {
      const merged = { ...current, ...patch } as VerifyConfigRow;
      if (!merged.bot_id || !merged.source_target_id) {
        throw new ValidationError({ enabled: ['ร้านนี้ยังไม่ได้ผูก Bot ตรวจสอบเงินเข้า — ติดต่อผู้ดูแลระบบ'] });
      }
      if (!merged.promptpay_id_type || !merged.promptpay_id_encrypted) {
        throw new ValidationError({ enabled: ['กรอกประเภทและหมายเลขพร้อมเพย์ให้ครบก่อนเปิดใช้งาน'] });
      }
    }

    const saved = await promptpayVerifyRepository.upsertConfig(shopId, patch);

    audit.action({
      ...auditCtx(req, shopId),
      event: 'update_promptpay_verify_config',
      entity_type: 'shop_promptpay_verify',
      entity_id: shopId,
      changes: { fields: Object.keys(d) },
    });
    return reply.send({ success: true, data: publicConfig(saved, await getPlatformStatus()), meta: meta(req) });
  });

  // DELETE — owner ล้างพร้อมเพย์ที่ตั้งไว้ + ปิดใช้งาน (การผูก Bot ของ dev คงเดิม)
  app.delete<P>(base, { preHandler: [app.auth] }, async (req, reply) => {
    await requireOwnerShop(req);
    const { shopId } = req.params;
    await promptpayVerifyRepository.clearOwnerFields(shopId);
    audit.action({ ...auditCtx(req, shopId), event: 'clear_promptpay_verify_config', entity_type: 'shop_promptpay_verify', entity_id: shopId });
    const cfg = await promptpayVerifyRepository.getConfig(shopId);
    return reply.send({ success: true, data: publicConfig(cfg, await getPlatformStatus()), meta: meta(req) });
  });

  // ── Payments ───────────────────────────────────────────────────────────────

  // POST create payment — cashier ขึ้นไป (viewer ห้าม)
  app.post<P & { Body: unknown }>(`${base}/payments`, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await guardShop(req);
    if ((req as FastifyRequest & { shopRole?: string }).shopRole === 'viewer') {
      throw new ForbiddenError('Viewer cannot create payments');
    }
    const { shopId } = req.params;
    const parsed = createPaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const cfg = await promptpayVerifyRepository.getConfig(shopId);
    if (!isReady(cfg)) throw new AppError('ร้านนี้ยังไม่ได้ตั้งค่าตรวจสอบ PromptPay อัตโนมัติ', 409, 'RES_003');

    const promptPayId = decrypt(cfg.promptpay_id_encrypted!);
    if (!promptPayId) throw new AppError('ข้อมูลตั้งค่าไม่สมบูรณ์', 409, 'RES_003');

    const satang = Math.round(parsed.data.amount * 100);
    const ext = await promptpayVerifyApi.createPayment({
      botId:           cfg.bot_id!,
      sourceTargetId:  cfg.source_target_id!,
      promptPayIdType: cfg.promptpay_id_type!,
      promptPayId,
      amount:          (satang / 100).toFixed(2),
      ...(cfg.destination_last4 ? { destinationLast4: cfg.destination_last4 } : {}),
    });
    // ไม่เชื่อ response ของ platform ตรง ๆ (key ใช้ร่วมกันทุกร้าน และ QR พาลูกค้าไปจ่ายเงิน):
    //  1) เป็นรายการของ bot ที่ผูกกับร้านนี้  2) ยอดตรง  3) QR จ่ายเข้าพร้อมเพย์ของร้านนี้ ยอดนี้ และ CRC ถูกต้อง
    const sameBot = ext.botId === cfg.bot_id;
    const qrOk = verifyPromptPayPayload(ext.qrPayload, {
      type: cfg.promptpay_id_type!, promptPayId, amountSatang: satang,
    });
    if (!sameBot || ext.amountSatang !== satang || !qrOk) {
      logger.error({ shop_id: shopId, same_bot: sameBot, amount_ok: ext.amountSatang === satang, qr_ok: qrOk },
        'promptpay verify: platform returned a payment that does not match the request');
      // ยกเลิกเฉพาะเมื่อเป็น bot ของร้านนี้ — ถ้า bot ไม่ตรง รายการนั้นอาจเป็นของร้านอื่น ห้ามแตะ
      if (sameBot) await promptpayVerifyApi.cancelPayment(ext.id).catch(() => undefined);
      throw new AppError('ข้อมูลจากบริการตรวจสอบไม่ตรงกับที่ร้องขอ', 502, 'SYS_001');
    }

    const row = await promptpayVerifyRepository.insertPayment({
      shop_id:       shopId,
      external_id:   ext.id,
      amount_satang: satang,
      status:        ext.status,
      qr_payload:    ext.qrPayload,
      expires_at:    ext.expiresAt ? new Date(ext.expiresAt) : null,
      created_by:    req.auth!.userId,
    });
    audit.action({
      ...auditCtx(req, shopId),
      event: 'create_promptpay_payment', entity_type: 'promptpay_payment', entity_id: row.id,
      changes: { amount_satang: satang, status: row.status },
    });
    return reply.status(201).send({ success: true, data: publicPayment(row), meta: meta(req) });
  });

  // GET payment (poll) — scoped shop_id
  app.get<{ Params: { shopId: string; paymentId: string } }>(`${base}/payments/:paymentId`, {
    preHandler: [app.auth],
    // POS poll ทุก ~0.5 วินาที (~80/นาที ต่อหน้าจอ) — เผื่อหลายเครื่องหลัง IP เดียวกัน
    config: { rateLimit: { max: 400, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    const { shopId, paymentId } = req.params;
    if (!z.string().uuid().safeParse(paymentId).success) throw new NotFoundError('Payment');

    // เช็คสิทธิ์กับอ่านแถวพร้อมกัน (poll ยิงถี่ ทุก round trip ไป DB นับ) — ผลของแถวใช้ก็ต่อเมื่อผ่านสิทธิ์แล้วเท่านั้น
    const [, found] = await Promise.all([
      guardShop(req),
      promptpayVerifyRepository.getPayment(shopId, paymentId),
    ]);
    let row = found;
    if (!row) throw new NotFoundError('Payment');

    if (!TERMINAL.has(row.status)) {
      const ext = await promptpayVerifyApi.getPayment(row.external_id);
      row = await applyExternal(req, shopId, row, ext, 'poll', () => boundBotId(shopId));
    }
    return reply.send({ success: true, data: publicPayment(row), meta: meta(req) });
  });

  // POST cancel — ผู้สร้างรายการ (หรือ owner/manager): ปล่อย slot ยอดเดิมที่ platform (ปิด modal / สร้าง QR ใหม่) — idempotent
  // คืนสถานะจริงเสมอ: ถ้า platform รับเงินไปก่อนแล้ว จะได้ status = succeeded กลับมา (client ต้องแจ้งผู้ใช้)
  app.post<{ Params: { shopId: string; paymentId: string } }>(`${base}/payments/:paymentId/cancel`, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await guardShop(req);
    const role = (req as FastifyRequest & { shopRole?: string }).shopRole;
    if (role === 'viewer') throw new ForbiddenError('Viewer cannot cancel payments');
    const { shopId, paymentId } = req.params;
    if (!z.string().uuid().safeParse(paymentId).success) throw new NotFoundError('Payment');

    let row = await promptpayVerifyRepository.getPayment(shopId, paymentId);
    if (!row) throw new NotFoundError('Payment');
    if (role !== 'owner' && role !== 'manager' && row.created_by !== req.auth!.userId) {
      throw new ForbiddenError('Only the cashier who created this payment (or an owner/manager) can cancel it');
    }

    if (!TERMINAL.has(row.status)) {
      let ext: ExternalPayment;
      try {
        ext = await promptpayVerifyApi.cancelPayment(row.external_id);
      } catch (err) {
        // 409 = ไม่ใช่ queued/pending แล้ว (เช่น เพิ่งจ่ายสำเร็จ/หมดอายุ) → ใช้สถานะจริงจาก platform
        if (!(err instanceof AppError && err.statusCode === 409)) throw err;
        ext = await promptpayVerifyApi.getPayment(row.external_id);
      }
      row = await applyExternal(req, shopId, row, ext, 'cancel', () => boundBotId(shopId));
    }
    return reply.send({ success: true, data: publicPayment(row), meta: meta(req) });
  });

  // ── History & stats (owner/manager) — scoped shop_id ───────────────────────

  app.get<P & { Querystring: unknown }>(`${base}/payments`, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await requireAdminShop(req);
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
    const { limit, offset, ...q } = parsed.data;
    const range = resolveRange(q);
    await reconcileStale(req, req.params.shopId);
    const { rows, total } = await promptpayVerifyRepository.listPayments(req.params.shopId, range, limit, offset);
    return reply.send({
      success: true,
      data: rows.map(publicHistoryPayment),
      meta: { ...meta(req), total, limit, offset },
    });
  });

  app.get<P & { Querystring: unknown }>(`${base}/stats`, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await requireAdminShop(req);
    const parsed = rangeQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
    const { shopId } = req.params;
    const range = resolveRange(parsed.data);
    await reconcileStale(req, shopId);
    const [day, month, year, banks] = await Promise.all([
      promptpayVerifyRepository.totalsSince(shopId, bkkDayStart()),
      promptpayVerifyRepository.totalsSince(shopId, bkkMonthStart()),
      promptpayVerifyRepository.totalsSince(shopId, bkkYearStart()),
      promptpayVerifyRepository.bankBreakdown(shopId, range),
    ]);
    return reply.send({
      success: true,
      data: { totals: { day, month, year }, banks, range: { from: range.from.toISOString(), to: range.to.toISOString() } },
      meta: meta(req),
    });
  });
};

export { promptpayVerifyRoutes };
