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

export const metadata: Metadata = {
  title: 'NexaPos',
  description: 'ระบบจัดการร้านค้าครบวงจร',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#bf4422',
};

/* Prevent flash of wrong theme — runs before React hydration */
const themeInitScript = `
(function() {
  try {
    var isMobile = window.matchMedia('(pointer: coarse)').matches;
    if (isMobile) {
      // Mobile: follow OS — dark OS = warm (default, no attr), light OS = light theme
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (!prefersDark) document.documentElement.setAttribute('data-theme', 'light');
      return;
    }
    // Desktop: use saved preference
    var t = localStorage.getItem('nexapos-theme');
    if (t && t !== 'warm') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch(e) {}
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
