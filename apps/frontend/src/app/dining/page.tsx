'use client';

/**
 * พื้นที่ภัตตาคาร (/dining) — โค้ดร่วม POSContent เดียวกัน โหมด experience="dining"
 * เลย์เอาต์/ธีมแยก: โซนโต๊ะเป็นตารางเม็ดเลือก, ธีมมืดเน้นทอง, ระหว่าง header กับเมนู
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/supabase';
import { POSContent, POSPageSkeleton } from '@/components/pos/POSContent';
import type { ShopMode } from '@/lib/work-area';
import { API_URL } from '@/lib/config';

function DiningGate() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const shopId       = searchParams.get('shopId');
  const branchId     = searchParams.get('branchId');
  const shopName     = searchParams.get('shopName') ?? '';

  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = searchParams.toString();

    async function run() {
      if (!shopId) {
        router.replace('/select-shop');
        return;
      }
      if (!branchId) {
        router.replace(`/select-branch?shopId=${shopId}&shopName=${encodeURIComponent(shopName)}`);
        return;
      }

      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/pos-config`);
      if (!res.ok) {
        router.replace(`/pos?${q}`);
        return;
      }
      const json = await res.json() as { data?: { shop_mode?: ShopMode } };
      const mode = json.data?.shop_mode ?? 'retail';
      if (cancelled) return;
      if (mode !== 'full_service_restaurant') {
        router.replace(`/pos?${q}`);
        return;
      }
      setReady(true);
    }
    void run();
    return () => { cancelled = true; };
  }, [shopId, branchId, shopName, router, searchParams]);

  if (!ready) return <POSPageSkeleton variant="dining" />;
  return <POSContent experience="dining" />;
}

export default function DiningPage() {
  return (
    <Suspense fallback={<POSPageSkeleton variant="dining" />}>
      <DiningGate />
    </Suspense>
  );
}
