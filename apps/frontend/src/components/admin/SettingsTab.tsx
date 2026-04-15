'use client';

import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';

const PRINTER_MODES = [
  { id: 'bluetooth', icon: '📶', label: 'Bluetooth',           desc: 'ปริ๊นไร้สาย ไม่มี dialog' },
  { id: 'usb',       icon: '🔌', label: 'USB (Plug & Play)',   desc: 'เสียบสาย USB ปริ๊นได้เลย' },
  { id: 'network',   icon: '🌐', label: 'WiFi / LAN',          desc: 'ผ่าน IP ในเครือข่าย' },
  { id: 'browser',   icon: '🖥️', label: 'Browser / AirPrint', desc: 'มีกด dialog (fallback)' },
];

export type PromoType = 'percent' | 'fixed';

export interface PromotionPreset {
  id: string;
  name: string;
  type: PromoType;
  value: number;
  color?: string | null;
  is_active: boolean;
}

export interface ComboItemDef {
  product_id: string;
  quantity: number;
}

export interface ComboDef {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  items: ComboItemDef[];
}

export interface Product {
  id: string; name: string; sku: string | null; price: string; image_url: string | null;
  category: string | null; unit: string; cost_price: string | null; barcode: string | null;
  show_on_pos: boolean;
}

interface Props {
  shopId: string | null;
  settingsName: string; setSettingsName: (v: string) => void;
  settingsLogoUrl: string | null; setSettingsLogoUrl: (v: string | null) => void;
  settingsLogoFile: File | null; setSettingsLogoFile: (v: File | null) => void;
  settingsLogoPreview: string | null; setSettingsLogoPreview: (v: string | null) => void;
  settingsLogoUploadError: string | null;
  settingsVatEnabled: boolean; setSettingsVatEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  settingsOwnerFirstname: string; setSettingsOwnerFirstname: (v: string) => void;
  settingsOwnerLastname: string; setSettingsOwnerLastname: (v: string) => void;
  settingsPromptpayType: 'phone' | 'id_card'; setSettingsPromptpayType: (v: 'phone' | 'id_card') => void;
  settingsPromptpayNumber: string; setSettingsPromptpayNumber: (v: string) => void;
  settingsSaving: boolean;
  settingsError: string | null;
  settingsSuccess: string | null;
  settingsLogoInputRef: React.RefObject<HTMLInputElement | null>;
  displayMode: 'browser' | 'monitor';
  settingsMembershipEnabled: boolean; setSettingsMembershipEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  settingsPointsPer10: number; setSettingsPointsPer10: (v: number) => void;
  settingsRedemptionType: 'points_per_10_baht' | 'baht_per_point'; setSettingsRedemptionType: (v: 'points_per_10_baht' | 'baht_per_point') => void;
  settingsRedemptionRate: number; setSettingsRedemptionRate: (v: number) => void;
  settingsRedemptionBahtPerPoint: number; setSettingsRedemptionBahtPerPoint: (v: number) => void;
  settingsTierSilver: number; setSettingsTierSilver: (v: number) => void;
  settingsTierGold: number; setSettingsTierGold: (v: number) => void;
  settingsBirthdayBenefitType: 'percent' | 'fixed'; setSettingsBirthdayBenefitType: (v: 'percent' | 'fixed') => void;
  settingsBirthdayBenefitValue: number; setSettingsBirthdayBenefitValue: (v: number) => void;
  settingsBirthdayAutoUsePoints: boolean; setSettingsBirthdayAutoUsePoints: (v: boolean | ((prev: boolean) => boolean)) => void;
  settingsPrintEnabled: boolean; setSettingsPrintEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  settingsPrinterWidth: 32 | 48; setSettingsPrinterWidth: (v: 32 | 48) => void;
  printerMode: 'bluetooth' | 'usb' | 'network' | 'browser'; setPrinterMode: (v: 'bluetooth' | 'usb' | 'network' | 'browser') => void;
  printerNetIP: string; setPrinterNetIP: (v: string) => void;
  printerNetPort: string; setPrinterNetPort: (v: string) => void;
  promoPresets: PromotionPreset[]; setPromoPresets: React.Dispatch<React.SetStateAction<PromotionPreset[]>>;
  promoCombos: ComboDef[]; setPromoCombos: React.Dispatch<React.SetStateAction<ComboDef[]>>;
  promoLoading: boolean;
  promoError: string | null; setPromoError: (v: string | null) => void;
  promoFormId: string | null; setPromoFormId: (v: string | null) => void;
  promoFormName: string; setPromoFormName: (v: string) => void;
  promoFormType: PromoType; setPromoFormType: (v: PromoType) => void;
  promoFormValue: number; setPromoFormValue: (v: number) => void;
  promoFormColor: string; setPromoFormColor: (v: string) => void;
  promoFormActive: boolean; setPromoFormActive: (v: boolean) => void;
  promoSaving: boolean; setPromoSaving: (v: boolean) => void;
  comboFormId: string | null; setComboFormId: (v: string | null) => void;
  comboFormName: string; setComboFormName: (v: string) => void;
  comboFormPrice: number; setComboFormPrice: (v: number) => void;
  comboFormActive: boolean; setComboFormActive: (v: boolean) => void;
  comboFormItems: Array<{ id: string; quantity: number }>; setComboFormItems: React.Dispatch<React.SetStateAction<Array<{ id: string; quantity: number }>>>;
  comboSaving: boolean; setComboSaving: (v: boolean) => void;
  products: Product[];
  settingsPhone: string; setSettingsPhone: (v: string) => void;
  settingsTaxId: string; setSettingsTaxId: (v: string) => void;
  settingsAddress: string; setSettingsAddress: (v: string) => void;
  settingsOpeningHours: string; setSettingsOpeningHours: (v: string) => void;
  settingsWorkingDays: string; setSettingsWorkingDays: (v: string) => void;
  settingsGoogleReviewUrl: string; setSettingsGoogleReviewUrl: (v: string) => void;
  saveSettings: () => void;
  saveDisplayMode: (mode: 'browser' | 'monitor') => void;
  saveLocalPrinterConfig: (mode: 'bluetooth' | 'usb' | 'network' | 'browser', ip: string, port: string) => void;
  handleLogoFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function SettingsTab({
  shopId,
  settingsName, setSettingsName,
  settingsLogoPreview, setSettingsLogoFile, setSettingsLogoUrl, setSettingsLogoPreview,
  settingsLogoUploadError,
  settingsVatEnabled, setSettingsVatEnabled,
  settingsOwnerFirstname, setSettingsOwnerFirstname,
  settingsOwnerLastname, setSettingsOwnerLastname,
  settingsPromptpayType, setSettingsPromptpayType,
  settingsPromptpayNumber, setSettingsPromptpayNumber,
  settingsSaving, settingsError, settingsSuccess,
  settingsLogoInputRef,
  displayMode,
  settingsMembershipEnabled, setSettingsMembershipEnabled,
  settingsPointsPer10, setSettingsPointsPer10,
  settingsRedemptionType, setSettingsRedemptionType,
  settingsRedemptionRate, setSettingsRedemptionRate,
  settingsRedemptionBahtPerPoint, setSettingsRedemptionBahtPerPoint,
  settingsTierSilver, setSettingsTierSilver,
  settingsTierGold, setSettingsTierGold,
  settingsBirthdayBenefitType, setSettingsBirthdayBenefitType,
  settingsBirthdayBenefitValue, setSettingsBirthdayBenefitValue,
  settingsBirthdayAutoUsePoints, setSettingsBirthdayAutoUsePoints,
  settingsPrintEnabled, setSettingsPrintEnabled,
  settingsPrinterWidth, setSettingsPrinterWidth,
  printerMode, setPrinterMode,
  printerNetIP, setPrinterNetIP,
  printerNetPort, setPrinterNetPort,
  promoPresets, setPromoPresets,
  promoCombos, setPromoCombos,
  promoLoading,
  promoError, setPromoError,
  promoFormId, setPromoFormId,
  promoFormName, setPromoFormName,
  promoFormType, setPromoFormType,
  promoFormValue, setPromoFormValue,
  promoFormColor, setPromoFormColor,
  promoFormActive, setPromoFormActive,
  promoSaving, setPromoSaving,
  comboFormId, setComboFormId,
  comboFormName, setComboFormName,
  comboFormPrice, setComboFormPrice,
  comboFormActive, setComboFormActive,
  comboFormItems, setComboFormItems,
  comboSaving, setComboSaving,
  products,
  settingsPhone, setSettingsPhone,
  settingsTaxId, setSettingsTaxId,
  settingsAddress, setSettingsAddress,
  settingsOpeningHours, setSettingsOpeningHours,
  settingsWorkingDays, setSettingsWorkingDays,
  settingsGoogleReviewUrl, setSettingsGoogleReviewUrl,
  saveSettings, saveDisplayMode, saveLocalPrinterConfig,
  handleLogoFileChange,
}: Props) {
  const confirm = useConfirm();

  return (
    <div className="page-admin__tab-content">
      <div className="page-admin__section">
        <h2 className="page-admin__title">ตั้งค่าร้าน</h2>
      </div>

      {/* ข้อมูลร้าน */}
      <div className="page-admin__card">
        <h3 className="page-admin__card-title">ข้อมูลร้าน</h3>
        <p className="page-admin__section-desc">ชื่อร้าน โลโก้ และชื่อเจ้าของที่จะใช้บนใบเสร็จและหน้าจอ</p>
        <div className="page-admin__form">
          <div>
            <label className="page-admin__label">ชื่อร้าน</label>
            <input
              type="text"
              placeholder="ชื่อร้าน"
              value={settingsName}
              onChange={(e) => setSettingsName(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="page-admin__img-upload">
            <p className="page-admin__label">โลโก้ร้าน (ไม่บังคับ)</p>
            <input
              ref={settingsLogoInputRef}
              type="file"
              accept="image/*"
              className="page-admin__file-input"
              onChange={handleLogoFileChange}
            />
            {settingsLogoPreview ? (
              <div className="page-admin__img-preview-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={settingsLogoPreview} alt="โลโก้" className="page-admin__img-preview" />
                <div className="page-admin__img-preview-actions">
                  <button type="button" onClick={() => settingsLogoInputRef.current?.click()} className="page-admin__btn-sm">เปลี่ยนรูป</button>
                  <button type="button" onClick={() => { setSettingsLogoFile(null); setSettingsLogoUrl(null); setSettingsLogoPreview(null); if (settingsLogoInputRef.current) settingsLogoInputRef.current.value = ''; }} className="page-admin__btn-sm page-admin__btn-danger">ลบโลโก้</button>
                </div>
              </div>
            ) : (
              <button type="button" className="page-admin__img-placeholder" onClick={() => settingsLogoInputRef.current?.click()}>
                <span className="page-admin__img-icon">+</span>
                <span>เลือกโลโก้ร้าน</span>
              </button>
            )}
            {settingsLogoUploadError && <p className="page-admin__upload-error">{settingsLogoUploadError}</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="page-admin__label">ชื่อเจ้าของ (ไม่บังคับ)</label>
              <input
                type="text"
                placeholder="ชื่อ"
                value={settingsOwnerFirstname}
                onChange={(e) => setSettingsOwnerFirstname(e.target.value)}
                className="input-field"
                maxLength={100}
              />
            </div>
            <div>
              <label className="page-admin__label">นามสกุล (ไม่บังคับ)</label>
              <input
                type="text"
                placeholder="นามสกุล"
                value={settingsOwnerLastname}
                onChange={(e) => setSettingsOwnerLastname(e.target.value)}
                className="input-field"
                maxLength={100}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ข้อมูลใบเสร็จ */}
      <div className="page-admin__card">
        <h3 className="page-admin__card-title">🧾 ข้อมูลใบเสร็จ (ใบกำกับภาษีอย่างย่อ)</h3>
        <p className="page-admin__section-desc">ข้อมูลที่แสดงบนใบเสร็จและใบกำกับภาษีอย่างย่อ</p>
        <div className="page-admin__form">
          <div>
            <label className="page-admin__label">เบอร์โทรศัพท์</label>
            <input
              type="text"
              placeholder="เช่น 02-xxx-xxxx หรือ 08x-xxx-xxxx"
              value={settingsPhone}
              onChange={(e) => setSettingsPhone(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="page-admin__label">เลขประจำตัวผู้เสียภาษี</label>
            <input
              type="text"
              placeholder="เช่น 0-1234-56789-01-2"
              value={settingsTaxId}
              onChange={(e) => setSettingsTaxId(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="page-admin__label">ที่อยู่ร้าน</label>
            <textarea
              placeholder="ที่อยู่สำหรับพิมพ์บนใบเสร็จ"
              value={settingsAddress}
              onChange={(e) => setSettingsAddress(e.target.value)}
              className="input-field"
              rows={2}
            />
          </div>
          <div className="page-admin__form-row">
            <div>
              <label className="page-admin__label">วันทำการ</label>
              <input
                type="text"
                placeholder="เช่น จันทร์-อาทิตย์"
                value={settingsWorkingDays}
                onChange={(e) => setSettingsWorkingDays(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="page-admin__label">เวลาเปิด-ปิด</label>
              <input
                type="text"
                placeholder="เช่น 09:00-22:00"
                value={settingsOpeningHours}
                onChange={(e) => setSettingsOpeningHours(e.target.value)}
                className="input-field"
              />
            </div>
          </div>
          <div>
            <label className="page-admin__label">Google Review URL</label>
            <input
              type="url"
              placeholder="https://g.page/r/..."
              value={settingsGoogleReviewUrl}
              onChange={(e) => setSettingsGoogleReviewUrl(e.target.value)}
              className="input-field"
            />
            <p className="page-admin__hint">ถ้ากรอก QR code ในใบเสร็จจะลิงก์ไป Google Review แทน</p>
          </div>
        </div>
      </div>

      {/* การชำระเงิน & VAT */}
      <div className="page-admin__card">
        <h3 className="page-admin__card-title">การชำระเงิน & VAT</h3>
        <p className="page-admin__section-desc">ตั้งค่า PromptPay และการคิดภาษีมูลค่าเพิ่มของร้าน</p>
        <div className="page-admin__form">
          <div>
            <label className="page-admin__label">PromptPay (เก็บเข้ารหัส AES-256 ต่อร้าน)</label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setSettingsPromptpayType('phone')}
                className={`page-admin__btn-sm${settingsPromptpayType === 'phone' ? ' page-admin__btn-active' : ''}`}
                style={{ fontWeight: settingsPromptpayType === 'phone' ? 700 : 400 }}
              >
                📱 เบอร์โทรศัพท์ (10 หลัก)
              </button>
              <button
                type="button"
                onClick={() => setSettingsPromptpayType('id_card')}
                className={`page-admin__btn-sm${settingsPromptpayType === 'id_card' ? ' page-admin__btn-active' : ''}`}
                style={{ fontWeight: settingsPromptpayType === 'id_card' ? 700 : 400 }}
              >
                🇹🇭 เลขบัตรประชาชน (13 หลัก)
              </button>
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder={settingsPromptpayType === 'phone' ? 'เช่น 0812345678' : 'เช่น 1234567890123'}
              value={settingsPromptpayNumber}
              onChange={(e) => setSettingsPromptpayNumber(e.target.value.replace(/\D/g, '').slice(0, settingsPromptpayType === 'phone' ? 10 : 13))}
              className="input-field"
              maxLength={settingsPromptpayType === 'phone' ? 10 : 13}
            />
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
              {settingsPromptpayNumber
                ? `กรอกแล้ว ${settingsPromptpayNumber.length}/${settingsPromptpayType === 'phone' ? 10 : 13} หลัก • เก็บเข้าระบบเข้ารหัส`
                : 'ว่างไว้ — ไม่ใช้ PromptPay'}
            </p>
          </div>

          <div className="page-admin__vat-row">
            <div className="page-admin__vat-info">
              <span className="page-admin__label">ภาษีมูลค่าเพิ่ม (VAT 7%)</span>
              <span className="page-admin__vat-desc">
                {settingsVatEnabled
                  ? 'เปิดอยู่ — ราคาสินค้า + VAT 7% = ยอดรวมที่ลูกค้าจ่าย'
                  : 'ปิดอยู่ — ราคาสินค้า = ยอดรวมที่ลูกค้าจ่าย (ไม่บวก VAT)'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settingsVatEnabled}
              onClick={() => setSettingsVatEnabled((v) => !v)}
              className={`page-admin__toggle${settingsVatEnabled ? ' page-admin__toggle--on' : ''}`}
            >
              <span className="page-admin__toggle-thumb" />
            </button>
          </div>
        </div>
      </div>

      {/* Telegram OTP */}
      <div className="page-admin__card">
        <h3 className="page-admin__card-title">🤖 Telegram — รหัส OTP คืนเงิน</h3>
        <p className="page-admin__section-desc">
          เชื่อม Telegram เพื่อรับรหัส OTP ยืนยันการคืนเงินทุกครั้ง
        </p>
        <div className="page-admin__form">
          <div>
            <label className="page-admin__label">วิธีเชื่อมต่อ</label>
            <ol style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 2, paddingLeft: '1.25rem', margin: '0.25rem 0 0.75rem' }}>
              <li>กดปุ่ม <strong>คัดลอก Link</strong> ด้านล่าง</li>
              <li>เปิด Telegram แล้ววาง link ในช่อง URL หรือ chat กับ Bot</li>
              <li>กด <strong>START</strong> — Bot จะตอบกลับ &quot;เชื่อมต่อสำเร็จ&quot;</li>
            </ol>
            {shopId ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <a
                  href={`https://t.me/Capy_Pos_Bot?start=${shopId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="page-admin__btn-sm page-admin__btn-active"
                  style={{ textDecoration: 'none' }}
                >
                  📲 เปิด Telegram Bot
                </a>
                <button
                  type="button"
                  className="page-admin__btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://t.me/Capy_Pos_Bot?start=${shopId}`);
                  }}
                >
                  📋 คัดลอก Link
                </button>
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: '#f87171' }}>ไม่พบ shopId</p>
            )}
            <p style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
              ⚠️ เชื่อมต่อสำเร็จแล้วครั้งเดียว — Bot จะส่ง OTP มาที่ Telegram นี้ทุกครั้ง
            </p>
          </div>
        </div>
      </div>

      {/* จอแสดงผลลูกค้า */}
      <div className="page-admin__card">
        <h3 className="page-admin__card-title">จอแสดงผลลูกค้า</h3>
        <p className="page-admin__section-desc">เลือกวิธีแสดงผลสำหรับลูกค้าขณะชำระเงิน (บันทึกเฉพาะอุปกรณ์นี้)</p>
        <div className="page-admin__form">
          <div>
            <label className="page-admin__label">โหมดการแสดงผล</label>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              เลือกใช้ผ่านมือถือ (QR Code) หรือแสดงที่จอที่ 2
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => saveDisplayMode('browser')}
                className={`page-admin__btn-sm${displayMode === 'browser' ? ' page-admin__btn-active' : ''}`}
              >
                📱 โทรศัพท์ / QR Code
              </button>
              <button
                type="button"
                onClick={() => saveDisplayMode('monitor')}
                className={`page-admin__btn-sm${displayMode === 'monitor' ? ' page-admin__btn-active' : ''}`}
              >
                🖥️ จอที่ 2
              </button>
            </div>
            <p style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.35rem' }}>
              {displayMode === 'monitor'
                ? '🖥️ เปิด Customer Display จะเปิดหน้าต่างที่จอที่ 2 โดยอัตโนมัติ'
                : '📱 เปิด Customer Display จะแสดง QR สำหรับสแกนด้วยโทรศัพท์'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Membership config ── */}
      <div className="page-admin__card" style={{ marginTop: '1rem' }}>
        <h3 className="page-admin__card-title">ตั้งค่าระบบสมาชิก</h3>
        <div className="page-admin__vat-row">
          <div className="page-admin__vat-info">
            <span className="page-admin__label">เปิดระบบสมาชิก</span>
            <span className="page-admin__vat-desc">
              {settingsMembershipEnabled ? 'เปิด — ลูกค้าสมัคร/สะสมแต้มได้' : 'ปิด — ไม่รับสมัครและไม่สะสมแต้ม'}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settingsMembershipEnabled}
            onClick={() => setSettingsMembershipEnabled((v) => !v)}
            className={`page-admin__toggle${settingsMembershipEnabled ? ' page-admin__toggle--on' : ''}`}
          >
            <span className="page-admin__toggle-thumb" />
          </button>
        </div>
        {settingsMembershipEnabled && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
              <div>
                <label className="page-admin__label">แต้มที่ได้ ต่อ 10 บาท</label>
                <input type="number" min={1} max={100} className="input-field" value={settingsPointsPer10} onChange={(e) => setSettingsPointsPer10(Number(e.target.value) || 10)} />
              </div>
              <div>
                <label className="page-admin__label">รูปแบบแลกแต้ม</label>
                <select className="input-field" value={settingsRedemptionType} onChange={(e) => setSettingsRedemptionType(e.target.value as 'points_per_10_baht' | 'baht_per_point')}>
                  <option value="points_per_10_baht">แต้ม ต่อ ฿10 ส่วนลด</option>
                  <option value="baht_per_point">บาท ต่อ 1 แต้ม</option>
                </select>
              </div>
              {settingsRedemptionType === 'points_per_10_baht' ? (
                <div>
                  <label className="page-admin__label">แต้ม ต่อ ฿10 ส่วนลด</label>
                  <input type="number" min={10} max={1000} className="input-field" value={settingsRedemptionRate} onChange={(e) => setSettingsRedemptionRate(Number(e.target.value) || 100)} />
                </div>
              ) : (
                <div>
                  <label className="page-admin__label">บาท ต่อ 1 แต้ม</label>
                  <input type="number" min={0.01} max={10} step={0.01} className="input-field" value={settingsRedemptionBahtPerPoint} onChange={(e) => setSettingsRedemptionBahtPerPoint(Number(e.target.value) || 0.1)} />
                </div>
              )}
              <div>
                <label className="page-admin__label">ขั้น Silver เมื่อยอด ฿</label>
                <input type="number" min={0} className="input-field" value={settingsTierSilver} onChange={(e) => setSettingsTierSilver(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className="page-admin__label">ขั้น Gold เมื่อยอด ฿</label>
                <input type="number" min={0} className="input-field" value={settingsTierGold} onChange={(e) => setSettingsTierGold(Number(e.target.value) || 0)} />
              </div>
            </div>
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
              <span className="page-admin__label">สิทธิ์วันเกิด</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.35rem' }}>
                <select className="input-field" style={{ width: 'auto', minWidth: '100px' }} value={settingsBirthdayBenefitType} onChange={(e) => setSettingsBirthdayBenefitType(e.target.value as 'percent' | 'fixed')}>
                  <option value="percent">เปอร์เซ็นต์</option>
                  <option value="fixed">บาท</option>
                </select>
                <input type="number" min={0} step={settingsBirthdayBenefitType === 'percent' ? 1 : 0.01} className="input-field" style={{ width: '100px' }} value={settingsBirthdayBenefitValue} onChange={(e) => setSettingsBirthdayBenefitValue(Number(e.target.value) || 0)} />
                <span className="page-admin__vat-desc">{settingsBirthdayBenefitType === 'percent' ? '% ส่วนลดเพิ่มในวันเกิด' : '฿ ส่วนลดเพิ่มในวันเกิด'}</span>
              </div>
            </div>
            <div className="page-admin__vat-row" style={{ marginTop: '0.75rem' }}>
              <div className="page-admin__vat-info">
                <span className="page-admin__label">วันเกิด — ใช้แต้มอัตโนมัติ</span>
                <span className="page-admin__vat-desc">
                  {settingsBirthdayAutoUsePoints ? 'เปิด — ตรงวันเกิดจะใช้แต้มเป็นส่วนลดให้อัตโนมัติ' : 'ปิด'}
                </span>
              </div>
              <button type="button" role="switch" aria-checked={settingsBirthdayAutoUsePoints} onClick={() => setSettingsBirthdayAutoUsePoints((v) => !v)} className={`page-admin__toggle${settingsBirthdayAutoUsePoints ? ' page-admin__toggle--on' : ''}`}>
                <span className="page-admin__toggle-thumb" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Promotions (POS) ── */}
      <div className="page-admin__card" style={{ marginTop: '1rem' }}>
        <h3 className="page-admin__card-title">โปรโมชั่น (POS)</h3>
        <p className="page-admin__section-desc">
          สร้างส่วนลดสำเร็จรูปและชุดเซ็ตสำหรับใช้ในหน้า POS แท็บ &quot;โปรโมชั่น&quot;
        </p>

        {/* Preset discounts */}
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span className="page-admin__label">ส่วนลดสำเร็จรูป</span>
            <button
              type="button"
              className="page-admin__btn-sm"
              onClick={() => {
                setPromoFormId(null);
                setPromoFormName('');
                setPromoFormType('percent');
                setPromoFormValue(0);
                setPromoFormColor('');
                setPromoFormActive(true);
              }}
            >
              + เพิ่ม Preset
            </button>
          </div>
          {promoLoading && <p className="page-admin__hint">⏳ กำลังโหลดโปรโมชั่น...</p>}
          {promoError && <p className="page-admin__error">{promoError}</p>}
          {!promoLoading && promoPresets.length === 0 && (
            <p className="page-admin__hint">ยังไม่มีส่วนลดสำเร็จรูป</p>
          )}
          {promoPresets.length > 0 && (
            <ul className="page-admin__list">
              {promoPresets.map((p) => (
                <li key={p.id} className="page-admin__list-item">
                  <div className="page-admin__list-row">
                    <div>
                      <div className="page-admin__list-title">
                        {p.name}
                        {!p.is_active && <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: '#9ca3af' }}>(ปิด)</span>}
                      </div>
                      <div className="page-admin__list-sub">
                        {p.type === 'percent' ? `${p.value}%` : `฿${p.value}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="page-admin__btn-sm"
                        onClick={() => {
                          setPromoFormId(p.id);
                          setPromoFormName(p.name);
                          setPromoFormType(p.type);
                          setPromoFormValue(p.value);
                          setPromoFormColor(p.color ?? '');
                          setPromoFormActive(p.is_active);
                        }}
                      >
                        แก้ไข
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {/* Preset form */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!shopId) return;
              setPromoSaving(true);
              setPromoError(null);
              const body = {
                name: promoFormName.trim(),
                type: promoFormType,
                value: promoFormValue || 0,
                color: promoFormColor.trim() || undefined,
                is_active: promoFormActive,
              };
              try {
                if (!body.name) {
                  setPromoError('กรุณากรอกชื่อ Preset');
                  setPromoSaving(false);
                  return;
                }
                const url = promoFormId
                  ? `${API_URL}/api/v1/shops/${shopId}/promotions/${promoFormId}`
                  : `${API_URL}/api/v1/shops/${shopId}/promotions`;
                const method = promoFormId ? 'PATCH' : 'POST';
                const res = await fetchWithAuth(url, {
                  method,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const j = await res.json();
                if (!res.ok || j.success === false) {
                  setPromoError(j?.error?.message ?? 'บันทึก Preset ไม่สำเร็จ');
                } else {
                  const saved: PromotionPreset = j.data;
                  setPromoPresets((prev) => {
                    const others = prev.filter((x) => x.id !== saved.id);
                    return [...others, saved].sort((a, b) => a.name.localeCompare(b.name, 'th-TH'));
                  });
                  setPromoFormId(null);
                  setPromoFormName('');
                  setPromoFormValue(0);
                  setPromoFormColor('');
                  setPromoFormActive(true);
                }
              } finally {
                setPromoSaving(false);
              }
            }}
            style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}
          >
            <input
              className="input-field"
              placeholder="ชื่อ Preset เช่น ลด 10%"
              value={promoFormName}
              onChange={(e) => setPromoFormName(e.target.value)}
            />
            <select
              className="input-field"
              value={promoFormType}
              onChange={(e) => setPromoFormType(e.target.value as PromoType)}
            >
              <option value="percent">% เปอร์เซ็นต์</option>
              <option value="fixed">฿ บาท</option>
            </select>
            <input
              type="number"
              className="input-field"
              placeholder={promoFormType === 'percent' ? 'เช่น 10' : 'เช่น 50'}
              value={promoFormValue}
              onChange={(e) => setPromoFormValue(Number(e.target.value) || 0)}
            />
            <button type="submit" className="page-admin__btn-sm" disabled={promoSaving}>
              {promoSaving ? 'กำลังบันทึก...' : (promoFormId ? 'อัปเดต' : 'บันทึก')}
            </button>
          </form>
        </div>

        {/* Combos */}
        <div style={{ marginTop: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span className="page-admin__label">ชุดเซ็ต / คอมโบ</span>
            <button
              type="button"
              className="page-admin__btn-sm"
              onClick={() => {
                setComboFormId(null);
                setComboFormName('');
                setComboFormPrice(0);
                setComboFormActive(true);
                setComboFormItems([]);
              }}
            >
              + เพิ่ม Combo
            </button>
          </div>
          {promoCombos.length === 0 && !promoLoading && (
            <p className="page-admin__hint">ยังไม่มีชุดเซ็ต</p>
          )}
          {promoCombos.length > 0 && (
            <ul className="page-admin__list">
              {promoCombos.map((c) => (
                <li key={c.id} className="page-admin__list-item">
                  <div className="page-admin__list-row">
                    <div>
                      <div className="page-admin__list-title">
                        {c.name}
                        {!c.is_active && <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: '#9ca3af' }}>(ปิด)</span>}
                      </div>
                      <div className="page-admin__list-sub">
                        ฿{c.price} • {c.items?.length ?? 0} รายการ
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="page-admin__btn-sm"
                        onClick={() => {
                          setComboFormId(c.id);
                          setComboFormName(c.name);
                          setComboFormPrice(c.price);
                          setComboFormActive(c.is_active);
                          setComboFormItems((c.items ?? []).map((it) => ({ id: it.product_id, quantity: it.quantity })));
                        }}
                      >
                        แก้ไข
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Combo form */}
          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input
              className="input-field"
              placeholder="ชื่อชุด เช่น เซ็ตปิ้งย่าง 1"
              value={comboFormName}
              onChange={(e) => setComboFormName(e.target.value)}
            />
            <input
              type="number"
              className="input-field"
              placeholder="ราคาชุด เช่น 499"
              value={comboFormPrice}
              onChange={(e) => setComboFormPrice(Number(e.target.value) || 0)}
            />
            {/* Items list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {comboFormItems.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <select
                    className="input-field"
                    style={{ flex: 1 }}
                    value={it.id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setComboFormItems((prev) => prev.map((row, i2) => (i2 === idx ? { ...row, id: v } : row)));
                    }}
                  >
                    <option value="">เลือกสินค้า...</option>
                    {products.filter((p) => p.show_on_pos).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.sku ? ` (${p.sku})` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="input-field"
                    style={{ width: '80px' }}
                    min={1}
                    value={it.quantity}
                    onChange={(e) => {
                      const q = Number(e.target.value) || 1;
                      setComboFormItems((prev) => prev.map((row, i2) => (i2 === idx ? { ...row, quantity: q } : row)));
                    }}
                  />
                  <button
                    type="button"
                    className="page-admin__btn-sm"
                    onClick={() => setComboFormItems((prev) => prev.filter((_, i2) => i2 !== idx))}
                  >
                    ลบ
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="page-admin__btn-sm"
                onClick={() => setComboFormItems((prev) => [...prev, { id: '', quantity: 1 }])}
              >
                + เพิ่มสินค้าในชุด
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
              <button
                type="button"
                className="page-admin__btn-sm"
                disabled={comboSaving}
                onClick={async () => {
                  if (!shopId) return;
                  if (!comboFormName.trim()) { setPromoError('กรุณากรอกชื่อชุดเซ็ต'); return; }
                  if (comboFormItems.length === 0 || comboFormItems.some((i) => !i.id)) {
                    setPromoError('กรุณาเลือกสินค้าในชุดอย่างน้อย 1 รายการ');
                    return;
                  }
                  setComboSaving(true);
                  setPromoError(null);
                  const body = {
                    name: comboFormName.trim(),
                    price: comboFormPrice || 0,
                    is_active: comboFormActive,
                    items: comboFormItems.map((it) => ({ product_id: it.id, quantity: it.quantity || 1 })),
                  };
                  try {
                    const url = comboFormId
                      ? `${API_URL}/api/v1/shops/${shopId}/combos/${comboFormId}`
                      : `${API_URL}/api/v1/shops/${shopId}/combos`;
                    const method = comboFormId ? 'PATCH' : 'POST';
                    const res = await fetchWithAuth(url, {
                      method,
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(body),
                    });
                    const j = await res.json();
                    if (!res.ok || j.success === false) {
                      setPromoError(j?.error?.message ?? 'บันทึกชุดเซ็ตไม่สำเร็จ');
                    } else {
                      const saved: ComboDef = j.data;
                      setPromoCombos((prev) => {
                        const others = prev.filter((x) => x.id !== saved.id);
                        return [...others, { ...saved, items: body.items }].sort((a, b) => a.name.localeCompare(b.name, 'th-TH'));
                      });
                      setComboFormId(null);
                      setComboFormName('');
                      setComboFormPrice(0);
                      setComboFormItems([]);
                    }
                  } finally {
                    setComboSaving(false);
                  }
                }}
              >
                {comboSaving ? 'กำลังบันทึกชุดเซ็ต...' : (comboFormId ? 'อัปเดตชุด' : 'บันทึกชุด')}
              </button>
              {comboFormId && (
                <button
                  type="button"
                  className="page-admin__btn-sm page-admin__btn-danger"
                  disabled={comboSaving}
                  onClick={async () => {
                    if (!shopId || !comboFormId) return;
                    const combo = promoCombos.find((c) => c.id === comboFormId);
                    const ok = await confirm({
                      title: 'ลบชุดเซ็ต',
                      description: <><strong>{combo?.name ?? 'ชุดเซ็ตนี้'}</strong> จะถูกลบออกจากระบบถาวร</>,
                      variant: 'danger',
                      icon: '🗑',
                      confirmLabel: 'ลบชุดเซ็ต',
                    });
                    if (!ok) return;
                    setComboSaving(true);
                    try {
                      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/combos/${comboFormId}`, {
                        method: 'DELETE',
                      });
                      if (!res.ok) {
                        const j = await res.json().catch(() => null);
                        setPromoError(j?.error?.message ?? 'ลบชุดเซ็ตไม่สำเร็จ');
                        toast.error(j?.error?.message ?? 'ลบชุดเซ็ตไม่สำเร็จ');
                      } else {
                        setPromoCombos((prev) => prev.filter((c) => c.id !== comboFormId));
                        setComboFormId(null);
                        setComboFormName('');
                        setComboFormPrice(0);
                        setComboFormItems([]);
                        toast.success('ลบชุดเซ็ตเรียบร้อยแล้ว');
                      }
                    } finally {
                      setComboSaving(false);
                    }
                  }}
                >
                  ลบชุดเซ็ตนี้
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Printer (Receipt) ── */}
      <div className="page-admin__vat-row">
        <div className="page-admin__vat-info">
          <span className="page-admin__label">พิมพ์ใบเสร็จอัตโนมัติ</span>
          <span className="page-admin__vat-desc">
            {settingsPrintEnabled
              ? 'เปิดอยู่ — ใบเสร็จ thermal จะพิมพ์ทันทีเมื่อชำระเงิน'
              : 'ปิดอยู่ — ไม่พิมพ์ใบเสร็จอัตโนมัติ'}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settingsPrintEnabled}
          onClick={() => setSettingsPrintEnabled(v => !v)}
          className={`page-admin__toggle${settingsPrintEnabled ? ' page-admin__toggle--on' : ''}`}
        >
          <span className="page-admin__toggle-thumb" />
        </button>
      </div>

      {settingsPrintEnabled && (
        <div className="page-admin__printer-section">

          {/* ขนาดกระดาษ */}
          <div className="page-admin__printer-card">
            <label className="page-admin__label">ขนาดกระดาษ</label>
            <select
              value={settingsPrinterWidth}
              onChange={(e) => setSettingsPrinterWidth(Number(e.target.value) as 32 | 48)}
              className="input-field"
            >
              <option value={48}>80 มม. (48 ตัวอักษร)</option>
              <option value={32}>58 มม. (32 ตัวอักษร)</option>
            </select>
          </div>

          {/* ประเภทการเชื่อมต่อ — device-specific, saved to localStorage */}
          <div className="page-admin__printer-card">
            <label className="page-admin__label" style={{ marginBottom:'0.5rem', display:'block' }}>
              ประเภทการเชื่อมต่อ <span style={{ fontWeight:400, color:'#9ca3af', fontSize:'0.72rem' }}>(เฉพาะอุปกรณ์นี้)</span>
            </label>
            <div className="page-admin__printer-mode-grid">
              {PRINTER_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setPrinterMode(m.id as typeof printerMode); saveLocalPrinterConfig(m.id as typeof printerMode, printerNetIP, printerNetPort); }}
                  className={`page-admin__printer-mode-btn${printerMode === m.id ? ' page-admin__printer-mode-btn--active' : ''}`}
                >
                  <div className="page-admin__printer-mode-title">{m.icon} {m.label}</div>
                  <div className="page-admin__printer-mode-desc">{m.desc}</div>
                </button>
              ))}
            </div>

            {/* Network IP + Port — shown only when mode=network */}
            {printerMode === 'network' && (
              <div className="page-admin__printer-net">
                <label className="page-admin__label">IP เครื่องปริ๊น</label>
                <input
                  className="input-field"
                  placeholder="192.168.1.100"
                  value={printerNetIP}
                  onChange={e => { setPrinterNetIP(e.target.value); saveLocalPrinterConfig('network', e.target.value, printerNetPort); }}
                />
                <label className="page-admin__label">Port</label>
                <input
                  className="input-field"
                  placeholder="9100"
                  value={printerNetPort}
                  onChange={e => { setPrinterNetPort(e.target.value); saveLocalPrinterConfig('network', printerNetIP, e.target.value); }}
                />
                <p style={{ fontSize:'0.7rem', color:'#6b7280' }}>
                  ⚠️ ต้องรัน relay บนเครือข่ายเดียวกัน: npx nexpos-relay --ip=PRINTER_IP (หรือเครื่องปริ๊นรองรับ ePOS WebSocket Epson TM series ใช้ port 8008)
                </p>
              </div>
            )}

            {/* Tips */}
            <div className="page-admin__printer-tip">
              <p className="page-admin__printer-tip-text">
                {printerMode === 'bluetooth' && '📶 กด 🖨️ ที่หน้า POS เพื่อ pair เครื่องปริ๊น Bluetooth — ปริ๊นเงียบ ไม่มี dialog'}
                {printerMode === 'usb'       && '🔌 กด 🖨️ ที่หน้า POS เพื่อเลือกเครื่องปริ๊น USB — รองรับ Chrome/Edge บน Android และ Windows'}
                {printerMode === 'network'   && '🌐 ใส่ IP เครื่องปริ๊นด้านบน — รองรับ WiFi และ LAN ในเครือข่ายเดียวกัน'}
                {printerMode === 'browser'   && '🖥️ AirPrint บน iOS หรือ print dialog บน Windows/Android — ใช้เป็น fallback'}
              </p>
            </div>
          </div>
        </div>
      )}

      {settingsError && <p className="page-admin__error">{settingsError}</p>}
      {settingsSuccess && <p className="page-admin__success">{settingsSuccess}</p>}
      <div className="page-admin__form-actions">
        <button type="button" onClick={saveSettings} disabled={settingsSaving || !settingsName.trim()} className="btn-primary">
          {settingsSaving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>
    </div>
  );
}
