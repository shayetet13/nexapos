'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient, fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { NotificationBell } from '@/components/NotificationBell';
import { UserMenuButton } from '@/components/layout/UserMenuButton';

const DEV_EMAILS = (process.env.NEXT_PUBLIC_DEV_ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

interface AuthHeaderProps {
  title: string;
  backHref?: string;
  backLabel?: string;
  backToPOS?: boolean;
}

interface ShopWithRole { id: string; role?: string; }
interface PosAssignment { role: string; shopId: string; shopName: string; branchId: string | null; branchName: string | null; }

export function AuthHeader({ title, backHref, backLabel, backToPOS }: AuthHeaderProps) {
  const [isDev, setIsDev] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [primaryShopId, setPrimaryShopId] = useState<string | null>(null);
  const [posUrl, setPosUrl] = useState<string>('/select-shop');

  useEffect(() => {
    const supabase = createSupabaseClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setIsAdmin(false); return; }
      const email = session.user?.email?.toLowerCase() ?? '';
      setIsDev(DEV_EMAILS.length > 0 && DEV_EMAILS.includes(email));

      try {
        const [shopsRes, assignRes] = await Promise.all([
          fetchWithAuth(`${API_URL}/api/v1/me/shops`),
          fetchWithAuth(`${API_URL}/api/v1/me/pos-assignment`),
        ]);

        if (shopsRes.ok) {
          const json = await shopsRes.json();
          const shops = (json.data ?? []) as ShopWithRole[];
          const isAdminUser = shops.some((s) => s.role === 'owner' || s.role === 'manager');
          setIsAdmin(isAdminUser);
          if (isAdminUser && shops.length > 0) setPrimaryShopId(shops[0].id);
        } else {
          setIsAdmin(false);
        }

        // ── อ่าน last branch จาก localStorage ก่อนเสมอ ──
        try {
          const raw = localStorage.getItem('pos_last');
          if (raw) {
            const { shopId, shopName, branchId, branchName } = JSON.parse(raw) as {
              shopId: string; shopName: string; branchId: string; branchName: string;
            };
            if (shopId && branchId) {
              setPosUrl(`/pos?shopId=${shopId}&shopName=${encodeURIComponent(shopName)}&branchId=${branchId}&branchName=${encodeURIComponent(branchName)}`);
              return;
            }
          }
        } catch { /* ignore */ }

        if (assignRes.ok) {
          const aj = await assignRes.json();
          const d = aj.data as PosAssignment | null;
          if (d) {
            const isAdminRole = d.role === 'owner' || d.role === 'manager';
            if (isAdminRole) {
              setPosUrl(`/select-branch?shopId=${d.shopId}&shopName=${encodeURIComponent(d.shopName)}&posOnly=true`);
            } else if (d.branchId && d.branchName) {
              setPosUrl(`/pos?shopId=${d.shopId}&shopName=${encodeURIComponent(d.shopName)}&branchId=${d.branchId}&branchName=${encodeURIComponent(d.branchName)}`);
            } else {
              setPosUrl(`/select-branch?shopId=${d.shopId}&shopName=${encodeURIComponent(d.shopName)}&posOnly=true`);
            }
          }
        }
      } catch {
        setIsAdmin(false);
      }
    });
  }, []);

  async function handleLogout() {
    const supabase = createSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  const resolvedBackHref = backToPOS ? posUrl : backHref;
  const resolvedBackLabel = backLabel ?? '← กลับ';

  return (
    <header className="auth-header">
      <div className="auth-header__left">
        {resolvedBackHref && (
          <Link href={resolvedBackHref} className="auth-header__link auth-header__link--back">
            {resolvedBackLabel}
          </Link>
        )}
        <h1 className="auth-header__title">{title}</h1>
        <nav className="auth-header__nav">
          {isAdmin === true && title !== 'แดชบอร์ด' && (
            <Link href="/dashboard" className="auth-header__link">
              แดชบอร์ด
            </Link>
          )}
          {isAdmin === true && title !== 'จัดการร้าน' && (
            <Link href="/admin" className="auth-header__link auth-header__link--admin">
              จัดการร้าน
            </Link>
          )}
          {isAdmin === true && title !== 'Subscription' && (
            <Link href={`/subscription${primaryShopId ? `?shopId=${primaryShopId}` : ''}`} className="auth-header__link">
              Subscription
            </Link>
          )}
          {isDev && title !== 'แดชบอร์ดนักพัฒนา' && (
            <Link href="/dev" className="auth-header__link">
              นักพัฒนา
            </Link>
          )}
        </nav>
      </div>
      <div className="auth-header__right">
        {primaryShopId && <NotificationBell shopId={primaryShopId} />}
        <UserMenuButton
          onLogout={handleLogout}
          adminHref={isAdmin === true && title !== 'จัดการร้าน' ? '/admin' : undefined}
        />
      </div>
    </header>
  );
}
