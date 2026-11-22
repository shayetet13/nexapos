import {
	ArrowRight,
	Bot,
	ChevronRight,
	CircleGauge,
	Clock3,
	Pause,
	Play,
	Plus,
	Radio,
	ShieldCheck,
	Sparkles,
	TriangleAlert,
	UsersRound,
} from "lucide-react";
import { BotAvatar, Button, formatRelativeTime, StatusBadge } from "../components/shared";
import type { BotSummary, ControlCommand, DashboardData, SystemResources } from "../types";

interface OverviewPageProps {
	data: DashboardData;
	onCreateBot: () => void;
	onOpenBot: (bot: BotSummary) => void;
	onControl: (bot: BotSummary, command: ControlCommand) => void;
	onViewBots: () => void;
	busyBotId?: string;
	/** Measured dashboard↔API round trip for the most recent snapshot load. */
	apiLatencyMs?: number;
	/** SQLite footprint; only field of `resources` used here (bot/queue counts come from `data`, which stays fresher). */
	resources?: SystemResources;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OverviewPage({ data, onCreateBot, onOpenBot, onControl, onViewBots, busyBotId, apiLatencyMs, resources }: OverviewPageProps) {
	const online = data.bots.filter((bot) => bot.status === "online").length;
	const totalThroughput = data.bots.reduce((sum, bot) => sum + bot.throughputPerMinute, 0);
	const activeBots = data.bots.filter((bot) => bot.status === "online" || bot.status === "degraded");
	const botsWithLatency = activeBots.filter((bot) => bot.responseP95Ms > 0);
	const averageLatency = botsWithLatency.length
		? Math.round(botsWithLatency.reduce((sum, bot) => sum + bot.responseP95Ms, 0) / botsWithLatency.length)
		: 0;
	const averageFirst = activeBots.length
		? activeBots.reduce((sum, bot) => sum + bot.firstResponseRate, 0) / activeBots.length
		: 0;
	const averageCpu = activeBots.length
		? Math.round(activeBots.reduce((sum, bot) => sum + bot.cpuPercent, 0) / activeBots.length)
		: 0;
	const totalQueueDepth = data.bots.reduce((sum, bot) => sum + bot.queueDepth, 0);
	const anyUnhealthy = data.bots.some((bot) => bot.status === "degraded" || bot.status === "error");
	const points = data.metricSeries.find((series) => series.botId === "all")?.points ?? aggregateMetricSeries(data.metricSeries);
	const maxMessages = Math.max(...points.map((point) => point.messages), 1);

	return (
		<div className="page-stack overview-page">
			<section className="hero-panel">
				<div className="hero-panel__copy">
					<div className="hero-panel__kicker"><Radio size={14} /><span>LIVE OPERATIONS</span><span className="hero-panel__divider" /> <span>ASIA/BANGKOK</span></div>
					<h2>ทุก bot แยกอิสระ<br /><span>แต่ควบคุมจากที่เดียว</span></h2>
					<p>ตรวจสุขภาพ ความเร็ว และ first response ของทุกกลุ่ม พร้อมหยุด process ได้ทันทีเมื่อพบความผิดปกติ</p>
					<div className="hero-panel__actions">
						<Button variant="primary" onClick={onCreateBot} icon={<Plus size={17} />}>สร้าง bot ใหม่</Button>
						<Button variant="ghost" onClick={onViewBots} icon={<Bot size={17} />}>ดู bot ทั้งหมด</Button>
					</div>
				</div>
				<div className="hero-orbit" aria-label={`${online} bot ออนไลน์จาก ${data.bots.length} bot`}>
					<div className="hero-orbit__ring hero-orbit__ring--outer" />
					<div className="hero-orbit__ring hero-orbit__ring--inner" />
					<div className="hero-orbit__core">
						<span>ACTIVE</span>
						<strong>{online}<small>/{data.bots.length}</small></strong>
						<p>BOTS ONLINE</p>
					</div>
					<span className="hero-orbit__node hero-orbit__node--one" />
					<span className="hero-orbit__node hero-orbit__node--two" />
					<span className="hero-orbit__node hero-orbit__node--three" />
				</div>
			</section>

			<section className="metric-grid" aria-label="ตัวชี้วัดหลัก">
				<MetricTile icon={<Bot />} label="BOT ONLINE" value={`${online}/${data.bots.length}`} detail={`${data.bots.filter((bot) => bot.status === "paused").length} ตัวพักอยู่`} tone="mint" progress={(online / Math.max(data.bots.length, 1)) * 100} />
				<MetricTile icon={<Sparkles />} label="THROUGHPUT" value={totalThroughput.toLocaleString()} unit="msg/min" detail="รวมทุก process" tone="violet" progress={Math.min(totalThroughput / 1.4, 100)} />
				<MetricTile icon={<Clock3 />} label="RESPONSE P95" value={botsWithLatency.length ? averageLatency.toLocaleString() : "—"} unit={botsWithLatency.length ? "ms" : undefined} detail={!botsWithLatency.length ? "ยังไม่มีข้อมูล" : averageLatency < 300 ? "เร็วกว่าเป้าหมาย" : "ควรตรวจสอบ"} tone="cyan" progress={botsWithLatency.length ? Math.min(100, Math.max(8, 100 - averageLatency / 10)) : 8} />
				<MetricTile icon={<ShieldCheck />} label="FIRST RESPONSE" value={averageFirst.toFixed(1)} unit="%" detail="ตอบก่อนสมาชิกคนอื่น" tone="amber" progress={averageFirst} />
			</section>

			<div className="overview-grid">
				<section className="panel performance-panel">
					<div className="panel__header">
						<div><p className="eyebrow">TOTAL DISPATCH</p><h2>ความเร็วในการส่ง</h2></div>
						<div className="chart-legend"><span><i className="legend-dot legend-dot--mint" />ข้อความ/นาที</span><button type="button">60 นาที <ChevronRight size={14} /></button></div>
					</div>
					<div className="performance-chart" aria-label="กราฟจำนวนข้อความใน 60 นาทีล่าสุด">
						<div className="performance-chart__axis"><span>{maxMessages}</span><span>{Math.round(maxMessages / 2)}</span><span>0</span></div>
						<div className="performance-chart__bars">
							{points.map((point) => (
								<div className="chart-column" key={point.timestamp} title={`${point.messages} ข้อความ • ${point.latencyMs} ms`}>
									<span style={{ height: `${Math.max(6, (point.messages / maxMessages) * 100)}%` }} />
								</div>
							))}
						</div>
					</div>
					<div className="chart-footer"><span>60 นาทีที่แล้ว</span><strong><span className="live-pulse" />กำลังรับข้อมูล</strong><span>ตอนนี้</span></div>
				</section>

				<section className="panel system-health">
					<div className="panel__header"><div><p className="eyebrow">INFRASTRUCTURE</p><h2>สุขภาพระบบ</h2></div><span className="health-score">{anyUnhealthy ? "!" : "OK"}</span></div>
					<div className="health-list">
						<HealthRow label="Core API" value={apiLatencyMs !== undefined ? "ปกติ" : "—"} detail={apiLatencyMs !== undefined ? `${apiLatencyMs} ms` : "กำลังวัด…"} progress={apiLatencyMs !== undefined ? Math.max(4, 100 - apiLatencyMs) : 8} />
						<HealthRow label="Bot workers" value={`${online} active`} detail={`CPU ${averageCpu}%`} progress={averageCpu} />
						<HealthRow label="In-process queue" value={totalQueueDepth ? `${totalQueueDepth} pending` : "ว่าง"} detail="ต่อ 1 process ต่อ 1 bot" progress={Math.min(100, totalQueueDepth * 10)} />
						<HealthRow label="SQLite database" value={resources?.storage.persistent ? formatBytes(resources.storage.sizeBytes) : "—"} detail={resources ? (resources.storage.persistent ? resources.storage.path : "in-memory") : "กำลังโหลด…"} progress={resources?.storage.persistent ? Math.min(100, (resources.storage.sizeBytes / (50 * 1024 * 1024)) * 100) : 4} />
					</div>
					<div className="health-note"><CircleGauge size={17} /><div><strong>{anyUnhealthy ? "มี bot ที่ควรตรวจสอบ" : "อยู่ในขอบเขตปกติ"}</strong><span>ตรวจล่าสุดเมื่อสักครู่</span></div></div>
				</section>
			</div>

			<section className="panel fleet-panel">
				<div className="panel__header">
					<div><p className="eyebrow">BOT FLEET</p><h2>สถานะราย bot</h2></div>
					<button className="text-link" type="button" onClick={onViewBots}>ดูทั้งหมด <ArrowRight size={15} /></button>
				</div>
				<div className="bot-table" role="table" aria-label="สถานะ bot">
					<div className="bot-table__head" role="row"><span>BOT / PROCESS</span><span>สถานะ</span><span>ความเร็ว</span><span>FIRST</span><span>LOAD</span><span>ควบคุม</span></div>
					{data.bots.map((bot) => (
						<div className="bot-table__row" role="row" key={bot.id}>
							<button className="bot-identity" type="button" onClick={() => onOpenBot(bot)}>
								<BotAvatar name={bot.name} accent={bot.accent} />
								<span><strong>{bot.name}</strong><small>{bot.adapter === "official" ? "LINE Official" : "LINEJS / LINE กลุ่ม & OpenChat"} · {bot.allowedTargets} กลุ่ม</small></span>
							</button>
							<div><StatusBadge status={bot.status} /></div>
							<div className="table-metric"><strong>{bot.throughputPerMinute}</strong><span>msg/min</span></div>
							<div className="table-metric"><strong>{bot.firstResponseRate.toFixed(1)}%</strong><span>{bot.responseP95Ms || "—"}{bot.responseP95Ms ? " ms" : ""}</span></div>
							<div className="load-meter"><span><i style={{ width: `${Math.min(bot.cpuPercent, 100)}%` }} /></span><strong>{bot.cpuPercent}%</strong></div>
							<div className="bot-row-actions">
								{bot.status === "online" || bot.status === "degraded" ? (
									<button type="button" disabled={busyBotId === bot.id} onClick={() => onControl(bot, "pause")} aria-label={`พัก ${bot.name}`}><Pause size={15} /></button>
								) : (
									<button
										type="button"
										disabled={busyBotId === bot.id || (bot.adapter === "linejs" && !bot.credentialsConfigured)}
										title={bot.adapter === "linejs" && !bot.credentialsConfigured ? "ยืนยันตัวตนด้วย QR/PIN ก่อนเริ่มใช้งาน" : undefined}
										onClick={() => onControl(bot, bot.status === "paused" ? "resume" : "start")}
										aria-label={`เริ่ม ${bot.name}`}
									><Play size={15} /></button>
								)}
								<button type="button" onClick={() => onOpenBot(bot)} aria-label={`ดูรายละเอียด ${bot.name}`}><ChevronRight size={16} /></button>
							</div>
						</div>
					))}
				</div>
			</section>

			<div className="overview-bottom-grid">
				<section className="panel activity-panel">
					<div className="panel__header"><div><p className="eyebrow">AUDIT STREAM</p><h2>กิจกรรมล่าสุด</h2></div><span className="stream-chip"><span />LIVE</span></div>
					<div className="activity-list">
						{data.audit.slice(0, 4).map((entry) => {
							const bot = data.bots.find((item) => item.id === entry.botId);
							return <div className="activity-row" key={entry.id}><span className={`activity-row__icon activity-row__icon--${entry.type}`}>{entry.type === "control" ? <Radio size={14} /> : entry.type === "delivery" ? <TriangleAlert size={14} /> : <ShieldCheck size={14} />}</span><div><strong>{entry.message}</strong><span>{bot?.name ?? "ระบบ"} · {entry.actor}</span></div><time>{formatRelativeTime(entry.createdAt)}</time></div>;
						})}
					</div>
				</section>
				<section className="panel group-summary">
					<div className="panel__header"><div><p className="eyebrow">TARGETS</p><h2>กลุ่มที่อนุญาต</h2></div><UsersRound size={20} /></div>
					<strong className="group-summary__value">{data.targets.filter((target) => target.allowed).length}<small>/{data.targets.length}</small></strong>
					<p>เปิดให้ bot ส่งข้อความ</p>
					<div className="target-types"><span><i className="legend-dot legend-dot--mint" />LINE Group <strong>{data.targets.filter((target) => target.type === "group" && target.allowed).length}</strong></span><span><i className="legend-dot legend-dot--violet" />OpenChat <strong>{data.targets.filter((target) => target.type === "openchat" && target.allowed).length}</strong></span></div>
				</section>
			</div>
		</div>
	);
}

function MetricTile({ icon, label, value, unit, detail, tone, progress }: { icon: React.ReactNode; label: string; value: string | number; unit?: string; detail: string; tone: string; progress: number }) {
	return (
		<article className={`metric-tile metric-tile--${tone}`}>
			<div className="metric-tile__top"><span className="metric-tile__icon">{icon}</span><span className="metric-tile__label">{label}</span></div>
			<div className="metric-tile__value"><strong>{value}</strong>{unit ? <span>{unit}</span> : null}</div>
			<div className="metric-tile__footer"><span>{detail}</span><div><i style={{ width: `${Math.max(2, Math.min(progress, 100))}%` }} /></div></div>
		</article>
	);
}

function HealthRow({ label, value, detail, progress }: { label: string; value: string; detail: string; progress: number }) {
	return <div className="health-row"><div><strong>{label}</strong><span>{detail}</span></div><div className="health-row__bar"><i style={{ width: `${progress}%` }} /></div><span>{value}</span></div>;
}

function aggregateMetricSeries(series: DashboardData["metricSeries"]): DashboardData["metricSeries"][number]["points"] {
	const length = Math.max(...series.map((item) => item.points.length), 0);
	return Array.from({ length }, (_, index) => {
		const points = series.map((item) => item.points[item.points.length - length + index]).filter(Boolean);
		return {
			timestamp: points[0]?.timestamp ?? new Date().toISOString(),
			messages: points.reduce((sum, point) => sum + point.messages, 0),
			latencyMs: points.length ? Math.round(points.reduce((sum, point) => sum + point.latencyMs, 0) / points.length) : 0,
		};
	}).slice(-12);
}
