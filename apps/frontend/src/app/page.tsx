'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import type { ShopMode } from '@/lib/work-area';
import { workAreaHref } from '@/lib/work-area';
import { API_URL } from '@/lib/config';

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
  shop_mode?: ShopMode;
}

const MARQUEE_ITEMS = [
  '🛒 POS ขายหน้าร้าน', '📊 รายงาน P&L จริง', '👥 ระบบสมาชิก + แต้ม',
  '🏢 หลายสาขาไม่จำกัด', '🎁 โปรโมชัน / คอมโบ', '🤖 Telegram Bot',
  '🖨️ พิมพ์ใบเสร็จ BT/WiFi', '🖥️ Customer Display', '🔄 โอนสต็อกสาขา', '📦 แจ้งเตือนสต็อกต่ำ',
];

const PROMO_CHIPS = [
  'ซื้อ 2 แถม 1', 'ลด 20% ช่วงเย็น', 'คอมโบ Coffee+Cake',
  'ราคาสมาชิก Gold', 'Happy Hour 14-16 น.', 'ส่วนลดวันเกิด', 'ซื้อครบ ฿500 ลด ฿50',
];

const FREE_FEATS = ['POS ขายหน้าร้านพื้นฐาน', 'พิมพ์ใบเสร็จ Bluetooth/WiFi', 'รายงานยอดขายพื้นฐาน'];

const PRO_FEATS = [
  'POS ขายหน้าร้านพื้นฐาน', 'POS ครบทุกฟีเจอร์ขั้นสูง', 'จอที่ 2 (Customer Display)',
  'พิมพ์ใบเสร็จ Bluetooth/WiFi', 'รายงานยอดขาย + P&L จริง', 'ระบบสมาชิก + สะสมแต้ม',
  'แจ้งเตือนวันเกิดลูกค้า', 'โปรโมชัน / ส่วนลด / คอมโบ', 'แจ้งเตือนสต็อกต่ำอัตโนมัติ',
  'โอนสต็อกระหว่างสาขา', 'หลายสาขา ไม่จำกัด', 'แดชบอร์ดวิเคราะห์ข้อมูล',
  'คืนเงิน + OTP ยืนยัน', 'แจ้งเตือน Telegram Bot',
];

/* ── Aurora canvas background ── */
function AuroraCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const COLORS = [
      'rgba(124,58,237,0.18)', 'rgba(37,99,235,0.14)',
      'rgba(5,150,105,0.12)', 'rgba(217,119,6,0.10)', 'rgba(124,58,237,0.12)',
    ];

    let W = 0, H = 0;
    type Blob = { x: number; y: number; r: number; dx: number; dy: number; color: string };
    const blobs: Blob[] = [];

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    for (let i = 0; i < 7; i++) {
      blobs.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 200 + Math.random() * 300,
        dx: (Math.random() - 0.5) * 0.4, dy: (Math.random() - 0.5) * 0.3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }

    let rafId: number;
    function tick() {
      ctx!.clearRect(0, 0, W, H);
      blobs.forEach((b) => {
        b.x += b.dx; b.y += b.dy;
        if (b.x < -b.r || b.x > W + b.r) b.dx *= -1;
        if (b.y < -b.r || b.y > H + b.r) b.dy *= -1;
        const g = ctx!.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, b.color); g.addColorStop(1, 'transparent');
        ctx!.fillStyle = g;
        ctx!.beginPath(); ctx!.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx!.fill();
      });
      rafId = requestAnimationFrame(tick);
    }
    tick();

    return () => { cancelAnimationFrame(rafId); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="lp-aurora-canvas" aria-hidden="true" />;
}

export default function HomePage() {
  const [checking, setChecking] = useState(true);
  const curRef  = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  /* Auth check */
  useEffect(() => {
    async function checkSession() {
      const supabase = createSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) { setChecking(false); return; }

      const email = session.user?.email ?? '';
      if (DEV_EMAILS.length > 0 && DEV_EMAILS.includes(email.trim().toLowerCase())) {
        window.location.href = '/dev'; return;
      }

      try {
        const res = await fetch(`${API_URL}/api/v1/me/pos-assignment`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) { setChecking(false); return; }

        const json = await res.json();
        const assignment = json.data as PosAssignment | null;
        if (!assignment) { setChecking(false); return; }

        const { shopId, shopName, branchId, branchName, shop_mode } = assignment;
        const mode = shop_mode ?? 'retail';

        if (branchId) {
          window.location.href = workAreaHref({ shopId, shopName: shopName ?? '', branchId, branchName: branchName ?? '', shopMode: mode });
          return;
        }
        const params = new URLSearchParams({ shopId, shopName: shopName ?? '', from: 'login' });
        window.location.href = `/select-branch?${params.toString()}`;
      } catch { setChecking(false); }
    }
    checkSession();
  }, []);

  /* Custom cursor */
  useEffect(() => {
    const cur = curRef.current;
    const ring = ringRef.current;
    if (!cur || !ring) return;

    let mx = 0, my = 0, rx = 0, ry = 0, rafId: number;

    function onMove(e: MouseEvent) { mx = e.clientX; my = e.clientY; }
    document.addEventListener('mousemove', onMove, { passive: true });

    function animate() {
      rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12;
      cur!.style.transform  = `translate(${mx - 4}px,${my - 4}px)`;
      ring!.style.transform = `translate(${rx - 18}px,${ry - 18}px)`;
      rafId = requestAnimationFrame(animate);
    }
    animate();

    const targets = document.querySelectorAll('a,button,.lp-bc,.lp-chip,.lp-notif');
    function grow()  { ring!.style.width = '56px'; ring!.style.height = '56px'; ring!.style.borderColor = 'rgba(124,58,237,0.6)'; }
    function shrink(){ ring!.style.width = '36px'; ring!.style.height = '36px'; ring!.style.borderColor = 'rgba(124,58,237,0.35)'; }
    targets.forEach((el) => { el.addEventListener('mouseenter', grow); el.addEventListener('mouseleave', shrink); });

    return () => {
      document.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafId);
    };
  }, [checking]);

  /* Scroll reveal */
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          setTimeout(() => e.target.classList.add('on'), i * 80);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.lp-sr, .lp-sr-l').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [checking]);

  if (checking) {
    return (
      <main className="lp-checking">
        <div className="lp-spinner" />
      </main>
    );
  }

  return (
    <div className="lp-root">
      <AuroraCanvas />
      <div className="lp-cursor"      ref={curRef}  aria-hidden="true" />
      <div className="lp-cursor-ring" ref={ringRef} aria-hidden="true" />

      {/* ── NAV ── */}
      <nav className="lp-nav" id="lp-nav" role="navigation" aria-label="Main navigation">
        <Link href="/" className="lp-nav-logo">
          <div className="lp-nav-logomark">N</div>
          <span className="lp-nav-name">Nexa<span>POS</span></span>
        </Link>
        <ul className="lp-nav-links">
          <li><a href="#lp-features">ฟีเจอร์</a></li>
          <li><a href="#lp-pricing">ราคา</a></li>
          <li><a href="#lp-cta">เริ่มต้น</a></li>
        </ul>
        <div className="lp-nav-cta">
          <Link href="/login"    className="lp-btn-nav-ghost">เข้าสู่ระบบ</Link>
          <Link href="/register" className="lp-btn-nav-primary">เริ่มฟรีเดี๋ยวนี้ →</Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero" aria-labelledby="lp-h1">
        <div className="lp-hero-pill">
          <span className="lp-pill-badge">ใหม่ 2026</span>
          ระบบ POS รุ่นถัดไป สร้างมาเพื่อธุรกิจไทย
        </div>
        <h1 className="lp-hero-h1" id="lp-h1">
          ขายดีกว่า<br />
          <span className="lp-word-aurora">ฉลาดกว่า</span><br />
          <span className="lp-word-ghost">เร็วกว่าเดิม</span>
        </h1>
        <p className="lp-hero-sub">
          ระบบ POS ที่ออกแบบมาเพื่อให้ธุรกิจคุณเติบโตได้จริง<br />
          ครบทุกฟีเจอร์ที่ร้านต้องการ — ตั้งแต่วันแรก
        </p>
        <div className="lp-hero-actions">
          <Link href="/register" className="lp-btn-main">⚡ เริ่มใช้งานฟรี ไม่ต้องใช้บัตร</Link>
          <a href="#lp-features" className="lp-btn-outline">ดูฟีเจอร์ทั้งหมด</a>
        </div>
        <div className="lp-hero-trust">
          <div className="lp-trust-item"><span>🏪</span> 15,000+ ร้านค้าทั่วไทย</div>
          <div className="lp-trust-divider" aria-hidden="true" />
          <div className="lp-trust-item"><span>⭐</span> 4.9/5 จากผู้ใช้จริง</div>
          <div className="lp-trust-divider" aria-hidden="true" />
          <div className="lp-trust-item"><span>🔒</span> ข้อมูลปลอดภัย 100%</div>
          <div className="lp-trust-divider" aria-hidden="true" />
          <div className="lp-trust-item"><span>🆓</span> ทดลอง Pro ฟรี 14 วัน</div>
        </div>
      </section>

      {/* ── MARQUEE ── */}
      <div className="lp-marquee-wrap" aria-hidden="true">
        <div className="lp-marquee-track">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
            <div key={i} className="lp-marquee-item">
              {item} <span className="lp-marquee-sep">·</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── BENTO FEATURES ── */}
      <section className="lp-bento-section" id="lp-features" aria-labelledby="lp-feat-h2">
        <div className="lp-bento-inner">
          <div className="lp-section-eyebrow lp-sr-l">
            <div className="lp-eyebrow-line" />
            <span className="lp-eyebrow-text">ฟีเจอร์</span>
          </div>
          <h2 className="lp-section-title lp-sr" id="lp-feat-h2">
            ทุกอย่างที่ร้านต้องการ<br />อยู่ในที่เดียว
          </h2>
          <p className="lp-section-sub lp-sr">
            ออกแบบโดยเข้าใจปัญหาของร้านค้าไทยจริงๆ ไม่ใช่แค่แปลมาจากต่างประเทศ
          </p>

          <div className="lp-bento-grid">

            {/* BC1: dark hero — P&L */}
            <div className="lp-bc lp-bc-1 lp-sr">
              <div className="lp-bc-tag lp-bc-tag-purple">📊 รายงาน P&amp;L</div>
              <h3>เห็นกำไรจริง<br />ไม่ใช่แค่ยอดขาย</h3>
              <p style={{ marginTop: 8 }}>
                คำนวณต้นทุน overhead และ margin ทุก SKU แบบ Real-time บอกเลยว่าสินค้าตัวไหนกำไรจริง ตัวไหนขาดทุน
              </p>
              <div className="lp-rev-bars" aria-hidden="true">
                {([[40,'off'],[65,'on'],[48,'off'],[82,'on'],[55,'off'],[90,'on'],[100,'on']] as [number,string][]).map(([h, t], i) => (
                  <div key={i} className={`lp-rb lp-rb-${t}`} style={{ height: `${h}%` }} />
                ))}
              </div>
              <div style={{ marginTop: 20 }}>
                <div className="lp-stat-num" style={{ color: '#fff' }}>฿128,400</div>
                <div className="lp-stat-label" style={{ color: 'rgba(255,255,255,0.45)' }}>กำไรเดือนนี้</div>
                <span className="lp-stat-trend lp-trend-up">↑ +18% จากเดือนก่อน</span>
              </div>
            </div>

            {/* BC2: สมาชิก */}
            <div className="lp-bc lp-bc-2 lp-sr">
              <div className="lp-bc-tag lp-bc-tag-blue">👥 สมาชิก</div>
              <h3>สร้างฐานลูกค้าประจำ</h3>
              <p>สะสมแต้ม แจ้งเตือนวันเกิด Tier ระดับ Gold/Silver ดึงลูกค้ากลับมาซ้ำ</p>
              <div className="lp-member-stats">
                <div className="lp-member-stat">
                  <div className="lp-mstat-num">2,847</div>
                  <div className="lp-mstat-label">สมาชิกทั้งหมด</div>
                </div>
                <div className="lp-member-stat">
                  <div className="lp-mstat-num" style={{ color: 'var(--lp-green)' }}>+47</div>
                  <div className="lp-mstat-label">ใหม่วันนี้</div>
                </div>
              </div>
            </div>

            {/* BC3: Telegram */}
            <div className="lp-bc lp-bc-3 lp-sr">
              <div className="lp-bc-tag lp-bc-tag-green">🤖 Telegram Bot</div>
              <h3>ติดตามได้ทุกที่</h3>
              <div className="lp-notif-stack">
                <div className="lp-notif">
                  <div className="lp-notif-dot lp-nd-green" />
                  <span className="lp-notif-text">ยอดขาย ฿4,200 — สาขาสีลม</span>
                  <span className="lp-notif-time">เมื่อกี้</span>
                </div>
                <div className="lp-notif">
                  <div className="lp-notif-dot lp-nd-amber" />
                  <span className="lp-notif-text">⚠ นมสดใกล้หมด — เหลือ 3 ลิตร</span>
                  <span className="lp-notif-time">2 นาที</span>
                </div>
                <div className="lp-notif">
                  <div className="lp-notif-dot lp-nd-purple" />
                  <span className="lp-notif-text">🎂 วันเกิด คุณสมชาย — ส่งคูปอง?</span>
                  <span className="lp-notif-time">5 นาที</span>
                </div>
              </div>
            </div>

            {/* BC4: หลายสาขา */}
            <div className="lp-bc lp-bc-4 lp-sr">
              <div className="lp-bc-tag lp-bc-tag-amber">🏢 หลายสาขา</div>
              <h3>บริหารทุกสาขาจากที่เดียว</h3>
              <p>โอนสต็อกระหว่างสาขา ดูรายงานรวม และตั้งค่าราคาแยกตามสาขาได้</p>
              <div className="lp-branch-list">
                {[['สาขาสีลม','฿48,250'],['สาขาอโศก','฿31,800'],['สาขาทองหล่อ','฿26,100']].map(([n,v]) => (
                  <div key={n} className="lp-branch-row">
                    <span className="lp-branch-name">🏪 {n}</span>
                    <span className="lp-branch-val">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* BC5: dark pricing teaser */}
            <div className="lp-bc lp-bc-5 lp-sr">
              <div className="lp-bc-tag lp-bc-tag-purple-inv">⚡ ฟรี &amp; Pro</div>
              <div className="lp-stat-num" style={{ color: '#fff' }}>฿599</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>ต่อเดือน · Pro plan</div>
              <p style={{ marginTop: 12, fontSize: 13 }}>หรือ ฿2,990/ปี — ประหยัด 58% เริ่มต้นฟรีได้เลย</p>
              <a href="#lp-pricing" className="lp-btn-bc-brand">ดูราคาทั้งหมด →</a>
            </div>

            {/* BC6: โปรโมชัน */}
            <div className="lp-bc lp-bc-6 lp-sr">
              <div className="lp-bc-tag lp-bc-tag-red">🎁 โปรโมชัน</div>
              <h3>ตั้งโปรได้ทุกรูปแบบ ไม่มีขีดจำกัด</h3>
              <p>ซื้อ X แถม Y, ส่วนลด % หรือบาท, ราคาช่วงเวลา, คอมโบเซต, ราคาพิเศษสมาชิก — สร้างได้เองในไม่กี่วินาที</p>
              <div className="lp-promo-chips">
                {PROMO_CHIPS.map((c) => (
                  <div key={c} className="lp-chip">{c}</div>
                ))}
              </div>
            </div>

            {/* BC7: Steps */}
            <div className="lp-bc lp-bc-7 lp-sr">
              <div className="lp-bc-tag lp-bc-tag-blue">🚀 เริ่มต้น</div>
              <h3>พร้อมขายใน 4 ขั้นตอน · ใช้เวลาไม่ถึง 5 นาที</h3>
              <div className="lp-steps-row">
                {([
                  ['สมัครฟรี',             'กรอกอีเมล ตั้งรหัสผ่าน เสร็จใน 30 วินาที ไม่ต้องใช้บัตรเครดิต'],
                  ['เพิ่มสินค้า',           'พิมพ์ชื่อ ราคา รูปภาพ หรือนำเข้าจาก Excel ทีเดียวได้เลย'],
                  ['เชื่อมต่อเครื่องพิมพ์', 'Bluetooth หรือ WiFi ค้นหาและเชื่อมต่อในคลิกเดียว'],
                  ['เปิดขายได้เลย!',       'เปิดหน้า POS กดสินค้า คิดเงิน พิมพ์ใบเสร็จ เร็วกว่าเดิม 10 เท่า'],
                ] as [string,string][]).map(([title, desc], i) => (
                  <div key={i} className="lp-step-row">
                    <div className="lp-step-n">{i + 1}</div>
                    <span className="lp-step-text"><strong>{title}</strong> — {desc}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="lp-pricing-section" id="lp-pricing" aria-labelledby="lp-price-h2">
        <div className="lp-pricing-inner">
          <div className="lp-pricing-header lp-sr">
            <div className="lp-section-eyebrow lp-section-eyebrow-center">
              <div className="lp-eyebrow-line lp-eyebrow-dim" />
              <span className="lp-eyebrow-text lp-eyebrow-dim-text">ราคา</span>
            </div>
            <h2 className="lp-section-title lp-section-title-white" id="lp-price-h2">
              เลือกแผนที่ใช่สำหรับคุณ
            </h2>
            <p className="lp-section-sub lp-section-sub-dim">
              ไม่มีค่าธรรมเนียมซ่อน · ยกเลิกได้ทุกวัน · ทดลอง Pro ฟรี 14 วัน
            </p>
          </div>

          <div className="lp-price-grid">
            {/* FREE */}
            <div className="lp-pc lp-sr" role="article">
              <div className="lp-pc-icon">🆓</div>
              <div className="lp-pc-name">Free</div>
              <div className="lp-pc-tagline">เริ่มต้นไม่มีค่าใช้จ่าย</div>
              <div className="lp-pc-price">฿<span className="lp-pc-price-zero">0</span><span className="lp-pc-per"> / เดือน</span></div>
              <div className="lp-pc-annual lp-pc-annual-dim">ใช้ได้ฟรีตลอดไป</div>
              <div className="lp-pc-divider" />
              <div className="lp-pc-limits">
                <div className="lp-pc-limit">🏪 1 สาขา</div>
                <div className="lp-pc-limit">📦 30 รายการ</div>
              </div>
              <ul className="lp-pc-feats">
                {FREE_FEATS.map((f) => (
                  <li key={f}><div className="lp-pc-check lp-chk-dim">✓</div> {f}</li>
                ))}
              </ul>
              <Link href="/register" className="lp-pc-btn lp-pc-btn-dim">เริ่มต้นฟรี →</Link>
            </div>

            {/* PRO */}
            <div className="lp-pc lp-pc-featured lp-sr" role="article">
              <div className="lp-pc-badge">✦ แนะนำ</div>
              <div className="lp-pc-icon">👑</div>
              <div className="lp-pc-name">Pro</div>
              <div className="lp-pc-tagline">ทุกฟีเจอร์ · ไม่จำกัด</div>
              <div className="lp-pc-price"><span className="lp-pc-cur">฿</span>599<span className="lp-pc-per"> / เดือน</span></div>
              <div className="lp-pc-annual">หรือ ฿2,990/ปี <span className="lp-pc-save">ประหยัด 58%</span></div>
              <div className="lp-pc-divider" />
              <div className="lp-pc-limits lp-pc-limits-featured">
                <div className="lp-pc-limit">🏪 สาขาไม่จำกัด</div>
                <div className="lp-pc-limit">📦 สินค้าไม่จำกัด</div>
              </div>
              <ul className="lp-pc-feats">
                {PRO_FEATS.map((f) => (
                  <li key={f}><div className="lp-pc-check lp-chk-brand">✓</div> {f}</li>
                ))}
              </ul>
              <Link href="/register" className="lp-pc-btn lp-pc-btn-brand">⚡ เริ่มต้น Pro วันนี้</Link>
            </div>
          </div>

          <div className="lp-price-note lp-sr">
            🛡️ <span>ทดลองใช้ Pro ฟรี 14 วัน</span> · ไม่พอใจยินดีคืนเงินเต็มจำนวน · ไม่ต้องใช้บัตรเครดิตเพื่อเริ่มต้น
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta-section" id="lp-cta" aria-labelledby="lp-cta-h2">
        <div className="lp-cta-orbit" aria-hidden="true" />
        <div className="lp-cta-orbit lp-cta-orbit2" aria-hidden="true" />
        <div className="lp-cta-orbit lp-cta-orbit3" aria-hidden="true" />
        <div className="lp-cta-inner">
          <h2 className="lp-cta-h2 lp-sr" id="lp-cta-h2">
            ธุรกิจคุณ<br />
            <span className="lp-cta-gd">สมควรเติบโต</span><br />
            ได้มากกว่านี้
          </h2>
          <p className="lp-cta-sub lp-sr">
            หยุดเสียเวลากับ Excel หยุดนับสต็อกด้วยมือ<br />
            NexaPOS จัดการให้ — คุณโฟกัสแค่การเติบโต
          </p>
          <div className="lp-sr">
            <Link href="/register" className="lp-btn-main lp-btn-main-lg">⚡ เริ่มใช้งานฟรีวันนี้</Link>
          </div>
          <div className="lp-cta-note lp-sr">
            ฟรีตลอดไป · หรืออัปเกรด Pro ฿599/เดือน · ยกเลิกได้ทุกวัน
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-foot-inner">
          <div className="lp-foot-top">
            <div>
              <div className="lp-foot-brand">
                <div className="lp-nav-logomark">N</div>
                <span>Nexa<em>POS</em></span>
              </div>
              <p className="lp-foot-about">
                ระบบ POS รุ่นใหม่สำหรับธุรกิจไทย ออกแบบโดยเข้าใจปัญหาจริง เริ่มต้นฟรี ไม่มีสัญญาผูกมัด
              </p>
            </div>
            <div className="lp-foot-col">
              <h4>ผลิตภัณฑ์</h4>
              <ul>
                <li><a href="#lp-features">ฟีเจอร์</a></li>
                <li><a href="#lp-pricing">ราคา</a></li>
                <li><a href="#">อัปเดต</a></li>
                <li><a href="#">API</a></li>
              </ul>
            </div>
            <div className="lp-foot-col">
              <h4>ช่วยเหลือ</h4>
              <ul>
                <li><a href="#">ศูนย์ช่วยเหลือ</a></li>
                <li><a href="#">คู่มือการใช้งาน</a></li>
                <li><a href="#">วิดีโอสอนใช้</a></li>
                <li><a href="#">ติดต่อเรา</a></li>
              </ul>
            </div>
            <div className="lp-foot-col">
              <h4>บริษัท</h4>
              <ul>
                <li><a href="#">เกี่ยวกับเรา</a></li>
                <li><a href="#">นโยบายความเป็นส่วนตัว</a></li>
                <li><a href="#">ข้อกำหนดการใช้</a></li>
                <li><a href="#">Facebook</a></li>
              </ul>
            </div>
          </div>
          <div className="lp-foot-bottom">
            <p>© 2026 NexaPOS · ออกแบบสำหรับธุรกิจไทย 🇹🇭 · สงวนลิขสิทธิ์ : Created by KaoLuck</p>
            <div className="lp-foot-links">
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
              <a href="#">Cookies</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
