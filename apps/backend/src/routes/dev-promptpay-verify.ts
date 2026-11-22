/**
 * Dev Dashboard: ผูก LINE Bot (LINEJS platform) + แชท LINE OA ธนาคาร ให้แต่ละร้าน — dev admin เท่านั้น
 *
 * API key ของ platform (env LINEJS_API_KEY) เห็น bot และ payment ของทุกร้าน เจ้าของร้านจึงไม่มีสิทธิ์เลือก bot เอง:
 *  - รายการ bot ทั้งหมดของ platform ส่งให้เฉพาะ dev admin ที่นี่
 *  - 1 bot ผูกได้ร้านเดียว (unique index shop_pp_verify_bot_id_idx + ตรวจล่วงหน้าเพื่อข้อความที่อ่านง่าย)
 *  - เปลี่ยน/ยกเลิกการผูกจะปิดใช้งานของร้านนั้นเพื่อให้ owner ยืนยันใหม่
 */
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requireDevAdmin } from '../lib/dev-guard.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { meta } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { getPlatformStatus, promptpayVerifyApi, type BotOption } from '../lib/promptpay-verify-api.js';
import { promptpayVerifyRepository, type BindingRow } from '../repositories/promptpay-verify.repository.js';
import { shopRepository } from '../repositories/shop.repository.js';

const idField = z.string().trim().min(1).max(100).regex(/^[\w-]+$/);

const bindingSchema = z.object({
  bot_id:           idField.nullable(),
  source_target_id: idField.nullable(),
}).strict().refine(
  (v) => (v.bot_id === null) === (v.source_target_id === null),
  { message: 'ส่ง bot_id และ source_target_id พร้อมกัน (หรือ null ทั้งคู่เพื่อยกเลิกการผูก)' },
);

const shopIdSchema = z.string().uuid();

function uniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

type BotWithClaim = BotOption & { claimed_by: { shop_id: string; shop_name: string } | null };

const devPromptpayVerifyRoutes: FastifyPluginAsync = async (app) => {
  // GET /dev/promptpay-verify/overview — สถานะ platform + bot ทั้งหมด (พร้อมว่าใครผูกอยู่) + การผูกของทุกร้าน
  app.get('/overview', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await requireDevAdmin(req);
    const [platform, bindings] = await Promise.all([getPlatformStatus(), promptpayVerifyRepository.listBindings()]);

    let bots: BotWithClaim[] = [];
    let platformError: string | null = null;
    if (platform.base_url_configured && platform.api_key_configured) {
      try {
        const options = await promptpayVerifyApi.listBotOptions();
        bots = options.map((b) => {
          const owner = bindings.find((x) => x.bot_id === b.id);
          return { ...b, claimed_by: owner ? { shop_id: owner.shop_id, shop_name: owner.shop_name } : null };
        });
      } catch (err) {
        platformError = err instanceof AppError ? err.message : 'เชื่อมต่อ LINEJS platform ไม่ได้';
      }
    }
    return reply.send({
      success: true,
      data: { platform, platform_error: platformError, bots, bindings },
      meta: meta(req),
    });
  });

  // PUT /dev/promptpay-verify/shops/:shopId/binding — ผูก/เปลี่ยน/ยกเลิก (ทั้งสองเป็น null)
  app.put<{ Params: { shopId: string }; Body: unknown }>('/shops/:shopId/binding', {
    preHandler: [app.auth],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    await requireDevAdmin(req);
    const shopId = shopIdSchema.safeParse(req.params.shopId);
    if (!shopId.success) throw new ValidationError({ shopId: ['shopId ไม่ถูกต้อง'] });
    const body = bindingSchema.safeParse(req.body);
    if (!body.success) {
      const { fieldErrors, formErrors } = body.error.flatten();
      throw new ValidationError(formErrors.length ? { ...fieldErrors, bot_id: formErrors } : fieldErrors);
    }

    const shop = await shopRepository.getShopById(shopId.data);
    if (!shop) throw new NotFoundError('Shop');

    const current = await promptpayVerifyRepository.getConfig(shopId.data);
    const { bot_id: botId, source_target_id: targetId } = body.data;

    let patch: Parameters<typeof promptpayVerifyRepository.upsertConfig>[1];
    if (botId === null || targetId === null) {
      // ยกเลิกการผูก → ปิดใช้งานด้วย (ไม่มี bot ให้ตรวจเงินเข้า)
      patch = { bot_id: null, bot_name: null, source_target_id: null, source_target_name: null, enabled: false };
    } else {
      // ยืนยันกับ platform ว่า bot/แชทนี้มีจริง เปิดใช้งาน และยืนยัน consent แล้ว
      const options = await promptpayVerifyApi.listBotOptions();
      const bot = options.find((b) => b.id === botId);
      const target = bot?.targets.find((t) => t.id === targetId);
      if (!bot || !target) {
        throw new ValidationError({ bot_id: ['ไม่พบ Bot/แชทนี้บน platform (ต้องเปิดใช้งานและยืนยัน consent แล้ว)'] });
      }
      const claimed = (await promptpayVerifyRepository.listBindings())
        .find((b: BindingRow) => b.bot_id === bot.id && b.shop_id !== shopId.data);
      if (claimed) throw new ConflictError(`Bot นี้ถูกผูกกับร้าน "${claimed.shop_name}" แล้ว`);

      const changed = current?.bot_id !== bot.id || current?.source_target_id !== target.id;
      patch = {
        bot_id: bot.id, bot_name: bot.name, source_target_id: target.id, source_target_name: target.name,
        // เปลี่ยนแชท/บอทของร้านที่เปิดอยู่ → ให้ owner ยืนยันเปิดใหม่อีกครั้ง (ยอดจะเข้าคนละบัญชีได้)
        ...(changed && current?.bot_id ? { enabled: false } : {}),
      };
    }

    let saved;
    try {
      saved = await promptpayVerifyRepository.upsertConfig(shopId.data, patch);
    } catch (err) {
      if (uniqueViolation(err)) throw new ConflictError('Bot นี้ถูกผูกกับร้านอื่นแล้ว');
      throw err;
    }

    audit.adminAction({
      event: 'bind_promptpay_verify_bot',
      request_id: req.id, user_id: req.auth?.userId ?? null, ip_address: req.ip, shop_id: shopId.data,
      entity_type: 'shop_promptpay_verify', entity_id: shopId.data,
      changes: {
        from: { bot_id: current?.bot_id ?? null, source_target_id: current?.source_target_id ?? null },
        to:   { bot_id: saved.bot_id, source_target_id: saved.source_target_id },
      },
    });
    return reply.send({
      success: true,
      data: {
        shop_id: shopId.data, shop_name: shop.name,
        bot_id: saved.bot_id, bot_name: saved.bot_name,
        source_target_id: saved.source_target_id, source_target_name: saved.source_target_name,
        enabled: saved.enabled,
      },
      meta: meta(req),
    });
  });
};

export { devPromptpayVerifyRoutes };
