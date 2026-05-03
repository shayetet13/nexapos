'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL_DIRECT as API_URL } from '@/lib/config';
import '@/styles/pages/withdraw.css';

interface Item {
  type:     'consumable' | 'product';
  id:       string;
  name:     string;
  unit:     string;
  quantity?: number;
  category?: string;
}

interface CartItem extends Item {
  qty: number;
}

type Step = 'name' | 'items' | 'confirm' | 'waiting' | 'done' | 'rejected' | 'error';

function todayTH(): string {
  return new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function WithdrawContent() {
  const params   = useSearchParams();
  const shopId   = params.get('shop')   ?? '';
  const branchId = params.get('branch') ?? '';

  const [step,      setStep]      = useState<Step>('name');
  const [staffName, setStaffName] = useState('');
  const [note,      setNote]      = useState('');
  const [items,     setItems]     = useState<Item[]>([]);
  const [cart,      setCart]      = useState<Map<string, CartItem>>(new Map());
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [requestId, setRequestId] = useState('');
  const [search,    setSearch]    = useState('');

  // Load available items
  useEffect(() => {
    if (!shopId) return;
    fetch(`${API_URL}/api/v1/shops/${shopId}/withdrawals/items?branchId=${branchId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const all: Item[] = [
            ...d.data.consumables,
            ...d.data.products,
          ];
          setItems(all);
        }
      })
      .catch(() => {});
  }, [shopId, branchId]);

  // Poll for approval/rejection (every 3s) — uses public endpoint, no JWT needed
  useEffect(() => {
    if (step !== 'waiting' || !requestId || !shopId) return;
    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`${API_URL}/api/v1/public/withdrawals/${requestId}/status?shop=${shopId}`);
        const data = await res.json() as { success: boolean; data?: { id: string; status: string } };
        if (data.success && data.data) {
          const { status } = data.data;
          if (status === 'approved') setStep('done');
          else if (status === 'rejected') setStep('rejected');
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [step, requestId, shopId]);

  function addToCart(item: Item) {
    setCart(prev => {
      const next     = new Map(prev);
      const existing = next.get(item.id);
      const current  = existing?.qty ?? 0;
      const max      = item.quantity ?? Infinity;
      if (current >= max) return prev; // ไม่เกิน stock
      next.set(item.id, { ...item, qty: current + 1 });
      return next;
    });
  }

  function removeFromCart(id: string) {
    setCart(prev => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (!existing) return prev;
      if (existing.qty <= 1) {
        next.delete(id);
      } else {
        next.set(id, { ...existing, qty: existing.qty - 1 });
      }
      return next;
    });
  }

  function setQty(id: string, qty: number) {
    if (qty <= 0) {
      setCart(prev => { const next = new Map(prev); next.delete(id); return next; });
      return;
    }
    setCart(prev => {
      const next = new Map(prev);
      const item = next.get(id);
      if (!item) return prev;
      const max    = item.quantity ?? Infinity;
      const capped = Math.min(qty, max);
      next.set(id, { ...item, qty: capped });
      return next;
    });
  }

  async function submitWithdrawal() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/shops/${shopId}/withdrawals`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_id:  branchId,
          staff_name: staffName,
          note:       note || undefined,
          items: Array.from(cart.values()).map(i => ({
            type: i.type,
            id:   i.id,
            name: i.name,
            unit: i.unit,
            qty:  i.qty,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRequestId(data.data.id);
        setStep('waiting');
      } else {
        setError(data.error?.message ?? 'เกิดข้อผิดพลาด');
      }
    } catch {
      setError('ไม่สามารถส่งคำขอได้');
    } finally {
      setLoading(false);
    }
  }

  const cartItems   = Array.from(cart.values());
  const totalItems  = cartItems.reduce((s, i) => s + i.qty, 0);
  const filteredItems = search.trim()
    ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;
  const consumableItems = filteredItems.filter(i => i.type === 'consumable');
  const productItems    = filteredItems.filter(i => i.type === 'product');

  /* ── STEP: NAME ─────────────────────────────────────────────────── */
  if (step === 'name') return (
    <div className="wd-screen">
      <div className="wd-card">
        <div className="wd-steps">
          <span className="wd-step wd-step--active" />
          <span className="wd-step" />
          <span className="wd-step" />
        </div>
        <div className="wd-icon">👤</div>
        <h1 className="wd-title">เบิกสต๊อก</h1>
        <p className="wd-sub">กรอกชื่อของคุณก่อนเริ่มเบิก</p>

        <input
          className="wd-input"
          type="text"
          placeholder="ชื่อพนักงาน"
          value={staffName}
          onChange={e => setStaffName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && staffName.trim() && setStep('items')}
          autoFocus
        />

        <button
          className="wd-btn-primary"
          disabled={!staffName.trim()}
          onClick={() => setStep('items')}
        >
          ถัดไป →
        </button>

        <p className="wd-date">{todayTH()}</p>
      </div>
    </div>
  );

  /* ── STEP: ITEMS ─────────────────────────────────────────────────── */
  if (step === 'items') return (
    <div className="wd-screen wd-screen--full">
      {/* Header */}
      <div className="wd-header">
        <button className="wd-back" onClick={() => setStep('name')}>←</button>
        <div>
          <div className="wd-header-name">{staffName}</div>
          <div className="wd-header-date">{todayTH()}</div>
        </div>
        <div className="wd-steps wd-steps--sm">
          <span className="wd-step wd-step--done" />
          <span className="wd-step wd-step--active" />
          <span className="wd-step" />
        </div>
      </div>

      {/* Search */}
      <div className="wd-search-wrap">
        <input
          className="wd-search"
          type="search"
          placeholder="🔍 ค้นหารายการ..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Items list */}
      <div className="wd-items-scroll">
        {consumableItems.length > 0 && (
          <div className="wd-section-label">💧 วัตถุดิบ</div>
        )}
        {consumableItems.map(item => {
          const inCart  = cart.get(item.id);
          const max     = item.quantity ?? Infinity;
          const atMax   = (inCart?.qty ?? 0) >= max;
          const outOfStock = max <= 0;
          return (
            <div key={item.id} className={`wd-item-row${outOfStock ? ' wd-item-row--disabled' : ''}`}>
              <div className="wd-item-info">
                <span className="wd-item-name">{item.name}</span>
                <span className="wd-item-unit">{item.unit}</span>
                {item.quantity !== undefined && (
                  <span className={`wd-item-stock${outOfStock ? ' wd-item-stock--zero' : ''}`}>
                    คงเหลือ {item.quantity.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="wd-qty-ctrl">
                {inCart ? (
                  <>
                    <button className="wd-qty-btn wd-qty-btn--minus" onClick={() => removeFromCart(item.id)}>−</button>
                    <span className="wd-qty-val">{inCart.qty}</span>
                    <button className="wd-qty-btn wd-qty-btn--plus" onClick={() => addToCart(item)} disabled={atMax}>+</button>
                  </>
                ) : (
                  <button className="wd-qty-btn wd-qty-btn--add" onClick={() => addToCart(item)} disabled={outOfStock}>
                    {outOfStock ? 'หมด' : '+ เพิ่ม'}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {productItems.length > 0 && (
          <div className="wd-section-label">📦 สินค้าภายใน</div>
        )}
        {productItems.map(item => {
          const inCart     = cart.get(item.id);
          const max        = item.quantity ?? Infinity;
          const atMax      = (inCart?.qty ?? 0) >= max;
          const outOfStock = (item.quantity ?? 1) <= 0;
          return (
            <div key={item.id} className={`wd-item-row${outOfStock ? ' wd-item-row--disabled' : ''}`}>
              <div className="wd-item-info">
                <span className="wd-item-name">{item.name}</span>
                <span className="wd-item-unit">{item.unit}</span>
                {item.quantity !== undefined && (
                  <span className={`wd-item-stock${outOfStock ? ' wd-item-stock--zero' : ''}`}>
                    คงเหลือ {item.quantity.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="wd-qty-ctrl">
                {inCart ? (
                  <>
                    <button className="wd-qty-btn wd-qty-btn--minus" onClick={() => removeFromCart(item.id)}>−</button>
                    <span className="wd-qty-val">{inCart.qty}</span>
                    <button className="wd-qty-btn wd-qty-btn--plus" onClick={() => addToCart(item)} disabled={atMax}>+</button>
                  </>
                ) : (
                  <button className="wd-qty-btn wd-qty-btn--add" onClick={() => addToCart(item)} disabled={outOfStock}>
                    {outOfStock ? 'หมด' : '+ เพิ่ม'}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="wd-empty">ไม่พบรายการ</div>
        )}

        <div style={{ height: '100px' }} />
      </div>

      {/* FAB: Confirm */}
      {totalItems > 0 && (
        <button
          className="wd-fab"
          onClick={() => setStep('confirm')}
        >
          ยืนยัน {totalItems} รายการ →
        </button>
      )}
    </div>
  );

  /* ── STEP: CONFIRM ───────────────────────────────────────────────── */
  if (step === 'confirm') return (
    <div className="wd-screen">
      <div className="wd-card wd-card--wide">
        <div className="wd-steps">
          <span className="wd-step wd-step--done" />
          <span className="wd-step wd-step--done" />
          <span className="wd-step wd-step--active" />
        </div>

        <div className="wd-icon">📋</div>
        <h1 className="wd-title">ยืนยันการเบิก</h1>

        <div className="wd-summary">
          <div className="wd-summary-row">
            <span className="wd-summary-label">พนักงาน</span>
            <span className="wd-summary-val">{staffName}</span>
          </div>
          <div className="wd-summary-row">
            <span className="wd-summary-label">วันที่</span>
            <span className="wd-summary-val">{todayTH()}</span>
          </div>
        </div>

        <div className="wd-cart-list">
          {cartItems.map(i => (
            <div key={i.id} className="wd-cart-row">
              <span className="wd-cart-name">{i.name}</span>
              <span className="wd-cart-qty">{i.qty} {i.unit}</span>
            </div>
          ))}
        </div>

        <textarea
          className="wd-input wd-textarea"
          placeholder="หมายเหตุ (ไม่บังคับ)"
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
        />

        {error && <div className="wd-error">{error}</div>}

        <button
          className="wd-btn-primary"
          disabled={loading}
          onClick={submitWithdrawal}
        >
          {loading ? '⏳ กำลังส่ง...' : '✅ ส่งคำขอเบิก'}
        </button>
        <button
          className="wd-btn-ghost"
          onClick={() => setStep('items')}
        >
          ← แก้ไขรายการ
        </button>
      </div>
    </div>
  );

  /* ── STEP: WAITING ───────────────────────────────────────────────── */
  if (step === 'waiting') return (
    <div className="wd-screen">
      <div className="wd-card">
        <div className="wd-spinner" />
        <h1 className="wd-title" style={{ marginTop: '1.5rem' }}>รอการอนุมัติ</h1>
        <p className="wd-sub">แคชเชียร์กำลังตรวจสอบคำขอของคุณ<br />กรุณารอสักครู่...</p>
        <div className="wd-waiting-items">
          {cartItems.map(i => (
            <div key={i.id} className="wd-waiting-row">
              <span>{i.name}</span>
              <span>{i.qty} {i.unit}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ── STEP: REJECTED ─────────────────────────────────────────────── */
  if (step === 'rejected') return (
    <div className="wd-screen">
      <div className="wd-card">
        <div className="wd-icon wd-icon--error">❌</div>
        <h1 className="wd-title">คำขอถูกปฏิเสธ</h1>
        <p className="wd-sub">แคชเชียร์ไม่อนุมัติคำขอเบิกนี้<br />กรุณาติดต่อผู้ดูแล</p>
        <button className="wd-btn-primary" onClick={() => {
          setStep('name');
          setCart(new Map());
          setStaffName('');
          setNote('');
        }}>
          ส่งคำขอใหม่
        </button>
      </div>
    </div>
  );

  /* ── STEP: DONE ──────────────────────────────────────────────────── */
  if (step === 'done') return (
    <div className="wd-screen">
      <div className="wd-card">
        <div className="wd-icon wd-icon--success">✅</div>
        <h1 className="wd-title">เบิกสำเร็จ!</h1>
        <p className="wd-sub">รายการถูกอนุมัติและตัดสต๊อกแล้ว</p>
        <button className="wd-btn-primary" onClick={() => {
          setStep('name');
          setCart(new Map());
          setStaffName('');
          setNote('');
        }}>
          เบิกใหม่
        </button>
      </div>
    </div>
  );

  /* ── STEP: ERROR ─────────────────────────────────────────────────── */
  return (
    <div className="wd-screen">
      <div className="wd-card">
        <div className="wd-icon">❌</div>
        <h1 className="wd-title">เกิดข้อผิดพลาด</h1>
        <p className="wd-sub">{error || 'ไม่สามารถดำเนินการได้'}</p>
        <button className="wd-btn-primary" onClick={() => setStep('name')}>ลองใหม่</button>
      </div>
    </div>
  );
}

export default function WithdrawPage() {
  return (
    <Suspense fallback={
      <div className="wd-screen">
        <div className="wd-card">
          <div className="wd-spinner" />
        </div>
      </div>
    }>
      <WithdrawContent />
    </Suspense>
  );
}
