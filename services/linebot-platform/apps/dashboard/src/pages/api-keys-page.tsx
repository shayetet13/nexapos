import {
	Ban,
	Check,
	Clipboard,
	Clock3,
	Code2,
	Copy,
	Eye,
	EyeOff,
	KeyRound,
	LockKeyhole,
	Pause,
	Play,
	Plus,
	ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, formatRelativeTime, Modal } from "../components/shared";
import type { ApiKeyRecord, CreatedApiKey, DashboardData } from "../types";

interface ApiKeysPageProps {
	data: DashboardData;
	onCreate: (name: string, scopes: string[]) => Promise<CreatedApiKey>;
	onRevoke: (key: ApiKeyRecord) => Promise<void>;
	onSetPaused: (key: ApiKeyRecord, paused: boolean) => Promise<void>;
}

const EVENT_EXAMPLE = `curl -X POST /v1/bots/bot_id/events/order.created \\
  -H "Authorization: Bearer lbk_••••" \\
  -H "Idempotency-Key: evt_123"`;

const PROMPTPAY_EXAMPLE = `// ต้อง key ที่มี scope promptpay:write
const res = await fetch("https://your-api-host/v1/promptpay/payments", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + PROMPTPAY_API_KEY, // lbk_...
  },
  body: JSON.stringify({
    botId: "bot_xxx",               // จาก /v1/bots
    sourceTargetId: "target_xxx",   // target ของแชท LINE OA ธนาคาร (Targets tab)
    promptPayIdType: "phone",       // "phone" | "national_id" | "ewallet"
    promptPayId: "0812345678",
    amount: "100.00",               // string, หน่วยบาท
    expiresInSeconds: 120,          // ไม่บังคับ, 30-600, ค่าเริ่มต้น 120
  }),
});
const { data: payment } = await res.json();
// payment.id, payment.qrPayload (เอาไปวาด QR)
// payment.status === "pending" พร้อมให้จ่ายทันที, หรือ "queued" ถ้ามีคนอื่นกำลังรอ
// เงินเข้ายอด+ปลายทางเดียวกันอยู่ก่อน (อย่าวาด QR ตอน queued -- ยังจ่ายไม่ได้จริง)

// ต้อง key ที่มี scope promptpay:read -- poll จนกว่า status จะนิ่ง
const check = await fetch(\`https://your-api-host/v1/promptpay/payments/\${payment.id}\`, {
  headers: { "Authorization": "Bearer " + PROMPTPAY_API_KEY },
});
const { data: latest } = await check.json();
// latest.status: "queued" | "pending" | "succeeded" | "ambiguous" | "expired" | "cancelled"
// "queued" -> "pending" เกิดอัตโนมัติเมื่อถึงคิว (qrPayload เดิมใช้ได้ทันที ไม่ต้องขอใหม่)
// สำเร็จแล้วจะมี: latest.bank, latest.payerName, latest.transactionAt, latest.destinationLast4`;

interface FieldRef {
	name: string;
	required: boolean;
	type: string;
	hint: string;
}

const PROMPTPAY_REQUEST_FIELDS: FieldRef[] = [
	{ name: "botId", required: true, type: "string", hint: "ID ของ LINEJS bot (จาก GET /v1/bots)" },
	{ name: "sourceTargetId", required: true, type: "string", hint: "ID ของแชท LINE OA ธนาคารที่เปิด allowlist ไว้แล้ว" },
	{ name: "promptPayIdType", required: true, type: '"phone" | "national_id" | "ewallet"', hint: "ประเภทหมายเลขพร้อมเพย์" },
	{ name: "promptPayId", required: true, type: "string", hint: "หมายเลขพร้อมเพย์ตามประเภทที่เลือก" },
	{ name: "amount", required: true, type: "string", hint: 'จำนวนเงินหน่วยบาท เช่น "100.00" (ทศนิยมไม่เกิน 2 ตำแหน่ง)' },
	{ name: "destinationLast4", required: false, type: "string", hint: "เลขบัญชีปลายทาง 4 หลักท้าย ช่วยกันจับคู่ผิดเมื่อมีหลายบัญชี" },
	{ name: "expiresInSeconds", required: false, type: "number", hint: "อายุ QR วินาที (30-600, ค่าเริ่มต้น 120)" },
];

const PROMPTPAY_RESPONSE_FIELDS: FieldRef[] = [
	{ name: "id", required: true, type: "string", hint: 'ใช้ poll ที่ GET /v1/promptpay/payments/:id' },
	{ name: "status", required: true, type: '"queued" | "pending" | "succeeded" | "ambiguous" | "expired" | "cancelled"', hint: "สถานะรายการ — สำเร็จจริงต้องเป็น succeeded เท่านั้น. \"queued\" คือรอคิวเพราะมีคนอื่นรอเงินเข้ายอด+ปลายทางเดียวกันอยู่ก่อน (qrPayload ยังใช้จ่ายไม่ได้จนกว่าจะเป็น pending)" },
	{ name: "qrPayload", required: true, type: "string", hint: "ข้อมูล Thai QR Payment เอาไปวาดเป็น QR code (เช่นด้วย qrcode.react)" },
	{ name: "amountSatang", required: true, type: "number", hint: "จำนวนเงินหน่วยสตางค์ (หาร 100 เพื่อได้บาท)" },
	{ name: "bank", required: false, type: '"kbank" | "ktb" | "scb" | null', hint: "ธนาคารที่ตรวจพบ มีค่าเมื่อ succeeded" },
	{ name: "payerName", required: false, type: "string | null", hint: "ชื่อผู้โอน — KTB/SCB บางรายการมี, KBank ไม่มีข้อมูลนี้ในการ์ดเลย" },
	{ name: "transactionAt", required: false, type: "string | null", hint: "เวลาที่ธนาคารแจ้ง (ISO datetime), ไม่ใช่เวลาที่ระบบตรวจพบ" },
	{ name: "verificationIssue", required: false, type: '"empty_text" | "unsupported_bank_message" | "kbank_amount_hidden" | null', hint: "เหตุผลที่ยังตรวจไม่ผ่านระหว่างรอ (ถ้ามี)" },
];

const scopes = [
	{ id: "bots:read", title: "อ่านสถานะ bot", hint: "ดู bot, status และ health" },
	{ id: "metrics:read", title: "อ่าน metrics", hint: "ดู latency, load และ first response" },
	{ id: "messages:send", title: "ส่งข้อความ", hint: "สั่ง bot ส่งข้อความไป target ที่อนุญาต" },
	{ id: "events:trigger", title: "เรียก custom event", hint: "เปิดใช้ external trigger ใน rules" },
	{ id: "bots:control", title: "ควบคุม bot", hint: "Start, pause, resume และ stop" },
	{ id: "promptpay:read", title: "อ่านสถานะพร้อมเพย์", hint: "ดูรายการ/สถานะ QR ว่า pending, succeeded หรือ expired" },
	{ id: "promptpay:write", title: "สร้าง/ยกเลิก QR พร้อมเพย์", hint: "สร้าง QR ใหม่และยกเลิกรายการที่ค้างอยู่" },
];

export function ApiKeysPage({ data, onCreate, onRevoke, onSetPaused }: ApiKeysPageProps) {
	const [createOpen, setCreateOpen] = useState(false);
	const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null);
	const [secret, setSecret] = useState("");
	const [revokeBusy, setRevokeBusy] = useState(false);
	const [pauseBusyId, setPauseBusyId] = useState<string>();

	// Banned keys are permanently dead -- showing them under "active" is exactly
	// the bug being fixed here. Paused ones stay listed (reversible) with their
	// own badge and a Start button instead of Pause.
	const visibleKeys = data.apiKeys.filter((key) => !key.revokedAt);

	const revoke = async () => {
		if (!revokeTarget) return;
		setRevokeBusy(true);
		try { await onRevoke(revokeTarget); setRevokeTarget(null); } finally { setRevokeBusy(false); }
	};

	const togglePause = async (key: ApiKeyRecord) => {
		setPauseBusyId(key.id);
		try { await onSetPaused(key, !key.pausedAt); } finally { setPauseBusyId(undefined); }
	};

	return (
		<div className="page-stack api-page">
			<section className="page-intro">
				<div><p className="eyebrow">SCOPED ACCESS</p><h2>เชื่อมระบบภายนอกอย่างปลอดภัย</h2><p>แต่ละ key เลือกสิทธิ์ได้ แสดง secret เพียงครั้งเดียว พักหรือแบนได้ทันที</p></div>
				<Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus size={17} />}>สร้าง API key</Button>
			</section>

			<section className="api-security-strip">
				<span><ShieldCheck size={20} /></span>
				<div><strong>Keys ถูก hash ก่อนจัดเก็บ</strong><p>Dashboard จะแสดงเฉพาะ prefix หลังออกจากหน้าสร้าง key</p></div>
				<div className="security-mini"><span><LockKeyhole size={14} />Scoped permissions</span><span><Clock3 size={14} />Audit ทุกการใช้งาน</span></div>
			</section>

			<section className="panel api-key-panel">
				<div className="panel__header"><div><p className="eyebrow">ACTIVE CREDENTIALS</p><h2>API keys</h2></div><span className="queue-count">{visibleKeys.length} active</span></div>
				{visibleKeys.length ? <div className="key-list">{visibleKeys.map((key) => <article className={`key-row${key.pausedAt ? " key-row--paused" : ""}`} key={key.id}><span className="key-row__icon"><KeyRound size={19} /></span><div className="key-row__identity"><strong>{key.name}</strong><code>{key.prefix}••••••••••••</code>{key.pausedAt ? <span className="key-row__badge">พักชั่วคราว</span> : null}</div><div className="scope-list">{key.scopes.slice(0, 3).map((scope) => <span key={scope}>{scope}</span>)}{key.scopes.length > 3 ? <span>+{key.scopes.length - 3}</span> : null}</div><div className="key-row__usage"><span>ใช้ล่าสุด</span><strong>{key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : "ยังไม่เคยใช้"}</strong></div><button className="ghost-icon" type="button" disabled={pauseBusyId === key.id} onClick={() => void togglePause(key)} aria-label={key.pausedAt ? `เริ่มใช้งาน ${key.name}` : `พัก ${key.name} ชั่วคราว`}>{key.pausedAt ? <Play size={16} /> : <Pause size={16} />}</button><button className="danger-icon" type="button" onClick={() => setRevokeTarget(key)} aria-label={`แบน ${key.name}`}><Ban size={16} /></button></article>)}</div> : <div className="empty-inline"><KeyRound size={20} /><span><strong>ยังไม่มี API key</strong><small>สร้าง key เพื่อเชื่อม dashboard กับระบบอื่น</small></span></div>}
			</section>

			<section className="api-doc-card">
				<div><span><Code2 size={22} /></span><div><p className="eyebrow">QUICK START</p><h3>ส่ง event เข้า rule ผ่าน API</h3><p>ใช้ API key ใน Authorization header และส่ง payload เป็น JSON</p></div></div>
				<pre><code><span>curl</span> -X POST /v1/bots/bot_id/events/order.created \{`\n`}  -H <em>"Authorization: Bearer lbk_••••"</em> \{`\n`}  -H "Idempotency-Key: evt_123"</code></pre>
				<CopyButton text={EVENT_EXAMPLE} />
			</section>

			<section className="api-doc-card api-doc-card--tall">
				<div><span><Code2 size={22} /></span><div><p className="eyebrow">QUICK START</p><h3>สร้าง QR พร้อมเพย์จากเว็บภายนอก</h3><p>ต้อง key ที่มี scope <code>promptpay:write</code> (สร้าง/ยกเลิก) และ/หรือ <code>promptpay:read</code> (เช็คสถานะ)</p></div></div>
				<pre><code>{PROMPTPAY_EXAMPLE}</code></pre>
				<CopyButton text={PROMPTPAY_EXAMPLE} />
			</section>

			<section className="panel field-ref-panel">
				<div className="panel__header"><div><p className="eyebrow">FIELD REFERENCE</p><h2>ตัวแปรที่ใช้กับ /v1/promptpay/payments</h2></div></div>
				<div className="field-ref-group">
					<p className="field-ref-group__title">ส่งไป (request body)</p>
					<div className="field-ref-list">{PROMPTPAY_REQUEST_FIELDS.map((field) => <FieldRow key={field.name} field={field} />)}</div>
				</div>
				<div className="field-ref-group">
					<p className="field-ref-group__title">ได้กลับมา (response — เฉพาะฟิลด์ที่ควรใช้ตัดสินใจ)</p>
					<div className="field-ref-list">{PROMPTPAY_RESPONSE_FIELDS.map((field) => <FieldRow key={field.name} field={field} />)}</div>
				</div>
			</section>

			<CreateKeyModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={async (name, selectedScopes) => { const result = await onCreate(name, selectedScopes); setCreateOpen(false); setSecret(result.secret); }} />
			<SecretModal secret={secret} onClose={() => setSecret("")} />
			<Modal open={Boolean(revokeTarget)} onClose={() => setRevokeTarget(null)} title="แบน API key?" description={`ระบบที่ใช้ “${revokeTarget?.name ?? ""}” จะเรียก API ไม่ได้ทันที`} danger size="sm" footer={<><Button variant="ghost" onClick={() => setRevokeTarget(null)}>ยกเลิก</Button><Button variant="danger" loading={revokeBusy} onClick={() => void revoke()} icon={<Ban size={16} />}>แบน</Button></>}><p className="danger-copy">การดำเนินการนี้ย้อนกลับไม่ได้ หากยังต้องใช้งานต้องสร้าง key ใหม่ (ต้องการปิดใช้งานชั่วคราวแทน ให้ใช้ปุ่มพักที่แถวรายการ)</p></Modal>
		</div>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 1800);
	};
	return <Button onClick={() => void copy()} icon={copied ? <Check size={15} /> : <Clipboard size={15} />}>{copied ? "คัดลอกแล้ว" : "คัดลอกตัวอย่าง"}</Button>;
}

function FieldRow({ field }: { field: FieldRef }) {
	return (
		<div className="field-ref-row">
			<code>{field.name}</code>
			<span className={`field-tag ${field.required ? "field-tag--required" : "field-tag--optional"}`}>{field.required ? "required" : "optional"}</span>
			<small><em>{field.type}</em> — {field.hint}</small>
		</div>
	);
}

function CreateKeyModal({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string, scopes: string[]) => Promise<void> }) {
	const [name, setName] = useState("");
	const [selected, setSelected] = useState<string[]>(["bots:read"]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const toggle = (scope: string) => setSelected((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) return setError("กรุณาตั้งชื่อ key");
		if (!selected.length) return setError("เลือกอย่างน้อย 1 scope");
		setSaving(true);
		setError("");
		try { await onCreate(name.trim(), selected); setName(""); setSelected(["bots:read"]); }
		catch (caught) { setError(caught instanceof Error ? caught.message : "สร้าง key ไม่สำเร็จ"); }
		finally { setSaving(false); }
	};
	return <Modal open={open} onClose={onClose} title="สร้าง API key" description="ให้สิทธิ์เท่าที่ระบบปลายทางจำเป็นต้องใช้" size="md"><form className="form-stack" onSubmit={submit}><label className="field"><span>ชื่อ key <b>*</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น Order service production" autoFocus /></label><fieldset className="scope-picker"><legend>Scopes</legend>{scopes.map((scope) => <label key={scope.id} className={selected.includes(scope.id) ? "is-selected" : ""}><input type="checkbox" checked={selected.includes(scope.id)} onChange={() => toggle(scope.id)} /><span className="scope-check">{selected.includes(scope.id) ? <Check size={14} /> : null}</span><span><strong>{scope.title}</strong><small>{scope.hint}</small></span><code>{scope.id}</code></label>)}</fieldset>{error ? <p className="form-error">{error}</p> : null}<div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>ยกเลิก</Button><Button type="submit" variant="primary" loading={saving} icon={<KeyRound size={16} />}>สร้าง key</Button></div></form></Modal>;
}

function SecretModal({ secret, onClose }: { secret: string; onClose: () => void }) {
	const [visible, setVisible] = useState(true);
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await navigator.clipboard.writeText(secret);
		setCopied(true);
	};
	return <Modal open={Boolean(secret)} onClose={onClose} title="บันทึก secret ตอนนี้" description="หลังปิดหน้าต่างนี้จะไม่สามารถดูค่าเดิมได้อีก" size="md"><div className="secret-box"><div><code>{visible ? secret : secret.replace(/./g, "•")}</code><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "ซ่อน secret" : "แสดง secret"}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><Button onClick={() => void copy()} icon={copied ? <Check size={15} /> : <Copy size={15} />}>{copied ? "คัดลอกแล้ว" : "คัดลอก"}</Button></div><p className="secret-warning">อย่าใส่ key ใน frontend code, Git หรือ log ใช้ environment secret ของระบบปลายทางเท่านั้น</p><div className="form-actions"><Button variant="primary" onClick={onClose}>ฉันบันทึกแล้ว</Button></div></Modal>;
}
