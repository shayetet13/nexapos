'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { getAuthToken } from '@/lib/supabase';
import QRCodeLib from 'react-qr-code';
const QRCode = QRCodeLib as unknown as (props: {
  value: string; size?: number; bgColor?: string; fgColor?: string;
  level?: string; style?: React.CSSProperties; className?: string;
}) => React.ReactElement;
import '@/styles/components/customers-panel.css';

const API_URL    = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const API_DIRECT = process.env.NEXT_PUBLIC_API_URL_DIRECT ?? API_URL;

/* ── Types ──────────────────────────────────────────────────── */
export interface CustomerInfo {
  id:          string;
  name:        string;
  phone?:      string;
  email?:      string;
  birthday?:   string | null;
  points:      number;
  total_spent: number;
  tier:        'bronze' | 'silver' | 'gold';
  notes?:      string;
}

interface RecentOrder {
  id:              string;
  daily_seq:       number;
  total:           string;
  discount:        string;
  points_earned:   number;
  points_redeemed: number;
  payment_method:  string | null;
  created_at:      string;
}

interface Props {
  shopId:           string;
  token:            string;
  selectedCustomer: CustomerInfo | null;
  onSelect:         (customer: CustomerInfo | null) => void;
  cartTotal:        number;         // current cart total (for points preview)
  onClose:          () => void;
}

/* ── Tier helpers ───────────────────────────────────────────── */
const TIER_LABEL: Record<string, string> = { bronze: '🥉 Bronze', silver: '🥈 Silver', gold: '🥇 Gold' };
const TIER_COLOR: Record<string, string> = { bronze: '#cd7f32', silver: '#a8a9ad', gold: '#ffd700' };

function pointsToDiscount(points: number) { return Math.floor(points / 100) * 10; }
function calcEarned(total: number)        { return Math.floor(total / 10); }

/* ═══════════════════════════════════════════════════════════ */
export function CustomersPanel({ shopId, token, selectedCustomer, onSelect, cartTotal, onClose }: Props) {
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState<CustomerInfo[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [notFound,     setNotFound]     = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<(CustomerInfo & { orders?: RecentOrder[] }) | null>(null);
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [showCreate,   setShowCreate]   = useState(false);
  const [createForm,   setCreateForm]   = useState({ name: '', phone: '', email: '', birthday: '', notes: '' });
  const [creating,     setCreating]     = useState(false);
  const [createError,  setCreateError]  = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openRegisterOnDisplay = useCallback(async () => {
    if (!shopId) return;
    try {
      const token = await getAuthToken();
      if (!token) return;
      await fetch(`${API_DIRECT}/api/v1/shops/${shopId}/display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'REGISTER_QR', payload: {} }),
      });
    } catch (err) {
      console.warn('[registerDisplay]', err);
    }
  }, [shopId]);

  /* ── Search ─────────────────────────────────────────────── */
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setNotFound(false); return; }
    setSearching(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/shops/${shopId}/customers?q=${encodeURIComponent(q.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json();
      const list: CustomerInfo[] = j.data ?? [];
      setResults(list);
      setNotFound(list.length === 0);
    } finally {
      setSearching(false);
    }
  }, [shopId, token]);

  function handleQueryChange(v: string) {
    setQuery(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(v), 350);
  }

  /* ── Load detail ─────────────────────────────────────────── */
  async function loadDetail(c: CustomerInfo) {
    setDetailCustomer(c);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/shops/${shopId}/customers/${c.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json();
      if (j.success) setDetailCustomer(j.data);
    } finally {
      setDetailLoading(false);
    }
  }

  /* ── Create customer ─────────────────────────────────────── */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim()) { setCreateError('กรุณากรอกชื่อ'); return; }
    setCreating(true); setCreateError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/shops/${shopId}/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name:     createForm.name.trim(),
          phone:    createForm.phone.trim() || undefined,
          email:    createForm.email.trim() || undefined,
          birthday: createForm.birthday.trim() ? createForm.birthday.trim() : undefined,
          notes:    createForm.notes.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!j.success) { setCreateError(j.error?.message ?? 'สร้างไม่สำเร็จ'); return; }
      const created: CustomerInfo = j.data;
      onSelect(created);
      setShowCreate(false);
      setQuery('');
      setResults([]);
      setDetailCustomer(created);
    } finally {
      setCreating(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────── */
  const earned = calcEarned(cartTotal);

  return (
    <div className="cust-panel">
      <div className="cust-panel__header">
        <h2 className="cust-panel__title">👥 สมาชิก</h2>
        <button className="cust-panel__close" onClick={onClose}>✕</button>
      </div>

      {/* ── Register on customer display ── */}
      <button
        type="button"
        className="cust-btn cust-btn--qr-register"
        onClick={openRegisterOnDisplay}
      >
        📲 ให้ลูกค้าสมัครสมาชิก
      </button>

      {/* ── Selected customer summary ── */}
      {selectedCustomer && (
        <div className="cust-selected">
          <div className="cust-selected__top">
            <div className="cust-selected__avatar">{selectedCustomer.name.slice(0, 1).toUpperCase()}</div>
            <div className="cust-selected__info">
              <p className="cust-selected__name">{selectedCustomer.name}</p>
              <p className="cust-selected__phone">{selectedCustomer.phone ?? '—'}</p>
            </div>
            <span className="cust-selected__tier" style={{ color: TIER_COLOR[selectedCustomer.tier] }}>
              {TIER_LABEL[selectedCustomer.tier]}
            </span>
            <button className="cust-selected__remove" onClick={() => onSelect(null)} title="ยกเลิกลูกค้า">✕</button>
          </div>
          <div className="cust-selected__points-row">
            <span className="cust-selected__pts">⭐ {selectedCustomer.points.toLocaleString()} แต้ม</span>
            {cartTotal > 0 && (
              <span className="cust-selected__pts-earn">+{earned} แต้มจากออเดอร์นี้</span>
            )}
          </div>
        </div>
      )}

      {/* ── Search ── */}
      <div className="cust-panel__search">
        <input
          type="text"
          className="cust-panel__input"
          placeholder="ค้นหาชื่อ หรือ เบอร์โทร..."
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
        />
        {searching && <span className="cust-panel__spin">⏳</span>}
      </div>

      {/* ── Results ── */}
      {results.length > 0 && (
        <ul className="cust-list">
          {results.map(c => (
            <li
              key={c.id}
              className={`cust-list__item${selectedCustomer?.id === c.id ? ' cust-list__item--active' : ''}`}
              onClick={() => { onSelect(c); loadDetail(c); setResults([]); setQuery(''); }}
            >
              <div className="cust-list__avatar">{c.name.slice(0, 1).toUpperCase()}</div>
              <div className="cust-list__body">
                <p className="cust-list__name">{c.name}</p>
                <p className="cust-list__sub">{c.phone ?? c.email ?? '—'}</p>
              </div>
              <div className="cust-list__right">
                <span className="cust-list__tier" style={{ color: TIER_COLOR[c.tier] }}>{TIER_LABEL[c.tier]}</span>
                <span className="cust-list__pts">⭐ {c.points}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Not found ── */}
      {notFound && !showCreate && (
        <div className="cust-panel__notfound">
          <p>ไม่พบสมาชิก</p>
          <button className="cust-btn cust-btn--add" onClick={() => { setShowCreate(true); setCreateForm(f => ({ ...f, phone: /^\d/.test(query) ? query : '', name: /^\d/.test(query) ? '' : query })); }}>
            + เพิ่มสมาชิกใหม่
          </button>
        </div>
      )}

      {/* ── Create form ── */}
      {showCreate && (
        <form className="cust-form" onSubmit={handleCreate}>
          <h3 className="cust-form__title">เพิ่มสมาชิกใหม่</h3>
          {createError && <p className="cust-form__error">{createError}</p>}
          <label className="cust-form__label">ชื่อ <span style={{ color: '#f87171' }}>*</span>
            <input className="cust-form__input" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} placeholder="ชื่อ-นามสกุล" />
          </label>
          <label className="cust-form__label">เบอร์โทร
            <input className="cust-form__input" value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} placeholder="0812345678" />
          </label>
          <label className="cust-form__label">อีเมล
            <input className="cust-form__input" type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="example@email.com" />
          </label>
          <label className="cust-form__label">วันเกิด (ไม่บังคับ)
            <input className="cust-form__input" type="date" value={createForm.birthday} onChange={e => setCreateForm(f => ({ ...f, birthday: e.target.value }))} />
          </label>
          <label className="cust-form__label">หมายเหตุ
            <input className="cust-form__input" value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} placeholder="หมายเหตุ..." />
          </label>
          <div className="cust-form__actions">
            <button type="button" className="cust-btn cust-btn--cancel" onClick={() => setShowCreate(false)}>ยกเลิก</button>
            <button type="submit" className="cust-btn cust-btn--save" disabled={creating}>{creating ? '⏳' : '✅ บันทึก'}</button>
          </div>
        </form>
      )}

      {/* ── No query, no selected: show hint or detail ── */}
      {!query && !showCreate && (
        <>
          {detailCustomer ? (
            <div className="cust-detail">
              <div className="cust-detail__header">
                <div className="cust-detail__avatar">{detailCustomer.name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <p className="cust-detail__name">{detailCustomer.name}</p>
                  <p className="cust-detail__sub">{detailCustomer.phone ?? detailCustomer.email ?? '—'}</p>
                </div>
                <span className="cust-detail__tier" style={{ color: TIER_COLOR[detailCustomer.tier] }}>{TIER_LABEL[detailCustomer.tier]}</span>
              </div>
              <div className="cust-detail__stats">
                <div className="cust-detail__stat">
                  <span className="cust-detail__stat-val">⭐ {detailCustomer.points.toLocaleString()}</span>
                  <span className="cust-detail__stat-label">แต้มสะสม</span>
                </div>
                <div className="cust-detail__stat">
                  <span className="cust-detail__stat-val">฿{Number(detailCustomer.total_spent).toLocaleString('th-TH', { minimumFractionDigits: 0 })}</span>
                  <span className="cust-detail__stat-label">ยอดซื้อรวม</span>
                </div>
                {detailCustomer.points >= 100 && (
                  <div className="cust-detail__stat cust-detail__stat--redeem">
                    <span className="cust-detail__stat-val">💸 ฿{pointsToDiscount(detailCustomer.points)}</span>
                    <span className="cust-detail__stat-label">แลกได้สูงสุด</span>
                  </div>
                )}
              </div>
              {/* Tier progress */}
              <div className="cust-tier-bar">
                {detailCustomer.tier !== 'gold' && (
                  <>
                    <div className="cust-tier-bar__label">
                      <span>{TIER_LABEL[detailCustomer.tier]}</span>
                      <span>{detailCustomer.tier === 'bronze' ? `อีก ฿${(1000 - Number(detailCustomer.total_spent)).toLocaleString()} → Silver` : `อีก ฿${(5000 - Number(detailCustomer.total_spent)).toLocaleString()} → Gold`}</span>
                    </div>
                    <div className="cust-tier-bar__track">
                      <div
                        className="cust-tier-bar__fill"
                        style={{
                          width: `${Math.min(100, detailCustomer.tier === 'bronze'
                            ? (Number(detailCustomer.total_spent) / 1000) * 100
                            : ((Number(detailCustomer.total_spent) - 1000) / 4000) * 100)}%`,
                          background: TIER_COLOR[detailCustomer.tier],
                        }}
                      />
                    </div>
                  </>
                )}
                {detailCustomer.tier === 'gold' && (
                  <p className="cust-tier-bar__gold">🏆 สมาชิก Gold สูงสุดแล้ว!</p>
                )}
              </div>

              {/* Recent orders */}
              {detailLoading ? (
                <p className="cust-detail__loading">⏳ กำลังโหลด...</p>
              ) : detailCustomer.orders && detailCustomer.orders.length > 0 ? (
                <div className="cust-orders">
                  <h4 className="cust-orders__title">ประวัติออเดอร์</h4>
                  {detailCustomer.orders.slice(0, 5).map(o => (
                    <div key={o.id} className="cust-orders__row">
                      <span className="cust-orders__seq">#{o.daily_seq}</span>
                      <span className="cust-orders__date">{new Date(o.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}</span>
                      <span className="cust-orders__total">฿{Number(o.total).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                      {o.points_earned > 0 && <span className="cust-orders__pts">+{o.points_earned}⭐</span>}
                    </div>
                  ))}
                </div>
              ) : null}

              {selectedCustomer?.id !== detailCustomer.id && (
                <button className="cust-btn cust-btn--select" onClick={() => onSelect(detailCustomer)}>
                  ✅ เลือกสมาชิกนี้
                </button>
              )}
            </div>
          ) : (
            <div className="cust-panel__hint">
              <p>🔍 ค้นหาสมาชิก หรือ</p>
              <button className="cust-btn cust-btn--add" onClick={() => setShowCreate(true)}>+ เพิ่มสมาชิกใหม่</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
