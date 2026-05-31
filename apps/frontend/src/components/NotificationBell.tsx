'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

interface ShopNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read_at: string | null;
  created_at: string;
  customer_id: string | null;
  product_id: string | null;
}

interface NotificationBellProps {
  shopId: string;
}

const TYPE_ICON: Record<string, string> = {
  birthday:         '🎂',
  low_stock:        '📦',
  renewal_reminder: '⏰',
  payment_due:      '💳',
  custom:           '📢',
};

/** key สำหรับ localStorage ต่อ shopId */
function dismissedKey(shopId: string) {
  return `bell_dismissed_${shopId}`;
}

/** โหลด dismissed IDs จาก localStorage */
function loadDismissed(shopId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedKey(shopId));
    return raw ? new Set<string>(JSON.parse(raw) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

/** บันทึก dismissed IDs ลง localStorage */
function saveDismissed(shopId: string, ids: Set<string>) {
  try {
    localStorage.setItem(dismissedKey(shopId), JSON.stringify([...ids]));
  } catch { /* quota exceeded — ignore */ }
}

/** แสดงวันที่-เวลา ภาษาไทย เขตเวลา Bangkok */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day:      '2-digit',
    month:    'short',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
  });
}

export function NotificationBell({ shopId }: NotificationBellProps) {
  const router  = useRouter();
  const [allNotifications, setAllNotifications] = useState<ShopNotification[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // โหลด dismissed จาก localStorage เมื่อ shopId เปลี่ยน
  useEffect(() => {
    setDismissed(loadDismissed(shopId));
  }, [shopId]);

  // กรองรายการที่ถูก dismiss ออก
  const notifications = allNotifications.filter((n) => !dismissed.has(n.id));
  const unread = notifications.filter((n) => !n.read_at).length;

  const fetchNotifications = useCallback(async () => {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/notifications`);
    if (!res.ok) return;
    const json = await res.json() as { data?: ShopNotification[] };
    setAllNotifications(json.data ?? []);
  }, [shopId]);

  useEffect(() => {
    fetchNotifications();
    pollRef.current = setInterval(fetchNotifications, 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchNotifications]);

  // ปิด panel เมื่อคลิกนอก
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function markRead(id: string) {
    setAllNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n),
    );
    await fetchWithAuth(
      `${API_URL}/api/v1/shops/${shopId}/notifications/${id}/read`,
      { method: 'PATCH' },
    );
  }

  /** ซ่อนจาก bell และจำไว้ใน localStorage ข้ามรีเฟรช */
  function dismissFromBell(id: string) {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    saveDismissed(shopId, next);
  }

  async function markAllRead() {
    setLoading(true);
    setAllNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    );
    await fetchWithAuth(
      `${API_URL}/api/v1/shops/${shopId}/notifications/read-all`,
      { method: 'PATCH' },
    );
    setLoading(false);
  }

  async function handleItemClick(n: ShopNotification) {
    if (!n.read_at) await markRead(n.id);
    setOpen(false);
  }

  function goToNotifications() {
    setOpen(false);
    router.push(`/admin?tab=notifications&shopId=${shopId}`);
  }

  return (
    <div className="notif-bell" ref={panelRef}>
      <button
        className="notif-bell__btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`การแจ้งเตือน${unread > 0 ? ` (${unread} ใหม่)` : ''}`}
        title="การแจ้งเตือน"
      >
        🔔
        {unread > 0 && (
          <span className="notif-bell__badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="notif-bell__panel">
          {/* ── header ── */}
          <div className="notif-bell__head">
            <span className="notif-bell__head-title">การแจ้งเตือน</span>
            {unread > 0 && (
              <button
                className="notif-bell__read-all"
                onClick={markAllRead}
                disabled={loading}
              >
                อ่านทั้งหมด
              </button>
            )}
          </div>

          {/* ── list ── */}
          <div className="notif-bell__body">
            {notifications.length === 0 ? (
              <div className="notif-bell__empty">ไม่มีการแจ้งเตือน</div>
            ) : (
              <ul className="notif-bell__list">
                {notifications.slice(0, 5).map((n) => (
                  <li
                    key={n.id}
                    className={[
                      'notif-bell__item',
                      n.read_at ? '' : 'notif-bell__item--unread',
                      'notif-bell__item--clickable',
                    ].join(' ').trim()}
                    onClick={() => handleItemClick(n)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && void handleItemClick(n)}
                  >
                    <span className="notif-bell__item-icon">
                      {TYPE_ICON[n.type] ?? '📢'}
                    </span>
                    <div className="notif-bell__item-body">
                      <p className="notif-bell__item-title">
                        {n.title.replace(/\s*__sub_[^\s]+/g, '').trim()}
                      </p>
                      {n.message && (
                        <p className="notif-bell__item-msg">{n.message}</p>
                      )}
                      <p className="notif-bell__item-time">{fmtTime(n.created_at)}</p>
                    </div>
                    <div className="notif-bell__item-right">
                      {!n.read_at && <span className="notif-bell__item-dot" aria-hidden />}
                      <button
                        className="notif-bell__item-delete"
                        onClick={(e) => { e.stopPropagation(); dismissFromBell(n.id); }}
                        title="ซ่อนออกจากกระดิ่ง"
                        aria-label="ซ่อนออกจากกระดิ่ง"
                      >✕</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── footer ── */}
          <button className="notif-bell__view-all" onClick={goToNotifications}>
            ดูการแจ้งเตือนทั้งหมด →
          </button>
        </div>
      )}
    </div>
  );
}
