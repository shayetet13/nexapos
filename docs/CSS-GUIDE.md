# NexaPos — CSS Guide

> อ้างอิงสำหรับ "ต้องการแก้ UI ส่วนนี้ ต้องไปแก้ไฟล์/class ใด" · ใช้คู่กับ `NAMING.md`

---

## Table of Contents

1. [CSS Architecture Overview](#1-css-architecture-overview)
2. [CSS Variables (Design Tokens)](#2-css-variables-design-tokens)
3. [File → UI Responsibility Map](#3-file--ui-responsibility-map)
4. [POS Page Classes](#4-pos-page-classes-stylespagesposcss)
5. [Dashboard Page Classes](#5-dashboard-page-classes-stylespagesdashboardcss)
6. [Admin Page Classes](#6-admin-page-classes-stylespagesadmincss)
7. [Customer Display Classes](#7-customer-display-classes-stylespagespaycss)
8. [Receipt Page Classes](#8-receipt-page-classes-stylespagesreceiptcss)
9. [Reports Page Classes](#9-reports-page-classes-stylespagesreportscss)
10. [Stock Page Classes](#10-stock-page-classes-stylespagesstockcss)
11. [Header Component Classes](#11-header-component-classes-stylescomponentsheadercss)
12. [Modal Classes](#12-modal-classes-stylescomponentsmodalcss)
13. [ThemeSwitcher Classes](#13-themeswitcher-classes-componentsthemeswitcherstylestsx)
14. [Landing Page Classes](#14-landing-page-classes-stylespageshomecss)
15. [Print Styles Reference](#15-print-styles-reference)
16. [Responsive Breakpoints](#16-responsive-breakpoints)
17. [Animation Classes](#17-animation-classes)
18. [Quick Fix Index](#18-quick-fix-index)

---

## 1. CSS Architecture Overview

### Import Chain
```
app/layout.tsx
    └─ @/styles/index.css
           ├─ globals.css           (reset, typography, keyframes)
           ├─ variables.css         (CSS custom properties — ALL themes)
           ├─ components/
           │   ├─ button.css
           │   ├─ input.css
           │   ├─ card.css
           │   ├─ modal.css
           │   ├─ skeleton.css
           │   ├─ header.css
           │   └─ pwa.css
           └─ pages/
               ├─ home.css
               ├─ login.css
               ├─ register.css
               ├─ select-shop.css
               ├─ select-branch.css
               ├─ pos.css           ← ใหญ่ที่สุด (POS + receipt modal + order detail)
               ├─ dashboard.css     ← รวม SalesReport (.rpt)
               ├─ admin.css         ← รวม StockTab (.stk__)
               ├─ dev.css
               ├─ pay.css           ← Customer Display
               ├─ receipt.css
               ├─ notifications.css
               ├─ subscription.css
               └─ refund.css

Per-page imports (ไม่ได้อยู่ใน index.css):
    app/reports/page.tsx      → @/styles/pages/reports.css
    app/stock/page.tsx        → @/styles/pages/stock.css
                               @/styles/pages/consumables.css
    app/withdraw/page.tsx     → @/styles/pages/withdraw.css
    app/subscription/page.tsx → @/styles/pages/subscription.css

Component-level imports:
    CustomersPanel.tsx  → @/styles/components/customers-panel.css
    PromotionsPanel.tsx → @/styles/components/promotions-panel.css
    WithdrawalApprovalModal.tsx → @/styles/pages/withdraw.css

Inline CSS (CSS-in-JS):
    ThemeSwitcherStyles.tsx → <style> tag in component
```

### Key Rules
- **BEM naming** — Block__Element--Modifier
- **No inline styles** — ใช้ Tailwind utilities หรือ CSS classes
- **Tailwind + custom CSS** ใช้ร่วมกัน — Tailwind สำหรับ spacing/flex/grid, custom CSS สำหรับ brand styles
- **CSS custom properties** สำหรับ theming — ไม่ hardcode สี

---

## 2. CSS Variables (Design Tokens)

> ไฟล์: `apps/frontend/src/styles/variables.css`
> แก้ที่นี่เพื่อ apply กับ **ทุก theme พร้อมกัน**

### Colors

```css
/* ════ Backgrounds ════ */
--color-bg              /* พื้นหลังหลัก (page bg) */
--color-bg-card         /* พื้นหลัง card / surface */
--color-bg-hover        /* hover state bg */
--color-bg-subtle       /* subtle bg (slightly lighter) */
--color-bg-card-hover   /* card hover */
--color-surface         /* surface level 1 */
--color-surface2        /* surface level 2 */
--color-surface3        /* surface level 3 */

/* ════ Brand ════ */
--color-primary         /* สีหลัก: #bf4422 (warm orange) */
--color-primary-hover   /* hover: #d95530 */
--color-primary-light   /* rgba(185,68,34,0.15) */
--color-primary-ghost   /* rgba(185,68,34,0.08) — subtle bg */

/* ════ Text ════ */
--color-text            /* ตัวหนังสือหลัก */
--color-text-muted      /* ตัวหนังสือรอง */
--color-text-subtle     /* ตัวหนังสือจาง */

/* ════ Borders ════ */
--color-border          /* border ปกติ */
--color-border-light    /* border อ่อน */
--color-border-active   /* border เมื่อ focus/active */

/* ════ Semantic ════ */
--color-success         /* #00e5a0 (เขียว) */
--color-success-bg      /* success background */
--color-error           /* #ff6b6b (แดง) */
--color-error-bg        /* error background */
--color-error-bg-hover  /* error hover */
--color-error-border    /* error border */
--color-warning         /* #fbbf24 (เหลือง) */
--color-warning-bg      /* warning background */
--color-info            /* #60a5fa (ฟ้า) */
--color-info-bg         /* info background */
--color-teal            /* #00b8a0 */
--color-orange          /* #f07840 */
--color-purple          /* purple accent */
```

### Typography

```css
--font-sans   /* 'Sora', -apple-system, BlinkMacSystemFont, ... */
--font-mono   /* 'JetBrains Mono', 'SF Mono', 'Fira Code', ... */

--text-xs     /* 0.75rem */
--text-sm     /* 0.8125rem */
--text-base   /* 0.9375rem */
--text-lg     /* 1.125rem */
--text-xl     /* 1.375rem */
--text-2xl    /* 1.625rem */
--text-3xl    /* 2rem */
--text-4xl    /* 2.5rem */
```

### Spacing & Radius

```css
--radius-sm   /* 0.375rem */
--radius      /* 0.625rem */
--radius-lg   /* 1rem */
--radius-xl   /* 1.25rem */
--radius-2xl  /* 1.5rem */
--radius-full /* 9999px */
```

### Shadows

```css
--shadow-xs            /* subtle */
--shadow-sm
--shadow-md
--shadow-lg            /* strong */
--shadow-xl
--shadow-primary-sm    /* primary-colored shadow */
--shadow-primary-md
```

### Transitions

```css
--ease-out    /* cubic-bezier(0.33, 1, 0.68, 1) */
--ease-spring /* cubic-bezier(0.34, 1.56, 0.64, 1) — bouncy */

--duration-fast   /* 150ms */
--duration-normal /* 200ms */
--duration-slow   /* 300ms */
```

### Theme Override Pattern

```css
/* Default (Warm Dark) — :root */
:root { --color-bg: #0c0806; }

/* Light Mode */
[data-theme="light"] { --color-bg: #faf7f4; }

/* Ocean Dark */
[data-theme="ocean"] { --color-bg: #050d1a; }
```

---

## 3. File → UI Responsibility Map

| ต้องการแก้ UI ส่วนนี้ | แก้ไฟล์ CSS นี้ |
|--------------------|----------------|
| สีทั้งระบบ / theme | `variables.css` |
| Typography global | `globals.css` |
| ปุ่มทุกชนิด | `components/button.css` |
| Input/form field | `components/input.css` |
| Card container | `components/card.css` |
| Modal overlay | `components/modal.css` |
| Loading skeleton | `components/skeleton.css` |
| Header ด้านบน (AuthHeader) | `components/header.css` |
| PWA install banner | `components/pwa.css` |
| แผงลูกค้า (POS sidebar) | `components/customers-panel.css` |
| แผงโปรโมชั่น (POS sidebar) | `components/promotions-panel.css` |
| Landing page | `pages/home.css` |
| หน้า Login / QR Login | `pages/login.css` |
| หน้าสมัครบัญชี | `pages/register.css` |
| หน้าเลือกร้าน | `pages/select-shop.css` |
| หน้าเลือกสาขา | `pages/select-branch.css` |
| **หน้า POS (ทั้งหมด)** | `pages/pos.css` |
| Receipt modal (ใน POS) | `pages/pos.css` (`.receipt-modal`) |
| Order detail modal | `pages/pos.css` (`.pos-order-detail-*`) |
| **หน้า Dashboard** | `pages/dashboard.css` |
| Sales Report document | `pages/dashboard.css` (`.rpt`) |
| **หน้า Admin (tabs ทั้งหมด)** | `pages/admin.css` |
| StockTab (ใน Admin) | `pages/admin.css` (`.stk__`) |
| Dev page | `pages/dev.css` |
| **หน้าจอลูกค้า (/pay)** | `pages/pay.css` |
| **ใบเสร็จออนไลน์** | `pages/receipt.css` |
| **หน้า Reports P&L** | `pages/reports.css` |
| **หน้าจัดการสต๊อก (/stock)** | `pages/stock.css` |
| Tab วัตถุดิบ | `pages/consumables.css` |
| หน้าเบิกของ | `pages/withdraw.css` |
| หน้าคืนเงิน | `pages/refund.css` |
| หน้าแพ็กเกจ | `pages/subscription.css` |
| หน้าการแจ้งเตือน | `pages/notifications.css` |
| ปุ่มเปลี่ยนธีม | `ThemeSwitcherStyles.tsx` (CSS-in-JS) |

---

## 4. POS Page Classes (`styles/pages/pos.css`)

### Root Structure

```
.pos-wrap                    ← root container (flex column, 100dvh)
├─ .pos-topnav               ← top navigation bar
│   ├─ .pos-topnav__left
│   │   ├─ .pos-topnav__logo
│   │   │   ├─ .pos-topnav__logo-img    ← shop logo image
│   │   │   └─ .pos-topnav__logo-brand  ← shop name text
│   │   └─ .pos-topnav__tabs
│   │       ├─ .pos-topnav__tab         ← nav tab item
│   │       └─ .pos-topnav__tab--active ← current tab
│   └─ .pos-topnav__right
│       ├─ .pos-bt-btn                  ← printer connect button
│       ├─ .pos-bt-btn--on              ← connected state
│       ├─ .pos-stat-pill--sales        ← "💰 ฿XXX" daily sales pill
│       ├─ .pos-stat-pill--orders       ← orders count pill
│       │   └─ .pos-stat-pill--active   ← panel open state
│       ├─ .pos-avatar-wrap             ← profile area
│       │   └─ .pos-avatar-btn          ← profile button
│       └─ (ThemeSwitcher--topnav)
│
└─ .pos-body                 ← main content (flex row)
    ├─ .pos-products         ← left: product grid
    │   ├─ .pos-search-wrap  ← search bar
    │   ├─ .pos-low-stock-banner      ← red alert strip
    │   │   ├─ .pos-low-stock-banner__icon
    │   │   ├─ .pos-low-stock-banner__title
    │   │   └─ .pos-low-stock-banner__item
    │   └─ .pos-product-card          ← product tile
    │       ├─ .pos-product-card--selected  ← in cart
    │       └─ .pos-product-card--oos       ← out of stock
    │
    └─ .pos-cart-panel       ← right: cart
        ├─ .pos-cart__header
        ├─ .pos-cart__items
        ├─ .pos-cart__item
        ├─ .pos-cart-item__qty         ← quantity input
        ├─ .pos-cart__totals
        ├─ .pos-cart__grand            ← grand total
        └─ .pos-cart__actions          ← checkout button
```

### Birthday Banner

```css
.pos-birthday-banner          /* yellow banner when customer birthday */
.pos-birthday-banner__title
.pos-birthday-banner__sub
```

### Receipt Modal (ใน POS — ไม่ใช่ /receipt page)

```css
.receipt-modal               /* centered modal box */
.receipt-modal__head
.receipt-modal__items
.receipt-modal__totals
.receipt-modal__actions      /* hidden on print */
.receipt__thank              /* footer section */
```

### Order Detail Modal

```css
.pos-order-detail-overlay    /* backdrop */
.pos-order-detail-modal      /* modal box */
.pos-order-detail-modal__head
.pos-order-detail-modal__title
.pos-order-detail-modal__sub
.pos-order-detail-modal__close
.pos-order-detail-modal__body   /* scrollable content */
.pos-order-detail-modal__foot

.pos-order-print-header      /* print-only header (hidden on screen) */
.pos-order-print-shop
.pos-order-print-branch
.pos-order-print-title

.pos-order-detail-meta       /* key-value metadata section */
.pos-order-detail-meta__row
.pos-order-detail-meta__label
.pos-order-detail-meta__val
.pos-order-detail-meta__val--seq   /* order number (special) */

.pos-order-detail-tbl        /* items table */
.pos-order-detail-tbl__name
.pos-order-detail-tbl__num
.pos-order-detail-tbl__subtotal
.pos-order-detail-tbl__total-val
```

### Today Orders Panel

```css
.pos-today-orders            /* slide-in panel */
.pos-today-header
.pos-today-list
.pos-today-item              /* order row */
.pos-today-item__time
.pos-today-item__number
.pos-today-item__amount
.pos-today-item__status      /* status badge */
```

### CheckoutModal (`.cm`)

```css
.cm                          /* modal root */
.cm__head
.cm__method                  /* payment method tabs */
.cm__body
.cm__qr-card                 /* PromptPay QR display */
.cm__qr-countdown
.cm__qr-amount
.cm__actions
```

### SuccessModal (`.sm2`)

```css
.sm2                         /* modal root */
.sm2__glow                   /* background glow effect */
.sm2__ring                   /* checkmark ring */
.sm2__title                  /* "ชำระเงินสำเร็จ!" */
.sm2__sub                    /* order number + date */
.sm2__receipt                /* receipt card */
.sm2__row                    /* row in receipt card */
.sm2__row-l                  /* label */
.sm2__row-v                  /* value */
.sm2__row-v--red             /* negative value (discount) */
.sm2__total                  /* grand total */
.sm2__actions
```

---

## 5. Dashboard Page Classes (`styles/pages/dashboard.css`)

```css
/* ── Root ── */
.dash                        /* page root */
.dash__body                  /* content area (max-width: 1320px) */

/* ── Top Bar ── */
.dash__topbar
.dash__topbar-info
.dash__shop-avatar           /* shop logo (44x44px) */
.dash__shop-meta
.dash__shop-name
.dash__shop-sub
.dash__branch-pill           /* branch badge */
.dash__branch-suffix         /* " · Branch Name" */
.dash__topbar-actions
.dash__live-badge            /* "● Live" */
.dash__live-dot              /* pulsing dot */
.dash__select                /* shop/branch dropdown */
.dash__btn-print             /* 🖨 พิมพ์ button */
.dash__btn-pdf               /* 📄 ส่งออก PDF button */

/* ── Date Selector ── */
.dash__date-selector
.dash__mode-tabs
.dash__mode-tab
.dash__mode-tab--active
.dash__nav-area
.dash__nav-row
.dash__nav-btn               /* ‹ › navigation */
.dash__period-display
.dash__date-input-inline
.dash__month-sel
.dash__inline-select

/* ── KPI Cards ── */
.dash__kpi-row               /* grid of KPI cards */
.dash__kpi-card
.dash__kpi-label
.dash__kpi-value             /* big number */
.dash__kpi-unit              /* "บาท" / "ครั้ง" */
.dash__kpi-sub               /* sub text */
.dash__kpi-change            /* +/- change indicator */

/* ── Charts ── */
.dash__chart-row             /* 2-column chart grid */
.dash__card                  /* chart container */
.dash__card-title
.dash__chart-wrap            /* recharts wrapper */

/* ── Summary Grid ── */
.dash__summary-grid          /* 4-column grid */
.dash__summary-card
.dash__summary-label
.dash__summary-value

/* ── Bottom Row ── */
.dash__bottom-row            /* top products + payment */
.dash__table                 /* data table */
.dash__table-name
.dash__table-total

/* ── Subscription Card ── */
.dash__sub-card
.dash__sub-plan-badge
.dash__sub-days-pill
.dash__sub-days-pill--ok / --warn / --danger / --exp
.dash__sub-usage
.dash__sub-bar-track
.dash__sub-bar-fill
.dash__sub-cta               /* upgrade CTA button */

/* ── PDF / Print ── */
.dash__pdf-container         /* off-screen container (position: fixed; left: -99999px) */
                             /* id: "dash-pdf-container" */
.print-only                  /* hidden on screen, block on print */
.no-print                    /* hidden on print */
.dash__print-header          /* print header section */

/* ── Skeletons ── */
.dash__skel-topbar
.dash__skel-datebar
.dash__skel-hero
.dash__skel-mini
.dash__skel-chart

/* ── Sales Report (inside #dash-pdf-container) ── */
.rpt                         /* A4-style document wrapper (794px wide) */
.rpt__header                 /* report header row */
.rpt__title                  /* "รายงานสรุปยอดขาย" */
.rpt__subtitle               /* shop + branch */
.rpt__header-right           /* date / period info */
.rpt__kpi-grid               /* 4-column KPI grid */
.rpt__kpi                    /* KPI box */
.rpt__kpi-label
.rpt__kpi-value
.rpt__kpi-value--main        /* highlighted main value */
.rpt__kpi-unit
.rpt__section                /* report section */
.rpt__section-title          /* section heading */
.rpt__table                  /* data table (border-collapse) */
.rpt__th-r                   /* right-aligned header */
.rpt__td-r                   /* right-aligned cell */
.rpt__tr-even                /* alternating row */
.rpt__tfoot-label            /* footer label */
.rpt__tfoot-val              /* footer value */
.rpt__footer                 /* document footer */
```

---

## 6. Admin Page Classes (`styles/pages/admin.css`)

```css
/* ── Root & Structure ── */
.page-admin                  /* root */
.page-admin__header-wrap     /* sticky top (z-100) */
.page-admin__content         /* main content area */
.page-admin__tabs            /* tab bar */
.page-admin__tab
.page-admin__tab--active

/* ── Sections ── */
.page-admin__section         /* flex space-between header */
.page-admin__title           /* section title (xl, bold) */
.page-admin__subtitle        /* section subtitle */

/* ── Cards ── */
.page-admin__card            /* form/content card */
.page-admin__card-title      /* card heading */
.page-admin__form            /* space-y-4 form */
.page-admin__form-actions    /* button row */
.page-admin__label           /* xs uppercase label */
.page-admin__select          /* select styling */

/* ── Lists ── */
.page-admin__list            /* grid (1–4 cols) */
.page-admin__list-item       /* card item */
.page-admin__list-main       /* flex inside item */
.page-admin__list-image      /* product thumbnail */
.page-admin__list-info       /* name + sku */

/* ── States ── */
.page-admin__empty           /* empty state (📦 + text) */
.page-admin__error           /* error banner */

/* ── Modal ── */
.page-admin__modal-overlay   /* backdrop */
.page-admin__modal           /* modal box */

/* ── StockTab (.stk__) ── */
.stk__root                   /* flex row: sidebar + main */
.stk__sidebar                /* left sidebar */
.stk__summary-card           /* summary stat card */
.stk__branch-card            /* branch selector */
.stk__unit-card              /* units manager */
.stk__main                   /* right content */
.stk__subtabs                /* tab bar inside stock */
.stk__controls               /* search + filter bar */
.stk__search                 /* search input */
.stk__btn-print              /* 🖨 print button */
.stk__table                  /* stock data table */
.stk__qty-badge--ok          /* green qty badge */
.stk__qty-badge--warn        /* orange badge */
.stk__qty-badge--low         /* red badge */
.stk__modal-overlay          /* modal backdrop */
.stk__modal                  /* add/edit stock modal */
.stk__modal-header
.stk__modal-title
.stk__form-label
.stk__required               /* * required indicator */
.stk__modal-actions

/* ── Shop Code Block ── */
.shop-code-block
.shop-code-block__display

/* Print: admin.css @media print ── */
/* hides: .stock-controls, .page-admin__tabs, .page-admin__header-wrap, .page-admin__section button */
/* stk__ print: hides sidebar + subtabs, shows table in B&W */
```

---

## 7. Customer Display Classes (`styles/pages/pay.css`)

```css
/* ── Root ── */
.pd-wrap                     /* fixed full-screen (position: fixed, inset: 0) */

/* ── Connection Status ── */
.pd-status                   /* top-left indicator */
.pd-status__dot              /* colored dot */
.pd-status--connected        /* green + glow animation */
.pd-status--connecting       /* amber + blink */
.pd-status--disconnected     /* red, no animation */
.pd-status__text             /* "เชื่อมต่อแล้ว" */

/* ── Idle Screen ── */
.pd-idle                     /* full-screen idle display */
.pd-idle__scan               /* scan rings container (160x160px) */
.pd-idle__scan-ring          /* animated expanding ring */
.pd-idle__scan-inner         /* center circle */
.pd-idle__logo               /* shop logo (floats) */
.pd-idle__title              /* "พร้อมรับชำระ" */
.pd-idle__sub                /* description */
.pd-idle__shop               /* shop name */

/* ── Cash Screen ── */
.pd-cash                     /* cash payment screen */
.pd-cash__header             /* method indicator */
.pd-cash__amount             /* large amount display */
.pd-cash__note               /* instruction */

/* ── QR Screen ── */
.pd-qr                       /* QR payment screen */
.pd-qr__card                 /* QR code container */
.pd-qr__logo                 /* PromptPay logo */
.pd-qr__code                 /* QR image */
.pd-qr__amount               /* amount */
.pd-qr__countdown            /* expiration timer */
.pd-qr__note                 /* instruction */

/* ── Success Screen ── */
.pd-success                  /* payment complete screen */
.pd-success__ring            /* checkmark animation */
.pd-success__title
.pd-success__amount
```

---

## 8. Receipt Page Classes (`styles/pages/receipt.css`)

> หน้า `/receipt/[token]` — ใบเสร็จออนไลน์ (ไม่ใช่ receipt modal ใน POS)

```css
/* ── Root ── */
.rcpt-page                   /* gray bg, flex column */

/* ── Bill Container ── */
.rcpt-bill                   /* white thermal-style box (360px max) */
                             /* ::before/::after = torn edge effects */

/* ── Header Section ── */
.rcpt-header                 /* centered header */
.rcpt-logo                   /* shop logo (64x64px) */
.rcpt-shop-name              /* shop name (uppercase) */
.rcpt-branch                 /* branch name */
.rcpt-address                /* shop address */
.rcpt-title                  /* "ใบเสร็จรับเงิน" */

/* ── Dividers ── */
.rcpt-divider                /* separator */
.rcpt-divider--dashed        /* - - - - - */
.rcpt-divider--solid         /* ─────── */

/* ── Order Metadata ── */
.rcpt-meta                   /* grid of meta rows */
.rcpt-meta-row               /* label: value row */
.rcpt-meta-value             /* value side */

/* ── Items Table ── */
.rcpt-items                  /* table (border-collapse) */
.rcpt-items__head            /* thead (name / qty / price) */
.rcpt-items__row             /* item row */
.rcpt-items__name            /* product name */
.rcpt-items__qty             /* quantity */
.rcpt-items__price           /* unit price */
.rcpt-items__subtotal        /* line subtotal */

/* ── Totals ── */
.rcpt-totals                 /* totals section */
.rcpt-totals__row            /* subtotal / discount / VAT / total rows */
.rcpt-totals__label
.rcpt-totals__val
.rcpt-totals__row--total     /* grand total (bold) */

/* ── Footer ── */
.rcpt-footer                 /* thank you message */
.rcpt-footer__qr             /* QR code display (optional) */

/* ── Actions ── */
.rcpt-actions                /* button bar */
.rcpt-btn                    /* base button */
.rcpt-btn--primary           /* download image */
.rcpt-btn--secondary         /* close window */

/* ── Error ── */
.rcpt-error
.rcpt-error__icon
.rcpt-error__msg
.rcpt-error__sub

/* ── Print: receipt.css @media print (none needed — page IS the receipt) ── */
```

---

## 9. Reports Page Classes (`styles/pages/reports.css`)

```css
/* ── Root ── */
.rpt__page                   /* page root */

/* ── Navigation ── */
.rpt__header-wrap            /* sticky top nav (AuthHeader) */

/* ── Content ── */
.rpt__body                   /* main content area */
.rpt__loading                /* loading state */
.rpt__error                  /* error message */

/* ── Top Bar ── */
.rpt__topbar                 /* title + shop selector */
.rpt__topbar-left
.rpt__title                  /* "📊 รายงาน กำไร-ขาดทุน" */
.rpt__shop-name
.rpt__select                 /* dropdown */

/* ── Filters ── */
.rpt__filters                /* filter bar */
.rpt__filter-group           /* label + input pair */
.rpt__filter-label           /* "ตั้งแต่" / "ถึง" */
.rpt__date-input             /* date picker */
.rpt__btn-primary            /* "🔍 ดูรายงาน" */
.rpt__btn-export             /* "📥 CSV" / "🖨 พิมพ์" / "📄 PDF" */

/* ── KPI Cards ── */
.rpt__kpi-row                /* responsive grid */
.rpt__kpi-card               /* card container */
.rpt__kpi-card--blue         /* left border accent */
.rpt__kpi-card--amber
.rpt__kpi-card--green
.rpt__kpi-card--red
.rpt__kpi-card--purple
.rpt__kpi-label              /* "💰 รายได้รวม" */
.rpt__kpi-val                /* large number */
.rpt__kpi-sub                /* sub info */

/* ── Data Grid ── */
.rpt__section                /* data section */
.rpt__section-title          /* section header */
.rpt-grid                    /* grid container */
.rpt-grid--breakdown         /* payment breakdown variant */
.rpt-grid--products          /* top products variant */
.rpt-row                     /* data row (display: grid) */
.rpt-row--head               /* header row */
.rpt-row--foot               /* footer/totals row */
.rpt-row--loss               /* loss row (red bg) */
.rpt-cell                    /* cell */
.rpt-cell--r                 /* right-aligned */
.rpt-cell--num               /* numeric */
.rpt-cell--period            /* period label */
.rpt-cell--gp                /* gross profit */
.rpt-pos                     /* positive value (green) */
.rpt-neg                     /* negative value (red) */

/* ── Footer ── */
.rpt__footer                 /* page footer */
.rpt__footer-link            /* nav links */

/* ── Print Header ── */
.rpt__print-header           /* hidden on screen, block on print */
.rpt__print-title
.rpt__print-meta
```

---

## 10. Stock Page Classes (`styles/pages/stock.css`)

> หน้า `/stock` — แยกจาก StockTab ใน Admin

```css
/* ── Inventory Controls ── */
.inv__wrap                   /* content wrapper */
.inv__btn-ghost              /* ghost-style button */
.inv__btn-ghost--active      /* active state */
.inv__btn-transfer           /* transfer stock button */

/* ── Stock Table (legacy stock-* classes) ── */
.stock-table-wrap            /* scrollable wrapper */
.stock-table                 /* data table */
.stock-thumb                 /* product thumbnail (36x36px) */
.stock-min-qty               /* min qty display (monospace) */
.stock-empty                 /* empty state */
.stock-badge                 /* qty badge */
.stock-badge--ok             /* green */
.stock-badge--warn           /* orange */
.stock-badge--low            /* red */
.stock-controls              /* filter/search bar */
.stock-unit-manager          /* unit management section */
```

---

## 11. Header Component Classes (`styles/components/header.css`)

```css
.auth-header                 /* header bar (sticky, z-50) */
.auth-header__left           /* left side: back + title */
.auth-header__back           /* ← back button */
.auth-header__title          /* brand name (cyan) */
.auth-header__nav            /* navigation links (flex) */
.auth-header__link           /* nav link item */
.auth-header__link--active   /* current page (cyan bg) */
.auth-header__link--admin    /* admin badge style */
.auth-header__right          /* right side: bell + logout */
.auth-header__logout         /* logout button */

/* ── Notification Bell ── */
.notif-bell                  /* bell widget */
.notif-bell__btn             /* bell icon button */
.notif-bell__badge           /* unread count (red dot) */
.notif-bell__panel           /* dropdown (320px) */
.notif-bell__header          /* panel header */
.notif-bell__list            /* notification list */
.notif-bell__item            /* notification item */
.notif-bell__item--unread    /* unread (cyan bg) */
.notif-bell__item--clickable /* has action */
.notif-bell__icon            /* notification icon */
.notif-bell__content         /* text content */
.notif-bell__title           /* notification title */
.notif-bell__time            /* timestamp */
.notif-bell__empty           /* no notifications */
```

---

## 12. Modal Classes (`styles/components/modal.css`)

> Global modal — ใช้กับ component ที่ไม่มี custom CSS

```css
.modal-overlay               /* fixed inset-0, z-9999, backdrop */
.modal-content               /* modal box (max-w: 448px, slide-up animation) */
.modal-header                /* title row */
.modal-title                 /* heading */
.modal-body                  /* scrollable content */
.modal-footer                /* button row */
```

---

## 13. ThemeSwitcher Classes (`components/ThemeSwitcherStyles.tsx`)

> CSS-in-JS — แก้ใน `ThemeSwitcherStyles.tsx` ไม่ใช่ CSS file

```css
/* ── Floating Variant (default) ── */
.theme-switcher              /* fixed bottom-right (z-999) */
.theme-switcher__btn         /* toggle button */
.theme-switcher__icon        /* icon (15px) */
.theme-switcher__label       /* "Warm" / "Light" / "Ocean" */
.theme-switcher__backdrop    /* click-outside trap */
.theme-switcher__dropdown    /* dropdown menu */
.theme-switcher__option      /* theme option */
.theme-switcher__option--active  /* current theme */
.theme-switcher__option-icon     /* theme icon */
.theme-switcher__option-label    /* theme name */
.theme-switcher__option-desc     /* theme description */

/* ── Topnav Variant ── */
.theme-switcher--topnav      /* positioned in header (relative) */
                             /* .theme-switcher__btn → 36x36px circle */
                             /* dropdown opens downward */

/* ── Hidden States ── */
/* body:has(.rcpt-page) .theme-switcher    — hidden on receipt */
/* body:has(.pd-wrap) .theme-switcher      — hidden on Customer Display */
/* @media (pointer: coarse) and (max-width: 767px) — hidden on phones */
```

---

## 14. Landing Page Classes (`styles/pages/home.css`)

```css
/* ── Navigation ── */
.lp-nav                      /* sticky top nav */
.lp-nav__logo
.lp-nav__links
.lp-nav__cta

/* ── Hero Section ── */
.lp-root                     /* page root */
.lp-hero                     /* hero section */
.lp-hero__badge              /* "🔥 New" badge */
.lp-hero__title              /* headline */
.lp-hero__sub                /* subheading */
.lp-hero__actions            /* CTA buttons */

/* ── Features ── */
.lp-features                 /* features grid */
.lp-feature-card             /* feature item */
.lp-feature-card__icon
.lp-feature-card__title
.lp-feature-card__desc

/* ── Pricing ── */
.lp-pricing                  /* pricing section */
.lp-plan-card
.lp-plan-card--featured      /* highlighted plan */
.lp-plan-card__name
.lp-plan-card__price
.lp-plan-card__features

/* ── Footer ── */
.lp-footer
```

---

## 15. Print Styles Reference

### Dashboard Print (`@media print` in `dashboard.css`)
```
ซ่อน: .dash__body (interactive dashboard)
แสดง: .dash__pdf-container → .rpt (SalesReport document)
```

### Reports Print (`@media print` in `reports.css`)
```
ซ่อน: .rpt__header-wrap, .rpt__topbar, .rpt__filters, .rpt__btn-*
แสดง: .rpt__print-header (title + date range + print time)
```

### Stock Print (`@media print` in `admin.css`)
```
ซ่อน: .stk__sidebar, .stk__subtabs, controls
แสดง: .stk__table ใน B&W
```

### Order Detail Print (`@media print` in `pos.css`)
```
ซ่อน: .pos-wrap > * (ทุกอย่างใน pos-wrap)  [เฉพาะเมื่อ .pos-order-detail-overlay เปิดอยู่]
แสดง: .pos-order-detail-modal พร้อม .pos-order-print-header
```

### Receipt Page Print
```
ไม่ต้องทำอะไรพิเศษ — .rcpt-page IS the receipt
ซ่อน .rcpt-actions, แสดง .rcpt-bill
```

### Helper Classes

```css
.no-print     { display: none !important; }     /* ใน @media print */
.print-only   { display: block !important; }    /* ใน @media print */
/* ทั้งคู่ defined ใน dashboard.css และ globals.css */
```

---

## 16. Responsive Breakpoints

> NexaPos ใช้ Tailwind breakpoints เป็นหลัก

| Breakpoint | Min-width | ใช้สำหรับ |
|-----------|----------|---------|
| (default) | 0px | mobile portrait |
| `sm:` | 640px | tablet portrait |
| `md:` | 768px | tablet landscape |
| `lg:` | 1024px | small desktop |
| `xl:` | 1280px | desktop |
| `2xl:` | 1536px | large desktop |

### POS Specific

```css
/* Phone only (hide theme switcher) */
@media (pointer: coarse) and (max-width: 767px) { }

/* iPad/Tablet (show everything) */
/* ← ไม่ซ่อน theme switcher */

/* POS body layout */
@media (max-width: 768px) {
  .pos-body { flex-direction: column; }
}
```

### Stock Page

```css
@media (max-width: 860px) {
  .stk__root { flex-direction: column; }
  .stk__sidebar { flex-direction: row; flex-wrap: wrap; }
}
```

---

## 17. Animation Classes

> Keyframes defined ใน `globals.css`

| Class / Keyframe | Effect | ใช้ใน |
|----------------|--------|-------|
| `fade-up` | opacity 0→1 + translateY(12px→0), 0.4s | dashboard body, admin content |
| `modal-slide-up` | opacity + scale + translateY, spring | modals, cards |
| `dash-fade-up` | fade up สำหรับ dashboard | dashboard sections |
| `pd-scan-pulse` | expanding rings (Customer Display) | idle scan animation |
| `pd-float-y` | gentle vertical float | idle logo |
| `skeleton-shimmer` | shimmer left→right | Skeleton component |
| `spin` | 360° rotation | loading indicators |

### CSS Custom Animation Properties

```css
animation: modal-slide-up 0.4s var(--ease-spring) both;
animation: fade-up 0.15s var(--ease-out) both;
animation: dash-fade-up 0.4s ease both;
```

---

## 18. Quick Fix Index

> "ต้องการแก้..." → ไปที่ไฟล์/class นี้

| ต้องการแก้ | ไฟล์ | Class/Variable |
|----------|------|----------------|
| สีพื้นหลังทั้งระบบ | `variables.css` | `--color-bg` |
| สีปุ่มหลัก (orange) | `variables.css` | `--color-primary` |
| font ทั้งระบบ | `variables.css` | `--font-sans` |
| ขนาด/padding header | `components/header.css` | `.auth-header` |
| สีข้อความใน header | `components/header.css` | `.auth-header__title`, `.auth-header__link` |
| ขนาด/สี modal backdrop | `components/modal.css` | `.modal-overlay` |
| ปุ่มเปลี่ยนธีม (ขนาด/ตำแหน่ง) | `ThemeSwitcherStyles.tsx` | `.theme-switcher` |
| ปุ่มธีมใน header | `ThemeSwitcherStyles.tsx` | `.theme-switcher--topnav` |
| Layout หน้า POS | `pages/pos.css` | `.pos-body`, `.pos-products` |
| สี/ขนาด product card | `pages/pos.css` | `.pos-product-card` |
| ตะกร้าสินค้า (cart) | `pages/pos.css` | `.pos-cart-panel`, `.pos-cart__*` |
| Modal ชำระเงิน | `pages/pos.css` | `.cm`, `.cm__*` |
| Modal สำเร็จ | `pages/pos.css` | `.sm2`, `.sm2__*` |
| KPI cards บน dashboard | `pages/dashboard.css` | `.dash__kpi-card`, `.dash__kpi-value` |
| Sales report (print/PDF) | `pages/dashboard.css` | `.rpt`, `.rpt__*` |
| Tab bar ใน Admin | `pages/admin.css` | `.page-admin__tabs`, `.page-admin__tab` |
| Product list ใน Admin | `pages/admin.css` | `.page-admin__list`, `.page-admin__list-item` |
| StockTab layout | `pages/admin.css` | `.stk__root`, `.stk__sidebar` |
| Stock badges (ok/warn/low) | `pages/admin.css` | `.stk__qty-badge--*` |
| Customer Display idle screen | `pages/pay.css` | `.pd-idle`, `.pd-idle__*` |
| Customer Display QR screen | `pages/pay.css` | `.pd-qr`, `.pd-qr__*` |
| ใบเสร็จออนไลน์ | `pages/receipt.css` | `.rcpt-bill`, `.rcpt-*` |
| ตาราง P&L reports | `pages/reports.css` | `.rpt-grid`, `.rpt-row`, `.rpt-cell` |
| KPI cards ใน reports | `pages/reports.css` | `.rpt__kpi-card`, `.rpt__kpi-val` |
| Landing page hero | `pages/home.css` | `.lp-hero`, `.lp-hero__title` |
| ซ่อน/แสดงตอนพิมพ์ | ไฟล์ที่เกี่ยวข้อง | `.no-print`, `.print-only` |

---

*อัปเดตเมื่อ 2026-04 · อ่านประกอบกับ `NAMING.md` และ `ARCHITECTURE.md`*
