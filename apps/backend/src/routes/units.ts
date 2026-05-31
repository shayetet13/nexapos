import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { shopUnits } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAdminShop, guardShop } from '../lib/admin-guard.js';
import { ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';

const createUnitSchema = z.object({
  name: z.string().min(1).max(50).trim(),
});

const unitsRoutes: FastifyPluginAsync = async (app) => {

  // GET /shops/:shopId/units
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/units', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await guardShop(req);
    const rows = await db
      .select()
      .from(shopUnits)
      .where(eq(shopUnits.shop_id, req.params.shopId))
      .orderBy(shopUnits.name);
    return reply.send({ success: true, data: rows, meta: meta(req) });
  });

  // POST /shops/:shopId/units
  app.post<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/units', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const parsed = createUnitSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const [row] = await db
      .insert(shopUnits)
      .values({ shop_id: req.params.shopId, name: parsed.data.name })
      .returning();
    return reply.status(201).send({ success: true, data: row, meta: meta(req) });
  });

  // DELETE /shops/:shopId/units/:unitId
  app.delete<{ Params: { shopId: string; unitId: string } }>(
    '/shops/:shopId/units/:unitId', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);
      await db
        .delete(shopUnits)
        .where(and(eq(shopUnits.id, req.params.unitId), eq(shopUnits.shop_id, req.params.shopId)));
      return reply.status(204).send();
    },
  );
};

export { unitsRoutes };
