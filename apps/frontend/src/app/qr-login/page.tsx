'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createSupabaseClient } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { fetchWithAuth } from '@/lib/supabase';

type Step = 'loading' | 'success' | 'error';

function QrLoginContent() {
  const params    = useSearchParams();
  const router    = useRouter();
  const [step, setStep]       = useState<Step>('loading');
  const [message, setMessage] = useState('กำลังตรวจสอบ QR...');

  useEffect(() => {
    const token    = params.get('t');
    const shopId   = params.get('shop');
    const branchId = params.get('branch');

    if (!token || !shopId) {
      setStep('error');
      setMessage('QR Code ไม่ถูกต้อง');
      return;
    }

    (async () => {
      try {
        setMessage('กำลังล็อกอิน...');

        // 1. Exchange QR token for Supabase magic link token
        const res = await fetch(`${API_URL}/api/v1/auth/qr-exchange`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.message ?? 'QR หมดอายุหรือไม่ถูกต้อง');
        }

        const { token_hash, token_type, shop_id, branch_id: qrBranchId } = await res.json();
        const resolvedBranchId = branchId ?? qrBranchId;

        // 2. Verify OTP to establish Supabase session
        setMessage('กำลังยืนยันตัวตน...');
        const supabase = createSupabaseClient();
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash,
          type: token_type as 'magiclink',
        });

        if (error || !data.session) {
          throw new Error(error?.message ?? 'ยืนยันตัวตนล้มเหลว');
        }

        // 3. Record check-in
        setMessage('บันทึกเวลาเข้างาน...');
        try {
          await fetchWithAuth(`${API_URL}/api/v1/shops/${shop_id}/staff-qr/checkin`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ branch_id: resolvedBranchId ?? null }),
          });
        } catch {
          // non-fatal — still proceed to POS
        }

        // 4. Redirect to POS
        setStep('success');
        setMessage('เข้าสู่ระบบสำเร็จ! กำลังเปิด POS...');
        setTimeout(() => {
          const url = resolvedBranchId
            ? `/pos?shopId=${shop_id}&branchId=${resolvedBranchId}`
            : `/select-branch?shopId=${shop_id}`;
          router.replace(url);
        }, 1000);

      } catch (err) {
        setStep('error');
        setMessage(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      }
    })();
  }, [params, router]);

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '2rem',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
        borderRadius: '1.5rem',
        padding: '2.5rem 2rem',
        maxWidth: '360px',
        width: '100%',
        textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
      }}>

        {/* Icon */}
        <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>
          {step === 'loading' ? '📱' : step === 'success' ? '✅' : '❌'}
        </div>

        {/* Title */}
        <h1 style={{
          color: '#f1f5f9',
          fontSize: '1.4rem',
          fontWeight: 700,
          margin: '0 0 0.5rem',
        }}>
          {step === 'loading' ? 'QR Staff Login' : step === 'success' ? 'เข้าสู่ระบบสำเร็จ' : 'เกิดข้อผิดพลาด'}
        </h1>

        {/* Message */}
        <p style={{
          color: step === 'error' ? '#f87171' : '#94a3b8',
          fontSize: '1rem',
          margin: '0 0 1.5rem',
          lineHeight: 1.5,
        }}>
          {message}
        </p>

        {/* Loading spinner */}
        {step === 'loading' && (
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(255,255,255,0.2)',
            borderTopColor: '#60a5fa',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto',
          }} />
        )}

        {/* Error actions */}
        {step === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '0.75rem',
                padding: '0.875rem',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              ลองใหม่
            </button>
            <a
              href="/login"
              style={{
                color: '#94a3b8',
                fontSize: '0.9rem',
                textDecoration: 'none',
                display: 'block',
                padding: '0.5rem',
              }}
            >
              เข้าสู่ระบบแบบปกติ
            </a>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function QrLoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100dvh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    }>
      <QrLoginContent />
    </Suspense>
  );
}
