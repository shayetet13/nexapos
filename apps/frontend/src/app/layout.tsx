import type { Metadata, Viewport } from 'next';
import { Sora } from 'next/font/google';
import { Toaster } from 'sonner';
import '@/styles/index.css';
import { PWAInstall } from '@/components/PWAInstall';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';

const sora = Sora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sora',
});

const BASE_URL = 'https://nexapos.io';
const OG_DESCRIPTION =
  'NexaPos ระบบ POS จัดการร้านค้าครบวงจร รองรับการขาย สต็อกสินค้า รายงานยอดขาย และการชำระเงิน ใช้งานง่าย เริ่มต้นได้ทันที ไม่ต้องติดตั้ง';

export const metadata: Metadata = {
  title: 'NexaPos — ระบบเดียว จัดการง่าย ขายรวดเร็ว ลองเลยวันนี้!',
  description: OG_DESCRIPTION,
  manifest: '/manifest.json',
  openGraph: {
    title: 'NexaPos — ระบบเดียว จัดการง่าย ขายรวดเร็ว ลองเลยวันนี้!',
    description: OG_DESCRIPTION,
    url: BASE_URL,
    siteName: 'NexaPos',
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'NexaPos — ระบบเดียว จัดการง่าย ขายรวดเร็ว ลองเลยวันนี้!',
      },
    ],
    locale: 'th_TH',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NexaPos — ระบบเดียว จัดการง่าย ขายรวดเร็ว ลองเลยวันนี้!',
    description: OG_DESCRIPTION,
    images: [`${BASE_URL}/og-image.png`],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#bf4422',
};

/* Prevent flash of wrong theme — runs before React hydration.
   ต่อ user: nexapos-theme:u:<userId> | guest: nexapos-theme | active: nexapos-theme-active-uid */
const themeInitScript = `
(function() {
  try {
    var UID_KEY = 'nexapos-theme-active-uid';
    var U_PREFIX = 'nexapos-theme:u:';
    var GUEST = 'nexapos-theme';
    function apply(t) {
      if (t === 'warm') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
    }
    function valid(t) { return t === 'warm' || t === 'light' || t === 'ocean'; }
    function defCoarse() {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'warm';
      return 'light';
    }
    var uid = localStorage.getItem(UID_KEY);
    if (uid) {
      var tu = localStorage.getItem(U_PREFIX + uid);
      if (valid(tu)) { apply(tu); return; }
      apply(defCoarse());
      return;
    }
    var g = localStorage.getItem(GUEST);
    if (valid(g)) { apply(g); return; }
    if (window.matchMedia('(pointer: coarse)').matches) {
      apply(defCoarse());
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={sora.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <ConfirmProvider>
          {children}
          <ThemeSwitcher />
          <PWAInstall />
          <Toaster
            position="top-right"
            richColors
            closeButton
            duration={3500}
            toastOptions={{
              style: { fontFamily: 'var(--font-sans)' },
            }}
          />
        </ConfirmProvider>
      </body>
    </html>
  );
}
