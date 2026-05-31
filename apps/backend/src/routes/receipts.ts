import type { FastifyPluginAsync } from 'fastify';
import { orderRepository } from '../repositories/order.repository.js';
import { NotFoundError } from '../lib/errors.js';

const meta = (req: { id: string }) => ({
  requestId: req.id,
  timestamp: new Date().toISOString(),
});

const receiptsRoutes: FastifyPluginAsync = async (app) => {
  // GET /public/receipts/:token — no auth required
  // Rate-limited by the global 200 req/min limiter at top level
  app.get<{ Params: { token: string } }>(
    '/public/receipts/:token',
    async (req, reply) => {
      const { token } = req.params;

      // Basic UUID validation — prevents unnecessary DB queries
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
        throw new NotFoundError('Receipt');
      }

      const receipt = await orderRepository.getByReceiptToken(token);
      if (!receipt) throw new NotFoundError('Receipt');

      return reply.send({ success: true, data: receipt, meta: meta(req) });
    },
  );
};

export { receiptsRoutes };
