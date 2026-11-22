import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	Braces,
	CalendarClock,
	ChevronRight,
	Code2,
	Copy,
	Filter,
	GripVertical,
	MessageSquareText,
	MousePointerClick,
	Play,
	Plus,
	Save,
	Sparkles,
	Trash2,
	UserPlus,
	UsersRound,
	Webhook,
	Workflow,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BotAvatar, Button, EmptyState, formatRelativeTime, Modal, Toggle } from "../components/shared";
import type {
	ActionType,
	BotSummary,
	ConditionType,
	DashboardData,
	Rule,
	RuleNode,
	TriggerType,
} from "../types";

const triggerLabels: Record<TriggerType, { title: string; hint: string; icon: typeof MessageSquareText }> = {
	message_received: { title: "ได้รับข้อความ", hint: "เมื่อมีข้อความเข้าในกลุ่ม", icon: MessageSquareText },
	member_joined: { title: "สมาชิกเข้ากลุ่ม", hint: "เมื่อมีสมาชิกใหม่", icon: UserPlus },
	schedule: { title: "ตามวันและเวลา", hint: "Cron schedule", icon: CalendarClock },
	external_event: { title: "External API", hint: "ระบบภายนอกเรียก event", icon: Webhook },
	queue_state_changed: { title: "สถานะคิวเปลี่ยน", hint: "เปิด ปิด หรือเรียกคิว", icon: UsersRound },
};

const conditionLabels: Record<ConditionType, string> = {
	target: "เฉพาะกลุ่มที่กำหนด",
	message_match: "ข้อความตรงเงื่อนไข",
	sender_role: "สิทธิ์ของผู้ส่ง",
	time_window: "ช่วงเวลา",
	cooldown: "Cooldown",
	queue_state: "สถานะคิว",
};

const actionLabels: Record<ActionType, string> = {
	reply_text: "ตอบข้อความต้นทาง",
	send_text: "ส่งข้อความ",
	queue_join: "รับคิว",
	queue_status: "แจ้งสถานะคิว",
	queue_cancel: "ยกเลิกคิว",
	queue_next: "เรียกคิวถัดไป",
	set_variable: "ตั้งค่าตัวแปร",
	webhook: "เรียก Webhook",
	delay: "หน่วงเวลา",
	stop_processing: "หยุด rules ที่เหลือ",
};

interface RulesPageProps {
	data: DashboardData;
	search: string;
	onSave: (rule: Rule) => Promise<void>;
	onDelete: (rule: Rule) => Promise<void>;
}

export function RulesPage({ data, search, onSave, onDelete }: RulesPageProps) {
	const [botFilter, setBotFilter] = useState("all");
	const [editing, setEditing] = useState<Rule | null>(null);
	const [builderOpen, setBuilderOpen] = useState(false);
	const [deleting, setDeleting] = useState<Rule | null>(null);
	const [busyRuleId, setBusyRuleId] = useState<string>();

	const filtered = useMemo(() => data.rules.filter((rule) => {
		const bot = data.bots.find((item) => item.id === rule.botId);
		const haystack = `${rule.name} ${rule.description} ${bot?.name ?? ""}`.toLowerCase();
		return (botFilter === "all" || rule.botId === botFilter) && haystack.includes(search.toLowerCase());
	}).sort((a, b) => a.priority - b.priority), [botFilter, data.bots, data.rules, search]);

	const openNew = () => {
		setEditing(null);
		setBuilderOpen(true);
	};

	const openEdit = (rule: Rule) => {
		setEditing(rule);
		setBuilderOpen(true);
	};

	const toggleRule = async (rule: Rule, enabled: boolean) => {
		setBusyRuleId(rule.id);
		try { await onSave({ ...rule, enabled }); } finally { setBusyRuleId(undefined); }
	};

	const deleteRule = async () => {
		if (!deleting) return;
		setBusyRuleId(deleting.id);
		try { await onDelete(deleting); setDeleting(null); } finally { setBusyRuleId(undefined); }
	};

	return (
		<div className="page-stack rules-page">
			<section className="page-intro rule-intro">
				<div><p className="eyebrow">ADMIN-CONTROLLED AUTOMATION</p><h2>Admin เป็นคนกำหนดทุกการทำงาน</h2><p>ประกอบกฎแบบ Trigger <ArrowRight size={14} /> Conditions <ArrowRight size={14} /> Actions โดยไม่ต้องแก้โค้ด bot</p></div>
				<Button variant="primary" onClick={openNew} icon={<Plus size={17} />}>สร้าง rule</Button>
			</section>

			<section className="rule-explainer" aria-label="โครงสร้าง rule">
				<FlowStep number="01" icon={<MousePointerClick />} label="TRIGGER" title="เกิดอะไรขึ้น" example="ได้รับข้อความ / ถึงเวลา" tone="violet" />
				<ChevronRight className="rule-explainer__arrow" />
				<FlowStep number="02" icon={<Filter />} label="CONDITIONS" title="ต้องตรงเงื่อนไขใด" example="กลุ่ม / เวลา / cooldown" tone="cyan" />
				<ChevronRight className="rule-explainer__arrow" />
				<FlowStep number="03" icon={<Sparkles />} label="ACTIONS" title="ให้ bot ทำอะไร" example="ตอบ / รับคิว / webhook" tone="mint" />
			</section>

			<div className="list-toolbar">
				<div className="toolbar-title"><Workflow size={17} /><strong>{filtered.length} rules</strong><span>{data.rules.filter((rule) => rule.enabled).length} เปิดใช้งาน</span></div>
				<label className="field field--inline"><span>แสดง bot</span><select value={botFilter} onChange={(event) => setBotFilter(event.target.value)}><option value="all">ทุก bot</option>{data.bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
			</div>

			{filtered.length ? <div className="rule-list">{filtered.map((rule) => {
				const bot = data.bots.find((item) => item.id === rule.botId);
				const TriggerIcon = triggerLabels[rule.trigger.type].icon;
				return (
					<article className={`rule-card ${rule.enabled ? "" : "rule-card--disabled"}`} key={rule.id}>
						<div className="rule-card__drag"><GripVertical size={17} /><span>{String(rule.priority).padStart(2, "0")}</span></div>
						<div className="rule-card__main">
							<header><div><h3>{rule.name}</h3><p>{rule.description}</p></div><Toggle checked={rule.enabled} disabled={busyRuleId === rule.id} onChange={(enabled) => void toggleRule(rule, enabled)} label={`เปิดใช้ ${rule.name}`} /></header>
							<div className="rule-pipeline">
								<span className="pipeline-node pipeline-node--trigger"><TriggerIcon size={15} /><strong>{triggerLabels[rule.trigger.type].title}</strong><small>{summarizeConfig(rule.trigger.config)}</small></span>
								<ChevronRight size={15} />
								<span className="pipeline-node pipeline-node--condition"><Filter size={15} /><strong>{rule.conditions.length} เงื่อนไข</strong><small>{rule.conditions[0] ? conditionLabels[rule.conditions[0].type] : "ทำงานทุกครั้ง"}</small></span>
								<ChevronRight size={15} />
								<span className="pipeline-node pipeline-node--action"><Sparkles size={15} /><strong>{rule.actions.length} actions</strong><small>{rule.actions[0] ? actionLabels[rule.actions[0].type] : "ยังไม่กำหนด"}</small></span>
							</div>
							<footer><span>{bot ? <><BotAvatar name={bot.name} accent={bot.accent} size="sm" />{bot.name}</> : "ไม่พบ bot"}</span><span>ทำงาน {rule.triggerCount.toLocaleString()} ครั้ง</span><span>{rule.lastTriggeredAt ? formatRelativeTime(rule.lastTriggeredAt) : "ยังไม่เคยทำงาน"}</span></footer>
						</div>
						<div className="rule-card__actions"><button type="button" onClick={() => openEdit(rule)} aria-label={`แก้ไข ${rule.name}`}><Code2 size={16} /></button><button type="button" onClick={() => { const duplicate = { ...rule, id: `draft_${crypto.randomUUID()}`, name: `${rule.name} (สำเนา)` }; setEditing(duplicate); setBuilderOpen(true); }} aria-label={`คัดลอก ${rule.name}`}><Copy size={16} /></button><button className="danger-icon" type="button" onClick={() => setDeleting(rule)} aria-label={`ลบ ${rule.name}`}><Trash2 size={16} /></button></div>
					</article>
				);
			})}</div> : <EmptyState title="ยังไม่มี rule ที่ตรงกับตัวกรอง" description="สร้าง rule แรกเพื่อกำหนดว่า bot ต้องตอบสนองอย่างไร" action={<Button variant="primary" onClick={openNew} icon={<Plus size={16} />}>สร้าง rule</Button>} />}

			<RuleBuilderModal open={builderOpen} initialRule={editing} bots={data.bots} onClose={() => setBuilderOpen(false)} onSubmit={async (rule) => { await onSave(rule); setBuilderOpen(false); }} />
			<Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="ลบ rule นี้?" description={`“${deleting?.name ?? ""}” จะหยุดทำงานทันทีและกู้คืนไม่ได้`} size="sm" danger footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>ยกเลิก</Button><Button variant="danger" loading={busyRuleId === deleting?.id} onClick={() => void deleteRule()} icon={<Trash2 size={16} />}>ลบ rule</Button></>}><p className="danger-copy">การลบ rule ไม่มีผลกับข้อความที่ถูกส่งไปแล้ว และจะถูกบันทึกใน Audit log</p></Modal>
		</div>
	);
}

function FlowStep({ number, icon, label, title, example, tone }: { number: string; icon: React.ReactNode; label: string; title: string; example: string; tone: string }) {
	return <div className={`flow-step flow-step--${tone}`}><span className="flow-step__number">{number}</span><span className="flow-step__icon">{icon}</span><div><small>{label}</small><strong>{title}</strong><p>{example}</p></div></div>;
}

interface RuleBuilderModalProps {
	open: boolean;
	initialRule: Rule | null;
	bots: BotSummary[];
	onClose: () => void;
	onSubmit: (rule: Rule) => Promise<void>;
}

function RuleBuilderModal({ open, initialRule, bots, onClose, onSubmit }: RuleBuilderModalProps) {
	const [rule, setRule] = useState<Rule>(() => initialRule ?? emptyRule(bots[0]?.id ?? ""));
	const [conditionToAdd, setConditionToAdd] = useState<ConditionType>("target");
	const [actionToAdd, setActionToAdd] = useState<ActionType>("reply_text");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (open) {
			setRule(initialRule ? clone(initialRule) : emptyRule(bots[0]?.id ?? ""));
			setError("");
		}
	}, [initialRule, open]);

	const updateTrigger = (type: TriggerType) => setRule((current) => ({ ...current, trigger: { id: current.trigger.id, type, config: defaultTriggerConfig(type) } }));
	const updateNodeConfig = <T extends ConditionType | ActionType>(collection: "conditions" | "actions", id: string, config: Record<string, string | number | boolean>) => {
		setRule((current) => ({ ...current, [collection]: current[collection].map((node) => node.id === id ? { ...node, config } : node) as Array<RuleNode<T>> }));
	};
	const addCondition = () => setRule((current) => ({ ...current, conditions: [...current.conditions, { id: crypto.randomUUID(), type: conditionToAdd, config: defaultConditionConfig(conditionToAdd) }] }));
	const addAction = () => setRule((current) => ({ ...current, actions: [...current.actions, { id: crypto.randomUUID(), type: actionToAdd, config: defaultActionConfig(actionToAdd) }] }));
	const removeNode = (collection: "conditions" | "actions", id: string) => setRule((current) => ({ ...current, [collection]: current[collection].filter((node) => node.id !== id) }));
	const moveAction = (index: number, direction: -1 | 1) => setRule((current) => {
		const next = [...current.actions];
		const destination = index + direction;
		if (destination < 0 || destination >= next.length) return current;
		[next[index], next[destination]] = [next[destination], next[index]];
		return { ...current, actions: next };
	});

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!rule.name.trim()) return setError("กรุณาตั้งชื่อ rule");
		if (!rule.botId) return setError("กรุณาเลือก bot");
		if (!rule.actions.length) return setError("ต้องมีอย่างน้อย 1 action");
		setSaving(true);
		setError("");
		try { await onSubmit({ ...rule, name: rule.name.trim(), description: rule.description.trim() }); }
		catch (caught) { setError(caught instanceof Error ? caught.message : "บันทึก rule ไม่สำเร็จ"); }
		finally { setSaving(false); }
	};

	return (
		<Modal open={open} onClose={onClose} title={initialRule ? "แก้ไข rule" : "สร้าง rule ใหม่"} description="กำหนดลำดับการทำงานของ bot โดย Admin" size="xl">
			<form className="rule-builder" onSubmit={submit}>
				<div className="builder-basics">
					<label className="field"><span>ชื่อ rule <b>*</b></span><input value={rule.name} onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))} placeholder="เช่น รับคิวเมื่อพิมพ์ !คิว" autoFocus /></label>
					<label className="field"><span>Bot ที่ใช้ rule</span><select value={rule.botId} onChange={(event) => setRule((current) => ({ ...current, botId: event.target.value }))}>{bots.map((bot) => <option value={bot.id} key={bot.id}>{bot.name}</option>)}</select></label>
					<label className="field field--wide"><span>คำอธิบาย</span><input value={rule.description} onChange={(event) => setRule((current) => ({ ...current, description: event.target.value }))} placeholder="อธิบายสั้น ๆ ว่า rule นี้ทำอะไร" /></label>
					<label className="field field--priority"><span>Priority</span><input type="number" min={1} max={999} value={rule.priority} onChange={(event) => setRule((current) => ({ ...current, priority: Number(event.target.value) }))} /></label>
				</div>

				<section className="builder-stage builder-stage--trigger">
					<header><span>01</span><div><small>TRIGGER</small><h3>เมื่อเกิดเหตุการณ์ใด</h3></div></header>
					<div className="trigger-picker">
						{(Object.entries(triggerLabels) as Array<[TriggerType, typeof triggerLabels[TriggerType]]>).map(([type, item]) => { const Icon = item.icon; return <button className={rule.trigger.type === type ? "is-selected" : ""} key={type} type="button" onClick={() => updateTrigger(type)}><Icon size={18} /><span><strong>{item.title}</strong><small>{item.hint}</small></span><i /></button>; })}
					</div>
					<NodeConfigEditor type={rule.trigger.type} config={rule.trigger.config} onChange={(config) => setRule((current) => ({ ...current, trigger: { ...current.trigger, config } }))} />
				</section>

				<section className="builder-stage builder-stage--condition">
					<header><span>02</span><div><small>CONDITIONS</small><h3>และตรงตามเงื่อนไข</h3></div><em>ไม่บังคับ</em></header>
					<div className="builder-nodes">
						{rule.conditions.map((node, index) => <div className="builder-node" key={node.id}><div className="builder-node__head"><span>{index + 1}</span><strong>{conditionLabels[node.type]}</strong><button type="button" onClick={() => removeNode("conditions", node.id)} aria-label="ลบเงื่อนไข"><X size={15} /></button></div><NodeConfigEditor type={node.type} config={node.config} onChange={(config) => updateNodeConfig("conditions", node.id, config)} /></div>)}
					</div>
					<div className="add-node"><select value={conditionToAdd} onChange={(event) => setConditionToAdd(event.target.value as ConditionType)}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button type="button" onClick={addCondition} icon={<Plus size={15} />}>เพิ่ม condition</Button></div>
				</section>

				<section className="builder-stage builder-stage--action">
					<header><span>03</span><div><small>ACTIONS</small><h3>ให้ bot ทำตามลำดับ</h3></div></header>
					<div className="builder-nodes">
						{rule.actions.map((node, index) => <div className="builder-node builder-node--action" key={node.id}><div className="builder-node__head"><span>{index + 1}</span><strong>{actionLabels[node.type]}</strong><div className="node-controls"><button type="button" disabled={index === 0} onClick={() => moveAction(index, -1)} aria-label="เลื่อนขึ้น"><ArrowUp size={14} /></button><button type="button" disabled={index === rule.actions.length - 1} onClick={() => moveAction(index, 1)} aria-label="เลื่อนลง"><ArrowDown size={14} /></button><button type="button" onClick={() => removeNode("actions", node.id)} aria-label="ลบ action"><X size={15} /></button></div></div><NodeConfigEditor type={node.type} config={node.config} onChange={(config) => updateNodeConfig("actions", node.id, config)} /></div>)}
					</div>
					<div className="add-node"><select value={actionToAdd} onChange={(event) => setActionToAdd(event.target.value as ActionType)}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button type="button" onClick={addAction} icon={<Plus size={15} />}>เพิ่ม action</Button></div>
				</section>

				<div className="builder-options"><label><Toggle checked={rule.enabled} onChange={(enabled) => setRule((current) => ({ ...current, enabled }))} label="เปิดใช้ทันที" /><span><strong>เปิดใช้ทันที</strong><small>Rule จะเริ่มรับ event หลังบันทึก</small></span></label><label><Toggle checked={rule.stopProcessing} onChange={(stopProcessing) => setRule((current) => ({ ...current, stopProcessing }))} label="หยุดประมวลผล rule ถัดไป" /><span><strong>หยุด rule ถัดไปเมื่อสำเร็จ</strong><small>ป้องกัน bot ตอบซ้ำจากหลาย rules</small></span></label></div>
				{error ? <p className="form-error" role="alert">{error}</p> : null}
				<div className="form-actions"><Button type="button" disabled title="Dry run จะเปิดใช้เมื่อ backend simulator พร้อม" icon={<Play size={15} />}>Dry run</Button><Button type="button" variant="ghost" onClick={onClose}>ยกเลิก</Button><Button type="submit" variant="primary" loading={saving} icon={<Save size={16} />}>บันทึก rule</Button></div>
			</form>
		</Modal>
	);
}

function NodeConfigEditor({ type, config, onChange }: { type: TriggerType | ConditionType | ActionType; config: Record<string, string | number | boolean>; onChange: (config: Record<string, string | number | boolean>) => void }) {
	const set = (key: string, value: string | number | boolean) => onChange({ ...config, [key]: value });
	if (type === "message_received" || type === "message_match") return <div className="node-config node-config--message"><select value={String(config.mode ?? "exact")} onChange={(event) => set("mode", event.target.value)}><option value="exact">ตรงทั้งหมด</option><option value="prefix">ขึ้นต้นด้วย</option><option value="contains">มีคำว่า</option><option value="regex">Safe regex</option><option value="all">ทุกข้อความ</option></select><input value={String(config.match ?? "")} disabled={config.mode === "all"} onChange={(event) => set("match", event.target.value)} placeholder="ข้อความหรือ keyword" /></div>;
	if (type === "schedule") return <div className="node-config"><label><span>Cron</span><input className="mono" value={String(config.cron ?? "0 9 * * *")} onChange={(event) => set("cron", event.target.value)} /></label><label><span>Timezone</span><select value={String(config.timezone ?? "Asia/Bangkok")} onChange={(event) => set("timezone", event.target.value)}><option>Asia/Bangkok</option><option>UTC</option></select></label></div>;
	if (type === "external_event") return <div className="node-config"><label><span>Event key</span><input className="mono" value={String(config.eventKey ?? "order.created")} onChange={(event) => set("eventKey", event.target.value)} /></label></div>;
	if (type === "queue_state_changed" || type === "queue_state") return <div className="node-config"><label><span>สถานะคิว</span><select value={String(config.state ?? "open")} onChange={(event) => set("state", event.target.value)}><option value="open">เปิดรับคิว</option><option value="paused">พักรับคิว</option><option value="closed">ปิดคิว</option></select></label></div>;
	if (type === "target") return <div className="node-config"><label><span>ขอบเขต</span><select value={String(config.mode ?? "allowlist")} onChange={(event) => set("mode", event.target.value)}><option value="allowlist">ทุกกลุ่มใน allowlist</option><option value="specific">เฉพาะ Target ID</option></select></label><label><span>Target ID</span><input className="mono" disabled={config.mode !== "specific"} value={String(config.targetId ?? "")} onChange={(event) => set("targetId", event.target.value)} placeholder="target_xxx" /></label></div>;
	if (type === "sender_role") return <div className="node-config"><label><span>สิทธิ์ผู้ส่ง</span><select value={String(config.role ?? "member")} onChange={(event) => set("role", event.target.value)}><option value="member">สมาชิกทุกคน</option><option value="operator">Operator</option><option value="admin">Admin เท่านั้น</option></select></label></div>;
	if (type === "time_window") return <div className="node-config"><label><span>ตั้งแต่</span><input type="time" value={String(config.from ?? "08:00")} onChange={(event) => set("from", event.target.value)} /></label><label><span>ถึง</span><input type="time" value={String(config.to ?? "20:00")} onChange={(event) => set("to", event.target.value)} /></label></div>;
	if (type === "cooldown") return <div className="node-config"><label><span>ระยะเวลา (วินาที)</span><input type="number" min={1} value={Number(config.seconds ?? 30)} onChange={(event) => set("seconds", Number(event.target.value))} /></label><label><span>ต่อ</span><select value={String(config.scope ?? "user")} onChange={(event) => set("scope", event.target.value)}><option value="user">ผู้ใช้</option><option value="group">กลุ่ม</option></select></label></div>;
	if (type === "reply_text" || type === "send_text") return <div className="node-config"><label className="node-config__full"><span>ข้อความตอบกลับ</span><textarea rows={3} value={String(config.text ?? "")} onChange={(event) => set("text", event.target.value)} placeholder="รองรับตัวแปร เช่น {{user.name}} หรือ {{queue.number}}" /></label></div>;
	if (type === "set_variable") return <div className="node-config"><label><span>ชื่อตัวแปร (A-Z, 0-9, _)</span><input className="mono" pattern="[A-Za-z_][A-Za-z0-9_]*" value={String(config.key ?? "state_key")} onChange={(event) => set("key", event.target.value)} /></label><label><span>ค่า</span><input value={String(config.value ?? "")} onChange={(event) => set("value", event.target.value)} /></label></div>;
	if (type === "webhook") return <div className="node-config"><label><span>Method</span><select value={String(config.method ?? "POST")} onChange={(event) => set("method", event.target.value)}><option>POST</option><option>PUT</option><option>PATCH</option></select></label><label className="node-config__grow"><span>Webhook endpoint ID</span><input className="mono" value={String(config.endpointId ?? "")} onChange={(event) => set("endpointId", event.target.value)} placeholder="endpoint_order_service" /></label></div>;
	if (type === "delay") return <div className="node-config"><label><span>หน่วงเวลา (ms)</span><input type="number" min={0} max={30_000} value={Number(config.milliseconds ?? 500)} onChange={(event) => set("milliseconds", Number(event.target.value))} /></label></div>;
	return <div className="node-config node-config--empty"><Braces size={15} /><span>Action นี้ไม่ต้องตั้งค่าเพิ่มเติม</span></div>;
}

function emptyRule(botId: string): Rule {
	return {
		id: `draft_${crypto.randomUUID()}`,
		botId,
		name: "",
		description: "",
		enabled: true,
		priority: 10,
		trigger: { id: crypto.randomUUID(), type: "message_received", config: defaultTriggerConfig("message_received") },
		conditions: [],
		actions: [{ id: crypto.randomUUID(), type: "reply_text", config: defaultActionConfig("reply_text") }],
		stopProcessing: true,
		version: 0,
		triggerCount: 0,
	};
}

function defaultTriggerConfig(type: TriggerType): Record<string, string | number | boolean> {
	if (type === "message_received") return { mode: "exact", match: "" };
	if (type === "schedule") return { cron: "0 9 * * *", timezone: "Asia/Bangkok" };
	if (type === "external_event") return { eventKey: "event.created" };
	if (type === "queue_state_changed") return { state: "open" };
	return {};
}

function defaultConditionConfig(type: ConditionType): Record<string, string | number | boolean> {
	const configs: Record<ConditionType, Record<string, string | number | boolean>> = {
		target: { mode: "allowlist", targetId: "" },
		message_match: { mode: "contains", match: "" },
		sender_role: { role: "member" },
		time_window: { from: "08:00", to: "20:00" },
		cooldown: { seconds: 30, scope: "user" },
		queue_state: { state: "open" },
	};
	return configs[type];
}

function defaultActionConfig(type: ActionType): Record<string, string | number | boolean> {
	if (type === "reply_text" || type === "send_text") return { text: "" };
	if (type === "set_variable") return { key: "state_key", value: "" };
	if (type === "webhook") return { method: "POST", endpointId: "" };
	if (type === "delay") return { milliseconds: 500 };
	return {};
}

function summarizeConfig(config: Record<string, string | number | boolean>): string {
	if (config.match) return `“${String(config.match)}”`;
	if (config.cron) return String(config.cron);
	if (config.eventKey) return String(config.eventKey);
	if (config.state) return String(config.state);
	return "ทุก event";
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
