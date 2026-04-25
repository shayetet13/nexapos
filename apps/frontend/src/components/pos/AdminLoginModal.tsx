'use client';

import { useState, useEffect } from 'react';
import { createSupabaseClient, fetchWithAuth } from '@/lib/supabase';
import { th } from '@/lib/locales/th';

const t = th.pos;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function AdminLoginModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail]       = useState('');
  const [pass, setPass]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    async function checkExistingSession() {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/v1/me/shops`);
        if (res.ok) {
          const json = await res.json();
          const shops = (json.data ?? []) as Array<{ role?: string }>;
          if (shops.some((s) => s.role === 'owner' || s.role === 'manager')) {
            window.location.href = '/admin';
            return;
          }
        }
      } catch { /* ignore */ }
      setChecking(false);
    }
    checkExistingSession();
  }, []);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseClient();
      const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (authErr || !data?.user) {
        setError(t.admin.failed);
        setLoading(false);
        return;
      }
      window.location.href = '/admin';
    } catch {
      setError(t.admin.failed);
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="admin-modal" onClick={e => e.stopPropagation()}>
          <div className="admin-modal__head">
            <span className="admin-modal__icon">🔐</span>
            <h2 className="admin-modal__title">{t.admin.modalTitle}</h2>
            <button onClick={onClose} className="checkout-modal__close" aria-label="ปิด">✕</button>
          </div>
          <div className="admin-modal__body" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ color: '#6b7280' }}>กำลังตรวจสอบสิทธิ์...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-modal__head">
          <span className="admin-modal__icon">🔐</span>
          <h2 className="admin-modal__title">{t.admin.modalTitle}</h2>
          <button onClick={onClose} className="checkout-modal__close" aria-label="ปิด">✕</button>
        </div>

        <div className="admin-modal__body">
          <label className="admin-modal__label">{t.admin.emailLabel}</label>
          <input
            type="email"
            className="admin-modal__input"
            placeholder="admin@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />

          <label className="admin-modal__label">{t.admin.passLabel}</label>
          <input
            type="password"
            className="admin-modal__input"
            placeholder="••••••••"
            value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}
          />

          {error && <p className="admin-modal__error">{error}</p>}
        </div>

        <div className="admin-modal__foot">
          <button onClick={onClose} className="btn-secondary">{t.admin.cancel}</button>
          <button
            onClick={handleLogin}
            disabled={loading || !email || !pass}
            className="admin-modal__submit"
          >
            {loading ? t.admin.loggingIn : t.admin.loginBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
