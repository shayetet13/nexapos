import {
	AlertTriangle,
	Bot,
	Check,
	LoaderCircle,
	RefreshCw,
	X,
} from "lucide-react";
import {
	Component,
	useEffect,
	type ButtonHTMLAttributes,
	type CSSProperties,
	type ErrorInfo,
	type ReactNode,
} from "react";
import type { BotStatus } from "../types";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	loading?: boolean;
	icon?: ReactNode;
}

export function Button({
	variant = "secondary",
	loading = false,
	icon,
	children,
	className = "",
	disabled,
	...props
}: ButtonProps) {
	return (
		<button
			className={`button button--${variant} ${className}`}
			disabled={disabled || loading}
			{...props}
		>
			{loading ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : icon}
			{children}
		</button>
	);
}

export function BotAvatar({ name, accent, size = "md" }: { name: string; accent: string; size?: "sm" | "md" | "lg" }) {
	return (
		<div
			className={`bot-avatar bot-avatar--${size}`}
			style={{ "--bot-accent": accent } as CSSProperties}
			role="img"
			aria-label={`Bot ${name}`}
		>
			<Bot size={size === "lg" ? 24 : size === "sm" ? 15 : 18} />
		</div>
	);
}

const statusLabels: Record<BotStatus, string> = {
	online: "ออนไลน์",
	starting: "กำลังเริ่ม",
	paused: "พักอยู่",
	stopping: "กำลังหยุด",
	stopped: "หยุดแล้ว",
	degraded: "ช้ากว่าปกติ",
	error: "เกิดข้อผิดพลาด",
	auth_required: "รอยืนยันตัวตน",
};

export function StatusBadge({ status, compact = false }: { status: BotStatus; compact?: boolean }) {
	return (
		<span className={`status-badge status-badge--${status}`}>
			<span className="status-badge__dot" />
			{compact ? null : statusLabels[status]}
		</span>
	);
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
	return (
		<label className={`toggle ${disabled ? "toggle--disabled" : ""}`}>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span className="toggle__track" aria-hidden="true"><span className="toggle__thumb" /></span>
			<span className="sr-only">{label}</span>
		</label>
	);
}

interface ModalProps {
	open: boolean;
	title: string;
	description?: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
	size?: "sm" | "md" | "lg" | "xl";
	danger?: boolean;
}

export function Modal({ open, title, description, onClose, children, footer, size = "md", danger = false }: ModalProps) {
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		document.body.classList.add("modal-open");
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.body.classList.remove("modal-open");
		};
	}, [open, onClose]);

	if (!open) return null;
	return (
		<div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
			<section className={`modal modal--${size} ${danger ? "modal--danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
				<header className="modal__header">
					<div>
						<p className="eyebrow">{danger ? "ต้องยืนยัน" : "ตั้งค่า"}</p>
						<h2 id="modal-title">{title}</h2>
						{description ? <p>{description}</p> : null}
					</div>
					<button className="icon-button" type="button" onClick={onClose} aria-label="ปิดหน้าต่าง">
						<X size={19} />
					</button>
				</header>
				<div className="modal__body">{children}</div>
				{footer ? <footer className="modal__footer">{footer}</footer> : null}
			</section>
		</div>
	);
}

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
	return (
		<div className="section-header">
			<div>
				{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
				<h2>{title}</h2>
				{description ? <p>{description}</p> : null}
			</div>
			{action ? <div className="section-header__action">{action}</div> : null}
		</div>
	);
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
	return (
		<div className="empty-state">
			<div className="empty-state__icon"><Bot size={22} /></div>
			<h3>{title}</h3>
			<p>{description}</p>
			{action}
		</div>
	);
}

export function LoadingView() {
	return (
		<div className="loading-view" aria-live="polite" aria-busy="true">
			<div className="loading-brand"><span>LS</span></div>
			<p>กำลังเชื่อมต่อศูนย์ควบคุม</p>
			<div className="loading-line"><span /></div>
		</div>
	);
}

interface ErrorBoundaryProps {
	children: ReactNode;
	/** Short label for what crashed, shown in the fallback (e.g. a bot name). */
	scope?: string;
	/** When this changes, a tripped boundary resets so the next render gets a fresh try. */
	resetKey?: unknown;
	/**
	 * Use inside a modal or other bounded container. Without this the fallback
	 * inherits .error-view's `min-height: 100vh` (correct for the app-root
	 * boundary in main.tsx, but inside a modal it pushes the actual message
	 * off-screen -- the fallback renders, it's just scrolled out of view,
	 * which looked identical to the blank-panel bug this boundary exists to
	 * catch in the first place).
	 */
	compact?: boolean;
}

interface ErrorBoundaryState {
	error?: Error;
}

/**
 * Catches render-time exceptions that would otherwise unmount the whole tree
 * and leave the screen blank with nothing in the UI to explain why -- the
 * failure mode reported against the bot settings modal. React only offers
 * this as a class component API; there is no hooks equivalent.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = {};

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		// eslint-disable-next-line no-console
		console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ""}]`, error, info.componentStack);
	}

	componentDidUpdate(prevProps: ErrorBoundaryProps): void {
		if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
			this.setState({ error: undefined });
		}
	}

	render(): ReactNode {
		if (this.state.error) {
			return (
				<div className={`error-view${this.props.compact ? " error-view--compact" : ""}`} role="alert">
					<div className="error-view__icon"><AlertTriangle size={25} /></div>
					<p className="eyebrow">Render error</p>
					<h1>{this.props.scope ? `${this.props.scope} แสดงผลไม่ได้` : "หน้านี้แสดงผลไม่ได้"}</h1>
					<p>{this.state.error.message || "เกิดข้อผิดพลาดที่ไม่คาดคิดระหว่างแสดงผล"}</p>
					<Button variant="primary" onClick={() => window.location.reload()} icon={<RefreshCw size={16} />}>โหลดหน้าใหม่</Button>
				</div>
			);
		}
		return this.props.children;
	}
}

export function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="error-view" role="alert">
			<div className="error-view__icon"><AlertTriangle size={25} /></div>
			<p className="eyebrow">Connection error</p>
			<h1>เชื่อมต่อศูนย์ควบคุมไม่ได้</h1>
			<p>{message}</p>
			<Button variant="primary" onClick={onRetry} icon={<RefreshCw size={16} />}>ลองอีกครั้ง</Button>
		</div>
	);
}

export function Toast({ message, tone, onClose }: { message: string; tone: "success" | "error"; onClose: () => void }) {
	useEffect(() => {
		const timeout = window.setTimeout(onClose, 3_600);
		return () => window.clearTimeout(timeout);
	}, [onClose]);
	return (
		<div className={`toast toast--${tone}`} role="status">
		{tone === "success" ? <Check size={17} /> : <AlertTriangle size={17} />}
		<span>{message}</span>
		<button type="button" onClick={onClose} aria-label="ปิดข้อความ"><X size={15} /></button>
		</div>
	);
}

export function formatRelativeTime(value: string): string {
	const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000));
	if (seconds < 10) return "เมื่อสักครู่";
	if (seconds < 60) return `${seconds} วินาทีที่แล้ว`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
	return `${Math.floor(hours / 24)} วันที่แล้ว`;
}

export function formatUptime(seconds: number): string {
	if (!seconds) return "—";
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	return days > 0 ? `${days}วัน ${hours}ชม.` : `${hours}ชม.`;
}
