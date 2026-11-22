import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { shopRepository } from '../repositories/shop.repository.js';
import {
  diningRepository,
  diningSessionRepository,
  countOpenSessionsForTable,
} from '../repositories/dining.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { closeDiningSession } from '../services/dining.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { guardShop, requireAdminShop, requireOwnerShop } from '../lib/admin-guard.js';

const createTableSchema = z.object({
  branch_id:   z.string().uuid(),
  label:       z.string().min(1).max(80).trim(),
  capacity:    z.number().int().min(1).max(99).optional(),
  sort_order:  z.number().int().min(0).max(99_999).optional(),
  is_active:   z.boolean().optional(),
});

const patchTableSchema = z.object({
  label:      z.string().min(1).max(80).trim().optional(),
  capacity:   z.number().int().min(1).max(99).nullable().optional(),
  sort_order: z.number().int().min(0).max(99_999).optional(),
  is_active:  z.boolean().optional(),
});

const openSessionSchema = z.object({
  branch_id:        z.string().uuid(),
  dining_table_id: z.string().uuid(),
  guest_count:     z.number().int().min(1).max(99).optional(),
});

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

const diningRoutes: FastifyPluginAsync = async (app) => {
  // GET /shops/:shopId/dining-tables?branchId=
  app.get<{
    Params: { shopId: string };
    Querystring: { branchId?: string };
  }>('/shops/:shopId/dining-tables', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId } = req.params;
    const { branchId } = req.query;
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }
    if (!branchId) throw new ValidationError({ branchId: ['branchId is required'] });
    const br = await shopRepository.getBranchById(branchId, shopId);
    if (!br) throw new NotFoundError('Branch');
    const list = await diningRepository.listTables(shopId, branchId);
    return reply.send({ success: true, data: list, meta: meta(req) });
  });

  // POST /shops/:shopId/dining-tables
  app.post<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/dining-tables', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId } = req.params;
    await requireAdminShop(req);
    const parsed = createTableSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(JSON.stringify(parsed.error.flatten()));
    }
    const { branch_id, label, capacity, sort_order, is_active } = parsed.data;
    const shop = await shopRepository.getShopById(shopId);
    if (shop?.shop_mode !== 'full_service_restaurant') {
      throw new ValidationError('ร้านนี้ไม่ใช่โหมดภัตตาคาร');
    }
    const br = await shopRepository.getBranchById(branch_id, shopId);
    if (!br) throw new NotFoundError('Branch');
    const row = await diningRepository.insertTable(shopId, { branch_id, label, capacity, sort_order, is_active });
    if (!row) throw new Error('create table failed');
    audit.action({
      event:       'dining_table_create',
      shop_id:     shopId,
      user_id:     req.auth?.userId,
      request_id:  req.id,
      ip_address:  req.ip,
      entity_type: 'dining_table',
      entity_id:   row.id,
      metadata:    { label, branch_id },
    });
    return reply.status(201).send({ success: true, data: row, meta: meta(req) });
  });

  // PATCH /shops/:shopId/dining-tables/:tableId
  app.patch<{
    Params: { shopId: string; tableId: string };
    Body: unknown;
  }>('/shops/:shopId/dining-tables/:tableId', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId, tableId } = req.params;
    await requireAdminShop(req);
    const parsed = patchTableSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(JSON.stringify(parsed.error.flatten()));
    }
    const row = await diningRepository.updateTable(tableId, shopId, parsed.data);
    if (!row) throw new NotFoundError('Table');
    return reply.send({ success: true, data: row, meta: meta(req) });
  });

  // DELETE /shops/:shopId/dining-tables/:tableId
  app.delete<{
    Params: { shopId: string; tableId: string };
  }>('/shops/:shopId/dining-tables/:tableId', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId, tableId } = req.params;
    await requireOwnerShop(req);
    const n = await countOpenSessionsForTable(tableId);
    if (n > 0) {
      throw new ValidationError('ปิดเซสชันที่โต๊ะนี้ก่อนลบ');
    }
    const row = await diningRepository.deleteTable(tableId, shopId);
    if (!row) throw new NotFoundError('Table');
    return reply.status(204).send();
  });

  // GET /shops/:shopId/dining-sessions?branchId=
  app.get<{
    Params: { shopId: string };
    Querystring: { branchId?: string; status?: string };
  }>('/shops/:shopId/dining-sessions', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId } = req.params;
    const { branchId, status } = req.query;
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }
    if (!branchId) throw new ValidationError({ branchId: ['branchId is required'] });
    if (status === 'open' || status === undefined) {
      const data = await diningSessionRepository.listOpen(shopId, branchId);
      return reply.send({
        success: true,
        data:    data.map((d) => ({
          ...d.session,
          table_label: d.tableLabel,
          branch_name: d.branchName,
        })),
        meta: meta(req),
      });
    }
    return reply.send({ success: true, data: [], meta: meta(req) });
  });

  // POST /shops/:shopId/dining-sessions
  app.post<{
    Params: { shopId: string };
    Body: unknown;
  }>('/shops/:shopId/dining-sessions', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId } = req.params;
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }
    const shop = await shopRepository.getShopById(shopId);
    if (shop?.shop_mode !== 'full_service_restaurant') {
      throw new ValidationError('ร้านนี้ไม่ใช่โหมดภัตตาคาร');
    }
    const parsed = openSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(JSON.stringify(parsed.error.flatten()));
    }
    const { branch_id, dining_table_id, guest_count } = parsed.data;
    const br = await shopRepository.getBranchById(branch_id, shopId);
    if (!br) throw new NotFoundError('Branch');
    const table = await diningRepository.getTableById(dining_table_id, shopId);
    if (!table || table.branch_id !== branch_id) {
      throw new NotFoundError('Table');
    }
    const openCount = await countOpenSessionsForTable(dining_table_id);
    if (openCount > 0) {
      throw new ValidationError('โต๊ะนี้มีเซสชันเปิดอยู่');
    }
    const row = await diningSessionRepository.create(shopId, {
      branch_id,
      dining_table_id,
      guest_count: guest_count ?? null,
    });
    if (!row) throw new Error('open session failed');
    audit.action({
      event:       'dining_session_open',
      shop_id:     shopId,
      user_id:     req.auth?.userId,
      request_id:  req.id,
      ip_address:  req.ip,
      entity_type: 'dining_session',
      entity_id:   row.id,
      metadata:    { table_id: dining_table_id, branch_id },
    });
    return reply.status(201).send({ success: true, data: row, meta: meta(req) });
  });

  // GET /shops/:shopId/dining-sessions/:sessionId/pending-total
  app.get<{
    Params: { shopId: string; sessionId: string };
  }>('/shops/:shopId/dining-sessions/:sessionId/pending-total', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId, sessionId } = req.params;
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }
    const se = await diningSessionRepository.getById(sessionId, shopId);
    if (!se) throw new NotFoundError('Session');
    const pending = await orderRepository.listPendingByDiningSession(shopId, sessionId);
    const sub     = pending.reduce((s, o) => s + Number(o.total), 0);
    return reply.send({
      success: true,
      data:    { session: se, pending_orders: pending, subtotal: r2(sub) },
      meta:    meta(req),
    });
  });

  // POST /shops/:shopId/dining-sessions/:sessionId/close
  app.post<{
    Params: { shopId: string; sessionId: string };
    Body: unknown;
  }>('/shops/:shopId/dining-sessions/:sessionId/close', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { shopId, sessionId } = req.params;
    await guardShop(req);
    await userRepository.upsertUser(req.auth!.userId, req.auth!.email);
    const result = await closeDiningSession(shopId, req.auth!.userId, sessionId, req.body);
    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error, meta: meta(req) });
    }
    audit.action({
      event:       'dining_session_close',
      shop_id:     shopId,
      user_id:     req.auth?.userId,
      request_id:  req.id,
      ip_address:  req.ip,
      entity_type: 'dining_session',
      entity_id:   sessionId,
      metadata:    { total: result.total, order_ids: result.orderIds },
    });
    return reply.send({
      success: true,
      data:    {
        sessionId:     result.sessionId,
        total:         result.total,
        orderIds:      result.orderIds,
        receiptToken:  result.primaryReceiptToken,
        dailySeq:      result.primaryDailySeq,
      },
      meta: meta(req),
    });
  });
};

export { diningRoutes };
