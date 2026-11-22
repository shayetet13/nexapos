import { randomUUID } from "node:crypto";
import type { BotInboundEvent } from "@linebot/bot-worker";
import type { MemoryStore } from "./store.js";
import type {
	BankAlertRecord,
	BankCode,
	PromptPayIdType,
	PromptPayPayment,
	PromptPayPaymentStatus,
	PromptPayVerificationIssue,
} from "./types.js";

const PROMPTPAY_AID = "A000000677010111";
const THAI_MONTHS: Record<string, number> = {
	"ม.ค.": 0,
	"ก.พ.": 1,
	"มี.ค.": 2,
	"เม.ย.": 3,
	"พ.ค.": 4,
	"มิ.ย.": 5,
	"ก.ค.": 6,
	"ส.ค.": 7,
	"ก.ย.": 8,
	"ต.ค.": 9,
	"พ.ย.": 10,
	"ธ.ค.": 11,
};

export interface CreatePromptPayPaymentInput {
	botId: string;
	sourceTargetId: string;
	promptPayIdType: PromptPayIdType;
	promptPayId: string;
	amount: string;
	destinationLast4?: string;
	expiresInSeconds?: number;
}

function tag(id: string, value: string): string {
	if (value.length > 99) throw new RangeError(`EMV value for tag ${id} is too long`);
	return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16Ccitt(value: string): string {
	let crc = 0xffff;
	for (const byte of new TextEncoder().encode(value)) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
	}
	return crc.toString(16).toUpperCase().padStart(4, "0");
}

function normalizePromptPayId(type: PromptPayIdType, input: string): { subTag: string; value: string } {
	const digits = input.replace(/\D/g, "");
	if (type === "phone") {
		if (!/^0\d{9}$/.test(digits)) throw new TypeError("เบอร์พร้อมเพย์ต้องเป็นเบอร์มือถือไทย 10 หลัก");
		return { subTag: "01", value: `0066${digits.slice(1)}` };
	}
	if (type === "national_id") {
		if (!/^\d{13}$/.test(digits)) throw new TypeError("เลขบัตรประชาชน/เลขผู้เสียภาษีต้องมี 13 หลัก");
		return { subTag: "02", value: digits };
	}
	if (!/^\d{15}$/.test(digits)) throw new TypeError("e-Wallet ID ต้องมี 15 หลัก");
	return { subTag: "03", value: digits };
}

export function amountToSatang(amount: string): number {
	if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(amount.trim())) throw new TypeError("จำนวนเงินต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง");
	const [baht, fraction = ""] = amount.trim().split(".");
	const satang = Number(baht) * 100 + Number(fraction.padEnd(2, "0"));
	if (!Number.isSafeInteger(satang) || satang <= 0) throw new TypeError("จำนวนเงินต้องมากกว่า 0 บาท");
	return satang;
}

export function generatePromptPayPayload(type: PromptPayIdType, promptPayId: string, amountSatang: number): string {
	if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) throw new TypeError("จำนวนเงินไม่ถูกต้อง");
	const target = normalizePromptPayId(type, promptPayId);
	const merchantAccount = tag("00", PROMPTPAY_AID) + tag(target.subTag, target.value);
	const amount = `${Math.floor(amountSatang / 100)}.${String(amountSatang % 100).padStart(2, "0")}`;
	const withoutCrc = tag("00", "01") + tag("01", "12") + tag("29", merchantAccount) +
		tag("53", "764") + tag("54", amount) + tag("58", "TH") + "6304";
	return withoutCrc + crc16Ccitt(withoutCrc);
}

function maskPromptPayId(value: string): string {
	const digits = value.replace(/\D/g, "");
	return digits.length <= 4 ? digits : `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function parseAmount(value: string): number | undefined {
	const normalized = value.replaceAll(",", "");
	if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
	return amountToSatang(normalized);
}

function parseThaiDate(text: string): string | null {
	const named = text.match(/(\d{1,2})\s*(ม\.[คย]\.|ก\.[พค]\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(\d{2,4})\s*(\d{1,2}):(\d{2})/);
	const slash = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(\d{1,2}):(\d{2})/);
	let day: number;
	let month: number;
	let year: number;
	let hour: number;
	let minute: number;
	if (named) {
		day = Number(named[1]);
		month = THAI_MONTHS[named[2]!] ?? -1;
		year = Number(named[3]);
		hour = Number(named[4]);
		minute = Number(named[5]);
	} else if (slash) {
		day = Number(slash[1]);
		month = Number(slash[2]) - 1;
		year = Number(slash[3]);
		hour = Number(slash[4]);
		minute = Number(slash[5]);
	} else return null;
	if (year < 100) year += 2500;
	if (year >= 2400) year -= 543;
	if (month < 0 || month > 11) return null;
	return new Date(Date.UTC(year, month, day, hour - 7, minute)).toISOString();
}

/**
 * KTB labels the sender's name separately from their masked account
 * ("ผู้โอน" vs "จากบัญชี"). SCB folds both into a single "จากบัญชี" line
 * (e.g. "บจก. เพาเวอร์ X-9693 กสิกรไทย") with no separate name label, so
 * that whole line is kept as-is rather than guessing where the name ends.
 * KBank's LINE OA card carries no payer identity at all -- it shows only the
 * destination side (เข้าบัญชี / จำนวนเงิน / ยอดเงินคงเหลือ) -- so this
 * intentionally returns null for kbank rather than fabricating a value.
 */
function valueAfterLabel(text: string, labels: readonly string[]): string | null {
	const expression = [...labels]
		.sort((left, right) => right.length - left.length)
		.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
	const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${expression})\\s*[:：-]?\\s*([^\\n]+)`, "im"));
	return match?.[1]?.trim() || null;
}

function firstAmountAfterLabel(text: string, labels: readonly string[]): number | null {
	const expression = [...labels]
		.sort((left, right) => right.length - left.length)
		.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
	const match = text.match(new RegExp(`(?:${expression})\\s*[:：-]?\\s*\\+?\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*บาท`, "i"));
	return match ? parseAmount(match[1]!) ?? null : null;
}

function accountAfterLabel(text: string, labels: readonly string[]): string | null {
	const value = valueAfterLabel(text, labels);
	return value && /[Xx*…\d]/.test(value) ? value : null;
}

function detectBank(text: string, targetName: string): BankCode {
	// The trusted target name is more reliable than a payer's bank name which
	// may also appear inside a transaction card (for example an SCB transfer
	// from a KBank account).
	if (/\bk\s*bank\b|กสิกร/i.test(targetName)) return "kbank";
	if (/\bkrungthai\b|กรุงไทย/i.test(targetName)) return "ktb";
	if (/\bscb\b|ไทยพาณิชย์/i.test(targetName)) return "scb";
	if (/รายการเงินเข้า/i.test(text) && /วันที่\/เวลา/i.test(text) && /ยอด(?:เงิน)?ที่ใช้ได้/i.test(text)) return "scb";
	if (/เงินโอนเข้า-พร้อมเพย์/i.test(text) || (/เงินเข้า/i.test(text) && /จากบัญชี/i.test(text) && /ยอดที่ใช้ได้/i.test(text))) return "ktb";
	if (/รายการเงินเข้า/i.test(text) && /จำนวนเงิน/i.test(text)) return "kbank";
	return "other";
}

function extractPayerName(bank: BankCode, compact: string): string | null {
	const payer = valueAfterLabel(compact, ["ผู้โอน", "ผู้ส่ง", "ชื่อผู้โอน"]);
	if (payer) return payer;
	// SCB and several other banks combine the payer name and source account in
	// a single "จากบัญชี" line. Preserve that real OA value rather than trying
	// to guess where a name ends.
	if (bank === "scb") return valueAfterLabel(compact, ["จากบัญชี"]);
	return null;
}

/**
 * Parse the visible text extracted from a bank LINE OA Flex card. Known bank
 * layouts receive their familiar codes, while a new allowlisted OA uses the
 * generic incoming-transfer parser and is reported as `other` with its OA name.
 */
export function parseBankAlert(text: string, targetName = "LINE OA ธนาคาร"): Pick<BankAlertRecord, "bank" | "bankName" | "amountSatang" | "destinationLast4" | "destinationAccount" | "sourceAccount" | "transactionType" | "availableBalanceSatang" | "transactionAt" | "payerName"> | undefined {
	const compact = text
		.replace(/\u00a0/g, " ")
		.replace(/[\u200b-\u200d\u2060\uFEFF]/g, "")
		.trim();
	if (!compact) return undefined;
	const bank = detectBank(compact, targetName);
	const isIncoming = /รายการเงินเข้า|เงินโอนเข้า|เงินเข้าบัญชี|เงินเข้า|รับเงิน|รับโอน/i.test(compact);
	if (!isIncoming) return undefined;
	const amountSatang = firstAmountAfterLabel(compact, ["จำนวนเงิน", "ยอดเงินเข้า", "เงินเข้า", "เงินโอนเข้า", "รับเงิน", "รายการเงินเข้า"]);
	if (!amountSatang) return undefined;
	const destinationAccount = accountAfterLabel(compact, ["เข้าบัญชี", "บัญชีผู้รับ", "บัญชีปลายทาง"]);
	// A generic notification must name its destination account. The three
	// documented OA layouts are kept compatible with older cards that omit it.
	if (bank === "other" && !destinationAccount) return undefined;
	const destination = destinationAccount?.replace(/\D/g, "");
	const sourceAccount = accountAfterLabel(compact, ["จากบัญชี", "บัญชีผู้โอน", "บัญชีต้นทาง"]);
	const transactionType = valueAfterLabel(compact, ["ประเภท", "ประเภทรายการ", "ช่องทาง"]);
	return {
		bank,
		bankName: targetName.trim() || "LINE OA ธนาคาร",
		amountSatang,
		destinationLast4: destination?.slice(-4) || null,
		destinationAccount,
		sourceAccount,
		transactionType,
		availableBalanceSatang: firstAmountAfterLabel(compact, ["ยอดเงินคงเหลือ", "ยอดเงินที่ใช้ได้", "ยอดที่ใช้ได้", "ยอดคงเหลือ", "คงเหลือ"]),
		transactionAt: parseThaiDate(compact),
		payerName: extractPayerName(bank, compact),
	};
}

export class PromptPayService {
	constructor(private readonly store: MemoryStore) {}

	create(input: CreatePromptPayPaymentInput): PromptPayPayment {
		const bot = this.store.getBot(input.botId);
		if (!bot || bot.adapter !== "linejs") throw new TypeError("ต้องเลือก LINEJS bot ที่มีอยู่");
		if (bot.status !== "online" || !bot.lastHeartbeatAt || Date.now() - Date.parse(bot.lastHeartbeatAt) > 15_000) {
			throw new TypeError("LINE listener ยังไม่พร้อม กรุณารอให้ bot เป็น Online และมี heartbeat ล่าสุดก่อนสร้าง QR");
		}
		const target = this.store.targets.get(input.sourceTargetId);
		if (!target || target.botId !== bot.id || !target.enabled) throw new TypeError("ต้องเลือกแชต LINE OA ของธนาคารที่เปิดใช้งาน");
		this.expirePending();
		const amountSatang = amountToSatang(input.amount);
		const windowSeconds = input.expiresInSeconds ?? 120;
		const createdAt = new Date();
		// Two people can ask for the exact same amount on the exact same target at
		// the exact same moment (e.g. a fixed-price lottery ticket). Only one QR
		// per (target, amount) may ever be live/payable at a time -- a second
		// request instead waits in queue and is only handed a real, scannable QR
		// once the first slot holder resolves. This is what actually prevents two
		// simultaneous bank transfers of the same amount from ever landing while
		// both are "pending", which is the only way handleInbound can tell them
		// apart (banks don't send a transaction reference we can match on).
		const slotTaken = [...this.store.promptPayPayments.values()].some((existing) =>
			existing.botId === bot.id &&
			existing.sourceTargetId === target.id &&
			existing.amountSatang === amountSatang &&
			(existing.status === "pending" || existing.status === "queued")
		);
		// createdAt alone ties at millisecond resolution when several requests
		// land in the same tick (exactly the "4 people at once" case), so FIFO
		// order is decided by this monotonic counter instead.
		const queueSeq = Math.max(0, ...[...this.store.promptPayPayments.values()].map((existing) => existing.queueSeq)) + 1;
		const payment: PromptPayPayment = {
			id: `pp_${randomUUID()}`,
			botId: bot.id,
			sourceTargetId: target.id,
			promptPayIdType: input.promptPayIdType,
			promptPayIdMasked: maskPromptPayId(input.promptPayId),
			amountSatang,
			destinationLast4: input.destinationLast4?.replace(/\D/g, "").slice(-4) || null,
			qrPayload: generatePromptPayPayload(input.promptPayIdType, input.promptPayId, amountSatang),
			status: slotTaken ? "queued" : "pending",
			verificationMethod: "bank_line_oa_notification",
			windowSeconds,
			queueSeq,
			createdAt: createdAt.toISOString(),
			// A queued payment's window hasn't started yet -- expiresAt is
			// meaningless until promoteNextQueued grants it a real slot, so it's
			// left equal to createdAt rather than already-expired or fabricated.
			expiresAt: slotTaken ? createdAt.toISOString() : new Date(createdAt.getTime() + windowSeconds * 1_000).toISOString(),
			verifiedAt: null,
			bankAlertId: null,
			bank: null,
			bankName: null,
			verificationIssue: null,
			payerName: null,
			sourceAccount: null,
			destinationAccount: null,
			transactionType: null,
			availableBalanceSatang: null,
			transactionAt: null,
		};
		this.store.savePromptPayPayment(payment);
		this.store.addAudit(slotTaken ? "promptpay.queued" : "promptpay.created", bot.id, { paymentId: payment.id, amountSatang, sourceTargetId: target.id });
		this.store.publish("promptpay.payment.updated", payment, bot.id);
		return payment;
	}

	/** 1-indexed position in the FIFO line for this (target, amount) slot; 0 once it's no longer queued. */
	queuePosition(payment: PromptPayPayment): number {
		if (payment.status !== "queued") return 0;
		const line = [...this.store.promptPayPayments.values()]
			.filter((other) =>
				other.botId === payment.botId &&
				other.sourceTargetId === payment.sourceTargetId &&
				other.amountSatang === payment.amountSatang &&
				other.status === "queued"
			)
			.sort((left, right) => left.queueSeq - right.queueSeq);
		return line.findIndex((item) => item.id === payment.id) + 1;
	}

	list(botId?: string): PromptPayPayment[] {
		this.expirePending();
		return this.store.listPromptPayPayments(botId);
	}

	get(id: string): PromptPayPayment | undefined {
		this.expirePending();
		return this.store.promptPayPayments.get(id);
	}

	cancel(id: string): PromptPayPayment | undefined {
		const payment = this.store.promptPayPayments.get(id);
		if (!payment || (payment.status !== "pending" && payment.status !== "queued")) return undefined;
		return this.update({ ...payment, status: "cancelled" }, payment.status);
	}

	/** Removes a payment from history regardless of status. Unlike cancel, this doesn't require "pending" -- it's for clearing clutter from the list, not stopping an in-flight one. */
	remove(id: string): boolean {
		const payment = this.store.promptPayPayments.get(id);
		if (!payment) return false;
		const removed = this.store.deletePromptPayPayment(payment.botId, id);
		if (removed) this.store.publish("promptpay.payment.deleted", { id }, payment.botId);
		return removed;
	}

	handleInbound(event: BotInboundEvent): void {
		if (event.isBot) return;
		const target = this.store.findTarget(event.botId, event.targetId);
		if (!target?.enabled) return;
		const waitingForThisTarget = [...this.store.promptPayPayments.values()].some((payment) =>
			payment.botId === event.botId &&
			payment.sourceTargetId === target.id &&
			payment.status === "pending" &&
			Date.parse(payment.expiresAt) >= Date.now()
		);
		if (!event.text) {
			if (waitingForThisTarget) this.reportUnparsed(event, target.id, "empty_text");
			return;
		}
		if (/จำนวนเงินจะแสดง/i.test(event.text) && /ยืนยันตัวตนผ่าน\s*K\s*PLUS/i.test(event.text)) {
			if (waitingForThisTarget) this.reportUnparsed(event, target.id, "kbank_amount_hidden");
			return;
		}
		const parsed = parseBankAlert(event.text, target.name);
		if (!parsed) {
			if (waitingForThisTarget) this.reportUnparsed(event, target.id, "unsupported_bank_message");
			return;
		}
		// Diagnostic only: bank+amount parsed fine but the payer-name regex found
		// nothing. Digit-redacted like reportUnparsed's textShape -- keeps labels,
		// punctuation and line order so the real card layout can be inspected
		// without persisting amounts/account digits.
		if (!parsed.payerName) {
			this.store.addAudit("promptpay.payer_name_missing", event.botId, {
				bank: parsed.bank,
				textShape: event.text.replace(/\d/g, "#").slice(0, 500),
			});
		}
		const alertId = `alert_${event.botId}_${event.eventId}`;
		if (this.store.bankAlerts.has(alertId)) return;
		const alert = this.store.saveBankAlert({
			id: alertId,
			botId: event.botId,
			sourceTargetId: target.id,
			lineMessageId: event.eventId,
			...parsed,
			receivedAt: new Date().toISOString(),
			paymentId: null,
		});
		// LINE's immutable server message timestamp is authoritative for the QR
		// window. The date printed inside a bank card is useful metadata but may
		// be formatted/coarsened differently and must not move an alert in time.
		const eventAt = event.timestamp;
		const candidates = this.store.listPromptPayPayments(event.botId).filter((payment) =>
			(payment.status === "pending" || payment.status === "expired") &&
			payment.sourceTargetId === target.id &&
			payment.amountSatang === alert.amountSatang &&
			(!payment.destinationLast4 || payment.destinationLast4 === alert.destinationLast4) &&
			Date.parse(payment.createdAt) <= eventAt &&
			Date.parse(payment.expiresAt) >= eventAt
		);
		if (candidates.length === 1) {
			const payment = candidates[0]!;
			alert.paymentId = payment.id;
			this.store.saveBankAlert(alert);
			this.update({
				...payment,
				status: "succeeded",
				verifiedAt: new Date().toISOString(),
				bankAlertId: alert.id,
			bank: alert.bank,
			bankName: alert.bankName,
			destinationLast4: alert.destinationLast4 ?? payment.destinationLast4,
			payerName: alert.payerName,
			sourceAccount: alert.sourceAccount,
			destinationAccount: alert.destinationAccount,
			transactionType: alert.transactionType,
			availableBalanceSatang: alert.availableBalanceSatang,
				transactionAt: alert.transactionAt,
				verificationIssue: null,
			}, payment.status);
			this.store.addAudit("promptpay.succeeded", event.botId, { paymentId: payment.id, bank: alert.bank, amountSatang: alert.amountSatang });
		} else if (candidates.length > 1) {
			for (const payment of candidates) this.update({ ...payment, status: "ambiguous", bank: alert.bank }, payment.status);
			this.store.addAudit("promptpay.ambiguous", event.botId, { bankAlertId: alert.id, candidateIds: candidates.map((payment) => payment.id) });
		}
		this.expirePending();
	}

	private reportUnparsed(event: BotInboundEvent, sourceTargetId: string, reason: PromptPayVerificationIssue): void {
		const details = {
			eventId: event.eventId,
			sourceTargetId,
			reason,
			textLength: event.text.length,
			// Preserve labels, punctuation and line order for parser diagnostics,
			// but never persist account numbers, balances, dates or amounts.
			textShape: event.text.replace(/\d/g, "#").slice(0, 500),
		};
		this.store.addAudit("promptpay.bank_message_unparsed", event.botId, details);
		this.store.publish("promptpay.bank_message.unparsed", details, event.botId);
		for (const payment of this.store.promptPayPayments.values()) {
			if (
				payment.botId === event.botId &&
				payment.sourceTargetId === sourceTargetId &&
				payment.status === "pending" &&
				Date.parse(payment.expiresAt) >= Date.now()
			) this.update({ ...payment, verificationIssue: reason });
		}
	}

	private expirePending(): void {
		const timestamp = Date.now();
		for (const payment of this.store.promptPayPayments.values()) {
			if (payment.status === "pending" && Date.parse(payment.expiresAt) < timestamp) this.update({ ...payment, status: "expired" }, payment.status);
		}
	}

	/**
	 * Hands the (target, amount) slot that `payment` just vacated to whichever
	 * queued request has been waiting longest. The window starts now, not at
	 * the original request time, so time spent waiting in queue is never
	 * deducted from the payer's actual pay-by window.
	 */
	private promoteNextQueued(botId: string, sourceTargetId: string, amountSatang: number): void {
		const stillHeld = [...this.store.promptPayPayments.values()].some((other) =>
			other.botId === botId && other.sourceTargetId === sourceTargetId && other.amountSatang === amountSatang && other.status === "pending"
		);
		if (stillHeld) return;
		const next = [...this.store.promptPayPayments.values()]
			.filter((other) => other.botId === botId && other.sourceTargetId === sourceTargetId && other.amountSatang === amountSatang && other.status === "queued")
			.sort((left, right) => left.queueSeq - right.queueSeq)[0];
		if (!next) return;
		const grantedAt = new Date();
		const promoted: PromptPayPayment = {
			...next,
			status: "pending",
			createdAt: grantedAt.toISOString(),
			expiresAt: new Date(grantedAt.getTime() + next.windowSeconds * 1_000).toISOString(),
		};
		this.store.savePromptPayPayment(promoted);
		this.store.publish("promptpay.payment.updated", promoted, promoted.botId);
		this.store.addAudit("promptpay.dequeued", botId, { paymentId: promoted.id, amountSatang, sourceTargetId });
	}

	private update(payment: PromptPayPayment, previousStatus?: PromptPayPaymentStatus): PromptPayPayment {
		this.store.savePromptPayPayment(payment);
		this.store.publish(payment.status === "succeeded" ? "promptpay.payment.succeeded" : "promptpay.payment.updated", payment, payment.botId);
		if (previousStatus === "pending" && payment.status !== "pending") {
			this.promoteNextQueued(payment.botId, payment.sourceTargetId, payment.amountSatang);
		}
		return payment;
	}
}
