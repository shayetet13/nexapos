'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { PROVINCES, BKK_DISTRICTS, IS_BANGKOK } from '@/lib/thai-provinces';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';
import {
  Card, Toast,
  type Shop, type Branch, type ShopUser, type DevStaffItem, type Subscription, type Notification,
  type OverviewData, type LeaderboardData, type TabId,
  formatCode,
} from '@/components/dev/dev-ui';
import { OverviewTab }      from '@/components/dev/OverviewTab';
import { LeaderboardTab }   from '@/components/dev/LeaderboardTab';
import { MonitorTab }       from '@/components/dev/MonitorTab';
import { ShopTab }          from '@/components/dev/ShopTab';
import { BranchTab }        from '@/components/dev/BranchTab';
import { UserTab }          from '@/components/dev/UserTab';
import { SubscriptionTab }  from '@/components/dev/SubscriptionTab';
import { NotifyTab }        from '@/components/dev/NotifyTab';
import { ResetTab }         from '@/components/dev/ResetTab';
import { AnalyticsTab }    from '@/components/dev/AnalyticsTab';
import { SubsManagerTab }  from '@/components/dev/SubsManagerTab';
import { LogsTab }         from '@/components/dev/LogsTab';
import { SettingsTab }     from '@/components/dev/SettingsTab';
import { DevMenuButton }   from '@/components/dev/DevMenuButton';
import { createSupabaseClient } from '@/lib/supabase';

// ─── Main page ────────────────────────────────────────────────────
export default function DevDashboardPage() {
  const confirm = useConfirm();
  const [isDev,       setIsDev]       = useState<boolean | null>(null);
  const [shops,       setShops]       = useState<Shop[]>([]);
  const [branches,    setBranches]    = useState<Branch[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState<TabId>('overview');
  const [overview,    setOverview]    = useState<OverviewData | null>(null);

  const [shopSearch,    setShopSearch]    = useState('');
  const [shopName,      setShopName]      = useState('');
  const [shopProvince,  setShopProvince]  = useState('');
  const [shopDistrict,  setShopDistrict]  = useState('');

  const [branchShopId,  setBranchShopId]  = useState('');
  const [branchName,    setBranchName]    = useState('');
  const [branchAddress, setBranchAddress] = useState('');

  const [userEmail,    setUserEmail]    = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userShopId,   setUserShopId]   = useState('');
  const [userRole,     setUserRole]     = useState('cashier');
  const [userBranchId, setUserBranchId] = useState('');
  const [userBranches, setUserBranches] = useState<Branch[]>([]);

  const [subShopId,  setSubShopId]  = useState('');
  const [subPlan,    setSubPlan]    = useState('basic');
  const [subInterval, setSubInterval] = useState<'monthly' | 'yearly' | 'once'>('monthly');
  const [subExpires, setSubExpires] = useState('');

  const [notifShopId, setNotifShopId] = useState('');
  const [notifType,   setNotifType]   = useState('custom');
  const [notifTitle,  setNotifTitle]  = useState('');
  const [notifMessage, setNotifMessage] = useState('');

  const [subscriptions, setSubscriptions] = useState<Record<string, Subscription | null>>({});
  const [notifList,     setNotifList]     = useState<Record<string, Notification[]>>({});
  const [monitorBranches, setMonitorBranches] = useState<Record<string, Branch[]>>({});
  const [monitorUsers,    setMonitorUsers]    = useState<Record<string, ShopUser[]>>({});
  const [monitorStaff,    setMonitorStaff]    = useState<Record<string, DevStaffItem[]>>({});
  const [expandedShop,  setExpandedShop]  = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // ── Overview period nav ─────────────────────────────────────────
  const [ovPeriod,    setOvPeriod]    = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [ovOffset,    setOvOffset]    = useState(0);
  const [ovLoading,   setOvLoading]   = useState(false);

  // ── Leaderboard ─────────────────────────────────────────────────
  const [lbPeriod,    setLbPeriod]    = useState<'day' | 'week' | 'month' | 'year'>('day');
  const [lbOffset,    setLbOffset]    = useState(0);
  const [lbMode,      setLbMode]      = useState<'live' | 'snapshot'>('live');
  const [lbData,      setLbData]      = useState<LeaderboardData | null>(null);
  const [lbLoading,   setLbLoading]   = useState(false);
  const [lbPage,      setLbPage]      = useState(0);
  const [lbCountdown, setLbCountdown] = useState('');
  const [snapLoading, setSnapLoading] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────
  const api = useCallback(async (path: string, options?: RequestInit) => {
    return fetchWithAuth(`${API_URL}${path}`, options);
  }, []);
  function showMsg(type: 'ok' | 'err', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }

  // ── Init ───────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    async function init() {
      try {
        const res = await api('/api/v1/dev/is-dev', { signal: controller.signal });
        if (!res.ok) {
          const msg = res.status === 503
            ? 'เชื่อมต่อ backend ไม่ได้ — กรุณาตรวจสอบว่า server กำลังทำงานอยู่'
            : 'ตรวจสอบสิทธิ์ไม่สำเร็จ';
          setError(msg); setLoading(false); return;
        }
        const json = await res.json();
        if (!json.data?.isDev) {
          setError('ไม่มีสิทธิ์เข้าถึง (เฉพาะ Dev admin เท่านั้น)');
          setIsDev(false); setLoading(false); return;
        }
        setIsDev(true);
        const shopsRes = await api('/api/v1/dev/shops', { signal: controller.signal });
        if (shopsRes.ok) {
          const j = await shopsRes.json();
          setShops(j.data ?? []);
          if ((j.data ?? []).length > 0) {
            if (!branchShopId) setBranchShopId(j.data[0].id);
            if (!userShopId)   setUserShopId(j.data[0].id);
            if (!subShopId)    setSubShopId(j.data[0].id);
            if (!notifShopId)  setNotifShopId(j.data[0].id);
          }
        }
        setLoading(false);
      } catch (err) {
        // AbortError = component unmounted — ignore silently
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError('เกิดข้อผิดพลาดที่ไม่คาดคิด');
        setLoading(false);
      }
    }
    void init();
    return () => controller.abort();
  }, [api, branchShopId, notifShopId, subShopId, userShopId]);

  useEffect(() => {
    if (!branchShopId) return;
    // Use dev-scoped endpoint — dev admin is not a shop member so shop-scoped /shops/:id/branches returns 403
    void fetchWithAuth(`${API_URL}/api/v1/dev/shops/${branchShopId}/branches`)
      .then((r) => r.json()).then((j) => setBranches(j.data ?? []));
  }, [branchShopId]);

  useEffect(() => {
    if (!userShopId) return;
    // Use dev-scoped endpoint for the same reason
    void fetchWithAuth(`${API_URL}/api/v1/dev/shops/${userShopId}/branches`)
      .then((r) => r.json()).then((j) => {
        const list = j.data ?? [];
        setUserBranches(list);
        setUserBranchId(list[0]?.id ?? '');
      });
  }, [userShopId]);

  const loadSubscription = useCallback(async (shopId: string) => {
    const res = await api(`/api/v1/dev/shops/${shopId}/subscription`);
    if (!res.ok) return;
    const j = await res.json();
    const sub = j.data as Subscription | null;
    setSubscriptions((prev) => ({ ...prev, [shopId]: sub }));
    if (sub) {
      setSubPlan(sub.plan);
      setSubInterval((sub.billing_interval as 'monthly' | 'yearly' | 'once') || 'monthly');
      setSubExpires(sub.expires_at ? sub.expires_at.slice(0, 10) : '');
    }
  }, [api]);

  useEffect(() => {
    if (activeTab === 'subscription' && subShopId) void loadSubscription(subShopId);
  }, [activeTab, subShopId, loadSubscription]);

  // ── Overview: reload on period / offset change ──────────────────
  useEffect(() => {
    if (isDev !== true) return;
    setOvLoading(true);
    void api(`/api/v1/dev/overview?period=${ovPeriod}&offset=${ovOffset}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j) setOverview(j.data ?? null); })
      .finally(() => setOvLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDev, ovPeriod, ovOffset]);

  // ── Leaderboard: reload on tab / period / offset / mode change ──
  useEffect(() => {
    if (activeTab !== 'leaderboard' || isDev !== true) return;
    setLbLoading(true);
    setLbPage(0);
    void api(`/api/v1/dev/leaderboard?period=${lbPeriod}&offset=${lbOffset}&mode=${lbMode}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j) setLbData(j.data ?? null); })
      .finally(() => setLbLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isDev, lbPeriod, lbOffset, lbMode]);

  // ── Countdown to next 23:00 Bangkok ────────────────────────────
  useEffect(() => {
    const tick = () => {
      const bkk  = new Date(Date.now() + 7 * 3_600_000);
      const next = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), 23, 0, 0));
      if (bkk.getUTCHours() >= 23) next.setUTCDate(next.getUTCDate() + 1);
      const diff = next.getTime() - bkk.getTime();
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setLbCountdown(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  // ── Actions ────────────────────────────────────────────────────
  async function loadMonitorBranches(shopId: string) {
    if (expandedShop === shopId) { setExpandedShop(null); return; }
    const [branchRes, userRes, staffRes] = await Promise.all([
      api(`/api/v1/dev/shops/${shopId}/branches`),  // dev-scoped: dev admin is not a shop member
      api(`/api/v1/dev/shops/${shopId}/users`),
      api(`/api/v1/dev/shops/${shopId}/staff`),     // dev-scoped: same reason
    ]);
    if (branchRes.ok) { const j = await branchRes.json(); setMonitorBranches((p) => ({ ...p, [shopId]: j.data ?? [] })); }
    if (userRes.ok)   { const j = await userRes.json();   setMonitorUsers((p) => ({ ...p, [shopId]: j.data ?? [] })); }
    if (staffRes.ok)  { const j = await staffRes.json();  setMonitorStaff((p) => ({ ...p, [shopId]: j.data ?? [] })); }
    setExpandedShop(shopId);
  }

  async function handleDeleteBranch(branchId: string, shopId: string) {
    const branch = (monitorBranches[shopId] ?? []).find((b) => b.id === branchId);
    const ok = await confirm({
      title: 'ลบสาขา',
      description: <><strong>{branch?.name ?? 'สาขานี้'}</strong> จะถูกลบออกจากระบบถาวร</>,
      variant: 'danger', icon: '🏪', confirmLabel: 'ลบสาขา',
    });
    if (!ok) return;
    const res = await api(`/api/v1/dev/branches/${branchId}`, { method: 'DELETE' });
    if (res.ok) {
      setMonitorBranches((p) => ({ ...p, [shopId]: (p[shopId] ?? []).filter((b) => b.id !== branchId) }));
      toast.success('ลบสาขาแล้ว');
    } else toast.error('ลบสาขาล้มเหลว');
  }

  async function handleToggleBranch(branch: Branch, shopId: string) {
    const res = await api(`/api/v1/dev/branches/${branch.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !branch.is_active }),
    });
    if (res.ok) {
      const j = await res.json();
      setMonitorBranches((p) => ({ ...p, [shopId]: (p[shopId] ?? []).map((b) => b.id === branch.id ? { ...b, is_active: j.data.is_active } : b) }));
    } else showMsg('err', 'อัปเดตสถานะล้มเหลว');
  }

  async function handleDeleteUser(userId: string, shopId: string) {
    const user = (monitorUsers[shopId] ?? []).find((u) => u.user_id === userId);
    const ok = await confirm({
      title: 'ลบ User ออกจากระบบ',
      description: <><strong>{user?.email ?? 'user นี้'}</strong> จะถูกลบออกจากทุกร้านในระบบถาวร<br />ไม่สามารถย้อนกลับได้</>,
      variant: 'danger', icon: '⚠️', confirmLabel: 'ลบ User',
    });
    if (!ok) return;
    const res = await api(`/api/v1/dev/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      setMonitorUsers((p) => ({ ...p, [shopId]: (p[shopId] ?? []).filter((u) => u.user_id !== userId) }));
      toast.success('ลบ user แล้ว');
    } else toast.error('ลบ user ล้มเหลว');
  }

  async function handleDeleteStaff(userId: string, shopId: string) {
    const staff = (monitorStaff[shopId] ?? []).find((s) => s.user_id === userId);
    const ok = await confirm({
      title: 'ลบพนักงาน PIN',
      description: <><strong>{staff?.nickname ?? 'พนักงานนี้'}</strong> จะถูกลบออกจากระบบถาวร<br />บัญชีและข้อมูลล็อกอินจะหายถาวร</>,
      variant: 'danger', icon: '👤', confirmLabel: 'ลบพนักงาน',
    });
    if (!ok) return;
    const res = await api(`/api/v1/dev/shops/${shopId}/staff/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      setMonitorStaff((p) => ({ ...p, [shopId]: (p[shopId] ?? []).filter((s) => s.user_id !== userId) }));
      toast.success('ลบพนักงานแล้ว');
    } else toast.error('ลบพนักงานล้มเหลว');
  }

  async function loadNotifications(shopId: string) {
    const res = await api(`/api/v1/dev/shops/${shopId}/notifications`);
    if (res.ok) { const j = await res.json(); setNotifList((p) => ({ ...p, [shopId]: j.data ?? [] })); }
  }

  async function handleToggleShopActive(shop: Shop) {
    const res = await api(`/api/v1/dev/shops/${shop.id}/active`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !shop.is_active }),
    });
    if (res.ok) {
      const j = await res.json();
      setShops((prev) => prev.map((s) => s.id === shop.id ? { ...s, ...j.data } : s));
      showMsg('ok', shop.is_active ? `ระงับร้าน "${shop.name}" แล้ว` : `เปิดใช้งานร้าน "${shop.name}" แล้ว`);
    } else showMsg('err', 'ไม่สามารถเปลี่ยนสถานะร้านได้');
  }

  async function handleBanShop(shop: Shop, reason: string) {
    const res = await api(`/api/v1/dev/shops/${shop.id}/ban`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_banned: true, reason }),
    });
    if (res.ok) {
      const j = await res.json();
      setShops((prev) => prev.map((s) => s.id === shop.id ? { ...s, ...j.data } : s));
      showMsg('ok', `แบนร้าน "${shop.name}" แล้ว`);
    } else showMsg('err', 'ไม่สามารถแบนร้านได้');
  }

  async function handleUnbanShop(shop: Shop) {
    const res = await api(`/api/v1/dev/shops/${shop.id}/ban`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_banned: false }),
    });
    if (res.ok) {
      const j = await res.json();
      setShops((prev) => prev.map((s) => s.id === shop.id ? { ...s, ...j.data } : s));
      showMsg('ok', `ปลดแบนร้าน "${shop.name}" แล้ว`);
    } else showMsg('err', 'ไม่สามารถปลดแบนได้');
  }

  async function handleDeleteShop(shop: Shop) {
    const res = await api(`/api/v1/dev/shops/${shop.id}`, { method: 'DELETE' });
    if (res.ok) {
      setShops((prev) => prev.filter((s) => s.id !== shop.id));
      showMsg('ok', `ลบร้าน "${shop.name}" แล้ว`);
    } else showMsg('err', 'ไม่สามารถลบร้านได้');
  }

  async function handleAddShop() {
    if (!shopName.trim()) return;
    let postal_code: string | undefined;
    if (IS_BANGKOK(shopProvince)) {
      postal_code = BKK_DISTRICTS.find((d) => d.name === shopDistrict)?.postal ?? PROVINCES.find((p) => p.name === shopProvince)?.postal;
    } else {
      postal_code = PROVINCES.find((p) => p.name === shopProvince)?.postal;
    }
    const res = await api('/api/v1/dev/shops', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: shopName.trim(), province: shopProvince || undefined, district: shopDistrict || undefined, postal_code }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setShops((prev) => [...prev, j.data]);
      setShopName(''); setShopProvince(''); setShopDistrict('');
      const code = (j.data as Shop).shop_code;
      showMsg('ok', code ? `สร้างร้านแล้ว — ${formatCode(code)}` : 'สร้างร้านแล้ว');
    } else showMsg('err', (j as { error?: { message?: string } }).error?.message ?? 'ล้มเหลว');
  }

  async function handleAddBranch() {
    if (!branchShopId || !branchName.trim()) return;
    const res = await api(`/api/v1/dev/shops/${branchShopId}/branches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: branchName.trim(), address: branchAddress.trim() || undefined }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setBranches((p) => [...p, j.data]); setBranchName(''); setBranchAddress(''); showMsg('ok', 'สร้างสาขาแล้ว'); }
    else showMsg('err', (j as { error?: { message?: string } }).error?.message ?? 'ล้มเหลว');
  }

  async function handleAddUser() {
    if (!userEmail.trim() || !userPassword || !userShopId) return;
    const res = await api('/api/v1/dev/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail.trim(), password: userPassword,
        shopId: userShopId, role: userRole,
        branchId: (userRole === 'cashier' || userRole === 'viewer') && userBranchId ? userBranchId : undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setUserEmail(''); setUserPassword(''); showMsg('ok', 'สร้างผู้ใช้แล้ว'); }
    else showMsg('err', res.status === 503 ? 'ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY' : ((j as { error?: { message?: string } }).error?.message ?? 'ล้มเหลว'));
  }

  async function handleSaveSubscription() {
    if (!subShopId) return;
    const res = await api(`/api/v1/dev/shops/${subShopId}/subscription`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: subPlan, billing_interval: subInterval, expires_at: subExpires || null }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setSubscriptions((p) => ({ ...p, [subShopId]: j.data })); showMsg('ok', 'อัปเดตแล้ว'); }
    else showMsg('err', (j as { error?: { message?: string } }).error?.message ?? 'ล้มเหลว');
  }

  async function handleSendNotification() {
    if (!notifShopId || !notifTitle.trim()) return;
    const res = await api(`/api/v1/dev/shops/${notifShopId}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: notifType, title: notifTitle.trim(), message: notifMessage.trim() || undefined }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { void loadNotifications(notifShopId); setNotifTitle(''); setNotifMessage(''); showMsg('ok', 'ส่งแล้ว'); }
    else showMsg('err', (j as { error?: { message?: string } }).error?.message ?? 'ล้มเหลว');
  }

  // ── Logout ──────────────────────────────────────────────────────
  async function handleLogout() {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  // ── PDF report ─────────────────────────────────────────────────
  function printDevReport() {
    if (!overview) return;
    const pLabel = ovPeriod === 'day' ? 'วัน' : ovPeriod === 'week' ? 'สัปดาห์' : ovPeriod === 'month' ? 'เดือน' : 'ปี';
    const rows = [...overview.shops]
      .sort((a, b) => b.revenue_period - a.revenue_period)
      .map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${s.name}${s.shop_code ? ` <small style="color:#888">${s.shop_code}</small>` : ''}</td>
        <td>${s.province ?? '—'}</td>
        <td class="num">${s.revenue_period.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
        <td class="num">${s.revenue_today.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
        <td class="num">${s.order_count_period}</td>
        <td>${s.subscription?.plan ?? '—'}</td>
        <td>${s.subscription?.expires_at ? new Date(s.subscription.expires_at).toLocaleDateString('th-TH') : '—'}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8">
<title>รายงาน NexaPos — ${overview.period_label}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sarabun',sans-serif;font-size:13px;color:#1a1a2e;background:#fff;padding:24px 32px}
  h1{font-size:20px;font-weight:700;margin-bottom:4px}
  .sub{color:#6b7280;font-size:12px;margin-bottom:20px}
  .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
  .kpi-box{border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px}
  .kpi-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
  .kpi-value{font-size:18px;font-weight:700;color:#111827;margin-top:4px}
  .kpi-value.accent{color:#0ea5e9}
  table{width:100%;border-collapse:collapse;font-size:12px}
  thead tr{background:#f1f5f9}
  th{text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#374151;border-bottom:2px solid #e5e7eb;white-space:nowrap}
  td{padding:7px 10px;border-bottom:1px solid #f3f4f6}
  tr:nth-child(even){background:#f9fafb}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .footer{margin-top:20px;font-size:11px;color:#9ca3af;text-align:right}
  @media print{body{padding:10mm 12mm}@page{margin:10mm;size:A4 landscape}}
</style></head><body>
<h1>📊 รายงาน NexaPos</h1>
<p class="sub">ช่วงเวลา: ${overview.period_label} &nbsp;·&nbsp; ประจำ${pLabel} &nbsp;·&nbsp; พิมพ์: ${new Date().toLocaleString('th-TH')}</p>
<div class="kpi">
  <div class="kpi-box"><div class="kpi-label">ร้านทั้งหมด</div><div class="kpi-value">${overview.total_shops} ร้าน</div></div>
  <div class="kpi-box"><div class="kpi-label">รายได้ช่วงนี้</div><div class="kpi-value accent">${overview.revenue_period.toLocaleString('th-TH',{minimumFractionDigits:2})} ฿</div></div>
  <div class="kpi-box"><div class="kpi-label">รายได้วันนี้</div><div class="kpi-value">${overview.revenue_today.toLocaleString('th-TH',{minimumFractionDigits:2})} ฿</div></div>
  <div class="kpi-box"><div class="kpi-label">สาขา / ผู้ใช้</div><div class="kpi-value">${overview.total_branches} / ${overview.total_users}</div></div>
</div>
<table><thead><tr>
  <th>#</th><th>ร้าน</th><th>จังหวัด</th>
  <th class="num">รายได้${pLabel}นี้ (฿)</th>
  <th class="num">รายได้วันนี้ (฿)</th>
  <th class="num">ออเดอร์</th>
  <th>แผน</th><th>หมดอายุ</th>
</tr></thead><tbody>${rows}</tbody></table>
<p class="footer">สร้างโดย NexaPos Dev Console · ${new Date().toLocaleString('th-TH')}</p>
</body></html>`;
    const w = window.open('', '_blank', 'width=1050,height=720');
    if (!w) { showMsg('err', 'เปิดหน้าต่างไม่ได้ — ตรวจสอบการตั้งค่า popup blocker'); return; }
    w.document.write(html);
    w.document.close();
    w.addEventListener('load', () => w.print());
  }

  // ── Manual snapshot ─────────────────────────────────────────────
  async function handleTakeSnapshot() {
    setSnapLoading(true);
    try {
      const res = await api('/api/v1/dev/snapshot', { method: 'POST' });
      if (res.ok) {
        showMsg('ok', 'บันทึก snapshot เรียบร้อย');
        if (activeTab === 'leaderboard') {
          void api(`/api/v1/dev/leaderboard?period=${lbPeriod}&offset=${lbOffset}&mode=${lbMode}`)
            .then((r) => r.ok ? r.json() : null)
            .then((j) => { if (j) setLbData(j.data ?? null); });
        }
      } else showMsg('err', 'บันทึก snapshot ล้มเหลว');
    } finally { setSnapLoading(false); }
  }

  // ── Reset handler — clears local state after full DB reset ────────
  function handleReset() {
    setShops([]);
    setBranches([]);
    setSubscriptions({});
    setNotifList({});
    setMonitorBranches({});
    setMonitorUsers({});
    setExpandedShop(null);
    setOverview(null);
  }

  // ── Navigate to subscription tab for a given shop ───────────────
  function goToSubscription(shopId: string) {
    setSubShopId(shopId);
    setActiveTab('subscription');
    void loadSubscription(shopId);
  }

  // ── Navigate to notify tab for a given shop ─────────────────────
  function goToNotify(shopId: string) {
    setNotifShopId(shopId);
    setActiveTab('notify');
    void loadNotifications(shopId);
  }

  // ── Loading / Error states ─────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-sm text-[var(--color-text-muted)] animate-pulse">กำลังโหลด...</div>
      </div>
    );
  }

  if (!isDev || error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <Card className="p-8 max-w-sm w-full text-center space-y-4">
          <p className="text-2xl">🚫</p>
          <p className="text-sm text-red-400">{error ?? 'ไม่มีสิทธิ์เข้าถึง'}</p>
          <Link href="/dashboard" className="text-xs text-[var(--color-primary)] underline">← แดชบอร์ด</Link>
        </Card>
      </div>
    );
  }

  // ── Tabs config ────────────────────────────────────────────────
  const tabs: { id: TabId; icon: string; label: string; desc: string }[] = [
    { id: 'overview',     icon: '📈', label: 'ภาพรวม',      desc: 'สรุปยอดทุกร้าน' },
    { id: 'leaderboard',  icon: '🏆', label: 'Leaderboard', desc: 'ร้านขายดีประจำงวด' },
    { id: 'monitor',      icon: '📊', label: 'ตรวจสอบ',    desc: `${shops.length} ร้านในระบบ` },
    { id: 'shop',         icon: '🏪', label: 'เพิ่มร้าน',   desc: 'สร้างและค้นหาร้าน' },
    { id: 'branch',       icon: '🏢', label: 'เพิ่มสาขา',  desc: 'เพิ่มสาขาให้ร้าน' },
    { id: 'user',         icon: '👤', label: 'เพิ่มผู้ใช้', desc: 'สร้าง login ให้สมาชิก' },
    { id: 'subscription', icon: '💳', label: 'ต่ออายุ',     desc: 'จัดการแผนและวันหมดอายุ' },
    { id: 'notify',       icon: '🔔', label: 'แจ้งเตือน',   desc: 'ส่งข้อความไปยังร้าน' },
    { id: 'analytics',   icon: '📊', label: 'Analytics',     desc: 'MRR/ARR และการเติบโต' },
    { id: 'subs',        icon: '💳', label: 'Subscriptions', desc: 'จัดการ subscription ทุกร้าน' },
    { id: 'logs',        icon: '📋', label: 'Activity Logs', desc: 'Audit trail ทุกการกระทำ' },
    { id: 'settings',   icon: '⚙️',  label: 'Settings',      desc: 'Stripe links และการตั้งค่าระบบ' },
    { id: 'reset',        icon: '☢️', label: 'รีเซตข้อมูล', desc: 'ล้างข้อมูลทดสอบทั้งหมด' },
  ];
  const curTab = tabs.find((t) => t.id === activeTab)!;

  // ── Computed: shop search filter ───────────────────────────────
  const q = shopSearch.trim().toLowerCase();
  const filteredShops = q
    ? shops.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        (s.shop_code ?? '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.postal_code ?? '').includes(q) ||
        (s.promptpay_number ?? '').includes(q),
      )
    : shops;

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="dev-console-wrap flex min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* ── Toast ────────────────────────────────────────────────── */}
      {message && <Toast msg={message} onClose={() => setMessage(null)} />}

      {/* ══ SIDEBAR ══════════════════════════════════════════════ */}
      <aside className="w-52 shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-card)]">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-[var(--color-border)]">
          <p className="text-[10px] font-mono font-semibold tracking-widest text-[var(--color-primary)] uppercase">Dev Console</p>
          <p className="text-sm font-bold text-[var(--color-text)] mt-0.5">NexaPos</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeTab === t.id
                  ? 'bg-[var(--color-primary)] text-black font-semibold'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              <span className="text-base leading-none">{t.icon}</span>
              <span className="leading-none">{t.label}</span>
            </button>
          ))}
        </nav>

      </aside>

      {/* ══ MAIN ═════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-[var(--color-text)]">
              {curTab.icon} {curTab.label}
            </h1>
            <p className="text-xs text-[var(--color-text-muted)]">{curTab.desc}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
              {shops.length} ร้าน
            </span>
            <DevMenuButton onLogout={() => void handleLogout()} />
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className={`${activeTab === 'overview' ? 'max-w-6xl' : 'max-w-4xl'} mx-auto space-y-5`}>

            {activeTab === 'overview' && (
              <OverviewTab
                overview={overview}
                ovPeriod={ovPeriod}
                ovOffset={ovOffset}
                ovLoading={ovLoading}
                setOvPeriod={setOvPeriod}
                setOvOffset={setOvOffset}
                onPrintReport={printDevReport}
                onGoToSubscription={goToSubscription}
              />
            )}

            {activeTab === 'leaderboard' && (
              <LeaderboardTab
                lbPeriod={lbPeriod}
                lbOffset={lbOffset}
                lbMode={lbMode}
                lbData={lbData}
                lbLoading={lbLoading}
                lbPage={lbPage}
                lbCountdown={lbCountdown}
                snapLoading={snapLoading}
                setLbPeriod={setLbPeriod}
                setLbOffset={setLbOffset}
                setLbMode={setLbMode}
                setLbPage={setLbPage}
                onTakeSnapshot={() => void handleTakeSnapshot()}
              />
            )}

            {activeTab === 'monitor' && (
              <MonitorTab
                shops={shops}
                expandedShop={expandedShop}
                monitorBranches={monitorBranches}
                monitorUsers={monitorUsers}
                monitorStaff={monitorStaff}
                onLoadMonitorBranches={(id) => void loadMonitorBranches(id)}
                onToggleBranch={(branch, shopId) => void handleToggleBranch(branch, shopId)}
                onDeleteBranch={(branchId, shopId) => void handleDeleteBranch(branchId, shopId)}
                onDeleteUser={(userId, shopId) => void handleDeleteUser(userId, shopId)}
                onDeleteStaff={(userId, shopId) => void handleDeleteStaff(userId, shopId)}
                onGoToSubscription={goToSubscription}
                onGoToNotify={goToNotify}
              />
            )}

            {activeTab === 'shop' && (
              <ShopTab
                shops={shops}
                shopName={shopName}
                shopProvince={shopProvince}
                shopDistrict={shopDistrict}
                shopSearch={shopSearch}
                filteredShops={filteredShops}
                q={q}
                setShopName={setShopName}
                setShopProvince={setShopProvince}
                setShopDistrict={setShopDistrict}
                setShopSearch={setShopSearch}
                onAddShop={()           => void handleAddShop()}
                onToggleActive={(shop)  => void handleToggleShopActive(shop)}
                onBanShop={(shop, r)    => void handleBanShop(shop, r)}
                onUnbanShop={(shop)     => void handleUnbanShop(shop)}
                onDeleteShop={(shop)    => void handleDeleteShop(shop)}
              />
            )}

            {activeTab === 'branch' && (
              <BranchTab
                shops={shops}
                branches={branches}
                branchShopId={branchShopId}
                branchName={branchName}
                branchAddress={branchAddress}
                setBranchShopId={setBranchShopId}
                setBranchName={setBranchName}
                setBranchAddress={setBranchAddress}
                onAddBranch={() => void handleAddBranch()}
              />
            )}

            {activeTab === 'user' && (
              <UserTab
                shops={shops}
                userEmail={userEmail}
                userPassword={userPassword}
                userShopId={userShopId}
                userRole={userRole}
                userBranchId={userBranchId}
                userBranches={userBranches}
                setUserEmail={setUserEmail}
                setUserPassword={setUserPassword}
                setUserShopId={setUserShopId}
                setUserRole={setUserRole}
                setUserBranchId={setUserBranchId}
                onAddUser={() => void handleAddUser()}
              />
            )}

            {activeTab === 'subscription' && (
              <SubscriptionTab
                shops={shops}
                subShopId={subShopId}
                subPlan={subPlan}
                subInterval={subInterval}
                subExpires={subExpires}
                subscriptions={subscriptions}
                setSubShopId={setSubShopId}
                setSubPlan={setSubPlan}
                setSubInterval={setSubInterval}
                setSubExpires={setSubExpires}
                onLoadSubscription={(id) => void loadSubscription(id)}
                onSaveSubscription={() => void handleSaveSubscription()}
              />
            )}

            {activeTab === 'notify' && (
              <NotifyTab
                shops={shops}
                notifShopId={notifShopId}
                notifType={notifType}
                notifTitle={notifTitle}
                notifMessage={notifMessage}
                notifList={notifList}
                setNotifShopId={setNotifShopId}
                setNotifType={setNotifType}
                setNotifTitle={setNotifTitle}
                setNotifMessage={setNotifMessage}
                onLoadNotifications={(id) => void loadNotifications(id)}
                onSendNotification={() => void handleSendNotification()}
              />
            )}

            {activeTab === 'reset' && (
              <ResetTab onReset={handleReset} />
            )}

            {activeTab === 'analytics' && <AnalyticsTab />}
            {activeTab === 'subs'      && <SubsManagerTab shops={shops} />}
            {activeTab === 'logs'      && <LogsTab shops={shops} />}
            {activeTab === 'settings'  && <SettingsTab />}

          </div>
        </div>
      </div>
    </div>
  );
}
