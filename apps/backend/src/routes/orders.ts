import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { createOrder } from '../services/order.service.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { stockRepository } from '../repositories/stock.repository.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { logRepository } from '../repositories/log.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { requireAdminShop, guardShop } from '../lib/admin-guard.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { sendRefundOtp, sendRefundConfirmed } from '../lib/telegram.js';
import { db } from '../db/index.js';
import { orderItems } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { OTP_EXPIRY_MS } from '../lib/bkk-time.js';

const ORDER_DEFAULT_LIMIT = 10;
const ORDER_MAX_LIMIT     = 200;
const VALID_ORDER_STATUSES: readonly string[] = ['pending', 'paid', 'void', 'refunded'];

const updateStatusSchema = z.object({
  status: z.enum(['void', 'refunded']),
});

const ordersRoutes: FastifyPluginAsync = async (app) => {

  // POST /shops/:shopId/orders
  app.post<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/orders', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId } = req.params;

    const shops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!shops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }

    // Ensure current user exists in public.users (FK for orders.user_id)
    await userRepository.upsertUser(req.auth!.userId, req.auth!.email);

    const result = await createOrder(shopId, req.auth!.userId, req.body);

    if (!result.success) {
      const status = result.error.code === 'VALIDATION_ERROR' ? 400 : 422;
      return reply.status(status).send({
        success: false,
        error: result.error,
        meta: meta(req),
      });
    }

    audit.action({
      event:       'create_order',
      shop_id:     shopId,
      user_id:     req.auth?.userId,
      request_id:  req.id,
      ip_address:  req.ip,
      entity_type: 'order',
      entity_id:   result.orderId,
      metadata:    {
        ref_code:       result.refCode,
        order_number:   result.orderNumber,
        daily_seq:      result.dailySeq,
        total:          result.total,
        discount:       result.discount,
        payment_method: result.paymentMethod,
        cash_received:  result.cashReceived,
        staff_email:    req.auth?.email ?? null,
        items:          result.items.map((i) => ({
          name:       i.name,
          quantity:   i.quantity,
          unit_price: i.unit_price,
          subtotal:   i.subtotal,
        })),
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        orderId:     result.orderId,
        orderNumber: result.orderNumber,
        dailySeq:    result.dailySeq,
        receiptToken: result.receiptToken,
        refCode:     result.refCode,
        orderStatus: result.orderStatus,
      },
      meta: meta(req),
    });
  });

  // GET /shops/:shopId/orders/:orderId  — order detail with items (any shop member)
  app.get<{ Params: { shopId: string; orderId: string } }>(
    '/shops/:shopId/orders/:orderId', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      const { shopId, orderId } = req.params;
      const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
      if (!userShops.some((s) => s.id === shopId)) {
        throw new ForbiddenError('No access to this shop');
      }
      const rows = await orderRepository.getWithItems(orderId, shopId);
      const first = rows[0];
      if (!first) throw new NotFoundError('Order');

      const detail = {
        id:             first.order_id,
        order_number:   first.order_number,
        daily_seq:      first.daily_seq,
        receipt_token:  first.receipt_token,
        status:         first.status,
        total:          first.total,
        payment_method: first.payment_method,
        created_at:     first.created_at,
        branch_id:      first.branch_id,
        branch_name:    first.branch_name,
        user_email:     first.staff_email,
        items: rows.map((r) => ({
          id:           r.item_id,
          product_id:   r.product_id,
          product_name: r.product_name,
          quantity:     r.quantity,
          unit_price:   r.unit_price,
          subtotal:     r.subtotal,
          note:         r.note ?? null,
        })),
      };
      return reply.send({ success: true, data: detail, meta: meta(req) });
    },
  );

  // GET /shops/:shopId/orders/today?branchId=  — any shop user (cashier+)
  app.get<{
    Params:      { shopId: string };
    Querystring: { branchId?: string };
  }>('/shops/:shopId/orders/today', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const { shopId } = req.params;
    const { branchId } = req.query;

    // ตรวจว่า user มีสิทธิ์เข้าถึง shop นี้ (ทุก role)
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }
    if (!branchId) throw new ValidationError({ branchId: ['branchId is required'] });

    const list = await orderRepository.listTodayByBranch(shopId, branchId);
    return reply.send({ success: true, data: list, meta: meta(req) });
  });

  // GET /shops/:shopId/orders  — any shop member (owner/manager/cashier/viewer)
  app.get<{ Params: { shopId: string }; Querystring: { limit?: string; offset?: string; status?: string; seq?: string; date?: string; ref?: string } }>(
    '/shops/:shopId/orders', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      const { shopId } = req.params;
      const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
      if (!userShops.some((s) => s.id === shopId)) {
        throw new ForbiddenError('No access to this shop');
      }

      const VALID_STATUSES = VALID_ORDER_STATUSES;
      const status = req.query.status && VALID_STATUSES.includes(req.query.status) ? req.query.status : undefined;
      const seq    = req.query.seq ? Number(req.query.seq) : undefined;
      const date   = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
      const ref    = req.query.ref ? String(req.query.ref).trim().toUpperCase() : undefined;
      const limit  = Math.min(Number(req.query.limit  ?? ORDER_DEFAULT_LIMIT), ORDER_MAX_LIMIT);
      const offset = Number(req.query.offset ?? 0);
      const list = await orderRepository.listByShop(shopId, { limit, offset, status, seq, date, ref });
      return reply.send({ success: true, data: list, meta: meta(req) });
    },
  );

  // GET /shops/:shopId/orders/count  — any shop member
  app.get<{ Params: { shopId: string }; Querystring: { status?: string; seq?: string; date?: string; ref?: string } }>(
    '/shops/:shopId/orders/count', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      const { shopId } = req.params;
      const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
      if (!userShops.some((s) => s.id === shopId)) {
        throw new ForbiddenError('No access to this shop');
      }

      const VALID_STATUSES = VALID_ORDER_STATUSES;
      const status = req.query.status && VALID_STATUSES.includes(req.query.status) ? req.query.status : undefined;
      const seq    = req.query.seq ? Number(req.query.seq) : undefined;
      const date   = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
      const ref    = req.query.ref ? String(req.query.ref).trim().toUpperCase() : undefined;
      const count = await orderRepository.countByShop(shopId, { status, seq, date, ref });
      return reply.send({ success: true, data: { count }, meta: meta(req) });
    },
  );

  // PATCH /shops/:shopId/orders/:orderId/status  — owner/manager only
  app.patch<{ Params: { shopId: string; orderId: string }; Body: unknown }>(
    '/shops/:shopId/orders/:orderId/status', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

      const order = await orderRepository.getById(req.params.orderId, req.params.shopId);
      if (!order) throw new NotFoundError('Order');
      if (order.status === 'void') throw new ValidationError({}, 'Order is already voided');

      const updated = await orderRepository.updateStatus(req.params.orderId, req.params.shopId, parsed.data.status);
      return reply.send({ success: true, data: updated, meta: meta(req) });
    },
  );

  // ── POST /shops/:shopId/orders/:orderId/refund/request-otp ────────────
  // cashier+ เรียกได้ — สร้าง OTP แล้วส่ง Telegram
  app.post<{ Params: { shopId: string; orderId: string } }>(
    '/shops/:shopId/orders/:orderId/refund/request-otp', {
      preHandler: [app.auth],
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    }, async (req, reply) => {
      await guardShop(req);
      const { shopId, orderId } = req.params;

      const order = await orderRepository.getById(orderId, shopId);
      if (!order) throw new NotFoundError('Order');
      if (order.status !== 'paid') {
        throw new ValidationError({}, 'สามารถคืนเงินได้เฉพาะออเดอร์ที่ชำระแล้วเท่านั้น');
      }

      const shop = await shopRepository.getShopById(shopId);
      if (!shop) throw new NotFoundError('Shop');

      const otp        = Math.floor(1000 + Math.random() * 9000).toString();
      const expiresAt  = new Date(Date.now() + OTP_EXPIRY_MS);
      await orderRepository.saveRefundOtp(orderId, shopId, otp, expiresAt);

      // Send via Telegram — include requester email
      const requesterEmail = req.auth!.email ?? undefined;
      await sendRefundOtp(
        (shop as Record<string, unknown>).telegram_chat_id as string | null,
        otp,
        shop.name,
        requesterEmail,
      );

      return reply.send({
        success: true,
        data: { message: 'ส่งรหัสยืนยันไปยัง Telegram แล้ว รหัสหมดอายุใน 10 นาที' },
        meta: meta(req),
      });
    },
  );

  // ── POST /shops/:shopId/orders/:orderId/refund ────────────────────────
  // cashier+ เรียกได้ — ตรวจสอบ OTP + ทำ refund
  const refundSchema = z.object({
    otp:           z.string().length(4),
    reason:        z.string().min(1).max(500),
    refund_type:   z.enum(['money_mistake', 'product_return']),
    cash_received: z.number().positive().optional(),
  }).refine(
    (d) => d.refund_type !== 'money_mistake' || d.cash_received != null,
    { message: 'cash_received is required for money_mistake refund type', path: ['cash_received'] },
  );

  app.post<{ Params: { shopId: string; orderId: string }; Body: unknown }>(
    '/shops/:shopId/orders/:orderId/refund', {
      preHandler: [app.auth],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
      await guardShop(req);
      const { shopId, orderId } = req.params;

      const parsed = refundSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
      const { otp, reason, refund_type, cash_received } = parsed.data;

      const order = await orderRepository.getById(orderId, shopId);
      if (!order) throw new NotFoundError('Order');
      if (order.status !== 'paid') {
        throw new ValidationError({}, 'สามารถคืนเงินได้เฉพาะออเดอร์ที่ชำระแล้วเท่านั้น');
      }

      // Validate OTP
      if (!order.refund_otp || order.refund_otp !== otp) {
        throw new ValidationError({}, 'รหัสยืนยันไม่ถูกต้อง');
      }
      if (!order.refund_otp_expires_at || order.refund_otp_expires_at < new Date()) {
        throw new ValidationError({}, 'รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่');
      }

      const userId = req.auth!.userId;

      // Apply refund
      await orderRepository.applyRefund(orderId, shopId, { reason, refund_type, refunded_by: userId, cash_received });

      // คืน stock + points เฉพาะประเภท product_return
      if (refund_type === 'product_return') {
        const items = await db.select().from(orderItems).where(eq(orderItems.order_id, orderId));
        await Promise.all(
          items.map((item) =>
            stockRepository.deductStock(order.branch_id, item.product_id, -item.quantity, {
              shopId,
              userId,
              note: `คืนเงินออเดอร์ #${order.daily_seq ?? order.order_number}`,
            }),
          ),
        );

        if (order.customer_id && order.points_earned > 0) {
          await customerRepository.deductPoints(shopId, order.customer_id, order.points_earned);
        }
      }

      // Audit log
      await logRepository.insert({
        shop_id:     shopId,
        user_id:     userId,
        action:      'ORDER_REFUNDED',
        entity_type: 'order',
        entity_id:   orderId,
        payload:     { order_id: orderId, reason, refund_type, refunded_by: userId, refunded_by_email: req.auth!.email ?? null, total: order.total, cash_received: cash_received ?? null },
      });

      // Telegram confirmation — แจ้งว่าใครทำ refund
      const shopForTg = await shopRepository.getShopById(shopId);
      if (shopForTg) {
        void sendRefundConfirmed(
          (shopForTg as Record<string, unknown>).telegram_chat_id as string | null,
          {
            shopName:      shopForTg.name,
            orderSeq:      order.daily_seq ?? order.order_number,
            total:         order.total,
            refundType:    refund_type,
            reason,
            refundedBy:    req.auth!.email ?? userId,
            cashReceived:  cash_received,
          },
        );
      }

      return reply.send({
        success: true,
        data: { message: 'คืนเงินสำเร็จ', order_id: orderId },
        meta: meta(req),
      });
    },
  );
};

export { ordersRoutes };
