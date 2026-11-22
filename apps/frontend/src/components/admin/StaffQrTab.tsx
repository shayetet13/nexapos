'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';

interface ShopUser {
  user_id: string;
  email:   string;
  role:    string;
  branch_id: string | null;
}

interface Branch {
  id:   string;
  name: string;
}

interface QrToken {
  id:        string;
  user_id:   string;
  shop_id:   string;
  branch_id: string | null;
  token:     string;
  email:     string;
  created_at: string;
}

interface Props {
  shopId:    string;
  shopUsers: ShopUser[];
  branches:  Branch[];
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'เจ้าของ', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', viewer: 'ผู้ดู',
};
const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

export function StaffQrTab({ shopId, shopUsers, branches }: Props) {
  const [qrTokens, setQrTokens]   = useState<QrToken[]>([]);
  const [loading, setLoading]     = useState(false);
  const [generating, setGenerating] = useState<string | null>(null); // userId being generated
  const [selectedQr, setSelectedQr] = useState<QrToken | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const confirm  = useConfirm();

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff-qr`);
      const data = await res.json();
      if (data.success) setQrTokens(data.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [shopId]);

  useEffect(() => { void loadTokens(); }, [loadTokens]);

  async function generateQr(userId: string, branchId: string | null) {
    setGenerating(userId);
    try {
      const res  = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff-qr`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: userId, branch_id: branchId }),
      });
      const data = await res.json();
      if (data.success) {
        await loadTokens();
        toast.success('สร้าง QR สำเร็จ');
      } else {
        toast.error('เกิดข้อผิดพลาด');
      }
    } catch { toast.error('เกิดข้อผิดพลาด'); }
    finally { setGenerating(null); }
  }

  async function deleteQr(userId: string) {
    const user = shopUsers.find((u) => u.user_id === userId);
    const ok = await confirm({
      title: 'ลบ QR Code',
      description: <>QR Code ของ <strong>{user?.email ?? 'พนักงานนี้'}</strong> จะถูกลบถาวร<br />พนักงานจะไม่สามารถ login ด้วย QR นี้ได้อีก</>,
      variant: 'danger',
      icon: '🔑',
      confirmLabel: 'ลบ QR',
    });
    if (!ok) return;
    try {
      await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff-qr/${userId}`, { method: 'DELETE' });
      await loadTokens();
      toast.success('ลบ QR Code แล้ว');
    } catch { toast.error('เกิดข้อผิดพลาด'); }
  }

  function getQrUrl(token: QrToken): string {
    const u = new URL('/qr-login', BASE_URL);
    u.searchParams.set('t', token.token);
    u.searchParams.set('shop', token.shop_id);
    if (token.branch_id) u.searchParams.set('branch', token.branch_id);
    return u.toString();
  }

  function handlePrint() {
    if (!selectedQr) return;
    const url = getQrUrl(selectedQr);
    const name = shopUsers.find(u => u.user_id === selectedQr.user_id)?.email ?? selectedQr.email;
    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) return;
    w.document.write(`
      <html><head><title>QR Login — ${name}</title>
      <style>
        body { font-family: system-ui, sans-serif; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#fff; }
        h2 { font-size:1.2rem; margin-bottom:0.5rem; color:#1e293b; }
        p  { color:#64748b; font-size:0.85rem; margin:0 0 1rem; }
        .qr-wrap { border:2px solid #e2e8f0; border-radius:1rem; padding:1.5rem; }
        @media print { button { display:none; } }
      </style></head>
      <body>
        <div class="qr-wrap">
          <h2>🔑 QR Login</h2>
          <p>${name}</p>
          <div id="qr"></div>
        </div>
        <br/>
        <button onclick="window.print()">🖨️ พิมพ์</button>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>new QRCode(document.getElementById("qr"), { text: "${url}", width:256, height:256 });</script>
      </body></html>
    `);
    w.document.close();
  }

  const tokenMap = new Map(qrTokens.map(t => [t.user_id, t]));
  const nonOwners = shopUsers.filter(u => u.role !== 'owner');

  return (
    <div style={{ padding: '1.5rem 0' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem', color: '#1e293b' }}>
        🔑 QR Login พนักงาน
      </h2>
      <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.5rem' }}>
        สร้าง QR Code สำหรับพนักงานสแกนเพื่อเข้าสู่ระบบโดยไม่ต้องใช้รหัสผ่าน
      </p>

      {loading ? (
        <div style={{ color: '#94a3b8', padding: '2rem', textAlign: 'center' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {nonOwners.length === 0 && (
            <div style={{ color: '#64748b', padding: '2rem', textAlign: 'center', background: '#f8fafc', borderRadius: '0.75rem' }}>
              ยังไม่มีพนักงานในร้าน — เพิ่มพนักงานในแท็บ &quot;ผู้ใช้&quot; ก่อน
            </div>
          )}

          {nonOwners.map(user => {
            const token = tokenMap.get(user.user_id);
            const branchName = branches.find(b => b.id === user.branch_id)?.name;
            return (
              <div key={user.user_id} style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '0.875rem',
                padding: '1rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                flexWrap: 'wrap',
              }}>
                {/* User info */}
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.95rem' }}>
                    {user.email}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.2rem' }}>
                    {ROLE_LABELS[user.role] ?? user.role}
                    {branchName && ` · ${branchName}`}
                  </div>
                </div>

                {/* QR Status */}
                {token ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <span style={{ background: '#dcfce7', color: '#166534', borderRadius: '999px', padding: '0.25rem 0.75rem', fontSize: '0.8rem', fontWeight: 600 }}>
                      ✅ มี QR
                    </span>
                    <button
                      onClick={() => setSelectedQr(token)}
                      style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      ดู QR
                    </button>
                    <button
                      onClick={() => generateQr(user.user_id, user.branch_id)}
                      disabled={generating === user.user_id}
                      title="สร้างใหม่"
                      style={{ background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '0.5rem', padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      🔄
                    </button>
                    <button
                      onClick={() => deleteQr(user.user_id)}
                      title="ลบ QR"
                      style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.5rem', padding: '0.4rem 0.6rem', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      🗑️
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => generateQr(user.user_id, user.branch_id)}
                    disabled={generating === user.user_id}
                    style={{
                      background: generating === user.user_id ? '#e2e8f0' : '#0ea5e9',
                      color: generating === user.user_id ? '#94a3b8' : '#fff',
                      border: 'none',
                      borderRadius: '0.5rem',
                      padding: '0.5rem 1rem',
                      cursor: generating === user.user_id ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {generating === user.user_id ? '⏳ กำลังสร้าง...' : '+ สร้าง QR'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* QR Preview Modal */}
      {selectedQr && (() => {
        const qrUrl  = getQrUrl(selectedQr);
        const uEmail = shopUsers.find(u => u.user_id === selectedQr.user_id)?.email ?? selectedQr.email;
        return (
          <div
            onClick={() => setSelectedQr(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 9999, padding: '1rem',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              ref={printRef}
              style={{
                background: '#fff', borderRadius: '1.5rem', padding: '2rem',
                textAlign: 'center', maxWidth: '320px', width: '100%',
                boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
              }}
            >
              <h3 style={{ margin: '0 0 0.25rem', color: '#1e293b', fontSize: '1.1rem' }}>🔑 QR Login</h3>
              <p style={{ margin: '0 0 1.25rem', color: '#64748b', fontSize: '0.85rem', wordBreak: 'break-all' }}>{uEmail}</p>
              <div style={{ display: 'inline-block', padding: '1rem', background: '#f8fafc', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
                <QRCodeSVG value={qrUrl} size={200} />
              </div>
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                สแกนด้วยกล้องโทรศัพท์เพื่อเข้าสู่ระบบ
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button
                  onClick={handlePrint}
                  style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.75rem', padding: '0.75rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}
                >
                  🖨️ พิมพ์
                </button>
                <button
                  onClick={() => setSelectedQr(null)}
                  style={{ flex: 1, background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '0.75rem', padding: '0.75rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
