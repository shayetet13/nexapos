'use client';

import { useEffect, useState } from 'react';

type Theme = 'warm' | 'light' | 'ocean';

/** Apply theme attribute silently (no ripple) — used on initial load */
function applyThemeSilent(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'warm') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

/** Apply theme attr only — no localStorage write (used for system preference) */
function applyThemeAttr(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'warm') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

const THEMES: { id: Theme; label: string; icon: string; desc: string }[] = [
  { id: 'warm',  label: 'ธีมหลัก', icon: '🔥', desc: 'Warm Dark'  },
  { id: 'light', label: 'ขาว',     icon: '☀️', desc: 'Light'      },
  { id: 'ocean', label: 'ดำ',      icon: '🌊', desc: 'Ocean Dark' },
];

const STORAGE_KEY = 'nexapos-theme';

// Pre-defined bg colors per theme — read BEFORE switching so we don't need to query CSS
const THEME_BG: Record<Theme, string> = {
  warm:  '#0c0806',
  light: '#faf7f4',
  ocean: '#050d1a',
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  // 1. Create ripple overlay with NEW theme's bg color — before switching
  //    so the animation plays FIRST, then theme changes underneath
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

  // 2. Trigger expansion animation: top-right → covers full screen (~1s)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.transition = 'clip-path 0.85s cubic-bezier(0.76, 0, 0.24, 1)';
      overlay.style.clipPath   = 'circle(142% at 100% 0%)';

      // 3. When fully covered → THEN switch theme (snap, hidden under overlay)
      setTimeout(() => {
        if (theme === 'warm') root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);

        // 4. Fade out overlay → reveals new theme underneath (seamless, same bg color)
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
  const [current, setCurrent] = useState<Theme>('warm');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isMobile = window.matchMedia('(pointer: coarse) and (max-width: 767px)').matches;

    if (isMobile) {
      // Mobile: follow OS system preference — ignore localStorage
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

    // Desktop: use saved preference
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved && THEMES.some((t) => t.id === saved)) {
      setCurrent(saved);
      applyThemeSilent(saved);
    }
  }, []);

  const select = (theme: Theme) => {
    setCurrent(theme);
    applyTheme(theme);
    setOpen(false);
  };

  const active = THEMES.find((t) => t.id === current)!;

  return (
    <div className={`theme-switcher${variant === 'topnav' ? ' theme-switcher--topnav' : ''}`}>
      {/* Toggle button */}
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

      {/* Dropdown */}
      {open && (
        <>
          <div className="theme-switcher__backdrop" onClick={() => setOpen(false)} />
          <div className="theme-switcher__dropdown">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-switcher__option${current === t.id ? ' theme-switcher__option--active' : ''}`}
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

