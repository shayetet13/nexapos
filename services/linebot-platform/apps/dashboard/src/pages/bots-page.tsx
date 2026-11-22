import {
	Activity,
	Box,
	Check,
	ChevronRight,
	CircleGauge,
	Clock3,
	Cpu,
	ExternalLink,
	KeyRound,
	MemoryStick,
	MessageSquareText,
	Pause,
	Play,
	Plus,
	Power,
	QrCode,
	Radio,
	RefreshCw,
	Search,
	ShieldCheck,
	Trash2,
	UsersRound,
	Workflow,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { MAX_MESSAGES_PER_SECOND, MIN_MESSAGE_INTERVAL_MS, speedProfileLabels, type AuthEventPayload, type CreateTargetInput } from "../lib/api-client";
import { BotAvatar, Button, EmptyState, ErrorBoundary, formatRelativeTime, formatUptime, Modal, StatusBadge, Toggle } from "../components/shared";
import type { BotSummary, ControlCommand, CreateBotInput, DashboardData, QrAuthSession, SenderRole, SpeedProfile, SystemSettings, Target } from "../types";

interface BotsPageProps {
	data: DashboardData;
	search: string;
	onCreate: () => void;
	onOpenBot: (bot: BotSummary) => void;
	onControl: (bot: BotSummary, command: ControlCommand) => void;
	busyBotId?: string;
}

export function BotsPage({ data, search, onCreate, onOpenBot, onControl, busyBotId }: BotsPageProps) {
	const [statusFilter, setStatusFilter] = useState("all");
	const filtered = useMemo(() => data.bots.filter((bot) => {
		const matchesSearch = `${bot.name} ${bot.description} ${bot.adapter}`.toLowerCase().includes(search.toLowerCase());
		const matchesStatus = statusFilter === "all" || bot.status === statusFilter || (statusFilter === "active" && ["online", "degraded"].includes(bot.status));
		return matchesSearch && matchesStatus;
	}), [data.bots, search, statusFilter]);

	return (
		<div className="page-stack bots-page">
			<section className="page-intro">
				<div><p className="eyebrow">ISOLATED RUNTIMES</p><h2>หนึ่ง bot ต่อหนึ่ง process</h2><p>Credential, state, rules และ queue ของแต่ละ bot ถูกแยกจากกันอย่างชัดเจน</p></div>
				<Button variant="primary" onClick={onCreate} icon={<Plus size={17} />}>เพิ่ม bot</Button>
			</section>

			<section className="fleet-summary">
				<div><span className="fleet-summary__icon"><Radio /></span><p>กำลังทำงาน<strong>{data.bots.filter((bot) => ["online", "degraded"].includes(bot.status)).length}</strong><small>process</small></p></div>
				<div><span className="fleet-summary__icon"><MessageSquareText /></span><p>ข้อความรวม<strong>{data.bots.reduce((sum, bot) => sum + bot.throughputPerMinute, 0)}</strong><small>ต่อ นาที</small></p></div>
				<div><span className="fleet-summary__icon"><UsersRound /></span><p>กลุ่มที่อนุญาต<strong>{data.bots.reduce((sum, bot) => sum + bot.allowedTargets, 0)}</strong><small>targets</small></p></div>
				<div><span className="fleet-summary__icon"><Cpu /></span><p>โหลดเฉลี่ย<strong>{Math.round(data.bots.reduce((sum, bot) => sum + bot.cpuPercent, 0) / Math.max(data.bots.length, 1))}%</strong><small>CPU</small></p></div>
			</section>

			<div className="list-toolbar">
				<div className="segmented" role="group" aria-label="กรองสถานะ">
					{[["all", "ทั้งหมด"], ["active", "ทำงาน"], ["paused", "พัก"], ["stopped", "หยุด"]].map(([value, label]) => <button key={value} type="button" className={statusFilter === value ? "is-active" : ""} onClick={() => setStatusFilter(value)}>{label}</button>)}
				</div>
				<label className="local-search"><Search size={16} /><input value={search} readOnly placeholder="ค้นหา bot…" /><span>{filtered.length} รายการ</span></label>
			</div>

			{filtered.length ? (
				<div className="bot-card-grid">
					{filtered.map((bot) => (
						<article className={`bot-card bot-card--${bot.status}`} key={bot.id}>
							<div className="bot-card__accent" style={{ background: bot.accent }} />
							<header className="bot-card__header">
								<BotAvatar name={bot.name} accent={bot.accent} size="lg" />
								<div><h3>{bot.name}</h3><p>{bot.adapter === "official" ? "Official Messaging API · OA ของคุณเอง" : "LINEJS · กลุ่ม/OpenChat/แชต OA ธนาคาร"}</p></div>
								<StatusBadge status={bot.status} />
							</header>
							<p className="bot-card__description">{bot.description}</p>
							<div className="bot-card__metrics">
								<div><span>THROUGHPUT</span><strong>{bot.throughputPerMinute}<small> msg/min</small></strong></div>
								<div><span>RESPONSE P95</span><strong>{bot.responseP95Ms || "—"}<small>{bot.responseP95Ms ? " ms" : ""}</small></strong></div>
								<div><span>FIRST WIN</span><strong>{bot.firstResponseRate || "—"}<small>{bot.firstResponseRate ? "%" : ""}</small></strong></div>
							</div>
							<div className="bot-card__meta">
								<span><UsersRound size={14} />{bot.allowedTargets} กลุ่ม</span>
								<span><Workflow size={14} />{data.rules.filter((rule) => rule.botId === bot.id && rule.enabled).length} rules</span>
								<span><Clock3 size={14} />{formatUptime(bot.uptimeSeconds)}</span>
							</div>
							<footer className="bot-card__footer">
								<div className="bot-card__controls">
									{["online", "degraded"].includes(bot.status) ? (
										<Button loading={busyBotId === bot.id} onClick={() => onControl(bot, "pause")} icon={<Pause size={15} />}>พัก</Button>
									) : (
										<Button loading={busyBotId === bot.id} disabled={bot.adapter === "linejs" && !bot.credentialsConfigured} title={bot.adapter === "linejs" && !bot.credentialsConfigured ? "เชื่อมบัญชี LINE ด้วย QR login ก่อน (กด จัดการ)" : undefined} onClick={() => onControl(bot, bot.status === "paused" ? "resume" : "start")} icon={<Play size={15} />}>เริ่ม</Button>
									)}
									<Button variant="ghost" disabled={bot.status === "stopped" || busyBotId === bot.id} onClick={() => onControl(bot, "stop")} icon={<Power size={15} />}>หยุด</Button>
								</div>
								<button className="detail-link" type="button" onClick={() => onOpenBot(bot)}>จัดการ <ChevronRight size={15} /></button>
							</footer>
						</article>
					))}
				</div>
			) : <EmptyState title="ไม่พบ bot" description="ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ" action={<Button onClick={() => setStatusFilter("all")}>ล้างตัวกรอง</Button>} />}
		</div>
	);
}

interface CreateBotModalProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (input: CreateBotInput) => Promise<void>;
	/** Fleet-wide defaults from the Settings page; undefined until they load. */
	defaults?: SystemSettings;
}

export function CreateBotModal({ open, onClose, onSubmit, defaults }: CreateBotModalProps) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [adapter, setAdapter] = useState<CreateBotInput["adapter"]>("official");
	const [speedProfile, setSpeedProfile] = useState<SpeedProfile>(defaults?.defaultSpeedProfile ?? "balanced");
	// Operators think in "how far apart should messages be", not "messages per
	// second" -- stored as the interval in ms and converted at submit time.
	const [customIntervalMs, setCustomIntervalMs] = useState("200");
	const [customBurst, setCustomBurst] = useState("5");
	const [channelSecret, setChannelSecret] = useState("");
	const [channelAccessToken, setChannelAccessToken] = useState("");
	const [acceptedRisk, setAcceptedRisk] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");

	// Re-apply the fleet default every time the modal opens: `defaults` can
	// still be loading on the very first open, and a prior session's choice
	// (or a leftover value from the last bot created) should never linger.
	useEffect(() => {
		if (!open) return;
		setSpeedProfile(defaults?.defaultSpeedProfile ?? "balanced");
	}, [open, defaults?.defaultSpeedProfile]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) return setError("กรุณาตั้งชื่อ bot");
		if (adapter === "linejs" && !acceptedRisk) return setError("ต้องยอมรับความเสี่ยงของ LINEJS ก่อน");
		const intervalMs = speedProfile === "custom" ? Number(customIntervalMs) : undefined;
		const burst = speedProfile === "custom" ? Number(customBurst) : undefined;
		if (speedProfile === "custom") {
			if (!Number.isFinite(intervalMs) || (intervalMs as number) <= 0) {
				return setError("กรอกช่วงเวลาระหว่างข้อความให้ถูกต้อง (มากกว่า 0 ms)");
			}
			if ((intervalMs as number) < MIN_MESSAGE_INTERVAL_MS) {
				return setError(`ตั้งค่าเร็วขนาดนี้ไม่ได้ — ต่ำสุดคือ ${MIN_MESSAGE_INTERVAL_MS} ms ต่อข้อความ (สูงสุด ${MAX_MESSAGES_PER_SECOND} ข้อความ/วินาที)`);
			}
			if (!Number.isInteger(burst) || (burst as number) <= 0) return setError("กรอก burst ให้ถูกต้อง (จำนวนเต็มมากกว่า 0)");
		}
		const messagesPerSecond = speedProfile === "custom" ? 1000 / (intervalMs as number) : undefined;
		setSubmitting(true);
		setError("");
		try {
			await onSubmit({
				name: name.trim(),
				description: description.trim() || "ยังไม่มีคำอธิบาย",
				adapter,
				speedProfile,
				timezone: defaults?.defaultTimezone ?? "Asia/Bangkok",
				...(speedProfile === "custom" ? { maxMessagesPerSecond: messagesPerSecond, burst } : {}),
				credentials: adapter === "official" && (channelSecret || channelAccessToken)
					? {
						...(channelSecret ? { channelSecret } : {}),
						...(channelAccessToken ? { channelAccessToken } : {}),
					}
					: undefined,
				riskAcknowledged: adapter === "linejs" ? acceptedRisk : false,
			});
			setName("");
			setDescription("");
			setChannelSecret("");
			setChannelAccessToken("");
			setAcceptedRisk(false);
			onClose();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "สร้าง bot ไม่สำเร็จ");
		} finally {
			setSubmitting(false);
		}
	};

	const parsedIntervalMs = Number(customIntervalMs);
	const isIntervalTooFast = Number.isFinite(parsedIntervalMs) && parsedIntervalMs > 0 && parsedIntervalMs < MIN_MESSAGE_INTERVAL_MS;
	const intervalPreviewRate = Number.isFinite(parsedIntervalMs) && parsedIntervalMs > 0 ? 1000 / parsedIntervalMs : undefined;

	return (
		<Modal open={open} onClose={onClose} title="สร้าง bot ใหม่" description="Bot แต่ละตัวจะได้ process, credential และ state ของตัวเอง" size="lg">
			{/* noValidate: every other field in this form is validated by `submit`
			    below with a localized, styled message -- the ms input's native
			    `min` (kept for the spinner control and screen readers) would
			    otherwise let the browser's own unstyled, English-only tooltip
			    intercept the submit before that message ever shows. */}
			<form className="form-stack" onSubmit={submit} noValidate>
				<div className="form-section">
					<div className="form-section__number">01</div>
					<div className="form-section__content">
						<h3>ประเภทการเชื่อมต่อ</h3>
						<p>กรณีอ่านแจ้งเตือนจาก OA ธนาคาร ให้เลือก LINEJS เท่านั้น</p>
						<div className="adapter-options">
							<label className={`adapter-option ${adapter === "official" ? "is-selected" : ""}`}>
								<input type="radio" name="adapter" value="official" checked={adapter === "official"} onChange={() => setAdapter("official")} />
								<span className="adapter-option__icon"><ShieldCheck size={21} /></span>
								<span><strong>LINE Official</strong><small>สำหรับ OA ที่คุณเป็นเจ้าของและมี Channel credentials</small></span>
								<Check className="adapter-option__check" size={17} />
							</label>
							<label className={`adapter-option ${adapter === "linejs" ? "is-selected" : ""}`}>
								<input type="radio" name="adapter" value="linejs" checked={adapter === "linejs"} onChange={() => setAdapter("linejs")} />
								<span className="adapter-option__icon"><QrCode size={21} /></span>
								<span><strong>LINEJS</strong><small>บัญชี LINE ส่วนตัว · กลุ่ม/OpenChat/แชต OA ธนาคาร · ล็อกอิน QR</small></span>
								<Check className="adapter-option__check" size={17} />
							</label>
						</div>
					</div>
				</div>

				<div className="form-section">
					<div className="form-section__number">02</div>
					<div className="form-section__content">
						<h3>ข้อมูล bot</h3>
						<div className="form-grid">
							<label className="field"><span>ชื่อ bot <b>*</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น Queue Concierge" autoFocus /></label>
							<label className="field"><span>Speed profile</span><select value={speedProfile} onChange={(event) => setSpeedProfile(event.target.value as SpeedProfile)}>{Object.entries(speedProfileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
							{speedProfile === "custom" ? (
								<>
									<label className="field">
										<span>ช่วงเวลาระหว่างข้อความ (ms) <b>*</b></span>
										<input type="number" min={MIN_MESSAGE_INTERVAL_MS} step="1" value={customIntervalMs} onChange={(event) => setCustomIntervalMs(event.target.value)} aria-invalid={isIntervalTooFast} />
									</label>
									<label className="field"><span>Burst <b>*</b></span><input type="number" min="1" max="100" step="1" value={customBurst} onChange={(event) => setCustomBurst(event.target.value)} /></label>
									<p className={`field-help field--full ${isIntervalTooFast ? "field-help--error" : ""}`}>
										{isIntervalTooFast
											? `เร็วเกินไป — ต่ำสุดที่ตั้งได้คือ ${MIN_MESSAGE_INTERVAL_MS} ms ต่อข้อความ (สูงสุด ${MAX_MESSAGES_PER_SECOND} ข้อความ/วินาที)`
											: `ต่ำสุด ${MIN_MESSAGE_INTERVAL_MS} ms ต่อข้อความ${intervalPreviewRate ? ` · ตอนนี้ ≈ ${intervalPreviewRate.toFixed(2)} ข้อความ/วินาที` : ""}`}
									</p>
								</>
							) : null}
							<label className="field field--full"><span>คำอธิบาย</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="bot ตัวนี้ดูแลอะไร และใช้กับกลุ่มไหน" rows={2} /></label>
						</div>
					</div>
				</div>

				<div className="form-section">
					<div className="form-section__number">03</div>
					<div className="form-section__content">
						<h3>{adapter === "official" ? "LINE credentials" : "ยืนยันการใช้ LINEJS"}</h3>
						{adapter === "official" ? (
							<div className="form-grid">
								<label className="field"><span>Channel secret</span><input type="password" value={channelSecret} onChange={(event) => setChannelSecret(event.target.value)} autoComplete="new-password" placeholder="กรอกตอนเชื่อมต่อจริง" /></label>
								<label className="field"><span>Channel access token</span><input type="password" value={channelAccessToken} onChange={(event) => setChannelAccessToken(event.target.value)} autoComplete="new-password" placeholder="จะแสดงเพียงครั้งเดียว" /></label>
								<p className="field-help field--full"><KeyRound size={14} />ใช้เฉพาะ credentials ของ OA ที่คุณเป็นเจ้าของ ไม่สามารถและไม่ต้องใช้ credentials ของธนาคาร</p>
							</div>
						) : (
							<label className="risk-check"><input type="checkbox" checked={acceptedRisk} onChange={(event) => setAcceptedRisk(event.target.checked)} /><span><strong>ฉันเข้าใจว่า LINEJS ไม่ใช่ Messaging API ทางการ</strong><small>ระบบจะให้สแกน QR ด้วยบัญชี LINE ส่วนตัวที่เพิ่ม OA ธนาคารเป็นเพื่อนแล้ว โดยไม่ต้องกรอก credentials ของธนาคาร</small></span></label>
						)}
					</div>
				</div>
				{error ? <p className="form-error" role="alert">{error}</p> : null}
				<div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>ยกเลิก</Button><Button type="submit" variant="primary" loading={submitting} icon={<Plus size={16} />}>สร้าง bot</Button></div>
			</form>
		</Modal>
	);
}

interface BotDetailsModalProps {
	bot?: BotSummary;
	data: DashboardData;
	authEvent?: AuthEventPayload;
	onClose: () => void;
	onControl: (bot: BotSummary, command: ControlCommand) => void;
	onDelete: (bot: BotSummary) => void;
	onToggleTarget: (botId: string, targetId: string, allowed: boolean) => Promise<void>;
	onDiscoverTargets: (botId: string) => Promise<void>;
	onCreateTarget: (botId: string, input: CreateTargetInput) => Promise<void>;
	onSetSenderRole: (botId: string, senderId: string, role: SenderRole) => Promise<void>;
	busyBotId?: string;
	pendingTargetId?: string;
	onBeginQrAuth: (botId: string) => Promise<QrAuthSession>;
	onPrewarmQrAuth: (botId: string) => Promise<void>;
}

const QR_EXPIRY_WARNING_SECONDS = 20;

/**
 * How long a QR pushed over SSE is treated as scannable. Mirrors the API's
 * advertised lifetime, which tracks the LINEJS long-poll budget; refreshing
 * sooner would throw away codes that still work.
 */
const QR_LIFETIME_SECONDS = 240;

export function BotDetailsModal({ bot, data, authEvent, onClose, onControl, onDelete, onToggleTarget, onDiscoverTargets, onCreateTarget, onSetSenderRole, onBeginQrAuth, onPrewarmQrAuth, busyBotId, pendingTargetId }: BotDetailsModalProps) {
	const [tab, setTab] = useState<"status" | "targets" | "senders">("status");
	const [senderBusyId, setSenderBusyId] = useState<string>();
	const [authSession, setAuthSession] = useState<QrAuthSession>();
	const [authExpiresAt, setAuthExpiresAt] = useState<number>();
	const [authRemainingSeconds, setAuthRemainingSeconds] = useState(0);
	const [authBusy, setAuthBusy] = useState(false);
	const [authFailed, setAuthFailed] = useState(false);
	// Debounce automatic QR regeneration so an expired/errored code is replaced
	// with a fresh one without ever tightening into a request loop.
	const lastAutoQrAt = useRef(0);
	/** Bot whose login was already auto-started, so opening it starts exactly one. */
	const autoStartedFor = useRef<string | undefined>(undefined);
	// The parent re-creates these callbacks on every render, so they are read
	// through a ref: an effect that depended on them directly would re-fire on
	// each render and hammer the QR endpoint.
	const callbacks = useRef({ onBeginQrAuth, onPrewarmQrAuth });
	callbacks.current = { onBeginQrAuth, onPrewarmQrAuth };
	const [syncBusy, setSyncBusy] = useState(false);
	const [addTargetOpen, setAddTargetOpen] = useState(false);
	const botId = bot?.id;

	const requestQr = useCallback((targetBotId: string) => {
		lastAutoQrAt.current = Date.now();
		setAuthBusy(true);
		setAuthFailed(false);
		void callbacks.current.onBeginQrAuth(targetBotId)
			.then((session) => {
				setAuthSession(session);
				setAuthExpiresAt(Date.now() + session.expiresInSeconds * 1000);
			})
			.catch(() => {
				// Keep whatever QR is on screen rather than blanking the panel --
				// the user can retry with the always-visible refresh button.
				setAuthFailed(true);
			})
			.finally(() => setAuthBusy(false));
	}, []);

	// Reset any active QR/PIN session when switching to a different bot or closing the modal.
	useEffect(() => {
		setAuthSession(undefined);
		setAuthExpiresAt(undefined);
		setAuthFailed(false);
		autoStartedFor.current = undefined;
	}, [botId]);

	// A LINEJS bot with no credentials can only be opened for one reason: to
	// scan. Start that login the moment the panel appears instead of waiting for
	// a click, so the code is already on screen by the time it is looked for --
	// the login itself costs about a second of round trips to LINE.
	const needsQrLogin = Boolean(bot && bot.adapter === "linejs" && !bot.credentialsConfigured &&
		!["online", "starting", "stopping"].includes(bot.status));
	useEffect(() => {
		if (!botId || !needsQrLogin || autoStartedFor.current === botId) return;
		autoStartedFor.current = botId;
		void callbacks.current.onPrewarmQrAuth(botId).catch(() => undefined);
		requestQr(botId);
	}, [botId, needsQrLogin, requestQr]);

	// LINEJS emits qr first, then a follow-up pin event once the phone scans it — the initial
	// beginQrAuth call only ever returns the qr event, so later stages arrive over SSE instead.
	useEffect(() => {
		if (!authEvent || !botId || authEvent.botId !== botId) return;
		if (authEvent.type === "qr") {
			lastAutoQrAt.current = Date.now();
			setAuthSession((prev) => ({
				sessionId: prev?.sessionId ?? `qr_${botId}_${authEvent.timestamp}`,
				status: "pending",
				qrUrl: authEvent.value,
				pin: undefined,
				expiresInSeconds: QR_LIFETIME_SECONDS,
			}));
			setAuthExpiresAt(Date.now() + QR_LIFETIME_SECONDS * 1_000);
			setAuthFailed(false);
		} else if (authEvent.type === "pin") {
			// The phone has scanned; the PIN must now be entered before the code
			// expires. Stop the expiry countdown so an auto-refresh can't tear
			// down the session mid-verification (the bug that lost the PIN).
			setAuthSession((prev) => (prev
				? { ...prev, status: "pin_required", pin: authEvent.value }
				: { sessionId: `qr_${botId}_${authEvent.timestamp}`, status: "pin_required", pin: authEvent.value, expiresInSeconds: QR_LIFETIME_SECONDS }));
			setAuthExpiresAt(undefined);
			setAuthFailed(false);
		} else if (authEvent.type === "authenticated") {
			setAuthSession(undefined);
			setAuthExpiresAt(undefined);
			setAuthFailed(false);
		} else if (authEvent.type === "auth-error") {
			// Do not automatically retry a rejected login. Expired QRs are safe
			// to refresh manually, but account/device restrictions can reject
			// every token issue; looping QR attempts then adds needless login
			// traffic to an already restricted LINE account.
			setAuthFailed(true);
			setAuthSession(undefined);
			setAuthExpiresAt(undefined);
		}
	}, [authEvent, botId, requestQr]);

	// Keep a live countdown and silently mint a fresh QR the moment the old one expires,
	// since LINE invalidates each login QR after one scan attempt or after its own timeout.
	useEffect(() => {
		if (!authExpiresAt || !botId) return;
		const tick = () => {
			const remaining = Math.max(0, Math.round((authExpiresAt - Date.now()) / 1000));
			setAuthRemainingSeconds(remaining);
			if (remaining <= 0) requestQr(botId);
		};
		tick();
		const interval = window.setInterval(tick, 1000);
		return () => window.clearInterval(interval);
	}, [authExpiresAt, botId, requestQr]);

	/**
	 * Target-id → intended `allowed` value, for switches with a request still
	 * in flight.
	 *
	 * The dashboard reloads its full snapshot on ~2s heartbeats plus an
	 * SSE push the instant the server persists the change, so a single toggle
	 * click reliably produces two overlapping reloads. Without this, `checked`
	 * tracked server state directly and would visibly snap back to the old
	 * value between the click and whichever reload lands first, then snap
	 * forward again -- the flicker reported as the switch "glitching" or the
	 * panel briefly going blank while dragging it. Keeping the intended value
	 * locally makes the switch move once and stay put; the override clears
	 * itself once the server confirms it (effect below) or is discarded if the
	 * request fails, falling back to whatever the server actually has.
	 */
	const [optimisticAllowed, setOptimisticAllowed] = useState<Record<string, boolean>>({});
	useEffect(() => {
		setOptimisticAllowed((prev) => {
			if (!Object.keys(prev).length) return prev;
			let changed = false;
			const next = { ...prev };
			for (const targetId of Object.keys(prev)) {
				const serverTarget = data.targets.find((target) => target.id === targetId);
				if (!serverTarget || serverTarget.allowed === prev[targetId]) {
					delete next[targetId];
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [data.targets]);

	if (!bot) return null;
	const targets = data.targets.filter((target) => target.botId === bot.id);
	const rules = data.rules.filter((rule) => rule.botId === bot.id);
	const senders = data.senders.filter((sender) => sender.botId === bot.id);
	return (
		<Modal open={Boolean(bot)} onClose={onClose} title={bot.name} description={`${bot.adapter === "official" ? "LINE Official / OA ของคุณเอง" : "LINEJS / กลุ่ม · OpenChat · แชต LINE OA"} · process ${bot.id.slice(0, 16)}`} size="xl">
			<div className="bot-detail-heading">
				<BotAvatar name={bot.name} accent={bot.accent} size="lg" />
				<div><StatusBadge status={bot.status} /><p>Heartbeat {formatRelativeTime(bot.lastHeartbeat)}</p></div>
				<div className="bot-detail-heading__controls">
					{["online", "degraded"].includes(bot.status) ? <Button loading={busyBotId === bot.id} onClick={() => onControl(bot, "pause")} icon={<Pause size={15} />}>พัก</Button> : <Button loading={busyBotId === bot.id} disabled={bot.adapter === "linejs" && !bot.credentialsConfigured} title={bot.adapter === "linejs" && !bot.credentialsConfigured ? "เชื่อมบัญชี LINE ด้วย QR login ก่อนถึงจะเริ่มได้" : undefined} onClick={() => onControl(bot, bot.status === "paused" ? "resume" : "start")} icon={<Play size={15} />}>เริ่ม</Button>}
					<Button variant="danger" disabled={bot.status === "stopped" || busyBotId === bot.id} onClick={() => onControl(bot, "stop")} icon={<Power size={15} />}>หยุด</Button>
					<Button variant="danger" disabled={["online", "starting", "stopping"].includes(bot.status) || busyBotId === bot.id} onClick={() => onDelete(bot)} icon={<Trash2 size={15} />} title={["online", "starting", "stopping"].includes(bot.status) ? "ต้องหยุด bot ก่อนถึงจะลบได้" : undefined}>ลบ</Button>
				</div>
			</div>
			{bot.adapter === "linejs" && !bot.credentialsConfigured && !["online", "starting", "stopping"].includes(bot.status) ? (
				<>
					<div className="auth-callout">
						<QrCode size={23} />
						<div>
							<strong>{authBusy ? "กำลังสร้าง QR ใหม่…" : authEvent?.botId === bot.id && authEvent.type === "authenticated" ? "ยืนยันสำเร็จ — กำลังเปิดการเชื่อมต่อ" : authSession?.pin ? "สแกนสำเร็จ — ยังต้องยืนยัน PIN ในแอป LINE" : authSession?.qrUrl ? "สแกน QR เพื่อเชื่อมบัญชี LINE" : authFailed || bot.status === "error" ? "QR หมดอายุหรือยืนยันไม่สำเร็จ กดรีเฟรชเพื่อสแกนใหม่" : "ต้องเชื่อมบัญชี LINE"}</strong>
							<p>{authEvent?.botId === bot.id && authEvent.type === "authenticated" ? "รอจนสถานะด้านบนเปลี่ยนเป็น Online แล้วระบบจะค้นหากลุ่มและ LINE OA ให้อัตโนมัติ" : authSession?.pin ? "เปิด LINE บนมือถือและยืนยันการเข้าสู่ระบบ/PIN ให้เสร็จ อย่าปิดหน้าต่างนี้จนสถานะเป็น Online" : authSession?.qrUrl ? "เปิดแอป LINE บนมือถือ → สแกน QR → อนุมัติการเข้าสู่ระบบและยืนยัน PIN ให้ครบ" : authFailed || bot.status === "error" ? `LINE ปฏิเสธหรือยุติการล็อกอิน ระบบหยุดลองซ้ำอัตโนมัติ${authEvent?.botId === bot.id && authEvent.type === "auth-error" && authEvent.value ? ` · ${authEvent.value.slice(0, 240)}` : ""}` : "สร้าง QR แล้วสแกนด้วยมือถือที่ล็อกอินบัญชีนี้"}</p>
						</div>
						<Button loading={authBusy} icon={<ExternalLink size={15} />} onClick={() => requestQr(bot.id)}>{authSession ? "รีเฟรช QR" : "เริ่ม QR login"}</Button>
					</div>
					{authSession?.qrUrl || authSession?.pin ? (
						<div className="qr-panel">
							{authSession.qrUrl && !authSession.pin ? (
								<>
									<div className="qr-panel__code"><QRCodeSVG value={authSession.qrUrl} size={180} /></div>
									<p>สแกนด้วยแอป LINE ของบัญชีที่ต้องการเชื่อมต่อ</p>
								</>
							) : null}
							{authSession.pin ? (
								<>
									<p>กรอก/ยืนยันรหัส PIN นี้ในแอป LINE บนมือถือ</p>
									<strong className="qr-panel__pin">{authSession.pin}</strong>
								</>
							) : null}
							<p className={authSession.pin ? "qr-panel__expiry qr-panel__expiry--warning" : authRemainingSeconds <= QR_EXPIRY_WARNING_SECONDS ? "qr-panel__expiry qr-panel__expiry--warning" : "qr-panel__expiry"}>
								{authSession.pin
									? "รีบยืนยัน PIN ในแอป LINE ก่อน QR หมดอายุ · ถ้าหมดเวลา กดรีเฟรช QR แล้วสแกนใหม่"
									: authRemainingSeconds <= QR_EXPIRY_WARNING_SECONDS
										? `กำลังจะหมดอายุ · จะสร้าง QR ใหม่ให้อัตโนมัติใน ${authRemainingSeconds} วินาที`
										: `หมดอายุใน ${authRemainingSeconds} วินาที · ระบบจะสร้าง QR ใหม่ให้อัตโนมัติ`}
							</p>
						</div>
					) : null}
				</>
			) : null}
			<div className="detail-tabs"><button type="button" className={tab === "status" ? "is-active" : ""} onClick={() => setTab("status")}>สถานะและ Metrics</button><button type="button" className={tab === "targets" ? "is-active" : ""} onClick={() => setTab("targets")}>Targets / LINE OA <span>{targets.length}</span></button><button type="button" className={tab === "senders" ? "is-active" : ""} onClick={() => setTab("senders")}>ผู้ส่งข้อความ <span>{senders.length}</span></button></div>
			{/* Scoped so a bad row (unexpected data from a real, messy target/sender
			    list) blanks only this section instead of taking the close button and
			    the rest of the app down with it -- resets whenever the bot or tab
			    changes, so switching away is always enough to recover. */}
			<ErrorBoundary scope="รายการนี้" resetKey={`${bot.id}:${tab}`} compact>
			{tab === "status" ? (
				<div className="detail-content">
					<div className="detail-metric-grid">
						<DetailMetric icon={<Activity />} label="Throughput" value={`${bot.throughputPerMinute} msg/min`} />
						<DetailMetric icon={<Clock3 />} label="Response P95" value={bot.responseP95Ms ? `${bot.responseP95Ms} ms` : "—"} />
						<DetailMetric icon={<CircleGauge />} label="First response" value={bot.firstResponseRate ? `${bot.firstResponseRate}%` : "—"} />
						<DetailMetric icon={<Box />} label="Queue depth" value={`${bot.queueDepth} jobs`} />
					</div>
					<div className="detail-two-columns">
						<section className="subpanel"><div className="subpanel__title"><h3>Process resources</h3><span>{formatUptime(bot.uptimeSeconds)}</span></div><ResourceMeter icon={<Cpu />} label="CPU" value={bot.cpuPercent} unit="%" /><ResourceMeter icon={<MemoryStick />} label="Memory" value={Math.min((bot.memoryMb / 512) * 100, 100)} display={`${bot.memoryMb} MB`} /></section>
						<section className="subpanel"><div className="subpanel__title"><h3>Configuration</h3></div><dl className="config-list"><div><dt>Speed profile</dt><dd>{speedProfileLabels[bot.speedProfile]}</dd></div><div><dt>Auto restart</dt><dd>{bot.autoRestart ? "เปิด" : "ปิด"}</dd></div><div><dt>Active rules</dt><dd>{rules.filter((rule) => rule.enabled).length}/{rules.length}</dd></div><div><dt>Process ID</dt><dd className="mono">{bot.id.slice(0, 18)}</dd></div></dl></section>
					</div>
				</div>
			) : tab === "targets" ? (
				<div className="target-list">
					<div className="target-list__intro">
						<div><h3>Target allowlist</h3><p>เลือกรับเหตุการณ์เฉพาะกลุ่มหรือแชต LINE OA ที่เปิดไว้</p></div>
						<div className="target-list__intro-actions">
							<span><ShieldCheck size={15} />{targets.filter((target) => target.allowed).length} allowed</span>
							{bot.adapter === "linejs" ? (
								<Button
									loading={syncBusy}
									disabled={!["online", "paused"].includes(bot.status)}
									icon={<RefreshCw size={15} />}
									title={["online", "paused"].includes(bot.status) ? undefined : `สถานะตอนนี้คือ ${bot.status} — ต้องยืนยัน QR/PIN จนเป็น Online ก่อน`}
									onClick={() => { setSyncBusy(true); void onDiscoverTargets(bot.id).catch(() => undefined).finally(() => setSyncBusy(false)); }}
								>
									ค้นหากลุ่ม / LINE OA
								</Button>
							) : null}
							<Button variant="primary" icon={<Plus size={15} />} onClick={() => setAddTargetOpen(true)}>เพิ่ม target เอง</Button>
						</div>
					</div>
					{targets.length ? targets.map((target) => (
						<TargetRow
							key={target.id}
							target={target}
							checked={optimisticAllowed[target.id] ?? target.allowed}
							disabled={pendingTargetId === target.id}
							onToggle={(allowed) => {
								setOptimisticAllowed((prev) => ({ ...prev, [target.id]: allowed }));
								onToggleTarget(bot.id, target.id, allowed).catch(() => {
									setOptimisticAllowed((prev) => {
										const { [target.id]: _dropped, ...rest } = prev;
										return rest;
									});
								});
							}}
						/>
					)) : (
						<EmptyState
							title="ยังไม่พบกลุ่มหรือแชต LINE OA"
							description={bot.adapter === "linejs" ? "เพิ่ม OA ธนาคารเป็นเพื่อนในบัญชี LINE นี้ เปิด bot ให้ online แล้วกด “ค้นหากลุ่ม / LINE OA” ระบบจะดึงมาให้เลือกอัตโนมัติ" : "กดเพิ่ม target เอง แล้วกรอก ID จาก LINE"}
						/>
					)}
				</div>
			) : (
				<div className="target-list">
					<div className="target-list__intro">
						<div><h3>ผู้ส่งข้อความที่เคยพบ</h3><p>ระบบจดจำอัตโนมัติทุกครั้งที่มีข้อความเข้ามา ตั้งเป็น Admin เพื่อให้ rule ที่ใช้เงื่อนไข "สิทธิ์ของผู้ส่ง" ทำงานกับคนนี้ได้</p></div>
					</div>
					{senders.length ? senders.map((sender) => (
						<div className="sender-row" key={sender.id}>
							<span className="target-row__icon"><UsersRound size={17} /></span>
							<div><strong className="mono">{sender.id.slice(0, 20)}</strong><span>{sender.messageCount} ข้อความ · ล่าสุด {formatRelativeTime(sender.lastSeenAt)}</span></div>
							<span className={`status-badge ${sender.role === "admin" ? "status-badge--online" : "status-badge--stopped"}`}>{sender.role === "admin" ? "Admin" : "สมาชิก"}</span>
							<Button
								loading={senderBusyId === sender.id}
								variant={sender.role === "admin" ? "ghost" : "primary"}
								onClick={() => {
									setSenderBusyId(sender.id);
									void onSetSenderRole(bot.id, sender.id, sender.role === "admin" ? "member" : "admin").catch(() => undefined).finally(() => setSenderBusyId(undefined));
								}}
							>
								{sender.role === "admin" ? "ถอด Admin" : "ตั้งเป็น Admin"}
							</Button>
						</div>
					)) : (
						<EmptyState title="ยังไม่พบผู้ส่งข้อความ" description="พอมีคนพิมพ์ในกลุ่มที่อนุญาตไว้ รายชื่อจะขึ้นที่นี่อัตโนมัติ" />
					)}
				</div>
			)}
			</ErrorBoundary>
			<AddTargetModal open={addTargetOpen} onClose={() => setAddTargetOpen(false)} onSubmit={(input) => onCreateTarget(bot.id, input)} />
		</Modal>
	);
}

interface AddTargetModalProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (input: CreateTargetInput) => Promise<void>;
}

function AddTargetModal({ open, onClose, onSubmit }: AddTargetModalProps) {
	const [name, setName] = useState("");
	const [externalId, setExternalId] = useState("");
	const [type, setType] = useState<CreateTargetInput["type"]>("group");
	const [consentConfirmed, setConsentConfirmed] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");

	const reset = () => {
		setName("");
		setExternalId("");
		setType("group");
		setConsentConfirmed(false);
		setError("");
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) { setError("กรุณากรอกชื่อ target"); return; }
		if (!externalId.trim()) { setError("กรุณากรอก LINE target ID"); return; }
		setSubmitting(true);
		setError("");
		try {
			await onSubmit({ name: name.trim(), externalId: externalId.trim(), type, consentConfirmed });
			reset();
			onClose();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "เพิ่ม target ไม่สำเร็จ");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Modal open={open} onClose={() => { reset(); onClose(); }} title="เพิ่ม LINE target เอง" description="ปกติแนะนำให้ใช้ปุ่มค้นหาอัตโนมัติ ใช้หน้านี้เมื่อทราบ target ID แล้วเท่านั้น" size="sm">
			<form className="form-stack" onSubmit={submit}>
				<label className="field"><span>ชื่อ target <b>*</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น KBank Live" autoFocus /></label>
				<label className="field"><span>LINE target ID <b>*</b></span><input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="เช่น u123... หรือ C123..." /></label>
				<label className="field"><span>ประเภท</span><select value={type} onChange={(event) => setType(event.target.value as CreateTargetInput["type"])}><option value="group">LINE Group</option><option value="openchat">OpenChat</option><option value="user">LINE OA / แชตส่วนตัว</option><option value="room">LINE Room</option></select></label>
				<label className="risk-check"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span><strong>อนุญาตให้ระบบรับเหตุการณ์จาก target นี้</strong><small>สำหรับธนาคาร ให้เลือกเฉพาะบัญชี OA ที่ยืนยันแล้ว เช่น KBank Live, SCB Connect หรือ Krungthai Connext</small></span></label>
				{error ? <p className="form-error" role="alert">{error}</p> : null}
				<div className="form-actions"><Button type="button" variant="ghost" onClick={() => { reset(); onClose(); }}>ยกเลิก</Button><Button type="submit" variant="primary" loading={submitting} icon={<Plus size={16} />}>เพิ่ม target</Button></div>
			</form>
		</Modal>
	);
}

/**
 * Memoized with a value-based comparator (not React.memo's default reference
 * check) because `target` is a fresh object every poll -- the dashboard
 * summary is re-fetched and re-JSON.parsed every 2s regardless of whether
 * anything actually changed, so identical rows would otherwise still
 * re-render all 700+ of them on every tick. `onToggle` is deliberately left
 * out of the comparison: a new closure that behaves identically doesn't
 * affect what's on screen, and skipping the row when the real fields match
 * is what actually saves the render cost.
 */
const TargetRow = memo(function TargetRow({ target, checked, disabled, onToggle }: { target: Target; checked: boolean; disabled: boolean; onToggle: (allowed: boolean) => void }) {
	const typeLabel = target.type === "group" ? "LINE Group" : target.type === "openchat" ? "OpenChat" : target.type === "user" ? "LINE OA / แชตส่วนตัว" : "LINE Room";
	return (
		<div className="target-row">
			<span className={`target-row__icon target-row__icon--${target.type}`}><UsersRound size={17} /></span>
			<div><strong>{target.name}</strong><span>{typeLabel}{target.type === "user" ? "" : ` · ${(target.memberCount ?? 0).toLocaleString()} สมาชิก`}</span></div>
			<span className={`connection connection--${target.connection}`}><i />{target.connection}</span>
			<Toggle checked={checked} disabled={disabled} onChange={onToggle} label={`อนุญาต ${target.name}`} />
		</div>
	);
}, (prev, next) =>
	prev.checked === next.checked &&
	prev.disabled === next.disabled &&
	prev.target.id === next.target.id &&
	prev.target.name === next.target.name &&
	prev.target.type === next.target.type &&
	prev.target.connection === next.target.connection &&
	prev.target.memberCount === next.target.memberCount);

function DetailMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
	return <div className="detail-metric"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function ResourceMeter({ icon, label, value, unit, display }: { icon: React.ReactNode; label: string; value: number; unit?: string; display?: string }) {
	return <div className="resource-meter"><div><span>{icon}{label}</span><strong>{display ?? `${Math.round(value)}${unit ?? ""}`}</strong></div><div className="resource-meter__track"><i style={{ width: `${Math.max(2, Math.min(value, 100))}%` }} /></div></div>;
}
