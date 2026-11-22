import { describe, it, expect } from 'vitest';
import { maxRedeemablePoints, pointsToDiscountFromConfig } from '@nexapos/shared';
import { pointsToDiscountFromConfig as serverDiscount } from '../repositories/customer.repository.js';

// customer.repository imports the db layer; these tests only need its pure helper, so stub the db module.
import { vi } from 'vitest';
vi.mock('../db/index.js', () => ({ db: {} }));
vi.mock('../db/schema.js', () => ({ customers: {}, orders: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), ilike: vi.fn(), or: vi.fn(), sql: vi.fn(), desc: vi.fn() }));

describe('points redemption rule shared by POS and server', () => {
  it('defaults to 100 points per ฿10 without config', () => {
    expect(pointsToDiscountFromConfig(1000, null)).toBe(100);
    expect(maxRedeemablePoints(1049, null)).toBe(1000);
  });

  it('honours a custom points-per-฿10 rate and only redeems whole units', () => {
    const cfg = { redemption_type: 'points_per_10_baht' as const, redemption_rate: 200 };
    expect(pointsToDiscountFromConfig(1000, cfg)).toBe(50);
    expect(maxRedeemablePoints(450, cfg)).toBe(400);
    expect(pointsToDiscountFromConfig(maxRedeemablePoints(450, cfg), cfg)).toBe(20);
  });

  it('supports baht-per-point and floors to satang', () => {
    const cfg = { redemption_type: 'baht_per_point' as const, redemption_baht_per_point: 0.25 };
    expect(maxRedeemablePoints(1001.9, cfg)).toBe(1001);
    expect(pointsToDiscountFromConfig(1001, cfg)).toBe(250.25);
  });

  it('falls back to the default rate for an invalid rate instead of dividing by zero', () => {
    expect(pointsToDiscountFromConfig(500, { redemption_rate: 0 })).toBe(50);
    expect(maxRedeemablePoints(500, { redemption_rate: -5 })).toBe(500);
  });

  it('server and client compute the same discount for every config shape (the payment guard relies on it)', () => {
    const configs = [
      null,
      { redemption_type: 'points_per_10_baht' as const, redemption_rate: 100 },
      { redemption_type: 'points_per_10_baht' as const, redemption_rate: 250 },
      { redemption_type: 'baht_per_point' as const, redemption_baht_per_point: 0.1 },
    ];
    for (const cfg of configs) {
      for (const pts of [0, 99, 100, 101, 999, 12_345]) {
        const redeem = maxRedeemablePoints(pts, cfg);
        expect(serverDiscount(redeem, cfg)).toBe(pointsToDiscountFromConfig(redeem, cfg));
      }
    }
  });
});
