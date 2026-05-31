'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthHeader } from '@/components/layout/AuthHeader';
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

const TYPE_ICON: Record<string, string> = {
  birthday:         '🎂',
  low_stock:        '📦',
  renewal_reminder: '⏰',
  payment_due:      '💳',
  custom:           '📢',
};

const TYPE_LABEL: Record<string, string> = {
  birthday:         'วันเกิดลูกค้า',
  low_stock:        'สินค้าคงคลังต่ำ',
  renewal_reminder: 'แจ้งเตือนต่ออายุ',
  payment_due:      'ค่าบริการค้างชำระ',
  custom:           'แจ้งเตือนทั่วไป',
};

/** URL ปลายทางสำหรับแต่ละประเภท */
function getActionUrl(n: ShopNotification, shopId: string): { label: string; url: string } | null {
  switch (n.type) {
    case 'low_stock':
      return {
        label: 'ดูสต๊อกสินค้า',
        url: n.product_id
          ? `/stock?shopId=${shopId}&highlight=${n.product_id}`
          : `/stock?shopId=${shopId}`,
      };
    case 'birthday':
      return {
        label: 'ดูรายชื่อสมาชิก',
        url: `/admin?tab=members${n.customer_id ? `&highlight=${n.customer_id}` : ''}`,
      };
    case 'renewal_reminder':
    case 'payment_due':
      return { label: 'ต่ออายุ / Subscription', url: `/subscription?shopId=${shopId}` };
    default:
      return null;
  }
}

/** แสดงวันที่เวลา ภาษาไทย เขตเวลา Bangkok พร้อมปี พ.ศ. เสมอ */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone:  'Asia/Bangkok',
    day:       '2-digit',
    month:     'long',
    year:      'numeric',
    hour:      '2-digit',
    minute:    '2-digit',
  });
}

// ─── inner component ─────────────────────────────────────────────────────────
function NotificationsContent() {
  const router    = useRouter();
  const params    = useSearchParams();
  const shopIdQs  = params.get('shopId');

  const [shopId,        setShopId]        = useState<string | null>(shopIdQs);
  const [notifications, setNotifications] = useState<ShopNotification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [markingAll,    setMarkingAll]    = useState(false);

  useEffect(() => {
    if (shopIdQs) { setShopId(shopIdQs); return; }
    fetchWithAuth(`${API_URL}/api/v1/me/shops`).then(async (res) => {
      if (!res.ok) return;
      const json = await res.json();
      const shops = (json.data ?? []) as { id: string }[];
      if (shops[0]) setShopId(shops[0].id);
    });
  }, [shopIdQs]);

  const fetchNotifications = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/notifications`);
    if (res.ok) {
      const json = await res.json();
      setNotifications(json.data ?? []);
    }
    setLoading(false);
  }, [shopId]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  async function markRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n),
    );
    await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/notifications/${id}/read`, {
      method: 'PATCH',
    });
  }

  async function markAllRead() {
    setMarkingAll(true);
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    );
    await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/notifications/read-all`, {
      method: 'PATCH',
    });
    setMarkingAll(false);
  }

  async function handleAction(n: ShopNotification, url: string) {
    if (!n.read_at) await markRead(n.id);
    router.push(url);
  }

  const unread = notifications.filter((n) => !n.read_at);
  const read   = notifications.filter((n) =>  n.read_at);

  return (
    <main className="notif-page">
      {/* ── Toolbar ── */}
      <div className="notif-page__toolbar">
        <h2 className="notif-page__heading">
          🔔 การแจ้งเตือน
          {unread.length > 0 && (
            <span className="notif-page__unread-count">{unread.length}</span>
          )}
        </h2>
        {unread.length > 0 && (
          <button
            className="notif-page__mark-all"
            onClick={markAllRead}
            disabled={markingAll}
          >
            {markingAll ? 'กำลังอัปเดต…' : '✓ อ่านทั้งหมด'}
          </button>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="notif-page__empty">
          <span className="notif-page__spinner" />
          กำลังโหลด…
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && notifications.length === 0 && (
        <div className="notif-page__empty">
          <span style={{ fontSize: '2.5rem' }}>🎉</span>
          ไม่มีการแจ้งเตือน
        </div>
      )}

      {/* ── Unread section ── */}
      {!loading && unread.length > 0 && (
        <section>
          <p className="notif-page__section-label">ยังไม่อ่าน ({unread.length})</p>
          <div className="notif-page__list">
            {unread.map((n) => (
              <NotifCard
                key={n.id}
                n={n}
                shopId={shopId!}
                onMarkRead={markRead}
                onAction={handleAction}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Read section ── */}
      {!loading && read.length > 0 && (
        <section style={{ marginTop: unread.length > 0 ? '1.5rem' : '0' }}>
          {unread.length > 0 && (
            <p className="notif-page__section-label" style={{ color: 'var(--color-text-subtle)' }}>
              อ่านแล้ว ({read.length})
            </p>
          )}
          <div className="notif-page__list">
            {read.map((n) => (
              <NotifCard
                key={n.id}
                n={n}
                shopId={shopId!}
                onMarkRead={markRead}
                onAction={handleAction}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

// ─── notification card (ไม่มีปุ่มลบ) ────────────────────────────────────────
interface NotifCardProps {
  n:          ShopNotification;
  shopId:     string;
  onMarkRead: (id: string) => void;
  onAction:   (n: ShopNotification, url: string) => void;
}

function NotifCard({ n, shopId, onMarkRead, onAction }: NotifCardProps) {
  const action = getActionUrl(n, shopId);

  return (
    <div className={`notif-card${n.read_at ? '' : ' notif-card--unread'}`}>
      {/* icon */}
      <div className="notif-card__icon">{TYPE_ICON[n.type] ?? '📢'}</div>

      {/* body */}
      <div className="notif-card__body">
        <div className="notif-card__meta">
          <span className="notif-card__type-badge">{TYPE_LABEL[n.type] ?? n.type}</span>
          {!n.read_at && <span className="notif-card__new-badge">ใหม่</span>}
        </div>
        <p className="notif-card__title">{n.title.replace(/\s*__sub_[^\s]+/g, '').trim()}</p>
        {n.message && <p className="notif-card__msg">{n.message}</p>}
        <p className="notif-card__time">{fmtDate(n.created_at)}</p>
      </div>

      {/* actions */}
      <div className="notif-card__actions">
        {action && (
          <button
            className="notif-card__action-btn notif-card__action-btn--primary"
            onClick={() => onAction(n, action.url)}
          >
            {action.label} →
          </button>
        )}
        {!n.read_at && (
          <button
            className="notif-card__action-btn"
            onClick={() => onMarkRead(n.id)}
          >
            ✓ อ่านแล้ว
          </button>
        )}
      </div>
    </div>
  );
}

// ─── page export ─────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  return (
    <>
      <AuthHeader title="การแจ้งเตือน" backToPOS backLabel="← กลับ POS" />
      <Suspense fallback={<div className="notif-page__empty">กำลังโหลด…</div>}>
        <NotificationsContent />
      </Suspense>
    </>
  );
}
