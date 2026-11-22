/**
 * Client สำหรับ LINEJS platform (services/linebot-platform): /v1/promptpay/payments, /v1/bots
 *
 * - Base URL: ตั้งโดย dev (app_settings) หรือ env — ใช้ร่วมทั้งแพลตฟอร์ม
 * - API key: ตัวเดียวทั้งระบบ อยู่ใน env LINEJS_API_KEY ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยส่งถึง client/ร้านค้า
 *   (key ของ platform เห็น bot/payment ของทุกร้าน — การแยกร้านทำที่ NexaPos: bot ผูกกับร้านโดย dev,
 *   payment ที่อ่าน/ยกเลิกได้ต้องเป็นแถวใน promptpay_payments ของร้านนั้นเท่านั้น)
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { appSettings } from '../db/schema.js';
import { AppError } from './errors.js';

/** key ใน app_settings — ตั้งค่าที่ Dev Dashboard → Settings (ใช้ร่วมทั้งแพลตฟอร์ม) */
export const VERIFY_BASE_URL_KEY = 'linejs_api_base_url';

export const PAYMENT_STATUSES = ['queued', 'pending', 'succeeded', 'ambiguous', 'expired', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const REQUEST_TIMEOUT_MS = 10_000;

/** ISO datetime ที่ใช้ได้จริง หรือ null — ค่าเพี้ยน (Invalid Date) ไม่ทำให้ response ทั้งก้อนใช้ไม่ได้ */
const lenientIso = z.string().nullish().transform((v): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
});

const paymentSchema = z.object({
  id:             z.string().min(1),
  botId:          z.string().min(1),
  status:         z.enum(PAYMENT_STATUSES),
  qrPayload:      z.string().min(1),
  amountSatang:   z.number().int().nonnegative(),
  // ฟิลด์ที่ใช้แสดงผลอย่างเดียวต้อง "ผ่อนปรน": แปลงให้ใช้ได้ ไม่ปฏิเสธทั้ง response — ไม่งั้นรูปแบบที่ต่างไปเล็กน้อย
  // (ธนาคารใหม่ วันที่ที่ platform รุ่นอื่นส่งมา ชื่อยาว) จะทำให้ poll พังตอนเงินเข้าแล้ว และ POS ไม่เห็น succeeded
  bank:           z.string().nullish().transform((v): 'kbank' | 'ktb' | 'scb' | 'other' | null =>
    v === 'kbank' || v === 'ktb' || v === 'scb' ? v : v ? 'other' : null),
  payerName:      z.string().nullish().transform((v) => (v ? v.slice(0, 200) : null)),
  transactionAt:  lenientIso,
  expiresAt:      lenientIso,
  verificationIssue: z.string().nullish(),
});
export type ExternalPayment = z.infer<typeof paymentSchema>;

const botSchema = z.object({
  id:      z.string().min(1),
  name:    z.string(),
  status:  z.string(),
  adapter: z.string(),
  enabled: z.boolean(),
});

const targetSchema = z.object({
  id:                 z.string().min(1),
  name:               z.string(),
  type:               z.string(),
  enabled:            z.boolean(),
  consentConfirmedAt: z.string().nullish(),
});

export interface BotOption {
  id:      string;
  name:    string;
  status:  string;
  targets: { id: string; name: string; type: string }[];
}

export interface CreatePaymentInput {
  botId:               string;
  sourceTargetId:      string;
  promptPayIdType:     'phone' | 'national_id' | 'ewallet';
  promptPayId:         string;
  amount:              string; // บาท เช่น "100.00"
  destinationLast4?:   string;
  expiresInSeconds?:   number;
}

/**
 * ตรวจ + normalize base URL → origin เท่านั้น (ไม่มี path/query/credentials)
 * https เท่านั้น (http อนุญาตเฉพาะ localhost นอก production) — คืน null ถ้าไม่ถูกต้อง
 */
export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.username || url.password) return null;
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:' && process.env.NODE_ENV !== 'production')) {
    return null;
  }
  return url.origin;
}

const CACHE_TTL_MS = 30_000;
let cached: { value: string | null; at: number } | null = null;

export function invalidateBaseUrlCache(): void { cached = null; }

/**
 * base URL จาก env LINEJS_API_BASE_URL (opt-in เท่านั้น — ไม่มีค่าเริ่มต้นแบบ localhost เพราะ NODE_ENV ที่ว่าง
 * จะทำให้ทุกร้านดูเหมือน "พร้อม" ทั้งที่ platform ไม่ได้รัน แล้วบล็อกการชำระด้วย QR)
 */
function envBaseUrl(): string | null {
  const fromEnv = process.env.LINEJS_API_BASE_URL?.trim();
  return fromEnv ? normalizeBaseUrl(fromEnv) : null;
}

/**
 * base URL ที่ใช้งานจริง: env ชนะเสมอ (pin ปลายทางที่ API key ของระบบถูกส่งไป — แก้ผ่าน DB/Dev Dashboard ไม่ได้)
 * ถ้าไม่ได้ตั้ง env ค่อยใช้ค่าที่ dev ตั้งใน DB (null = ยังไม่ตั้งหรือไม่ถูกต้อง)
 */
export async function getVerifyBaseUrl(): Promise<string | null> {
  const pinned = envBaseUrl();
  if (pinned) return pinned;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const [row] = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, VERIFY_BASE_URL_KEY));
  const value = row?.value ? normalizeBaseUrl(row.value) : null;
  cached = { value, at: Date.now() };
  return value;
}

async function baseUrl(): Promise<string> {
  const url = await getVerifyBaseUrl();
  if (!url) throw new AppError('ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINEJS API URL (Dev Dashboard → Settings)', 503, 'SYS_001');
  return url;
}

const PLATFORM_KEY_RE = /^lbk_[A-Za-z0-9_-]{8,200}$/;

/** API key ของ platform จาก env (null = ยังไม่ตั้งหรือรูปแบบไม่ถูกต้อง) */
function platformKey(): string | null {
  const key = process.env.LINEJS_API_KEY?.trim();
  return key && PLATFORM_KEY_RE.test(key) ? key : null;
}

/** platform พร้อมเรียกใช้หรือไม่: มี API key ใน env + base URL ที่ถูกต้อง */
export async function getPlatformStatus(): Promise<{ base_url_configured: boolean; api_key_configured: boolean }> {
  return { base_url_configured: !!(await getVerifyBaseUrl()), api_key_configured: platformKey() !== null };
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  // input = unknown: schema อาจมี transform (ฟิลด์แสดงผลแบบผ่อนปรน) ทำให้ input กับ output คนละชนิด
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const apiKey = platformKey();
  if (!apiKey) throw new AppError('ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINEJS API key ของระบบ (env LINEJS_API_KEY)', 503, 'SYS_001');
  let res: Response;
  try {
    res = await fetch(`${await baseUrl()}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('เชื่อมต่อบริการตรวจสอบ PromptPay ไม่ได้', 502, 'SYS_001');
  }

  const payload = await res.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
  // 401/403 = ปัญหา config ของระบบ (key ถูกเพิกถอน/ขาด scope) ไม่ใช่ input ของผู้ใช้ → 502
  if (res.status === 401) {
    throw new AppError('LINEJS API key ของระบบไม่ถูกต้องหรือถูกเพิกถอน — แจ้งผู้ดูแลระบบ', 502, 'SYS_001');
  }
  if (res.status === 403) {
    // platform บอก scope ที่ขาดในข้อความ เช่น "API key missing required scope: bots:read"
    throw new AppError(payload?.error?.message ?? 'LINEJS API key ของระบบไม่มีสิทธิ์ที่จำเป็น', 502, 'SYS_001');
  }
  if (res.status === 404) {
    throw new AppError('ไม่พบรายการนี้บน platform', 404, 'RES_001');
  }
  if (res.status === 409) {
    // เช่น ยกเลิกรายการที่จบสถานะแล้ว — ให้ caller ตัดสินใจ (ไม่ใช่ความผิดพลาดของบริการ)
    throw new AppError(payload?.error?.message ?? 'รายการนี้ไม่ได้อยู่ในสถานะรอชำระ', 409, 'RES_003');
  }
  if (!res.ok) {
    throw new AppError(`บริการตรวจสอบ PromptPay ตอบกลับผิดพลาด (${res.status})`, 502, 'SYS_001');
  }
  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success) {
    throw new AppError('รูปแบบข้อมูลจากบริการตรวจสอบ PromptPay ไม่ถูกต้อง', 502, 'SYS_001');
  }
  return parsed.data;
}

const MAX_BOTS = 20;

export const promptpayVerifyApi = {
  createPayment: (input: CreatePaymentInput) =>
    call('/v1/promptpay/payments', { method: 'POST', body: input }, paymentSchema),

  getPayment: (externalId: string) =>
    call(`/v1/promptpay/payments/${encodeURIComponent(externalId)}`, { method: 'GET' }, paymentSchema),

  /** ยกเลิกรายการที่ยัง queued/pending (ปล่อย slot ยอดเดิมให้คิวถัดไป) — ต้องการ scope promptpay:write */
  cancelPayment: (externalId: string) =>
    call(`/v1/promptpay/payments/${encodeURIComponent(externalId)}/cancel`, { method: 'POST' }, paymentSchema),

  /**
   * Bot (LINEJS ที่เปิดใช้งาน) + Target (แชทที่ allowlist และยืนยัน consent แล้ว) ทั้งหมดบน platform
   * ⚠️ เห็นของทุกร้าน — ใช้เฉพาะฝั่ง dev (ผูก bot ให้ร้าน) ห้ามส่งให้ owner/ร้านค้า
   * ต้องการ scope bots:read — การ login LINE (สแกน QR) ทำที่แดชบอร์ดของ platform
   */
  async listBotOptions(): Promise<BotOption[]> {
    const bots = await call('/v1/bots', { method: 'GET' }, z.array(botSchema));
    const usable = bots.filter((b) => b.adapter === 'linejs' && b.enabled).slice(0, MAX_BOTS);
    const options = await Promise.all(usable.map(async (bot): Promise<BotOption> => {
      const targets = await call(`/v1/bots/${encodeURIComponent(bot.id)}/targets`, { method: 'GET' }, z.array(targetSchema));
      return {
        id: bot.id,
        name: bot.name,
        status: bot.status,
        targets: targets
          .filter((t) => t.enabled && !!t.consentConfirmedAt)
          .map(({ id, name, type }) => ({ id, name, type }))
          .sort((a, b) => a.name.localeCompare(b.name, 'th')),
      };
    }));
    return options.sort((a, b) => (a.status === 'online' ? 0 : 1) - (b.status === 'online' ? 0 : 1) || a.name.localeCompare(b.name, 'th'));
  },
};
