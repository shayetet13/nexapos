'use client';

import { useEffect, useState } from 'react';
import '@/styles/components/promotions-panel.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type PromoType = 'percent' | 'fixed';

export interface PromotionPreset {
  id:        string;
  name:      string;
  type:      PromoType;
  value:     number;
  color?:    string | null;
  is_active: boolean;
}

export interface ComboItemDef {
  product_id: string;
  quantity:   number;
}

export interface ComboDef {
  id:        string;
  name:      string;
  price:     number;
  is_active: boolean;
  items:     ComboItemDef[];
}

interface Props {
  shopId: string;
  token:  string;
  onApplyDiscount: (type: PromoType, value: number) => void;
  onApplyCombo: (items: ComboItemDef[], price: number) => void;
  onClose: () => void;
}

export function PromotionsPanel({ shopId, token, onApplyDiscount, onApplyCombo, onClose }: Props) {
  const [presets, setPresets] = useState<PromotionPreset[]>([]);
  const [combos, setCombos]   = useState<ComboDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPromotions() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/api/v1/shops/${shopId}/promotions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok || json.success === false) {
          setError(json?.error?.message ?? 'โหลดโปรโมชั่นไม่สำเร็จ');
          return;
        }
        if (cancelled) return;
        const data = json.data ?? {};
        setPresets((data.promotions ?? []) as PromotionPreset[]);
        setCombos((data.combos ?? []) as ComboDef[]);
      } catch {
        if (!cancelled) setError('โหลดโปรโมชั่นไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (shopId && token) fetchPromotions();
    return () => { cancelled = true; };
  }, [shopId, token]);

  return (
    <div className="promo-panel">

      {/* ── Header ── */}
      <div className="promo-panel__header">
        <h2 className="promo-panel__title">🎁 โปรโมชั่น</h2>
        <button className="promo-panel__close" onClick={onClose} aria-label="ปิด">✕</button>
      </div>

      {/* ── Status ── */}
      {error   && <p className="promo-panel__error">{error}</p>}
      {loading && <p className="promo-panel__loading">⏳ กำลังโหลด...</p>}

      {/* ── Content ── */}
      {!loading && !error && (
        <div className="promo-panel__body">

          {/* ─ ส่วนลด ─ */}
          <section className="promo-section">
            <div className="promo-section__label">
              <span className="promo-section__label-dot promo-section__label-dot--discount" />
              ส่วนลดสำเร็จรูป
              <span className="promo-section__line" />
            </div>

            {presets.length === 0 ? (
              <p className="promo-section__empty">ยังไม่มีส่วนลดสำเร็จรูป</p>
            ) : (
              <div className="promo-grid">
                {presets.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className="promo-card"
                    style={p.color ? { borderColor: p.color, '--card-accent': p.color } as React.CSSProperties : undefined}
                    onClick={() => onApplyDiscount(p.type, p.value)}
                  >
                    <span className="promo-card__value">
                      {p.type === 'percent' ? `${p.value}%` : `฿${p.value}`}
                    </span>
                    <span className="promo-card__name">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ─ คอมโบ ─ */}
          <section className="promo-section">
            <div className="promo-section__label">
              <span className="promo-section__label-dot promo-section__label-dot--combo" />
              ชุดเซ็ต / คอมโบ
              <span className="promo-section__line" />
            </div>

            {combos.length === 0 ? (
              <p className="promo-section__empty">ยังไม่มีชุดเซ็ต</p>
            ) : (
              <div className="promo-combo-list">
                {combos.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    className="promo-card promo-card--combo"
                    onClick={() => onApplyCombo(c.items ?? [], c.price)}
                  >
                    <div className="promo-card__info">
                      <span className="promo-card__name">{c.name}</span>
                      <span className="promo-card__meta">{c.items?.length ?? 0} รายการ</span>
                    </div>
                    <span className="promo-card__badge">
                      {c.items?.length ?? 0} items
                    </span>
                    <span className="promo-card__price">฿{c.price}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

        </div>
      )}
    </div>
  );
}
