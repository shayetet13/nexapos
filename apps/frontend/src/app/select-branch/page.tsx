'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { Skeleton } from '@/components/ui/Skeleton';
import { AuthHeader } from '@/components/layout/AuthHeader';
import type { ShopMode } from '@/lib/work-area';
import { workAreaHref } from '@/lib/work-area';
import { API_URL } from '@/lib/config';

interface Branch {
  id: string;
  name: string;
  address?: string;
}

type UserRole = 'owner' | 'manager' | 'cashier' | 'viewer' | null;

function SelectBranchContent() {
  const searchParams = useSearchParams();
  const shopId    = searchParams.get('shopId');
  const shopName  = searchParams.get('shopName') ?? 'ร้าน';
  const fromLogin = searchParams.get('from') === 'login';
  const posOnly   = searchParams.get('posOnly') === 'true';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [deskMode, setDeskMode]   = useState<ShopMode>('retail');
  const [role, setRole]         = useState<UserRole>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;

    async function fetchData() {
      const supabase = createSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        window.location.href = '/login';
        return;
      }

      const token = session.access_token;
      const authHeader = { Authorization: `Bearer ${token}` };
      const err503 = () => new Response('{}', { status: 503 });

      const [branchRes, roleRes, configRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/shops/${shopId}/branches`, { headers: authHeader }).catch(err503),
        fetch(`${API_URL}/api/v1/me/pos-assignment`,        { headers: authHeader }).catch(err503),
        fetch(`${API_URL}/api/v1/shops/${shopId}/pos-config`, { headers: authHeader }).catch(err503),
      ]);

      if (!branchRes.ok) {
        setError('โหลดข้อมูลสาขาไม่สำเร็จ');
        setLoading(false);
        return;
      }

      const branchJson = await branchRes.json();
      setBranches(branchJson.data ?? []);

      if (roleRes.ok) {
        const roleJson = await roleRes.json();
        setRole((roleJson.data?.role as UserRole) ?? null);
      }

      if (configRes.ok) {
        try {
          const cj = await configRes.json() as { data?: { shop_mode?: ShopMode } };
          setDeskMode(cj.data?.shop_mode ?? 'retail');
        } catch { /* ignore */ }
      }

      setLoading(false);
    }

    fetchData();
  }, [shopId]);

  if (!shopId) {
    return (
      <main className="page-select-branch__invalid">
        <p className="page-select-branch__invalid-text">ร้านไม่ถูกต้อง</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen flex flex-col items-stretch justify-start">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
          {fromLogin
            ? <AuthHeader title="เลือกสาขา" />
            : <AuthHeader title="เลือกสาขา" backHref="/select-shop" backLabel="← ร้าน" />
          }
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6">
          <div className="page-select-shop__skeleton-container">
            <Skeleton className="h-8 w-48" />
            <div className="page-select-shop__skeleton-list">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const isAdmin = role === 'owner' || role === 'manager';

  const deskHref = (branchId: string, branchName: string) =>
    workAreaHref({
      shopId:     shopId!,
      shopName,
      branchId,
      branchName,
      shopMode:   deskMode,
    });

  const deskPrimaryLabel =
    deskMode === 'full_service_restaurant' ? '🍽 เข้าระบบภัตตาคาร' : '🏪 เปิด POS';

  return (
    <main className="min-h-screen flex flex-col items-stretch justify-start">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
        {fromLogin
          ? <AuthHeader title="เลือกสาขา" />
          : <AuthHeader title="เลือกสาขา" backHref="/select-shop" backLabel="← ร้าน" />
        }
      </div>
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <div className="page-select-branch__container">
          <div>
            <p className="page-select-branch__shop-name">{shopName}</p>
            <h1 className="page-select-branch__title">เลือกสาขา</h1>
          </div>

          {error ? (
            <p className="page-select-branch__error">{error}</p>
          ) : branches.length === 0 ? (
            <p className="page-select-branch__empty">ยังไม่มีสาขา</p>
          ) : (
            <div className="page-select-branch__list">
              {branches.map((branch) => (
                isAdmin && !posOnly ? (
                  /* Owner / Manager — two action buttons (ยกเว้นโหมด posOnly) */
                  <div key={branch.id} className="page-select-branch__branch-card">
                    <span className="page-select-branch__branch-name">{branch.name}</span>
                    <div className="page-select-branch__branch-actions">
                      <Link
                        href={deskHref(branch.id, branch.name)}
                        className="page-select-branch__btn-pos"
                      >
                        {deskPrimaryLabel}
                      </Link>
                      <Link
                        href={`/admin?shopId=${shopId}`}
                        className="page-select-branch__btn-admin"
                      >
                        ⚙ จัดการ
                      </Link>
                    </div>
                  </div>
                ) : (
                  /* Cashier / Viewer / posOnly — single POS link */
                  <Link
                    key={branch.id}
                    href={deskHref(branch.id, branch.name)}
                    className="card-select"
                  >
                    {branch.name}
                  </Link>
                )
              ))}
            </div>
          )}

          {!fromLogin && (
            <Link href="/select-shop" className="page-select-branch__back">
              ← กลับไปเลือกร้าน
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

export default function SelectBranchPage() {
  return (
    <Suspense fallback={<div className="page-select-branch__invalid">กำลังโหลด...</div>}>
      <SelectBranchContent />
    </Suspense>
  );
}
