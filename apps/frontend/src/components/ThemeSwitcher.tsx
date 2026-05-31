'use client';

import { useEffect, useState } from 'react';
import {
  type AppTheme,
  applyThemeToDocument,
  getActiveUserIdFromStorage,
  getResolvedCurrentThemeForClient,
  persistThemeSelection,
} from '@/lib/theme-preference';

type Theme = AppTheme;

const THEMES: { id: Theme; label: string; icon: string; desc: string }[] = [
  { id: 'light', label: 'ขาว',      icon: '☀️', desc: 'Light'      },
  { id: 'warm',  label: 'มืดอุ่น', icon: '🔥', desc: 'Warm Dark'  },
  { id: 'ocean', label: 'ดำ',      icon: '🌊', desc: 'Ocean Dark' },
];

// Pre-defined bg colors per theme — read BEFORE switching so we don't need to query CSS
const THEME_BG: Record<Theme, string> = {
  warm:  '#0c0806',
  light: '#faf7f4',
  ocean: '#050d1a',
};

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
        if (theme === 'light') root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', theme);
        const uid = getActiveUserIdFromStorage();
        persistThemeSelection(theme, uid);

        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity    = '0';
        setTimeout(() => overlay.remove(), 320);
      }, 880);
    });
  });
}

interface ThemeSwitcherProps {
  variant?: 'floating' | 'topnav';
}

export function ThemeSwitcher({ variant = 'floating' }: ThemeSwitcherProps) {
  const [current, setCurrent] = useState<Theme>('light');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const r = getResolvedCurrentThemeForClient();
    setCurrent(r);
    applyThemeToDocument(r);
  }, [variant]);

  const select = (theme: Theme) => {
    setCurrent(theme);
    applyTheme(theme);
    setOpen(false);
  };

  const active = THEMES.find((t) => t.id === current)!;

  return (
    <div className={`theme-switcher${variant === 'topnav' ? ' theme-switcher--topnav' : ''}`}>
      <button
        className="theme-switcher__btn"
        onClick={() => setOpen((o) => !o)}
        title="เปลี่ยนธีม"
        aria-label="เปลี่ยนธีม"
      >
        <span className="theme-switcher__icon">{active.icon}</span>
        {variant === 'floating' && <span className="theme-switcher__label">{active.label}</span>}
        {variant === 'floating' && (
          <svg
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open && (
        <>
          <div className="theme-switcher__backdrop" onClick={() => setOpen(false)} />
          <div className="theme-switcher__dropdown">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-switcher__option${current === t.id ? ' theme-switcher--active' : ''}`}
                onClick={() => select(t.id)}
              >
                <span className="theme-switcher__option-icon">{t.icon}</span>
                <div className="theme-switcher__option-text">
                  <span className="theme-switcher__option-label">{t.label}</span>
                  <span className="theme-switcher__option-desc">{t.desc}</span>
                </div>
                {current === t.id && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
