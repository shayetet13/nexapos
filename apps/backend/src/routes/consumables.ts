import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { consumableRepository } from '../repositories/consumable.repository.js';
import { requireAdminShop, guardShop } from '../lib/admin-guard.js';
import { NotFoundError } from '../lib/errors.js';

const createConsumableSchema = z.object({
  name:     z.string().min(1).max(200).trim(),
  unit:     z.string().min(1).max(50).trim().default('ชิ้น'),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).default('0'),
  min_qty:  z.string().regex(/^\d+(\.\d{1,3})?$/).default('0'),
});

const updateConsumableSchema = createConsumableSchema.partial();

const bomSchema = z.object({
  items: z.array(z.object({
    consumable_id: z.string().uuid(),
    qty_per_unit:  z.string().regex(/^\d+(\.\d{1,3})?$/),
  })),
});

export const consumablesRoutes: FastifyPluginAsync = async (app) => {

  // ── LIST consumables — any shop member ──────────────────────────
  app.get('/shops/:shopId/consumables', { preHandler: [app.auth] }, async (req, reply) => {
    await guardShop(req);
    const { shopId } = req.params as { shopId: string };
    const data = await consumableRepository.listByShop(shopId);
    return reply.send({ success: true, data });
  });

  // ── CREATE consumable — owner/manager only ───────────────────────
  app.post('/shops/:shopId/consumables', { preHandler: [app.auth] }, async (req, reply) => {
    await requireAdminShop(req);
    const { shopId } = req.params as { shopId: string };
    const body = createConsumableSchema.parse(req.body);
    const data = await consumableRepository.create(shopId, body);
    return reply.status(201).send({ success: true, data });
  });

  // ── UPDATE consumable — owner/manager only ───────────────────────
  app.patch('/shops/:shopId/consumables/:id', { preHandler: [app.auth] }, async (req, reply) => {
    await requireAdminShop(req);
    const { shopId, id } = req.params as { shopId: string; id: string };
    const body = updateConsumableSchema.parse(req.body);
    const data = await consumableRepository.update(id, shopId, body);
    if (!data) throw new NotFoundError('Consumable not found');
    return reply.send({ success: true, data });
  });

  // ── DELETE consumable — owner/manager only ───────────────────────
  app.delete('/shops/:shopId/consumables/:id', { preHandler: [app.auth] }, async (req, reply) => {
    await requireAdminShop(req);
    const { shopId, id } = req.params as { shopId: string; id: string };
    const data = await consumableRepository.delete(id, shopId);
    if (!data) throw new NotFoundError('Consumable not found');
    return reply.send({ success: true, data });
  });

  // ── GET BOM for a product — any shop member ──────────────────────
  app.get('/shops/:shopId/products/:productId/bom', { preHandler: [app.auth] }, async (req, reply) => {
    await guardShop(req);
    const { productId } = req.params as { shopId: string; productId: string };
    const data = await consumableRepository.getBOM(productId);
    return reply.send({ success: true, data });
  });

  // ── SET (replace) BOM for a product — owner/manager only ─────────
  app.put('/shops/:shopId/products/:productId/bom', { preHandler: [app.auth] }, async (req, reply) => {
    await requireAdminShop(req);
    const { productId } = req.params as { shopId: string; productId: string };
    const { items } = bomSchema.parse(req.body);
    const data = await consumableRepository.setBOM(productId, items);
    return reply.send({ success: true, data });
  });
};
