'use client';

import { useState, useEffect, useRef } from 'react';

/* ── Unit data ──────────────────────────────────────────────────────── */
export const UNIT_GROUPS: { label: string; icon: string; units: string[] }[] = [
  {
    label: 'ปริมาตร', icon: '💧',
    units: ['ml', 'ซีซี', 'ช้อนชา', 'ช้อนโต๊ะ', 'ถ้วยตวง', 'dl', 'ลิตร', 'L'],
  },
  {
    label: 'น้ำหนัก', icon: '⚖️',
    units: ['g', 'กรัม', 'ขีด', 'กก', 'กิโล', 'kg'],
  },
  {
    label: 'ความยาว', icon: '📏',
    units: ['cm', 'ซม', 'm', 'เมตร', 'นิ้ว', 'ฟุต'],
  },
  {
    label: 'บรรจุภัณฑ์', icon: '📦',
    units: ['ชิ้น', 'อัน', 'ใบ', 'แผ่น', 'ซอง', 'ถุง', 'กล่อง', 'แพ็ค', 'ขวด', 'กระป๋อง', 'ถัง', 'ถาด', 'ลัง', 'กระสอบ'],
  },
  {
    label: 'อาหาร / ร้านอาหาร', icon: '🍽️',
    units: ['จาน', 'แก้ว', 'ชาม', 'ชุด', 'คู่', 'ห่อ', 'หลอด', 'แท่ง', 'เส้น', 'เม็ด'],
  },
  {
    label: 'วัสดุ / สิ่งทอ', icon: '🧵',
    units: ['ม้วน', 'แพ', 'มัด', 'ผืน', 'ตัว'],
  },
  {
    label: 'นับทั่วไป', icon: '🔢',
    units: ['โหล', 'ชุด', 'เล่ม', 'ฉบับ'],
  },
];

export const ALL_UNITS = UNIT_GROUPS.flatMap(g => g.units);

/* ── Component ─────────────────────────────────────────────────────── */
interface Props {
  value:    string;
  onChange: (unit: string) => void;
  label?:   string;
}

export function UnitPickerModal({ value, onChange, label }: Props) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  function pick(unit: string) {
    onChange(unit);
    setOpen(false);
    setSearch('');
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? UNIT_GROUPS.map(g => ({ ...g, units: g.units.filter(u => u.toLowerCase().includes(q)) })).filter(g => g.units.length > 0)
    : UNIT_GROUPS;

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        className="csm-unit-btn"
        onClick={() => setOpen(true)}
        title="เลือกหน่วย"
      >
        <span className="csm-unit-btn__val">{value || 'เลือกหน่วย'}</span>
        <span className="csm-unit-btn__arrow">▾</span>
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="csm-modal-overlay" onClick={() => setOpen(false)}>
          <div className="csm-modal" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="csm-modal__head">
              <span className="csm-modal__title">เลือกหน่วย{label ? ` — ${label}` : ''}</span>
              <button type="button" className="csm-modal__close" onClick={() => setOpen(false)}>✕</button>
            </div>

            {/* Current value badge */}
            {value && (
              <div className="csm-modal__current">
                ปัจจุบัน: <strong>{value}</strong>
              </div>
            )}

            {/* Search */}
            <div className="csm-modal__search-wrap">
              <input
                ref={inputRef}
                type="text"
                className="csm-input csm-modal__search"
                placeholder="🔍 ค้นหาหน่วย เช่น กก, ml, ขวด..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Groups */}
            <div className="csm-modal__body">
              {filtered.length === 0 ? (
                <div className="csm-modal__empty">ไม่พบหน่วยที่ค้นหา</div>
              ) : (
                filtered.map(group => (
                  <div key={group.label} className="csm-modal__group">
                    <div className="csm-modal__group-label">
                      {group.icon} {group.label}
                    </div>
                    <div className="csm-modal__chips">
                      {group.units.map(unit => (
                        <button
                          key={unit}
                          type="button"
                          className={`csm-chip ${value === unit ? 'csm-chip--active' : ''}`}
                          onClick={() => pick(unit)}
                        >
                          {unit}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>
      )}
    </>
  );
}
