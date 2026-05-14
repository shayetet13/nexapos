/**
 * Telegram Bot service
 * - sendRefundOtp / sendRefundConfirmed  — refund flow (existing)
 * - sendMsg / answerCbq / buildMenuKbd / buildShopKbd — bot menu (new)
 */

// ── Types ──────────────────────────────────────────────────────────────────

interface InlineButton { text: string; callback_data: string }
export interface InlineKeyboard { inline_keyboard: InlineButton[][] }

// ── Internal helper ────────────────────────────────────────────────────────

async function tgPost(token: string, method: string, body: object): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }).catch(() => null);
  if (res && !res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`[TELEGRAM] ${method} failed: ${res.status} ${txt}`);
  }
}

// ── Public: generic message sender ────────────────────────────────────────

export async function sendMsg(
  chatId: string,
  text: string,
  opts?: { keyboard?: InlineKeyboard; parseMode?: string },
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.log(`[TELEGRAM] ${chatId}: ${text}`); return; }
  await tgPost(token, 'sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: opts?.parseMode ?? 'Markdown',
    ...(opts?.keyboard ? { reply_markup: opts.keyboard } : {}),
  });
}

// ── Public: answer callback query (stops spinner) ──────────────────────────

export async function answerCbq(callbackQueryId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await tgPost(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId });
}

// ── Keyboard builders ──────────────────────────────────────────────────────

export function buildMenuKbd(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '📊 ยอดขาย',  callback_data: 'sales'  },
        { text: '💹 กำไร',    callback_data: 'pnl'    },
        { text: '📦 สต็อก',   callback_data: 'stock'  },
      ],
      [
        { text: '👥 กะวันนี้', callback_data: 'shift' },
      ],
      [
        { text: '🔄 เปลี่ยนร้าน', callback_data: 'change_shop' },
        { text: '🚪 ออกจากระบบ',  callback_data: 'logout'      },
      ],
    ],
  };
}

export function buildShopKbd(shops: { id: string; name: string }[]): InlineKeyboard {
  return {
    inline_keyboard: shops.map((s) => [
      { text: `🏪 ${s.name}`, callback_data: `select_shop:${s.id}` },
    ]),
  };
}

/** เลือกสาขา  callback: b:{action}:{branchId|all} */
export function buildBranchKbd(
  action: string,
  branches: { id: string; name: string }[],
): InlineKeyboard {
  const rows = branches.map((b) => [
    { text: `🏬 ${b.name}`, callback_data: `b:${action}:${b.id}` },
  ]);
  rows.push([{ text: '🏢 ทุกสาขา',   callback_data: `b:${action}:all` }]);
  rows.push([{ text: '◀ กลับเมนู', callback_data: 'menu' }]);
  return { inline_keyboard: rows };
}

/** เลือกช่วงเวลา  callback: r:{action}:{branchKey}:{period} */
export function buildPeriodKbd(action: string, branchKey: string): InlineKeyboard {
  const p = `r:${action}:${branchKey}`;
  const periodRow = action === 'pnl'
    ? [
        { text: '📅 เดือนนี้', callback_data: `${p}:month` },
        { text: '📆 ปีนี้',   callback_data: `${p}:year`  },
      ]
    : [
        { text: '📊 วันนี้',   callback_data: `${p}:day`   },
        { text: '📅 เดือนนี้', callback_data: `${p}:month` },
        { text: '📆 ปีนี้',   callback_data: `${p}:year`  },
      ];
  return { inline_keyboard: [periodRow, [{ text: '◀ กลับเมนู', callback_data: 'menu' }]] };
}

export function buildBackKbd(): InlineKeyboard {
  return { inline_keyboard: [[{ text: '◀ กลับเมนู', callback_data: 'menu' }]] };
}

// ── Refund: OTP ────────────────────────────────────────────────────────────

/** ส่ง OTP 4 หลักไปยัง Telegram Chat ของร้าน */
export async function sendRefundOtp(
  chatId: string | null | undefined,
  otp: string,
  shopName: string,
  requesterEmail?: string,
): Promise<void> {
  if (!chatId) {
    console.log(`[TELEGRAM PLACEHOLDER] Shop: ${shopName} | OTP: ${otp} | By: ${requesterEmail ?? '?'}`);
    return;
  }
  const byLine = requesterEmail ? `\n👤 พนักงาน: *${requesterEmail}*` : '';
  await sendMsg(chatId,
    `🏪 *${shopName}*${byLine}\n\n🔐 รหัสยืนยันการคืนเงิน:\n\n*${otp}*\n\n⏱ รหัสหมดอายุใน 10 นาที\nอย่าเปิดเผยรหัสนี้ให้ผู้อื่น`,
  );
}

// ── Refund: Confirmed ──────────────────────────────────────────────────────

/** แจ้งเตือนหลังคืนเงินสำเร็จ */
export async function sendRefundConfirmed(
  chatId: string | null | undefined,
  opts: {
    shopName:      string;
    orderSeq:      number | string;
    total:         string | number;
    refundType:    string;
    reason:        string;
    refundedBy:    string;
    cashReceived?: number;
  },
): Promise<void> {
  if (!chatId) return;

  const typeLabel = opts.refundType === 'money_mistake' ? '💵 รับเงินผิด' : '📦 คืนสินค้า';
  const totalFmt  = Number(opts.total).toLocaleString('th-TH', { minimumFractionDigits: 2 });

  let cashLine = '';
  if (opts.refundType === 'money_mistake' && opts.cashReceived != null) {
    const diff  = opts.cashReceived - Number(opts.total);
    const label = diff > 0 ? `รับเกิน ฿${Math.abs(diff).toFixed(2)}` : `รับขาด ฿${Math.abs(diff).toFixed(2)}`;
    cashLine = `\n💰 เงินที่รับมา: ฿${opts.cashReceived.toFixed(2)} (${label})`;
  }

  await sendMsg(chatId,
    `✅ *คืนเงินสำเร็จ*\n` +
    `🏪 ${opts.shopName}\n` +
    `🧾 ออเดอร์ #${opts.orderSeq}\n` +
    `💳 ยอด: ฿${totalFmt}\n` +
    `${typeLabel}${cashLine}\n` +
    `📝 เหตุผล: ${opts.reason}\n` +
    `👤 ดำเนินการโดย: *${opts.refundedBy}*\n` +
    `🕐 ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
  );
}
