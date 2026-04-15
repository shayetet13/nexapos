'use client';

import { th } from '@/lib/locales/th';
import { type CartItem } from './pos-types';

const t = th.pos;

export function CartPanel({
  cart, total, vatEnabled, orderNumber,
  discountType, discountInput, discountAmount,
  onDiscountTypeChange, onDiscountInputChange,
  onChangeQty, onClear, onCheckout, onClose,
  onCustomerDisplay, onRegisterDisplay, shopId, branchId,
  getMaxQty,
}: {
  cart: CartItem[];
  total: number;
  vatEnabled: boolean;
  orderNumber: number;
  discountType: 'amount' | 'percent';
  discountInput: string;
  discountAmount: number;
  onDiscountTypeChange: (t: 'amount' | 'percent') => void;
  onDiscountInputChange: (v: string) => void;
  onChangeQty: (id: string, delta: number) => void;
  onClear: () => void;
  onCheckout: () => void;
  onClose?: () => void;
  onCustomerDisplay?: () => void;
  onRegisterDisplay?: () => void;
  shopId?: string | null;
  branchId?: string | null;
  getMaxQty?: (productId: string) => number;
}) {
  const vatAmount  = vatEnabled ? Math.round((total - discountAmount) * 0.07) : 0;
  const grandTotal = total - discountAmount + vatAmount;

  const fmt = (n: number) =>
    n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="cart-wrap">
      {/* Header */}
      <div className="cart-head">
        <h2 className="cart-title">{t.currentOrder}</h2>
        <div className="cart-head__actions">
          {cart.length > 0 && (
            <button onClick={onClear} className="cart-clear-btn">{t.clearAll}</button>
          )}
          <span className="cart-order-num">#{String(orderNumber).padStart(4, '0')}</span>
          {onClose && (
            <button onClick={onClose} className="cart-close-btn" aria-label="ปิด">✕</button>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="cart-body">
        {cart.length === 0 ? (
          <div className="cart-empty">
            <span className="cart-empty__icon">🧾</span>
            <p className="cart-empty__label">{t.noItems}</p>
            <p className="cart-empty__hint">{t.noItemsHint}</p>
          </div>
        ) : (
          <ul className="cart-list">
            {cart.map(item => (
              <li key={item.product.id} className="cart-item">
                <div className="cart-item__top">
                  <span className="cart-item__name">{item.product.name}</span>
                  <span className="cart-item__subtotal">฿{fmt(Number(item.product.price) * item.quantity)}</span>
                </div>
                <div className="cart-item__row">
                  <span className="cart-item__unit">฿{fmt(Number(item.product.price))} {t.perUnit}</span>
                  <div className="cart-qty">
                    <button className="cart-qty__btn cart-qty__btn--minus" onClick={() => onChangeQty(item.product.id, -1)}>−</button>
                    <span className="cart-qty__val">{item.quantity}</span>
                    <button
                      className="cart-qty__btn cart-qty__btn--plus"
                      onClick={() => onChangeQty(item.product.id, 1)}
                      disabled={getMaxQty ? item.quantity >= getMaxQty(item.product.id) : false}
                      title={getMaxQty && item.quantity >= getMaxQty(item.product.id) ? 'ไม่เกินสต็อก' : undefined}
                    >+</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="cart-foot">
        {cart.length > 0 && (
          <div className="cart-discount">
            <div className="cart-discount__tabs">
              <button
                type="button"
                className={`cart-discount__tab${discountType === 'amount' ? ' cart-discount__tab--active' : ''}`}
                onClick={() => { onDiscountTypeChange('amount'); onDiscountInputChange(''); }}
              >฿ บาท</button>
              <button
                type="button"
                className={`cart-discount__tab${discountType === 'percent' ? ' cart-discount__tab--active' : ''}`}
                onClick={() => { onDiscountTypeChange('percent'); onDiscountInputChange(''); }}
              >% เปอร์เซ็นต์</button>
            </div>
            <div className="cart-discount__row">
              <span className="cart-discount__label">ส่วนลด</span>
              <div className="cart-discount__input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={discountType === 'percent' ? 100 : total}
                  placeholder={discountType === 'percent' ? '0–100 %' : '0.00'}
                  value={discountInput}
                  onChange={e => onDiscountInputChange(e.target.value)}
                  className="cart-discount__input"
                />
                {discountInput && (
                  <button type="button" className="cart-discount__clear" onClick={() => onDiscountInputChange('')}>✕</button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="cart-pricing">
          <div className="cart-pricing__row">
            <span>รวมสินค้า</span>
            <span>฿{fmt(total)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="cart-pricing__row cart-pricing__row--discount">
              <span>ส่วนลด{discountType === 'percent' ? ` (${discountInput}%)` : ''}</span>
              <span>-฿{fmt(discountAmount)}</span>
            </div>
          )}
          {vatEnabled && (
            <div className="cart-pricing__row">
              <span>VAT 7%</span>
              <span>฿{fmt(vatAmount)}</span>
            </div>
          )}
          <div className="cart-pricing__row cart-pricing__row--grand">
            <span>ยอดรวม</span>
            <span className="cart-grand-val">฿{fmt(grandTotal)}</span>
          </div>
        </div>

        <button
          onClick={onCheckout}
          disabled={cart.length === 0}
          className="btn-checkout"
        >
          ⚡ {t.checkout}
        </button>

        {onCustomerDisplay && shopId && branchId && (
          <button onClick={onCustomerDisplay} className="btn-customer-display">
            📱 Customer Display
          </button>
        )}
      </div>
    </div>
  );
}
