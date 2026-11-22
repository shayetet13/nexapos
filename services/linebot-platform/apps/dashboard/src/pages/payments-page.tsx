import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, QrCode, Radio, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal } from "../components/shared";
import type { DashboardApi } from "../lib/api-client";
import type { CreatePromptPayPaymentInput, DashboardData, PromptPayIdType, PromptPayPayment } from "../types";

const bankNames = { kbank: "KBank Live", ktb: "Krungthai Connext", scb: "SCB Connect" };
const statusLabels = {
	queued: "รอคิว",
	pending: "รอเงินเข้า",
	succeeded: "สำเร็จ",
	ambiguous: "ต้องตรวจสอบ",
	expired: "หมดอายุ",
	cancelled: "ยกเลิก",
};
const HISTORY_PAGE_SIZE = 5;

interface PaymentsPageProps {
	data: DashboardData;
	api: DashboardApi;
	notify: (message: string, tone?: "success" | "error") => void;
}

export function PaymentsPage({ data, api, notify }: PaymentsPageProps) {
	const lineBots = data.bots.filter((bot) => bot.adapter === "linejs");
	const [botId, setBotId] = useState(lineBots[0]?.id ?? "");
	const targets = useMemo(() => data.targets.filter((target) => target.botId === botId && target.allowed), [botId, data.targets]);
	const [sourceTargetId, setSourceTargetId] = useState("");
	const [idType, setIdType] = useState<PromptPayIdType>("phone");
	const [promptPayId, setPromptPayId] = useState("");
	const [amount, setAmount] = useState("");
	const [destinationLast4, setDestinationLast4] = useState("");
	const [payment, setPayment] = useState<PromptPayPayment>();
	const [payments, setPayments] = useState<PromptPayPayment[]>([]);
	const [busy, setBusy] = useState(false);
	const [now, setNow] = useState(Date.now());
	const [historyPage, setHistoryPage] = useState(1);
	const [deleteTarget, setDeleteTarget] = useState<PromptPayPayment>();
	const [deleteBusy, setDeleteBusy] = useState(false);

	useEffect(() => {
		if (!targets.some((target) => target.id === sourceTargetId)) setSourceTargetId(targets[0]?.id ?? "");
	}, [sourceTargetId, targets]);

	// listPromptPayPayments already returns newest-first (createdAt desc), so
	// paging is a plain slice. Clamp back to the last valid page whenever the
	// list shrinks (e.g. after a delete) so the view never lands on an empty page.
	const totalHistoryPages = Math.max(1, Math.ceil(payments.length / HISTORY_PAGE_SIZE));
	useEffect(() => { setHistoryPage((current) => Math.min(current, totalHistoryPages)); }, [totalHistoryPages]);
	const pagedPayments = payments.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

	const confirmDelete = async () => {
		if (!deleteTarget) return;
		setDeleteBusy(true);
		try {
			await api.deletePromptPayPayment(deleteTarget.id);
			if (payment?.id === deleteTarget.id) setPayment(undefined);
			setDeleteTarget(undefined);
			await refresh();
			notify("ลบรายการแล้ว");
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : "ลบรายการไม่สำเร็จ", "error");
		} finally {
			setDeleteBusy(false);
		}
	};

	const refresh = useCallback(async () => {
		const next = await api.listPromptPayPayments(botId || undefined);
		setPayments(next);
		setPayment((current) => current ? next.find((item) => item.id === current.id) ?? current : current);
	}, [api, botId]);

	useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
	// Keeps the "recent transactions" history live too -- previously it only
	// ever fetched once on mount, so a payment settling while this list was on
	// screen (rather than the active QR card) never updated without a manual F5.
	useEffect(() => {
		const timer = window.setInterval(() => void refresh().catch(() => undefined), 2_000);
		return () => window.clearInterval(timer);
	}, [refresh]);
	useEffect(() => {
		const timer = window.setInterval(() => {
			setNow(Date.now());
			// Also poll while queued: this is the only way the screen finds out it
			// was promoted to "pending" and handed a real, scannable QR.
			if (payment?.status === "pending" || payment?.status === "queued") void api.getPromptPayPayment(payment.id).then(setPayment).catch(() => undefined);
		}, 250);
		return () => window.clearInterval(timer);
	}, [api, payment?.id, payment?.status]);
	// Background tabs throttle setInterval (sometimes to once a minute or less),
	// so a payment can settle on the server while the poll above is stalled.
	// Catch up immediately the moment the tab is looked at again instead of
	// waiting for the next throttled tick.
	useEffect(() => {
		const catchUp = () => {
			if (document.visibilityState !== "visible") return;
			void refresh().catch(() => undefined);
			if (payment?.status === "pending" || payment?.status === "queued") void api.getPromptPayPayment(payment.id).then(setPayment).catch(() => undefined);
		};
		document.addEventListener("visibilitychange", catchUp);
		window.addEventListener("focus", catchUp);
		return () => {
			document.removeEventListener("visibilitychange", catchUp);
			window.removeEventListener("focus", catchUp);
		};
	}, [api, refresh, payment?.id, payment?.status]);

	const create = async () => {
		setBusy(true);
		try {
			const input: CreatePromptPayPaymentInput = {
				botId,
				sourceTargetId,
				promptPayIdType: idType,
				promptPayId,
				amount,
				expiresInSeconds: 120,
				...(destinationLast4 ? { destinationLast4 } : {}),
			};
			const created = await api.createPromptPayPayment(input);
			setPayment(created);
			await refresh();
			notify("สร้าง QR แล้ว ระบบกำลังตรวจข้อความเงินเข้าทันที");
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : "สร้าง QR ไม่สำเร็จ", "error");
		} finally {
			setBusy(false);
		}
	};

	const secondsLeft = payment ? Math.max(0, Math.ceil((Date.parse(payment.expiresAt) - now) / 1_000)) : 0;
	// `payments` already holds every payment for this bot (all targets, all
	// amounts), so the position in line is just this payment's rank among the
	// still-queued rows sharing the same (target, amount) slot -- no separate
	// endpoint needed.
	const queuePosition = payment?.status === "queued"
		? payments
			.filter((item) => item.status === "queued" && item.sourceTargetId === payment.sourceTargetId && item.amountSatang === payment.amountSatang)
			.sort((left, right) => left.queueSeq - right.queueSeq)
			.findIndex((item) => item.id === payment.id) + 1
		: 0;
	const canCreate = Boolean(botId && sourceTargetId && promptPayId && /^\d+(?:\.\d{1,2})?$/.test(amount));
	const detectorIssue = payment?.verificationIssue === "kbank_amount_hidden"
		? "KBank ซ่อนจำนวนเงิน · กรุณายืนยันตัวตนผ่าน K PLUS"
		: payment?.verificationIssue
			? "รับข้อความจาก LINE OA แล้ว แต่รูปแบบการ์ดยังอ่านไม่ได้"
			: "";

	return (
		<div className="page-stack payment-page">
			<section className="page-intro">
				<div><p className="eyebrow">PROMPTPAY LIVE VERIFY</p><h2>สร้าง QR แล้วรอผลจากธนาคารแบบสด</h2><p>ระบบตรวจ Flex Message จาก LINE OA ทันทีที่ธนาคารส่งเข้า ไม่ต้องรอให้ครบอายุรายการ</p></div>
				<div className="payment-live"><Radio size={16} /><span>LISTENER ACTIVE</span><strong>ทันที</strong></div>
			</section>

			<div className="payment-layout">
				<section className="panel payment-form">
					<header><span><QrCode size={20} /></span><div><p className="eyebrow">NEW PAYMENT</p><h3>ข้อมูล QR พร้อมเพย์</h3></div></header>
					<div className="payment-fields">
						<label><span>LINEJS bot</span><select value={botId} onChange={(event) => setBotId(event.target.value)}><option value="">เลือก bot</option>{lineBots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
						<label><span>แชต LINE OA ธนาคาร</span><select value={sourceTargetId} onChange={(event) => setSourceTargetId(event.target.value)}><option value="">เลือกแชตแจ้งเตือน</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select><small>{targets.length ? "ไม่ต้องใช้ credentials ของธนาคาร ระบบอ่านจากบัญชี LINE ที่ล็อกอินไว้" : "ยังไม่พบ OA: ไปที่บอท → Targets → ค้นหากลุ่ม / LINE OA แล้วเปิด allowlist"}</small></label>
						<label><span>ประเภทพร้อมเพย์</span><select value={idType} onChange={(event) => setIdType(event.target.value as PromptPayIdType)}><option value="phone">เบอร์มือถือ</option><option value="national_id">บัตรประชาชน / เลขผู้เสียภาษี</option><option value="ewallet">e-Wallet ID</option></select></label>
						<label><span>หมายเลขพร้อมเพย์</span><input value={promptPayId} onChange={(event) => setPromptPayId(event.target.value)} inputMode="numeric" placeholder={idType === "phone" ? "08xxxxxxxx" : "กรอกเฉพาะตัวเลข"} /></label>
						<label><span>จำนวนเงิน (บาท)</span><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="100.00" /></label>
						<label><span>เลขท้ายบัญชีรับเงิน (ไม่บังคับ)</span><input value={destinationLast4} maxLength={4} onChange={(event) => setDestinationLast4(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="9731" /><small>ช่วยลดความเสี่ยงเมื่อมีหลายบัญชี</small></label>
					</div>
					<Button variant="primary" loading={busy} disabled={!canCreate} onClick={() => void create()} icon={<QrCode size={17} />}>สร้าง QR และเริ่มตรวจทันที</Button>
					<div className="payment-note"><ShieldCheck size={17} /><p>QR ใช้รูปแบบ Thai QR Payment/PromptPay และ CRC16 ตามมาตรฐาน EMVCo ของ ธปท.</p></div>
				</section>

				<section className={`panel payment-stage payment-stage--${payment?.status ?? "empty"}`}>
					{!payment ? <div className="payment-empty"><QrCode size={56} /><h3>QR จะแสดงที่นี่</h3><p>กรอกจำนวนเงินแล้วกดสร้าง ระบบจะเปิดตัวตรวจสอบพร้อมกันทันที</p></div> : null}
					{payment && payment.status === "queued" ? <div className="payment-empty">
						<QrCode size={56} />
						<h3>รอคิวอยู่ที่ {queuePosition || "…"}</h3>
						<p>มีรายการยอด ฿{(payment.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} กำลังรอเงินเข้าอยู่ที่แชตนี้ ระบบจะออก QR ให้ทันทีที่ถึงคิว (ยังโอนไม่ได้ตอนนี้)</p>
						<Button variant="ghost" onClick={() => void api.cancelPromptPayPayment(payment.id).then(setPayment)} icon={<X size={15} />}>ยกเลิกรายการ</Button>
					</div> : null}
					{payment && payment.status === "pending" ? <>
						<div className="payment-qr"><QRCodeSVG value={payment.qrPayload} size={232} level="M" includeMargin /></div>
						<div className="payment-amount">฿{(payment.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
						<div className="payment-waiting"><i /><div><strong>{detectorIssue || "กำลังรอข้อความเงินเข้า"}</strong><span>{detectorIssue ? (detectorIssue.startsWith("KBank") ? "เปิด KBank Live แล้วทำรายการยืนยันกับ K PLUS ก่อนทดสอบ QR ใหม่" : "ระบบบันทึกเหตุขัดข้องไว้แล้ว") : `ตรวจทุกข้อความทันที · เหลือ ${secondsLeft} วินาที`}</span></div></div>
						<Button variant="ghost" onClick={() => void api.cancelPromptPayPayment(payment.id).then(setPayment)} icon={<X size={15} />}>ยกเลิกรายการ</Button>
					</> : null}
					{payment?.status === "succeeded" ? <div className="payment-success"><span><CheckCircle2 size={58} /></span><p className="eyebrow">PAYMENT SUCCEEDED</p><h2>ชำระเงินสำเร็จ</h2><strong>฿{(payment.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong><p>ตรวจพบจาก {payment.bank ? bankNames[payment.bank] : "LINE OA ธนาคาร"}<br />{payment.verifiedAt ? new Date(payment.verifiedAt).toLocaleString("th-TH") : ""}</p>{payment.payerName || payment.destinationLast4 || payment.transactionAt ? <p>{payment.payerName ? <>ผู้โอน: {payment.payerName}<br /></> : null}{payment.destinationLast4 ? <>เข้าบัญชี: ****{payment.destinationLast4}<br /></> : null}{payment.transactionAt ? <>เวลาที่ธนาคารแจ้ง: {new Date(payment.transactionAt).toLocaleString("th-TH")}</> : null}</p> : null}<Button onClick={() => setPayment(undefined)} icon={<RotateCcw size={15} />}>สร้างรายการใหม่</Button></div> : null}
					{payment && ["expired", "cancelled", "ambiguous"].includes(payment.status) ? <div className="payment-result-warning"><AlertTriangle size={48} /><h3>{payment.status === "ambiguous" ? "พบหลายรายการที่ตรงกัน" : payment.status === "expired" ? "รายการหมดอายุ" : "ยกเลิกรายการแล้ว"}</h3><p>{payment.status === "ambiguous" ? "ยังไม่ยืนยันอัตโนมัติเพื่อป้องกันการจับคู่ผิด กรุณาตรวจสอบรายการธนาคาร" : "สร้าง QR ใหม่ได้ทันที"}</p><Button onClick={() => setPayment(undefined)} icon={<RotateCcw size={15} />}>สร้างรายการใหม่</Button></div> : null}
				</section>
			</div>

			<section className="panel payment-history">
				<header><div><p className="eyebrow">RECENT TRANSACTIONS</p><h3>สถานะล่าสุด</h3></div><span>{payments.length} รายการ</span></header>
				{payments.length ? <>
					<div>{pagedPayments.map((item) => <div className="payment-history__row" key={item.id}>
						<button type="button" className="payment-history__select" onClick={() => setPayment(item)}><span className={`payment-status-dot payment-status-dot--${item.status}`} /><div><strong>฿{(item.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong><small>{new Date(item.createdAt).toLocaleString("th-TH")}</small></div><span>{item.bank ? bankNames[item.bank] : data.targets.find((target) => target.id === item.sourceTargetId)?.name ?? "LINE OA"}</span><em>{statusLabels[item.status]}</em><Clock3 size={14} /></button>
						<button type="button" className="danger-icon" onClick={() => setDeleteTarget(item)} aria-label={`ลบรายการ ฿${(item.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`}><Trash2 size={15} /></button>
					</div>)}</div>
					{totalHistoryPages > 1 ? <div className="payment-history__pagination">
						<button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((current) => current - 1)} aria-label="หน้าก่อนหน้า"><ChevronLeft size={16} /></button>
						<span>หน้า {historyPage} / {totalHistoryPages}</span>
						<button type="button" disabled={historyPage >= totalHistoryPages} onClick={() => setHistoryPage((current) => current + 1)} aria-label="หน้าถัดไป"><ChevronRight size={16} /></button>
					</div> : null}
				</> : <p className="payment-history__empty">ยังไม่มีรายการชำระเงิน</p>}
			</section>

			<Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(undefined)} title="ลบรายการนี้?" description={deleteTarget ? `฿${(deleteTarget.amountSatang / 100).toLocaleString("th-TH", { minimumFractionDigits: 2 })} · ${new Date(deleteTarget.createdAt).toLocaleString("th-TH")}` : ""} danger size="sm" footer={<><Button variant="ghost" onClick={() => setDeleteTarget(undefined)}>ยกเลิก</Button><Button variant="danger" loading={deleteBusy} onClick={() => void confirmDelete()} icon={<Trash2 size={16} />}>ลบ</Button></>}><p className="danger-copy">การดำเนินการนี้ย้อนกลับไม่ได้ ลบแล้วจะหายจากประวัติถาวร</p></Modal>
		</div>
	);
}
