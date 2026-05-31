/**
 * Email sender — Resend API (production) / Nodemailer SMTP (local fallback)
 *
 * Railway blocks outbound SMTP (port 465/587).
 * Use Resend HTTP API when RESEND_API_KEY is set; fall back to SMTP otherwise.
 */
import nodemailer from 'nodemailer';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const SMTP_USER     = process.env.SMTP_USER ?? '';
const SMTP_PASS     = process.env.SMTP_PASS ?? '';
const FROM_ADDRESS  = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'NexaPos <noreply@nexapos.io>';

/* ── Resend HTTP sender ─────────────────────────────────── */

async function sendViaResend(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(`Resend error ${res.status}: ${body.message ?? 'unknown'}`);
  }
}

/* ── Nodemailer SMTP sender (local dev) ──────────────────── */

const transporter = nodemailer.createTransport({
  host:   'smtp.hostinger.com',
  port:   587,
  secure: false,
  auth:   { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 10_000,
  greetingTimeout:   10_000,
  socketTimeout:     15_000,
});

async function sendViaSMTP(to: string, subject: string, html: string): Promise<void> {
  await transporter.sendMail({ from: FROM_ADDRESS, to, subject, html });
}

/* ── Unified send ────────────────────────────────────────── */

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (RESEND_API_KEY) {
    await sendViaResend(to, subject, html);
  } else if (SMTP_USER && SMTP_PASS) {
    await sendViaSMTP(to, subject, html);
  } else {
    console.log(`[DEV] Email to ${to}: ${subject}`);
  }
}

/* ── Public helpers ──────────────────────────────────────── */

/** ส่ง OTP สมัครสมาชิก */
export async function sendOtpEmail(to: string, otp: string, refCode: string): Promise<void> {
  const digits = otp.split('').map(d =>
    `<span style="display:inline-block;width:44px;height:56px;line-height:56px;text-align:center;
     font-size:28px;font-weight:700;border:2px solid #e2e8f0;border-radius:8px;margin:0 4px;
     background:#f8fafc;color:#1e293b;">${d}</span>`,
  ).join('');

  await sendEmail(to, `[${refCode}] รหัส OTP สมัครสมาชิก NexaPos`, `
<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#3b82f6,#6366f1);padding:32px;text-align:center;">
            <div style="font-size:32px;margin-bottom:8px;">🔐</div>
            <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700;">ยืนยันตัวตน NexaPos</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 32px;text-align:center;">
            <p style="color:#475569;font-size:15px;margin:0 0 8px;">รหัส OTP ของคุณสำหรับสมัครสมาชิก</p>
            <p style="color:#94a3b8;font-size:13px;margin:0 0 28px;">กรุณานำรหัสนี้ไปกรอกที่แท็บเล็ต/iPad ของคุณ</p>
            <div style="margin-bottom:24px;">${digits}</div>
            <div style="display:inline-block;background:#f1f5f9;border-radius:8px;padding:8px 20px;margin-bottom:28px;">
              <span style="color:#64748b;font-size:13px;">รหัสอ้างอิง&nbsp;</span>
              <span style="color:#1e293b;font-size:15px;font-weight:700;font-family:monospace;letter-spacing:2px;">${refCode}</span>
            </div>
            <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:8px;">
              <p style="color:#92400e;font-size:13px;margin:0;">⏱ รหัสนี้มีอายุ <strong>10 นาที</strong> เท่านั้น</p>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin:0;">ห้ามเปิดเผยรหัสนี้แก่ผู้อื่น</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="color:#94a3b8;font-size:12px;margin:0;">© NexaPos · support@nexapos.io</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`);
}

/** ส่ง password reset link */
export async function sendResetPasswordEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail(to, 'รีเซ็ตรหัสผ่าน NexaPos — ลิงก์หมดอายุใน 2 นาที', `
<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:32px;text-align:center;">
            <div style="font-size:32px;margin-bottom:8px;">🔑</div>
            <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700;">รีเซ็ตรหัสผ่าน NexaPos</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 32px;text-align:center;">
            <p style="color:#475569;font-size:15px;margin:0 0 8px;">มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้</p>
            <p style="color:#64748b;font-size:13px;margin:0 0 28px;">กดปุ่มด้านล่างเพื่อยืนยัน จากนั้นกลับไปตั้งรหัสผ่านใหม่ที่เครื่อง POS</p>
            <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;font-size:16px;font-weight:700;padding:14px 40px;border-radius:10px;text-decoration:none;margin-bottom:28px;">
              ✅ ยืนยันรีเซ็ตรหัสผ่าน
            </a>
            <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:8px;">
              <p style="color:#92400e;font-size:13px;margin:0;">⚠️ ลิงก์นี้มีอายุ <strong>2 นาที</strong> เท่านั้น</p>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">หากคุณไม่ได้ขอรีเซ็ต สามารถเพิกเฉยอีเมลนี้ได้</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="color:#94a3b8;font-size:12px;margin:0;">© NexaPos · support@nexapos.io</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`);
}

/** Re-export transporter for backward compatibility */
export { transporter };
