import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { emailOtps, passwordResetTokens, users } from '../db/schema.js';
import { shopRepository } from '../repositories/shop.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { ValidationError, ConflictError } from '../lib/errors.js';
import { sendOtpEmail, sendResetPasswordEmail } from '../lib/mailer.js';
import { OTP_EXPIRY_MS } from '../lib/bkk-time.js';
import { staffLoginSchema } from '@nexapos/shared';

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function meta(req: { id: string }) {
  return { requestId: req.id, timestamp: new Date().toISOString() };
}

/** Generate 6 unique shuffled digits (Fisher-Yates) */
function generateOtp(): { otp: string; refCode: string } {
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = 9; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j]!, digits[i]!];
  }
  const otp = digits.slice(0, 6).join('');
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const refCode = Array.from({ length: 3 }, () => alpha[Math.floor(Math.random() * alpha.length)]).join('')
    + String(Math.floor(100 + Math.random() * 900));
  return { otp, refCode };
}

const registerSchema = z.object({
  email:           z.string().email('อีเมลไม่ถูกต้อง'),
  password:        z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'),
  verified_token:  z.string().uuid('verified_token ไม่ถูกต้อง'),
  shopName:        z.string().min(1, 'กรุณาใส่ชื่อร้าน').max(200).trim(),
  province:        z.string().optional(),
  district:        z.string().optional(),
  postal_code:     z.string().regex(/^\d{5}$/).optional(),
  branchName:      z.string().min(1).max(200).trim().optional(),
});

const authRoutes: FastifyPluginAsync = async (app) => {

  /* ─────────────────────────────────────────────────────────────
   * POST /auth/register/request-otp
   * ส่ง OTP ไปที่ email — ต้องยืนยัน OTP ก่อนสมัครสมาชิก
   * Rate-limit: 3 req/10 min per IP
   * ───────────────────────────────────────────────────────────── */
  app.post<{ Body: unknown }>('/register/request-otp', {
    config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const email = (typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError({ email: ['อีเมลไม่ถูกต้อง'] }, 'อีเมลไม่ถูกต้อง');
    }

    // ตรวจว่า email ถูกใช้แล้ว
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      throw new ConflictError('อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่นหรือเข้าสู่ระบบ');
    }

    // Invalidate OTP เก่า (unverified) ของ email นี้
    await db.update(emailOtps)
      .set({ verified: true }) // ใช้ verified=true เพื่อ "ยกเลิก" (ทำให้ไม่ match)
      .where(and(eq(emailOtps.email, email), eq(emailOtps.verified, false)));

    const { otp, refCode } = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await db.insert(emailOtps).values({ email, otp_code: otp, ref_code: refCode, expires_at: expiresAt });

    await sendOtpEmail(email, otp, refCode);
 

    return reply.send({
      success: true,
      data: { ref_code: refCode, expires_in: 600 },
      meta: meta(req),
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * POST /auth/register/verify-otp
   * ยืนยัน OTP → คืน verified_token สำหรับใช้ตอน register
   * ───────────────────────────────────────────────────────────── */
  app.post<{ Body: unknown }>('/register/verify-otp', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const email    = (typeof body?.email    === 'string' ? body.email.trim().toLowerCase() : '');
    const otpCode  = (typeof body?.otp_code === 'string' ? body.otp_code.trim()           : '');

    if (!email || !otpCode) {
      throw new ValidationError({}, 'กรุณาระบุ email และ otp_code');
    }

    const now = new Date();
    const rows = await db.select()
      .from(emailOtps)
      .where(and(eq(emailOtps.email, email), eq(emailOtps.verified, false)))
      .orderBy(desc(emailOtps.created_at))
      .limit(1);

    const record = rows[0];
    if (!record) {
      throw new ValidationError({}, 'รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่');
    }
    if (record.expires_at < now) {
      throw new ValidationError({}, 'รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่');
    }
    if (record.otp_code !== otpCode) {
      throw new ValidationError({}, 'รหัส OTP ไม่ถูกต้อง');
    }

    // Mark verified
    await db.update(emailOtps).set({ verified: true }).where(eq(emailOtps.id, record.id));

    return reply.send({
      success: true,
      data: { verified_token: record.id },
      meta: meta(req),
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * POST /auth/register
   * สมัครสมาชิก — ต้องมี verified_token จาก verify-otp
   * ───────────────────────────────────────────────────────────── */
  app.post<{ Body: unknown }>('/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
      throw new ValidationError(parsed.error.flatten().fieldErrors, msg);
    }

    const { email, password, verified_token, shopName, province, district, postal_code, branchName } = parsed.data;

    // ตรวจ verified_token
    const tokenRows = await db.select()
      .from(emailOtps)
      .where(and(eq(emailOtps.id, verified_token), eq(emailOtps.email, email.toLowerCase()), eq(emailOtps.verified, true)))
      .limit(1);

    if (tokenRows.length === 0) {
      throw new ValidationError({ verified_token: ['กรุณายืนยัน OTP ก่อนสมัครสมาชิก'] }, 'กรุณายืนยัน OTP ก่อนสมัครสมาชิก');
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return reply.status(503).send({
        success: false,
        error: { code: 'SYS_004', message: 'Service not configured' },
        meta: meta(req),
      });
    }

    // 1. Create Supabase auth user
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      const isExists =
        authError.message.toLowerCase().includes('already') ||
        authError.message.toLowerCase().includes('already registered') ||
        authError.message.toLowerCase().includes('already been registered');
      if (isExists) throw new ConflictError('อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือใช้อีเมลอื่น');
      throw new ValidationError({}, authError.message);
    }

    if (!authData.user) throw new Error('สร้างบัญชีไม่สำเร็จ');
    const userId = authData.user.id;

    // 2. Upsert public.users
    await userRepository.upsertUser(userId, email);

    // 3. Create shop
    const shop = await shopRepository.createShop(shopName, { postalCode: postal_code, province, district });
    if (!shop) throw new Error('สร้างร้านไม่สำเร็จ');

    // 4. Create branch (optional)
    if (branchName) await shopRepository.createBranch(shop.id, branchName);

    // 5. Assign user as owner
    await userRepository.assignToShop(userId, shop.id, 'owner', undefined);

    return reply.status(201).send({
      success: true,
      data: { userId, shopId: shop.id, shopCode: shop.shop_code, shopName: shop.name },
      meta: meta(req),
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * POST /auth/forgot-password
   * ส่ง reset link ไปที่ email — link มีอายุ 2 นาที
   * ───────────────────────────────────────────────────────────── */
  app.post<{ Body: unknown }>('/forgot-password', {
    config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const body  = req.body as Record<string, unknown>;
    const email = (typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '');

    // เสมอ return 200 ไม่บอกว่า email มีหรือไม่
    if (!email) return reply.send({ success: true, meta: meta(req) });

    const userRows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (userRows.length === 0) return reply.send({ success: true, meta: meta(req) });

    const userId = userRows[0]!.id;

    // Invalidate token เก่า
    await db.update(passwordResetTokens)
      .set({ used: true })
      .where(and(eq(passwordResetTokens.email, email), eq(passwordResetTokens.used, false)));

    const token     = randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 min

    await db.insert(passwordResetTokens).values({ id: token, email, user_id: userId, expires_at: expiresAt });

    const origin   = process.env.FRONTEND_URL ?? (req.headers['origin'] as string | undefined) ?? 'http://localhost:3000';
    const resetUrl = `${origin}/reset-password?token=${token}`;

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await sendResetPasswordEmail(email, resetUrl);
    } else {
      console.log(`[DEV] Password reset link: ${resetUrl}`);
    }

    return reply.send({ success: true, meta: meta(req) });
  });

  /* ─────────────────────────────────────────────────────────────
   * POST /auth/forgot-password/status
   * Tablet polling — ตรวจว่า token ถูก used แล้วหรือยัง
   * ───────────────────────────────────────────────────────────── */
  app.post<{ Body: unknown }>('/forgot-password/status', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body  = req.body as Record<string, unknown>;
    const email = (typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '');
    if (!email) return reply.send({ success: true, data: { used: false, expired: true }, meta: meta(req) });

    const rows = await db.select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.email, email))
      .orderBy(desc(passwordResetTokens.created_at))
      .limit(1);

    const record = rows[0];
    if (!record) return reply.send({ success: true, data: { used: false, expired: true }, meta: meta(req) });

    const now = new Date();
    return reply.send({
      success: true,
      data: {
        used:    record.used,
        expired: record.expires_at < now && !record.used,
      },
      meta: meta(req),
    });
  });

  /* ─────────────────────────────────────────────────────────────
   * GET /auth/reset-password?token=<uuid>
   * Link ใน email — reset password เป็นค่าว่าง + mark token used
   * ───────────────────────────────────────────────────────────── */
  app.get<{ Querystring: { token?: string } }>('/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const token = req.query.token ?? '';
    if (!token) {
      return reply.status(400).send({ success: false, error: { message: 'ลิงก์ไม่ถูกต้อง' }, meta: meta(req) });
    }

    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, token)).limit(1);
    const record = rows[0];

    if (!record) {
      return reply.status(400).send({ success: false, error: { message: 'ลิงก์หมดอายุหรือไม่ถูกต้อง' }, meta: meta(req) });
    }
    if (record.used) {
      return reply.status(400).send({ success: false, error: { message: 'ลิงก์นี้ถูกใช้ไปแล้ว' }, meta: meta(req) });
    }
    if (record.expires_at < new Date()) {
      return reply.status(400).send({ success: false, error: { message: 'ลิงก์หมดอายุแล้ว กรุณาขอรีเซ็ตใหม่' }, meta: meta(req) });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return reply.status(503).send({ success: false, error: { message: 'Service not configured' }, meta: meta(req) });
    }

    // Reset Supabase password เป็นค่าว่าง (ผู้ใช้จะตั้งใหม่ใน /set-new-password)
    await admin.auth.admin.updateUserById(record.user_id, { password: randomUUID() + randomUUID() }); // random unguessable temp
    await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, token));

    return reply.send({ success: true, meta: meta(req) });
  });

  /* ─────────────────────────────────────────────────────────────
   * POST /auth/set-new-password
   * ตั้งรหัสผ่านใหม่บน tablet หลังจาก reset สำเร็จ
   * ───────────────────────────────────────────────────────────── */
  app.post<{ Body: unknown }>('/set-new-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const email    = (typeof body?.email    === 'string' ? body.email.trim().toLowerCase() : '');
    const password = (typeof body?.password === 'string' ? body.password : '');

    if (!email || password.length < 8) {
      throw new ValidationError(
        { password: ['รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'] },
        'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
      );
    }

    // ยืนยันว่า token ของ email นี้ used = true (reset สำเร็จแล้ว)
    const tokenRows = await db.select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.email, email), eq(passwordResetTokens.used, true)))
      .orderBy(desc(passwordResetTokens.created_at))
      .limit(1);

    if (tokenRows.length === 0) {
      throw new ValidationError({}, 'กรุณายืนยันการรีเซ็ตรหัสผ่านจาก email ก่อน');
    }

    const userId = tokenRows[0]!.user_id;
    const admin  = getSupabaseAdmin();
    if (!admin) {
      return reply.status(503).send({ success: false, error: { message: 'Service not configured' }, meta: meta(req) });
    }

    await admin.auth.admin.updateUserById(userId, { password });

    // Sign in เพื่อคืน token ให้ frontend auto-login
    await admin.auth.admin.generateLink({ type: 'magiclink', email });

    // Return success — frontend จะใช้ signInWithPassword ด้วย password ใหม่
    return reply.send({
      success: true,
      data: { message: 'ตั้งรหัสผ่านใหม่สำเร็จ' },
      meta: meta(req),
    });
  });

  // ── POST /auth/staff-login ──────────────────────────────────────────────────
  // พนักงาน login ด้วย nickname + PIN เท่านั้น (v2 — ไม่ต้องระบุ shopId)
  // nickname unique ทั้งระบบ → ระบบตรวจจับร้าน/สาขาให้อัตโนมัติ
  app.post<{ Body: unknown }>('/auth/staff-login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = staffLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }
    const { nickname, pin } = parsed.data;  // nickname already lowercased by Zod transform

    // Global nickname lookup — ไม่ filter ด้วย shopId
    const staffUser = await userRepository.findStaffByNicknameGlobal(nickname);
    if (!staffUser) {
      // ไม่เปิดเผยว่าชื่อเล่นมีอยู่หรือไม่ (ป้องกัน enumeration)
      return reply.status(401).send({
        success: false,
        error: { message: 'ชื่อเล่นหรือ PIN ไม่ถูกต้อง' },
        meta: meta(req),
      });
    }

    // ใช้ Supabase client (anon) login ด้วย synthetic email + PIN
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    if (!supabaseUrl || !supabaseAnonKey) {
      return reply.status(503).send({ success: false, error: { message: 'Service not configured' }, meta: meta(req) });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email:    staffUser.email,
      password: pin,
    });

    if (error || !data.session) {
      return reply.status(401).send({
        success: false,
        error: { message: 'ชื่อเล่นหรือ PIN ไม่ถูกต้อง' },
        meta: meta(req),
      });
    }

    return reply.send({
      success: true,
      data: {
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in:    data.session.expires_in,
        user: {
          id:        data.user?.id,
          nickname,
          role:      staffUser.role,
          shop_id:   staffUser.shop_id,   // ร้านที่ assign ไว้ใน DB
          branch_id: staffUser.branch_id, // สาขาที่ assign ไว้ใน DB
        },
      },
      meta: meta(req),
    });
  });

};

export { authRoutes };
