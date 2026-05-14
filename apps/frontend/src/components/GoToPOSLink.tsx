'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ShopMode } from '@/lib/work-area';
import { workAreaHref } from '@/lib/work-area';

interface GoToPOSLinkProps {
  className?: string;
  children: React.ReactNode;
  /** fallback URL ถ้าไม่มี localStorage (default: /select-shop) */
  fallback?: string;
}

/**
 * ลิงก์ไปหน้า POS โดยอ่านสาขาล่าสุดจาก localStorage (pos_last)
 * ถ้ายังไม่เคยเข้า พื้นที่คิดเงิน จะ fallback ไป /select-shop
 */
export function GoToPOSLink({ className, children, fallback = '/select-shop' }: GoToPOSLinkProps) {
  const [href, setHref] = useState<string>(fallback);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('pos_last');
      if (raw) {
        const { shopId, shopName, branchId, branchName, shop_mode } = JSON.parse(raw) as {
          shopId: string; shopName: string; branchId: string; branchName: string; shop_mode?: ShopMode;
        };
        if (shopId && branchId) {
          setHref(workAreaHref({
            shopId, shopName, branchId, branchName, shopMode: shop_mode ?? 'retail',
          }));
        }
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
