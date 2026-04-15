'use client';

import { useEffect, useState } from 'react';

type Theme = 'warm' | 'light' | 'ocean';

const THEMES: { id: Theme; label: string; icon: string; desc: string }[] = [
  { id: 'warm',  label: 'ธีมหลัก', icon: '🔥', desc: 'Warm Dark'  },
  { id: 'light', label: 'ขาว',     icon: '☀️', desc: 'Light'      },
  { id: 'ocean', label: 'ดำ',      icon: '🌊', desc: 'Ocean Dark' },
];

const STORAGE_KEY = 'nexapos-theme';

const THEME_BG: Record<Theme, string> = {
  warm:  '#0c0806',
  light: '#faf7f4',
  ocean: '#050d1a',
};

function applyThemeSilent(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'warm') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

function applyThemeAttr(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'warm') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:      'fixed',
    inset:         '0',
    zIndex:        '999998',
    pointerEvents: 'none',
    background:    THEME_BG[theme],
    clipPath:      'circle(0% at 100% 0%)',
  });
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.transition = 'clip-path 0.85s cubic-bezier(0.76, 0, 0.24, 1)';
      overlay.style.clipPath   = 'circle(142% at 100% 0%)';
      setTimeout(() => {
        if (theme === 'warm') root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity    = '0';
        setTimeout(() => overlay.remove(), 320);
      }, 880);
    });
  });
}

interface UserMenuButtonProps {
  onLogout: () => void;
}

export function UserMenuButton({ onLogout }: UserMenuButtonProps) {
  const [current, setCurrent] = useState<Theme>('warm');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isMobile = window.matchMedia('(pointer: coarse) and (max-width: 767px)').matches;
    if (isMobile) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystem = () => {
        const theme: Theme = mq.matches ? 'warm' : 'light';
        setCurrent(theme);
        applyThemeAttr(theme);
      };
      applySystem();
      mq.addEventListener('change', applySystem);
      return () => mq.removeEventListener('change', applySystem);
    }
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved && THEMES.some((t) => t.id === saved)) {
      setCurrent(saved);
      applyThemeSilent(saved);
    }
  }, []);

  const selectTheme = (theme: Theme) => {
    setCurrent(theme);
    applyTheme(theme);
    setOpen(false);
  };

  const activeTheme = THEMES.find((t) => t.id === current)!;

  return (
    <div className="user-menu">
      {/* Trigger button */}
      <button
        type="button"
        className="user-menu__btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="เมนูผู้ใช้"
        title="ธีม / ออกจากระบบ"
      >
        <span className="user-menu__btn-icon">{activeTheme.icon}</span>
        <svg
          className={`user-menu__btn-chevron${open ? ' user-menu__btn-chevron--open' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="user-menu__backdrop" onClick={() => setOpen(false)} />
          <div className="user-menu__dropdown">
            {/* Theme section */}
            <div className="user-menu__section-label">ธีม</div>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`user-menu__option${current === t.id ? ' user-menu__option--active' : ''}`}
                onClick={() => selectTheme(t.id)}
              >
                <span className="user-menu__option-icon">{t.icon}</span>
                <span className="user-menu__option-label">{t.label}</span>
                {current === t.id && (
                  <svg
                    className="user-menu__option-check"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}

            {/* Divider + Logout */}
            <div className="user-menu__divider" />
            <button
              type="button"
              className="user-menu__logout"
              onClick={() => { setOpen(false); onLogout(); }}
            >
              <span className="user-menu__logout-icon">→</span>
              ออกจากระบบ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
