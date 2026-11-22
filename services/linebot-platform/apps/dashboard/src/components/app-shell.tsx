import {
	Activity,
	Bell,
	Bot,
	ChevronDown,
	Gauge,
	KeyRound,
	QrCode,
	Menu,
	PanelLeftClose,
	Search,
	Settings,
	SlidersHorizontal,
	UsersRound,
	Workflow,
	X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DashboardData, PageId } from "../types";
import type { ApiMode } from "../lib/api-client";
import { formatRelativeTime } from "./shared";

const navItems: Array<{ id: PageId; label: string; hint: string; icon: typeof Gauge }> = [
	{ id: "overview", label: "ภาพรวม", hint: "Overview", icon: Gauge },
	{ id: "bots", label: "บอททั้งหมด", hint: "Bot fleet", icon: Bot },
	{ id: "rules", label: "กฎการทำงาน", hint: "Rule builder", icon: Workflow },
	{ id: "queue", label: "ระบบคิว", hint: "Queue desk", icon: UsersRound },
	{ id: "payments", label: "พร้อมเพย์", hint: "Payment verification", icon: QrCode },
	{ id: "api-keys", label: "API keys", hint: "Integrations", icon: KeyRound },
	{ id: "settings", label: "ตั้งค่าระบบ", hint: "Settings", icon: Settings },
];

const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
	overview: { title: "ศูนย์ควบคุม", subtitle: "สถานะสดของ bot ทุกตัว" },
	bots: { title: "บอททั้งหมด", subtitle: "แยก process และข้อมูลต่อ bot" },
	rules: { title: "กฎการทำงาน", subtitle: "Admin กำหนด trigger และ action เอง" },
	queue: { title: "ระบบคิว", subtitle: "ติดตามและเรียกคิวแบบเรียลไทม์" },
	payments: { title: "พร้อมเพย์", subtitle: "สร้าง QR และตรวจเงินเข้าจาก LINE OA" },
	"api-keys": { title: "API keys", subtitle: "สิทธิ์เชื่อมต่อระบบภายนอก" },
	settings: { title: "ตั้งค่าระบบ", subtitle: "ความปลอดภัยและค่าเริ่มต้น" },
};

interface AppShellProps {
	children: ReactNode;
	page: PageId;
	onNavigate: (page: PageId) => void;
	mode: ApiMode;
	data: DashboardData;
	search: string;
	onSearch: (value: string) => void;
	onOpenBots: () => void;
	onEmergencyStop: () => void;
	/** Omitted when REQUIRE_AUTH is off -- there is no session to end. */
	onLogout?: () => void;
}

export function AppShell({ children, page, onNavigate, mode, data, search, onSearch, onOpenBots, onEmergencyStop, onLogout }: AppShellProps) {
	const [mobileOpen, setMobileOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const [notifOpen, setNotifOpen] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const pageTitle = pageTitles[page];

	// Standard "⌘K / Ctrl+K focuses search" shortcut -- the kbd hint next to
	// the search box was previously decorative, nothing actually listened for it.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				searchInputRef.current?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const onlinePercent = data.bots.length ? Math.round((data.bots.filter((bot) => bot.status === "online").length / data.bots.length) * 1000) / 10 : 100;
	const recentAudit = data.audit.slice(0, 8);

	const navigate = (target: PageId) => {
		onNavigate(target);
		setMobileOpen(false);
	};

	return (
		<div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
		<button className="mobile-menu" type="button" aria-label="เปิดเมนู" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
		{mobileOpen ? <button className="nav-scrim" type="button" aria-label="ปิดเมนู" onClick={() => setMobileOpen(false)} /> : null}
		<aside className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}>
			<div className="sidebar__brand">
				<div className="brand-mark"><span>LS</span></div>
				<div className="brand-copy">
					<strong>LINE SPEED</strong>
					<span>CONTROL / 01</span>
				</div>
				<button className="sidebar__mobile-close" type="button" onClick={() => setMobileOpen(false)} aria-label="ปิดเมนู"><X size={19} /></button>
			</div>

			<div className="sidebar__environment">
				<span className={`environment-dot environment-dot--${mode}`} />
				<div><strong>LOCAL CORE</strong><span>API connected</span></div>
				<ChevronDown size={14} />
			</div>

			<nav className="sidebar__nav" aria-label="เมนูหลัก">
				<p className="sidebar__label">CONTROL</p>
				{navItems.map((item) => {
					const Icon = item.icon;
					return (
						<button key={item.id} className={`nav-item ${page === item.id ? "nav-item--active" : ""}`} type="button" onClick={() => navigate(item.id)} aria-current={page === item.id ? "page" : undefined}>
							<Icon size={18} />
							<span><strong>{item.label}</strong><small>{item.hint}</small></span>
						</button>
					);
				})}
			</nav>

			<div className="sidebar__footer">
				<button className="operator" type="button" onClick={onLogout} disabled={!onLogout} title={onLogout ? "ออกจากระบบ" : undefined}>
					<span className="operator__avatar">AD</span>
					<span><strong>Administrator</strong><small>Full access</small></span>
					<SlidersHorizontal size={15} />
				</button>
				<button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}>
					<PanelLeftClose size={17} />
					<span>ย่อเมนู</span>
				</button>
			</div>
		</aside>

		<div className="workspace">
			<header className="topbar">
				<div className="topbar__heading">
					<p>{pageTitle.subtitle}</p>
					<h1>{pageTitle.title}</h1>
				</div>
				<div className="topbar__tools">
					<label className="global-search">
						<Search size={17} />
						<input ref={searchInputRef} value={search} onChange={(event) => onSearch(event.target.value)} placeholder="ค้นหา bot หรือ rule…" aria-label="ค้นหา" />
						<kbd>⌘ K</kbd>
					</label>
					<div className="topbar__notif">
						<button className={`icon-button ${recentAudit.length ? "icon-button--dot" : ""}`} type="button" aria-label="การแจ้งเตือน" aria-expanded={notifOpen} onClick={() => setNotifOpen((value) => !value)}><Bell size={19} /></button>
						{notifOpen ? <>
							<button className="dropdown-scrim" type="button" aria-label="ปิดการแจ้งเตือน" onClick={() => setNotifOpen(false)} />
							<div className="notif-dropdown" role="menu">
								<header><strong>กิจกรรมล่าสุด</strong></header>
								{recentAudit.length ? <ul>{recentAudit.map((entry) => <li key={entry.id}><span className={`notif-dot notif-dot--${entry.type}`} /><div><p>{entry.message}</p><small>{entry.actor} · {formatRelativeTime(entry.createdAt)}</small></div></li>)}</ul> : <p className="notif-empty">ยังไม่มีกิจกรรม</p>}
							</div>
						</> : null}
					</div>
					<button className="system-status" type="button" onClick={onOpenBots} title={`${data.bots.filter((bot) => bot.status === "online").length}/${data.bots.length} bot online`}><Activity size={16} /><span>ระบบทำงาน</span><strong>{onlinePercent}%</strong></button>
					<button className="emergency-mini" type="button" onClick={onEmergencyStop} title="Emergency stop">STOP</button>
				</div>
			</header>
			<main className="workspace__content">{children}</main>
		</div>
	</div>
	);
}
