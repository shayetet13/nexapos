'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

interface ShopNotification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationsTabProps {
  shopId: string;
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day:      '2-digit',
    month:    'long',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
  });
}

function stripSubKey(title: string): string {
  return title.replace(/\s*__sub_[^\s]+/g, '').trim();
}

const PAGE_SIZE = 10;

export function NotificationsTab({ shopId }: NotificationsTabProps) {
  const [notifications, setNotifications] = useState<ShopNotification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [markingAll,    setMarkingAll]    = useState(false);
  const [page,          setPage]          = useState(1);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/notifications`);
    if (res.ok) {
      const json = await res.json() as { data?: ShopNotification[] };
      // เรียงจากใหม่ไปเก่า
      const sorted = (json.data ?? []).slice().sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setNotifications(sorted);
    }
    setLoading(false);
  }, [shopId]);

  useEffect(() => { void fetchNotifications(); }, [fetchNotifications]);

  // Reset to page 1 whenever data is refreshed
  useEffect(() => { setPage(1); }, [notifications.length]);

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

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(notifications.length / PAGE_SIZE)),
    [notifications.length],
  );
  const pageItems = useMemo(
    () => notifications.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [notifications, page],
  );

  return (
    <section className="notif-tab">
      {/* ── Toolbar ── */}
      <div className="notif-tab__toolbar">
        <h3 className="notif-tab__heading">
          🔔 การแจ้งเตือนทั้งหมด
          {unreadCount > 0 && (
            <span className="notif-tab__badge">{unreadCount}</span>
          )}
        </h3>
        {unreadCount > 0 && (
          <button
            className="notif-tab__mark-all"
            onClick={() => void markAllRead()}
            disabled={markingAll}
          >
            {markingAll ? 'กำลังอัปเดต…' : '✓ อ่านทั้งหมด'}
          </button>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="notif-tab__empty">
          <span className="notif-tab__spinner" />
          กำลังโหลด…
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && notifications.length === 0 && (
        <div className="notif-tab__empty">
          <span style={{ fontSize: '2rem' }}>🎉</span>
          ไม่มีการแจ้งเตือน
        </div>
      )}

      {/* ── List ── */}
      {!loading && notifications.length > 0 && (
        <>
          <div className="notif-tab__list">
            {pageItems.map((n) => (
              <div
                key={n.id}
                className={`notif-tab__card${n.read_at ? '' : ' notif-tab__card--unread'}`}
              >
                {/* ── Icon ── */}
                <span className="notif-tab__icon">{TYPE_ICON[n.type] ?? '📢'}</span>

                {/* ── Body ── */}
                <div className="notif-tab__body">
                  <div className="notif-tab__meta">
                    <span className="notif-tab__type">{TYPE_LABEL[n.type] ?? n.type}</span>
                    {!n.read_at && <span className="notif-tab__new">ใหม่</span>}
                  </div>
                  <p className="notif-tab__title">{stripSubKey(n.title)}</p>
                  {n.message && <p className="notif-tab__msg">{n.message}</p>}
                  <p className="notif-tab__time">{fmtDate(n.created_at)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Pagination ── */}
          {pageCount > 1 && (
            <div className="notif-tab__pagination">
              <button
                className="notif-tab__page-btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="หน้าก่อนหน้า"
              >
                ‹
              </button>

              <span className="notif-tab__page-info">
                หน้า {page} / {pageCount}
                <span className="notif-tab__page-total">
                  ({notifications.length} รายการ)
                </span>
              </span>

              <button
                className="notif-tab__page-btn"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                aria-label="หน้าถัดไป"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
