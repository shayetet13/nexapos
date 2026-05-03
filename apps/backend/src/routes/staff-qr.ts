import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { staffQrRepository } from '../repositories/staff-qr.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';

export const staffQrRoutes: FastifyPluginAsync = async (app) => {

  // ── Guard: admin/manager only ────────────────────────────────────
  async function guardAdmin(userId: string, shopId: string) {
    const role = await shopRepository.getUserRoleForShop(userId, shopId);
    if (!role || (role !== 'owner' && role !== 'manager')) {
      throw new ForbiddenError('Owner or manager required');
    }
    return role;
  }

  // ── QR Exchange — no auth required (staff scans QR) ─────────────
  // POST /api/v1/auth/qr-exchange
  app.post('/auth/qr-exchange', async (req, reply) => {
    const { token } = z.object({ token: z.string().uuid() }).parse(req.body);

    const qr = await staffQrRepository.findByToken(token);
    if (!qr) throw new NotFoundError('QR token not found or expired');

    // Get user email via admin API
    const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(qr.user_id);
    if (error || !user?.email) throw new NotFoundError('Staff user not found');

    // Generate magic link → extract token_hash
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type:  'magiclink',
      email: user.email,
      options: {
        redirectTo: `${process.env.FRONTEND_URL ?? ''}/qr-login/callback`,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      throw new Error('Failed to generate magic link');
    }

    // Parse token_hash from action_link URL
    const actionUrl  = new URL(linkData.properties.action_link);
    const tokenHash  = actionUrl.searchParams.get('token') ?? '';
    const tokenType  = actionUrl.searchParams.get('type') ?? 'magiclink';

    return reply.send({
      success:     true,
      token_hash:  tokenHash,
      token_type:  tokenType,
      shop_id:     qr.shop_id,
      branch_id:   qr.branch_id,
      email:       user.email,
    });
  });

  // ── List QR tokens for shop ──────────────────────────────────────
  // GET /api/v1/shops/:shopId/staff-qr
  app.get('/shops/:shopId/staff-qr', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardAdmin(req.auth!.userId, shopId);
    const data = await staffQrRepository.listByShop(shopId);
    return reply.send({ success: true, data });
  });

  // ── Create/regenerate QR token ───────────────────────────────────
  // POST /api/v1/shops/:shopId/staff-qr
  app.post('/shops/:shopId/staff-qr', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardAdmin(req.auth!.userId, shopId);
    const { user_id, branch_id } = z.object({
      user_id:   z.string().uuid(),
      branch_id: z.string().uuid().nullable().optional(),
    }).parse(req.body);

    const data = await staffQrRepository.upsert(user_id, shopId, branch_id);
    return reply.status(201).send({ success: true, data });
  });

  // ── Delete QR token ──────────────────────────────────────────────
  // DELETE /api/v1/shops/:shopId/staff-qr/:userId
  app.delete('/shops/:shopId/staff-qr/:userId', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId, userId } = req.params as { shopId: string; userId: string };
    await guardAdmin(req.auth!.userId, shopId);
    const data = await staffQrRepository.deleteByUser(userId, shopId);
    if (!data) throw new NotFoundError('QR token not found');
    return reply.send({ success: true });
  });

  // ── Record check-in (called after QR exchange succeeds) ──────────
  // POST /api/v1/shops/:shopId/staff-qr/checkin
  app.post('/shops/:shopId/staff-qr/checkin', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    const { branch_id } = z.object({
      branch_id: z.string().uuid().nullable().optional(),
    }).parse(req.body);

    const data = await staffQrRepository.createCheckin(req.auth!.userId, shopId, branch_id);
    return reply.status(201).send({ success: true, data });
  });

  // ── List recent check-ins ────────────────────────────────────────
  // GET /api/v1/shops/:shopId/staff-qr/checkins
  app.get('/shops/:shopId/staff-qr/checkins', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardAdmin(req.auth!.userId, shopId);
    const data = await staffQrRepository.listCheckins(shopId);
    return reply.send({ success: true, data });
  });

  // GET /api/v1/shops/:shopId/staff-qr/today-shifts — กะวันนี้
  app.get('/shops/:shopId/staff-qr/today-shifts', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardAdmin(req.auth!.userId, shopId);
    const data = await staffQrRepository.getTodayShifts(shopId);
    return reply.send({ success: true, data });
  });

  // POST /api/v1/shops/:shopId/staff-qr/checkout — clock-out พนักงาน
  app.post('/shops/:shopId/staff-qr/checkout', { preHandler: [app.auth] }, async (req, reply) => {
    const { shopId } = req.params as { shopId: string };
    await guardAdmin(req.auth!.userId, shopId);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    const result = await staffQrRepository.checkoutUser(userId, shopId);
    if (!result) return reply.status(404).send({ success: false, message: 'No active check-in found' });
    return reply.send({ success: true, data: result });
  });
};
