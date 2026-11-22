import { Power, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./components/app-shell";
import { Button, ErrorView, LoadingView, Modal, Toast } from "./components/shared";
import { ApiClientError, createDashboardApi, type AuthEventPayload, type AuthStatus, type CreateTargetInput } from "./lib/api-client";
import { ApiKeysPage } from "./pages/api-keys-page";
import { BotDetailsModal, BotsPage, CreateBotModal } from "./pages/bots-page";
import { LoginPage } from "./pages/login-page";
import { OverviewPage } from "./pages/overview-page";
import { PaymentsPage } from "./pages/payments-page";
import { QueuePage } from "./pages/queue-page";
import { RulesPage } from "./pages/rules-page";
import { SettingsPage } from "./pages/settings-page";
import type {
	ApiKeyRecord,
	BotSummary,
	ControlCommand,
	CreateBotInput,
	CreatedApiKey,
	DashboardData,
	PageId,
	Rule,
	SystemResources,
	SystemSettings,
} from "./types";

const validPages: PageId[] = ["overview", "bots", "rules", "queue", "payments", "api-keys", "settings"];

export default function App() {
	const api = useMemo(() => createDashboardApi(), []);
	const [data, setData] = useState<DashboardData>();
	const [page, setPage] = useState<PageId>(() => pageFromHash());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [search, setSearch] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [selectedBotId, setSelectedBotId] = useState<string>();
	const [busyBotId, setBusyBotId] = useState<string>();
	const [pendingTargetId, setPendingTargetId] = useState<string>();
	const [stopTarget, setStopTarget] = useState<BotSummary>();
	const [deleteTarget, setDeleteTarget] = useState<BotSummary>();
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [emergencyOpen, setEmergencyOpen] = useState(false);
	const [emergencyBusy, setEmergencyBusy] = useState(false);
	const [toast, setToast] = useState<{ message: string; tone: "success" | "error" }>();
	const [authEvent, setAuthEvent] = useState<AuthEventPayload>();
	const [settings, setSettings] = useState<SystemSettings>();
	const [resources, setResources] = useState<SystemResources>();
	// Real dashboard↔API round trip, for the Overview page's health card --
	// replaces a hardcoded "24 ms" that never reflected an actual measurement.
	const [apiLatencyMs, setApiLatencyMs] = useState<number>();

	// undefined while the initial /v1/auth/me check is in flight. REQUIRE_AUTH
	// is off by default (localMode: true), so most installs never see the
	// login screen at all -- this only gates access once an operator turns
	// enforcement on.
	const [authStatus, setAuthStatus] = useState<AuthStatus>();
	const [sessionExpired, setSessionExpired] = useState(false);
	const hadDataRef = useRef(false);

	useEffect(() => { void api.getAuthStatus().then(setAuthStatus).catch(() => setAuthStatus({ email: "", role: "admin", localMode: true, authenticated: true })); }, [api]);
	useEffect(() => { if (data) hadDataRef.current = true; }, [data]);

	const load = useCallback(async (silent = false) => {
		if (!silent) setLoading(true);
		setError("");
		const startedAt = performance.now();
		try {
			const snapshot = await api.getSnapshot();
			setApiLatencyMs(Math.round(performance.now() - startedAt));
			setData(snapshot);
		} catch (caught) {
			if (caught instanceof ApiClientError && caught.status === 401) {
				// Session cookie missing or expired -- drop back to the login
				// screen instead of showing a generic connection error.
				setSessionExpired(hadDataRef.current);
				setAuthStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
				return;
			}
			setError(caught instanceof Error ? caught.message : "โหลดข้อมูลไม่สำเร็จ");
		} finally {
			if (!silent) setLoading(false);
		}
	}, [api]);

	const canLoadData = authStatus && (authStatus.localMode || authStatus.authenticated);
	useEffect(() => { if (canLoadData) void load(); }, [load, canLoadData]);

	// Fleet-wide defaults (used to pre-fill Create Bot) and real infrastructure
	// numbers (used by the Overview health card) -- both fetched once auth is
	// resolved (not on mount) so they don't 401 before login and, more
	// importantly, so they actually fetch once the operator does log in --
	// `canLoadData` flips from false to true then, re-running this effect.
	useEffect(() => { if (canLoadData) void api.getSettings().then(setSettings).catch(() => undefined); }, [api, canLoadData]);
	useEffect(() => { if (canLoadData) void api.getSystemResources().then(setResources).catch(() => undefined); }, [api, canLoadData]);

	const updateSettings = useCallback(async (patch: Partial<Omit<SystemSettings, "updatedAt">>) => {
		const next = await api.updateSettings(patch);
		setSettings(next);
		return next;
	}, [api]);

	useEffect(() => {
		const onHashChange = () => setPage(pageFromHash());
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	useEffect(() => {
		if (!data) return;
		// The Node SSE bridge can retain stale proxy sockets after a dev-server
		// restart. Short polling keeps the control plane responsive and payment
		// verification has its own faster 250 ms status poll.
		const polling = window.setInterval(() => void load(true), 2_000);
		return () => window.clearInterval(polling);
	}, [Boolean(data), load]);

	useEffect(() => {
		if (!selectedBotId) return;
		const pollAuth = () => {
			void api.getLatestAuthEvent(selectedBotId).then((event) => {
				if (!event) return;
				setAuthEvent((current) => current?.timestamp === event.timestamp ? current : event);
				if (event.type === "authenticated") void load(true);
			}).catch(() => undefined);
		};
		pollAuth();
		const polling = window.setInterval(pollAuth, 500);
		return () => window.clearInterval(polling);
	}, [api, load, selectedBotId]);

	const navigate = (target: PageId) => {
		setPage(target);
		window.location.hash = target;
	};

	const notify = useCallback((message: string, tone: "success" | "error" = "success") => setToast({ message, tone }), []);

	const run = useCallback(async (action: () => Promise<void>, success: string) => {
		try {
			await action();
			await load(true);
			notify(success);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : "ดำเนินการไม่สำเร็จ";
			notify(message, "error");
			throw caught;
		}
	}, [load, notify]);

	const controlBot = async (bot: BotSummary, command: ControlCommand) => {
		if (command === "stop") {
			setStopTarget(bot);
			return;
		}
		setBusyBotId(bot.id);
		try {
			await run(() => api.controlBot(bot.id, command), command === "pause" ? `พัก ${bot.name} แล้ว` : `${bot.name} เริ่มทำงานแล้ว`);
		} catch { /* toast handles user-facing error */ }
		finally { setBusyBotId(undefined); }
	};

	const confirmStop = async (mode: "graceful" | "immediate") => {
		if (!stopTarget) return;
		setBusyBotId(stopTarget.id);
		try {
			await run(() => api.controlBot(stopTarget.id, "stop", mode), `หยุด ${stopTarget.name} แล้ว`);
			setStopTarget(undefined);
		} catch { /* toast handles user-facing error */ }
		finally { setBusyBotId(undefined); }
	};

	const confirmDelete = async () => {
		if (!deleteTarget) return;
		setDeleteBusy(true);
		try {
			await run(() => api.deleteBot(deleteTarget.id), `ลบ ${deleteTarget.name} แล้ว`);
			setDeleteTarget(undefined);
			setSelectedBotId((current) => (current === deleteTarget.id ? undefined : current));
		} catch { /* toast handles user-facing error */ }
		finally { setDeleteBusy(false); }
	};

	const emergencyStop = async () => {
		setEmergencyBusy(true);
		try {
			await run(() => api.emergencyStop(), "หยุด bot ทุกตัวแล้ว");
			setEmergencyOpen(false);
		} catch { /* toast handles user-facing error */ }
		finally { setEmergencyBusy(false); }
	};

	const createBot = async (input: CreateBotInput) => {
		await run(async () => { await api.createBot(input); }, `สร้าง ${input.name} แล้ว`);
	};

	const saveRule = async (rule: Rule) => {
		await run(async () => { await api.upsertRule(rule.botId, rule); }, `บันทึก rule “${rule.name}” แล้ว`);
	};

	const deleteRule = async (rule: Rule) => {
		await run(() => api.deleteRule(rule.botId, rule.id), `ลบ rule “${rule.name}” แล้ว`);
	};

	const createApiKey = async (name: string, scopes: string[]): Promise<CreatedApiKey> => {
		let created: CreatedApiKey | undefined;
		await run(async () => { created = await api.createApiKey(name, scopes); }, `สร้าง API key “${name}” แล้ว`);
		if (!created) throw new Error("สร้าง API key ไม่สำเร็จ");
		return created;
	};

	const revokeApiKey = async (key: ApiKeyRecord) => {
		await run(() => api.revokeApiKey(key.id), `แบน ${key.name} แล้ว`);
	};

	const setApiKeyPaused = async (key: ApiKeyRecord, paused: boolean) => {
		await run(async () => { await api.setApiKeyPaused(key.id, paused); }, paused ? `พัก ${key.name} ชั่วคราวแล้ว` : `เริ่มใช้งาน ${key.name} แล้ว`);
	};

	if (!authStatus) return <LoadingView />;
	if (!authStatus.localMode && !authStatus.authenticated) {
		return (
			<LoginPage
				notice={sessionExpired ? "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง" : undefined}
				onLogin={async (email, password) => {
					await api.login(email, password);
					setSessionExpired(false);
					setAuthStatus(await api.getAuthStatus());
				}}
			/>
		);
	}
	if (loading && !data) return <LoadingView />;
	if (error && !data) return <ErrorView message={error} onRetry={() => void load()} />;
	if (!data) return null;

	const selectedBot = data.bots.find((bot) => bot.id === selectedBotId);

	return (
		<>
			<AppShell
				page={page}
				onNavigate={navigate}
				mode={api.mode}
				data={data}
				search={search}
				onSearch={setSearch}
				onOpenBots={() => navigate("bots")}
				onEmergencyStop={() => setEmergencyOpen(true)}
				onLogout={authStatus.localMode ? undefined : () => { void api.logout().finally(() => { setData(undefined); setAuthStatus({ ...authStatus, authenticated: false }); }); }}
			>
				{page === "overview" ? <OverviewPage data={data} onCreateBot={() => setCreateOpen(true)} onOpenBot={(bot) => setSelectedBotId(bot.id)} onControl={(bot, command) => void controlBot(bot, command)} onViewBots={() => navigate("bots")} busyBotId={busyBotId} apiLatencyMs={apiLatencyMs} resources={resources} /> : null}
				{page === "bots" ? <BotsPage data={data} search={search} onCreate={() => setCreateOpen(true)} onOpenBot={(bot) => setSelectedBotId(bot.id)} onControl={(bot, command) => void controlBot(bot, command)} busyBotId={busyBotId} /> : null}
				{page === "rules" ? <RulesPage data={data} search={search} onSave={saveRule} onDelete={deleteRule} /> : null}
				{page === "queue" ? <QueuePage data={data} onAction={(botId, action, ticketId) => run(() => api.queueAction(botId, action, ticketId), action === "call_next" ? "เรียกคิวถัดไปแล้ว" : "ยกเลิกคิวแล้ว")} /> : null}
				{page === "payments" ? <PaymentsPage data={data} api={api} notify={notify} /> : null}
				{page === "api-keys" ? <ApiKeysPage data={data} onCreate={createApiKey} onRevoke={revokeApiKey} onSetPaused={setApiKeyPaused} /> : null}
				{page === "settings" ? (
					<SettingsPage
						data={data}
						api={api}
						mode={api.mode}
						settings={settings}
						onUpdateSettings={updateSettings}
						onFetchSecurity={() => api.getSecurityStatus()}
						onFetchResources={() => api.getSystemResources()}
						onEmergencyStop={emergencyStop}
					/>
				) : null}
			</AppShell>

			<CreateBotModal open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={createBot} defaults={settings} />
			<BotDetailsModal bot={selectedBot} data={data} authEvent={authEvent} onClose={() => setSelectedBotId(undefined)} onControl={(bot, command) => void controlBot(bot, command)} onDelete={(bot) => setDeleteTarget(bot)} onBeginQrAuth={(botId) => api.beginQrAuth(botId)} onPrewarmQrAuth={(botId) => api.prewarmQrAuth(botId)} onDiscoverTargets={(botId) => run(() => api.discoverTargets(botId), "ซิงค์กลุ่มและแชต LINE OA แล้ว")} onCreateTarget={(botId, input: CreateTargetInput) => run(() => api.createTarget(botId, input), `เพิ่ม target “${input.name}” แล้ว`)} busyBotId={busyBotId} pendingTargetId={pendingTargetId} onToggleTarget={(botId, targetId, allowed) => { setPendingTargetId(targetId); return run(() => api.setTargetAllowed(botId, targetId, allowed), allowed ? "เปิด target ใน allowlist แล้ว" : "ปิด target ใน allowlist แล้ว").finally(() => setPendingTargetId(undefined)); }} onSetSenderRole={(botId, senderId, role) => run(() => api.setSenderRole(botId, senderId, role), role === "admin" ? "ตั้งเป็น Admin แล้ว" : "ตั้งเป็นสมาชิกแล้ว")} />

			<Modal open={Boolean(stopTarget)} onClose={() => setStopTarget(undefined)} title={`หยุด ${stopTarget?.name ?? "bot"}?`} description="เลือกวิธีหยุด process ของ bot ตัวนี้" size="sm" danger>
				<div className="stop-options">
					<button type="button" onClick={() => void confirmStop("graceful")} disabled={busyBotId === stopTarget?.id}><span><Power size={18} /></span><div><strong>Graceful stop</strong><p>หยุดรับงานใหม่และรอคิวเดิมสูงสุด 30 วินาที</p></div></button>
					<button className="stop-options__immediate" type="button" onClick={() => void confirmStop("immediate")} disabled={busyBotId === stopTarget?.id}><span><TriangleAlert size={18} /></span><div><strong>หยุดทันที</strong><p>ยกเลิกงานค้างและปิด process โดยไม่รอ</p></div></button>
				</div>
			</Modal>

			<Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(undefined)} title={`ลบ ${deleteTarget?.name ?? "bot"}?`} description="ลบแล้วกู้คืนไม่ได้ ข้อมูล rule, target allowlist และ metrics ทั้งหมดของ bot นี้จะหายไปด้วย" size="sm" danger footer={<><Button variant="ghost" onClick={() => setDeleteTarget(undefined)}>ยกเลิก</Button><Button variant="danger" loading={deleteBusy} onClick={() => void confirmDelete()} icon={<Trash2 size={16} />}>ลบ bot</Button></>}>
				<div className="emergency-warning"><TriangleAlert size={20} /><p>ต้องหยุด bot ให้เป็นสถานะ "หยุด" ก่อนถึงจะลบได้</p></div>
			</Modal>

			<Modal open={emergencyOpen} onClose={() => setEmergencyOpen(false)} title="Emergency stop ทั้งระบบ?" description={`${data.bots.filter((bot) => bot.status !== "stopped").length} bot ที่กำลังทำงานจะหยุดทันที`} size="sm" danger footer={<><Button variant="ghost" onClick={() => setEmergencyOpen(false)}>ยกเลิก</Button><Button variant="danger" loading={emergencyBusy} onClick={() => void emergencyStop()} icon={<Power size={16} />}>หยุดทุก bot</Button></>}>
				<div className="emergency-warning"><TriangleAlert size={20} /><p>คำสั่งนี้จะยกเลิกงานที่ค้างอยู่ และบันทึกผู้สั่งงานใน Audit log</p></div>
			</Modal>

			{toast ? <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(undefined)} /> : null}
		</>
	);
}

function pageFromHash(): PageId {
	const candidate = window.location.hash.replace(/^#\/?/, "") as PageId;
	return validPages.includes(candidate) ? candidate : "overview";
}
