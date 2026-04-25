'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const DEV_EMAILS = (process.env.NEXT_PUBLIC_DEV_ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

interface PosAssignment {
  role: 'owner' | 'manager' | 'cashier' | 'viewer';
  shopId: string;
  shopName: string;
  branchId: string | null;
  branchName: string | null;
}

const FEATURES = [
  {
    icon: '🛒',
    title: 'ระบบ POS',
    desc: 'รับออเดอร์ คิดเงิน พิมพ์ใบเสร็จ รองรับ Cash · QR · บัตรเครดิต',
  },
  {
    icon: '📊',
    title: 'รายงานยอดขาย',
    desc: 'Dashboard real-time ยอดขายรายวัน/เดือน สินค้าขายดี กำไร-ขาดทุน',
  },
  {
    icon: '📦',
    title: 'จัดการสต็อก',
    desc: 'ติดตามสต็อกทุกสาขา แจ้งเตือนของใกล้หมด รับ-จ่ายสินค้าอัตโนมัติ',
  },
  {
    icon: '👥',
    title: 'จัดการพนักงาน',
    desc: 'กำหนดสิทธิ์ owner / manager / cashier ดูประวัติการขายรายคน',
  },
  {
    icon: '🏪',
    title: 'หลายสาขา',
    desc: 'รองรับหลายสาขาในบัญชีเดียว สลับสาขาได้ทันที ข้อมูลแยกกันสมบูรณ์',
  },
  {
    icon: '🔔',
    title: 'แจ้งเตือน & Telegram',
    desc: 'แจ้งเตือนออเดอร์ใหม่ สต็อกต่ำ และสรุปยอดขายผ่าน Telegram',
  },
];

const FREE_HIGHLIGHTS = [
  { label: 'ฟรีตลอดไป', sub: 'ไม่มีค่าใช้จ่ายซ่อนเร้น' },
  { label: 'ไม่ต้องติดตั้ง', sub: 'ใช้งานผ่านเบราว์เซอร์ทันที' },
  { label: 'ไม่ต้องใช้บัตรเครดิต', sub: 'สมัครแล้วใช้ได้เลย' },
];

const STATS = [
  { num: '500+', label: 'ร้านค้าที่ไว้วางใจ' },
  { num: '99.9%', label: 'Uptime SLA' },
  { num: '24/7', label: 'Support' },
];

export default function HomePage() {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkSession() {
      const supabase = createSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setChecking(false);
        return;
      }

      const email = session.user?.email ?? '';
      if (DEV_EMAILS.length > 0 && DEV_EMAILS.includes(email.trim().toLowerCase())) {
        window.location.href = '/dev';
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/v1/me/pos-assignment`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (!res.ok) { setChecking(false); return; }

        const json = await res.json();
        const assignment = json.data as PosAssignment | null;

        if (!assignment) { setChecking(false); return; }

        const { shopId, shopName, branchId, branchName } = assignment;

        if (branchId) {
          const params = new URLSearchParams({ shopId, shopName: shopName ?? '', branchId, branchName: branchName ?? '' });
          window.location.href = `/pos?${params.toString()}`;
          return;
        }

        const params = new URLSearchParams({ shopId, shopName: shopName ?? '', from: 'login' });
        window.location.href = `/select-branch?${params.toString()}`;
      } catch {
        setChecking(false);
      }
    }

    checkSession();
  }, []);

  if (checking) {
    return (
      <main className="lp-checking">
        <div className="lp-spinner" />
      </main>
    );
  }

  return (
    <div className="lp-root">

      {/* ── NAV ── */}
      <nav className="lp-nav">
        <div className="lp-nav__inner">
          <Link href="/" className="lp-nav__logo">
            <span className="lp-nav__logo-mark">N</span>
            <span className="lp-nav__logo-text">NexaPos</span>
          </Link>
          <div className="lp-nav__links">
            <Link href="/login" className="lp-nav__login">เข้าสู่ระบบ</Link>
            <Link href="/register" className="lp-btn lp-btn--solid lp-btn--sm">สมัครฟรี</Link>
            <ThemeSwitcher variant="topnav" />
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-container lp-hero__inner">
          <div className="lp-hero__badge">
            <span className="lp-hero__badge-dot" />
            ระบบ POS ออนไลน์ · ฟรีตลอดไป
          </div>

          <h1 className="lp-hero__title">
            จัดการร้านค้า<br />
            <span className="lp-hero__title-accent">ได้ทุกที่</span> ทุกเวลา
          </h1>

          <p className="lp-hero__sub">
            ระบบ POS ครบวงจรสำหรับธุรกิจยุคใหม่ — จัดการออเดอร์ สต็อก
            รายงานยอดขาย และพนักงาน ได้แบบ real-time ทุกสาขา
          </p>

          {/* Free highlights */}
          <div className="lp-hero__free-row">
            {FREE_HIGHLIGHTS.map((f) => (
              <div key={f.label} className="lp-hero__free-item">
                <span className="lp-hero__free-check">✓</span>
                <div>
                  <div className="lp-hero__free-label">{f.label}</div>
                  <div className="lp-hero__free-sub">{f.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="lp-hero__ctas">
            <Link href="/register" className="lp-btn lp-btn--solid lp-btn--lg">
              เริ่มต้นใช้งานฟรี
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </Link>
            <Link href="/login" className="lp-btn lp-btn--ghost lp-btn--lg">
              เข้าสู่ระบบ
            </Link>
          </div>
        </div>

        <div className="lp-hero__scroll-hint">
          <span>scroll</span>
          <div className="lp-hero__scroll-line" />
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="lp-stats">
        <div className="lp-stats__inner">
          {STATS.map((s, i) => (
            <div key={i} className="lp-stats__item">
              <div className="lp-stats__num">{s.num}</div>
              <div className="lp-stats__label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="lp-features">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-label">FEATURES</span>
            <h2 className="lp-section-title">ครบทุกฟีเจอร์ที่ร้านต้องการ</h2>
            <p className="lp-section-sub">ไม่ต้องซื้อโปรแกรมเสริม ทุกอย่างรวมอยู่ในที่เดียว</p>
          </div>
          <div className="lp-features__grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature-card">
                <div className="lp-feature-card__icon">{f.icon}</div>
                <h3 className="lp-feature-card__title">{f.title}</h3>
                <p className="lp-feature-card__desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FREE BANNER ── */}
      <section className="lp-free-banner">
        <div className="lp-container">
          <div className="lp-free-banner__inner">
            <div className="lp-free-banner__tag">FREE</div>
            <h2 className="lp-free-banner__title">ใช้งานได้ฟรี ไม่มีวันหมดอายุ</h2>
            <p className="lp-free-banner__desc">
              ไม่มีค่าธรรมเนียมรายเดือน · ไม่มีค่าธรรมเนียมต่อออเดอร์ · ไม่ต้องผูกบัตรเครดิต
            </p>
            <Link href="/register" className="lp-btn lp-btn--solid lp-btn--lg">
              สมัครใช้งานฟรีเลย
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer__inner">
          <div className="lp-footer__logo">
            <span className="lp-nav__logo-mark lp-nav__logo-mark--sm">N</span>
            <span>NexaPos</span>
          </div>
          <div className="lp-footer__copy">
            © 2025 NexaPos · PowerBy{' '}
            <a href="https://nexapos.io/" target="_blank" rel="noopener noreferrer" className="lp-footer__link">
              DevKao &amp; DevMax
            </a>
          </div>
          <div className="lp-footer__links">
            <Link href="/login" className="lp-footer__nav">เข้าสู่ระบบ</Link>
            <Link href="/register" className="lp-footer__nav">สมัครใช้งาน</Link>
            <a href="mailto:support@nexapos.io" className="lp-footer__nav">support@nexapos.io</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
