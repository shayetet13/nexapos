/**
 * PromptPay auto-verify ต่อร้าน
 *  - ตั้งค่า API key / bot / target / พร้อมเพย์ (owner) — เก็บเข้ารหัส ไม่คืน plaintext
 *  - เลือก Bot/Target จาก API ของแพลตฟอร์ม LINEJS (login LINE ทำที่แดชบอร์ดของแพลตฟอร์ม)
 *  - สร้าง/poll payment (cashier ขึ้นไป) — ทุก query scope ด้วย shop_id จาก path ที่ผ่าน guard แล้ว
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireOwnerShop, requireAdminShop, guardShop } from '../lib/admin-guard.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { meta } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { promptpayVerifyApi, getVerifyBaseUrl, type ExternalPayment } from '../lib/promptpay-verify-api.js';
import { promptpayVerifyRepository, type VerifyConfigRow, type PaymentRow } from '../repositories/promptpay-verify.repository.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const last4  = (v: string) => v.slice(-4);

const TERMINAL = new Set(['succeeded', 'expired', 'cancelled', 'ambiguous']);
const MAX_AMOUNT_BAHT = 1_000_000;

const idByType = {
  phone:       /^0\d{9}$/,
  national_id: /^\d{13}$/,
  ewallet:     /^\d{15}$/,
} as const;

const configSchema = z.object({
  enabled:           z.boolean().optional(),
  api_key:           z.string().regex(/^lbk_[A-Za-z0-9_-]{8,200}$/, 'API key ต้องขึ้นต้นด้วย lbk_').optional(),
  // bot / target ต้องตรงกับที่ API key นี้มองเห็นจริง (ตรวจฝั่งเซิร์ฟเวอร์ตอนบันทึก)
  bot_id:            z.string().trim().min(1).max(100).regex(/^[\w-]+$/).optional(),
  source_target_id:  z.string().trim().min(1).max(100).regex(/^[\w-]+$/).optional(),
  promptpay_id_type: z.enum(['phone', 'national_id', 'ewallet']).optional(),
  promptpay_id:      z.string().trim().regex(/^\d{10,15}$/, 'หมายเลขพร้อมเพย์ไม่ถูกต้อง').optional(),
  destination_last4: z.string().regex(/^\d{4}$/).nullable().optional(),
}).strict();

const botLoginSchema = z.object({
  bot_id: z.string().trim().min(1).max(100).regex(/^[\w-]+$/),
}).strict();

const ERROR_DETAIL_MAX = 200;

const createPaymentSchema = z.object({
  amount: z.number().positive().max(MAX_AMOUNT_BAHT),
}).strict();

function uniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function isReady(c: VerifyConfigRow | null): c is VerifyConfigRow {
  return !!c && c.enabled && !!c.api_key_encrypted && !!c.bot_id && !!c.source_target_id
    && !!c.promptpay_id_type && !!c.promptpay_id_encrypted;
}

function publicConfig(c: VerifyConfigRow | null, apiBaseConfigured: boolean) {
  return {
    api_base_configured: apiBaseConfigured,
    enabled:             c?.enabled ?? false,
    ready:               isReady(c),
    has_api_key:         !!c?.api_key_encrypted,
    api_key_last4:       c?.api_key_last4 ?? null,
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
    payer_name:     p.payer_name,
    transaction_at: p.transaction_at?.toISOString() ?? null,
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

const shopRateKey = (req: FastifyRequest) => `ppv:${(req.params as { shopId: string }).shopId}`;

const promptpayVerifyRoutes: FastifyPluginAsync = async (app) => {
  const base = '/shops/:shopId/promptpay-verify';
  type P = { Params: { shopId: string } };

  // GET config (masked) — owner/manager
  app.get<P>(base, { preHandler: [app.auth] }, async (req, reply) => {
    await requireAdminShop(req);
    const cfg = await promptpayVerifyRepository.getConfig(req.params.shopId);
    return reply.send({ success: true, data: publicConfig(cfg, !!(await getVerifyBaseUrl())), meta: meta(req) });
  });

  // GET status — ทุก role ในร้าน (POS ใช้ตัดสินใจว่าจะใช้ auto-verify หรือไม่)
  app.get<P>(`${base}/status`, { preHandler: [app.auth] }, async (req, reply) => {
    await guardShop(req);
    const cfg = await promptpayVerifyRepository.getConfig(req.params.shopId);
    return reply.send({
      success: true,
      data: { ready: isReady(cfg) && !!(await getVerifyBaseUrl()) },
      meta: meta(req),
    });
  });

  // PUT config — owner
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
    if (d.bot_id !== undefined || d.source_target_id !== undefined) {
      const botId    = d.bot_id ?? current?.bot_id;
      const targetId = d.source_target_id ?? current?.source_target_id;
      const keyPlain = d.api_key ?? (current?.api_key_encrypted ? decrypt(current.api_key_encrypted) : null);
      if (!keyPlain) throw new ValidationError({ bot_id: ['บันทึก API key ก่อนเลือก Bot'] });
      if (!botId || !targetId) throw new ValidationError({ bot_id: ['เลือก Bot และแชทธนาคารพร้อมกัน'] });
      // ยืนยันกับ API ว่า bot/target นี้อยู่ใน key จริง (กันใส่ id มั่ว/ของคนอื่น)
      const options = await promptpayVerifyApi.listBotOptions(keyPlain);
      const bot = options.find((b) => b.id === botId);
      const target = bot?.targets.find((t) => t.id === targetId);
      if (!bot || !target) throw new ValidationError({ bot_id: ['ไม่พบ Bot/แชทนี้ใน API key (ต้องเปิดใช้งานและยืนยัน consent แล้ว)'] });
      patch.bot_id = bot.id;
      patch.bot_name = bot.name;
      patch.source_target_id = target.id;
      patch.source_target_name = target.name;
    }
    if (d.promptpay_id_type !== undefined) patch.promptpay_id_type = d.promptpay_id_type;
    if (d.destination_last4 !== undefined) patch.destination_last4 = d.destination_last4;
    if (d.api_key) {
      patch.api_key_encrypted = encrypt(d.api_key);
      patch.api_key_hash      = sha256(d.api_key);
      patch.api_key_last4     = last4(d.api_key);
    }
    if (d.promptpay_id) patch.promptpay_id_encrypted = encrypt(d.promptpay_id);

    // เปิดใช้งานได้เมื่อตั้งค่าครบเท่านั้น
    if (patch.enabled === true) {
      const merged = { ...current, ...patch } as VerifyConfigRow;
      if (!merged.api_key_encrypted || !merged.bot_id || !merged.source_target_id
          || !merged.promptpay_id_type || !merged.promptpay_id_encrypted) {
        throw new ValidationError({ enabled: ['กรอก API key, Bot ID, Target ID และหมายเลขพร้อมเพย์ให้ครบก่อนเปิดใช้งาน'] });
      }
    }

    let saved: VerifyConfigRow;
    try {
      saved = await promptpayVerifyRepository.upsertConfig(shopId, patch);
    } catch (err) {
      if (uniqueViolation(err)) throw new ConflictError('API key หรือ Bot นี้ถูกใช้กับร้านอื่นแล้ว');
      throw err;
    }

    audit.action({
      ...auditCtx(req, shopId),
      event: 'update_promptpay_verify_config',
      entity_type: 'shop_promptpay_verify',
      entity_id: shopId,
      changes: { fields: Object.keys(d), api_key_rotated: !!d.api_key },
    });
    return reply.send({ success: true, data: publicConfig(saved, !!(await getVerifyBaseUrl())), meta: meta(req) });
  });

  // DELETE config — owner
  app.delete<P>(base, { preHandler: [app.auth] }, async (req, reply) => {
    await requireOwnerShop(req);
    const { shopId } = req.params;
    await promptpayVerifyRepository.deleteConfig(shopId);
    audit.action({ ...auditCtx(req, shopId), event: 'delete_promptpay_verify_config', entity_type: 'shop_promptpay_verify', entity_id: shopId });
    return reply.send({ success: true, data: publicConfig(null, !!(await getVerifyBaseUrl())), meta: meta(req) });
  });

  // รายการ Bot + แชทที่เลือกได้ จาก API key ของร้าน (ต้องมี scope bots:read)
  app.get<P>(`${base}/options`, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const cfg = await promptpayVerifyRepository.getConfig(req.params.shopId);
    const apiKey = cfg?.api_key_encrypted ? decrypt(cfg.api_key_encrypted) : null;
    if (!apiKey) throw new AppError('บันทึก API key ก่อน', 409, 'RES_003');
    const bots = await promptpayVerifyApi.listBotOptions(apiKey);
    return reply.send({ success: true, data: { bots }, meta: meta(req) });
  });

  // ── LINE QR login ของ Bot (ผ่านแพลตฟอร์ม — ต้องมี scope bots:auth) ─────────────

  /** key + ตรวจว่า bot เป็นของ key นี้จริง และไม่ได้ถูกร้านอื่นใช้อยู่ */
  async function resolveBotForLogin(shopId: string, botId: string): Promise<{ apiKey: string }> {
    const cfg = await promptpayVerifyRepository.getConfig(shopId);
    const apiKey = cfg?.api_key_encrypted ? decrypt(cfg.api_key_encrypted) : null;
    if (!apiKey) throw new AppError('บันทึก API key ก่อน', 409, 'RES_003');
    if (await promptpayVerifyRepository.isBotUsedByOtherShop(shopId, botId)) {
      throw new ForbiddenError('Bot นี้ถูกใช้กับร้านอื่นแล้ว');
    }
    const options = await promptpayVerifyApi.listBotOptions(apiKey);
    if (!options.some((b) => b.id === botId)) {
      throw new ValidationError({ bot_id: ['ไม่พบ Bot นี้ใน API key'] });
    }
    return { apiKey };
  }

  app.post<P & { Body: unknown }>(`${base}/bot-login`, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 6, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const { shopId } = req.params;
    const parsed = botLoginSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
    const { apiKey } = await resolveBotForLogin(shopId, parsed.data.bot_id);
    const session = await promptpayVerifyApi.beginBotQr(apiKey, parsed.data.bot_id);
    audit.action({ ...auditCtx(req, shopId), event: 'create_bot_qr_login', entity_type: 'bot', entity_id: parsed.data.bot_id });
    return reply.send({
      success: true,
      data: {
        started_at: Date.now(),
        state: session.pin ? 'waiting_pin' : 'waiting_scan',
        qr_url: session.qrUrl ?? null,
        pin: session.pin ?? null,
        expires_in_seconds: session.expiresInSeconds ?? null,
      },
      meta: meta(req),
    });
  });

  // poll ผล — since = started_at จาก POST (กันอ่านเหตุการณ์เก่า)
  app.get<P & { Querystring: { bot_id?: string; since?: string } }>(`${base}/bot-login`, {
    preHandler: [app.auth],
    config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const { shopId } = req.params;
    const parsed = botLoginSchema.safeParse({ bot_id: req.query.bot_id });
    const since = Number(req.query.since);
    if (!parsed.success || !Number.isFinite(since)) throw new ValidationError({ query: ['bot_id และ since ไม่ถูกต้อง'] });
    const { apiKey } = await resolveBotForLogin(shopId, parsed.data.bot_id);
    const ev = await promptpayVerifyApi.latestBotAuth(apiKey, parsed.data.bot_id);

    // เหตุการณ์ก่อนเริ่มรอบนี้ (เผื่อเวลาเครื่องต่างกันเล็กน้อย) = ของเก่า ไม่นับ
    const fresh = ev && ev.timestamp >= since - 5_000 ? ev : null;
    let data: { state: string; qr_url: string | null; pin: string | null; error: string | null } =
      { state: 'waiting_scan', qr_url: null, pin: null, error: null };
    if (fresh?.type === 'qr')            data = { ...data, state: 'waiting_scan', qr_url: fresh.value ?? null };
    else if (fresh?.type === 'pin')      data = { ...data, state: 'waiting_pin', pin: fresh.value ?? null };
    else if (fresh?.type === 'authenticated') data = { ...data, state: 'success' };
    else if (fresh?.type === 'auth-error')    data = { ...data, state: 'failed', error: (fresh.value ?? 'เข้าสู่ระบบ LINE ไม่สำเร็จ').slice(0, ERROR_DETAIL_MAX) };
    if (data.state === 'success') {
      audit.action({ ...auditCtx(req, shopId), event: 'update_bot_qr_login_success', entity_type: 'bot', entity_id: parsed.data.bot_id });
    }
    return reply.send({ success: true, data, meta: meta(req) });
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

    const apiKey      = decrypt(cfg.api_key_encrypted);
    const promptPayId = decrypt(cfg.promptpay_id_encrypted);
    if (!apiKey || !promptPayId) throw new AppError('ข้อมูลตั้งค่าไม่สมบูรณ์', 409, 'RES_003');

    const satang = Math.round(parsed.data.amount * 100);
    const ext = await promptpayVerifyApi.createPayment(apiKey, {
      botId:           cfg.bot_id!,
      sourceTargetId:  cfg.source_target_id!,
      promptPayIdType: cfg.promptpay_id_type!,
      promptPayId,
      amount:          (satang / 100).toFixed(2),
      ...(cfg.destination_last4 ? { destinationLast4: cfg.destination_last4 } : {}),
    });
    if (ext.amountSatang !== satang) {
      throw new AppError('ยอดเงินจากบริการตรวจสอบไม่ตรงกับที่ร้องขอ', 502, 'SYS_001');
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
    config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: shopRateKey } },
  }, async (req, reply) => {
    await guardShop(req);
    const { shopId, paymentId } = req.params;
    if (!z.string().uuid().safeParse(paymentId).success) throw new NotFoundError('Payment');

    let row = await promptpayVerifyRepository.getPayment(shopId, paymentId);
    if (!row) throw new NotFoundError('Payment');

    if (!TERMINAL.has(row.status)) {
      const cfg = await promptpayVerifyRepository.getConfig(shopId);
      const apiKey = cfg?.api_key_encrypted ? decrypt(cfg.api_key_encrypted) : null;
      if (apiKey) {
        const ext: ExternalPayment = await promptpayVerifyApi.getPayment(apiKey, row.external_id);
        // succeeded ต้องยอดตรงเท่านั้น
        const amountOk = ext.amountSatang === row.amount_satang;
        const status = ext.status === 'succeeded' && !amountOk ? 'ambiguous' : ext.status;
        if (status !== row.status || ext.bank || ext.payerName) {
          row = (await promptpayVerifyRepository.updatePayment(shopId, row.id, {
            status,
            bank:           ext.bank ?? null,
            payer_name:     ext.payerName ?? null,
            transaction_at: ext.transactionAt ? new Date(ext.transactionAt) : null,
          })) ?? row;
          if (status === 'succeeded') {
            audit.action({ ...auditCtx(req, shopId), event: 'update_promptpay_payment_succeeded',
              entity_type: 'promptpay_payment', entity_id: row.id,
              changes: { amount_satang: row.amount_satang, bank: row.bank } });
          }
        }
      }
    }
    return reply.send({ success: true, data: publicPayment(row), meta: meta(req) });
  });
};

export { promptpayVerifyRoutes };
