/**
 * Client สำหรับ external LINEJS verify API (POST/GET /v1/promptpay/payments)
 * Base URL มาจาก env เดียวทั้งแพลตฟอร์ม; API key เป็นของแต่ละร้าน
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { appSettings } from '../db/schema.js';
import { AppError } from './errors.js';
import { logger } from './audit.js';

/**
 * HTTP status ที่ใช้ตอบเมื่อบริการ LINEJS (upstream) ล้มเหลว
 * ห้ามใช้ 502/504: Cloudflare (api.nexapos.io) แทนที่ response 502/504 จาก origin ด้วยหน้า HTML ของตัวเอง
 * ทำให้ frontend parse JSON ไม่ได้และไม่เห็นสาเหตุจริง — 424 (Failed Dependency) ผ่านไปทั้ง body
 */
export const UPSTREAM_ERROR_STATUS = 424;

/** key ใน app_settings — ตั้งค่าที่ Dev Dashboard → Settings (ใช้ร่วมทั้งแพลตฟอร์ม) */
export const VERIFY_BASE_URL_KEY = 'linejs_api_base_url';

export const PAYMENT_STATUSES = ['queued', 'pending', 'succeeded', 'ambiguous', 'expired', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const REQUEST_TIMEOUT_MS = 10_000;

const paymentSchema = z.object({
  id:             z.string().min(1),
  status:         z.enum(PAYMENT_STATUSES),
  qrPayload:      z.string().min(1),
  amountSatang:   z.number().int().nonnegative(),
  bank:           z.enum(['kbank', 'ktb', 'scb']).nullish(),
  payerName:      z.string().nullish(),
  transactionAt:  z.string().nullish(),
  expiresAt:      z.string().nullish(),
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

/** base URL ที่ dev ตั้งไว้ (null = ยังไม่ตั้งหรือไม่ถูกต้อง) */
export async function getVerifyBaseUrl(): Promise<string | null> {
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

async function call<T>(
  path: string,
  apiKey: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  schema: z.ZodType<T>,
): Promise<T> {
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
    // ไม่ log URL เต็ม/คีย์ — เอาแค่ path + สาเหตุ (timeout / DNS / TLS / redirect)
    logger.error({ err: String(err), path, method: init.method }, '[promptpay-verify] upstream unreachable');
    throw new AppError('เชื่อมต่อบริการตรวจสอบ PromptPay ไม่ได้ (ตรวจ LINEJS API URL ที่ Dev Dashboard → Settings)', UPSTREAM_ERROR_STATUS, 'SYS_001');
  }

  const payload = await res.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
  if (res.status === 401) {
    throw new AppError('API key ไม่ถูกต้องหรือถูกเพิกถอน', 400, 'VAL_001');
  }
  if (res.status === 403) {
    // แพลตฟอร์มบอก scope ที่ขาดในข้อความ เช่น "API key missing required scope: bots:read"
    throw new AppError(payload?.error?.message ?? 'API key ไม่มีสิทธิ์ที่จำเป็น', 400, 'VAL_001');
  }
  if (!res.ok) {
    // ข้อความจาก upstream (เช่น "bot is offline") ช่วยให้รู้สาเหตุจริง — จำกัดความยาว ไม่ส่งคีย์
    const upstreamMsg = typeof payload?.error?.message === 'string' ? payload.error.message.slice(0, 160) : '';
    logger.error({ path, method: init.method, status: res.status, upstreamMsg }, '[promptpay-verify] upstream returned error');
    throw new AppError(
      `บริการตรวจสอบ PromptPay ตอบกลับผิดพลาด (${res.status})${upstreamMsg ? `: ${upstreamMsg}` : ''}`,
      UPSTREAM_ERROR_STATUS, 'SYS_001',
    );
  }
  const parsed = schema.safeParse(payload?.data);
  if (!parsed.success) {
    logger.error({ path, method: init.method, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      '[promptpay-verify] upstream response shape mismatch');
    throw new AppError('รูปแบบข้อมูลจากบริการตรวจสอบ PromptPay ไม่ถูกต้อง', UPSTREAM_ERROR_STATUS, 'SYS_001');
  }
  return parsed.data;
}

const MAX_BOTS = 20;

export const promptpayVerifyApi = {
  createPayment: (apiKey: string, input: CreatePaymentInput) =>
    call('/v1/promptpay/payments', apiKey, { method: 'POST', body: input }, paymentSchema),

  getPayment: (apiKey: string, externalId: string) =>
    call(`/v1/promptpay/payments/${encodeURIComponent(externalId)}`, apiKey, { method: 'GET' }, paymentSchema),

  /**
   * Bot (LINEJS ที่เปิดใช้งาน) + Target (แชทที่ allowlist และยืนยัน consent แล้ว) ที่ API key นี้มองเห็น
   * ต้องการ scope bots:read — การ login LINE (สแกน QR) ทำที่แดชบอร์ดของบริการ ไม่ผ่าน API key
   */
  async listBotOptions(apiKey: string): Promise<BotOption[]> {
    const bots = await call('/v1/bots', apiKey, { method: 'GET' }, z.array(botSchema));
    const usable = bots.filter((b) => b.adapter === 'linejs' && b.enabled).slice(0, MAX_BOTS);
    const options = await Promise.all(usable.map(async (bot): Promise<BotOption> => {
      const targets = await call(`/v1/bots/${encodeURIComponent(bot.id)}/targets`, apiKey, { method: 'GET' }, z.array(targetSchema));
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
