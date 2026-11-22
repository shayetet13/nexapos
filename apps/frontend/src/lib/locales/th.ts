/* ═══════════════════════════════════════════════════
   Thai locale — NEXPOS
   ═══════════════════════════════════════════════════ */

export const th = {
  pos: {
    nav: {
      sell:       'ขายสินค้า',
      report:     'รายงาน',
      products:   'สินค้า',
      customers:  'ลูกค้า',
      promotions: 'โปรโมชั่น',
      history:    'ประวัติ',
    },
    stats: {
      dailySales:  'ยอดขายวันนี้',
      dailyOrders: 'ออเดอร์วันนี้',
      avgOrder:    'เฉลี่ย/ออเดอร์',
      bestSeller:  'สินค้าขายดี',
    },
    categories: {
      all:      'ทั้งหมด',
      drink:    'เครื่องดื่ม',
      food:     'อาหาร',
      toy:      'ของเล่น',
      dessert:  'ของหวาน',
    },
    search:       'ค้นหาสินค้า...',
    currentOrder: 'ออเดอร์ปัจจุบัน',
    orderList:    'รายการสั่ง',
    clearAll:     'ล้างทั้งหมด',
    noItems:      'ยังไม่มีรายการ',
    noItemsHint:  'กดเลือกเมนูด้านซ้ายได้เลย',
    subtotal:     'ยอดรวม',
    checkout:     'ชำระเงิน',
    back:         '← กลับ',
    logout:       'ออกจากระบบ',
    noMenu:       'ไม่พบเมนู',
    noShop:       'ไม่พบข้อมูลร้านหรือสาขา',
    backToShop:   '← กลับหน้าเลือกร้าน',
    perUnit:      '/ ชิ้น',
    orders:       'ออเดอร์',
    payment: {
      title:       'ชำระเงิน',
      cash:        'เงินสด',
      transfer:    'โอนเงิน',
      card:        'บัตร',
      other:       'อื่นๆ',
      receivedLabel: 'รับเงินมา (บาท)',
      exact:       'พอดี',
      change:      'เงินทอน',
      insufficient: 'ไม่เพียงพอ (ขาดอีก ',
      cancel:      'ยกเลิก',
      confirm:     'ยืนยันชำระเงิน',
      saving:      'กำลังบันทึก...',
      failed:      'การชำระเงินล้มเหลว',
    },
    success: {
      title:    'ชำระเงินสำเร็จ',
      newOrder: 'สั่งออเดอร์ใหม่',
    },
    admin: {
      menuLabel:    'Admin',
      modalTitle:   'เข้าสู่ระบบ Admin',
      emailLabel:   'อีเมล',
      passLabel:    'รหัสผ่าน',
      loginBtn:     'เข้าสู่ระบบ',
      loggingIn:    'กำลังเข้าสู่ระบบ...',
      cancel:       'ยกเลิก',
      noPermission: 'บัญชีนี้ไม่มีสิทธิ์ Admin',
      failed:       'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    },
    /** ภัตตาคาร (หน้า /dining) — wording ไม่ใช้กรอบขายของหมดสต็อก */
    dining: {
      currentRound:  'รายการรอบนี้',
      roundBadge:    'รอบ',
      noItemsHint:   'แตะเมนูแต่ละครั้งเพื่อเพิ่ม 1 ที่ — ใช้ +/- ในรายการด้านขวาปรับจำนวน',
    },
  },
} as const;

export type ThLocale = typeof th;
