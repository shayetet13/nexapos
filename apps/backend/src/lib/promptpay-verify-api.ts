/**
 * Client สำหรับ external LINEJS verify API (POST/GET /v1/promptpay/payments)
 * Base URL มาจาก env เดียวทั้งแพลตฟอร์ม; API key เป็นของแต่ละร้าน
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

const envelopeSchema = z.object({ data: paymentSchema });

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

async function call(path: string, apiKey: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<ExternalPayment> {
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

  if (res.status === 401 || res.status === 403) {
    throw new AppError('API key ไม่ถูกต้องหรือไม่มีสิทธิ์ promptpay:write/read', 400, 'VAL_001');
  }
  if (!res.ok) {
    throw new AppError(`บริการตรวจสอบ PromptPay ตอบกลับผิดพลาด (${res.status})`, 502, 'SYS_001');
  }
  const parsed = envelopeSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError('รูปแบบข้อมูลจากบริการตรวจสอบ PromptPay ไม่ถูกต้อง', 502, 'SYS_001');
  }
  return parsed.data.data;
}

export const promptpayVerifyApi = {
  createPayment: (apiKey: string, input: CreatePaymentInput) =>
    call('/v1/promptpay/payments', apiKey, { method: 'POST', body: input }),

  getPayment: (apiKey: string, externalId: string) =>
    call(`/v1/promptpay/payments/${encodeURIComponent(externalId)}`, apiKey, { method: 'GET' }),
};
