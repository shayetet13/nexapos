import { describe, it, expect } from 'vitest';
import { ValidationError } from '../lib/errors.js';
import {
  MAX_RANGE_DAYS, PAYMENT_TOLERANCE_SATANG, isVerifyReady, minimumPaidSatang, payableSatang, platformReady, resolveRange, settleStatus,
} from '../lib/promptpay-verify-logic.js';

// 2026-03-10 08:30 Bangkok = 2026-03-10T01:30Z
const NOW = new Date('2026-03-10T01:30:00Z');

describe('resolveRange', () => {
  it('defaults to today (Bangkok): [00:00, next 00:00)', () => {
    const r = resolveRange({}, NOW);
    expect(r.from.toISOString()).toBe('2026-03-09T17:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-03-10T17:00:00.000Z');
  });

  it('includes the whole "to" day', () => {
    const r = resolveRange({ from: '2026-03-01', to: '2026-03-03' }, NOW);
    expect(r.from.toISOString()).toBe('2026-02-28T17:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-03-03T17:00:00.000Z');
  });

  it('rejects from > to', () => {
    expect(() => resolveRange({ from: '2026-03-05', to: '2026-03-01' }, NOW)).toThrow(ValidationError);
  });

  it.each(['2026-3-1', '2026-02-30', 'abc', '2026-03-01T00:00'])('rejects invalid date "%s"', (value) => {
    expect(() => resolveRange({ from: value }, NOW)).toThrow(ValidationError);
    expect(() => resolveRange({ to: value }, NOW)).toThrow(ValidationError);
  });

  it(`allows exactly ${MAX_RANGE_DAYS} days and rejects one more`, () => {
    // 2025-03-10 → 2026-03-10 inclusive = 366 days
    expect(() => resolveRange({ from: '2025-03-10', to: '2026-03-10' }, NOW)).not.toThrow();
    expect(() => resolveRange({ from: '2025-03-09', to: '2026-03-10' }, NOW)).toThrow(ValidationError);
  });
});

describe('settleStatus', () => {
  it('passes the platform status through when the amount matches', () => {
    expect(settleStatus(10_000, { status: 'succeeded', amountSatang: 10_000 })).toBe('succeeded');
    expect(settleStatus(10_000, { status: 'pending', amountSatang: 10_000 })).toBe('pending');
  });

  it('turns a succeeded payment with a different amount into ambiguous', () => {
    expect(settleStatus(10_000, { status: 'succeeded', amountSatang: 9_999 })).toBe('ambiguous');
  });

  it('does not touch non-succeeded statuses even if the amount differs', () => {
    expect(settleStatus(10_000, { status: 'cancelled', amountSatang: 1 })).toBe('cancelled');
  });
});

describe('payable amount (matches the POS checkout)', () => {
  it('adds whole-baht VAT like CheckoutModal when the shop has VAT on', () => {
    // POS: vat = Math.round((total - discount) * 0.07); grand = total - discount + vat
    expect(payableSatang(100, true)).toBe(10_700);
    expect(payableSatang(99.5, true)).toBe(10_650); // vat = round(6.965) = 7
    expect(payableSatang(1_000, true)).toBe(107_000);
  });

  it('is the order total when VAT is off', () => {
    expect(payableSatang(100, false)).toBe(10_000);
    expect(payableSatang(12.34, false)).toBe(1_234);
  });

  it('allows a small shortfall only, never below zero', () => {
    expect(minimumPaidSatang(100, true)).toBe(10_700 - PAYMENT_TOLERANCE_SATANG);
    expect(minimumPaidSatang(0, false)).toBe(0);
  });
});

describe('isVerifyReady / platformReady', () => {
  const ready = {
    enabled: true, bot_id: 'b', source_target_id: 't', promptpay_id_type: 'phone', promptpay_id_encrypted: 'x',
  };

  it('requires enabled + bot + chat + PromptPay number', () => {
    expect(isVerifyReady(ready)).toBe(true);
    expect(isVerifyReady(null)).toBe(false);
    for (const key of ['bot_id', 'source_target_id', 'promptpay_id_type', 'promptpay_id_encrypted'] as const) {
      expect(isVerifyReady({ ...ready, [key]: null })).toBe(false);
    }
    expect(isVerifyReady({ ...ready, enabled: false })).toBe(false);
  });

  it('platform is ready only with both base URL and key', () => {
    expect(platformReady({ base_url_configured: true, api_key_configured: true })).toBe(true);
    expect(platformReady({ base_url_configured: true, api_key_configured: false })).toBe(false);
    expect(platformReady({ base_url_configured: false, api_key_configured: true })).toBe(false);
  });
});
