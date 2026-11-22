'use client';

import { useEffect, useState } from 'react';

export function PWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<{ prompt: () => Promise<{ outcome: string }> } | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {});

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as unknown as { prompt: () => Promise<{ outcome: string }> });
      const dismissed = typeof localStorage !== 'undefined' && localStorage.getItem('pwa-install-dismissed');
      if (!dismissed) setShowBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    setShowBanner(false);
    if (typeof localStorage !== 'undefined') localStorage.setItem('pwa-install-dismissed', '1');
  }

  function dismiss() {
    setShowBanner(false);
    if (typeof localStorage !== 'undefined') localStorage.setItem('pwa-install-dismissed', '1');
  }

  if (!showBanner || !deferredPrompt) return null;

  return (
    <div className="pwa-banner">
      <p className="pwa-banner__text">ติดตั้ง NexaPos เพื่อเข้าถึงได้รวดเร็ว</p>
      <div className="pwa-banner__actions">
        <button type="button" onClick={handleInstall} className="pwa-banner__btn pwa-banner__btn--primary">
          ติดตั้ง
        </button>
        <button type="button" onClick={dismiss} className="pwa-banner__btn pwa-banner__btn--secondary">
          ไว้ทีหลัง
        </button>
      </div>
    </div>
  );
}
