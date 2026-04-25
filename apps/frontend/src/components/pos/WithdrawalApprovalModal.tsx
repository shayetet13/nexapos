'use client';

import { useState } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import '@/styles/pages/withdraw.css';

export interface WithdrawalRequest {
  id:         string;
  staff_name: string;
  branch_id:  string;
  note?:      string;
  items:      { type: string; name: string; unit: string; qty: number }[];
  created_at: string;
}

interface Props {
  requests:  WithdrawalRequest[];
  shopId:    string;
  apiUrl:    string;
  onUpdate:  (id: string, action: 'approved' | 'rejected') => void;
}

export function WithdrawalApprovalModal({ requests, shopId, apiUrl, onUpdate }: Props) {
  const [processing, setProcessing] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);

  if (requests.length === 0) return null;

  const request = requests[Math.min(currentIdx, requests.length - 1)];
  if (!request) return null;

  async function handleAction(action: 'approve' | 'reject') {
    setProcessing(action);
    try {
      await fetchWithAuth(
        `${apiUrl}/api/v1/shops/${shopId}/withdrawals/${request.id}/${action}`,
        { method: 'PATCH' }
      );
      onUpdate(request.id, action === 'approve' ? 'approved' : 'rejected');
      setCurrentIdx(prev => Math.max(0, prev - 1));
    } catch {
      onUpdate(request.id, action === 'approve' ? 'approved' : 'rejected');
    } finally {
      setProcessing(null);
    }
  }

  const timeStr = (() => {
    try {
      return new Date(request.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  })();

  return (
    <>
      {/* Backdrop */}
      <div className="wam-overlay" />

      {/* Modal sheet */}
      <div className="wam-sheet">
        <div className="wam-handle" />

        {requests.length > 1 && (
          <div className="wam-badge">
            🔔 {requests.length} คำขอ ({currentIdx + 1}/{requests.length})
          </div>
        )}

        <div className="wam-title-row">
          <span className="wam-title-icon">📦</span>
          <h2 className="wam-title">คำขอเบิกสต๊อก</h2>
        </div>

        <div className="wam-meta">
          <strong>{request.staff_name}</strong>
          {timeStr && ` · ${timeStr} น.`}
        </div>

        <div className="wam-items">
          {request.items.map((item, idx) => (
            <div key={idx} className="wam-item-row">
              <span className="wam-item-name">{item.name}</span>
              <span className="wam-item-qty">{item.qty} {item.unit}</span>
            </div>
          ))}
        </div>

        {request.note && (
          <div className="wam-note">💬 {request.note}</div>
        )}

        <div className="wam-actions">
          <button
            className={`wam-btn-approve${processing === 'approve' ? ' wam-btn-approve--loading' : ''}`}
            disabled={!!processing}
            onClick={() => handleAction('approve')}
          >
            {processing === 'approve' ? '⏳ กำลังอนุมัติ...' : '✅ อนุมัติ'}
          </button>
          <button
            className="wam-btn-reject"
            disabled={!!processing}
            onClick={() => handleAction('reject')}
          >
            ❌ ปฏิเสธ
          </button>
        </div>

        {requests.length > 1 && (
          <div className="wam-nav">
            <button
              className="wam-nav-btn"
              onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
              disabled={currentIdx === 0}
            >← ก่อนหน้า</button>
            <button
              className="wam-nav-btn"
              onClick={() => setCurrentIdx(i => Math.min(requests.length - 1, i + 1))}
              disabled={currentIdx === requests.length - 1}
            >ถัดไป →</button>
          </div>
        )}
      </div>
    </>
  );
}
