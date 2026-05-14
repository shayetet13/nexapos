'use client';

import { useEffect, useRef, useState } from 'react';
import '@/styles/components/promotions-panel.css';
import { API_URL } from '@/lib/config';

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

interface ProductRef {
  id:   string;
  name: string;
}

interface Props {
  shopId: string;
  token:  string;
  products?: ProductRef[];
  onApplyDiscount: (type: PromoType, value: number) => void;
  onApplyCombo: (items: ComboItemDef[], price: number) => void;
  onClose: () => void;
}

export function PromotionsPanel({ shopId, token, products = [], onApplyDiscount, onApplyCombo, onClose }: Props) {
  const [presets, setPresets]       = useState<PromotionPreset[]>([]);
  const [combos, setCombos]         = useState<ComboDef[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [expandedCombo, setExpandedCombo] = useState<string | null>(null);
  const expandedRef = useRef<HTMLDivElement | null>(null);

  /* Close expanded combo when clicking outside */
  useEffect(() => {
    if (!expandedCombo) return;
    function onClickOutside(e: MouseEvent) {
      if (expandedRef.current && !expandedRef.current.contains(e.target as Node)) {
        setExpandedCombo(null);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [expandedCombo]);

  function resolveProductName(productId: string): string {
    return products.find(p => p.id === productId)?.name ?? productId;
  }

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
                  <div key={c.id} className="promo-combo-row" ref={expandedCombo === c.id ? expandedRef : undefined}>
                    <button
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

                    {/* View items button */}
                    <button
                      type="button"
                      className={`promo-combo-view-btn${expandedCombo === c.id ? ' promo-combo-view-btn--active' : ''}`}
                      title="ดูรายการเมนูในชุดนี้"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedCombo(prev => prev === c.id ? null : c.id);
                      }}
                      aria-expanded={expandedCombo === c.id}
                    >
                      👁
                    </button>

                    {/* Items dropdown */}
                    {expandedCombo === c.id && (
                      <div className="promo-combo-items">
                        <div className="promo-combo-items__header">เมนูในชุด "{c.name}"</div>
                        <ul className="promo-combo-items__list">
                          {(c.items ?? []).map((item, idx) => (
                            <li key={idx} className="promo-combo-items__item">
                              <span className="promo-combo-items__item-name">
                                {resolveProductName(item.product_id)}
                              </span>
                              <span className="promo-combo-items__item-qty">× {item.quantity}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      )}
    </div>
  );
}
