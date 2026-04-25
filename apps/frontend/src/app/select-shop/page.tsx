'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseClient } from '@/lib/supabase';
import { Skeleton } from '@/components/ui/Skeleton';
import { AuthHeader } from '@/components/layout/AuthHeader';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Shop {
  id: string;
  name: string;
}

export default function SelectShopPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchShops() {
      const supabase = createSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        window.location.href = '/login';
        return;
      }

      const res = await fetch(`${API_URL}/api/v1/me/shops`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json?.message ?? json?.error ?? 'โหลดข้อมูลร้านไม่สำเร็จ');
        setLoading(false);
        return;
      }

      const json = await res.json();
      setShops(json.data ?? []);
      setLoading(false);
    }
    fetchShops();
  }, []);

  if (loading) {
    return (
      <main className="page-select-shop min-h-screen flex flex-col items-stretch justify-start">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
          <AuthHeader title="เลือกร้าน" />
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

  return (
    <main className="page-select-shop min-h-screen flex flex-col items-stretch justify-start">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3">
        <AuthHeader title="เลือกร้าน" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <div className="page-select-shop__container">
          <h1 className="page-select-shop__title">เลือกร้าน</h1>
          {error ? (
            <p className="page-select-shop__error">{error}</p>
          ) : shops.length === 0 ? (
            <p className="page-select-shop__empty">ยังไม่มีร้านที่กำหนดให้</p>
          ) : (
            <div className="page-select-shop__list">
              {shops.map((shop) => (
                <Link
                  key={shop.id}
                  href={`/select-branch?shopId=${shop.id}&shopName=${encodeURIComponent(shop.name)}`}
                  className="card-select"
                >
                  {shop.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
