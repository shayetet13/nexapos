import { closeDiningSessionSchema } from '@nexapos/shared';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { diningSessions, orders } from '../db/schema.js';
import { orderRepository } from '../repositories/order.repository.js';
import { diningSessionRepository } from '../repositories/dining.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { customerRepository, calcPointsEarned, pointsToDiscountFromConfig } from '../repositories/customer.repository.js';
import { broadcast } from '../lib/ws-broadcast.js';
import { logRepository } from '../repositories/log.repository.js';
import { eventRepository } from '../repositories/event.repository.js';

type MembershipConfigLike = {
  points_per_10_baht?: number;
  redemption_type?: 'points_per_10_baht' | 'baht_per_point';
  redemption_rate?: number;
  redemption_baht_per_point?: number;
  tier_silver?: number;
  tier_gold?: number;
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CloseDiningSessionResult =
  | {
      success: true;
      sessionId: string;
      total: number;
      orderIds: string[];
      primaryReceiptToken: string;
      primaryDailySeq: number;
    }
  | { success: false; error: { code: string; message: string } };

export async function closeDiningSession(
  shopId: string,
  userId: string,
  sessionId: string,
  input: unknown,
): Promise<CloseDiningSessionResult> {
  const parsed = closeDiningSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: { code: 'VALIDATION_ERROR', message: JSON.stringify(parsed.error.flatten()) } };
  }
  const { payment_method, customer_id, points_redeemed = 0, discount: inputDiscount = 0, cash_received } = parsed.data;

  const session = await diningSessionRepository.getById(sessionId, shopId);
  if (!session || session.status !== 'open') {
    return { success: false, error: { code: 'SESSION', message: 'ไม่พบเซสชันหรือปิดแล้ว' } };
  }

  const shop = await shopRepository.getShopById(shopId);
  if (shop?.shop_mode !== 'full_service_restaurant') {
    return { success: false, error: { code: 'SHOP_MODE', message: 'ร้านนี้ไม่ใช่โหมดภัตตาคาร' } };
  }

  const pending = await orderRepository.listPendingByDiningSession(shopId, sessionId);
  if (pending.length === 0) {
    return { success: false, error: { code: 'EMPTY', message: 'ไม่มียอดค้างในโต๊ะนี้' } };
  }

  const membershipConfig = (shop?.membership_config as MembershipConfigLike) ?? undefined;
  const customer         = customer_id ? await customerRepository.getById(shopId, customer_id) : null;
  if (customer_id && !customer) {
    return { success: false, error: { code: 'CUSTOMER', message: 'ไม่พบลูกค้า' } };
  }

  let validatedPointsRedeemed = 0;
  if (customer_id && points_redeemed > 0 && customer && customer.points >= points_redeemed) {
    validatedPointsRedeemed = points_redeemed;
  }

  const subSum = pending.reduce((s, o) => s + Number(o.total), 0);
  if (subSum <= 0) {
    return { success: false, error: { code: 'EMPTY', message: 'ยอดรวมไม่ถูกต้อง' } };
  }

  let pointsDiscount = pointsToDiscountFromConfig(validatedPointsRedeemed, membershipConfig);
  pointsDiscount     = Math.min(pointsDiscount, subSum);
  const afterPoints    = Math.max(0, subSum - pointsDiscount);
  const manualDiscount = Math.min(inputDiscount, afterPoints);
  const totalDiscount  = pointsDiscount + manualDiscount;
  const finalGrand     = r2(subSum - totalDiscount);

  const pointsPer10  = membershipConfig?.points_per_10_baht ?? 1;
  const pointsEarned = customer_id && customer ? calcPointsEarned(finalGrand, pointsPer10) : 0;

  const perOrderSessionDiscount: number[] = [];
  let allocated = 0;
  for (let i = 0; i < pending.length; i++) {
    const o = pending[i]!;
    if (i < pending.length - 1) {
      const a = r2((totalDiscount * Number(o.total)) / subSum);
      perOrderSessionDiscount.push(a);
      allocated += a;
    } else {
      perOrderSessionDiscount.push(r2(totalDiscount - allocated));
    }
  }

  const firstId = pending[0]!.id;

  await db.transaction(async (tx) => {
    for (let i = 0; i < pending.length; i++) {
      const o            = pending[i]!;
      const extraDisc    = perOrderSessionDiscount[i] ?? 0;
      const newTotal     = r2(Math.max(0, Number(o.total) - extraDisc));
      const newDiscTotal = r2(Number(o.discount) + extraDisc);
      const isFirst      = i === 0;
      await tx
        .update(orders)
        .set({
          total:            newTotal.toFixed(2),
          discount:         newDiscTotal.toFixed(2),
          status:           'paid',
          payment_method,
          cash_received:    isFirst && payment_method === 'cash' && cash_received != null
            ? cash_received.toFixed(2)
            : null,
          points_earned:    isFirst ? pointsEarned : 0,
          points_redeemed:  isFirst ? validatedPointsRedeemed : 0,
          customer_id:      customer_id ?? null,
          updated_at:       new Date(),
        })
        .where(and(eq(orders.id, o.id), eq(orders.shop_id, shopId)));
    }
    await tx
      .update(diningSessions)
      .set({ status: 'closed', closed_at: new Date(), updated_at: new Date() })
      .where(and(eq(diningSessions.id, sessionId), eq(diningSessions.shop_id, shopId)));
  });

  if (customer_id && customer) {
    const tierSilver = membershipConfig?.tier_silver ?? 1000;
    const tierGold   = membershipConfig?.tier_gold   ?? 5000;
    if (validatedPointsRedeemed > 0) {
      await customerRepository.deductPoints(shopId, customer_id, validatedPointsRedeemed);
    }
    await customerRepository.applyPurchase(shopId, customer_id, finalGrand, pointsEarned, tierSilver, tierGold);
  }

  const primary = await orderRepository.getById(firstId, shopId);
  if (!primary) {
    return { success: false, error: { code: 'ORDER', message: 'Order missing after close' } };
  }

  const orderIds = pending.map((o) => o.id);
  await logRepository.insert({
    shop_id:     shopId,
    action:      'DINING_SESSION_CLOSED',
    entity_type: 'dining_session',
    entity_id:   sessionId,
    payload:     { order_ids: orderIds, total: finalGrand, payment_method, branch_id: session.branch_id },
    user_id:     userId,
  });

  await eventRepository.insert({
    shop_id:   shopId,
    branch_id: session.branch_id,
    type:      'DINING_SESSION_CLOSED',
    payload:   { session_id: sessionId, order_ids: orderIds, total: finalGrand },
  });

  broadcast(shopId, 'CHECKOUT_PAID', {
    receipt_token: primary.receipt_token,
    daily_seq:     primary.daily_seq,
    total:         finalGrand,
  });
  broadcast(shopId, 'DINING_SESSION_CLOSED', {
    session_id:    sessionId,
    total:         finalGrand,
    order_ids:     orderIds,
    primary_order: firstId,
  });

  return {
    success: true,
    sessionId,
    total:   finalGrand,
    orderIds,
    primaryReceiptToken: primary.receipt_token,
    primaryDailySeq:   primary.daily_seq,
  };
}
