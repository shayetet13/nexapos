'use client';

import { Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createSupabaseClient, fetchWithAuth, getAuthToken } from '@/lib/supabase';
import { getActiveUserIdFromStorage, getResolvedCurrentThemeForClient, persistThemeSelection } from '@/lib/theme-preference';
import { Skeleton } from '@/components/ui/Skeleton';
import { th } from '@/lib/locales/th';
import { CustomersPanel, type CustomerInfo } from '@/components/CustomersPanel';
import { PromotionsPanel } from '@/components/PromotionsPanel';
import { type Product, type CartItem, type PosStats, type TodayOrder, type OrderDetail } from '@/components/pos/pos-types';
import { TodayOrdersPanel }        from '@/components/pos/TodayOrdersPanel';
import { OrderDetailModal }        from '@/components/pos/OrderDetailModal';
import { CartPanel }               from '@/components/pos/CartPanel';
import { CheckoutModal }           from '@/components/pos/CheckoutModal';
import { SuccessModal }            from '@/components/pos/SuccessModal';
import { AdminLoginModal }         from '@/components/pos/AdminLoginModal';
import { CustomerDisplayLinkModal } from '@/components/pos/CustomerDisplayLinkModal';
import { WithdrawalApprovalModal, type WithdrawalRequest } from '@/components/pos/WithdrawalApprovalModal';
import { PosProductCard } from '@/components/pos/PosProductCard';

const t = th.pos;
const API_URL    = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
// Direct backend URL for in-process broadcast (display endpoint)
const API_DIRECT = process.env.NEXT_PUBLIC_API_URL_DIRECT ?? API_URL;
// WS goes direct to backend — CF Worker does not proxy WebSocket upgrades
const WS_URL     = process.env.NEXT_PUBLIC_WS_URL ?? API_URL.replace(/^http/, 'ws');

const NAV_TABS = [
  { id: 'customers',  icon: '👥',  label: t.nav.customers  },
  { id: 'promotions', icon: '🎁',  label: t.nav.promotions },
  { id: 'history',    icon: '📜',  label: t.nav.history    },
] as const;

/* ── Theme helpers ── */
type Theme = 'warm' | 'light' | 'ocean';
const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: 'warm',  label: 'ธีมหลัก', icon: '🔥' },
  { id: 'light', label: 'ขาว',     icon: '☀️' },
  { id: 'ocean', label: 'ดำ',      icon: '🌊' },
];
const THEME_BG: Record<Theme, string> = { warm: '#0c0806', light: '#faf7f4', ocean: '#050d1a' };
function posApplyTheme(theme: Theme) {
  const root = document.documentElement;
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '999998',
    pointerEvents: 'none', background: THEME_BG[theme],
    clipPath: 'circle(0% at 100% 0%)',
  });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.transition = 'clip-path 0.85s cubic-bezier(0.76, 0, 0.24, 1)';
      overlay.style.clipPath   = 'circle(142% at 100% 0%)';
      setTimeout(() => {
        if (theme === 'warm') root.removeAttribute('data-theme');
        else root.setAttribute('data-theme', theme);
        persistThemeSelection(theme, getActiveUserIdFromStorage());
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.style.opacity    = '0';
        setTimeout(() => overlay.remove(), 320);
      }, 880);
    });
  });
}

/* ── Order-sequence helpers (localStorage per shop; day rolls at 00:15 Asia/Bangkok) ── */
const POS_SEQ_TZ = 'Asia/Bangkok' as const;

function bkkYmdString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function bkkCalendarParts(t: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:  POS_SEQ_TZ,
    year:      'numeric',
    month:     '2-digit',
    day:       '2-digit',
  }).formatToParts(t);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: n('year'), m: n('month'), d: n('day') };
}

function bkkSecSinceMidnight(t: Date): number {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone:  POS_SEQ_TZ,
    hour:      '2-digit',
    minute:    '2-digit',
    second:    '2-digit',
    hour12:    false,
  }).formatToParts(t);
  const h = Number(p.find((x) => x.type === 'hour')?.value);
  const m = Number(p.find((x) => x.type === 'minute')?.value);
  const s = Number(p.find((x) => x.type === 'second')?.value);
  return h * 3600 + m * 60 + s;
}

/** YYYY-MM-DD of POS "business day": before 00:15 BKK still counts as previous calendar day. */
function posBusinessDayStr(): string {
  const now   = new Date();
  const { y, m, d } = bkkCalendarParts(now);
  if (bkkSecSinceMidnight(now) >= 15 * 60) {
    return bkkYmdString(y, m, d);
  }
  const ref  = new Date(`${bkkYmdString(y, m, d)}T12:00:00+07:00`);
  const prev = new Date(ref.getTime() - 24 * 60 * 60 * 1000);
  const q    = bkkCalendarParts(prev);
  return bkkYmdString(q.y, q.m, q.d);
}

function loadSeq(shopId: string): number {
  try {
    const key = posBusinessDayStr();
    const storedDate = localStorage.getItem(`pos_seq_date_${shopId}`) ?? '';
    if (storedDate !== key) {
      localStorage.setItem(`pos_seq_date_${shopId}`, key);
      localStorage.setItem(`pos_seq_${shopId}`, '1');
      return 1;
    }
    return Math.max(1, Number(localStorage.getItem(`pos_seq_${shopId}`)) || 1);
  } catch { return 1; }
}
function saveSeq(shopId: string, seq: number): void {
  try {
    localStorage.setItem(`pos_seq_date_${shopId}`, posBusinessDayStr());
    localStorage.setItem(`pos_seq_${shopId}`, String(seq));
  } catch { /* ignore */ }
}
function resetSeq(shopId: string): number {
  try {
    localStorage.setItem(`pos_seq_date_${shopId}`, posBusinessDayStr());
    localStorage.setItem(`pos_seq_${shopId}`, '1');
  } catch { /* ignore */ }
  return 1;
}
/** Millis until the next 00:15:00 in Asia/Bangkok (inclusive of that instant). */
function msUntilDailyReset(): number {
  const now   = new Date();
  const { y, m, d } = bkkCalendarParts(now);
  const today   = bkkYmdString(y, m, d);
  let target = new Date(`${today}T00:15:00+07:00`);
  if (target.getTime() <= now.getTime()) {
    const ref = new Date(`${today}T12:00:00+07:00`);
    const nxt = new Date(ref.getTime() + 24 * 60 * 60 * 1000);
    const q   = bkkCalendarParts(nxt);
    target    = new Date(`${bkkYmdString(q.y, q.m, q.d)}T00:15:00+07:00`);
  }
  return Math.max(0, target.getTime() - now.getTime());
}

/* ── Main POS content ── */
function POSContent() {
  const searchParams = useSearchParams();
  const shopId     = searchParams.get('shopId');
  const branchId   = searchParams.get('branchId');
  const shopName   = searchParams.get('shopName')   ?? 'ร้านค้า';
  const branchName = searchParams.get('branchName') ?? 'สาขา';

  const [products, setProducts]         = useState<Product[]>([]);
  const [cart, setCart]                 = useState<CartItem[]>([]);
  const [orderNumber, setOrderNumber]   = useState(1);
  const [loading, setLoading]           = useState(true);
  const [stats, setStats]               = useState<PosStats | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [successOrder, setSuccessOrder] = useState<{
    orderId: string; total: number; cart: CartItem[]; orderNumber: number;
    shopName: string; branchName: string; paymentMethod: string;
    vatEnabled: boolean; discount: number; receiptToken?: string;
    subtotal: number; totalDiscount: number; vatAmount: number; discountLabel: string;
    receivedAmount?: number; change?: number; earnedPoints?: number; newTotalPoints?: number; refCode?: string;
  } | null>(null);
  const [adminOpen, setAdminOpen]             = useState(false);
  const [userMenuOpen, setUserMenuOpen]       = useState(false);
  const [themeSubmenuOpen, setThemeSubmenuOpen] = useState(false);
  const [currentTheme, setCurrentTheme]       = useState<Theme>('warm');
  const [shopPopupOpen, setShopPopupOpen]     = useState(false);
  const [userRole, setUserRole]               = useState<string | null>(null);
  const [shopLogoUrl, setShopLogoUrl]         = useState<string | null>(null);
  const [vatEnabled, setVatEnabled]           = useState(false);
  const [promptpayNumber, setPromptpayNumber] = useState<string | null>(null);
  const [promptpayType,   setPromptpayType]   = useState<'phone' | 'id_card'>('phone');
  const [promptpayName,   setPromptpayName]   = useState<string | null>(null);
  const [activeNavTab, setActiveNavTab]               = useState<'customers' | 'promotions' | 'history' | null>(null);
  const [todayOrdersOpen, setTodayOrdersOpen]         = useState(false);
  const [todayOrders, setTodayOrders]                 = useState<TodayOrder[]>([]);
  const [todayOrdersLoading, setTodayOrdersLoading]   = useState(false);
  const [orderDetail, setOrderDetail]                 = useState<OrderDetail | null>(null);
  const [orderDetailSeq, setOrderDetailSeq]           = useState<number | null>(null);
  const [orderDetailLoading, setOrderDetailLoading]   = useState(false);
  const [customerDisplayOpen, setCustomerDisplayOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer]       = useState<CustomerInfo | null>(null);
  const [authToken, setAuthToken]                     = useState<string>('');
  const [stockMap, setStockMap] = useState<Record<string, { qty: number; minQty: number }>>({});
  const [pendingWithdrawals, setPendingWithdrawals] = useState<WithdrawalRequest[]>([]);
  const posWsRef = useRef<WebSocket | null>(null);

  /* ── Printer config ── */
  const [printerEnabled, setPrinterEnabled] = useState(false);
  const [printerWidth,   setPrinterWidth]   = useState<32 | 48>(48);
  const [printerMode,    setPrinterMode]    = useState<'bluetooth'|'usb'|'network'|'browser'>('browser');
  const [printerNetIP,   setPrinterNetIP]   = useState('');
  const [printerNetPort, setPrinterNetPort] = useState('9100');

  /* ── Bluetooth ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const btCharRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const btDeviceRef = useRef<any>(null);
  const [btConnected,  setBtConnected]  = useState(false);
  const [btConnecting, setBtConnecting] = useState(false);
  const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  /* ── USB ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usbRef = useRef<{ device: any; ep: number } | null>(null);
  const [usbConnected,  setUsbConnected]  = useState(false);
  const [usbConnecting, setUsbConnecting] = useState(false);
  const hasUsb = typeof navigator !== 'undefined' && 'usb' in navigator;

  /* ── Discount ── */
  const [discountType,  setDiscountType]  = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState('');

  /* ── Membership config ── */
  const [membershipBirthdayBenefitType,  setMembershipBirthdayBenefitType]  = useState<'percent' | 'fixed' | null>(null);
  const [membershipBirthdayBenefitValue, setMembershipBirthdayBenefitValue] = useState<number>(0);

  /* ── Fetch products ── */
  useEffect(() => {
    if (!shopId) return;
    async function fetchProducts() {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products?pos=true`);
      if (!res.ok) { setLoading(false); return; }
      const json = await res.json();
      setProducts(json.data ?? []);
      setLoading(false);
    }
    fetchProducts();
  }, [shopId]);

  /* ── ไอคอนธีมให้ตรงกับที่บันทึกราย user (HTML ตั้งโดย layout + supabase auth sync) ── */
  useEffect(() => {
    const r = getResolvedCurrentThemeForClient();
    if (THEMES.some((t) => t.id === r)) setCurrentTheme(r);
  }, []);

  /* ── Fetch branch stock ── */
  useEffect(() => {
    if (!shopId || !branchId) return;
    async function fetchStock() {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches/${branchId}/pos-stock`);
      if (!res.ok) return;
      const json = await res.json();
      const map: Record<string, { qty: number; minQty: number }> = {};
      for (const r of (json.data ?? []) as { product_id: string; quantity: number; min_qty: number }[]) {
        map[r.product_id] = { qty: r.quantity, minQty: r.min_qty ?? 0 };
      }
      setStockMap(map);
    }
    fetchStock();
  }, [shopId, branchId]);

  /* ── WebSocket: real-time stock + birthday alerts ── */
  useEffect(() => {
    if (!shopId) return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 2000; // exponential backoff: 2s → 4s → 8s → … max 30s
    let alive = true;
    async function connect() {
      if (!alive) return;
      const token = await getAuthToken();
      if (!token) return;
      const ws = new WebSocket(`${WS_URL}/ws?shopId=${shopId}&token=${encodeURIComponent(token)}`);
      posWsRef.current = ws;
      ws.onopen = () => { reconnectDelay = 2000; }; // reset delay on successful connect
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; payload?: Record<string, unknown> };
          if (msg.type === 'STOCK_UPDATE' && msg.payload?.product_id !== undefined) {
            const { branch_id, product_id, quantity, min_qty } = msg.payload as {
              branch_id?: string; product_id: string; quantity?: number; min_qty?: number;
            };
            if (!branchId || branch_id === branchId) {
              setStockMap(prev => ({
                ...prev,
                [product_id]: { qty: quantity ?? 0, minQty: min_qty ?? prev[product_id]?.minQty ?? 0 },
              }));
            }
          } else if (msg.type === 'MEMBER_REGISTERED') {
            const p = msg.payload ?? {};
            const existing = p.existing === true;
            const name = typeof p.name === 'string' ? p.name : 'สมาชิก';
            const phone = typeof p.phone === 'string' && p.phone ? p.phone : '';
            toast.success(existing ? 'ลูกค้าท่านนี้เป็นสมาชิกอยู่แล้ว' : 'สมัครสมาชิกใหม่สำเร็จ', {
              description: phone ? `${name} (${phone})` : name,
            });
          } else if (msg.type === 'BIRTHDAY_ALERT') {
            const p = msg.payload as { customer_name?: string; message?: string } | undefined;
            toast('🎂 วันเกิดสมาชิก', {
              description: p?.message ?? (p?.customer_name ? `${p.customer_name} มีวันเกิดใน 7 วันนี้` : ''),
              duration: 8000,
            });
          } else if (msg.type === 'WITHDRAWAL_REQUEST') {
            const p = msg.payload as unknown as WithdrawalRequest;
            setPendingWithdrawals(prev => {
              if (prev.some(r => r.id === p.id)) return prev;
              return [...prev, p];
            });
          } else if (msg.type === 'WITHDRAWAL_APPROVED' || msg.type === 'WITHDRAWAL_REJECTED') {
            const p = msg.payload as { id: string };
            setPendingWithdrawals(prev => prev.filter(r => r.id !== p.id));
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (!alive) return;
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000); // cap at 30 s
          connect();
        }, reconnectDelay);
      };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      posWsRef.current?.close();
    };
  }, [shopId, branchId]);

  /* ── Barcode scanner ── */
  useEffect(() => {
    let buf = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Enter') {
        if (buf.length >= 3) {
          const found = products.find(p => p.barcode && p.barcode === buf);
          if (found) addToCart(found);
        }
        buf = '';
        if (timer) { clearTimeout(timer); timer = null; }
      } else if (e.key.length === 1) {
        buf += e.key;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { buf = ''; timer = null; }, 200);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (timer) clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  /* ── ตรวจสอบ ban/suspend ตอนโหลด POS ── */
  useEffect(() => {
    if (!shopId) return;
    getAuthToken().then(async (token) => {
      if (!token) return;
      const res = await fetch(`${API_URL}/api/v1/me/pos-assignment`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        const json = await res.json() as { error?: { code?: string; ban_reason?: string | null } };
        const code      = json.error?.code ?? '';
        const banReason = json.error?.ban_reason ?? null;
        if (code === 'SHOP_BANNED' || code === 'SHOP_SUSPENDED') {
          const params = new URLSearchParams({ type: code === 'SHOP_BANNED' ? 'banned' : 'suspended' });
          if (banReason) params.set('reason', banReason);
          window.location.href = `/banned?${params}`;
        }
      }
    });
  }, [shopId]);

  /* ── Fetch user role ── */
  useEffect(() => {
    if (!shopId) return;
    fetchWithAuth(`${API_URL}/api/v1/me/shops`).then(async (res) => {
      if (!res.ok) return;
      const json = await res.json();
      const myShop = ((json.data ?? []) as Array<{ id: string; role?: string }>).find((s) => s.id === shopId);
      setUserRole(myShop?.role ?? null);
    });
  }, [shopId]);

  /* ── Fetch stats ── */
  const fetchStats = useCallback(async () => {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stats`);
    if (!res.ok) return;
    const json = await res.json();
    const d = json.data;
    if (d) {
      const dailyTotal = Number(d.daily?.total  ?? 0) || 0;
      const orderCount = Number(d.daily?.orderCount ?? 0) || 0;
      const topName    = d.topProducts?.[0]?.name;
      setStats({ dailyTotal, orderCount, avgOrder: orderCount > 0 ? Math.round(dailyTotal / orderCount) : 0, topProduct: typeof topName === 'string' ? topName : '—' });
      const nextFromDb = orderCount + 1;
      setOrderNumber(prev => { if (nextFromDb > prev) { if (shopId) saveSeq(shopId, nextFromDb); return nextFromDb; } return prev; });
    }
  }, [shopId]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const fetchTodayOrders = useCallback(async () => {
    if (!shopId || !branchId) return;
    setTodayOrdersLoading(true);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders/today?branchId=${branchId}`);
    if (!res.ok) { setTodayOrdersLoading(false); return; }
    const json = await res.json();
    setTodayOrders(json.data ?? []);
    setTodayOrdersLoading(false);
  }, [shopId, branchId]);

  /** หลัง 00:15 น. ไทย: รีเฟรชรายการออเดอร์+ยอด (สลับ useEffect อ้างอิงผ่าน ref) */
  const onPosNewBusinessDayRef = useRef<() => void>(() => {});
  useEffect(() => {
    onPosNewBusinessDayRef.current = () => {
      setTodayOrders([]);
      void fetchStats();
      void fetchTodayOrders();
    };
  }, [fetchStats, fetchTodayOrders]);

  /* ── Cache auth token ── */
  useEffect(() => { getAuthToken().then((token) => { if (token) setAuthToken(token); }); }, []);

  /* ── Save last POS branch to localStorage for backToPOS navigation ── */
  useEffect(() => {
    if (shopId && branchId) {
      localStorage.setItem('pos_last', JSON.stringify({ shopId, shopName, branchId, branchName }));
    }
  }, [shopId, branchId, shopName, branchName]);

  /* ── Register display broadcast ── */
  const handleRegisterDisplay = useCallback(async () => {
    if (!shopId) return;
    try {
      const token = await getAuthToken();
      if (!token) return;
      await fetch(`${API_DIRECT}/api/v1/shops/${shopId}/display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'REGISTER_QR', payload: {} }),
      });
    } catch (err) {
      console.warn('[registerDisplay]', err);
    }
  }, [shopId]);

  /* ── Fetch shop settings ── */
  useEffect(() => {
    if (!shopId) return;
    fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/pos-config`).then(async (res) => {
      if (!res.ok) return;
      const json = await res.json();
      setShopLogoUrl(json.data?.logo_url ?? null);
      setVatEnabled(json.data?.vat_enabled === true);
      setPrinterEnabled(json.data?.print_receipt_enabled === true);
      setPrinterWidth(json.data?.printer_width === 32 ? 32 : 48);
      const mc = json.data?.membership_config;
      if (mc && (mc.birthday_benefit_type === 'percent' || mc.birthday_benefit_type === 'fixed') && typeof mc.birthday_benefit_value === 'number' && mc.birthday_benefit_value > 0) {
        setMembershipBirthdayBenefitType(mc.birthday_benefit_type);
        setMembershipBirthdayBenefitValue(mc.birthday_benefit_value);
      } else {
        setMembershipBirthdayBenefitType(null);
        setMembershipBirthdayBenefitValue(0);
      }
      try {
        setPrinterMode((localStorage.getItem(`pos_printer_mode_${shopId}`) as typeof printerMode) ?? 'browser');
        setPrinterNetIP(localStorage.getItem(`pos_printer_net_ip_${shopId}`) ?? '');
        setPrinterNetPort(localStorage.getItem(`pos_printer_net_port_${shopId}`) ?? '9100');
      } catch { /* ignore */ }
    });
  }, [shopId]);

  /* ── Fetch payment config ── */
  useEffect(() => {
    if (!shopId) return;
    fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/payment`).then(async (res) => {
      if (!res.ok) return;
      const json = await res.json();
      const d = json.data;
      setPromptpayNumber(d?.promptpay_number ?? null);
      setPromptpayType(d?.promptpay_type === 'id_card' ? 'id_card' : 'phone');
      const first = (d?.owner_firstname ?? '').trim();
      const last  = (d?.owner_lastname  ?? '').trim();
      setPromptpayName([first, last].filter(Boolean).join(' ') || null);
    });
  }, [shopId]);

  /* ── Order sequence: load from localStorage ── */
  useEffect(() => { if (shopId) setOrderNumber(loadSeq(shopId)); }, [shopId]);

  /* ── Daily reset timer (00:15 Asia/Bangkok) — เลขลำดับ + รีเฟรชออเดอร์วันนี้/ยอดวันนี้ */
  useEffect(() => {
    if (!shopId) return;
    function checkAndReset() {
      setOrderNumber(loadSeq(shopId!));
      onPosNewBusinessDayRef.current();
    }
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      timer = setTimeout(() => {
        const seq = resetSeq(shopId!);
        setOrderNumber(seq);
        onPosNewBusinessDayRef.current();
        schedule();
      }, msUntilDailyReset());
    }
    schedule();
    window.addEventListener('online', checkAndReset);
    return () => { clearTimeout(timer); window.removeEventListener('online', checkAndReset); };
  }, [shopId]);

  /* ── Derived state ── */
  const total        = useMemo(() => cart.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0), [cart]);
  const itemCount    = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);
  const discountAmount = useMemo(() => {
    const val = parseFloat(discountInput) || 0;
    if (discountType === 'percent') return Math.min(Math.round(total * val / 100), total);
    return Math.min(val, total);
  }, [discountInput, discountType, total]);

  function addToCart(product: Product) {
    const stock = stockMap[product.id];
    const trackedQty = stock?.qty;
    if (trackedQty !== undefined && trackedQty <= 0) return;
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.filter(i => i.product.id !== product.id);
      const maxQty = trackedQty ?? Infinity;
      return [...prev, { product, quantity: Math.min(1, maxQty) }];
    });
  }

  function changeQty(productId: string, delta: number) {
    const maxQty = stockMap[productId]?.qty ?? Infinity;
    setCart(prev =>
      prev.map(i => {
        if (i.product.id !== productId) return i;
        const next = i.quantity + delta;
        const clamped = delta > 0 ? Math.min(next, maxQty) : next;
        return { ...i, quantity: clamped };
      }).filter(i => i.quantity > 0)
    );
  }

  function changeNote(productId: string, note: string) {
    setCart(prev => prev.map(i => i.product.id === productId ? { ...i, note } : i));
  }

  function clearCart() { setCart([]); setDiscountInput(''); setDiscountType('amount'); setSelectedCustomer(null); }

  async function fetchOrderDetail(orderId: string, seqNum?: number) {
    if (!shopId) return;
    setOrderDetailLoading(true);
    setOrderDetailSeq(seqNum ?? null);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders/${orderId}`);
    if (res.ok) { const json = await res.json(); setOrderDetail(json.data ?? null); }
    setOrderDetailLoading(false);
  }

  async function voidOrder(orderId: string) {
    if (!shopId) return;
    const res = await fetchWithAuth(
      `${API_URL}/api/v1/shops/${shopId}/orders/${orderId}/status`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'void' }) },
    );
    if (res.ok) {
      await fetchOrderDetail(orderId, orderDetailSeq ?? undefined);
      await fetchTodayOrders();
    } else {
      const json = await res.json().catch(() => ({})) as { error?: { message?: string } };
      toast.error(json?.error?.message ?? 'ยกเลิกออเดอร์ไม่สำเร็จ');
    }
  }

  /* ── ESC/POS printer functions ── */
  function buildEscPos(order: { total: number; cart: CartItem[]; orderNumber: number; shopName: string; vatEnabled: boolean; discount: number }): Uint8Array {
    const ESC = 0x1B; const GS = 0x1D; const LF = 0x0A;
    const enc = new TextEncoder();
    const b: number[] = [];
    const cols = printerWidth === 32 ? 32 : 48;
    const push = (...n: number[]) => b.push(...n);
    const line = (s: string) => { b.push(...enc.encode(s)); push(LF); };
    const rpad = (left: string, right: string) => `${left}${' '.repeat(Math.max(1, cols - left.length - right.length))}${right}`;
    push(ESC, 0x40); push(ESC, 0x61, 0x01); push(ESC, 0x45, 0x01); push(GS, 0x21, 0x11);
    line(order.shopName);
    push(GS, 0x21, 0x00); push(ESC, 0x45, 0x00);
    line(`#${String(order.orderNumber).padStart(4, '0')}`);
    line(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }));
    push(LF); push(ESC, 0x61, 0x00); line('-'.repeat(cols));
    for (const item of order.cart) {
      const name = item.product.name.slice(0, cols - 12);
      line(rpad(`${name} x${item.quantity}`, (Number(item.product.price) * item.quantity).toFixed(2)));
      if (item.note?.trim()) line(`  * ${item.note.trim().slice(0, cols - 4)}`);
    }
    line('-'.repeat(cols));
    if (order.discount > 0) line(rpad('ส่วนลด', `-${order.discount.toFixed(2)}`));
    if (order.vatEnabled) line(rpad('VAT 7%', (order.total / 1.07 * 0.07).toFixed(2)));
    push(ESC, 0x45, 0x01); push(GS, 0x21, 0x11);
    line(rpad('รวม', `${order.total.toFixed(2)} B`));
    push(GS, 0x21, 0x00); push(ESC, 0x45, 0x00);
    push(LF); push(ESC, 0x61, 0x01); line('ขอบคุณที่ใช้บริการ');
    push(LF, LF, LF); push(GS, 0x56, 0x41, 0x03);
    return new Uint8Array(b);
  }

  const BT_PROFILES = [
    { s: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', c: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
    { s: '000018f0-0000-1000-8000-00805f9b34fb', c: '00002af1-0000-1000-8000-00805f9b34fb' },
    { s: '49535343-fe7d-4ae5-8fa9-9fafd205e455', c: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
    { s: '0000ff00-0000-1000-8000-00805f9b34fb', c: '0000ff02-0000-1000-8000-00805f9b34fb' },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function connectBtDevice(device: any, silent = false): Promise<boolean> {
    try {
      const server = await device.gatt.connect();
      let char = null;
      for (const p of BT_PROFILES) { try { const svc = await server.getPrimaryService(p.s); char = await svc.getCharacteristic(p.c); break; } catch { continue; } }
      if (!char) { if (!silent) toast.error('ไม่พบ service เครื่องปริ๊น'); return false; }
      btCharRef.current  = char;
      btDeviceRef.current = device;
      setBtConnected(true);
      localStorage.setItem('pos_bt_printer_name', device.name ?? '');
      // Auto-reconnect on hardware disconnect
      device.addEventListener('gattserverdisconnected', () => {
        setBtConnected(false);
        btCharRef.current = null;
        // Retry silently after 2 s
        setTimeout(() => { void connectBtDevice(device, true); }, 2000);
      });
      return true;
    } catch {
      return false;
    }
  }

  async function connectBluetooth() {
    if (!hasBluetooth) { toast.error('ต้องใช้ Chrome/Edge บน Android หรือ Windows เพื่อเชื่อมต่อ Bluetooth — iOS ไม่รองรับ Web Bluetooth'); return; }
    setBtConnecting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bt = (navigator as any).bluetooth;
      const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BT_PROFILES.map(p => p.s) });
      const ok = await connectBtDevice(device);
      if (!ok) toast.error('เชื่อมต่อไม่สำเร็จ: ไม่พบ service เครื่องปริ๊น');
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name !== 'NotFoundError' && e.name !== 'NotAllowedError') toast.error('เชื่อมต่อไม่สำเร็จ: ' + e.message);
    } finally { setBtConnecting(false); }
  }

  // Auto-reconnect on mount: find previously paired printer via getDevices() (Chrome 85+)
  useEffect(() => {
    if (!hasBluetooth || !printerEnabled || printerMode !== 'bluetooth') return;
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const devices: any[] = await (navigator as any).bluetooth?.getDevices?.() ?? [];
        if (!devices.length) return;
        const savedName = localStorage.getItem('pos_bt_printer_name');
        const device = savedName
          ? (devices.find((d) => d.name === savedName) ?? devices[0])
          : devices[0];
        if (device) await connectBtDevice(device, true);
      } catch { /* getDevices() not available or no permission */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerEnabled, printerMode]);

  async function printBluetooth(data: Uint8Array): Promise<boolean> {
    const char = btCharRef.current;
    if (!char) return false;
    try {
      const CHUNK = 512;
      for (let i = 0; i < data.length; i += CHUNK) { await char.writeValue(data.slice(i, i + CHUNK)); await new Promise(r => setTimeout(r, 30)); }
      return true;
    } catch { setBtConnected(false); btCharRef.current = null; return false; }
  }

  async function connectUsb() {
    if (!hasUsb) { toast.error('ต้องใช้ Chrome/Edge บน Android หรือ Windows เพื่อใช้ WebUSB'); return; }
    setUsbConnecting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const device: any = await (navigator as any).usb.requestDevice({ filters: [{ classCode: 7 }] });
      await device.open();
      if (device.configuration === null) await device.selectConfiguration(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iface = device.configuration?.interfaces.find((i: any) => i.alternates[0]?.interfaceClass === 7);
      if (!iface) throw new Error('ไม่พบ USB Printer interface');
      await device.claimInterface(iface.interfaceNumber);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outEp = iface.alternates[0]?.endpoints.find((e: any) => e.direction === 'out');
      if (!outEp) throw new Error('ไม่พบ USB OUT endpoint');
      usbRef.current = { device, ep: outEp.endpointNumber };
      setUsbConnected(true);
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name !== 'NotFoundError' && e.name !== 'NotAllowedError') toast.error('เชื่อมต่อ USB ไม่สำเร็จ: ' + e.message);
    } finally { setUsbConnecting(false); }
  }

  async function printUsb(data: Uint8Array): Promise<boolean> {
    const usb = usbRef.current;
    if (!usb) return false;
    try { const CHUNK = 16_384; for (let i = 0; i < data.length; i += CHUNK) await usb.device.transferOut(usb.ep, data.slice(i, i + CHUNK)); return true; }
    catch { setUsbConnected(false); usbRef.current = null; return false; }
  }

  async function printNetwork(data: Uint8Array): Promise<boolean> {
    if (!printerNetIP) return false;
    return new Promise((resolve) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${printerNetIP}:${printerNetPort || 9100}`);
      ws.binaryType = 'arraybuffer';
      const t = setTimeout(() => { ws.close(); resolve(false); }, 8000);
      ws.onopen = () => { clearTimeout(t); ws.send(data); setTimeout(() => { ws.close(); resolve(true); }, 600); };
      ws.onerror = () => { clearTimeout(t); resolve(false); };
    });
  }

  async function triggerPrint(order: { orderId: string; total: number; cart: CartItem[]; orderNumber: number; shopName: string; vatEnabled: boolean; discount: number }, force = false) {
    if (!printerEnabled) return;
    if (printerMode === 'bluetooth' && btConnected && await printBluetooth(buildEscPos(order))) return;
    if (printerMode === 'usb'       && usbConnected && await printUsb(buildEscPos(order))) return;
    if (printerMode === 'network'   && printerNetIP && await printNetwork(buildEscPos(order))) return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    if (!isMobile && !force) return;
    const pageWidth = printerWidth === 32 ? '240px' : '300px';
    const maxName   = printerWidth === 32 ? 18 : 26;
    const vatAmt    = order.vatEnabled ? order.total / 1.07 * 0.07 : 0;
    const subtotal  = order.total - vatAmt;
    const rows = order.cart.map((i) => {
      const name  = i.product.name.slice(0, maxName);
      const price = (Number(i.product.price) * i.quantity).toFixed(2);
      const noteHtml = i.note?.trim() ? `<div class="note">* ${i.note.trim()}</div>` : '';
      return `<div class="row"><span>${name} x${i.quantity}</span><span>${price}</span></div>${noteHtml}`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{margin:0;size:${pageWidth} auto;}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',monospace;font-size:11px;width:${pageWidth};padding:6px 4px;}.c{text-align:center;}.bold{font-weight:bold;}.big{font-size:14px;font-weight:bold;}.line{border-top:1px dashed #000;margin:4px 0;}.row{display:flex;justify-content:space-between;}.note{font-size:10px;padding-left:4px;color:#555;}</style></head><body><div class="c bold">${order.shopName}</div><div class="c">#${String(order.orderNumber).padStart(4,'0')}</div><div class="c">${new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'})}</div><div class="line"></div>${rows}<div class="line"></div>${order.discount>0?`<div class="row"><span>ส่วนลด</span><span>-${order.discount.toFixed(2)}</span></div>`:''}${order.vatEnabled?`<div class="row"><span>ก่อน VAT</span><span>${subtotal.toFixed(2)}</span></div><div class="row"><span>VAT 7%</span><span>${vatAmt.toFixed(2)}</span></div>`:''}<div class="row big"><span>รวม</span><span>${order.total.toFixed(2)} ฿</span></div><div class="line"></div><div class="c">ขอบคุณที่ใช้บริการ</div></body></html>`;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:400px;height:600px;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try { iframe.contentWindow?.print(); } catch { /* ignore */ }
      const remove = () => { try { document.body.removeChild(iframe); } catch { /* ignore */ } };
      iframe.contentWindow?.addEventListener?.('afterprint', remove);
      setTimeout(remove, 30_000);
    };
    iframe.srcdoc = html;
  }

  function connectPrinter() {
    if (printerMode === 'bluetooth') connectBluetooth();
    else if (printerMode === 'usb') connectUsb();
  }
  const printerConnected =
    (printerMode === 'bluetooth' && btConnected) ||
    (printerMode === 'usb'       && usbConnected) ||
    (printerMode === 'network'   && !!printerNetIP) ||
    (printerMode === 'browser');
  const printerConnecting = (printerMode === 'bluetooth' && btConnecting) || (printerMode === 'usb' && usbConnecting);

  const backHref = `/select-branch?shopId=${shopId}&shopName=${encodeURIComponent(shopName)}`;

  if (!shopId || !branchId) {
    return (
      <main className="pos-invalid">
        <p className="pos-invalid__text">{t.noShop}</p>
        <Link href="/select-shop" className="pos-invalid__link">{t.backToShop}</Link>
      </main>
    );
  }

  return (
    <div className="pos-wrap">

      {/* Top Nav */}
      <header className="pos-topnav">
        <div className="pos-topnav__left">
          <div className="pos-topnav__logo">
            {/* Logo trigger — tappable on mobile to open shop popup */}
            <button
              type="button"
              className="pos-topnav__logo-trigger"
              onClick={() => setShopPopupOpen((v) => !v)}
              aria-label={shopName}
            >
              {shopLogoUrl ? (
                <Image src={shopLogoUrl} alt={shopName} width={36} height={36} className="pos-topnav__logo-img" />
              ) : (
                <span className="pos-topnav__logo-box">{shopName.trim().slice(0, 2).toUpperCase() || 'NX'}</span>
              )}
            </button>
            <span className="pos-topnav__logo-brand">{shopName}</span>

            {/* Mobile shop popup (hidden on tablet/desktop via CSS) */}
            {shopPopupOpen && (
              <>
                <div className="pos-shop-popup__backdrop" onClick={() => setShopPopupOpen(false)} />
                <div className="pos-shop-popup">
                  <div className="pos-shop-popup__header">
                    <span className="pos-shop-popup__name">{shopName}</span>
                    <button
                      type="button"
                      className="pos-shop-popup__close"
                      onClick={() => setShopPopupOpen(false)}
                      aria-label="ปิด"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="pos-shop-popup__tabs">
                    {NAV_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`pos-shop-popup__tab${activeNavTab === tab.id ? ' pos-shop-popup__tab--active' : ''}`}
                        onClick={() => {
                          setShopPopupOpen(false);
                          if (tab.id === 'history') {
                            const opening = activeNavTab !== 'history';
                            setActiveNavTab(opening ? 'history' : null);
                            setTodayOrdersOpen(opening);
                            if (opening) fetchTodayOrders();
                          } else {
                            setActiveNavTab((prev) => prev === tab.id ? null : tab.id as typeof prev);
                          }
                        }}
                      >
                        <span className="pos-shop-popup__tab-icon">{tab.icon}</span>
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <nav className="pos-topnav__tabs">
            {NAV_TABS.map(tab => (
              <button
                key={tab.id}
                className={`pos-topnav__tab${activeNavTab === tab.id ? ' pos-topnav__tab--active' : ''}`}
                onClick={() => {
                  if (tab.id === 'history') {
                    const opening = activeNavTab !== 'history';
                    setActiveNavTab(opening ? 'history' : null);
                    setTodayOrdersOpen(opening);
                    if (opening) fetchTodayOrders();
                  } else {
                    setActiveNavTab(prev => prev === tab.id ? null : tab.id as typeof prev);
                  }
                }}
              >
                <span className="pos-topnav__tab-icon">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="pos-topnav__right">
          {printerEnabled && printerMode !== 'browser' && (printerMode !== 'bluetooth' || hasBluetooth) && (
            <button
              className={`pos-bt-btn${printerConnected ? ' pos-bt-btn--on' : ''}`}
              onClick={connectPrinter}
              disabled={printerConnecting}
              title={printerConnected ? `✅ เชื่อมต่อแล้ว` : `🔌 เชื่อมต่อเครื่องปริ๊น (${printerMode})`}
            >
              {printerConnecting ? '⏳' : printerConnected ? '✅' : printerMode === 'network' ? '🌐' : printerMode === 'usb' ? '🔌' : '📶'}
              <span className="pos-bt-btn__dot" />
            </button>
          )}
          <div className="pos-stat-pill pos-stat-pill--sales">
            💰 ฿{(stats?.dailyTotal ?? 0).toLocaleString('th-TH')}
          </div>
          <div className="pos-orders-pill-wrap">
            <button
              className={`pos-stat-pill pos-stat-pill--orders${todayOrdersOpen ? ' pos-stat-pill--active' : ''}`}
              onClick={() => {
                const opening = !todayOrdersOpen;
                setTodayOrdersOpen(opening);
                setActiveNavTab(opening ? 'history' : null);
                if (opening) fetchTodayOrders();
              }}
            >
              🧾 {orderNumber - 1} {t.orders} {todayOrdersOpen ? '▲' : '▼'}
            </button>
            {todayOrdersOpen && (
              <TodayOrdersPanel
                orders={todayOrders}
                loading={todayOrdersLoading}
                totalCount={orderNumber - 1}
                shopId={shopId ?? ''}
                onClose={() => { setTodayOrdersOpen(false); setActiveNavTab(null); }}
                onSelectOrder={(id, seq) => fetchOrderDetail(id, seq)}
              />
            )}
          </div>
          <div className="pos-avatar-wrap">
            <button className="pos-avatar-btn" onClick={() => setUserMenuOpen(v => !v)}>A</button>
            {userMenuOpen && (
              <>
                <div className="pos-user-overlay" onClick={() => { setUserMenuOpen(false); setThemeSubmenuOpen(false); }} />
                <div className="pos-user-menu">
                  {(userRole === 'owner' || userRole === 'manager') && (
                    <button className="pos-user-menu__item" onClick={() => { setUserMenuOpen(false); setThemeSubmenuOpen(false); setAdminOpen(true); }}>
                      🔐 {t.admin.menuLabel}
                    </button>
                  )}
                  <Link href={`/refund?shopId=${shopId}&branchId=${branchId}`} className="pos-user-menu__item" onClick={() => { setUserMenuOpen(false); setThemeSubmenuOpen(false); }}>
                    💰 คืนเงิน
                  </Link>

                  {/* Theme picker */}
                  <button
                    className="pos-user-menu__item pos-user-menu__item--theme"
                    onClick={() => setThemeSubmenuOpen((v) => !v)}
                  >
                    <span>{THEMES.find((t) => t.id === currentTheme)?.icon ?? '🎨'}</span>
                    <span className="pos-user-menu__item-theme-label">ธีม</span>
                    <svg
                      className={`pos-user-menu__item-theme-chevron${themeSubmenuOpen ? ' pos-user-menu__item-theme-chevron--open' : ''}`}
                      width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {themeSubmenuOpen && (
                    <div className="pos-user-menu__theme-sub">
                      {THEMES.map((th) => (
                        <button
                          key={th.id}
                          className={`pos-user-menu__theme-opt${currentTheme === th.id ? ' pos-user-menu__theme-opt--active' : ''}`}
                          onClick={() => { setCurrentTheme(th.id); posApplyTheme(th.id); setThemeSubmenuOpen(false); setUserMenuOpen(false); }}
                        >
                          <span>{th.icon}</span>
                          <span>{th.label}</span>
                          {currentTheme === th.id && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <Link href={backHref} className="pos-user-menu__item" onClick={() => { setUserMenuOpen(false); setThemeSubmenuOpen(false); }}>{t.back}</Link>
                  <button
                    className="pos-user-menu__item pos-user-menu__item--danger"
                    onClick={async () => { const sb = createSupabaseClient(); await sb.auth.signOut(); window.location.href = '/login'; }}
                  >
                    🚪 {t.logout}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Customer / Promotions panels — portal to body */}
      {activeNavTab === 'customers' && shopId && authToken && createPortal(
        <div className="pos-customers-overlay" onClick={() => setActiveNavTab(null)}>
          <div className="pos-customers-panel-wrap" onClick={(e) => e.stopPropagation()}>
            <CustomersPanel shopId={shopId} token={authToken} selectedCustomer={selectedCustomer} onSelect={(c) => { setSelectedCustomer(c); }} cartTotal={total} onClose={() => setActiveNavTab(null)} />
          </div>
        </div>,
        document.body,
      )}
      {activeNavTab === 'promotions' && shopId && authToken && createPortal(
        <div className="pos-customers-overlay" onClick={() => setActiveNavTab(null)}>
          <div className="pos-promo-wrap" onClick={(e) => e.stopPropagation()}>
            <PromotionsPanel
              shopId={shopId}
              token={authToken}
              products={products}
              onApplyDiscount={(type, value) => {
                setActiveNavTab(null);
                if (type === 'percent') { setDiscountType('percent'); setDiscountInput(String(value)); }
                else { setDiscountType('amount'); setDiscountInput(String(value)); }
              }}
              onApplyCombo={(items, comboPrice) => {
                setActiveNavTab(null);
                let itemsTotal = 0;
                items.forEach((it) => {
                  const p = products.find(pr => pr.id === it.product_id);
                  if (p) {
                    itemsTotal += parseFloat(p.price) * it.quantity;
                    for (let i = 0; i < it.quantity; i += 1) addToCart(p);
                  }
                });
                const comboDiscount = Math.max(0, Math.round((itemsTotal - comboPrice) * 100) / 100);
                if (comboDiscount > 0) { setDiscountType('amount'); setDiscountInput(String(comboDiscount)); }
              }}
              onClose={() => setActiveNavTab(null)}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* Body */}
      <div className="pos-body">
        <section className="pos-products">
          {/* Low-stock alert banner */}
          {!loading && (() => {
            const lowItems = products.filter(p => {
              const s = stockMap[p.id];
              if (!s) return false;
              const { qty, minQty } = s;
              if (qty <= 0) return false;
              return minQty > 0 ? qty <= minQty : qty <= 3;
            });
            if (lowItems.length === 0) return null;
            return (
              <div className="pos-low-stock-banner" role="alert">
                <span className="pos-low-stock-banner__icon">⚠</span>
                <span className="pos-low-stock-banner__title">สินค้าใกล้หมด</span>
                <div className="pos-low-stock-banner__list">
                  {lowItems.map(p => {
                    const s = stockMap[p.id]!;
                    return (
                      <span key={p.id} className="pos-low-stock-banner__item">
                        {p.name}<span className="pos-low-stock-banner__qty">{s.qty} {p.unit ?? 'ชิ้น'}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {loading ? (
            <div className="pos-grid">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : products.length === 0 ? (
            <p className="pos-empty">{t.noMenu}</p>
          ) : (
            <div className="pos-grid">
              {products.map(p => {
                const inCart     = cart.find(i => i.product.id === p.id);
                const stock      = stockMap[p.id];
                const trackedQty = stock?.qty;
                const minQty     = stock?.minQty ?? 0;
                const isOutOfStock = trackedQty !== undefined && trackedQty <= 0;
                const isLowStock   = !isOutOfStock && trackedQty !== undefined && (minQty > 0 ? trackedQty <= minQty : trackedQty <= 3);
                return (
                  <PosProductCard
                    key={p.id}
                    product={p}
                    inCartQty={inCart && !isOutOfStock ? inCart.quantity : 0}
                    isOutOfStock={isOutOfStock}
                    isLowStock={isLowStock}
                    trackedQty={trackedQty}
                    onAdd={() => addToCart(p)}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* Cart sidebar — desktop */}
        <aside className="pos-cart-sidebar">
          <CartPanel
            cart={cart} total={total} vatEnabled={vatEnabled} orderNumber={orderNumber}
            discountType={discountType} discountInput={discountInput} discountAmount={discountAmount}
            onDiscountTypeChange={setDiscountType} onDiscountInputChange={setDiscountInput}
            onChangeQty={changeQty} onNoteChange={changeNote} onClear={clearCart}
            onCheckout={() => setCheckoutOpen(true)}
            onCustomerDisplay={() => setCustomerDisplayOpen(true)}
            onRegisterDisplay={handleRegisterDisplay}
            shopId={shopId} branchId={branchId}
            getMaxQty={(id) => stockMap[id]?.qty ?? Infinity}
          />
        </aside>
      </div>

      {/* Mobile FAB */}
      {itemCount > 0 && (
        <button className="pos-fab" onClick={() => setDrawerOpen(true)}>
          <span>🛒 {itemCount} รายการ</span>
          <span className="pos-fab__total">฿{total.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
          <span className="pos-fab__arrow">›</span>
        </button>
      )}

      {/* Mobile cart drawer */}
      {drawerOpen && (
        <div className="pos-drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="pos-drawer" onClick={e => e.stopPropagation()}>
            <CartPanel
              cart={cart} total={total} vatEnabled={vatEnabled} orderNumber={orderNumber}
              discountType={discountType} discountInput={discountInput} discountAmount={discountAmount}
              onDiscountTypeChange={setDiscountType} onDiscountInputChange={setDiscountInput}
              onChangeQty={changeQty} onNoteChange={changeNote} onClear={clearCart}
              onCheckout={() => { setDrawerOpen(false); setCheckoutOpen(true); }}
              onClose={() => setDrawerOpen(false)}
              onRegisterDisplay={handleRegisterDisplay}
              getMaxQty={(id) => stockMap[id]?.qty ?? Infinity}
            />
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {checkoutOpen && (
        <CheckoutModal
          shopId={shopId} branchId={branchId} cart={cart} total={total}
          vatEnabled={vatEnabled} shopLogoUrl={shopLogoUrl} orderNumber={orderNumber}
          shopName={shopName} promptpayNumber={promptpayNumber} promptpayType={promptpayType} promptpayName={promptpayName}
          discount={discountAmount} customer={selectedCustomer}
          posWsRef={posWsRef}
          birthdayBenefitType={membershipBirthdayBenefitType}
          birthdayBenefitValue={membershipBirthdayBenefitValue}
          onSelectCustomer={setSelectedCustomer}
          onClose={() => setCheckoutOpen(false)}
          onSuccess={(orderId, paidTotal, payMethod, apiDailySeq, receiptToken, extras) => {
            const confirmedSeq = apiDailySeq ?? orderNumber;
            if (shopId) saveSeq(shopId, confirmedSeq + 1);
            setOrderNumber(confirmedSeq + 1);
            const discountLabel = discountType === 'percent' && discountInput ? `ส่วนลด ${discountInput}%` : 'ส่วนลด';
            const orderData = {
              orderId, total: paidTotal, cart: [...cart], orderNumber: confirmedSeq,
              shopName, branchName, paymentMethod: payMethod, vatEnabled, discount: discountAmount, receiptToken,
              subtotal: extras?.subtotal ?? total, totalDiscount: extras?.totalDiscount ?? discountAmount,
              vatAmount: extras?.vatAmount ?? 0, discountLabel,
              receivedAmount: extras?.receivedAmount, change: extras?.change,
              earnedPoints: extras?.earnedPoints, newTotalPoints: extras?.newTotalPoints, refCode: extras?.refCode,
            };
            setSuccessOrder(orderData);
            triggerPrint(orderData);
            clearCart();
            setCheckoutOpen(false);
            setSelectedCustomer(null);
            fetchStats();
            setTodayOrdersOpen(prev => { if (prev) fetchTodayOrders(); return prev; });
          }}
        />
      )}

      {/* Success modal */}
      {successOrder && (
        <SuccessModal
          total={successOrder.total} orderNumber={successOrder.orderNumber}
          paymentMethod={successOrder.paymentMethod}
          printerEnabled={printerEnabled}
          subtotal={successOrder.subtotal} totalDiscount={successOrder.totalDiscount}
          vatAmount={successOrder.vatAmount} vatEnabled={successOrder.vatEnabled}
          discountLabel={successOrder.discountLabel}
          receivedAmount={successOrder.receivedAmount} change={successOrder.change}
          earnedPoints={successOrder.earnedPoints} newTotalPoints={successOrder.newTotalPoints}
          refCode={successOrder.refCode}
          receiptToken={successOrder.receiptToken}
          onPrint={() => triggerPrint(successOrder, true)}
          onClose={() => setSuccessOrder(null)}
        />
      )}

      {/* Admin login modal */}
      {adminOpen && <AdminLoginModal onClose={() => setAdminOpen(false)} />}

      {/* Withdrawal Approval modal */}
      {pendingWithdrawals.length > 0 && shopId && (
        <WithdrawalApprovalModal
          requests={pendingWithdrawals}
          shopId={shopId}
          apiUrl={API_URL}
          onUpdate={(id, _action) => setPendingWithdrawals(prev => prev.filter(r => r.id !== id))}
        />
      )}

      {/* Customer Display link modal */}
      {customerDisplayOpen && (
        <CustomerDisplayLinkModal shopId={shopId} branchId={branchId} onClose={() => setCustomerDisplayOpen(false)} />
      )}

      {/* Order Detail modal */}
      {(orderDetail || orderDetailLoading) && (
        <OrderDetailModal
          detail={orderDetail} loading={orderDetailLoading} seqNum={orderDetailSeq}
          shopName={shopName}
          onClose={() => { setOrderDetail(null); setOrderDetailSeq(null); }}
        />
      )}
    </div>
  );
}

function POSPageSkeleton() {
  return (
    <div className="pos-wrap">
      <div className="pos-topnav" />
      <div className="pos-body">
        <section className="pos-products">
          <div className="pos-grid">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        </section>
        <aside className="pos-cart-sidebar"><Skeleton className="h-full w-full" /></aside>
      </div>
    </div>
  );
}

export default function POSPage() {
  return (
    <Suspense fallback={<POSPageSkeleton />}>
      <POSContent />
    </Suspense>
  );
}
