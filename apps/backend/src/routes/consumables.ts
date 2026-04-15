import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { consumableRepository } from '../repositories/consumable.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { NotFoundError, ForbiddenError } from '../lib/errors.js';

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

  // ── Guard: verify caller belongs to shop ────────────────────────
  async function guardShop(userId: string, shopId: string) {
    const role = await shopRepository.getUserRoleForShop(userId, shopId);
    if (!role) throw new ForbiddenError('No access to this shop');
    return role;
  }

  // ── LIST consumables ─────────────────────────────────────────────
  app.get('/shops/:shopId/consumables', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardShop(req.auth!.userId, shopId);
    const data = await consumableRepository.listByShop(shopId);
    return reply.send({ success: true, data });
  });

  // ── CREATE consumable ────────────────────────────────────────────
  app.post('/shops/:shopId/consumables', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardShop(req.auth!.userId, shopId);
    const body = createConsumableSchema.parse(req.body);
    const data = await consumableRepository.create(shopId, body);
    return reply.status(201).send({ success: true, data });
  });

  // ── UPDATE consumable ────────────────────────────────────────────
  app.patch('/shops/:shopId/consumables/:id', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId, id } = req.params as { shopId: string; id: string };
    await guardShop(req.auth!.userId, shopId);
    const body = updateConsumableSchema.parse(req.body);
    const data = await consumableRepository.update(id, shopId, body);
    if (!data) throw new NotFoundError('Consumable not found');
    return reply.send({ success: true, data });
  });

  // ── DELETE consumable ────────────────────────────────────────────
  app.delete('/shops/:shopId/consumables/:id', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId, id } = req.params as { shopId: string; id: string };
    await guardShop(req.auth!.userId, shopId);
    const data = await consumableRepository.delete(id, shopId);
    if (!data) throw new NotFoundError('Consumable not found');
    return reply.send({ success: true, data });
  });

  // ── GET BOM for a product ────────────────────────────────────────
  app.get('/shops/:shopId/products/:productId/bom', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId, productId } = req.params as { shopId: string; productId: string };
    await guardShop(req.auth!.userId, shopId);
    const data = await consumableRepository.getBOM(productId);
    return reply.send({ success: true, data });
  });

  // ── SET (replace) BOM for a product ─────────────────────────────
  app.put('/shops/:shopId/products/:productId/bom', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId, productId } = req.params as { shopId: string; productId: string };
    await guardShop(req.auth!.userId, shopId);
    const { items } = bomSchema.parse(req.body);
    const data = await consumableRepository.setBOM(productId, items);
    return reply.send({ success: true, data });
  });
};
