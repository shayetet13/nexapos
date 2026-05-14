import { z } from 'zod';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { productRepository } from '../repositories/product.repository.js';
import { stockRepository } from '../repositories/stock.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { requireAdminShop, requireFeature, requirePlanLimit, guardShop } from '../lib/admin-guard.js';
import { NotFoundError, ValidationError, InternalError, ForbiddenError } from '../lib/errors.js';
import { db } from '../db/index.js';
import { products as productsTable } from '../db/schema.js';
import { eq, and, count, isNull } from 'drizzle-orm';
import { meta } from '../lib/response.js';
import { broadcast } from '../lib/ws-broadcast.js';
import { audit } from '../lib/audit.js';

// ── Zod schemas ──────────────────────────────────────────────────
const createProductSchema = z.object({
  name:        z.string().min(1, 'Name is required').max(200).trim(),
  sku:         z.string().max(100).optional(),
  price:       z.string().regex(/^\d+(\.\d{1,2})?$/, 'Price must be a non-negative number (e.g. 99.99)').optional().default('0'),
  cost_price:  z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  unit:        z.string().max(50).optional(),
  category:    z.string().max(100).optional().nullable(),
  barcode:     z.string().max(100).optional().nullable(),
  image_url:   z.string().url('image_url must be a valid URL').nullable().optional(),
  show_on_pos: z.boolean().optional().default(true),
});

const updateProductSchema = createProductSchema.partial();

const updateStockSchema = z.object({
  quantity: z
    .number({ invalid_type_error: 'quantity must be a number' })
    .int('quantity must be an integer')
    .min(0, 'quantity must be >= 0'),
});

const updateMinQtySchema = z.object({
  branch_id:  z.string().uuid(),
  product_id: z.string().uuid(),
  min_qty:    z.number().int().min(0),
});

const transferStockSchema = z.object({
  from_branch_id: z.string().uuid(),
  to_branch_id:   z.string().uuid(),
  product_id:     z.string().uuid(),
  quantity:       z.number().int().min(1, 'quantity must be >= 1'),
  note:           z.string().max(200).optional(),
});

// ── Routes ───────────────────────────────────────────────────────
const productsRoutes: FastifyPluginAsync = async (app) => {

  // GET /shops/:shopId/products  — ?pos=true filters to show_on_pos=true only
  app.get<{ Params: { shopId: string }; Querystring: { pos?: string } }>('/shops/:shopId/products', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await guardShop(req);
    const posOnly = (req.query as { pos?: string }).pos === 'true';
    const products = posOnly
      ? await productRepository.getByShopIdForPos(req.params.shopId)
      : await productRepository.getByShopId(req.params.shopId);
    return reply.send({ success: true, data: products, meta: meta(req) });
  });

  // POST /shops/:shopId/products
  app.post<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/products', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);

    // ── Plan limit: max_products ──
    const countRows = await db
      .select({ value: count() })
      .from(productsTable)
      .where(and(eq(productsTable.shop_id, req.params.shopId), isNull(productsTable.deleted_at)));
    await requirePlanLimit(req.params.shopId, 'max_products', Number(countRows[0]?.value ?? 0));

    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const { name, sku, price, cost_price, unit, category, barcode, image_url, show_on_pos } = parsed.data;
    const product = await productRepository.create({
      shop_id:     req.params.shopId,
      name,
      sku,
      price:       String(Number(price).toFixed(2)),
      cost_price:  cost_price ? String(Number(cost_price).toFixed(2)) : undefined,
      unit:        unit ?? 'อัน',
      category:    category ?? undefined,
      barcode:     barcode ?? undefined,
      image_url:   image_url ?? undefined,
      show_on_pos: show_on_pos ?? true,
    });
    if (!product) throw new InternalError('Failed to create product');

    // Auto-init stock = 0 for every branch — 1 batch INSERT instead of N queries
    const shopBranches = await shopRepository.getBranchesByShopId(req.params.shopId);
    if (shopBranches.length > 0) {
      await stockRepository.batchInitStock(product.id, shopBranches.map((b) => b.id));
    }

    audit.action({
      event:       'create_product',
      shop_id:     req.params.shopId,
      user_id:     req.auth?.userId,
      role:        (req as FastifyRequest & { shopRole?: string }).shopRole ?? req.auth?.role,
      request_id:  req.id,
      ip_address:  req.ip,
      entity_type: 'product',
      entity_id:   product.id,
      metadata:    { name: product.name, price: product.price, sku: product.sku },
    });

    return reply.status(201).send({ success: true, data: product, meta: meta(req) });
  });

  // PATCH /shops/:shopId/products/:productId
  app.patch<{ Params: { shopId: string; productId: string }; Body: unknown }>(
    '/shops/:shopId/products/:productId', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);

      const parsed = updateProductSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

      const updates: Record<string, unknown> = {};
      const { name, sku, price, cost_price, unit, category, barcode, image_url } = parsed.data;
      if (name       !== undefined) updates.name       = name;
      if (sku        !== undefined) updates.sku        = sku;
      if (price      !== undefined) updates.price      = String(Number(price).toFixed(2));
      if (cost_price !== undefined) updates.cost_price = cost_price ? String(Number(cost_price).toFixed(2)) : null;
      if (unit       !== undefined) updates.unit       = unit;
      if (category   !== undefined) updates.category   = category;
      if (barcode    !== undefined) updates.barcode    = barcode;
      if (image_url  !== undefined) updates.image_url  = image_url;

      const product = await productRepository.update(
        req.params.productId,
        req.params.shopId,
        updates as Parameters<typeof productRepository.update>[2],
      );
      if (!product) throw new NotFoundError('Product');

      audit.action({
        event:       'update_product',
        shop_id:     req.params.shopId,
        user_id:     req.auth?.userId,
        role:        (req as FastifyRequest & { shopRole?: string }).shopRole ?? req.auth?.role,
        request_id:  req.id,
        ip_address:  req.ip,
        entity_type: 'product',
        entity_id:   product.id,
        metadata:    { name: product.name, changes: updates },
      });

      return reply.send({ success: true, data: product, meta: meta(req) });
    },
  );

  // DELETE /shops/:shopId/products/:productId
  app.delete<{ Params: { shopId: string; productId: string } }>(
    '/shops/:shopId/products/:productId', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);

      const deleted = await productRepository.delete(req.params.productId, req.params.shopId);
      if (!deleted) throw new NotFoundError('Product');

      audit.action({
        event:       'delete_product',
        shop_id:     req.params.shopId,
        user_id:     req.auth?.userId,
        role:        (req as FastifyRequest & { shopRole?: string }).shopRole ?? req.auth?.role,
        request_id:  req.id,
        ip_address:  req.ip,
        entity_type: 'product',
        entity_id:   req.params.productId,
        metadata:    { name: deleted.name },
      });

      return reply.status(204).send();
    },
  );

  // GET /shops/:shopId/products/:productId/stock
  app.get<{ Params: { shopId: string; productId: string } }>(
    '/shops/:shopId/products/:productId/stock', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);
      const rows = await stockRepository.getStockByProductInShop(
        req.params.shopId,
        req.params.productId,
      );
      return reply.send({ success: true, data: rows, meta: meta(req) });
    },
  );

  // PUT /shops/:shopId/branches/:branchId/products/:productId/stock
  app.put<{
    Params: { shopId: string; branchId: string; productId: string };
    Body: unknown;
  }>('/shops/:shopId/branches/:branchId/products/:productId/stock', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);

    const parsed = updateStockSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const { shopId, branchId, productId } = req.params;
    const [branch, product] = await Promise.all([
      shopRepository.getBranchById(branchId, shopId),
      productRepository.getActiveById(productId, shopId),
    ]);
    if (!branch)  throw new NotFoundError('Branch');
    if (!product) throw new NotFoundError('Product');

    const userId = req.auth?.userId;
    await stockRepository.upsertStock(branchId, productId, parsed.data.quantity, {
      shopId, userId,
    });

    return reply.send({ success: true, data: null, meta: meta(req) });
  });

  // GET /shops/:shopId/branches/:branchId/pos-stock  — qty map for POS (all members)
  app.get<{ Params: { shopId: string; branchId: string } }>(
    '/shops/:shopId/branches/:branchId/pos-stock',
    { preHandler: [app.auth] },
    async (req, reply) => {
      const { shopId, branchId } = req.params;
      // Any shop member can read — cashiers need to know out-of-stock
      const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
      if (!userShops.some((s) => s.id === shopId)) {
        throw new ForbiddenError('No access to this shop');
      }
      const rows = await stockRepository.getStockByBranch(branchId, shopId);
      return reply.send({
        success: true,
        data: rows.map((r) => ({ product_id: r.product_id, quantity: r.quantity, min_qty: r.min_qty })),
        meta: meta(req),
      });
    },
  );

  // GET /shops/:shopId/stock?limit=500&offset=0  — paginated stock in shop (admin)
  app.get<{
    Params:      { shopId: string };
    Querystring: { limit?: string; offset?: string };
  }>('/shops/:shopId/stock', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const limit  = Math.min(Number(req.query.limit  ?? 500), 1000); // max 1000 per page
    const offset = Math.max(Number(req.query.offset ?? 0),   0);
    const rows = await stockRepository.getAllStockInShop(req.params.shopId, { limit, offset });
    return reply.send({ success: true, data: rows, meta: meta(req) });
  });

  // GET /shops/:shopId/stock/low?branchId=  — items below min_qty, optionally filtered by branch (admin)
  app.get<{
    Params:      { shopId: string };
    Querystring: { branchId?: string };
  }>('/shops/:shopId/stock/low', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const { branchId } = req.query as { branchId?: string };
    const rows = await stockRepository.getLowStockItems(req.params.shopId, branchId || undefined);
    return reply.send({ success: true, data: rows, meta: meta(req) });
  });

  // PUT /shops/:shopId/stock/min-qty  — update alert threshold (admin)
  app.put<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/stock/min-qty', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);
      const parsed = updateMinQtySchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);
      const row = await stockRepository.updateMinQty(
        parsed.data.branch_id,
        parsed.data.product_id,
        parsed.data.min_qty,
      );
      return reply.send({ success: true, data: row, meta: meta(req) });
    },
  );

  // POST /shops/:shopId/stock/transfer  — transfer qty between branches (Pro only)
  app.post<{ Params: { shopId: string }; Body: unknown }>(
    '/shops/:shopId/stock/transfer', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);
      await requireFeature(req, 'stock_transfer');

      const parsed = transferStockSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

      const { from_branch_id, to_branch_id, product_id, quantity, note } = parsed.data;
      const { shopId } = req.params;

      if (from_branch_id === to_branch_id) {
        throw new ValidationError({}, 'ต้นทางและปลายทางต้องเป็นคนละสาขา');
      }

      const [fromBranch, toBranch, product] = await Promise.all([
        shopRepository.getBranchById(from_branch_id, shopId),
        shopRepository.getBranchById(to_branch_id, shopId),
        productRepository.getActiveById(product_id, shopId),
      ]);
      if (!fromBranch) throw new NotFoundError('Branch (from)');
      if (!toBranch)   throw new NotFoundError('Branch (to)');
      if (!product)    throw new NotFoundError('Product');

      const result = await stockRepository.transferStock(
        shopId, from_branch_id, to_branch_id, product_id, quantity, req.auth?.userId, note,
      );

      if (!result) {
        return reply.status(422).send({
          success: false,
          error: { code: 'INSUFFICIENT_STOCK', message: `สต๊อกสินค้า "${product.name}" ในสาขาต้นทางไม่เพียงพอ` },
          meta: meta(req),
        });
      }

      // Broadcast real-time stock updates to all connected clients
      const fromRow = result.from;
      const toRow   = result.to;
      broadcast(shopId, 'STOCK_UPDATE', {
        branch_id:  from_branch_id,
        product_id,
        quantity:   fromRow.quantity,
        min_qty:    fromRow.min_qty ?? 0,
      });
      broadcast(shopId, 'STOCK_UPDATE', {
        branch_id:  to_branch_id,
        product_id,
        quantity:   toRow.quantity,
        min_qty:    toRow.min_qty ?? 0,
      });

      return reply.send({ success: true, data: { from: fromRow, to: toRow }, meta: meta(req) });
    },
  );

  // GET /shops/:shopId/stock/transactions  — stock history (admin)
  app.get<{
    Params:      { shopId: string };
    Querystring: { branchId?: string; fromDate?: string; toDate?: string; limit?: string };
  }>('/shops/:shopId/stock/transactions', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const { shopId } = req.params;
    const { branchId, fromDate, toDate, limit } = req.query as {
      branchId?: string; fromDate?: string; toDate?: string; limit?: string;
    };
    const rows = await stockRepository.getStockTransactions(shopId, {
      branchId: branchId || undefined,
      fromDate: fromDate ? new Date(fromDate + 'T00:00:00') : undefined,
      toDate:   toDate   ? new Date(toDate   + 'T23:59:59') : undefined,
      limit:    limit    ? Math.min(parseInt(limit, 10), 500) : 200,
    });
    return reply.send({ success: true, data: rows, meta: meta(req) });
  });
};

export { productsRoutes };
