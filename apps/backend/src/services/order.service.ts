import { createOrderSchema } from '@nexapos/shared';
import { productRepository } from '../repositories/product.repository.js';
import { stockRepository } from '../repositories/stock.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { customerRepository, calcPointsEarned, pointsToDiscountFromConfig } from '../repositories/customer.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { logRepository } from '../repositories/log.repository.js';
import { eventRepository } from '../repositories/event.repository.js';
import { broadcast } from '../lib/ws-broadcast.js';
import { consumableRepository } from '../repositories/consumable.repository.js';
import { bkkToday } from '../lib/bkk-time.js';

type MembershipConfigLike = {
  points_per_10_baht?: number;
  redemption_type?: 'points_per_10_baht' | 'baht_per_point';
  redemption_rate?: number;
  redemption_baht_per_point?: number;
  tier_silver?: number;
  tier_gold?: number;
  birthday_benefit_type?: 'percent' | 'fixed';
  birthday_benefit_value?: number;
};

function isBirthdayToday(birthday: string | null | undefined): boolean {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return false;
  const [, m, d] = birthday.split('-').map(Number);
  const today = bkkToday();
  return m === today.month && d === today.day;
}

export type CreateOrderResult =
  | {
      success: true;
      orderId: string;
      orderNumber: number;
      dailySeq: number;
      receiptToken: string;
      refCode: string;
      paymentMethod: string;
      cashReceived: number | null;
      total: number;
      discount: number;
      items: Array<{ product_id: string; name: string; quantity: number; unit_price: number; subtotal: number }>;
    }
  | { success: false; error: { code: string; message: string } };

export async function createOrder(
  shopId: string,
  userId: string,
  input: unknown
): Promise<CreateOrderResult> {
  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: JSON.stringify(parsed.error.flatten()),
      },
    };
  }

  const { branch_id: branchId, items, payment_method, customer_id, points_redeemed = 0, discount: inputDiscount = 0, cash_received } = parsed.data;

  const orderItems: Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    tracked: boolean; // true when a branch_stock record exists
  }> = [];

  const shop = await shopRepository.getShopById(shopId);
  const membershipConfig = (shop?.membership_config as MembershipConfigLike) ?? undefined;

  // Fetch customer + products + stock in parallel (single round-trip)
  const productIds = items.map((i: { product_id: string; quantity: number }) => i.product_id);
  const [customer, allProducts, allStock] = await Promise.all([
    customer_id ? customerRepository.getById(shopId, customer_id) : Promise.resolve(null),
    productRepository.getByIds(shopId, productIds),
    stockRepository.getStockForProducts(branchId, productIds),
  ]);

  // Validate points_redeemed against customer balance
  let validatedPointsRedeemed = 0;
  if (customer_id && points_redeemed > 0 && customer && customer.points >= points_redeemed) {
    validatedPointsRedeemed = points_redeemed;
  }
  let discount = pointsToDiscountFromConfig(validatedPointsRedeemed, membershipConfig);

  let total = 0;
  const productMap = new Map(allProducts.map((p) => [p.id, p]));
  const stockMap   = new Map(allStock.map((s) => [s.product_id, s]));

  for (const item of items) {
    const product = productMap.get(item.product_id);
    if (!product) {
      return {
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: `Product ${item.product_id} not found` },
      };
    }

    const stock = stockMap.get(item.product_id) ?? null;
    // null = no branch_stock row → treat as unlimited/untracked
    if (stock !== null && stock.quantity < item.quantity) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: `สินค้า "${product.name}" มีไม่เพียงพอ (ต้องการ ${item.quantity}, มี ${stock.quantity})`,
        },
      };
    }

    const unitPrice = Number(product.price);
    const subtotal = unitPrice * item.quantity;
    total += subtotal;
    orderItems.push({
      product_id: item.product_id,
      name: product.name,
      quantity: item.quantity,
      unit_price: unitPrice,
      subtotal,
      tracked: stock !== null,
    });
  }

  // Birthday benefit: extra discount when customer's birthday is today
  if (customer_id && customer && (membershipConfig?.birthday_benefit_type === 'percent' || membershipConfig?.birthday_benefit_type === 'fixed') && typeof membershipConfig?.birthday_benefit_value === 'number' && membershipConfig.birthday_benefit_value > 0) {
    if (isBirthdayToday(customer.birthday)) {
      const afterPointsDiscount = Math.max(0, total - discount);
      const birthdayDiscount =
        membershipConfig.birthday_benefit_type === 'percent'
          ? Math.round((afterPointsDiscount * membershipConfig.birthday_benefit_value) / 100 * 100) / 100
          : Math.min(membershipConfig.birthday_benefit_value, afterPointsDiscount);
      discount += birthdayDiscount;
    }
  }

  // Apply manual/promotion discount from POS (capped to remaining total)
  if (inputDiscount > 0) {
    const maxAllowed = Math.max(0, total - discount);
    discount += Math.min(inputDiscount, maxAllowed);
  }

  const finalTotal = Math.max(0, total - discount);
  const pointsPer10 = membershipConfig?.points_per_10_baht ?? 1;
  const pointsEarned = customer_id ? calcPointsEarned(finalTotal, pointsPer10) : 0;

  const order = await orderRepository.create({
    shop_id:         shopId,
    branch_id:       branchId,
    user_id:         userId,
    customer_id:     customer_id ?? undefined,
    total:           finalTotal.toFixed(2),
    discount:        discount.toFixed(2),
    points_earned:   pointsEarned,
    points_redeemed: validatedPointsRedeemed,
    payment_method,
    cash_received:   (payment_method === 'cash' && cash_received != null) ? cash_received.toFixed(2) : undefined,
  });

  if (!order) {
    return { success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create order' } };
  }

  await orderRepository.createItems(
    orderItems.map((i) => ({
      order_id: order.id,
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price.toFixed(2),
      subtotal: i.subtotal.toFixed(2),
    }))
  );

  await Promise.all(
    orderItems
      .filter((item) => item.tracked)
      .map(async (item) => {
        const newStock = await stockRepository.deductStock(branchId, item.product_id, item.quantity);
        if (newStock) {
          broadcast(shopId, 'STOCK_UPDATE', {
            branch_id:  branchId,
            product_id: item.product_id,
            quantity:   newStock.quantity,
            min_qty:    newStock.min_qty,
          });
        }
      }),
  );

  // ── BOM: deduct consumables stock ──────────────────────────────
  await consumableRepository.deductByBOM(
    shopId,
    orderItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
  );

  // Update customer points and tier after order
  if (customer_id && order) {
    const tierSilver = membershipConfig?.tier_silver ?? 1000;
    const tierGold   = membershipConfig?.tier_gold   ?? 5000;
    await Promise.all([
      validatedPointsRedeemed > 0
        ? customerRepository.deductPoints(shopId, customer_id, validatedPointsRedeemed)
        : Promise.resolve(),
      customerRepository.applyPurchase(shopId, customer_id, finalTotal, pointsEarned, tierSilver, tierGold),
    ]);
  }

  await logRepository.insert({
    shop_id: shopId,
    action: 'ORDER_CREATED',
    entity_type: 'order',
    entity_id: order.id,
    payload: { branch_id: branchId, total, items: orderItems },
    user_id: userId,
  });

  await eventRepository.insert({
    shop_id: shopId,
    branch_id: branchId,
    type: 'ORDER_CREATED',
    payload: {
      order_id: order.id,
      total,
      items: orderItems,
    },
  });

  const seq = await orderRepository.countTodayByShop(shopId);

  // 1. CHECKOUT_PAID first — Customer Display switches to receipt QR mode
  broadcast(shopId, 'CHECKOUT_PAID', {
    receipt_token: order.receipt_token,
    daily_seq:     order.daily_seq,
    total:         Number(total),
  });

  // 2. ORDER_CREATED after — triggers stock/stats refresh (Customer Display ignores while in receipt mode)
  broadcast(shopId, 'ORDER_CREATED', {
    order_id:  order.id,
    branch_id: branchId,
    seq,
    total,
    items: orderItems,
  });

  return {
    success:       true,
    orderId:       order.id,
    orderNumber:   order.order_number,
    dailySeq:      order.daily_seq,
    receiptToken:  order.receipt_token,
    refCode:       order.ref_code ?? '',
    paymentMethod: payment_method ?? 'other',
    cashReceived:  (payment_method === 'cash' && cash_received != null) ? Number(cash_received) : null,
    total:         finalTotal,
    discount,
    items:         orderItems.map((i) => ({
      product_id: i.product_id,
      name:       i.name,
      quantity:   i.quantity,
      unit_price: i.unit_price,
      subtotal:   i.subtotal,
    })),
  };
}
