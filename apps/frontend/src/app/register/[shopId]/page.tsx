'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import '@/styles/pages/register-member.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TIER_LABEL: Record<string, string> = { bronze: '🥉 Bronze', silver: '🥈 Silver', gold: '🥇 Gold' };

export default function RegisterMemberPage() {
  const params = useParams();
  const shopId = params?.shopId as string;
  const [shop, setShop] = useState<{ name: string; logo_url: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; tier: string; points: number; existing?: boolean } | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', birthday: '' });

  useEffect(() => {
    if (!shopId) return;
    fetch(`${API_URL}/api/v1/public/shops/${shopId}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success && j.data) setShop({ name: j.data.name, logo_url: j.data.logo_url ?? null });
      })
      .finally(() => setLoading(false));
  }, [shopId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shopId) return;
    setSubmitState('submitting');
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/public/shops/${shopId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          birthday: form.birthday.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error?.message ?? 'สมัครไม่สำเร็จ');
        setSubmitState('error');
        return;
      }
      setResult({
        name: j.data.name,
        tier: j.data.tier,
        points: j.data.points ?? 0,
        existing: j.data.existing === true,
      });
      setSubmitState('done');
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
      setSubmitState('error');
    }
  }

  if (loading) {
    return (
      <main className="reg-member">
        <div className="reg-member__box">
          <p className="reg-member__loading">กำลังโหลด...</p>
        </div>
      </main>
    );
  }

  if (!shop) {
    return (
      <main className="reg-member">
        <div className="reg-member__box">
          <p className="reg-member__error">ไม่พบร้านค้า</p>
        </div>
      </main>
    );
  }

  if (submitState === 'done' && result) {
    return (
      <main className="reg-member">
        <div className="reg-member__box reg-member__box--success">
          {shop.logo_url && (
            <div className="reg-member__logo-wrap">
              <Image src={shop.logo_url} alt={shop.name} width={64} height={64} className="reg-member__logo" />
            </div>
          )}
          <h1 className="reg-member__shop-name">{shop.name}</h1>
          <div className="reg-member__success-icon">✓</div>
          <p className="reg-member__success-title">
            {result.existing ? 'คุณเป็นสมาชิกอยู่แล้ว' : 'สมัครสมาชิกสำเร็จ'}
          </p>
          <p className="reg-member__success-name">{result.name}</p>
          <div className="reg-member__badges">
            <span className="reg-member__tier">{TIER_LABEL[result.tier] ?? result.tier}</span>
            <span className="reg-member__points">⭐ {result.points} แต้ม</span>
          </div>
          <p className="reg-member__thank">ขอบคุณที่สมัครสมาชิก</p>
        </div>
      </main>
    );
  }

  return (
    <main className="reg-member">
      <div className="reg-member__box">
        {shop.logo_url && (
          <div className="reg-member__logo-wrap">
            <Image src={shop.logo_url} alt={shop.name} width={56} height={56} className="reg-member__logo" />
          </div>
        )}
        <h1 className="reg-member__shop-name">{shop.name}</h1>
        <p className="reg-member__sub">สมัครสมาชิก — กรอกข้อมูลด้านล่าง</p>

        <div className="reg-member__benefit">
          <span className="reg-member__benefit-icon">🎁</span>
          <span>สมาชิกมีสิทธิพิเศษ</span>
        </div>

        <form onSubmit={handleSubmit} className="reg-member__form">
          <label className="reg-member__label">
            <span className="reg-member__label-text">ชื่อ <span className="reg-member__req">*</span></span>
            <input
              type="text"
              className="reg-member__input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ชื่อเล่น หรือ ชื่อจริง"
              required
              maxLength={200}
            />
          </label>
          <label className="reg-member__label">
            <span className="reg-member__label-text">เบอร์โทร <span className="reg-member__req">*</span></span>
            <input
              type="tel"
              className="reg-member__input"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="0812345678"
              required
              maxLength={20}
            />
          </label>
          <label className="reg-member__label">
            <span className="reg-member__label-text">วันเกิด <span className="reg-member__req">*</span></span>
            <input
              type="date"
              className="reg-member__input"
              value={form.birthday}
              onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))}
              required
              max={new Date().toISOString().split('T')[0]}
            />
          </label>
          {error && <p className="reg-member__err">{error}</p>}
          <button type="submit" className="reg-member__btn" disabled={submitState === 'submitting'}>
            {submitState === 'submitting' ? 'กำลังสมัคร...' : 'สมัครสมาชิก'}
          </button>
        </form>
      </div>
    </main>
  );
}
