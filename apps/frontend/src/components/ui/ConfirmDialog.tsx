'use client';

import { createContext, useContext, useState, useRef, useEffect, type ReactNode } from 'react';

/* ── Types ─────────────────────────────────────────────────────── */
export interface ConfirmOptions {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' = red confirm button, 'warning' = orange */
  variant?: 'danger' | 'warning';
  icon?: string;
}

type ResolveFn = (value: boolean) => void;

interface ConfirmState extends ConfirmOptions {
  resolve: ResolveFn;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

/* ── Context ────────────────────────────────────────────────────── */
const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/* ── Provider ───────────────────────────────────────────────────── */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm: ConfirmFn = (options) =>
    new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });

  const close = (result: boolean) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialogUI
          {...state}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

/* ── Hook ───────────────────────────────────────────────────────── */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

/* ── Dialog UI ──────────────────────────────────────────────────── */
interface DialogUIProps extends ConfirmOptions {
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialogUI({
  title,
  description,
  confirmLabel,
  cancelLabel = 'ยกเลิก',
  variant = 'danger',
  icon,
  onCancel,
  onConfirm,
}: DialogUIProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  /* focus trap — focus cancel button on open */
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  /* close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const defaultIcon = variant === 'danger' ? '🗑' : '⚠️';
  const defaultConfirmLabel = variant === 'danger' ? 'ลบเลย' : 'ยืนยัน';

  return (
    <>
      <style>{`
        .cdlg-backdrop {
          position: fixed; inset: 0; z-index: 99990;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: cdlg-fade-in 0.18s ease both;
        }
        .cdlg-box {
          background: var(--color-bg-card);
          border: 1px solid var(--color-border-light);
          border-radius: 18px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.55);
          padding: 28px 28px 24px;
          width: 100%; max-width: 380px;
          position: relative; overflow: hidden;
          animation: cdlg-pop-in 0.25s cubic-bezier(0.34,1.56,0.64,1) both;
        }
        .cdlg-box::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, var(--color-border-light), transparent);
        }
        .cdlg-icon {
          width: 52px; height: 52px; border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; margin-bottom: 18px;
        }
        .cdlg-icon--danger  { background: var(--color-error-bg); }
        .cdlg-icon--warning { background: var(--color-warning-bg); }
        .cdlg-title {
          font-size: 16px; font-weight: 700;
          color: var(--color-text); margin-bottom: 8px;
          font-family: var(--font-sans);
        }
        .cdlg-desc {
          font-size: 13px; line-height: 1.65;
          color: var(--color-text-muted); margin-bottom: 24px;
          font-family: var(--font-sans);
        }
        .cdlg-desc strong { color: var(--color-text); font-weight: 600; }
        .cdlg-actions { display: flex; gap: 10px; }
        .cdlg-btn {
          flex: 1; padding: 11px 16px; border-radius: 10px; border: none;
          font-family: var(--font-sans); font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.18s;
        }
        .cdlg-btn--cancel {
          background: var(--color-bg-hover);
          color: var(--color-text-muted);
          border: 1px solid var(--color-border);
        }
        .cdlg-btn--cancel:hover { background: var(--color-bg-card); color: var(--color-text); }
        .cdlg-btn--danger {
          background: var(--color-error); color: #fff;
        }
        .cdlg-btn--danger:hover {
          filter: brightness(1.12);
          box-shadow: 0 4px 16px rgba(255,92,92,0.35);
        }
        .cdlg-btn--warning {
          background: var(--color-warning); color: #000;
        }
        .cdlg-btn--warning:hover {
          filter: brightness(1.08);
          box-shadow: 0 4px 16px rgba(245,158,11,0.35);
        }
        @keyframes cdlg-fade-in {
          from { opacity: 0; } to { opacity: 1; }
        }
        @keyframes cdlg-pop-in {
          from { opacity: 0; transform: scale(0.93) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* backdrop — click outside = cancel */}
      <div className="cdlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
        <div className="cdlg-box" role="alertdialog" aria-modal="true" aria-labelledby="cdlg-title">
          <div className={`cdlg-icon cdlg-icon--${variant}`}>
            {icon ?? defaultIcon}
          </div>

          <div className="cdlg-title" id="cdlg-title">{title}</div>
          <div className="cdlg-desc">{description}</div>

          <div className="cdlg-actions">
            <button ref={cancelRef} className="cdlg-btn cdlg-btn--cancel" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button className={`cdlg-btn cdlg-btn--${variant}`} onClick={onConfirm}>
              {confirmLabel ?? defaultConfirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
