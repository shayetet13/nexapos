/**
 * Telegram Bot Webhook Route — NexaPos
 *
 * Flow:
 *  /start → [linked?] → เมนูหลัก
 *           [ไม่ link] → พิมพ์อีเมล → เลือกร้าน → เมนูหลัก
 *
 * เมนูหลัก:
 *  📊 ยอดขาย / 💹 กำไร / 📦 สต็อก / 👥 กะวันนี้
 *    └─ [>1 สาขา] เลือกสาขา (+ ทุกสาขา)
 *         └─ เลือกช่วงเวลา (วัน/เดือน/ปี)  [กำไรไม่มี วัน]
 *              └─ แสดงผล
 *
 * Callback scheme:
 *  menu                          → เมนูหลัก
 *  sales|pnl|stock|shift         → เลือกสาขา (หรือ direct ถ้า 1 สาขา)
 *  b:{action}:{branchKey}        → เลือกช่วงเวลา
 *  r:{action}:{branchKey}:{per}  → execute report
 *  select_shop:{shopId}          → เปลี่ยนร้าน
 *  change_shop                   → ถามอีเมลใหม่
 *  logout                        → ยกเลิกผูก
 */

import type { FastifyPluginAsync } from 'fastify';
import { createClient }              from '@supabase/supabase-js';
import { shopRepository }            from '../repositories/shop.repository.js';
import { orderRepository }           from '../repositories/order.repository.js';
import { consumableRepository }      from '../repositories/consumable.repository.js';
import { staffQrRepository }         from '../repositories/staff-qr.repository.js';
import {
  sendMsg, answerCbq,
  buildMenuKbd, buildShopKbd, buildBranchKbd, buildPeriodKbd, buildBackKbd,
} from '../lib/telegram.js';

// ── Supabase anon client — ใช้ verify password เท่านั้น ──────────────────

function getAnonClient() {
  const url = process.env.SUPABASE_URL      ?? '';
  const key = process.env.SUPABASE_ANON_KEY ?? '';
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── Session ────────────────────────────────────────────────────────────────

type SessionState =
  | { step: 'idle' }
  | { step: 'awaiting_email';    targetShopId?: string | null }
  | { step: 'awaiting_password'; email: string; targetShopId?: string | null }
  | { step: 'selecting_shop';    userId: string; shops: { id: string; name: string }[] };

const sessions = new Map<string, SessionState>();

// ── Telegram types ─────────────────────────────────────────────────────────

interface TgUpdate {
  message?: {
    chat:  { id: number; first_name?: string };
    text?: string;
  };
  callback_query?: {
    id:       string;
    from:     { id: number };
    data?:    string;
    message?: { chat: { id: number } };
  };
}

// ── Formatters ─────────────────────────────────────────────────────────────

function thb(n: number) {
  return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
}

function periodLabel(period: 'day' | 'month' | 'year') {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  if (period === 'day')   return now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  if (period === 'month') return now.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
  return now.toLocaleDateString('th-TH', { year: 'numeric' });
}

function roleLabel(role: string | null) {
  const map: Record<string, string> = { owner: 'เจ้าของ', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', viewer: 'ผู้ชม' };
  return map[role ?? ''] ?? (role ?? '-');
}

function timeFmt(d: Date) {
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

// ── Branch resolver ────────────────────────────────────────────────────────

/** ถ้าร้านมีสาขาเดียว → คืน branchId โดยตรง
 *  ถ้ามีหลายสาขา → send branch keyboard แล้ว return 'asked'
 */
async function resolveOrAskBranch(
  chatId: string,
  shopId: string,
  action: string,
): Promise<{ branchId: string | null; branchName: string } | 'asked'> {
  const branches = await shopRepository.getBranchesByShopId(shopId);
  if (branches.length === 0) return { branchId: null, branchName: 'ทุกสาขา' };
  if (branches.length === 1) {
    const b = branches[0]!;
    return { branchId: b.id, branchName: b.name };
  }
  await sendMsg(chatId, `เลือกสาขา:`, { keyboard: buildBranchKbd(action, branches) });
  return 'asked';
}

async function resolveBranchKey(
  shopId: string,
  branchKey: string,
): Promise<{ branchId: string | null; branchName: string }> {
  if (branchKey === 'all') return { branchId: null, branchName: 'ทุกสาขา' };
  const branch = await shopRepository.getBranchById(branchKey, shopId);
  return { branchId: branch?.id ?? null, branchName: branch?.name ?? 'สาขาที่เลือก' };
}

// ── Report handlers ────────────────────────────────────────────────────────

async function handleSales(
  chatId: string, shopId: string, shopName: string,
  period: 'day' | 'month' | 'year',
  branchId: string | null, branchName: string,
) {
  const data  = await orderRepository.getSalesSummary(shopId, period, branchId);
  const label = period === 'day' ? 'ยอดขายวันนี้' : period === 'month' ? 'ยอดขายเดือนนี้' : 'ยอดขายปีนี้';
  const lines = [
    `📊 *${label}*`,
    `🏪 ${shopName}  •  🏬 ${branchName}`,
    `──────────────────────`,
    `🛒 ออเดอร์    ${data.orderCount.toLocaleString('th-TH')} รายการ`,
    `💰 รายรับ     ${thb(data.revenue)}`,
    ...(data.discount > 0 ? [`🏷️ ส่วนลด      ${thb(data.discount)}`] : []),
    `──────────────────────`,
    `📅 ${periodLabel(period)}`,
  ];
  await sendMsg(chatId, lines.join('\n'), { keyboard: buildBackKbd() });
}

async function handlePnl(
  chatId: string, shopId: string, shopName: string,
  period: 'month' | 'year',
  branchId: string | null, branchName: string,
) {
  const data  = await orderRepository.getSalesSummary(shopId, period, branchId);
  const label = period === 'month' ? 'กำไรเดือนนี้' : 'กำไรปีนี้';
  const lines = [
    `💹 *${label}*`,
    `🏪 ${shopName}  •  🏬 ${branchName}`,
    `──────────────────────`,
    `💰 รายรับ     ${thb(data.revenue)}`,
    `📦 ต้นทุน     ${thb(data.cogs)}`,
    `💵 กำไร       ${thb(data.grossProfit)}`,
    `📈 Margin     ${data.marginPct.toFixed(1)}%`,
    `──────────────────────`,
    `📅 ${periodLabel(period)}`,
  ];
  await sendMsg(chatId, lines.join('\n'), { keyboard: buildBackKbd() });
}

async function handleStock(chatId: string, shopId: string, shopName: string) {
  const items = await consumableRepository.getStockSnapshot(shopId);

  if (items.length === 0) {
    await sendMsg(
      chatId,
      `📦 *สต็อกวัตถุดิบ (Real-time)*\n🏪 ${shopName}\n\n_ยังไม่มีวัตถุดิบในระบบ_\nเพิ่มได้ที่ Admin → วัตถุดิบ`,
      { keyboard: buildBackKbd() },
    );
    return;
  }

  const qtyFmt = (q: string) => {
    const n = Number(q);
    return n % 1 === 0 ? n.toLocaleString('th-TH') : n.toFixed(2).replace(/\.?0+$/, '');
  };

  const rows = items.map((item) => {
    const qty    = Number(item.quantity);
    const minQty = Number(item.min_qty);
    const icon   = qty === 0 ? '🔴' : qty <= minQty ? '⚠️' : '🟢';
    const minStr = minQty > 0 ? `  (min ${qtyFmt(item.min_qty)})` : '';
    return `${icon} ${item.name}   *${qtyFmt(item.quantity)}* ${item.unit}${minStr}`;
  });

  const critical = items.filter(i => Number(i.quantity) === 0).length;
  const low      = items.filter(i => Number(i.quantity) > 0 && Number(i.quantity) <= Number(i.min_qty)).length;
  const ok       = items.length - critical - low;

  const now = new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const lines = [
    `📦 *สต็อกวัตถุดิบ (Real-time)*`,
    `🏪 ${shopName}`,
    `──────────────────────`,
    ...rows,
    `──────────────────────`,
    `🔴 หมด ${critical}  ⚠️ ต่ำ ${low}  🟢 ปกติ ${ok}`,
    `🕐 ${now}`,
  ];
  await sendMsg(chatId, lines.join('\n'), { keyboard: buildBackKbd() });
}

async function handleShift(
  chatId: string, shopId: string, shopName: string,
  branchId: string | null, branchName: string,
) {
  const shifts = await staffQrRepository.getTodayShifts(shopId, branchId);
  if (shifts.length === 0) {
    await sendMsg(
      chatId,
      `👥 *กะวันนี้*\n🏪 ${shopName}  •  🏬 ${branchName}\n\n_ยังไม่มีพนักงาน check-in วันนี้_`,
      { keyboard: buildBackKbd() },
    );
    return;
  }
  let online = 0;
  let offline = 0;
  const rows = shifts.map((s) => {
    const inT  = s.checkedInAt  ? timeFmt(new Date(s.checkedInAt))  : '?';
    const outT = s.checkedOutAt ? timeFmt(new Date(s.checkedOutAt)) : null;
    const icon = outT ? '🔴' : '🟢';
    if (outT) offline++; else online++;
    const name = (s.email ?? '').split('@')[0];
    return outT
      ? `${icon} ${name} (${roleLabel(s.role)})  เข้า ${inT}  ออก ${outT}`
      : `${icon} ${name} (${roleLabel(s.role)})  เข้า ${inT}`;
  });
  const lines = [
    `👥 *กะวันนี้*`,
    `🏪 ${shopName}  •  🏬 ${branchName}`,
    `──────────────────────`,
    ...rows,
    `──────────────────────`,
    `🟢 ออนไลน์ ${online} คน  🔴 ออกแล้ว ${offline} คน`,
    `📅 ${periodLabel('day')}`,
  ];
  await sendMsg(chatId, lines.join('\n'), { keyboard: buildBackKbd() });
}

// ── Menu helper ────────────────────────────────────────────────────────────

async function showMenu(chatId: string, shopName: string) {
  await sendMsg(chatId, `🏪 *${shopName}*\nเลือกรายงาน:`, { keyboard: buildMenuKbd() });
}

async function dispatchAction(
  chatId: string,
  shop: { id: string; name: string },
  action: string,
) {
  // stock = real-time BOM snapshot → ไม่ต้องเลือกสาขา/ช่วงเวลา
  if (action === 'stock') {
    await handleStock(chatId, shop.id, shop.name);
    return;
  }

  const result = await resolveOrAskBranch(chatId, shop.id, action);
  if (result === 'asked') return;

  const { branchId, branchName } = result;
  if (action === 'shift') {
    await handleShift(chatId, shop.id, shop.name, branchId, branchName);
  } else {
    const branchKey = branchId ?? 'all';
    await sendMsg(chatId, `เลือกช่วงเวลา:`, { keyboard: buildPeriodKbd(action, branchKey) });
  }
}

// ── Route ──────────────────────────────────────────────────────────────────

const telegramRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TgUpdate }>(
    '/telegram/webhook',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!process.env.TELEGRAM_BOT_TOKEN) return reply.status(503).send({ ok: false });

      const update = req.body;

      // ── Callback Query ────────────────────────────────────────────
      if (update.callback_query) {
        const cbq    = update.callback_query;
        const chatId = String(cbq.message?.chat?.id ?? cbq.from.id);
        const data   = cbq.data ?? '';

        await answerCbq(cbq.id);

        // select_shop อาจมาระหว่าง flow (ก่อน link)
        if (data.startsWith('select_shop:')) {
          const shopId   = data.replace('select_shop:', '');
          const selected = await shopRepository.getShopById(shopId);
          if (!selected) { await sendMsg(chatId, '❌ ไม่พบร้านนี้'); return reply.send({ ok: true }); }
          const prev = await shopRepository.getShopByChatId(chatId);
          if (prev && prev.id !== selected.id) await shopRepository.setTelegramChatId(prev.id, null);
          await shopRepository.setTelegramChatId(shopId, chatId);
          sessions.delete(chatId);
          await sendMsg(chatId, `✅ เชื่อมต่อร้าน *${selected.name}* สำเร็จ!`);
          await showMenu(chatId, selected.name);
          return reply.send({ ok: true });
        }

        const shop = await shopRepository.getShopByChatId(chatId);
        if (!shop) {
          await sendMsg(chatId, '🔒 กรุณา login ก่อน\nพิมพ์ /start');
          return reply.send({ ok: true });
        }

        if (data === 'menu') {
          await showMenu(chatId, shop.name);

        } else if (['sales', 'pnl', 'stock', 'shift'].includes(data)) {
          await dispatchAction(chatId, shop, data);

        } else if (data.startsWith('b:')) {
          // b:{action}:{branchKey}
          const [, action = '', branchKey = 'all'] = data.split(':');
          if (action === 'stock') {
            await handleStock(chatId, shop.id, shop.name);
          } else if (action === 'shift') {
            const { branchId, branchName } = await resolveBranchKey(shop.id, branchKey);
            await handleShift(chatId, shop.id, shop.name, branchId, branchName);
          } else {
            await sendMsg(chatId, `เลือกช่วงเวลา:`, { keyboard: buildPeriodKbd(action, branchKey) });
          }

        } else if (data.startsWith('r:')) {
          // r:{action}:{branchKey}:{period}
          const parts     = data.split(':');
          const action    = parts[1] ?? '';
          const branchKey = parts[2] ?? 'all';
          const period    = parts[3] as 'day' | 'month' | 'year' | undefined;

          if (!action || !period) { await showMenu(chatId, shop.name); return reply.send({ ok: true }); }

          const { branchId, branchName } = await resolveBranchKey(shop.id, branchKey);

          if (action === 'sales') {
            await handleSales(chatId, shop.id, shop.name, period, branchId, branchName);
          } else if (action === 'pnl' && period !== 'day') {
            await handlePnl(chatId, shop.id, shop.name, period as 'month' | 'year', branchId, branchName);
          } else if (action === 'stock') {
            await handleStock(chatId, shop.id, shop.name);
          } else {
            await showMenu(chatId, shop.name);
          }

        } else if (data === 'change_shop') {
          sessions.set(chatId, { step: 'awaiting_email' });
          await sendMsg(chatId, `🔄 พิมพ์ *อีเมล* ที่ต้องการเชื่อมร้านใหม่:`);

        } else if (data === 'logout') {
          await shopRepository.setTelegramChatId(shop.id, null);
          sessions.delete(chatId);
          await sendMsg(chatId, '🚪 ออกจากระบบแล้ว\nพิมพ์ /start เพื่อ login ใหม่');
        }

        return reply.send({ ok: true });
      }

      // ── Text Message ──────────────────────────────────────────────
      const msg = update.message;
      if (!msg) return reply.send({ ok: true });

      const chatId = String(msg.chat.id);
      const text   = msg.text?.trim() ?? '';

      if (text.startsWith('/start')) {
        // รับ shopId จาก deep link: https://t.me/Bot?start={shopId}
        const deepLinkShopId = text.split(' ')[1]?.trim() || null;

        const shop = await shopRepository.getShopByChatId(chatId);
        if (shop) {
          // ถ้า chat นี้เคยเชื่อมร้านอื่นไว้แล้ว และ deep link ระบุร้านใหม่ → re-link
          if (deepLinkShopId && deepLinkShopId !== shop.id) {
            const targetShop = await shopRepository.getShopById(deepLinkShopId);
            if (targetShop) {
              // ตรวจสิทธิ์: ต้องเป็น owner/manager ของร้านนั้นก่อนจึงจะ re-link อัตโนมัติ
              // (ถ้าเปิด bot จากหน้า admin ของร้านที่เป็น owner อยู่แล้ว → ยืนยันทันที)
              sessions.set(chatId, { step: 'awaiting_email', targetShopId: deepLinkShopId });
              await sendMsg(chatId,
                `🔄 คุณต้องการเชื่อม Telegram นี้กับร้าน *${targetShop.name}*\n\nกรุณาพิมพ์ *อีเมล* ของบัญชีร้านนั้น:`,
              );
              return reply.send({ ok: true });
            }
          }
          sessions.delete(chatId);
          await showMenu(chatId, shop.name);
          return reply.send({ ok: true });
        }
        sessions.set(chatId, { step: 'awaiting_email', targetShopId: deepLinkShopId });
        await sendMsg(chatId, `👋 สวัสดีจาก *NexaPos*!\n\nกรุณาพิมพ์ *อีเมล* ที่ลงทะเบียนในระบบ:`);
        return reply.send({ ok: true });
      }

      const session = sessions.get(chatId) ?? { step: 'idle' };

      if (session.step === 'awaiting_email') {
        const email = text.toLowerCase().trim();
        // ตรวจสอบว่า email อยู่ในระบบก่อน (ไม่เปิดเผยว่ามีหรือไม่ — ให้ไปถามรหัสผ่านทุกกรณี)
        sessions.set(chatId, { step: 'awaiting_password', email, targetShopId: session.targetShopId });
        await sendMsg(chatId, `🔑 กรุณาพิมพ์ *รหัสผ่าน* ของบัญชี ${email}:`);
        return reply.send({ ok: true });
      }

      if (session.step === 'awaiting_password') {
        const { email } = session;
        const password  = text.trim();

        // verify ผ่าน Supabase Auth จริงๆ
        const supabase = getAnonClient();
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError || !authData.user) {
          await sendMsg(chatId,
            `❌ อีเมลหรือรหัสผ่านไม่ถูกต้อง\n\nลองใหม่อีกครั้ง — พิมพ์ /start เพื่อเริ่มใหม่`,
          );
          sessions.delete(chatId);
          return reply.send({ ok: true });
        }

        // ผ่านแล้ว — หาร้านของ user
        const userId       = authData.user.id;
        const shops        = await shopRepository.getShopsByUserId(userId);
        const { targetShopId } = session;

        if (shops.length === 0) {
          await sendMsg(chatId, `⚠️ บัญชีนี้ยังไม่ได้เป็นเจ้าของหรือผู้จัดการร้านใด`);
          sessions.delete(chatId);
          return reply.send({ ok: true });
        }

        // ถ้ามี targetShopId จาก deep link → ตรวจสิทธิ์แล้ว link ทันที
        if (targetShopId) {
          const targetShop = shops.find((s) => s.id === targetShopId);
          if (targetShop) {
            const prev = await shopRepository.getShopByChatId(chatId);
            if (prev && prev.id !== targetShop.id) await shopRepository.setTelegramChatId(prev.id, null);
            await shopRepository.setTelegramChatId(targetShop.id, chatId);
            sessions.delete(chatId);
            await sendMsg(chatId, `✅ เข้าสู่ระบบสำเร็จ!\nเชื่อมต่อร้าน *${targetShop.name}* แล้ว\nOTP คืนเงินจะส่งมาที่นี่`);
            await showMenu(chatId, targetShop.name);
            return reply.send({ ok: true });
          }
          // บัญชีนี้ไม่มีสิทธิ์ร้านนั้น → แสดงรายการที่มีสิทธิ์จริง
          await sendMsg(chatId, `⚠️ บัญชีนี้ไม่มีสิทธิ์เข้าถึงร้านดังกล่าว กรุณาเลือกร้านที่ถูกต้อง:`);
        }

        if (shops.length === 1) {
          const linked = shops[0]!;
          const prev   = await shopRepository.getShopByChatId(chatId);
          if (prev && prev.id !== linked.id) await shopRepository.setTelegramChatId(prev.id, null);
          await shopRepository.setTelegramChatId(linked.id, chatId);
          sessions.delete(chatId);
          await sendMsg(chatId, `✅ เข้าสู่ระบบสำเร็จ!\nเชื่อมต่อร้าน *${linked.name}* แล้ว`);
          await showMenu(chatId, linked.name);
        } else {
          sessions.set(chatId, { step: 'selecting_shop', userId, shops });
          await sendMsg(chatId,
            `✅ เข้าสู่ระบบสำเร็จ!\nพบ ${shops.length} ร้าน กรุณาเลือก:`,
            { keyboard: buildShopKbd(shops) },
          );
        }
        return reply.send({ ok: true });
      }

      if (session.step === 'selecting_shop') {
        await sendMsg(chatId, 'กรุณากดปุ่มเลือกร้าน หรือพิมพ์ /start เพื่อเริ่มใหม่');
        return reply.send({ ok: true });
      }

      // fallback
      const linkedShop = await shopRepository.getShopByChatId(chatId);
      if (linkedShop) {
        await showMenu(chatId, linkedShop.name);
      } else {
        await sendMsg(chatId, '👋 พิมพ์ /start เพื่อเริ่มต้นใช้งาน');
      }
      return reply.send({ ok: true });
    },
  );
};

export { telegramRoutes };
