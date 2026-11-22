import type { FastifyPluginAsync } from 'fastify';
import { createCustomerSchema, updateCustomerSchema } from '@nexapos/shared';
import { shopRepository } from '../repositories/shop.repository.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { requireFeature } from '../lib/admin-guard.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';
import { audit } from '../lib/audit.js';

const customersRoutes: FastifyPluginAsync = async (app) => {

  /* ── guard helper ─────────────────────────────────────────── */
  async function guardShop(userId: string, shopId: string) {
    const shops = await shopRepository.getShopsForUser(userId);
    if (!shops.some(s => s.id === shopId)) throw new ForbiddenError('No access');
  }

  /* ── GET /shops/:shopId/customers?q=<search> ──────────────── */
  app.get<{ Params: { shopId: string }; Querystring: { q?: string; limit?: string } }>(
    '/shops/:shopId/customers',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId } = req.params;
      await guardShop(req.auth!.userId, shopId);
      const { q, limit } = req.query;
      const data = q?.trim()
        ? await customerRepository.search(shopId, q.trim(), Number(limit ?? 30))
        : await customerRepository.list(shopId, Number(limit ?? 50));
      return reply.send({ success: true, data, meta: meta(req) });
    },
  );

  /* ── GET /shops/:shopId/customers/:customerId ─────────────── */
  app.get<{ Params: { shopId: string; customerId: string } }>(
    '/shops/:shopId/customers/:customerId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, customerId } = req.params;
      await guardShop(req.auth!.userId, shopId);
      const customer = await customerRepository.getById(shopId, customerId);
      if (!customer) throw new NotFoundError('Customer not found');
      const orders = await customerRepository.listOrders(shopId, customerId);
      return reply.send({ success: true, data: { ...customer, orders }, meta: meta(req) });
    },
  );

  /* ── POST /shops/:shopId/customers ────────────────────────── */
  app.post<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/customers',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId } = req.params;
      await guardShop(req.auth!.userId, shopId);
      await requireFeature(req, 'membership');
      const parsed = createCustomerSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(JSON.stringify(parsed.error.flatten()));
      // Prevent duplicate phone per shop
      if (parsed.data.phone) {
        const existing = await customerRepository.findByPhone(shopId, parsed.data.phone);
        if (existing) {
          return reply.status(409).send({
            success: false,
            error: { code: 'DUPLICATE_PHONE', message: 'เบอร์โทรนี้มีในระบบแล้ว' },
            meta: meta(req),
          });
        }
      }
      const customer = await customerRepository.create(shopId, parsed.data);

      audit.action({
        event:       'create_customer',
        shop_id:     shopId,
        user_id:     req.auth?.userId,
        request_id:  req.id,
        ip_address:  req.ip,
        entity_type: 'customer',
        entity_id:   customer?.id,
        metadata:    { name: customer?.name, phone: customer?.phone },
      });

      return reply.status(201).send({ success: true, data: customer, meta: meta(req) });
    },
  );

  /* ── PATCH /shops/:shopId/customers/:customerId ───────────── */
  app.patch<{ Params: { shopId: string; customerId: string }; Body: unknown }>(
    '/shops/:shopId/customers/:customerId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, customerId } = req.params;
      await guardShop(req.auth!.userId, shopId);
      const parsed = updateCustomerSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(JSON.stringify(parsed.error.flatten()));
      const customer = await customerRepository.update(shopId, customerId, parsed.data);
      if (!customer) throw new NotFoundError('Customer not found');

      audit.action({
        event:       'update_customer',
        shop_id:     shopId,
        user_id:     req.auth?.userId,
        request_id:  req.id,
        ip_address:  req.ip,
        entity_type: 'customer',
        entity_id:   customerId,
        metadata:    { name: customer.name },
      });

      return reply.send({ success: true, data: customer, meta: meta(req) });
    },
  );

  /* ── DELETE /shops/:shopId/customers/:customerId ──────────── */
  app.delete<{ Params: { shopId: string; customerId: string } }>(
    '/shops/:shopId/customers/:customerId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, customerId } = req.params;
      await guardShop(req.auth!.userId, shopId);
      const customer = await customerRepository.getById(shopId, customerId);
      if (!customer) throw new NotFoundError('Customer not found');
      await customerRepository.delete(shopId, customerId);

      audit.action({
        event:       'delete_customer',
        shop_id:     shopId,
        user_id:     req.auth?.userId,
        request_id:  req.id,
        ip_address:  req.ip,
        entity_type: 'customer',
        entity_id:   customerId,
        metadata:    { name: customer?.name },
      });

      return reply.send({ success: true, data: null, meta: meta(req) });
    },
  );

  /* ── GET /shops/:shopId/customers/:customerId/orders ──────── */
  app.get<{ Params: { shopId: string; customerId: string } }>(
    '/shops/:shopId/customers/:customerId/orders',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, customerId } = req.params;
      await guardShop(req.auth!.userId, shopId);
      const orders = await customerRepository.listOrders(shopId, customerId);
      return reply.send({ success: true, data: orders, meta: meta(req) });
    },
  );
};

export { customersRoutes };
