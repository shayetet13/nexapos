import {
	CheckCircle2,
	Database,
	Gauge,
	HardDrive,
	Power,
	RefreshCw,
	Save,
	ServerCog,
	ShieldCheck,
	TriangleAlert,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { speedProfileLabels, type ApiMode, type DashboardApi } from "../lib/api-client";
import { Button, Modal } from "../components/shared";
import type { DashboardData, SecurityStatus, SpeedProfile, SystemResources, SystemSettings } from "../types";

interface SettingsPageProps {
	data: DashboardData;
	api: DashboardApi;
	mode: ApiMode;
	settings?: SystemSettings;
	onUpdateSettings: (patch: Partial<Omit<SystemSettings, "updatedAt">>) => Promise<SystemSettings>;
	onFetchSecurity: () => Promise<SecurityStatus>;
	onFetchResources: () => Promise<SystemResources>;
	onEmergencyStop: () => Promise<void>;
}

interface SettingsDraft {
	defaultSpeedProfile: SpeedProfile;
	defaultTimezone: string;
	gracefulDrainTimeoutSec: number;
	firstResponseWindowSec: number;
}

function toDraft(settings: SystemSettings): SettingsDraft {
	return {
		defaultSpeedProfile: settings.defaultSpeedProfile,
		defaultTimezone: settings.defaultTimezone,
		gracefulDrainTimeoutSec: Math.round(settings.gracefulDrainTimeoutMs / 1000),
		firstResponseWindowSec: Math.round(settings.firstResponseWindowMs / 1000),
	};
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsPage({ data, api, mode, settings, onUpdateSettings, onFetchSecurity, onFetchResources, onEmergencyStop }: SettingsPageProps) {
	const [draft, setDraft] = useState<SettingsDraft>();
	const [security, setSecurity] = useState<SecurityStatus>();
	const [resources, setResources] = useState<SystemResources>();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number }>();
	const apiBase = import.meta.env.VITE_API_BASE_URL || "Same origin / Vite proxy";

	const testConnection = async () => {
		setTesting(true);
		setTestResult(undefined);
		try {
			setTestResult(await api.testConnection());
		} finally {
			setTesting(false);
		}
	};

	// Re-baseline whenever the confirmed value from the server changes (on
	// first load and right after a successful save) -- never while the
	// operator still has unsaved edits in progress.
	useEffect(() => { if (settings) setDraft(toDraft(settings)); }, [settings]);
	useEffect(() => { void onFetchSecurity().then(setSecurity).catch(() => undefined); }, [onFetchSecurity]);
	useEffect(() => { void onFetchResources().then(setResources).catch(() => undefined); }, [onFetchResources]);

	const stopAll = async () => {
		setStopping(true);
		try { await onEmergencyStop(); setConfirmOpen(false); } finally { setStopping(false); }
	};

	const save = async () => {
		if (!draft) return;
		setSaving(true);
		setError("");
		try {
			await onUpdateSettings({
				defaultSpeedProfile: draft.defaultSpeedProfile,
				defaultTimezone: draft.defaultTimezone,
				gracefulDrainTimeoutMs: draft.gracefulDrainTimeoutSec * 1000,
				firstResponseWindowMs: draft.firstResponseWindowSec * 1000,
			});
			setSaved(true);
			window.setTimeout(() => setSaved(false), 2_000);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "บันทึกค่าไม่สำเร็จ");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="page-stack settings-page">
			<section className="page-intro">
				<div><p className="eyebrow">SYSTEM CONFIGURATION</p><h2>ตั้งค่า Local Control Plane</h2><p>ค่าในหน้านี้เป็นค่ากลาง ใช้กับทุก bot ที่สร้างใหม่ ส่วนพฤติกรรมของ bot ที่มีอยู่แล้วปรับแยกใน Rule Builder</p></div>
				<Button variant="primary" disabled={!draft} loading={saving} icon={saved ? <CheckCircle2 size={16} /> : <Save size={16} />} onClick={() => void save()}>{saved ? "บันทึกแล้ว" : "บันทึกค่า"}</Button>
			</section>
			{error ? <p className="form-error" role="alert">{error}</p> : null}

			<div className="settings-layout">
				<div className="settings-main">
					<section className="panel settings-section">
						<header><span><ServerCog size={20} /></span><div><h3>Backend connection</h3><p>การเชื่อมต่อระหว่าง dashboard และ Control API</p></div><em className={`mode-pill mode-pill--${mode}`}><i />CONNECTED</em></header>
						<div className="settings-fields"><label className="field field--full"><span>API base URL</span><div className="readonly-field"><code>{apiBase}</code><button type="button" disabled={testing} aria-label="ทดสอบการเชื่อมต่อ" onClick={() => void testConnection()}><RefreshCw size={15} className={testing ? "spin" : ""} /></button>{testResult ? <span className={`connection-test-result connection-test-result--${testResult.ok ? "ok" : "fail"}`}>{testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}{testResult.ok ? `เชื่อมต่อได้ (${testResult.latencyMs} ms)` : "เชื่อมต่อไม่ได้"}</span> : null}</div></label><div className="connection-details"><span><strong>API version</strong><code>/v1</code></span><span><strong>Realtime</strong><code>SSE + Last-Event-ID</code></span><span><strong>Timeout</strong><code>12,000 ms</code></span></div></div>
					</section>

					<section className="panel settings-section">
						<header><span><Gauge size={20} /></span><div><h3>ค่าเริ่มต้นของ bot</h3><p>ใช้เฉพาะตอนสร้าง bot ใหม่ ปรับรายตัวได้ภายหลัง</p></div></header>
						{draft ? (
							<div className="settings-fields">
								<label className="field"><span>Speed profile</span><select value={draft.defaultSpeedProfile} onChange={(event) => setDraft({ ...draft, defaultSpeedProfile: event.target.value as SpeedProfile })}>{Object.entries(speedProfileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
								<label className="field"><span>Timezone</span><select value={draft.defaultTimezone} onChange={(event) => setDraft({ ...draft, defaultTimezone: event.target.value })}><option value="Asia/Bangkok">Asia/Bangkok</option><option value="UTC">UTC</option></select></label>
								<label className="field"><span>Graceful drain timeout</span><select value={draft.gracefulDrainTimeoutSec} onChange={(event) => setDraft({ ...draft, gracefulDrainTimeoutSec: Number(event.target.value) })}><option value="15">15 วินาที</option><option value="30">30 วินาที</option><option value="60">60 วินาที</option></select></label>
								<label className="field"><span>First response window</span><select value={draft.firstResponseWindowSec} onChange={(event) => setDraft({ ...draft, firstResponseWindowSec: Number(event.target.value) })}><option value="3">3 วินาที</option><option value="5">5 วินาที</option><option value="10">10 วินาที</option></select></label>
							</div>
						) : <p className="field-help">กำลังโหลดค่าปัจจุบัน…</p>}
					</section>
				</div>

				<aside className="settings-aside">
					<section className="panel security-card">
						<span className="security-card__icon"><ShieldCheck size={24} /></span>
						<p className="eyebrow">SECURITY POSTURE</p>
						<h3>Local environment</h3>
						{security ? (
							<>
								<div className="security-score"><strong>{security.score}</strong><span>/100</span></div>
								<ul>
									{security.checks.map((check) => (
										<li key={check.id} className={check.ok ? undefined : "is-warning"}>
											{check.ok ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}
											{check.label}
										</li>
									))}
								</ul>
							</>
						) : <p className="field-help">กำลังตรวจสอบ…</p>}
					</section>
					<section className="panel resource-card">
						<p className="eyebrow">LOCAL RESOURCES</p>
						{resources ? (
							<>
								<ResourceLine icon={<Database />} name="SQLite database" detail={resources.storage.persistent ? resources.storage.path : "in-memory (ไม่บันทึกลงดิสก์)"} value={resources.storage.persistent ? formatBytes(resources.storage.sizeBytes) : "—"} ok={resources.storage.persistent} />
								<ResourceLine icon={<HardDrive />} name="In-process queue" detail={`${resources.activeBots}/${resources.totalBots} bot ทำงานอยู่`} value={`${resources.totalQueueDepth} pending`} ok />
							</>
						) : <p className="field-help">กำลังโหลด…</p>}
					</section>
					<section className="danger-zone"><span><Power size={21} /></span><div><h3>Emergency stop</h3><p>หยุด process ของ bot ทุกตัวทันที</p></div><Button variant="danger" onClick={() => setConfirmOpen(true)}>หยุดทั้งหมด</Button></section>
				</aside>
			</div>

			<Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="หยุด bot ทุกตัวทันที?" description={`${data.bots.filter((bot) => bot.status !== "stopped").length} process ที่กำลังทำงานจะถูกปิด`} size="sm" danger footer={<><Button variant="ghost" onClick={() => setConfirmOpen(false)}>ยกเลิก</Button><Button variant="danger" loading={stopping} onClick={() => void stopAll()} icon={<Power size={16} />}>Emergency stop</Button></>}><div className="emergency-warning"><TriangleAlert size={20} /><p>ข้อความที่อยู่ในคิวจะถูกยกเลิก และ bot ที่หยุดด้วยคำสั่งนี้จะไม่เริ่มใหม่อัตโนมัติ</p></div></Modal>
		</div>
	);
}

function ResourceLine({ icon, name, detail, value, ok }: { icon: React.ReactNode; name: string; detail: string; value: string; ok: boolean }) {
	return (
		<div className="resource-line">
			<span>{icon}</span>
			<div><strong>{name}</strong><small>{ok ? <i /> : <XCircle size={12} />}{detail}</small></div>
			<code>{value}</code>
		</div>
	);
}
