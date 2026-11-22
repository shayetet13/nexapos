import { describe, expect, it } from "vitest";
import { generatePromptPayPayload, parseBankAlert, PromptPayService } from "../src/promptpay.js";
import { MemoryStore } from "../src/store.js";

const alerts = {
	kbank: `รายการเงินเข้า
28 ก.ค. 69 22:19 น.
เข้าบัญชี xxx-x-x9731-x
จำนวนเงิน 1.00 บาท
ยอดเงินคงเหลือ 3.20 บาท`,
	ktb: `เงินเข้า +200.00 บาท
ประเภท เงินโอนเข้า-พร้อมเพย์
เข้าบัญชี XX4439
จากบัญชี CLICX XX9787
ยอดที่ใช้ได้ 200.71 บาท
วันที่ทำรายการ 23/07/69 13:56`,
	scb: `รายการเงินเข้า
+ 1,940.00 บาท
จากบัญชี บจก. เพาเวอร์ X-9693 กสิกรไทย
เข้าบัญชี X-9765
วันที่/เวลา 27/07/2026 17:26
ยอดเงินที่ใช้ได้ 3,467.48 บาท`,
};

describe("PromptPay QR", () => {
	it("generates a dynamic Thai PromptPay payload with amount, THB and CRC", () => {
		const payload = generatePromptPayPayload("phone", "0812345678", 100);
		expect(payload).toContain("000201");
		expect(payload).toContain("010212");
		expect(payload).toContain("0016A000000677010111");
		expect(payload).toContain("01130066812345678");
		expect(payload).toContain("5303764");
		expect(payload).toContain("54041.00");
		expect(payload).toMatch(/5802TH6304[0-9A-F]{4}$/);
	});

	it.each([
		["kbank", alerts.kbank, 100, "9731"],
		["ktb", alerts.ktb, 20_000, "4439"],
		["scb", alerts.scb, 194_000, "9765"],
	] as const)("parses %s LINE OA Flex text", (bank, text, amountSatang, destinationLast4) => {
		expect(parseBankAlert(text)).toMatchObject({ bank, amountSatang, destinationLast4 });
	});

	it("parses styled Flex text split by newlines and zero-width characters", () => {
		expect(parseBankAlert("รายการ\u200bเงินเข้า\nจำนวนเงิน\n1.00\nบาท\nเข้าบัญชี xxx-x-x9731-x")).toMatchObject({
			bank: "kbank",
			amountSatang: 100,
			destinationLast4: "9731",
		});
	});

	it("parses a newly allowlisted bank from common incoming-transfer labels", () => {
		const text = `แจ้งเตือนเงินเข้าบัญชี
ยอดเงินเข้า + 500.00 บาท
จากบัญชี XXX-X-1234
เข้าบัญชี XXX-X-5678
ประเภทรายการ โอนเงินพร้อมเพย์
ยอดคงเหลือ 1,200.50 บาท
วันที่ทำรายการ 30/07/69 12:34`;
		expect(parseBankAlert(text, "Bangkok Bank Connect")).toMatchObject({
			bank: "other",
			bankName: "Bangkok Bank Connect",
			amountSatang: 50_000,
			destinationLast4: "5678",
			sourceAccount: "XXX-X-1234",
			destinationAccount: "XXX-X-5678",
			transactionType: "โอนเงินพร้อมเพย์",
			availableBalanceSatang: 120_050,
		});
	});

	it("keeps every detail shown in the supplied KTB and SCB OA cards", () => {
		expect(parseBankAlert(alerts.ktb, "Krungthai Connext")).toMatchObject({
			bank: "ktb",
			bankName: "Krungthai Connext",
			sourceAccount: "CLICX XX9787",
			transactionType: "เงินโอนเข้า-พร้อมเพย์",
			availableBalanceSatang: 20_071,
		});
		expect(parseBankAlert(alerts.scb, "SCB Connect")).toMatchObject({
			bank: "scb",
			bankName: "SCB Connect",
			sourceAccount: "บจก. เพาเวอร์ X-9693 กสิกรไทย",
			availableBalanceSatang: 346_748,
		});
	});

	it("reports a KBank notification whose amount is hidden pending K PLUS verification", () => {
		const store = new MemoryStore();
		const bot = store.createBot({
			name: "Payment listener",
			description: "",
			adapter: "linejs",
			enabled: true,
			speedProfile: "safe",
			maxMessagesPerSecond: 1,
			burst: 1,
			timezone: "Asia/Bangkok",
			riskAcknowledgedAt: new Date().toISOString(),
		});
		store.setStatus(bot.id, "online", "online");
		const target = store.upsertTarget({
			botId: bot.id,
			externalId: "u-kbank-live",
			type: "user",
			name: "KBank Live",
			enabled: true,
			consentConfirmedAt: new Date().toISOString(),
		});
		const service = new PromptPayService(store);
		service.create({
			botId: bot.id,
			sourceTargetId: target.id,
			promptPayIdType: "phone",
			promptPayId: "0812345678",
			amount: "1.00",
		});
		service.handleInbound({
			botId: bot.id,
			eventId: "line-message-hidden-amount",
			targetId: target.externalId,
			targetKind: "user",
			senderId: target.externalId,
			text: "รายการเงินเข้า\nจำนวนเงินจะแสดง หลังจากดำเนินการ\n\"ยืนยันตัวตนผ่าน K PLUS\" เรียบร้อยแล้ว",
			timestamp: Date.now(),
			source: "linejs",
		});
		expect(store.auditLog[0]).toMatchObject({
			action: "promptpay.bank_message_unparsed",
			details: { reason: "kbank_amount_hidden" },
		});
		store.close();
	});

	it("succeeds only when exactly one pending payment matches a trusted OA target", () => {
		const store = new MemoryStore();
		const bot = store.createBot({
			name: "Payment listener",
			description: "",
			adapter: "linejs",
			enabled: true,
			speedProfile: "safe",
			maxMessagesPerSecond: 1,
			burst: 1,
			timezone: "Asia/Bangkok",
			riskAcknowledgedAt: new Date().toISOString(),
		});
		store.setStatus(bot.id, "online", "online");
		const target = store.upsertTarget({
			botId: bot.id,
			externalId: "u-kbank-live",
			type: "user",
			name: "KBank Live",
			enabled: true,
			consentConfirmedAt: new Date().toISOString(),
		});
		const service = new PromptPayService(store);
		const payment = service.create({
			botId: bot.id,
			sourceTargetId: target.id,
			promptPayIdType: "phone",
			promptPayId: "0812345678",
			amount: "1.00",
			destinationLast4: "9731",
		});

		service.handleInbound({
			botId: bot.id,
			eventId: "line-message-1",
			targetId: target.externalId,
			targetKind: "user",
			senderId: target.externalId,
			text: alerts.kbank,
			timestamp: Date.now(),
			source: "linejs",
		});

		expect(service.get(payment.id)).toMatchObject({
			status: "succeeded",
			bank: "kbank",
			amountSatang: 100,
		});
		store.close();
	});

	it("recovers a missed alert from chat history after the QR timer expired", () => {
		const store = new MemoryStore();
		const bot = store.createBot({
			name: "Payment listener",
			description: "",
			adapter: "linejs",
			enabled: true,
			speedProfile: "safe",
			maxMessagesPerSecond: 1,
			burst: 1,
			timezone: "Asia/Bangkok",
			riskAcknowledgedAt: new Date().toISOString(),
		});
		store.setStatus(bot.id, "online", "online");
		const target = store.upsertTarget({
			botId: bot.id,
			externalId: "u-kbank-live",
			type: "user",
			name: "KBank Live",
			enabled: true,
			consentConfirmedAt: new Date().toISOString(),
		});
		const service = new PromptPayService(store);
		const payment = service.create({
			botId: bot.id,
			sourceTargetId: target.id,
			promptPayIdType: "phone",
			promptPayId: "0812345678",
			amount: "1.00",
		});
		store.savePromptPayPayment({ ...payment, status: "expired" });
		service.handleInbound({
			botId: bot.id,
			eventId: "history-message-1",
			targetId: target.externalId,
			targetKind: "user",
			senderId: target.externalId,
			text: "รายการเงินเข้า\nจำนวนเงิน\n1.00 บาท",
			timestamp: Date.parse(payment.createdAt) + 1_000,
			source: "linejs",
		});
		expect(service.get(payment.id)).toMatchObject({ status: "succeeded", bank: "kbank" });
		store.close();
	});

	it("marks equal simultaneous candidates ambiguous instead of verifying the wrong QR", () => {
		// This can no longer happen through service.create() -- the queue (tested
		// below) serializes same-amount, same-target requests so at most one is
		// ever "pending" at once. The only way two genuinely-simultaneous pending
		// records can still exist is out-of-band store surgery (e.g. imported
		// history, a bug elsewhere), so that's simulated directly here to keep
		// this safety net covered.
		const store = new MemoryStore();
		const bot = store.createBot({
			name: "Payment listener",
			description: "",
			adapter: "linejs",
			enabled: true,
			speedProfile: "safe",
			maxMessagesPerSecond: 1,
			burst: 1,
			timezone: "Asia/Bangkok",
			riskAcknowledgedAt: new Date().toISOString(),
		});
		store.setStatus(bot.id, "online", "online");
		const target = store.upsertTarget({
			botId: bot.id,
			externalId: "u-kbank-live",
			type: "user",
			name: "KBank Live",
			enabled: true,
			consentConfirmedAt: new Date().toISOString(),
		});
		const service = new PromptPayService(store);
		const input = { botId: bot.id, sourceTargetId: target.id, promptPayIdType: "phone" as const, promptPayId: "0812345678", amount: "1.00" };
		const first = service.create(input);
		const second = service.create(input);
		expect(second.status).toBe("queued");
		store.savePromptPayPayment({ ...service.get(second.id)!, status: "pending", expiresAt: new Date(Date.now() + 120_000).toISOString() });

		service.handleInbound({
			botId: bot.id,
			eventId: "line-message-2",
			targetId: target.externalId,
			targetKind: "user",
			senderId: target.externalId,
			text: alerts.kbank,
			timestamp: Date.now(),
			source: "linejs",
		});

		expect(service.get(first.id)?.status).toBe("ambiguous");
		expect(service.get(second.id)?.status).toBe("ambiguous");
		store.close();
	});

	describe("same-amount queueing", () => {
		function setUpBot(store: MemoryStore) {
			const bot = store.createBot({
				name: "Payment listener",
				description: "",
				adapter: "linejs",
				enabled: true,
				speedProfile: "safe",
				maxMessagesPerSecond: 1,
				burst: 1,
				timezone: "Asia/Bangkok",
				riskAcknowledgedAt: new Date().toISOString(),
			});
			store.setStatus(bot.id, "online", "online");
			const target = store.upsertTarget({
				botId: bot.id,
				externalId: "u-kbank-live",
				type: "user",
				name: "KBank Live",
				enabled: true,
				consentConfirmedAt: new Date().toISOString(),
			});
			return { bot, target };
		}

		it("queues 4 simultaneous requests for the same amount and promotes them one at a time as each resolves", () => {
			const store = new MemoryStore();
			const { bot, target } = setUpBot(store);
			const service = new PromptPayService(store);
			const input = { botId: bot.id, sourceTargetId: target.id, promptPayIdType: "phone" as const, promptPayId: "0812345678", amount: "1.00", expiresInSeconds: 90 };

			const [a, b, c, d] = [service.create(input), service.create(input), service.create(input), service.create(input)];

			// Only the first caller actually gets a live, payable QR -- the other
			// three cannot possibly have transferred money yet at this point,
			// which is exactly what rules out the "4 people transfer 100 baht at
			// literally the same instant" collision.
			expect(a!.status).toBe("pending");
			expect(b!.status).toBe("queued");
			expect(c!.status).toBe("queued");
			expect(d!.status).toBe("queued");
			expect(service.queuePosition(b!)).toBe(1);
			expect(service.queuePosition(c!)).toBe(2);
			expect(service.queuePosition(d!)).toBe(3);

			// A pays -> matches unambiguously because it's the only "pending"
			// record for this (target, amount) key -- then B is auto-promoted.
			service.handleInbound({
				botId: bot.id,
				eventId: "line-message-a",
				targetId: target.externalId,
				targetKind: "user",
				senderId: target.externalId,
				text: alerts.kbank,
				timestamp: Date.now(),
				source: "linejs",
			});
			expect(service.get(a!.id)?.status).toBe("succeeded");
			const promotedB = service.get(b!.id)!;
			expect(promotedB.status).toBe("pending");
			expect(service.get(c!.id)?.status).toBe("queued");
			expect(service.get(d!.id)?.status).toBe("queued");
			// B's pay-by window starts fresh at promotion time, not back-dated to
			// when B originally asked for a QR while still in line.
			expect(Date.parse(promotedB.expiresAt) - Date.parse(promotedB.createdAt)).toBe(90_000);

			// B cancels instead of paying -> C is promoted next.
			service.cancel(b!.id);
			expect(service.get(c!.id)?.status).toBe("pending");
			expect(service.get(d!.id)?.status).toBe("queued");
			expect(service.queuePosition(service.get(d!.id)!)).toBe(1);

			// C's window expires without payment -> D is promoted last.
			const stale = service.get(c!.id)!;
			store.savePromptPayPayment({ ...stale, expiresAt: new Date(Date.now() - 1_000).toISOString() });
			expect(service.get(c!.id)?.status).toBe("expired");
			expect(service.get(d!.id)?.status).toBe("pending");
			store.close();
		});

		it("does not queue when the amounts differ or the slot holder already resolved", () => {
			const store = new MemoryStore();
			const { bot, target } = setUpBot(store);
			const service = new PromptPayService(store);

			const hundredBaht = service.create({ botId: bot.id, sourceTargetId: target.id, promptPayIdType: "phone", promptPayId: "0812345678", amount: "100.00" });
			const twoHundredBaht = service.create({ botId: bot.id, sourceTargetId: target.id, promptPayIdType: "phone", promptPayId: "0812345678", amount: "200.00" });
			expect(hundredBaht.status).toBe("pending");
			expect(twoHundredBaht.status).toBe("pending");

			service.cancel(hundredBaht.id);
			const secondHundredBaht = service.create({ botId: bot.id, sourceTargetId: target.id, promptPayIdType: "phone", promptPayId: "0812345678", amount: "100.00" });
			expect(secondHundredBaht.status).toBe("pending");
			store.close();
		});
	});
});
