'use client';

import { useEffect } from 'react';

export function LiffProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) return;

    import('@line/liff').then(({ default: liff }) => {
      liff.init({ liffId }).catch(() => {});
    });
  }, []);

  return <>{children}</>;
}
