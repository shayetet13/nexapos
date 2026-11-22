/**
 * Unit tests for order.service.ts — createOrder()
 *
 * All external dependencies (repositories, broadcast) are vi.mock()'d so
 * these tests run completely in-process with no DB connection required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all repository modules before importing the service ────────────────
vi.mock('../repositories/product.repository.js', () => ({
  productRepository: { getByIds: vi.fn() },
}));
vi.mock('../repositories/stock.repository.js', () => ({
  stockRepository: { getStockForProducts: vi.fn(), deductStock: vi.fn() },
}));
vi.mock('../repositories/order.repository.js', () => ({
  orderRepository: { create: vi.fn(), createItems: vi.fn(), countTodayByShop: vi.fn() },
}));
vi.mock('../repositories/customer.repository.js', () => ({
  customerRepository: { getById: vi.fn(), deductPoints: vi.fn(), applyPurchase: vi.fn() },
  calcPointsEarned: (total: number, per10: number) => Math.floor(total / 10) * per10,
  pointsToDiscountFromConfig: (points: number) => points,
}));
vi.mock('../repositories/shop.repository.js', () => ({
  shopRepository: { getShopById: vi.fn() },
}));
vi.mock('../repositories/log.repository.js', () => ({
  logRepository: { insert: vi.fn() },
}));
vi.mock('../repositories/event.repository.js', () => ({
  eventRepository: { insert: vi.fn(), insertMany: vi.fn() },
}));
vi.mock('../lib/ws-broadcast.js', () => ({
  broadcast: vi.fn(),
}));
vi.mock('../repositories/consumable.repository.js', () => ({
  consumableRepository: { deductByBOM: vi.fn() },
}));
vi.mock('../services/promptpay-order-guard.js', () => ({
  claimVerifiedPayment: vi.fn(),
  releasePaymentClaim:  vi.fn(),
  linkPaymentToOrder:   vi.fn(),
}));

import { createOrder } from '../services/order.service.js';
import { claimVerifiedPayment, releasePaymentClaim, linkPaymentToOrder } from '../services/promptpay-order-guard.js';
import { productRepository } from '../repositories/product.repository.js';
import { stockRepository } from '../repositories/stock.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';

// ─── UUID constants (Zod schema requires valid UUIDs) ─────────────────────────
const SHOP_ID   = 'a1b2c3d4-0000-0000-0000-000000000001';
const USER_ID   = 'a1b2c3d4-0000-0000-0000-000000000002';
const BRANCH_ID = 'a1b2c3d4-0000-0000-0000-000000000010';
const PROD_1    = 'a1b2c3d4-0000-0000-0000-000000000100';
const PROD_2    = 'a1b2c3d4-0000-0000-0000-000000000101';
const PROD_3    = 'a1b2c3d4-0000-0000-0000-000000000102';
const CUST_1    = 'a1b2c3d4-0000-0000-0000-000000000200';

function makeProduct(id: string, price = '100.00') {
  return { id, name: `Product ${id}`, price, unit: 'unit', sku: null, category: null };
}
function makeStock(product_id: string, quantity: number) {
  return { branch_id: BRANCH_ID, product_id, quantity, min_qty: 5, updated_at: null };
}
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    branch_id:      BRANCH_ID,
    items:          [{ product_id: PROD_1, quantity: 2 }],
    payment_method: 'cash',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('createOrder()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shopRepository.getShopById).mockResolvedValue({
      id: SHOP_ID, name: 'Test Shop', membership_config: null,
    } as never);
    vi.mocked(productRepository.getByIds).mockResolvedValue([makeProduct(PROD_1)] as never);
    vi.mocked(stockRepository.getStockForProducts).mockResolvedValue([makeStock(PROD_1, 10)] as never);
    vi.mocked(stockRepository.deductStock).mockResolvedValue({ quantity: 8, min_qty: 5 } as never);
    vi.mocked(orderRepository.create).mockResolvedValue({
      id: 'ord1', order_number: 1, daily_seq: 1, receipt_token: 'tok',
    } as never);
    vi.mocked(orderRepository.createItems).mockResolvedValue(undefined as never);
    vi.mocked(orderRepository.countTodayByShop).mockResolvedValue(1 as never);
    vi.mocked(claimVerifiedPayment).mockResolvedValue({ enforced: false });
    vi.mocked(releasePaymentClaim).mockResolvedValue(undefined);
    vi.mocked(linkPaymentToOrder).mockResolvedValue(undefined);
  });

  // ── Validation ──────────────────────────────────────────────────────────────
  it('returns VALIDATION_ERROR when input is empty object', async () => {
    const result = await createOrder(SHOP_ID, USER_ID, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when items array is empty', async () => {
    const result = await createOrder(SHOP_ID, USER_ID, validInput({ items: [] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when branch_id is not a UUID', async () => {
    const result = await createOrder(SHOP_ID, USER_ID, { ...validInput(), branch_id: 'not-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns VALIDATION_ERROR when product_id inside items is not a UUID', async () => {
    const result = await createOrder(SHOP_ID, USER_ID, validInput({
      items: [{ product_id: 'bad', quantity: 1 }],
    }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  // ── Product lookup ──────────────────────────────────────────────────────────
  it('returns PRODUCT_NOT_FOUND when product does not exist in shop', async () => {
    vi.mocked(productRepository.getByIds).mockResolvedValue([] as never);
    const result = await createOrder(SHOP_ID, USER_ID, validInput());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('fetches products in a single batch call — no N+1', async () => {
    const input = validInput({
      items: [
        { product_id: PROD_1, quantity: 1 },
        { product_id: PROD_2, quantity: 1 },
        { product_id: PROD_3, quantity: 1 },
      ],
    });
    vi.mocked(productRepository.getByIds).mockResolvedValue([
      makeProduct(PROD_1), makeProduct(PROD_2), makeProduct(PROD_3),
    ] as never);
    vi.mocked(stockRepository.getStockForProducts).mockResolvedValue([
      makeStock(PROD_1, 5), makeStock(PROD_2, 5), makeStock(PROD_3, 5),
    ] as never);

    await createOrder(SHOP_ID, USER_ID, input);

    // Both batch fetches called exactly ONCE regardless of item count
    expect(productRepository.getByIds).toHaveBeenCalledTimes(1);
    expect(stockRepository.getStockForProducts).toHaveBeenCalledTimes(1);
  });

  // ── Stock validation ────────────────────────────────────────────────────────
  it('returns INSUFFICIENT_STOCK when quantity exceeds available', async () => {
    vi.mocked(stockRepository.getStockForProducts).mockResolvedValue([
      makeStock(PROD_1, 1), // only 1 available, requesting 2
    ] as never);
    const result = await createOrder(SHOP_ID, USER_ID, validInput());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('allows order when no stock record exists (untracked product)', async () => {
    vi.mocked(stockRepository.getStockForProducts).mockResolvedValue([] as never);
    const result = await createOrder(SHOP_ID, USER_ID, validInput());
    expect(result.success).toBe(true);
  });

  // ── Successful order ────────────────────────────────────────────────────────
  it('creates order and returns orderId + receiptToken on success', async () => {
    const result = await createOrder(SHOP_ID, USER_ID, validInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.orderId).toBe('ord1');
      expect(result.receiptToken).toBe('tok');
    }
  });

  it('calculates total = sum of (price × qty) for all items', async () => {
    const input = validInput({
      items: [
        { product_id: PROD_1, quantity: 3 }, // 3 × 100 = 300
        { product_id: PROD_2, quantity: 2 }, // 2 × 50  = 100
      ],
    });
    vi.mocked(productRepository.getByIds).mockResolvedValue([
      makeProduct(PROD_1, '100.00'),
      makeProduct(PROD_2, '50.00'),
    ] as never);
    vi.mocked(stockRepository.getStockForProducts).mockResolvedValue([
      makeStock(PROD_1, 10), makeStock(PROD_2, 10),
    ] as never);

    await createOrder(SHOP_ID, USER_ID, input);
    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ total: '400.00', discount: '0.00' })
    );
  });

  it('deducts stock for tracked products only — not untracked', async () => {
    const input = validInput({
      items: [
        { product_id: PROD_1, quantity: 2 }, // tracked (has stock record)
        { product_id: PROD_2, quantity: 1 }, // untracked (no stock record)
      ],
    });
    vi.mocked(productRepository.getByIds).mockResolvedValue([
      makeProduct(PROD_1), makeProduct(PROD_2),
    ] as never);
    // Only PROD_1 has a stock record
    vi.mocked(stockRepository.getStockForProducts).mockResolvedValue([
      makeStock(PROD_1, 10),
    ] as never);

    await createOrder(SHOP_ID, USER_ID, input);

    expect(stockRepository.deductStock).toHaveBeenCalledTimes(1);
    expect(stockRepository.deductStock).toHaveBeenCalledWith(
      BRANCH_ID, PROD_1, 2
    );
  });

  // ── Points redemption ────────────────────────────────────────────────────────
  it('applies points discount when customer balance is sufficient', async () => {
    vi.mocked(customerRepository.getById).mockResolvedValue({
      id: CUST_1, shop_id: SHOP_ID, points: 50,
    } as never);

    const result = await createOrder(SHOP_ID, USER_ID,
      validInput({ customer_id: CUST_1, points_redeemed: 50 })
    );

    expect(result.success).toBe(true);
    // pointsToDiscountFromConfig mock returns points as-is → discount = 50
    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ discount: '50.00' })
    );
  });

  it('ignores points_redeemed when customer balance is insufficient', async () => {
    vi.mocked(customerRepository.getById).mockResolvedValue({
      id: CUST_1, points: 10, // only 10 points available, requesting 50
    } as never);

    const result = await createOrder(SHOP_ID, USER_ID,
      validInput({ customer_id: CUST_1, points_redeemed: 50 })
    );

    expect(result.success).toBe(true);
    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ discount: '0.00' })
    );
  });

  // ── DB failure ──────────────────────────────────────────────────────────────
  it('returns CREATE_FAILED when order DB insert returns null', async () => {
    vi.mocked(orderRepository.create).mockResolvedValue(null as never);
    const result = await createOrder(SHOP_ID, USER_ID, validInput());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('CREATE_FAILED');
  });

  // ── PromptPay auto-verify enforcement (transfer orders) ─────────────────────
  describe('PromptPay verified-payment guard', () => {
    const PAYMENT_ID = 'a1b2c3d4-0000-0000-0000-0000000003aa';
    const transfer = (extra: Record<string, unknown> = {}) =>
      validInput({ payment_method: 'transfer', ...extra });

    it('does not consult the guard for cash/card orders (reconciled against the drawer / card terminal)', async () => {
      await createOrder(SHOP_ID, USER_ID, validInput({ payment_method: 'cash' }));
      await createOrder(SHOP_ID, USER_ID, validInput({ payment_method: 'card' }));
      expect(claimVerifiedPayment).not.toHaveBeenCalled();
    });

    it.each([
      ['other', { payment_method: 'other' }],
      ['an omitted method', { payment_method: undefined }],
    ])('also guards %s so it cannot be used to skip the transfer check', async (_label, extra) => {
      vi.mocked(claimVerifiedPayment).mockResolvedValue({
        enforced: true, ok: false, code: 'PAYMENT_NOT_VERIFIED', message: 'no verified payment',
      });
      const result = await createOrder(SHOP_ID, USER_ID, validInput(extra));
      expect(claimVerifiedPayment).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('PAYMENT_NOT_VERIFIED');
      expect(orderRepository.create).not.toHaveBeenCalled();
    });

    it('passes the server-computed total, shop VAT flag and payment id to the guard', async () => {
      vi.mocked(shopRepository.getShopById).mockResolvedValue({
        id: SHOP_ID, name: 'Test Shop', membership_config: null, vat_enabled: false,
      } as never);
      await createOrder(SHOP_ID, USER_ID, transfer({ promptpay_payment_id: PAYMENT_ID }));
      expect(claimVerifiedPayment).toHaveBeenCalledWith({
        shopId: SHOP_ID, paymentId: PAYMENT_ID, finalTotal: 200, vatEnabled: false,
      });
    });

    it('defaults VAT to enabled when the shop row has no flag', async () => {
      await createOrder(SHOP_ID, USER_ID, transfer());
      expect(claimVerifiedPayment).toHaveBeenCalledWith(expect.objectContaining({ vatEnabled: true }));
    });

    it('creates a transfer order normally when the shop is not enforced', async () => {
      const result = await createOrder(SHOP_ID, USER_ID, transfer());
      expect(result.success).toBe(true);
      expect(orderRepository.create).toHaveBeenCalled();
      expect(linkPaymentToOrder).not.toHaveBeenCalled();
      if (result.success) expect(result.promptpayPaymentId).toBeNull();
    });

    it('rejects the order and creates nothing when the payment is not verified', async () => {
      vi.mocked(claimVerifiedPayment).mockResolvedValue({
        enforced: true, ok: false, code: 'PAYMENT_NOT_VERIFIED', message: 'ยังไม่ได้รับเงิน',
      });
      const result = await createOrder(SHOP_ID, USER_ID, transfer({ promptpay_payment_id: PAYMENT_ID }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('PAYMENT_NOT_VERIFIED');
      expect(orderRepository.create).not.toHaveBeenCalled();
      expect(stockRepository.deductStock).not.toHaveBeenCalled();
    });

    it('links the claimed payment to the new order and reports it', async () => {
      vi.mocked(claimVerifiedPayment).mockResolvedValue({
        enforced: true, ok: true, payment: { id: PAYMENT_ID } as never,
      });
      const result = await createOrder(SHOP_ID, USER_ID, transfer({ promptpay_payment_id: PAYMENT_ID }));
      expect(result.success).toBe(true);
      expect(linkPaymentToOrder).toHaveBeenCalledWith(SHOP_ID, PAYMENT_ID, 'ord1');
      expect(releasePaymentClaim).not.toHaveBeenCalled();
      if (result.success) expect(result.promptpayPaymentId).toBe(PAYMENT_ID);
    });

    it('releases the claim when the order insert returns null', async () => {
      vi.mocked(claimVerifiedPayment).mockResolvedValue({
        enforced: true, ok: true, payment: { id: PAYMENT_ID } as never,
      });
      vi.mocked(orderRepository.create).mockResolvedValue(null as never);
      const result = await createOrder(SHOP_ID, USER_ID, transfer({ promptpay_payment_id: PAYMENT_ID }));
      expect(result.success).toBe(false);
      expect(releasePaymentClaim).toHaveBeenCalledWith(SHOP_ID, PAYMENT_ID);
      expect(linkPaymentToOrder).not.toHaveBeenCalled();
    });

    it('releases the claim and rethrows when the order insert throws', async () => {
      vi.mocked(claimVerifiedPayment).mockResolvedValue({
        enforced: true, ok: true, payment: { id: PAYMENT_ID } as never,
      });
      vi.mocked(orderRepository.create).mockRejectedValue(new Error('db down'));
      await expect(createOrder(SHOP_ID, USER_ID, transfer({ promptpay_payment_id: PAYMENT_ID }))).rejects.toThrow('db down');
      expect(releasePaymentClaim).toHaveBeenCalledWith(SHOP_ID, PAYMENT_ID);
    });

    it('does not claim anything when stock validation fails first', async () => {
      vi.mocked(stockRepository.getStockForProducts).mockResolvedValue([makeStock(PROD_1, 1)] as never);
      const result = await createOrder(SHOP_ID, USER_ID, transfer({ promptpay_payment_id: PAYMENT_ID }));
      expect(result.success).toBe(false);
      expect(claimVerifiedPayment).not.toHaveBeenCalled();
    });

    it.each([
      ['cash', { payment_method: 'cash' }],
      ['an open-tab round', { payment_method: undefined, dining_session_id: 'a1b2c3d4-0000-0000-0000-0000000004aa' }],
    ])('rejects promptpay_payment_id with %s as a validation error', async (_label, extra) => {
      const result = await createOrder(SHOP_ID, USER_ID, validInput({ promptpay_payment_id: PAYMENT_ID, ...extra }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a malformed promptpay_payment_id', async () => {
      const result = await createOrder(SHOP_ID, USER_ID, transfer({ promptpay_payment_id: 'nope' }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
