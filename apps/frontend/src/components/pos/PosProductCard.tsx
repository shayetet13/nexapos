'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { Product } from '@/components/pos/pos-types';

const FULL_NAME_DELAY_MS = 1500;
const TOUCH_MOVE_CANCEL_PX = 12;

type Props = {
  product: Product;
  inCartQty: number;
  isOutOfStock: boolean;
  isLowStock: boolean;
  trackedQty?: number;
  onAdd: () => void;
};

function canUseHoverDelay(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function PosProductCard({
  product,
  inCartQty,
  isOutOfStock,
  isLowStock,
  trackedQty,
  onAdd,
}: Props) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const touchStartY = useRef<number | null>(null);
  const [fullNameOpen, setFullNameOpen] = useState(false);
  const [tipBottomPx, setTipBottomPx] = useState(64);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const isNameTruncated = useCallback((): boolean => {
    const el = nameRef.current;
    if (!el) return true;
    return el.scrollWidth > el.clientWidth + 1;
  }, []);

  const startFullNameTimer = useCallback(
    (source: 'mouse' | 'touch') => {
      clearTimer();
      requestAnimationFrame(() => {
        if (!isNameTruncated()) return;
        timerRef.current = setTimeout(() => {
          setFullNameOpen(true);
          if (source === 'touch') suppressClickRef.current = true;
        }, FULL_NAME_DELAY_MS);
      });
    },
    [clearTimer, isNameTruncated],
  );

  const hideFullName = useCallback(() => {
    clearTimer();
    setFullNameOpen(false);
  }, [clearTimer]);

  useLayoutEffect(() => {
    if (!fullNameOpen) return;
    const el = infoRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    setTipBottomPx(h + 4);
  }, [fullNameOpen, product.name]);

  const onMouseEnter = useCallback(() => {
    if (!canUseHoverDelay()) return;
    startFullNameTimer('mouse');
  }, [startFullNameTimer]);

  const onMouseLeave = useCallback(() => {
    clearTimer();
    setFullNameOpen(false);
  }, [clearTimer]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
      startFullNameTimer('touch');
    },
    [startFullNameTimer],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartY.current == null) return;
      const y = e.touches[0].clientY;
      if (Math.abs(y - touchStartY.current) > TOUCH_MOVE_CANCEL_PX) {
        touchStartY.current = null;
        hideFullName();
        suppressClickRef.current = false;
      }
    },
    [hideFullName],
  );

  const onTouchEnd = useCallback(() => {
    touchStartY.current = null;
    clearTimer();
    setFullNameOpen(false);
  }, [clearTimer]);

  const onTouchCancel = onTouchEnd;

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        e.preventDefault();
        suppressClickRef.current = false;
        return;
      }
      onAdd();
    },
    [onAdd],
  );

  const priceLabel = `฿${Number(product.price).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onContextMenu={e => e.preventDefault()}
      onSelect={e => e.preventDefault()}
      className={['pos-card', fullNameOpen ? 'pos-card--name-tip' : '', inCartQty > 0 ? 'pos-card--active' : '', isOutOfStock ? 'pos-card--oos' : '', isLowStock ? 'pos-card--low-stock' : ''].filter(Boolean).join(' ')}
      aria-describedby={fullNameOpen ? `pos-name-tip-${product.id}` : undefined}
    >
      {isOutOfStock && <div className="pos-card__oos-overlay" aria-hidden="true"><span className="pos-card__oos-label">หมด</span></div>}
      {isLowStock && <span className="pos-card__low-stock-badge" aria-label={trackedQty != null ? `เหลือ ${trackedQty}` : 'ใกล้หมด'}>⚠ {trackedQty}</span>}
      {inCartQty > 0 && !isOutOfStock && <span className="pos-card__badge">{inCartQty}</span>}
      <div className="pos-card__icon-wrap">
        {product.image_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={product.image_url} alt={product.name} className="pos-card__img" loading="lazy" draggable={false} />
          : <div className="pos-card__img pos-card__img--empty">🍵</div>
        }
      </div>
      <div ref={infoRef} className="pos-card__info">
        <span ref={nameRef} className="pos-card__name">
          {product.name}
        </span>
        <span className="pos-card__price">{priceLabel}</span>
      </div>
      {fullNameOpen && (
        <div
          id={`pos-name-tip-${product.id}`}
          className="pos-card__name-tip"
          style={{ bottom: tipBottomPx }}
          role="tooltip"
        >
          {product.name}
        </div>
      )}
    </button>
  );
}
