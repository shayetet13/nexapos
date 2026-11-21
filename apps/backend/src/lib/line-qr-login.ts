/**
 * LINE QR login session manager (LINEJS) — หนึ่ง session ต่อร้าน, อยู่ใน memory
 *
 * Flow: start(shopId) → qrcall (URL ให้ frontend วาด QR) → pincall (PIN ให้ผู้ใช้กดยืนยันบนมือถือ)
 *       → สำเร็จ: คืน authToken + profile ให้ caller บันทึก (เข้ารหัส) แล้ว session ถูกทิ้ง
 * ไม่เก็บ client ค้างไว้ — ลด attack surface และ memory
 */
import { loginWithQR } from '@evex-dev/linejs';
import { MemoryStorage } from '@evex-dev/linejs/storage';
import { logger } from './audit.js';

export type QrLoginState = 'idle' | 'waiting_scan' | 'waiting_pin' | 'success' | 'failed' | 'expired';

export interface QrLoginSnapshot {
  state:       QrLoginState;
  qrUrl:       string | null;
  pin:         string | null;
  error:       string | null;
  displayName: string | null;
}

export interface QrLoginResult {
  authToken:   string;
  mid:         string;
  displayName: string;
}

interface Session extends QrLoginSnapshot {
  startedAt: number;
  result:    QrLoginResult | null;
  consumed:  boolean;
}

const SESSION_TTL_MS = 3 * 60_000;
const sessions = new Map<string, Session>();

function fresh(): Session {
  return { state: 'waiting_scan', qrUrl: null, pin: null, error: null, displayName: null,
           startedAt: Date.now(), result: null, consumed: false };
}

function sweep(): void {
  const now = Date.now();
  for (const [shopId, s] of sessions) {
    if (now - s.startedAt > SESSION_TTL_MS * 2) sessions.delete(shopId);
  }
}

export const lineQrLogin = {
  /** เริ่ม session ใหม่ (ทับของเดิมของร้านเดียวกัน) — คืนทันที ไม่รอสแกน */
  start(shopId: string): void {
    sweep();
    const session = fresh();
    sessions.set(shopId, session);

    const isCurrent = () => sessions.get(shopId) === session;
    const timeout = setTimeout(() => {
      if (isCurrent() && session.state !== 'success') {
        session.state = 'expired';
        session.error = 'หมดเวลา กรุณาเริ่มสแกนใหม่';
      }
    }, SESSION_TTL_MS);
    timeout.unref();

    void loginWithQR(
      {
        onReceiveQRUrl: (url) => {
          if (!isCurrent()) return;
          session.qrUrl = url;
          session.state = 'waiting_scan';
        },
        onPincodeRequest: (pin) => {
          if (!isCurrent()) return;
          session.pin = pin;
          session.state = 'waiting_pin';
        },
      },
      { device: 'DESKTOPWIN', storage: new MemoryStorage() },
    )
      .then(async (client) => {
        clearTimeout(timeout);
        if (!isCurrent() || session.state === 'expired') return;
        const profile = await client.getMyProfile();
        session.result = {
          authToken:   client.authToken,
          mid:         profile.mid,
          displayName: profile.displayName,
        };
        session.displayName = profile.displayName;
        session.state = 'success';
      })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        logger.warn({ err, shopId }, '[line-qr-login] failed');
        if (!isCurrent()) return;
        session.state = 'failed';
        session.error = 'เข้าสู่ระบบ LINE ไม่สำเร็จ กรุณาลองใหม่';
      });
  },

  snapshot(shopId: string): QrLoginSnapshot {
    const s = sessions.get(shopId);
    if (!s) return { state: 'idle', qrUrl: null, pin: null, error: null, displayName: null };
    return { state: s.state, qrUrl: s.qrUrl, pin: s.pin, error: s.error, displayName: s.displayName };
  },

  /** ดึงผลสำเร็จได้ครั้งเดียว แล้วลบ session (authToken ไม่ค้างใน memory) */
  consume(shopId: string): QrLoginResult | null {
    const s = sessions.get(shopId);
    if (!s || s.state !== 'success' || !s.result || s.consumed) return null;
    s.consumed = true;
    const { result } = s;
    sessions.delete(shopId);
    return result;
  },

  cancel(shopId: string): void {
    sessions.delete(shopId);
  },
};
