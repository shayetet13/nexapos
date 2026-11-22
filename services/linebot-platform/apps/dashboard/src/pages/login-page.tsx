import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "../components/shared";

interface LoginPageProps {
	onLogin: (email: string, password: string) => Promise<void>;
	/** Shown once, e.g. after a session expires mid-use. */
	notice?: string;
}

export function LoginPage({ onLogin, notice }: LoginPageProps) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitting(true);
		setError("");
		try {
			await onLogin(email.trim(), password);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "เข้าสู่ระบบไม่สำเร็จ");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="login-view">
			<form className="login-card" onSubmit={submit}>
				<div className="loading-brand"><span>LS</span></div>
				<p className="eyebrow">ADMIN ONLY</p>
				<h1>เข้าสู่ระบบควบคุม</h1>
				<p>บัญชีผู้ดูแลระบบเท่านั้นที่เข้าถึงหน้านี้ได้</p>
				{notice ? <p className="form-notice" role="status">{notice}</p> : null}
				<label className="field"><span>อีเมล / ชื่อผู้ใช้</span><input type="text" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" autoFocus required /></label>
				<label className="field"><span>รหัสผ่าน</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
				{error ? <p className="form-error" role="alert">{error}</p> : null}
				<Button type="submit" variant="primary" loading={submitting} icon={<LogIn size={16} />}>เข้าสู่ระบบ</Button>
			</form>
		</div>
	);
}
