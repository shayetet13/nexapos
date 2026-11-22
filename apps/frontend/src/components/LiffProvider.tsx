'use client';

import { useEffect } from 'react';

function isLineInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Line\//i.test(navigator.userAgent);
}

export function LiffProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) return;
    if (!isLineInAppBrowser()) return;

    import('@line/liff').then(({ default: liff }) => {
      liff.init({ liffId }).catch(() => {});
    });
  }, []);

  return <>{children}</>;
}
