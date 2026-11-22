import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { withdrawalRepository } from '../repositories/withdrawal.repository.js';
import { consumableRepository } from '../repositories/consumable.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { logRepository } from '../repositories/log.repository.js';
import { broadcast } from '../lib/ws-broadcast.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { db } from '../db/index.js';
import { products, branchStock } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const withdrawItemSchema = z.object({
  type: z.enum(['consumable', 'product']),
  id:   z.string().uuid(),
  name: z.string().min(1).max(200),
  unit: z.string().min(1).max(50),
  qty:  z.number().positive(),
});

const createWithdrawalSchema = z.object({
  branch_id:  z.string().uuid(),
  staff_name: z.string().min(1).max(100).trim(),
  note:       z.string().max(500).optional(),
  items:      z.array(withdrawItemSchema).min(1),
});

export const withdrawalsRoutes: FastifyPluginAsync = async (app) => {

  // ── Guard: shop member (cashier/manager/owner) ───────────────────
  async function guardAdmin(userId: string, shopId: string) {
    const role = await shopRepository.getUserRoleForShop(userId, shopId);
    if (!role || (role !== 'owner' && role !== 'manager' && role !== 'cashier')) {
      throw new ForbiddenError('Shop member required');
    }
    return role;
  }

  // ── GET available items for withdrawal ───────────────────────────
  // Public — staff scans QR without auth
  app.get('/shops/:shopId/withdrawals/items', async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    const { branchId } = req.query as { branchId?: string };

    const [consumableList, productList] = await Promise.all([
      consumableRepository.listByShop(shopId),
      db.select({
        id:       products.id,
        name:     products.name,
        unit:     products.unit,
        category: products.category,
        quantity: branchStock.quantity,
      })
        .from(products)
        .leftJoin(
          branchStock,
          and(
            eq(branchStock.product_id, products.id),
            branchId ? eq(branchStock.branch_id, branchId) : undefined,
          ),
        )
        .where(and(
          eq(products.shop_id, shopId),
          eq(products.show_on_pos, false),
        )),
    ]);

    return reply.send({
      success: true,
      data: {
        consumables: consumableList.map(c => ({
          type:     'consumable' as const,
          id:       c.id,
          name:     c.name,
          unit:     c.unit,
          quantity: Number(c.quantity),
          min_qty:  Number(c.min_qty),
        })),
        products: productList.map(p => ({
          type:     'product' as const,
          id:       p.id,
          name:     p.name,
          unit:     p.unit ?? 'ชิ้น',
          quantity: p.quantity ?? 0,
        })),
      },
    });
  });

  // ── CREATE withdrawal request — no auth (staff scans QR) ─────────
  app.post('/shops/:shopId/withdrawals', async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    const body = createWithdrawalSchema.parse(req.body);

    const wr = await withdrawalRepository.create({
      shop_id:    shopId,
      branch_id:  body.branch_id,
      staff_name: body.staff_name,
      note:       body.note,
      items:      body.items,
    });

    if (!wr) {
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create withdrawal request' } });
    }

    // Notify POS cashier via WebSocket
    broadcast(shopId, 'WITHDRAWAL_REQUEST', {
      id:         wr.id,
      staff_name: wr.staff_name,
      branch_id:  wr.branch_id,
      note:       wr.note ?? '',
      items:      wr.items,
      created_at: wr.created_at.toISOString(),
    });

    return reply.status(201).send({ success: true, data: { id: wr.id } });
  });

  // ── GET pending withdrawal requests ─────────────────────────────
  app.get('/shops/:shopId/withdrawals/pending', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardAdmin(req.auth!.userId, shopId);
    const data = await withdrawalRepository.listPending(shopId);
    return reply.send({ success: true, data });
  });

  // ── APPROVE withdrawal ───────────────────────────────────────────
  app.patch('/shops/:shopId/withdrawals/:id/approve', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId, id } = req.params as { shopId: string; id: string };
    await guardAdmin(req.auth!.userId, shopId);

    const updated = await withdrawalRepository.approve(id, shopId, req.auth!.userId);
    if (!updated) throw new NotFoundError('Withdrawal request not found or already processed');

    broadcast(shopId, 'WITHDRAWAL_APPROVED', {
      id:         updated.id,
      staff_name: updated.staff_name,
      items:      updated.items,
    });

    await logRepository.insert({
      shop_id:     shopId,
      action:      'WITHDRAWAL_APPROVED',
      entity_type: 'withdrawal_request',
      entity_id:   id,
      payload:     { staff_name: updated.staff_name, items: updated.items },
      user_id:     req.auth!.userId,
    });

    return reply.send({ success: true });
  });

  // ── REJECT withdrawal ────────────────────────────────────────────
  app.patch('/shops/:shopId/withdrawals/:id/reject', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId, id } = req.params as { shopId: string; id: string };
    await guardAdmin(req.auth!.userId, shopId);

    const updated = await withdrawalRepository.reject(id, shopId);
    if (!updated) throw new NotFoundError('Withdrawal request not found or already processed');

    broadcast(shopId, 'WITHDRAWAL_REJECTED', { id });

    return reply.send({ success: true });
  });

  // ── PUBLIC: check single withdrawal request status (no auth) ────
  // Used by staff mobile page to poll approval without JWT
  app.get('/public/withdrawals/:requestId/status', async (req, reply) => {
    const { requestId } = req.params as { requestId: string };
    const { shop } = req.query as { shop?: string };

    if (!shop || !/^[0-9a-f-]{36}$/i.test(shop) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      return reply.status(400).send({ success: false, error: 'Invalid parameters' });
    }

    const wr = await withdrawalRepository.getById(requestId, shop);
    if (!wr) return reply.status(404).send({ success: false, error: 'Not found' });

    return reply.send({ success: true, data: { id: wr.id, status: wr.status } });
  });
};
