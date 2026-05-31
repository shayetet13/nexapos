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
        persistThemeSelection(theme, getActiveUserIdFromStorage());
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity    = '0';
        setTimeout(() => overlay.remove(), 320);
      }, 880);
    });
  });
}

interface DevMenuButtonProps {
  onLogout: () => void;
}

export function DevMenuButton({ onLogout }: DevMenuButtonProps) {
  const [current, setCurrent] = useState<Theme>('light');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const r = getResolvedCurrentThemeForClient();
    if (THEMES.some((t) => t.id === r)) {
      setCurrent(r);
      applyThemeToDocument(r);
    }
  }, []);

  const selectTheme = (theme: Theme) => {
    setCurrent(theme);
    applyTheme(theme);
    setOpen(false);
  };

  return (
    <div className="dev-menu">
      <button
        type="button"
        className="dev-menu__btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Dev menu"
        title="Dev — ธีม / ออกจากระบบ"
      >
        {/* Avatar circle */}
        <span className="dev-menu__avatar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </span>
        {/* Dev badge */}
        <span className="dev-menu__badge">Dev</span>
      </button>

      {open && (
        <>
          <div className="dev-menu__backdrop" onClick={() => setOpen(false)} />
          <div className="dev-menu__dropdown">
            {/* Profile header */}
            <div className="dev-menu__profile">
              <div className="dev-menu__profile-avatar">🧑‍💻</div>
              <div className="dev-menu__profile-info">
                <span className="dev-menu__profile-name">Dev Admin</span>
                <span className="dev-menu__profile-role">NexaPos Console</span>
              </div>
            </div>

            <div className="dev-menu__divider" />

            {/* Theme section */}
            <div className="dev-menu__section-label">ธีม</div>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`dev-menu__option${current === t.id ? ' dev-menu__option--active' : ''}`}
                onClick={() => selectTheme(t.id)}
              >
                <span className="dev-menu__option-icon">{t.icon}</span>
                <div className="dev-menu__option-text">
                  <span className="dev-menu__option-label">{t.label}</span>
                  <span className="dev-menu__option-desc">{t.desc}</span>
                </div>
                {current === t.id && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ color: 'var(--color-primary)', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}

            <div className="dev-menu__divider" />

            {/* Logout */}
            <button
              type="button"
              className="dev-menu__logout"
              onClick={() => { setOpen(false); onLogout(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              ออกจากระบบ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
