'use client';

/** โซนเลือกโต๊ะ / เซสชัน — ใช้เฉพาะหน้า /dining */
export type DiningTableLite = { id: string; label: string };

type DiningFloorProps = {
  tables: DiningTableLite[];
  selectedTableId: string;
  onSelectTable: (id: string) => void;
  diningSessionId: string | null;
  sessionTableLabel: string;
  onOpenSession: () => void;
  onCloseBill: () => void;
  onChangeTable: () => void;
  openDisabled: boolean;
  /** ผู้จัดการขึ้นไป — เปิดเมนูเพิ่ม/แก้/ลบโต๊ะ */
  showTableManager?: boolean;
  onManageTables?: () => void;
};

export function DiningFloor({
  tables,
  selectedTableId,
  onSelectTable,
  diningSessionId,
  sessionTableLabel,
  onOpenSession,
  onCloseBill,
  onChangeTable,
  openDisabled,
  showTableManager,
  onManageTables,
}: DiningFloorProps) {
  const hasTables = tables.length > 0;

  return (
    <section className="dining-floor" aria-labelledby="dining-floor-title">
      <div className="dining-floor__intro">
        <h2 id="dining-floor-title" className="dining-floor__title">
          พื้นที่โต๊ะ
        </h2>
        <p className="dining-floor__sub">
          เปิดบิลตามโต๊ะแล้วสั่งได้หลายรอบ เมื่อลูกค้าเก็บกระเป๋าค่อยปิดบิล
        </p>
      </div>

      {!diningSessionId ? (
        <>
          {hasTables ? (
            <div className="dining-floor__grid">
              {tables.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  className={
                    selectedTableId === tb.id ? 'dining-floor__pill dining-floor__pill--selected' : 'dining-floor__pill'
                  }
                  onClick={() => onSelectTable(tb.id)}
                >
                  <span className="dining-floor__pill-num">{tb.label}</span>
                  <span className="dining-floor__pill-meta">ว่างพร้อมเปิด</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="dining-floor__empty">
              {showTableManager
                ? 'ยังไม่มีโต๊ะ — กด «จัดการโต๊ะ» เพื่อเพิ่มจากที่นี่ (ไม่ต้องเข้าหลังบ้านแบบขายของ)'
                : 'ยังไม่มีโต๊ะในระบบ — ให้ผู้จัดการเพิ่มโต๊ะจากปุ่มจัดการ'}
            </p>
          )}

          <div className="dining-floor__toolbar">
            {showTableManager && (
              <button type="button" className="dining-floor__secondary" onClick={onManageTables}>
                ⚙ จัดการโต๊ะ
              </button>
            )}
            <button
              type="button"
              className="dining-floor__cta"
              disabled={openDisabled || !selectedTableId}
              onClick={onOpenSession}
            >
              เปิดบิลโต๊ะนี้
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="dining-floor__active">
            <div className="dining-floor__active-badge">กำลังรับออร์เดอร์</div>
            <div className="dining-floor__active-label">
              โต๊ะ <strong>{sessionTableLabel || '—'}</strong>
            </div>
            <p className="dining-floor__active-hint">
              เลือกเมนูด้านล่าง แล้วกด &ldquo;ส่งรอบ (ครัว)&rdquo; แต่ละรอบได้จนกว่าจะปิดบิล
            </p>
          </div>
          <div className="dining-floor__toolbar dining-floor__toolbar--session">
            {showTableManager && (
              <button type="button" className="dining-floor__secondary" onClick={onManageTables}>
                ⚙ จัดการโต๊ะ
              </button>
            )}
            <button type="button" className="dining-floor__cta dining-floor__cta--accent" onClick={onCloseBill}>
              ปิดบิลและชำระ
            </button>
            <button type="button" className="dining-floor__linkish" onClick={onChangeTable}>
              เปลี่ยนโต๊ะ
            </button>
          </div>
        </>
      )}
    </section>
  );
}
