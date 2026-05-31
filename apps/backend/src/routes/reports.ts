import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { orderRepository } from '../repositories/order.repository.js';
import { requireAdminShop, requireFeature } from '../lib/admin-guard.js';
import { ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';

const pnlQuerySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate must be YYYY-MM-DD'),
  toDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate must be YYYY-MM-DD'),
  groupBy:  z.enum(['day', 'month']).optional().default('day'),
  branchId: z.string().uuid().optional(),
});

const reportsRoutes: FastifyPluginAsync = async (app) => {

  // GET /shops/:shopId/reports/pnl  — P&L report (admin only)
  app.get<{
    Params:      { shopId: string };
    Querystring: { fromDate?: string; toDate?: string; groupBy?: string; branchId?: string };
  }>('/shops/:shopId/reports/pnl', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await requireAdminShop(req);
    await requireFeature(req, 'reports_advanced');

    const parsed = pnlQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);

    const { fromDate, toDate, groupBy, branchId } = parsed.data;

    // Parse with explicit Bangkok offset so the boundary is calendar midnight
    // Asia/Bangkok, not UTC midnight (which would be Bangkok 07:00).
    const from = new Date(fromDate + 'T00:00:00+07:00');
    const to   = new Date(toDate   + 'T23:59:59+07:00');
    if (from > to) throw new ValidationError({}, 'fromDate ต้องไม่เกิน toDate');

    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 366) throw new ValidationError({}, 'ช่วงวันที่ต้องไม่เกิน 366 วัน');

    const report = await orderRepository.getPnlReport(req.params.shopId, {
      fromDate: from,
      toDate:   to,
      groupBy:  groupBy as 'day' | 'month',
      branchId: branchId || undefined,
    });

    return reply.send({ success: true, data: report, meta: meta(req) });
  });
};

export { reportsRoutes };
