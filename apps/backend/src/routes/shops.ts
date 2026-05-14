import { z } from 'zod';
import { randomBytes } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { shopRepository } from '../repositories/shop.repository.js';
import { orderRepository } from '../repositories/order.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { requireAdminShop, requireOwnerShop, guardShop } from '../lib/admin-guard.js';
import { ForbiddenError, NotFoundError, ConflictError, ValidationError } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { meta } from '../lib/response.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { broadcast } from '../lib/ws-broadcast.js';
import { audit } from '../lib/audit.js';
import { db } from '../db/index.js';
import { shopNotifications, users, userShopRoles } from '../db/schema.js';

/**
 * Convert YYYY-MM-DD → start of Bangkok POS business day (00:15 Asia/Bangkok).
 * Aligns with `sqlPosBkkSameBusinessDayAsNow` in order.repository.ts.
 */
function bkkBizDayStart(dateStr: string): Date {
  return new Date(dateStr + 'T00:15:00+07:00');
}

/**
 * Convert YYYY-MM-DD → end of Bangkok POS business day (next calendar day 00:14:59 Asia/Bangkok).
 * This correctly closes the same business day that bkkBizDayStart opens.
 */
function bkkBizDayEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = nextDay.getUTCFullYear();
  const mm = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(nextDay.getUTCDate()).padStart(2, '0');
  return new Date(`${yy}-${mm}-${dd}T00:14:59+07:00`);
}
import { eq, and, desc, isNull } from 'drizzle-orm';
import { createStaffSchema, updateStaffPinSchema, updateStaffNicknameSchema } from '@nexapos/shared';
import { staffPasswordForSupabaseAuth } from '../lib/staff-auth-password.js';

/** สร้าง synthetic email สำหรับ staff (ไม่ใช่ email จริง ไม่แสดงให้ user เห็น) */
function generateStaffEmail(shopId: string): string {
  const rand = randomBytes(4).toString('hex'); // 8 hex chars
  return `staff_${rand}@${shopId}.nexapos.local`;
}

const VALID_ROLES = ['manager', 'cashier', 'viewer'] as const;

const updateShopSchema = z.object({
  name:                  z.string().min(1, 'Name is required').max(200).trim().optional(),
  logo_url:              z.string().url('logo_url must be a valid URL').nullable().optional(),
  vat_enabled:           z.boolean().optional(),
  owner_firstname:       z.string().max(100).trim().nullable().optional(),
  owner_lastname:        z.string().max(100).trim().nullable().optional(),
  promptpay_type:        z.enum(['phone', 'id_card']).nullable().optional(),
  /** Plaintext phone (10 digits) or ID card (13 digits) — server will encrypt before storing */
  promptpay_number:      z
    .string()
    .regex(/^\d{10}$|^\d{13}$/, 'กรุณากรอกเบอร์โทร 10 หลัก หรือ หมายเลขบัตรประชาชน 13 หลัก')
    .nullable()
    .optional(),
  print_receipt_enabled: z.boolean().optional(),
  printer_width:         z.number().int().refine((n) => n === 32 || n === 48, 'printer_width must be 32 or 48').nullable().optional(),
  membership_config:     z.object({
    enabled:                    z.boolean().optional(),
    points_per_10_baht:         z.number().int().min(1).max(100).optional(),
    redemption_rate:            z.number().int().min(10).max(1000).optional(),
    redemption_type:            z.enum(['points_per_10_baht', 'baht_per_point']).optional(),
    redemption_baht_per_point:  z.number().min(0.01).max(10).optional(),
    tier_silver:                z.number().min(0).optional(),
    tier_gold:                  z.number().min(0).optional(),
    birthday_benefit_type:      z.enum(['percent', 'fixed']).optional(),
    birthday_benefit_value:     z.number().min(0).optional(),
    birthday_auto_use_points:    z.boolean().optional(),
  }).optional(),
  phone:              z.string().max(20).trim().nullable().optional(),
  tax_id:             z.string().max(20).trim().nullable().optional(),
  address:            z.string().max(500).trim().nullable().optional(),
  opening_hours:      z.string().max(100).trim().nullable().optional(),
  working_days:       z.string().max(100).trim().nullable().optional(),
  google_review_url:  z.string().url('google_review_url must be a valid URL').nullable().optional(),
});

const assignUserSchema = z.object({
  email:    z.string().email('Invalid email'),
  password: z
    .string()
    .regex(
      /^[a-z0-9]{4,10}$/,
      'Password must be 4–10 characters using lowercase letters (a-z) and numbers (0-9) only',
    ),
  role:     z.enum(VALID_ROLES, { errorMap: () => ({ message: 'Role must be manager, cashier, or viewer' }) }),
  branchId: z.string().uuid('Invalid branchId').optional(),
});

const updateRoleSchema = z.object({
  role:     z.enum(VALID_ROLES, { errorMap: () => ({ message: 'Role must be manager, cashier, or viewer' }) }),
  branchId: z.string().uuid('Invalid branchId').optional().nullable(),
});

const shopsRoutes: FastifyPluginAsync = async (app) => {

  // GET /shops/:shopId/branches
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/branches', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await guardShop(req);
    const branches = await shopRepository.getBranchesByShopId(req.params.shopId);
    reply.header('Cache-Control', 'private, max-age=60'); // cache 1 min (branch list changes rarely)
    return reply.send({ success: true, data: branches, meta: meta(req) });
  });

  const branchSchema = z.object({
    name:    z.string().min(1, 'Branch name is required').max(100).trim(),
    address: z.string().max(500).trim().nullable().optional(),
  });

  // POST /shops/:shopId/branches — owner only
  app.post<{ Params: { shopId: string } }>('/shops/:shopId/branches', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const { shopId } = req.params;
    await requireOwnerShop(req);
    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
    const { name, address } = parsed.data;
    const branch = await shopRepository.createBranch(shopId, name, address ?? undefined);
    audit.action({
      event: 'branch.create', shop_id: shopId, user_id: req.auth?.userId,
      request_id: req.id, ip_address: req.ip, entity_type: 'branch', entity_id: branch?.id ?? undefined,
      metadata: { name },
    });
    return reply.status(201).send({ success: true, data: branch, meta: meta(req) });
  });

  // PATCH /shops/:shopId/branches/:branchId — owner only
  app.patch<{ Params: { shopId: string; branchId: string } }>('/shops/:shopId/branches/:branchId', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const { shopId, branchId } = req.params;
    await requireOwnerShop(req);
    const parsed = branchSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
    const branch = await shopRepository.updateBranch(branchId, shopId, parsed.data);
    if (!branch) throw new NotFoundError('Branch');
    audit.action({
      event: 'branch.update', shop_id: shopId, user_id: req.auth?.userId,
      request_id: req.id, ip_address: req.ip, entity_type: 'branch', entity_id: branchId,
      metadata: parsed.data,
    });
    return reply.send({ success: true, data: branch, meta: meta(req) });
  });

  // DELETE /shops/:shopId/branches/:branchId — owner only
  app.delete<{ Params: { shopId: string; branchId: string } }>('/shops/:shopId/branches/:branchId', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const { shopId, branchId } = req.params;
    await requireOwnerShop(req);
    const branch = await shopRepository.getBranchById(branchId, shopId);
    if (!branch) throw new NotFoundError('Branch');
    await shopRepository.deleteBranch(branchId);
    audit.action({
      event: 'branch.delete', shop_id: shopId, user_id: req.auth?.userId,
      request_id: req.id, ip_address: req.ip, entity_type: 'branch', entity_id: branchId,
      metadata: { name: branch.name },
    });
    return reply.send({ success: true, data: null, meta: meta(req) });
  });

  // GET /shops/:shopId/stats?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&branchId=uuid
  app.get<{
    Params:      { shopId: string };
    Querystring: { fromDate?: string; toDate?: string; branchId?: string };
  }>('/shops/:shopId/stats', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const { shopId } = req.params;
    const { fromDate, toDate, branchId } = req.query as { fromDate?: string; toDate?: string; branchId?: string };

    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }

    const stats = await orderRepository.getStats(shopId, {
      fromDate: fromDate ? bkkBizDayStart(fromDate) : undefined,
      toDate:   toDate   ? bkkBizDayEnd(toDate)     : undefined,
      branchId: branchId || undefined,
    });
    return reply.send({ success: true, data: stats, meta: meta(req) });
  });

// GET /me/pos-assignment
  app.get('/me/pos-assignment', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (userShops.length === 0) {
      return reply.send({ success: true, data: null, meta: meta(req) });
    }

    // userShops is guaranteed non-empty after the length === 0 guard above
    const shopEntry = userShops[0]!;

    // ── ตรวจสอบสถานะร้าน: แบนถาวร หรือ suspend ชั่วคราว ──────────
    if (shopEntry.is_banned || !shopEntry.is_active) {
      return reply.status(403).send({
        success: false,
        error: {
          code:       shopEntry.is_banned ? 'SHOP_BANNED' : 'SHOP_SUSPENDED',
          message:    shopEntry.is_banned
            ? 'ร้านค้านี้ถูกระงับการใช้งานถาวร'
            : 'ร้านค้านี้ถูกระงับการใช้งานชั่วคราว',
          ban_reason: shopEntry.ban_reason ?? null,
        },
        meta: meta(req),
      });
    }

    let branchName: string | null = null;
    if (shopEntry.branch_id) {
      const branch = await shopRepository.getBranchById(shopEntry.branch_id, shopEntry.id);
      branchName = branch?.name ?? null;
    }

    return reply.send({
      success: true,
      data: {
        role:       shopEntry.role,
        shopId:     shopEntry.id,
        shopName:   shopEntry.name,
        shop_mode:  shopEntry.shop_mode,
        branchId:   shopEntry.branch_id ?? null,
        branchName,
      },
      meta: meta(req),
    });
  });

  // GET /me/shops
  app.get('/me/shops', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const shopsData = await shopRepository.getShopsForUser(req.auth!.userId);
    return reply.send({ success: true, data: shopsData, meta: meta(req) });
  });

  // ── Shop settings ─────────────────────────────────────────────────────────

  // GET /shops/:shopId/settings  — owner/manager
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/settings', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const shop = await shopRepository.getShopById(req.params.shopId);
    if (!shop) throw new NotFoundError('Shop');
    return reply.send({
      success: true,
      data: {
        id:                    shop.id,
        name:                  shop.name,
        logo_url:              shop.logo_url ?? null,
        vat_enabled:           shop.vat_enabled,
        owner_firstname:       shop.owner_firstname ?? null,
        owner_lastname:        shop.owner_lastname ?? null,
        promptpay_type:        shop.promptpay_type ?? null,
        // Decrypt before sending — only owner/manager can call this endpoint
        promptpay_number:      decrypt(shop.promptpay_number_encrypted),
        print_receipt_enabled: shop.print_receipt_enabled,
        printer_width:         shop.printer_width     ?? null,
        shop_code:             shop.shop_code         ?? null,
        province:              shop.province          ?? null,
        district:              shop.district          ?? null,
        postal_code:           shop.postal_code       ?? null,
        membership_config:    (shop.membership_config as object) ?? null,
        phone:                 shop.phone              ?? null,
        tax_id:                shop.tax_id             ?? null,
        address:               shop.address            ?? null,
        opening_hours:         shop.opening_hours      ?? null,
        working_days:          shop.working_days       ?? null,
        google_review_url:     shop.google_review_url  ?? null,
      },
      meta: meta(req),
    });
  });

  // GET /shops/:shopId/pos-config  — all authenticated shop members (POS display settings only, no sensitive data)
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/pos-config', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const { shopId } = req.params;
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('Not a member of this shop');
    }
    const shop = await shopRepository.getShopById(shopId);
    if (!shop) throw new NotFoundError('Shop');
    reply.header('Cache-Control', 'private, max-age=300'); // cache 5 min (config rarely changes)
    return reply.send({
      success: true,
      data: {
        shop_mode:             shop.shop_mode,
        logo_url:              shop.logo_url              ?? null,
        vat_enabled:           shop.vat_enabled,
        print_receipt_enabled: shop.print_receipt_enabled,
        printer_width:         shop.printer_width         ?? null,
        membership_config:     (shop.membership_config as object) ?? null,
      },
      meta: meta(req),
    });
  });

  // POST /shops/:shopId/generate-code  — owner only; generate 10-digit code for existing shop
  app.post<{ Params: { shopId: string } }>('/shops/:shopId/generate-code', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const userRole = await shopRepository.getUserRoleForShop(req.auth!.userId, req.params.shopId);
    if (userRole !== 'owner') throw new ForbiddenError('Only owner can generate shop code');

    const bodySchema = z.object({
      postal_code: z.string().regex(/^\d{5}$/, 'postal_code must be 5 digits'),
      province:    z.string().min(1).optional(),
      district:    z.string().min(1).optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');

    const shop = await shopRepository.getShopById(req.params.shopId);
    if (!shop) throw new NotFoundError('Shop');
    if (shop.shop_code) throw new ValidationError('Shop already has a code');

    const updated = await shopRepository.generateAndSaveShopCode(
      req.params.shopId,
      parsed.data.postal_code,
      parsed.data.province ?? null,
      parsed.data.district ?? null,
    );
    return reply.send({ success: true, data: { shop_code: updated?.shop_code ?? null }, meta: meta(req) });
  });

  // GET /shops/:shopId/payment  — all authenticated shop members (cashier needs it for QR display)
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/payment', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    const { shopId } = req.params;
    const userShops = await shopRepository.getShopsForUser(req.auth!.userId);
    if (!userShops.some((s) => s.id === shopId)) {
      throw new ForbiddenError('No access to this shop');
    }
    const shop = await shopRepository.getShopById(shopId);
    if (!shop) throw new NotFoundError('Shop');
    return reply.send({
      success: true,
      data: {
        promptpay_type:   shop.promptpay_type ?? null,
        promptpay_number: decrypt(shop.promptpay_number_encrypted),
        owner_firstname:  shop.owner_firstname ?? null,
        owner_lastname:   shop.owner_lastname ?? null,
      },
      meta: meta(req),
    });
  });

  // PATCH /shops/:shopId/settings  — owner only
  app.patch<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/settings', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const parsed = updateShopSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const { promptpay_number, ...rest } = parsed.data;

    // Encrypt promptpay_number if provided; null clears it
    let promptpay_number_encrypted: string | null | undefined = undefined;
    if (promptpay_number !== undefined) {
      promptpay_number_encrypted = promptpay_number ? encrypt(promptpay_number) : null;
    }

    const shop = await shopRepository.updateShop(req.params.shopId, {
      ...rest,
      ...(promptpay_number_encrypted !== undefined ? { promptpay_number_encrypted } : {}),
    });
    if (!shop) throw new NotFoundError('Shop');
    return reply.send({
      success: true,
      data: {
        id:                    shop.id,
        name:                  shop.name,
        logo_url:              shop.logo_url ?? null,
        vat_enabled:           shop.vat_enabled,
        owner_firstname:       shop.owner_firstname ?? null,
        owner_lastname:        shop.owner_lastname ?? null,
        promptpay_type:        shop.promptpay_type ?? null,
        promptpay_number:      decrypt(shop.promptpay_number_encrypted),
        print_receipt_enabled: shop.print_receipt_enabled,
        printer_width:         shop.printer_width     ?? null,
        membership_config:     (shop.membership_config as object) ?? null,
        phone:                 shop.phone              ?? null,
        tax_id:                shop.tax_id             ?? null,
        address:               shop.address            ?? null,
        opening_hours:         shop.opening_hours      ?? null,
        working_days:          shop.working_days       ?? null,
        google_review_url:     shop.google_review_url  ?? null,
      },
      meta: meta(req),
    });
  });

  // ── User Management (owner/manager list, owner add/edit/remove) ───────────

  // GET /shops/:shopId/users
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/users', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const userList = await userRepository.getUsersByShop(req.params.shopId);
    return reply.send({ success: true, data: userList, meta: meta(req) });
  });

  // POST /shops/:shopId/users  — owner only
  app.post<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/users', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const parsed = assignUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const { email, password, role, branchId } = parsed.data;

    // 1. Try to find existing user in public.users
    let targetUser = await userRepository.findByEmail(email);

    if (!targetUser) {
      // 2. User hasn't logged in yet — create them via Supabase Admin API
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // skip email verification
      });

      if (authError) {
        // If user already exists in Supabase Auth but not in public.users (edge case)
        if (authError.message.includes('already been registered')) {
          // Try to look them up by listing users (admin API)
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
          const existing = listData?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
          if (!existing) throw new ConflictError('User already exists but could not be found');
          // Update password so user can log in with the provided credentials
          await supabaseAdmin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
          // Upsert into public.users
          targetUser = await userRepository.upsertUser(existing.id, email);
        } else {
          throw new ConflictError(`Could not create user: ${authError.message}`);
        }
      } else {
        // 3. Upsert the new auth user into public.users (password already set via createUser)
        if (!authData.user) throw new ConflictError('User creation failed');
        targetUser = await userRepository.upsertUser(authData.user.id, email);
      }
    } else {
      // User exists in public.users — update password in Supabase Auth
      await supabaseAdmin.auth.admin.updateUserById(targetUser.id, { password });
    }

    if (!targetUser) throw new ConflictError('Could not create or find user');

    // Prevent assigning yourself as a non-owner (you're already owner)
    if (targetUser.id === req.auth!.userId) {
      throw new ConflictError('Cannot change your own role this way');
    }

    const existingRole = await shopRepository.getUserRoleForShop(targetUser.id, req.params.shopId);
    if (existingRole === 'owner') {
      throw new ConflictError('Cannot reassign another owner');
    }

    await userRepository.assignToShop(targetUser.id, req.params.shopId, role, branchId);
    return reply.status(201).send({ success: true, data: { userId: targetUser.id, email, role }, meta: meta(req) });
  });

  // PATCH /shops/:shopId/users/:userId  — owner only
  app.patch<{ Params: { shopId: string; userId: string }; Body: unknown }>('/shops/:shopId/users/:userId', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const { userId, shopId } = req.params;
    if (userId === req.auth!.userId) throw new ConflictError('Cannot change your own role');

    const existing = await shopRepository.getUserRoleForShop(userId, shopId);
    if (!existing) throw new NotFoundError('User in this shop');
    if (existing === 'owner') throw new ConflictError('Cannot change another owner\'s role');

    await userRepository.assignToShop(userId, shopId, parsed.data.role, parsed.data.branchId ?? undefined);
    return reply.send({ success: true, data: null, meta: meta(req) });
  });

  // DELETE /shops/:shopId/users/:userId  — owner only
  app.delete<{ Params: { shopId: string; userId: string } }>('/shops/:shopId/users/:userId', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireOwnerShop(req);
    const { userId, shopId } = req.params;
    if (userId === req.auth!.userId) throw new ConflictError('Cannot remove yourself');

    const existing = await shopRepository.getUserRoleForShop(userId, shopId);
    if (!existing) throw new NotFoundError('User in this shop');
    if (existing === 'owner') throw new ConflictError('Cannot remove another owner');

    await userRepository.removeFromShop(userId, shopId);
    return reply.status(204).send();
  });

  // ── Staff PIN routes ────────────────────────────────────────────────────────

  // GET /shops/:shopId/staff  — owner/manager: list staff (nickname+PIN accounts)
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/staff', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const staffList = await userRepository.getStaffByShop(req.params.shopId);
    return reply.send({ success: true, data: staffList, meta: meta(req) });
  });

  // POST /shops/:shopId/staff  — owner/manager: create staff with nickname+PIN
  app.post<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/staff', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await requireAdminShop(req);

    const parsed = createStaffSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

    const { nickname, pin, role, branchId } = parsed.data;
    const { shopId } = req.params;

    // ตรวจ nickname ซ้ำทั้งระบบ (global unique — ป้องกัน login ผิดร้าน)
    const taken = await userRepository.isNicknameTaken(nickname);
    if (taken) throw new ConflictError(`ชื่อเล่น "${nickname}" ถูกใช้งานแล้วในระบบ กรุณาเลือกชื่อใหม่`);

    // สร้าง synthetic email
    const syntheticEmail = generateStaffEmail(shopId);

    // สร้าง Supabase auth user (email_confirm: true — ไม่ต้อง verify email)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email:         syntheticEmail,
      password:      staffPasswordForSupabaseAuth(pin),
      email_confirm: true,
    });

    if (authError || !authData.user) {
      throw new ConflictError(`ไม่สามารถสร้างบัญชีพนักงานได้: ${authError?.message ?? 'unknown error'}`);
    }

    // upsert ลง public.users (is_staff = true)
    await userRepository.upsertStaffUser(authData.user.id, syntheticEmail);
    // assign ลง shop พร้อม nickname
    await userRepository.assignToShop(authData.user.id, shopId, role, branchId, nickname);

    audit.action({
      event:       'create_staff',
      shop_id:     shopId,
      user_id:     req.auth?.userId,
      request_id:  req.id,
      ip_address:  req.ip,
      entity_type: 'user',
      entity_id:   authData.user.id,
      metadata:    { nickname, role },
    });

    return reply.status(201).send({
      success: true,
      data: { userId: authData.user.id, nickname, role, branchId: branchId ?? null },
      meta: meta(req),
    });
  });

  // PATCH /shops/:shopId/staff/:userId/pin  — owner/manager: change PIN
  app.patch<{ Params: { shopId: string; userId: string }; Body: unknown }>(
    '/shops/:shopId/staff/:userId/pin', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);

      const parsed = updateStaffPinSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

      const { userId, shopId } = req.params;

      // ตรวจว่า user นี้เป็น staff ของร้านนี้จริง
      const staffRows = await db.select({ is_staff: users.is_staff })
        .from(users)
        .innerJoin(userShopRoles, eq(userShopRoles.user_id, users.id))
        .where(and(eq(users.id, userId), eq(userShopRoles.shop_id, shopId), eq(users.is_staff, true)));

      if (staffRows.length === 0) throw new NotFoundError('Staff member');

      const { error: pinUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: staffPasswordForSupabaseAuth(parsed.data.pin),
      });
      if (pinUpdateError) {
        req.log.warn({ pinUpdateError, userId }, 'staff PIN update rejected by Supabase Auth');
        throw new ValidationError(
          {},
          `ไม่สามารถเปลี่ยน PIN ได้: ${pinUpdateError.message}`,
        );
      }

      audit.action({
        event: 'update_staff_pin', shop_id: shopId, user_id: req.auth?.userId,
        request_id: req.id, ip_address: req.ip, entity_type: 'user', entity_id: userId,
        metadata: {},
      });

      return reply.send({ success: true, data: null, meta: meta(req) });
    },
  );

  // PATCH /shops/:shopId/staff/:userId/nickname  — owner/manager: change nickname
  app.patch<{ Params: { shopId: string; userId: string }; Body: unknown }>(
    '/shops/:shopId/staff/:userId/nickname', {
      preHandler: [app.auth],
    }, async (req, reply) => {
      await requireAdminShop(req);

      const parsed = updateStaffNicknameSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.flatten().fieldErrors);

      const { userId, shopId } = req.params;
      const { nickname } = parsed.data;

      // ตรวจชื่อเล่นซ้ำ GLOBAL (ยกเว้น user ตัวเอง)
      const taken = await userRepository.isNicknameTaken(nickname, userId);
      if (taken) {
        throw new ConflictError(`ชื่อเล่น "${nickname}" ถูกใช้งานแล้วในระบบ กรุณาเลือกชื่อใหม่`);
      }

      const updated = await userRepository.updateStaffNickname(userId, shopId, nickname);
      if (!updated) throw new NotFoundError('Staff member');

      audit.action({
        event: 'update_staff_nickname', shop_id: shopId, user_id: req.auth?.userId,
        request_id: req.id, ip_address: req.ip, entity_type: 'user', entity_id: userId,
        metadata: { nickname },
      });

      return reply.send({ success: true, data: { nickname }, meta: meta(req) });
    },
  );

  // DELETE /shops/:shopId/staff/:userId  — owner/manager: ลบ staff account ทั้งหมด
  app.delete<{ Params: { shopId: string; userId: string } }>('/shops/:shopId/staff/:userId', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await requireAdminShop(req);
    const { userId, shopId } = req.params;

    // ตรวจว่าเป็น staff ของร้านนี้จริง
    const staffRows = await db.select({ is_staff: users.is_staff, nickname: userShopRoles.nickname })
      .from(users)
      .innerJoin(userShopRoles, eq(userShopRoles.user_id, users.id))
      .where(and(eq(users.id, userId), eq(userShopRoles.shop_id, shopId), eq(users.is_staff, true)));

    if (staffRows.length === 0) throw new NotFoundError('Staff member');

    const nickname = staffRows[0]?.nickname ?? null;

    // ลบจาก user_shop_roles
    await userRepository.removeFromShop(userId, shopId);
    // ลบจาก public.users
    await userRepository.deleteUser(userId);
    // ลบจาก Supabase Auth
    await supabaseAdmin.auth.admin.deleteUser(userId);

    audit.action({
      event: 'delete_staff', shop_id: shopId, user_id: req.auth?.userId,
      request_id: req.id, ip_address: req.ip, entity_type: 'user', entity_id: userId,
      metadata: { nickname },
    });

    return reply.status(204).send();
  });

  // ── Notifications ──────────────────────────────────────────────────────────

  // GET /shops/:shopId/notifications  — any shop member; unread first, max 50
  app.get<{ Params: { shopId: string } }>('/shops/:shopId/notifications', {
    preHandler: [app.auth],
  }, async (req, reply) => {
    await guardShop(req);
    const rows = await db
      .select()
      .from(shopNotifications)
      .where(eq(shopNotifications.shop_id, req.params.shopId))
      .orderBy(shopNotifications.read_at, desc(shopNotifications.created_at))
      .limit(50);
    const unreadCount = rows.filter((r) => !r.read_at).length;
    return reply.send({ success: true, data: rows, meta: { ...meta(req), unreadCount } });
  });

  // PATCH /shops/:shopId/notifications/:notificationId/read  — mark as read
  app.patch<{ Params: { shopId: string; notificationId: string } }>(
    '/shops/:shopId/notifications/:notificationId/read',
    { preHandler: [app.auth] },
    async (req, reply) => {
      await guardShop(req);
      const [updated] = await db
        .update(shopNotifications)
        .set({ read_at: new Date() })
        .where(
          and(
            eq(shopNotifications.id, req.params.notificationId),
            eq(shopNotifications.shop_id, req.params.shopId),
            isNull(shopNotifications.read_at), // only update if not already read
          ),
        )
        .returning();
      return reply.send({ success: true, data: updated ?? null, meta: meta(req) });
    },
  );

  // ── Customer Display Broadcast ───────────────────────────────────────────

  const displayEventSchema = z.object({
    type: z.enum(['CHECKOUT_CASH', 'CHECKOUT_QR', 'CHECKOUT_CLOSE', 'CHECKOUT_PAID', 'ORDER_PAID', 'REGISTER_QR']),
    payload: z.record(z.unknown()),
  });

  // POST /shops/:shopId/display  — broadcast an event to all /ws-display clients
  app.post<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/display', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await guardShop(req);
    const body = displayEventSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError(body.error.issues[0]?.message ?? 'Invalid body');
    broadcast(req.params.shopId, body.data.type, body.data.payload);
    return reply.status(204).send();
  });

  // PATCH /shops/:shopId/notifications/read-all  — mark all as read
  app.patch<{ Params: { shopId: string } }>(
    '/shops/:shopId/notifications/read-all',
    { preHandler: [app.auth] },
    async (req, reply) => {
      await guardShop(req);
      await db
        .update(shopNotifications)
        .set({ read_at: new Date() })
        .where(
          and(
            eq(shopNotifications.shop_id, req.params.shopId),
            isNull(shopNotifications.read_at),
          ),
        );
      return reply.send({ success: true, data: null, meta: meta(req) });
    },
  );

  // DELETE /shops/:shopId/notifications/:notificationId  — permanently delete
  app.delete<{ Params: { shopId: string; notificationId: string } }>(
    '/shops/:shopId/notifications/:notificationId',
    { preHandler: [app.auth] },
    async (req, reply) => {
      await guardShop(req);
      await db
        .delete(shopNotifications)
        .where(
          and(
            eq(shopNotifications.id, req.params.notificationId),
            eq(shopNotifications.shop_id, req.params.shopId),
          ),
        );
      return reply.status(204).send();
    },
  );
};

export { shopsRoutes };
