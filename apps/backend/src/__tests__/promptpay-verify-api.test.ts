/**
 * Unit tests for lib/promptpay-verify-api.ts — client of the LINEJS platform
 * (services/linebot-platform). `db` and global `fetch` are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbRows: { value: string }[] = [];

vi.mock('../db/index.js', () => {
  const chain = {
    from:  vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(dbRows)),
  };
  return { db: { select: vi.fn(() => chain) } };
});
vi.mock('../db/schema.js', () => ({ appSettings: { key: 'key', value: 'value' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((a, b) => ({ op: 'eq', a, b })) }));

import { AppError } from '../lib/errors.js';
import {
  promptpayVerifyApi,
  getVerifyBaseUrl,
  getPlatformStatus,
  invalidateBaseUrlCache,
  normalizeBaseUrl,
} from '../lib/promptpay-verify-api.js';

const BASE = 'http://localhost:8787';
const KEY = 'lbk_platformkey1234';

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay_1',
    botId: 'bot_1',
    status: 'succeeded',
    qrPayload: '000201...',
    amountSatang: 10_000,
    bank: 'kbank',
    payerName: null,
    transactionAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:02:00.000Z',
    verificationIssue: null,
    ...overrides,
  };
}

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('promptpay-verify-api', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    dbRows.length = 0;
    invalidateBaseUrlCache();
    process.env.NODE_ENV = 'development';
    process.env.LINEJS_API_BASE_URL = BASE;
    process.env.LINEJS_API_KEY = KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  describe('platform API key (server-side env only)', () => {
    it('sends the system key as Bearer on every call', async () => {
      const fetchMock = mockFetchOnce(200, { data: payment() });
      await promptpayVerifyApi.getPayment('pay_1');
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    });

    it('fails with 503 and never calls the platform when LINEJS_API_KEY is missing', async () => {
      delete process.env.LINEJS_API_KEY;
      const fetchMock = mockFetchOnce(200, { data: payment() });
      await expect(promptpayVerifyApi.getPayment('pay_1')).rejects.toMatchObject({ statusCode: 503 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a malformed key instead of sending it', async () => {
      process.env.LINEJS_API_KEY = 'not-a-platform-key';
      const fetchMock = mockFetchOnce(200, { data: payment() });
      await expect(promptpayVerifyApi.getPayment('pay_1')).rejects.toMatchObject({ statusCode: 503 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats platform 401/403 as a system config problem (502), not user input', async () => {
      mockFetchOnce(401, { error: { message: 'bad key' } });
      await expect(promptpayVerifyApi.getPayment('pay_1')).rejects.toMatchObject({ statusCode: 502 });
      mockFetchOnce(403, { error: { message: 'API key missing required scope: bots:read' } });
      await expect(promptpayVerifyApi.listBotOptions()).rejects.toMatchObject({
        statusCode: 502, message: 'API key missing required scope: bots:read',
      });
    });

    it('getPlatformStatus reports whether base URL and key are configured', async () => {
      expect(await getPlatformStatus()).toEqual({ base_url_configured: true, api_key_configured: true });
      delete process.env.LINEJS_API_KEY;
      invalidateBaseUrlCache();
      delete process.env.LINEJS_API_BASE_URL;
      expect(await getPlatformStatus()).toEqual({ base_url_configured: false, api_key_configured: false });
    });
  });

  describe('getPayment — response validation', () => {
    it.each(['kbank', 'ktb', 'scb', 'other'])('accepts bank "%s"', async (bank) => {
      mockFetchOnce(200, { data: payment({ bank }) });
      const res = await promptpayVerifyApi.getPayment('pay_1');
      expect(res.bank).toBe(bank);
    });

    // ฟิลด์แสดงผลต้องไม่ทำให้ "เงินเข้าแล้ว" กลายเป็น error — ถ้า parse พังตอน succeeded POS จะไม่เห็นสถานะสำเร็จ
    it('maps a bank code the platform adds later to "other" instead of failing the payment', async () => {
      mockFetchOnce(200, { data: payment({ bank: 'bbl' }) });
      expect((await promptpayVerifyApi.getPayment('pay_1')).bank).toBe('other');
    });

    it('turns a malformed timestamp into null (never Invalid Date) and keeps the payment usable', async () => {
      mockFetchOnce(200, { data: payment({ status: 'succeeded', transactionAt: 'yesterday', expiresAt: '22/11/2569 10:30' }) });
      const res = await promptpayVerifyApi.getPayment('pay_1');
      expect(res.status).toBe('succeeded');
      expect(res.transactionAt).toBeNull();
      expect(res.expiresAt).toBeNull();
    });

    it('normalises a parseable timestamp with an offset to ISO UTC', async () => {
      mockFetchOnce(200, { data: payment({ transactionAt: '2026-11-22T10:30:00+07:00' }) });
      expect((await promptpayVerifyApi.getPayment('pay_1')).transactionAt).toBe('2026-11-22T03:30:00.000Z');
    });

    it('still rejects a response missing core fields (status, amount, QR)', async () => {
      mockFetchOnce(200, { data: payment({ status: 'weird' }) });
      await expect(promptpayVerifyApi.getPayment('pay_1')).rejects.toMatchObject({ statusCode: 502 });
      const { amountSatang: _amount, ...noAmount } = payment();
      mockFetchOnce(200, { data: noAmount });
      await expect(promptpayVerifyApi.getPayment('pay_1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it('requires botId so a response cannot silently skip the tenant check', async () => {
      const { botId: _omit, ...withoutBot } = payment();
      mockFetchOnce(200, { data: withoutBot });
      await expect(promptpayVerifyApi.getPayment('pay_1')).rejects.toMatchObject({ statusCode: 502 });
    });

    it('truncates an over-long payerName rather than rejecting the payment', async () => {
      mockFetchOnce(200, { data: payment({ payerName: 'x'.repeat(500) }) });
      expect((await promptpayVerifyApi.getPayment('pay_1')).payerName).toHaveLength(200);
    });

    it('maps platform 404 to AppError(404) so reconcile can tell "unknown payment" from outages', async () => {
      mockFetchOnce(404, { error: { message: 'not found' } });
      await expect(promptpayVerifyApi.getPayment('pay_1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('exposes the bot the platform attributes the payment to', async () => {
      mockFetchOnce(200, { data: payment({ botId: 'bot_9' }) });
      expect((await promptpayVerifyApi.getPayment('pay_1')).botId).toBe('bot_9');
    });
  });

  describe('cancelPayment', () => {
    it('POSTs to the cancel endpoint', async () => {
      const fetchMock = mockFetchOnce(200, { data: payment({ status: 'cancelled' }) });
      const res = await promptpayVerifyApi.cancelPayment('pay/1');
      expect(res.status).toBe('cancelled');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/v1/promptpay/payments/pay%2F1/cancel`);
      expect(init.method).toBe('POST');
    });

    it('surfaces 409 (already finished) as an AppError(409) so the route can re-sync', async () => {
      mockFetchOnce(409, { error: { message: 'not pending' } });
      const err = await promptpayVerifyApi.cancelPayment('pay_1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
    });
  });

  describe('getVerifyBaseUrl precedence', () => {
    it('env pins the destination: a DB (Dev Dashboard) value cannot redirect the system key', async () => {
      dbRows.push({ value: 'https://attacker.example.com' });
      process.env.LINEJS_API_BASE_URL = 'http://localhost:9999';
      expect(await getVerifyBaseUrl()).toBe('http://localhost:9999');
    });

    it('uses the dev-configured DB value (origin only) when env is not set', async () => {
      delete process.env.LINEJS_API_BASE_URL;
      dbRows.push({ value: 'https://verify.example.com/ignored/path' });
      expect(await getVerifyBaseUrl()).toBe('https://verify.example.com');
    });

    it('is opt-in: no implicit localhost default when nothing is configured (NODE_ENV unset or not)', async () => {
      delete process.env.LINEJS_API_BASE_URL;
      expect(await getVerifyBaseUrl()).toBeNull();
      invalidateBaseUrlCache();
      delete process.env.NODE_ENV;
      expect(await getVerifyBaseUrl()).toBeNull();
    });

    it('ignores an invalid DB value (plain http to a public host) when env is not set', async () => {
      delete process.env.LINEJS_API_BASE_URL;
      dbRows.push({ value: 'http://insecure.example.com' });
      expect(await getVerifyBaseUrl()).toBeNull();
    });
  });

  describe('normalizeBaseUrl', () => {
    it('rejects credentials and plain http to non-local hosts', () => {
      expect(normalizeBaseUrl('https://user:pw@example.com')).toBeNull();
      expect(normalizeBaseUrl('http://example.com')).toBeNull();
      expect(normalizeBaseUrl('not a url')).toBeNull();
    });
  });
});
