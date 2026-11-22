import {
	BellRing,
	CircleCheck,
	Clock3,
	Pause,
	Play,
	RotateCcw,
	TimerReset,
	UserRoundCheck,
	UsersRound,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { BotAvatar, Button, EmptyState, formatRelativeTime } from "../components/shared";
import type { DashboardData, QueueTicket, QueueTicketStatus } from "../types";

interface QueuePageProps {
	data: DashboardData;
	onAction: (botId: string, action: "call_next" | "cancel", ticketId?: string) => Promise<void>;
}

const statusLabels: Record<QueueTicketStatus, string> = {
	waiting: "กำลังรอ",
	called: "เรียกแล้ว",
	serving: "กำลังให้บริการ",
	cancelled: "ยกเลิก",
};

export function QueuePage({ data, onAction }: QueuePageProps) {
	const botsWithQueue = data.bots.filter((bot) => data.queueTickets.some((ticket) => ticket.botId === bot.id));
	const [botId, setBotId] = useState(botsWithQueue[0]?.id ?? data.bots[0]?.id ?? "");
	const [queueOpen, setQueueOpen] = useState(true);
	const [busy, setBusy] = useState<string>();
	const tickets = useMemo(() => data.queueTickets.filter((ticket) => ticket.botId === botId).sort((a, b) => a.queueNumber - b.queueNumber), [botId, data.queueTickets]);
	const waiting = tickets.filter((ticket) => ticket.status === "waiting");
	const active = tickets.find((ticket) => ticket.status === "serving");
	const called = tickets.find((ticket) => ticket.status === "called");
	const bot = data.bots.find((item) => item.id === botId);
	const averageWait = waiting.length ? Math.round(waiting.reduce((sum, ticket) => sum + ticket.waitMinutes, 0) / waiting.length) : 0;

	const run = async (action: "call_next" | "cancel", ticketId?: string) => {
		setBusy(ticketId ?? action);
		try { await onAction(botId, action, ticketId); } finally { setBusy(undefined); }
	};

	return (
		<div className="page-stack queue-page">
			<section className="page-intro">
				<div><p className="eyebrow">QUEUE CONTROL DESK</p><h2>คิวแยกตาม bot และกลุ่ม</h2><p>เรียกคิว ยกเลิก หรือปิดรับคิวได้จาก dashboard โดยไม่กระทบ bot ตัวอื่น</p></div>
				<label className="bot-select"><span>กำลังจัดการ</span><select value={botId} onChange={(event) => setBotId(event.target.value)}>{data.bots.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
			</section>

			<div className="queue-live-bar">
				<div>{bot ? <BotAvatar name={bot.name} accent={bot.accent} /> : null}<span><strong>{bot?.name ?? "ไม่พบ bot"}</strong><small>{queueOpen ? "กำลังเปิดรับคิว" : "ปิดรับคิวชั่วคราว"}</small></span></div>
				<span className={`queue-state ${queueOpen ? "queue-state--open" : "queue-state--closed"}`}><i />{queueOpen ? "QUEUE OPEN" : "QUEUE PAUSED"}</span>
				<Button onClick={() => setQueueOpen((value) => !value)} icon={queueOpen ? <Pause size={15} /> : <Play size={15} />}>{queueOpen ? "ปิดรับคิว" : "เปิดรับคิว"}</Button>
			</div>

			<section className="queue-kpi-grid">
				<QueueKpi icon={<UsersRound />} label="WAITING" value={waiting.length} unit="คิว" tone="violet" />
				<QueueKpi icon={<Clock3 />} label="AVERAGE WAIT" value={averageWait} unit="นาที" tone="amber" />
				<QueueKpi icon={<UserRoundCheck />} label="SERVING NOW" value={active?.queueNumber ?? "—"} unit={active ? active.displayName : "ยังไม่มี"} tone="mint" />
				<QueueKpi icon={<BellRing />} label="CALLED" value={called?.queueNumber ?? "—"} unit={called ? called.displayName : "พร้อมเรียก"} tone="cyan" />
			</section>

			<div className="queue-layout">
				<section className="panel now-serving">
					<p className="eyebrow">NOW SERVING</p>
					{active ? <><span className="now-serving__number">{String(active.queueNumber).padStart(3, "0")}</span><h3>{active.displayName}</h3><p>เริ่มรอ {formatRelativeTime(active.joinedAt)}</p></> : <><span className="now-serving__number">—</span><h3>ยังไม่มีคิวที่กำลังให้บริการ</h3></>}
					<div className="now-serving__controls"><Button variant="primary" loading={busy === "call_next"} disabled={!waiting.length} onClick={() => void run("call_next")} icon={<BellRing size={16} />}>เรียกคิวถัดไป</Button><Button icon={<RotateCcw size={15} />}>เรียกซ้ำ</Button></div>
					<div className="queue-next-preview"><span>NEXT</span><strong>{called ? `#${called.queueNumber} · ${called.displayName}` : waiting[0] ? `#${waiting[0].queueNumber} · ${waiting[0].displayName}` : "ไม่มีคิวรอ"}</strong></div>
				</section>

				<section className="panel queue-list-panel">
					<div className="panel__header"><div><p className="eyebrow">TICKETS</p><h2>รายการคิว</h2></div><span className="queue-count">{tickets.length} รายการ</span></div>
					{tickets.length ? <div className="queue-table"><div className="queue-table__head"><span>หมายเลข</span><span>สมาชิก</span><span>รอมาแล้ว</span><span>สถานะ</span><span /></div>{tickets.map((ticket) => <QueueRow key={ticket.id} ticket={ticket} busy={busy === ticket.id} onCancel={() => void run("cancel", ticket.id)} />)}</div> : <EmptyState title="ยังไม่มีรายการคิว" description="เมื่อ rule รับคิวทำงาน รายการจะแสดงที่นี่ทันที" />}
				</section>
			</div>

			<section className="queue-help"><TimerReset size={18} /><div><strong>Reset คิวอัตโนมัติทุกวันเวลา 00:00</strong><span>เปลี่ยนเวลาและเลขเริ่มต้นได้ใน rule ของ bot</span></div><Button variant="ghost">ตั้งค่า reset</Button></section>
		</div>
	);
}

function QueueKpi({ icon, label, value, unit, tone }: { icon: React.ReactNode; label: string; value: string | number; unit: string; tone: string }) {
	return <article className={`queue-kpi queue-kpi--${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{unit}</p></div></article>;
}

function QueueRow({ ticket, busy, onCancel }: { ticket: QueueTicket; busy: boolean; onCancel: () => void }) {
	return <div className={`queue-table__row queue-table__row--${ticket.status}`}><strong className="queue-number">#{String(ticket.queueNumber).padStart(3, "0")}</strong><span className="queue-person"><i>{ticket.displayName.slice(0, 1).toUpperCase()}</i><strong>{ticket.displayName}</strong></span><span>{ticket.waitMinutes} นาที</span><span className={`ticket-status ticket-status--${ticket.status}`}>{ticket.status === "serving" ? <CircleCheck size={13} /> : null}{statusLabels[ticket.status]}</span><button type="button" disabled={busy || ticket.status === "cancelled" || ticket.status === "serving"} onClick={onCancel} aria-label={`ยกเลิกคิว ${ticket.queueNumber}`}><X size={15} /></button></div>;
}
