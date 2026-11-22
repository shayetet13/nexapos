import type { FastifyRequest } from 'fastify';
import { shopRepository } from '../repositories/shop.repository.js';
import { subscriptionRepository } from '../repositories/subscription.repository.js';
import { getPlan, isSubscriptionActive } from './subscription-plans.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';

/** Ensures the authenticated user has owner or manager role for the given shop.
 *  Also stamps req.shopRole so the onResponse audit hook can read the actual role. */
export async function requireAdminShop(req: FastifyRequest): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  const { shopId } = req.params as { shopId: string };
  const role = await shopRepository.getUserRoleForShop(req.auth.userId, shopId);
  if (!role || (role !== 'owner' && role !== 'manager')) {
    throw new ForbiddenError('Owner or manager role required');
  }
  (req as FastifyRequest & { shopRole?: string }).shopRole = role;
}

/** Ensures the authenticated user has owner role for the given shop (owner-only ops). */
export async function requireOwnerShop(req: FastifyRequest): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  const { shopId } = req.params as { shopId: string };
  const role = await shopRepository.getUserRoleForShop(req.auth.userId, shopId);
  if (role !== 'owner') {
    throw new ForbiddenError('Owner role required');
  }
  (req as FastifyRequest & { shopRole?: string }).shopRole = role;
}

/** Ensures the authenticated user has ANY role in the given shop (read-level access). */
export async function guardShop(req: FastifyRequest): Promise<void> {
  if (!req.auth) throw new UnauthorizedError();
  const { shopId } = req.params as { shopId: string };
  const role = await shopRepository.getUserRoleForShop(req.auth.userId, shopId);
  if (!role) throw new ForbiddenError('No access to this shop');
  (req as FastifyRequest & { shopRole?: string }).shopRole = role;
}

// ─── Plan helpers ──────────────────────────────────────────────────────────────

/** Returns the effective plan for a shop (falls back to 'free' if expired/inactive). */
async function getEffectivePlan(shopId: string) {
  const sub = await subscriptionRepository.getByShopId(shopId);
  if (!isSubscriptionActive(sub)) return getPlan('free');
  return getPlan(sub!.plan);
}

/**
 * Throws ForbiddenError (403) if the shop's active plan does not include `feature`.
 * Place AFTER `requireAdminShop` / `guardShop` in the route handler.
 */
export async function requireFeature(req: FastifyRequest, feature: string): Promise<void> {
  const { shopId } = req.params as { shopId: string };
  const plan = await getEffectivePlan(shopId);
  if (!plan.features.includes(feature)) {
    throw new ForbiddenError(
      `ฟีเจอร์นี้ต้องการแผน Pro — กรุณา Upgrade ที่เมนู Subscription`,
    );
  }
}

/**
 * Throws ForbiddenError (403) if `currentCount` has reached the plan's limit.
 * Pass the **current count BEFORE adding** the new item.
 */
export async function requirePlanLimit(
  shopId: string,
  limitKey: 'max_branches' | 'max_products',
  currentCount: number,
): Promise<void> {
  const sub  = await subscriptionRepository.getByShopId(shopId);
  const plan = isSubscriptionActive(sub) ? getPlan(sub!.plan) : getPlan('free');
  const limit = plan[limitKey] as number;
  if (limit >= 0 && currentCount >= limit) {
    const name = limitKey === 'max_products' ? 'สินค้า' : 'สาขา';
    throw new ForbiddenError(
      `ถึงขีดจำกัดของแผน: ${name}สูงสุด ${limit} — กรุณา Upgrade เป็น Pro`,
    );
  }
}
