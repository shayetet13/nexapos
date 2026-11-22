/**
 * Unit tests for services/promptpay-order-guard.ts — server-side proof of payment for transfer orders.
 * Repository and platform status are mocked; the point is which conditions reject an order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repositories/promptpay-verify.repository.js', () => ({
  promptpayVerifyRepository: {
    getConfig: vi.fn(), claimForOrder: vi.fn(), getPayment: vi.fn(), releaseClaim: vi.fn(), linkOrder: vi.fn(),
  },
}));
vi.mock('../lib/promptpay-verify-api.js', () => ({ getPlatformStatus: vi.fn() }));
vi.mock('../lib/audit.js', () => ({
  audit: { action: vi.fn() },
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { claimVerifiedPayment, linkPaymentToOrder, releasePaymentClaim } from '../services/promptpay-order-guard.js';
import { promptpayVerifyRepository as repo } from '../repositories/promptpay-verify.repository.js';
import { getPlatformStatus } from '../lib/promptpay-verify-api.js';
import { audit, logger } from '../lib/audit.js';

const SHOP = 'a1b2c3d4-0000-0000-0000-000000000001';
const PAY = 'a1b2c3d4-0000-0000-0000-0000000003aa';

const READY_CFG = {
  enabled: true, bot_id: 'bot_1', source_target_id: 'tgt_1',
  promptpay_id_type: 'phone', promptpay_id_encrypted: 'enc',
};

function row(overrides: Record<string, unknown> = {}) {
  return { id: PAY, shop_id: SHOP, status: 'succeeded', amount_satang: 10_700, claimed_at: null, ...overrides };
}

describe('claimVerifiedPayment()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.getConfig).mockResolvedValue(READY_CFG as never);
    vi.mocked(getPlatformStatus).mockResolvedValue({ base_url_configured: true, api_key_configured: true });
  });

  describe('when the shop is not enforced', () => {
    it('does nothing for a shop without a config row', async () => {
      vi.mocked(repo.getConfig).mockResolvedValue(null);
      expect(await claimVerifiedPayment({ shopId: SHOP, finalTotal: 100, vatEnabled: true })).toEqual({ enforced: false });
      expect(repo.claimForOrder).not.toHaveBeenCalled();
    });

    it.each([
      ['disabled', { enabled: false }],
      ['no bot bound', { bot_id: null }],
      ['no bank chat', { source_target_id: null }],
      ['no PromptPay number', { promptpay_id_encrypted: null }],
    ])('does nothing when the feature is %s', async (_l, patch) => {
      vi.mocked(repo.getConfig).mockResolvedValue({ ...READY_CFG, ...patch } as never);
      expect((await claimVerifiedPayment({ shopId: SHOP, finalTotal: 100, vatEnabled: true })).enforced).toBe(false);
    });

    it.each([
      ['no base URL', { base_url_configured: false, api_key_configured: true }],
      ['no platform key', { base_url_configured: true, api_key_configured: false }],
    ])('does nothing when the platform has %s (POS falls back to its manual flow) but leaves a trace', async (_l, status) => {
      vi.mocked(getPlatformStatus).mockResolvedValue(status);
      expect((await claimVerifiedPayment({ shopId: SHOP, finalTotal: 100, vatEnabled: true })).enforced).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
      expect(audit.action).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment_guard_skipped', shop_id: SHOP }));
    });

    it('does not log a skip for shops that never enabled the feature', async () => {
      vi.mocked(repo.getConfig).mockResolvedValue({ ...READY_CFG, enabled: false } as never);
      await claimVerifiedPayment({ shopId: SHOP, finalTotal: 100, vatEnabled: true });
      expect(audit.action).not.toHaveBeenCalled();
    });
  });

  describe('when the shop is enforced', () => {
    it('rejects an order without a payment id', async () => {
      const r = await claimVerifiedPayment({ shopId: SHOP, finalTotal: 100, vatEnabled: true });
      expect(r).toMatchObject({ enforced: true, ok: false, code: 'PAYMENT_NOT_VERIFIED' });
      expect(repo.claimForOrder).not.toHaveBeenCalled();
    });

    it('claims with the VAT-inclusive amount minus the rounding tolerance', async () => {
      vi.mocked(repo.claimForOrder).mockResolvedValue(row() as never);
      const r = await claimVerifiedPayment({ shopId: SHOP, paymentId: PAY, finalTotal: 100, vatEnabled: true });
      // 100 + VAT 7 = ฿107.00 = 10,700 satang; minimum = 10,700 − 100
      expect(repo.claimForOrder).toHaveBeenCalledWith(SHOP, PAY, 10_600);
      expect(r).toMatchObject({ enforced: true, ok: true });
    });

    it('does not add VAT when the shop has it off', async () => {
      vi.mocked(repo.claimForOrder).mockResolvedValue(row({ amount_satang: 10_000 }) as never);
      await claimVerifiedPayment({ shopId: SHOP, paymentId: PAY, finalTotal: 100, vatEnabled: false });
      expect(repo.claimForOrder).toHaveBeenCalledWith(SHOP, PAY, 9_900);
    });

    it('always scopes the claim to the calling shop', async () => {
      vi.mocked(repo.claimForOrder).mockResolvedValue(null);
      vi.mocked(repo.getPayment).mockResolvedValue(null);
      await claimVerifiedPayment({ shopId: SHOP, paymentId: PAY, finalTotal: 100, vatEnabled: true });
      expect(vi.mocked(repo.claimForOrder).mock.calls[0]![0]).toBe(SHOP);
      expect(vi.mocked(repo.getPayment).mock.calls[0]![0]).toBe(SHOP);
    });

    it.each([
      ['an unknown / other-shop payment', null, /ไม่พบ/],
      ['a payment that has not succeeded', row({ status: 'pending' }), /ยังไม่ได้รับเงิน/],
      ['an ambiguous payment (money seen, amount differs)', row({ status: 'ambiguous' }), /ยอดไม่ตรง/],
      ['an expired payment', row({ status: 'expired' }), /หมดอายุหรือถูกยกเลิก/],
      ['a cancelled payment', row({ status: 'cancelled' }), /หมดอายุหรือถูกยกเลิก/],
      ['a payment already used by another order', row({ claimed_at: new Date() }), /ถูกใช้กับออเดอร์อื่น/],
      ['a payment that is too small', row({ amount_satang: 5_000 }), /น้อยกว่ายอดที่ต้องชำระ/],
    ])('rejects %s with a reason', async (_l, found, message) => {
      vi.mocked(repo.claimForOrder).mockResolvedValue(null);
      vi.mocked(repo.getPayment).mockResolvedValue(found as never);
      const r = await claimVerifiedPayment({ shopId: SHOP, paymentId: PAY, finalTotal: 100, vatEnabled: true });
      expect(r).toMatchObject({ enforced: true, ok: false, code: 'PAYMENT_NOT_VERIFIED' });
      if (r.enforced && !r.ok) expect(r.message).toMatch(message);
    });
  });

  it('releasePaymentClaim / linkPaymentToOrder delegate to the repository with the shop id', async () => {
    await releasePaymentClaim(SHOP, PAY);
    await linkPaymentToOrder(SHOP, PAY, 'ord1');
    expect(repo.releaseClaim).toHaveBeenCalledWith(SHOP, PAY);
    expect(repo.linkOrder).toHaveBeenCalledWith(SHOP, PAY, 'ord1');
  });

  it('logs (and does not throw) when releasing or linking fails, so the order flow is not broken', async () => {
    vi.mocked(repo.releaseClaim).mockRejectedValueOnce(new Error('db down'));
    vi.mocked(repo.linkOrder).mockRejectedValueOnce(new Error('db down'));
    await expect(releasePaymentClaim(SHOP, PAY)).resolves.toBeUndefined();
    await expect(linkPaymentToOrder(SHOP, PAY, 'ord1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
