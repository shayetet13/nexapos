/**
 * Unit tests for promptpay-verify-api.ts — upstream (LINEJS) failure mapping.
 *
 * ต้องไม่ใช้ 502/504: Cloudflare แทนที่ response เหล่านี้จาก origin ด้วยหน้า HTML
 * ทำให้ POS เห็นแค่ "เชื่อมต่อไม่ได้" โดยไม่รู้สาเหตุจริง
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ value: 'https://linejs.example.com' }] }) }),
  },
}));
vi.mock('../lib/audit.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { promptpayVerifyApi, UPSTREAM_ERROR_STATUS, invalidateBaseUrlCache } from '../lib/promptpay-verify-api.js';
import { AppError } from '../lib/errors.js';

const input = {
  botId: 'bot1', sourceTargetId: 't1', promptPayIdType: 'phone' as const,
  promptPayId: '0812345678', amount: '1.00',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('promptpayVerifyApi upstream errors', () => {
  beforeEach(() => { invalidateBaseUrlCache(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses a status Cloudflare does not rewrite (never 502/504)', () => {
    expect([502, 504]).not.toContain(UPSTREAM_ERROR_STATUS);
  });

  it('maps unreachable upstream to UPSTREAM_ERROR_STATUS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const err = await promptpayVerifyApi.createPayment('lbk_testkey123', input).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(UPSTREAM_ERROR_STATUS);
  });

  it('surfaces the upstream error message for non-2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { error: { message: 'bot is offline' } })));
    const err = await promptpayVerifyApi.createPayment('lbk_testkey123', input).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(UPSTREAM_ERROR_STATUS);
    expect(err.message).toContain('409');
    expect(err.message).toContain('bot is offline');
  });

  it('maps a response shape mismatch to UPSTREAM_ERROR_STATUS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: { unexpected: true } })));
    const err = await promptpayVerifyApi.createPayment('lbk_testkey123', input).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(UPSTREAM_ERROR_STATUS);
  });

  it('keeps 401 as a client-side 400 (bad API key)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));
    const err = await promptpayVerifyApi.createPayment('lbk_testkey123', input).catch((e) => e);
    expect(err.statusCode).toBe(400);
  });
});
