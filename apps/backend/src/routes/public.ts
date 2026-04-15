import type { FastifyPluginAsync } from 'fastify';
import { publicRegisterSchema } from '@nexapos/shared';
import { shopRepository } from '../repositories/shop.repository.js';
import { customerRepository } from '../repositories/customer.repository.js';
import { ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';
import { broadcast } from '../lib/ws-broadcast.js';

const publicRoutes: FastifyPluginAsync = async (app) => {

  /** GET /public/shops/:shopId — name + logo for register page (no auth) */
  app.get<{ Params: { shopId: string } }>('/public/shops/:shopId', async (req, reply) => {
    const shop = await shopRepository.getShopById(req.params.shopId);
    if (!shop) return reply.status(404).send({ success: false, error: { code: 'RES_001', message: 'ไม่พบร้านค้า' }, meta: meta(req) });
    return reply.send({
      success: true,
      data: { id: shop.id, name: shop.name, logo_url: shop.logo_url ?? null },
      meta: meta(req),
    });
  });

  /** POST /public/shops/:shopId/register — no auth, self-register */
  app.post<{ Params: { shopId: string }; Body: unknown }>(
    '/public/shops/:shopId/register',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const { shopId } = req.params;
      const shop = await shopRepository.getShopById(shopId);
      if (!shop) {
        return reply.status(404).send({
          success: false,
          error: { code: 'RES_001', message: 'ไม่พบร้านค้า' },
          meta: meta(req),
        });
      }

      const cfg = (shop.membership_config as { enabled?: boolean }) ?? {};
      if (cfg.enabled === false) {
        return reply.status(400).send({
          success: false,
          error: { code: 'BIZ_001', message: 'ร้านนี้ยังไม่เปิดรับสมัครสมาชิก' },
          meta: meta(req),
        });
      }

      const parsed = publicRegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(JSON.stringify(parsed.error.flatten()));
      }

      const { name, phone, birthday } = parsed.data;
      const existing = await customerRepository.findByPhone(shopId, phone);
      if (existing) {
        broadcast(shopId, 'MEMBER_REGISTERED', {
          id:       existing.id,
          name:     existing.name,
          phone:    existing.phone ?? null,
          tier:     existing.tier,
          points:   existing.points,
          existing: true,
        });

        return reply.send({
          success: true,
          data: {
            id:       existing.id,
            name:     existing.name,
            tier:     existing.tier,
            points:   existing.points,
            existing: true,
          },
          meta: meta(req),
        });
      }

      const customer = await customerRepository.create(shopId, {
        name,
        phone,
        birthday: birthday ?? undefined,
      });
      if (!customer) {
        return reply.status(500).send({
          success: false,
          error: { code: 'SYS_001', message: 'สร้างสมาชิกไม่สำเร็จ' },
          meta: meta(req),
        });
      }

      broadcast(shopId, 'MEMBER_REGISTERED', {
        id:       customer.id,
        name:     customer.name,
        phone:    customer.phone ?? null,
        tier:     customer.tier,
        points:   customer.points,
        existing: false,
      });

      return reply.status(201).send({
        success: true,
        data: {
          id:       customer.id,
          name:     customer.name,
          tier:     customer.tier,
          points:   customer.points,
          existing: false,
        },
        meta: meta(req),
      });
    },
  );
};

export { publicRoutes };
