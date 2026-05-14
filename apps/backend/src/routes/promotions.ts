import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { promotions, combos, comboItems } from '../db/schema.js';
import { db } from '../db/index.js';
import { and, eq, inArray } from 'drizzle-orm';
import { requireAdminShop, guardShop, requireFeature } from '../lib/admin-guard.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';

const promoSchema = z.object({
  name:  z.string().min(1).max(200),
  type:  z.enum(['percent', 'fixed']),
  value: z.number().min(0).max(999999),
  color: z.string().max(50).optional(),
  is_active: z.boolean().optional(),
});

const comboSchema = z.object({
  name:  z.string().min(1).max(200),
  price: z.number().min(0).max(999999),
  is_active: z.boolean().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity:   z.number().int().min(1).max(9999),
  })).min(1).max(50),
});

export const promotionsRoutes: FastifyPluginAsync = async (app) => {

  /* ── GET /shops/:shopId/promotions ─────────────────────────── */
  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/promotions',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId } = req.params;
      await guardShop(req);

      const promoRows = await db
        .select()
        .from(promotions)
        .where(eq(promotions.shop_id, shopId));

      const comboRows = await db
        .select()
        .from(combos)
        .where(eq(combos.shop_id, shopId));

      const comboIds = comboRows.map(c => c.id);
      let itemsByCombo: Record<string, Array<{ product_id: string; quantity: number }>> = {};
      if (comboIds.length > 0) {
        const rows = await db
          .select({
            combo_id:   comboItems.combo_id,
            product_id: comboItems.product_id,
            quantity:   comboItems.quantity,
          })
          .from(comboItems)
          .where(inArray(comboItems.combo_id, comboIds));
        itemsByCombo = rows.reduce<Record<string, Array<{ product_id: string; quantity: number }>>>(
          (acc, r) => {
            if (!acc[r.combo_id]) acc[r.combo_id] = [];
            acc[r.combo_id]!.push({ product_id: r.product_id, quantity: r.quantity });
            return acc;
          },
          {},
        );
      }

      const comboWithItems = comboRows.map(c => ({
        ...c,
        items: itemsByCombo[c.id] ?? [],
      }));

      return reply.send({
        success: true,
        data: {
          promotions: promoRows,
          combos: comboWithItems,
        },
        meta: meta(req),
      });
    },
  );

  /* ── POST /shops/:shopId/promotions ────────────────────────── */
  app.post<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/promotions',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId } = req.params;
      await requireAdminShop(req);
      await requireFeature(req, 'promotions');
      const parsed = promoSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(JSON.stringify(parsed.error.flatten()));
      const [row] = await db
        .insert(promotions)
        .values({
          shop_id: shopId,
          name: parsed.data.name,
          type: parsed.data.type,
          value: String(parsed.data.value),
          color: parsed.data.color ?? null,
          is_active: parsed.data.is_active ?? true,
        })
        .returning();
      return reply.status(201).send({ success: true, data: row, meta: meta(req) });
    },
  );

  /* ── PATCH /shops/:shopId/promotions/:promotionId ──────────── */
  app.patch<{ Params: { shopId: string; promotionId: string }; Body: unknown }>(
    '/shops/:shopId/promotions/:promotionId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, promotionId } = req.params;
      await requireAdminShop(req);
      const parsed = promoSchema.partial().safeParse(req.body);
      if (!parsed.success) throw new ValidationError(JSON.stringify(parsed.error.flatten()));
      const [row] = await db
        .update(promotions)
        .set({
          ...(parsed.data.name      !== undefined ? { name:      parsed.data.name }                    : {}),
          ...(parsed.data.type      !== undefined ? { type:      parsed.data.type }                    : {}),
          ...(parsed.data.value     !== undefined ? { value:     String(parsed.data.value) }           : {}),
          ...(parsed.data.color     !== undefined ? { color:     parsed.data.color }                   : {}),
          ...(parsed.data.is_active !== undefined ? { is_active: parsed.data.is_active }               : {}),
        })
        .where(and(eq(promotions.shop_id, shopId), eq(promotions.id, promotionId)))
        .returning();
      if (!row) throw new NotFoundError('Promotion not found');
      return reply.send({ success: true, data: row, meta: meta(req) });
    },
  );

  /* ── DELETE /shops/:shopId/promotions/:promotionId ─────────── */
  app.delete<{ Params: { shopId: string; promotionId: string } }>(
    '/shops/:shopId/promotions/:promotionId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, promotionId } = req.params;
      await requireAdminShop(req);
      const [row] = await db
        .delete(promotions)
        .where(and(eq(promotions.shop_id, shopId), eq(promotions.id, promotionId)))
        .returning();
      if (!row) throw new NotFoundError('Promotion not found');
      return reply.send({ success: true, data: null, meta: meta(req) });
    },
  );

  /* ── POST /shops/:shopId/combos ────────────────────────────── */
  app.post<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/combos',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId } = req.params;
      await requireAdminShop(req);
      await requireFeature(req, 'promotions');
      const parsed = comboSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(JSON.stringify(parsed.error.flatten()));

      const created = await db.transaction(async (tx) => {
        const [comboRow] = await tx
          .insert(combos)
          .values({
            shop_id: shopId,
            name: parsed.data.name,
            price: String(parsed.data.price),
            is_active: parsed.data.is_active ?? true,
          })
          .returning();
        await tx.insert(comboItems).values(
          parsed.data.items.map(it => ({
            combo_id: comboRow!.id,
            product_id: it.product_id,
            quantity: it.quantity,
          })),
        );
        return comboRow;
      });

      return reply.status(201).send({ success: true, data: created, meta: meta(req) });
    },
  );

  /* ── PATCH /shops/:shopId/combos/:comboId ──────────────────── */
  app.patch<{ Params: { shopId: string; comboId: string }; Body: unknown }>(
    '/shops/:shopId/combos/:comboId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, comboId } = req.params;
      await requireAdminShop(req);
      const parsed = comboSchema.partial().safeParse(req.body);
      if (!parsed.success) throw new ValidationError(JSON.stringify(parsed.error.flatten()));

      const updated = await db.transaction(async (tx) => {
        const [comboRow] = await tx
          .update(combos)
          .set({
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.price !== undefined ? { price: String(parsed.data.price) } : {}),
            ...(parsed.data.is_active !== undefined ? { is_active: parsed.data.is_active } : {}),
          })
          .where(and(eq(combos.shop_id, shopId), eq(combos.id, comboId)))
          .returning();
        if (!comboRow) return null;

        if (parsed.data.items) {
          await tx
            .delete(comboItems)
            .where(eq(comboItems.combo_id, comboId));
          await tx.insert(comboItems).values(
            parsed.data.items.map(it => ({
              combo_id: comboId,
              product_id: it.product_id,
              quantity: it.quantity,
            })),
          );
        }
        return comboRow;
      });

      if (!updated) throw new NotFoundError('Combo not found');
      return reply.send({ success: true, data: updated, meta: meta(req) });
    },
  );

  /* ── DELETE /shops/:shopId/combos/:comboId ─────────────────── */
  app.delete<{ Params: { shopId: string; comboId: string } }>(
    '/shops/:shopId/combos/:comboId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, comboId } = req.params;
      await requireAdminShop(req);
      const [row] = await db
        .delete(combos)
        .where(and(eq(combos.shop_id, shopId), eq(combos.id, comboId)))
        .returning();
      if (!row) throw new NotFoundError('Combo not found');
      await db.delete(comboItems).where(eq(comboItems.combo_id, comboId));
      return reply.send({ success: true, data: null, meta: meta(req) });
    },
  );
};

