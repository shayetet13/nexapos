'use client';

import { useEffect, useRef, useReducer, useCallback, Suspense, useMemo, useTransition } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseClient, fetchWithAuth, getAuthToken } from '@/lib/supabase';
import { AuthHeader } from '@/components/layout/AuthHeader';
import { GoToPOSLink } from '@/components/GoToPOSLink';
import { Skeleton } from '@/components/ui/Skeleton';
import { PROVINCES, BKK_DISTRICTS, IS_BANGKOK } from '@/lib/thai-provinces';
import { API_URL, WS_URL } from '@/lib/config';

import { ProductsTab } from '@/components/admin/ProductsTab';
import { StockTab } from '@/components/admin/StockTab';
import { OrdersTab } from '@/components/admin/OrdersTab';
import { UsersTab } from '@/components/admin/UsersTab';
import { MembersTab } from '@/components/admin/MembersTab';
import { SettingsTab } from '@/components/admin/SettingsTab';
import { StaffQrTab } from '@/components/admin/StaffQrTab';
import { AuditTab }           from '@/components/admin/AuditTab';
import { NotificationsTab }   from '@/components/admin/NotificationsTab';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';

import { adminReducer, initialAdminState } from './adminReducer';
import type { Shop, Product, AllStockRow, OrderStatus, ShopUser, Member, PromotionPreset, ComboDef, OrderDetail } from './adminReducer';
import { ROLE_LABEL } from '@/lib/audit-translate';

const BUCKET = 'product-images';

/** แปลงชื่อร้านเป็นชื่อโฟลเดอร์ Supabase Storage (ASCII เท่านั้น เพื่อป้องกัน path-encoding) */
function toFolderName(name: string, shopId: string): string {
  const ascii = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')   // ASCII เท่านั้น (ตัดอักษรไทยออก)
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const idPart = shopId.slice(0, 8);
  return ascii ? `${ascii}_${idPart}` : idPart;
}

type Tab = 'products' | 'stock' | 'orders' | 'members' | 'users' | 'staff-qr' | 'settings' | 'audit' | 'notifications';

/** แปลงรหัส 10 หลัก → XXXXX-XXX-XX เพื่ออ่านง่าย */
function formatShopCode(code: string): string {
  if (code.length !== 10) return code;
  return `${code.slice(0, 5)}-${code.slice(5, 8)}-${code.slice(8, 10)}`;
}

const MEMBERS_PER_PAGE = 10;

function AdminPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [, startTabTransition] = useTransition();
  const confirm = useConfirm();

  const [state, dispatch] = useReducer(adminReducer, initialAdminState);
  const { global: g, products: p, stock: st, promo, orders: ord, users: u, members: mb, settings: s } = state;

  // ── Destructure global ─────────────────────────────────────────
  const { shops, shopId, userRole, branches, loading, error } = g;

  // ── Destructure products ───────────────────────────────────────
  const {
    products, formOpen, editingId,
    formName, formSku, formPrice, formCostPrice, formUnit, formCategory, formBarcode,
    formImageUrl, formImageFile, formImagePreview, uploadError, saving,
    stockByProduct, stockEdit,
  } = p;

  // ── Destructure stock ──────────────────────────────────────────
  const {
    allStock, stockLoading, stockSearch, stockBranchFilter,
    stockEditModal, stockEditQty, stockEditMin, stockEditMode, stockSaving,
    stockSubView, stockHistory, histLoading, histFromDate, histToDate, histBranchFilter,
    addStockOpen, addStockProductId, addStockBranchId, addStockQty, addStockMin,
    addStockSaving, addStockError, shopUnits, newUnitName, unitSaving,
  } = st;

  // ── Destructure promo ──────────────────────────────────────────
  const {
    promoPresets, promoCombos, promoLoading, promoError,
    promoFormId, promoFormName, promoFormType, promoFormValue, promoFormColor, promoFormActive, promoSaving,
    comboFormId, comboFormName, comboFormPrice, comboFormActive, comboFormItems, comboSaving,
  } = promo;

  // ── Destructure orders ─────────────────────────────────────────
  const {
    orders, ordersLoading, ordersError,
    orderDetailOpen, orderDetail, orderDetailLoading,
    currentPage, totalOrders, filterStatus, searchSeq, searchDate, searchRef,
    monthlyStats, monthlyStatsLoading,
  } = ord;

  // ── Destructure users ──────────────────────────────────────────
  const {
    shopUsers, usersLoading,
    inviteEmail, invitePassword, inviteRole, inviteBranchId,
    inviteError, inviteSuccess, inviteCreated, inviting,
    editUserModal, editRole, editBranchId, editSaving,
    staffList, staffLoading,
    staffNickname, staffPin, staffRole, staffBranchId,
    staffError, staffSuccess, staffCreating,
    editStaffModal, editStaffNickname, editStaffPin,
    editStaffRole, editStaffBranchId, editStaffSaving, editStaffError,
  } = u;

  // ── Destructure members ────────────────────────────────────────
  const { members, membersLoading, membersSearch, membersPage, memberEdit, memberForm, memberSaving, memberError } = mb;

  // ── Destructure settings ───────────────────────────────────────
  const {
    settingsName, settingsLogoUrl, settingsLogoFile, settingsLogoPreview,
    settingsLogoUploadError, settingsVatEnabled,
    settingsOwnerFirstname, settingsOwnerLastname,
    settingsPromptpayType, settingsPromptpayNumber,
    settingsSaving, settingsError, settingsSuccess,
    displayMode, settingsMembershipEnabled,
    settingsPointsPer10, settingsRedemptionType, settingsRedemptionRate, settingsRedemptionBahtPerPoint,
    settingsTierSilver, settingsTierGold,
    settingsBirthdayBenefitType, settingsBirthdayBenefitValue, settingsBirthdayAutoUsePoints,
    settingsPrintEnabled, settingsPrinterWidth,
    printerMode, printerNetIP, printerNetPort,
    genProvince, genDistrict, genSaving, codeCopied,
    settingsPhone, settingsTaxId, settingsAddress,
    settingsOpeningHours, settingsWorkingDays, settingsGoogleReviewUrl,
  } = s;

  // ── Refs (not state, not managed by reducer) ───────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsLogoInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Tab (derived from URL, not state) ─────────────────────────
  const activeTab = (searchParams.get('tab') as Tab) ?? 'products';
  function setTab(tab: Tab) { startTabTransition(() => { router.replace(`/admin?tab=${tab}`); }); }

  // ── Derived constants ──────────────────────────────────────────
  const ORDERS_PER_PAGE = 10;
  const totalPages = Math.ceil(totalOrders / ORDERS_PER_PAGE);
  const adminShops = shops.filter((shop) => shop.role === 'owner' || shop.role === 'manager');

  // ── Wrapper dispatchers for components expecting React.Dispatch ─
  // OrdersTab.setCurrentPage typed as React.Dispatch<React.SetStateAction<number>>
  const setCurrentPage: React.Dispatch<React.SetStateAction<number>> = useCallback((val) => {
    const next = typeof val === 'function' ? val(ord.currentPage) : val;
    dispatch({ type: 'PATCH_ORDERS', payload: { currentPage: next } });
  }, [ord.currentPage]);

  // SettingsTab.setPromoPresets typed as React.Dispatch<React.SetStateAction<PromotionPreset[]>>
  const setPromoPresets: React.Dispatch<React.SetStateAction<PromotionPreset[]>> = useCallback((val) => {
    const next = typeof val === 'function' ? val(promo.promoPresets) : val;
    dispatch({ type: 'PATCH_PROMO', payload: { promoPresets: next } });
  }, [promo.promoPresets]);

  // SettingsTab.setPromoCombos typed as React.Dispatch<React.SetStateAction<ComboDef[]>>
  const setPromoCombos: React.Dispatch<React.SetStateAction<ComboDef[]>> = useCallback((val) => {
    const next = typeof val === 'function' ? val(promo.promoCombos) : val;
    dispatch({ type: 'PATCH_PROMO', payload: { promoCombos: next } });
  }, [promo.promoCombos]);

  // SettingsTab.setComboFormItems typed as React.Dispatch<React.SetStateAction<Array<{id:string;quantity:number}>>>
  const setComboFormItems: React.Dispatch<React.SetStateAction<Array<{ id: string; quantity: number }>>> = useCallback((val) => {
    const next = typeof val === 'function' ? val(promo.comboFormItems) : val;
    dispatch({ type: 'PATCH_PROMO', payload: { comboFormItems: next } });
  }, [promo.comboFormItems]);

  // MembersTab.setMemberForm typed as React.Dispatch<React.SetStateAction<...>>
  const setMemberForm: React.Dispatch<React.SetStateAction<{ name: string; phone: string; email: string; birthday: string; notes: string }>> = useCallback((val) => {
    const next = typeof val === 'function' ? val(mb.memberForm) : val;
    dispatch({ type: 'PATCH_MEMBERS', payload: { memberForm: next } });
  }, [mb.memberForm]);

  // SettingsTab boolean toggles that accept functional updaters
  const setSettingsVatEnabled = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(s.settingsVatEnabled) : val;
    dispatch({ type: 'PATCH_SETTINGS', payload: { settingsVatEnabled: next } });
  }, [s.settingsVatEnabled]);

  const setSettingsMembershipEnabled = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(s.settingsMembershipEnabled) : val;
    dispatch({ type: 'PATCH_SETTINGS', payload: { settingsMembershipEnabled: next } });
  }, [s.settingsMembershipEnabled]);

  const setSettingsBirthdayAutoUsePoints = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(s.settingsBirthdayAutoUsePoints) : val;
    dispatch({ type: 'PATCH_SETTINGS', payload: { settingsBirthdayAutoUsePoints: next } });
  }, [s.settingsBirthdayAutoUsePoints]);

  const setSettingsPrintEnabled = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(s.settingsPrintEnabled) : val;
    dispatch({ type: 'PATCH_SETTINGS', payload: { settingsPrintEnabled: next } });
  }, [s.settingsPrintEnabled]);

  // ── Handlers ───────────────────────────────────────────────────
  /** สร้างรหัสร้านสำหรับร้านที่ยังไม่มีรหัส */
  async function handleGenerateCode() {
    if (!shopId || !genProvince) return;
    const postalCode = IS_BANGKOK(genProvince)
      ? (BKK_DISTRICTS.find((d) => d.name === genDistrict)?.postal ?? PROVINCES.find((pp) => pp.name === genProvince)?.postal)
      : PROVINCES.find((pp) => pp.name === genProvince)?.postal;
    if (!postalCode) return;
    dispatch({ type: 'PATCH_SETTINGS', payload: { genSaving: true } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postal_code: postalCode, province: genProvince, district: genDistrict || undefined }),
    });
    if (res.ok) {
      const j = await res.json() as { data: { shop_code: string } };
      dispatch({ type: 'PATCH_GLOBAL', payload: {
        shops: shops.map((shop) =>
          shop.id === shopId
            ? { ...shop, shop_code: j.data.shop_code, province: genProvince, district: genDistrict || null, postal_code: postalCode }
            : shop,
        ),
      } });
      dispatch({ type: 'PATCH_SETTINGS', payload: { genProvince: '', genDistrict: '' } });
    }
    dispatch({ type: 'PATCH_SETTINGS', payload: { genSaving: false } });
  }

  function copyShopCode(code: string) {
    void navigator.clipboard.writeText(code);
    dispatch({ type: 'PATCH_SETTINGS', payload: { codeCopied: true } });
    setTimeout(() => dispatch({ type: 'PATCH_SETTINGS', payload: { codeCopied: false } }), 2000);
  }

  useEffect(() => {
    async function init() {
      // ตรวจสอบ ban/suspend ก่อน load ทุกอย่าง
      const token = await getAuthToken();
      if (token) {
        const banCheck = await fetch(`${API_URL}/api/v1/me/pos-assignment`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (banCheck.status === 403) {
          const bjson = await banCheck.json() as { error?: { code?: string; ban_reason?: string | null } };
          const code = bjson.error?.code ?? '';
          const banReason = bjson.error?.ban_reason ?? null;
          if (code === 'SHOP_BANNED' || code === 'SHOP_SUSPENDED') {
            const params = new URLSearchParams({ type: code === 'SHOP_BANNED' ? 'banned' : 'suspended' });
            if (banReason) params.set('reason', banReason);
            window.location.href = `/banned?${params}`;
            return;
          }
        }
      }

      const res = await fetchWithAuth(`${API_URL}/api/v1/me/shops`);
      if (!res.ok) {
        dispatch({ type: 'PATCH_GLOBAL', payload: { error: 'โหลดข้อมูลร้านไม่สำเร็จ', loading: false } });
        return;
      }
      const json = await res.json();
      const list = (json.data ?? []) as Shop[];
      const admin = list.filter((shop) => shop.role === 'owner' || shop.role === 'manager');
      const presetId = searchParams.get('shopId');
      const preferred = (presetId ? list.find((shop) => shop.id === presetId) : null) ?? admin[0] ?? list[0];
      dispatch({ type: 'PATCH_GLOBAL', payload: {
        shops: list,
        shopId: preferred?.id ?? null,
        userRole: preferred?.role ?? null,
        loading: false,
      } });
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shopId) return;
    const sel = shops.find((shop) => shop.id === shopId);
    dispatch({ type: 'PATCH_GLOBAL', payload: { userRole: sel?.role ?? null } });
    void (async () => {
      const [brRes, prRes] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches`),
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products`),
      ]);
      if (brRes.ok) { const j = await brRes.json(); dispatch({ type: 'PATCH_GLOBAL', payload: { branches: j.data ?? [] } }); }
      if (prRes.ok) { const j = await prRes.json(); dispatch({ type: 'PATCH_PRODUCTS', payload: { products: j.data ?? [] } }); }
    })();
  }, [shopId, shops]);

  const loadMonthlyStats = useCallback(async () => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_ORDERS', payload: { monthlyStatsLoading: true } });
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stats`);
      if (res.ok) {
        const j = await res.json() as { data?: { monthly?: { total?: string; orderCount?: number; cogs?: number; gross_profit?: number } } };
        const m = j.data?.monthly;
        dispatch({ type: 'PATCH_ORDERS', payload: {
          monthlyStats: {
            revenue:     Number(m?.total ?? 0),
            orderCount:  Number(m?.orderCount ?? 0),
            cogs:        Number(m?.cogs ?? 0),
            grossProfit: Number(m?.gross_profit ?? 0),
          },
        } });
      }
    } catch {
      // silently ignore — table will still show
    } finally {
      dispatch({ type: 'PATCH_ORDERS', payload: { monthlyStatsLoading: false } });
    }
  }, [shopId]);

  const loadOrders = useCallback(async (
    page: number = 1,
    status: OrderStatus | 'all' = 'all',
    seq?: string,
    date?: string,
    ref?: string,
  ) => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_ORDERS', payload: { ordersLoading: true, ordersError: null } });
    const offset = (page - 1) * ORDERS_PER_PAGE;

    const buildParams = (extra: Record<string, string | undefined>) => {
      const pp = new URLSearchParams({ limit: String(ORDERS_PER_PAGE), offset: String(offset) });
      if (status !== 'all') pp.set('status', status);
      if (extra.seq && /^\d+$/.test(extra.seq)) pp.set('seq', extra.seq);
      if (extra.date && /^\d{4}-\d{2}-\d{2}$/.test(extra.date)) pp.set('date', extra.date);
      if (extra.ref && extra.ref.trim()) pp.set('ref', extra.ref.trim());
      return pp.toString();
    };

    const listParams  = buildParams({ seq, date, ref });
    const countParams = buildParams({ seq, date, ref });

    try {
      const [ordersRes, countRes] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders?${listParams}`),
        fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders/count?${countParams}`),
      ]);

      if (ordersRes.ok) {
        const j = await ordersRes.json();
        dispatch({ type: 'PATCH_ORDERS', payload: { orders: j.data ?? [] } });
      } else {
        const j = await ordersRes.json().catch(() => ({}));
        dispatch({ type: 'PATCH_ORDERS', payload: { ordersError: (j as { error?: { message?: string } }).error?.message ?? 'โหลดออเดอร์ไม่สำเร็จ' } });
      }

      if (countRes.ok) {
        const j = await countRes.json();
        dispatch({ type: 'PATCH_ORDERS', payload: { totalOrders: (j as { data?: { count?: number } }).data?.count ?? 0 } });
      }
    } catch {
      dispatch({ type: 'PATCH_ORDERS', payload: { ordersError: 'เชื่อมต่อ API ไม่ได้ กรุณาลองใหม่' } });
    } finally {
      dispatch({ type: 'PATCH_ORDERS', payload: { ordersLoading: false } });
    }
  }, [shopId]);

  useEffect(() => {
    if (activeTab === 'orders') {
      loadOrders(currentPage, filterStatus, searchSeq || undefined, searchDate || undefined, searchRef || undefined);
      if (!monthlyStats && !monthlyStatsLoading) loadMonthlyStats();
    }
  }, [activeTab, loadOrders, loadMonthlyStats, currentPage, filterStatus, searchSeq, searchDate, searchRef, monthlyStats, monthlyStatsLoading]);

  // Reset page & filter when shop changes
  useEffect(() => {
    dispatch({ type: 'PATCH_ORDERS', payload: {
      currentPage: 1, totalOrders: 0, filterStatus: 'all',
      searchSeq: '', searchDate: '', searchRef: '', ordersError: null, monthlyStats: null,
    } });
  }, [shopId]);

  const loadUsers = useCallback(async () => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_USERS', payload: { usersLoading: true } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/users`);
    if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_USERS', payload: { shopUsers: j.data ?? [] } }); }
    dispatch({ type: 'PATCH_USERS', payload: { usersLoading: false } });
  }, [shopId]);

  const loadStaff = useCallback(async () => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_USERS', payload: { staffLoading: true } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff`);
    if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_USERS', payload: { staffList: j.data ?? [] } }); }
    dispatch({ type: 'PATCH_USERS', payload: { staffLoading: false } });
  }, [shopId]);

  useEffect(() => { if (activeTab === 'users') { loadUsers(); loadStaff(); } }, [activeTab, loadUsers, loadStaff]);

  const loadMembers = useCallback(async () => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_MEMBERS', payload: { membersLoading: true } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/customers?limit=500`);
    if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_MEMBERS', payload: { members: j.data ?? [] } }); }
    dispatch({ type: 'PATCH_MEMBERS', payload: { membersLoading: false } });
  }, [shopId]);

  useEffect(() => { if (activeTab === 'members') loadMembers(); }, [activeTab, loadMembers]);

  const filteredMembers = useMemo(() => {
    const q = membersSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.phone ?? '').toLowerCase().includes(q) ||
        (m.email ?? '').toLowerCase().includes(q),
    );
  }, [members, membersSearch]);

  const sortedMembers = useMemo(
    () =>
      [...filteredMembers].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filteredMembers],
  );

  const membersPageCount = useMemo(
    () => Math.max(1, Math.ceil(sortedMembers.length / MEMBERS_PER_PAGE)),
    [sortedMembers.length],
  );

  const pagedMembers = useMemo(() => {
    const safePage = Math.min(Math.max(1, membersPage), membersPageCount);
    const start = (safePage - 1) * MEMBERS_PER_PAGE;
    return sortedMembers.slice(start, start + MEMBERS_PER_PAGE);
  }, [sortedMembers, membersPage, membersPageCount]);

  const loadSettings = useCallback(async () => {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/settings`);
    if (res.ok) {
      const j = await res.json();
      const mc = j.data?.membership_config as {
        enabled?: boolean; points_per_10_baht?: number;
        redemption_type?: 'points_per_10_baht' | 'baht_per_point';
        redemption_rate?: number; redemption_baht_per_point?: number;
        tier_silver?: number; tier_gold?: number;
        birthday_benefit_type?: 'percent' | 'fixed'; birthday_benefit_value?: number;
        birthday_auto_use_points?: boolean;
      } | null | undefined;
      dispatch({ type: 'PATCH_SETTINGS', payload: {
        settingsName:                    j.data?.name ?? '',
        settingsLogoUrl:                 j.data?.logo_url ?? null,
        settingsLogoPreview:             j.data?.logo_url ?? null,
        settingsVatEnabled:              j.data?.vat_enabled !== false,
        settingsOwnerFirstname:          j.data?.owner_firstname ?? '',
        settingsOwnerLastname:           j.data?.owner_lastname ?? '',
        settingsPromptpayType:           j.data?.promptpay_type ?? 'phone',
        settingsPromptpayNumber:         j.data?.promptpay_number ?? '',
        settingsPrintEnabled:            j.data?.print_receipt_enabled === true,
        settingsPrinterWidth:            j.data?.printer_width === 32 ? 32 : 48,
        settingsLogoFile:                null,
        settingsMembershipEnabled:       mc?.enabled !== false,
        settingsPointsPer10:             mc?.points_per_10_baht ?? 10,
        settingsRedemptionType:          mc?.redemption_type ?? 'points_per_10_baht',
        settingsRedemptionRate:          mc?.redemption_rate ?? 100,
        settingsRedemptionBahtPerPoint:  mc?.redemption_baht_per_point ?? 0.1,
        settingsTierSilver:              mc?.tier_silver ?? 1000,
        settingsTierGold:                mc?.tier_gold ?? 5000,
        settingsBirthdayBenefitType:     mc?.birthday_benefit_type ?? 'percent',
        settingsBirthdayBenefitValue:    mc?.birthday_benefit_value ?? 0,
        settingsBirthdayAutoUsePoints:   mc?.birthday_auto_use_points !== false,
        settingsPhone:           j.data?.phone           ?? '',
        settingsTaxId:           j.data?.tax_id          ?? '',
        settingsAddress:         j.data?.address         ?? '',
        settingsOpeningHours:    j.data?.opening_hours   ?? '',
        settingsWorkingDays:     j.data?.working_days    ?? '',
        settingsGoogleReviewUrl: j.data?.google_review_url ?? '',
      } });
    }
  }, [shopId]);

  useEffect(() => { if (activeTab === 'settings') loadSettings(); }, [activeTab, loadSettings]);

  /** Load device-specific display mode from localStorage when shopId is ready */
  useEffect(() => {
    if (!shopId) return;
    try {
      const saved = localStorage.getItem(`display_mode_${shopId}`) as 'browser' | 'monitor' | null;
      dispatch({ type: 'PATCH_SETTINGS', payload: { displayMode: saved ?? 'browser' } });
    } catch { /* ignore */ }
  }, [shopId]);

  /** Load device-specific printer connection config */
  useEffect(() => {
    if (!shopId) return;
    try {
      dispatch({ type: 'PATCH_SETTINGS', payload: {
        printerMode:    (localStorage.getItem(`pos_printer_mode_${shopId}`) as typeof printerMode) ?? 'browser',
        printerNetIP:   localStorage.getItem(`pos_printer_net_ip_${shopId}`) ?? '',
        printerNetPort: localStorage.getItem(`pos_printer_net_port_${shopId}`) ?? '9100',
      } });
    } catch { /* ignore */ }
  }, [shopId]);

  function saveLocalPrinterConfig(mode: typeof printerMode, ip: string, port: string) {
    try {
      if (!shopId) return;
      localStorage.setItem(`pos_printer_mode_${shopId}`, mode);
      localStorage.setItem(`pos_printer_net_ip_${shopId}`, ip);
      localStorage.setItem(`pos_printer_net_port_${shopId}`, port);
    } catch { /* ignore */ }
  }

  function saveDisplayMode(mode: 'browser' | 'monitor') {
    dispatch({ type: 'PATCH_SETTINGS', payload: { displayMode: mode } });
    try { if (shopId) localStorage.setItem(`display_mode_${shopId}`, mode); } catch { /* ignore */ }
  }

  const loadAllStock = useCallback(async () => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_STOCK', payload: { stockLoading: true } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock`);
    if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_STOCK', payload: { allStock: j.data ?? [] } }); }
    dispatch({ type: 'PATCH_STOCK', payload: { stockLoading: false } });
  }, [shopId]);

  const loadUnits = useCallback(async () => {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/units`);
    if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_STOCK', payload: { shopUnits: j.data ?? [] } }); }
  }, [shopId]);

  const loadStockHistory = useCallback(async () => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_STOCK', payload: { histLoading: true } });
    const params = new URLSearchParams({ limit: '200' });
    if (histBranchFilter) params.set('branchId', histBranchFilter);
    if (histFromDate) params.set('fromDate', histFromDate);
    if (histToDate) params.set('toDate', histToDate);
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock/transactions?${params}`);
    if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_STOCK', payload: { stockHistory: j.data ?? [] } }); }
    dispatch({ type: 'PATCH_STOCK', payload: { histLoading: false } });
  }, [shopId, histBranchFilter, histFromDate, histToDate]);

  const stockSummary = useMemo(() => {
    const productIds = new Set(allStock.map((r) => r.product_id));
    const totalQty   = allStock.reduce((acc, r) => acc + r.quantity, 0);
    const lowCount   = allStock.filter((r) => r.quantity <= r.min_qty).length;
    const warnCount  = allStock.filter((r) => r.quantity > r.min_qty && r.quantity <= r.min_qty * 2).length;
    const byBranch: Record<string, { name: string; total: number; low: number }> = {};
    allStock.forEach((r) => {
      if (!byBranch[r.branch_id]) byBranch[r.branch_id] = { name: r.branch_name, total: 0, low: 0 };
      byBranch[r.branch_id].total += r.quantity;
      if (r.quantity <= r.min_qty) byBranch[r.branch_id].low++;
    });
    return { totalProducts: productIds.size, totalQty, lowCount, warnCount, byBranch };
  }, [allStock]);

  useEffect(() => {
    if (activeTab === 'stock') { loadAllStock(); loadUnits(); }
  }, [activeTab, loadAllStock, loadUnits]);

  useEffect(() => {
    if (activeTab === 'stock' && stockSubView === 'history') loadStockHistory();
  }, [activeTab, stockSubView, loadStockHistory]);

  const loadPromotions = useCallback(async () => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_PROMO', payload: { promoLoading: true, promoError: null } });
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/promotions`);
      const j = await res.json();
      if (!res.ok || j.success === false) {
        dispatch({ type: 'PATCH_PROMO', payload: { promoError: j?.error?.message ?? 'โหลดโปรโมชั่นไม่สำเร็จ' } });
        return;
      }
      dispatch({ type: 'PATCH_PROMO', payload: {
        promoPresets: (j.data?.promotions ?? []) as PromotionPreset[],
        promoCombos:  (j.data?.combos ?? []) as ComboDef[],
      } });
    } catch {
      dispatch({ type: 'PATCH_PROMO', payload: { promoError: 'โหลดโปรโมชั่นไม่สำเร็จ' } });
    } finally {
      dispatch({ type: 'PATCH_PROMO', payload: { promoLoading: false } });
    }
  }, [shopId]);

  useEffect(() => {
    if (activeTab === 'settings') loadPromotions();
  }, [activeTab, loadPromotions]);

  // WebSocket for real-time stock updates
  useEffect(() => {
    if (!shopId) return;
    const ws = new WebSocket(`${WS_URL}/ws?shopId=${shopId}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'STOCK_UPDATE' && activeTab === 'stock') {
          dispatch({ type: 'PATCH_STOCK', payload: {
            allStock: st.allStock.map((row) =>
              row.branch_id === msg.payload?.branch_id && row.product_id === msg.payload?.product_id
                ? { ...row, quantity: msg.payload.quantity }
                : row,
            ),
          } });
        }
      } catch {}
    };
    return () => ws.close();
  }, [shopId, activeTab, st.allStock]);

  // Prevent body scrolling when modal is open
  useEffect(() => {
    if (orderDetailOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [orderDetailOpen]);

  function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    dispatch({ type: 'PATCH_SETTINGS', payload: { settingsLogoFile: file, settingsLogoUploadError: null } });
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsLogoPreview: ev.target?.result as string } });
      reader.readAsDataURL(file);
    } else {
      dispatch({ type: 'PATCH_SETTINGS', payload: { settingsLogoPreview: settingsLogoUrl } });
    }
  }

  async function saveSettings() {
    if (!shopId) return;
    dispatch({ type: 'PATCH_SETTINGS', payload: { settingsSaving: true, settingsError: null, settingsSuccess: null, settingsLogoUploadError: null } });

    const body: Record<string, unknown> = {};

    body.name = settingsName.trim() || undefined;

    if (settingsLogoFile) {
      const supabase = createSupabaseClient();
      const ext = settingsLogoFile.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const shopName = settingsName.trim() || shops.find((shop) => shop.id === shopId)?.name || '';
      const folder = toFolderName(shopName, shopId ?? 'unknown');
      const path = `pic/${folder}/shop-logo-${Date.now()}.${ext}`;
      const { data: upData, error: upErr } = await supabase.storage.from(BUCKET).upload(path, settingsLogoFile, { cacheControl: '3600', upsert: true });
      if (upErr) {
        dispatch({ type: 'PATCH_SETTINGS', payload: { settingsLogoUploadError: `อัปโหลดโลโก้ไม่สำเร็จ: ${upErr.message}`, settingsSaving: false } });
        return;
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      body.logo_url = data.publicUrl;
    } else if (settingsLogoPreview === null) {
      body.logo_url = null;
    }

    body.vat_enabled = settingsVatEnabled;
    body.owner_firstname = settingsOwnerFirstname.trim() || null;
    body.owner_lastname  = settingsOwnerLastname.trim()  || null;
    body.promptpay_type   = settingsPromptpayNumber.trim() ? settingsPromptpayType : null;
    body.promptpay_number = settingsPromptpayNumber.trim() || null;
    body.print_receipt_enabled = settingsPrintEnabled;
    body.printer_width         = settingsPrintEnabled ? settingsPrinterWidth : null;
    body.phone              = settingsPhone.trim() || null;
    body.tax_id             = settingsTaxId.trim() || null;
    body.address            = settingsAddress.trim() || null;
    body.opening_hours      = settingsOpeningHours.trim() || null;
    body.working_days       = settingsWorkingDays.trim() || null;
    body.google_review_url  = settingsGoogleReviewUrl.trim() || null;
    body.membership_config = {
      enabled:                    settingsMembershipEnabled,
      points_per_10_baht:         settingsPointsPer10,
      redemption_type:            settingsRedemptionType,
      redemption_rate:            settingsRedemptionRate,
      redemption_baht_per_point:  settingsRedemptionBahtPerPoint,
      tier_silver:                settingsTierSilver,
      tier_gold:                  settingsTierGold,
      birthday_benefit_type:      settingsBirthdayBenefitType,
      birthday_benefit_value:     settingsBirthdayBenefitValue,
      birthday_auto_use_points:   settingsBirthdayAutoUsePoints,
    };

    (Object.keys(body) as (keyof typeof body)[]).forEach((k) => { if (body[k] === undefined) delete body[k]; });

    if (Object.keys(body).length === 0) { dispatch({ type: 'PATCH_SETTINGS', payload: { settingsSaving: false } }); return; }

    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json();
      const mc = j.data?.membership_config as {
        enabled?: boolean; points_per_10_baht?: number;
        redemption_type?: 'points_per_10_baht' | 'baht_per_point';
        redemption_rate?: number; redemption_baht_per_point?: number;
        tier_silver?: number; tier_gold?: number;
        birthday_benefit_type?: 'percent' | 'fixed'; birthday_benefit_value?: number;
        birthday_auto_use_points?: boolean;
      } | null | undefined;
      dispatch({ type: 'PATCH_SETTINGS', payload: {
        settingsName:                   j.data?.name ?? settingsName,
        settingsLogoUrl:                j.data?.logo_url ?? null,
        settingsLogoPreview:            j.data?.logo_url ?? null,
        settingsVatEnabled:             j.data?.vat_enabled !== false,
        settingsOwnerFirstname:         j.data?.owner_firstname ?? '',
        settingsOwnerLastname:          j.data?.owner_lastname ?? '',
        settingsPromptpayType:          j.data?.promptpay_type ?? 'phone',
        settingsPromptpayNumber:        j.data?.promptpay_number ?? '',
        settingsPrintEnabled:           j.data?.print_receipt_enabled === true,
        settingsPrinterWidth:           j.data?.printer_width === 32 ? 32 : 48,
        settingsLogoFile:               null,
        settingsMembershipEnabled:      mc?.enabled !== false,
        settingsPointsPer10:            mc?.points_per_10_baht ?? 10,
        settingsRedemptionType:         mc?.redemption_type ?? 'points_per_10_baht',
        settingsRedemptionRate:         mc?.redemption_rate ?? 100,
        settingsRedemptionBahtPerPoint: mc?.redemption_baht_per_point ?? 0.1,
        settingsTierSilver:             mc?.tier_silver ?? 1000,
        settingsTierGold:               mc?.tier_gold ?? 5000,
        settingsBirthdayBenefitType:    mc?.birthday_benefit_type ?? 'percent',
        settingsBirthdayBenefitValue:   mc?.birthday_benefit_value ?? 0,
        settingsBirthdayAutoUsePoints:  mc?.birthday_auto_use_points !== false,
        settingsSuccess:                'บันทึกเรียบร้อยแล้ว',
      } });
      if (settingsLogoInputRef.current) settingsLogoInputRef.current.value = '';
      dispatch({ type: 'PATCH_GLOBAL', payload: {
        shops: shops.map((shop) => shop.id === shopId ? { ...shop, name: j.data?.name ?? shop.name } : shop),
      } });
    } else {
      const j = await res.json().catch(() => ({}));
      dispatch({ type: 'PATCH_SETTINGS', payload: { settingsError: j.error?.message ?? 'บันทึกไม่สำเร็จ' } });
    }
    dispatch({ type: 'PATCH_SETTINGS', payload: { settingsSaving: false } });
  }

  async function loadStock(productId: string) {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products/${productId}/stock`);
    if (!res.ok) return;
    const j = await res.json();
    dispatch({ type: 'PATCH_PRODUCTS', payload: { stockByProduct: { ...stockByProduct, [productId]: j.data ?? [] } } });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    dispatch({ type: 'PATCH_PRODUCTS', payload: { formImageFile: file, uploadError: null } });
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formImagePreview: ev.target?.result as string } });
      reader.readAsDataURL(file);
    } else {
      dispatch({ type: 'PATCH_PRODUCTS', payload: { formImagePreview: formImageUrl } });
    }
  }

  async function uploadImage(file: File, shopName: string): Promise<string | null> {
    const supabase = createSupabaseClient();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const folder = toFolderName(shopName, shopId ?? 'unknown');
    const path = `pic/${folder}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: true });
    if (upErr) { dispatch({ type: 'PATCH_PRODUCTS', payload: { uploadError: `อัปโหลดรูปไม่สำเร็จ: ${upErr.message}` } }); return null; }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function saveProduct() {
    if (!shopId) return;
    dispatch({ type: 'PATCH_PRODUCTS', payload: { saving: true, uploadError: null } });
    let imageUrl: string | null | undefined = formImageUrl;
    if (formImageFile) {
      const currentShopName = shops.find((shop) => shop.id === shopId)?.name ?? shopId ?? 'unknown';
      const uploaded = await uploadImage(formImageFile, currentShopName);
      if (!uploaded) { dispatch({ type: 'PATCH_PRODUCTS', payload: { saving: false } }); return; }
      imageUrl = uploaded;
    }
    const body: Record<string, unknown> = {
      name: formName, sku: formSku || undefined, price: formPrice,
      unit: formUnit || 'อัน',
      category: formCategory || undefined,
      barcode: formBarcode || undefined,
      cost_price: formCostPrice || undefined,
    };
    if (imageUrl !== undefined) body.image_url = imageUrl;
    if (editingId) {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_PRODUCTS', payload: { products: products.map((prod) => (prod.id === editingId ? { ...prod, ...j.data } : prod)) } }); closeForm(); }
    } else {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_PRODUCTS', payload: { products: [...products, j.data] } }); closeForm(); }
    }
    dispatch({ type: 'PATCH_PRODUCTS', payload: { saving: false } });
  }

  async function deleteProduct(productId: string) {
    if (!shopId) return;
    const product = products.find((prod) => prod.id === productId);
    const ok = await confirm({
      title: 'นำสินค้าออก',
      description: <><strong>{product?.name ?? 'สินค้านี้'}</strong> จะถูกนำออกจากเมนูและไม่สามารถขายต่อได้ ประวัติการขายที่ผ่านมาจะยังคงอยู่ครบถ้วน</>,
      variant: 'danger',
      icon: '🗑',
    });
    if (!ok) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/products/${productId}`, { method: 'DELETE' });
    if (res.ok) {
      dispatch({ type: 'PATCH_PRODUCTS', payload: { products: products.filter((prod) => prod.id !== productId) } });
      toast.success('ลบสินค้าเรียบร้อยแล้ว');
    } else {
      const json = await res.json().catch(() => ({})) as { error?: { message?: string } };
      toast.error(json?.error?.message ?? 'ลบสินค้าไม่สำเร็จ');
    }
  }

  async function saveStock() {
    if (!stockEdit || !shopId) return;
    const q = parseInt(stockEdit.quantity, 10);
    if (isNaN(q) || q < 0) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches/${stockEdit.branchId}/products/${stockEdit.productId}/stock`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: q }) });
    if (res.ok) { loadStock(stockEdit.productId); dispatch({ type: 'PATCH_PRODUCTS', payload: { stockEdit: null } }); }
  }

  async function saveStockModal() {
    if (!stockEditModal || !shopId) return;
    dispatch({ type: 'PATCH_STOCK', payload: { stockSaving: true } });
    const delta = parseInt(stockEditQty, 10);
    const min = parseInt(stockEditMin, 10);
    const promises: Promise<Response>[] = [];
    if (!isNaN(delta) && delta >= 0) {
      let newQty: number;
      if (stockEditMode === 'set') newQty = delta;
      else if (stockEditMode === 'add') newQty = stockEditModal.quantity + delta;
      else newQty = Math.max(0, stockEditModal.quantity - delta);
      promises.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches/${stockEditModal.branch_id}/products/${stockEditModal.product_id}/stock`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty }),
      }));
    }
    if (stockEditMode === 'set' && !isNaN(min) && min >= 0) {
      promises.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock/min-qty`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: stockEditModal.branch_id, product_id: stockEditModal.product_id, min_qty: min }),
      }));
    }
    await Promise.all(promises);
    dispatch({ type: 'PATCH_STOCK', payload: { stockSaving: false, stockEditModal: null } });
    loadAllStock();
  }

  async function saveAddStock() {
    if (!addStockProductId || !addStockBranchId || !shopId) {
      dispatch({ type: 'PATCH_STOCK', payload: { addStockError: 'กรุณาเลือกสินค้าและสาขา' } });
      return;
    }
    dispatch({ type: 'PATCH_STOCK', payload: { addStockError: null, addStockSaving: true } });
    const qty = parseInt(addStockQty, 10);
    const min = parseInt(addStockMin, 10);
    const promises: Promise<Response>[] = [];
    if (!isNaN(qty) && qty >= 0) {
      promises.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches/${addStockBranchId}/products/${addStockProductId}/stock`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty }),
      }));
    }
    if (!isNaN(min) && min >= 0) {
      promises.push(fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/stock/min-qty`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: addStockBranchId, product_id: addStockProductId, min_qty: min }),
      }));
    }
    await Promise.all(promises);
    dispatch({ type: 'PATCH_STOCK', payload: {
      addStockSaving: false, addStockOpen: false,
      addStockProductId: '', addStockBranchId: '', addStockQty: '0', addStockMin: '5',
    } });
    loadAllStock();
  }

  async function addUnit() {
    if (!newUnitName.trim() || !shopId) return;
    dispatch({ type: 'PATCH_STOCK', payload: { unitSaving: true } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/units`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newUnitName.trim() }),
    });
    if (res.ok) { const j = await res.json(); dispatch({ type: 'PATCH_STOCK', payload: { shopUnits: [...shopUnits, j.data], newUnitName: '' } }); }
    dispatch({ type: 'PATCH_STOCK', payload: { unitSaving: false } });
  }

  async function deleteUnit(unitId: string) {
    if (!shopId) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/units/${unitId}`, { method: 'DELETE' });
    if (res.ok) dispatch({ type: 'PATCH_STOCK', payload: { shopUnits: shopUnits.filter((unit) => unit.id !== unitId) } });
  }

  function openEdit(prod: Product) {
    dispatch({ type: 'PATCH_PRODUCTS', payload: {
      editingId: prod.id, formName: prod.name, formSku: prod.sku ?? '',
      formPrice: prod.price, formCostPrice: prod.cost_price ?? '',
      formUnit: prod.unit ?? 'อัน', formCategory: prod.category ?? '',
      formBarcode: prod.barcode ?? '',
      formImageUrl: prod.image_url, formImageFile: null,
      formImagePreview: prod.image_url, uploadError: null, formOpen: true,
    } });
  }

  function openAdd() {
    dispatch({ type: 'PATCH_PRODUCTS', payload: {
      editingId: null, formName: '', formSku: '', formPrice: '',
      formCostPrice: '', formUnit: 'อัน', formCategory: '', formBarcode: '',
      formImageUrl: null, formImageFile: null, formImagePreview: null, uploadError: null, formOpen: true,
    } });
  }

  function closeForm() {
    dispatch({ type: 'PATCH_PRODUCTS', payload: {
      formOpen: false, editingId: null, formName: '', formSku: '', formPrice: '',
      formCostPrice: '', formUnit: 'อัน', formCategory: '', formBarcode: '',
      formImageUrl: null, formImageFile: null, formImagePreview: null, uploadError: null,
    } });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const loadOrderDetail = useCallback(async (orderId: string) => {
    if (!shopId) return;
    dispatch({ type: 'PATCH_ORDERS', payload: { orderDetailLoading: true, orderDetailOpen: true } });
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/orders/${orderId}`);
      if (res.ok) {
        const j = await res.json() as { data: OrderDetail | null };
        dispatch({ type: 'PATCH_ORDERS', payload: { orderDetail: j.data } });
      }
    } catch { /* ignore */ } finally {
      dispatch({ type: 'PATCH_ORDERS', payload: { orderDetailLoading: false } });
    }
  }, [shopId]);

  async function inviteUser() {
    if (!shopId || !inviteEmail.trim() || !invitePassword.trim()) return;
    dispatch({ type: 'PATCH_USERS', payload: { inviting: true, inviteError: null, inviteSuccess: null, inviteCreated: null } });
    const body: Record<string, unknown> = {
      email:    inviteEmail.trim(),
      password: invitePassword.trim(),
      role:     inviteRole,
    };
    if (inviteBranchId) body.branchId = inviteBranchId;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/users`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (res.ok) {
      const savedEmail = inviteEmail.trim();
      const savedPass  = invitePassword.trim();
      dispatch({ type: 'PATCH_USERS', payload: {
        inviteSuccess: `เพิ่ม ${savedEmail} สำเร็จ`,
        inviteCreated: { email: savedEmail, password: savedPass },
        inviteEmail: '', invitePassword: '', inviteBranchId: '',
      } });
      loadUsers();
    } else {
      const j = await res.json().catch(() => ({}));
      dispatch({ type: 'PATCH_USERS', payload: { inviteError: j.error?.message ?? 'เพิ่มผู้ใช้ไม่สำเร็จ' } });
    }
    dispatch({ type: 'PATCH_USERS', payload: { inviting: false } });
  }

  function openEditUser(usr: ShopUser) {
    dispatch({ type: 'PATCH_USERS', payload: {
      editUserModal: usr,
      editRole: usr.role as 'manager' | 'cashier' | 'viewer',
      editBranchId: usr.branch_id ?? '',
    } });
  }

  async function saveEditUser() {
    if (!editUserModal || !shopId) return;
    dispatch({ type: 'PATCH_USERS', payload: { editSaving: true } });
    const body: Record<string, unknown> = { role: editRole };
    if (editBranchId) body.branchId = editBranchId;
    else body.branchId = null;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/users/${editUserModal.user_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { dispatch({ type: 'PATCH_USERS', payload: { editUserModal: null } }); loadUsers(); }
    dispatch({ type: 'PATCH_USERS', payload: { editSaving: false } });
  }

  async function removeUser(userId: string, email: string) {
    if (!shopId) return;
    const ok = await confirm({
      title: 'ลบผู้ใช้ออกจากร้าน',
      description: <><strong>{email}</strong> จะถูกลบออกจากร้านนี้<br />ข้อมูลการขายที่ผ่านมาจะยังคงอยู่</>,
      variant: 'danger',
      icon: '👤',
      confirmLabel: 'ลบออก',
    });
    if (!ok) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      dispatch({ type: 'PATCH_USERS', payload: { shopUsers: shopUsers.filter((usr) => usr.user_id !== userId) } });
      toast.success(`ลบ ${email} ออกจากร้านแล้ว`);
    } else {
      toast.error('ลบผู้ใช้ไม่สำเร็จ');
    }
  }

  // ── Staff (nickname+PIN) functions ──────────────────────────────
  async function createStaff() {
    if (!shopId || !staffNickname.trim() || !/^\d{4}$/.test(staffPin)) return;
    dispatch({ type: 'PATCH_USERS', payload: { staffCreating: true, staffError: null, staffSuccess: null } });
    const body: Record<string, unknown> = { nickname: staffNickname.trim(), pin: staffPin, role: staffRole };
    if (staffBranchId) body.branchId = staffBranchId;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) {
      dispatch({ type: 'PATCH_USERS', payload: {
        staffSuccess: `เพิ่มพนักงาน "${staffNickname.trim()}" สำเร็จ`,
        staffNickname: '', staffPin: '', staffBranchId: '',
      } });
      loadStaff();
    } else {
      const j = await res.json().catch(() => ({}));
      dispatch({ type: 'PATCH_USERS', payload: { staffError: j.error?.message ?? 'เพิ่มพนักงานไม่สำเร็จ' } });
    }
    dispatch({ type: 'PATCH_USERS', payload: { staffCreating: false } });
  }

  function openEditStaff(staff: import('@/app/admin/adminReducer').StaffItem) {
    dispatch({ type: 'PATCH_USERS', payload: {
      editStaffModal: staff,
      editStaffNickname: staff.nickname,
      editStaffPin: '',
      editStaffRole: staff.role,
      editStaffBranchId: staff.branch_id ?? '',
      editStaffError: null,
    } });
  }

  async function saveEditStaffNickname() {
    if (!editStaffModal || !shopId || !editStaffNickname.trim()) return;
    dispatch({ type: 'PATCH_USERS', payload: { editStaffSaving: true, editStaffError: null } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff/${editStaffModal.user_id}/nickname`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: editStaffNickname.trim() }),
    });
    if (res.ok) {
      dispatch({ type: 'PATCH_USERS', payload: { editStaffModal: null } });
      loadStaff();
    } else {
      const j = await res.json().catch(() => ({}));
      dispatch({ type: 'PATCH_USERS', payload: { editStaffError: j.error?.message ?? 'เปลี่ยนชื่อเล่นไม่สำเร็จ' } });
    }
    dispatch({ type: 'PATCH_USERS', payload: { editStaffSaving: false } });
  }

  async function saveEditStaffPin() {
    if (!editStaffModal || !shopId || !/^\d{4}$/.test(editStaffPin)) return;
    dispatch({ type: 'PATCH_USERS', payload: { editStaffSaving: true, editStaffError: null } });
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff/${editStaffModal.user_id}/pin`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: editStaffPin }),
    });
    if (res.ok) {
      dispatch({ type: 'PATCH_USERS', payload: { editStaffModal: null } });
      toast.success('เปลี่ยน PIN สำเร็จ');
    } else {
      const j = await res.json().catch(() => ({}));
      dispatch({ type: 'PATCH_USERS', payload: { editStaffError: j.error?.message ?? 'เปลี่ยน PIN ไม่สำเร็จ' } });
    }
    dispatch({ type: 'PATCH_USERS', payload: { editStaffSaving: false } });
  }

  async function deleteStaff(staffId: string, nickname: string) {
    if (!shopId) return;
    const ok = await confirm({
      title: 'ลบพนักงานออกจากระบบ',
      description: <><strong>{nickname}</strong> จะถูกลบออกจากระบบทั้งหมด<br />บัญชีและข้อมูลล็อกอินจะหายถาวร</>,
      variant: 'danger',
      icon: '👤',
      confirmLabel: 'ลบถาวร',
    });
    if (!ok) return;
    const res = await fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/staff/${staffId}`, { method: 'DELETE' });
    if (res.ok) {
      dispatch({ type: 'PATCH_USERS', payload: { staffList: staffList.filter((s) => s.user_id !== staffId) } });
      toast.success(`ลบ "${nickname}" แล้ว`);
    } else {
      toast.error('ลบพนักงานไม่สำเร็จ');
    }
  }

  if (loading) {
    return (
      <main className="page-admin">
        <div className="page-admin__header-wrap"><AuthHeader title="จัดการร้าน" /></div>
        <div className="page-admin__content">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="page-admin">
      <div className="page-admin__header-wrap">
        <AuthHeader title="จัดการร้าน" />
        {adminShops.length > 0 && (
          <div className="page-admin__tabs">
            <button type="button" className={`page-admin__tab${activeTab === 'products' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('products')}>
              📦 สินค้า
            </button>
            <Link href="/stock" className="page-admin__tab">
              📊 สต๊อก
            </Link>
            <button type="button" className={`page-admin__tab${activeTab === 'orders' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('orders')}>
              📋 ออเดอร์
            </button>
            {(userRole === 'owner' || userRole === 'manager') && (
              <button type="button" className={`page-admin__tab${activeTab === 'members' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('members')}>
                🎫 สมาชิก
              </button>
            )}
            {userRole === 'owner' && (
              <button type="button" className={`page-admin__tab${activeTab === 'users' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('users')}>
                👥 ผู้ใช้
              </button>
            )}
            {(userRole === 'owner' || userRole === 'manager') && (
              <button type="button" className={`page-admin__tab${activeTab === 'staff-qr' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('staff-qr')}>
                🔑 QR พนักงาน
              </button>
            )}
            {userRole === 'owner' && (
              <button type="button" className={`page-admin__tab${activeTab === 'settings' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('settings')}>
                ⚙️ ตั้งค่าร้าน
              </button>
            )}
            {(userRole === 'owner' || userRole === 'manager') && (
              <button type="button" className={`page-admin__tab${activeTab === 'audit' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('audit')}>
                🔍 Audit Log
              </button>
            )}
            {(userRole === 'owner' || userRole === 'manager') && (
              <button type="button" className={`page-admin__tab${activeTab === 'notifications' ? ' page-admin__tab--active' : ''}`} onClick={() => setTab('notifications')}>
                🔔 การแจ้งเตือน
              </button>
            )}
          </div>
        )}
      </div>
      <div className="page-admin__content">
        {error && <p className="page-admin__error">{error}</p>}
        {adminShops.length === 0 && !error && (
          <p className="page-admin__empty">ไม่มีสิทธิ์เข้าถึง (ต้องเป็น owner หรือ manager)</p>
        )}

        {adminShops.length > 0 && (
          <>
            <div className="page-admin__shop-select">
              <label htmlFor="admin-shop" className="page-admin__label">ร้าน</label>
              <select id="admin-shop" value={shopId ?? ''} onChange={(e) => dispatch({ type: 'PATCH_GLOBAL', payload: { shopId: e.target.value || null } })} className="page-admin__select">
                {adminShops.map((shop) => (
                  <option key={shop.id} value={shop.id}>{shop.name} ({ROLE_LABEL[shop.role ?? ''] ?? shop.role})</option>
                ))}
              </select>
            </div>

            {/* ── Shop Code Block ─────────────────────────────────────────── */}
            {(() => {
              const curShop = adminShops.find((shop) => shop.id === shopId);
              if (!curShop) return null;
              return (
                <div className="shop-code-block">
                  {curShop.shop_code ? (
                    /* ─ มีรหัสแล้ว → โชว์ + copy ─ */
                    <div className="shop-code-block__display">
                      <div className="shop-code-block__meta">
                        {curShop.province && (
                          <span className="shop-code-block__location">
                            📍 {curShop.district ? `${curShop.district}, ` : ''}{curShop.province}
                          </span>
                        )}
                        <span className="shop-code-block__label">รหัสร้าน</span>
                      </div>
                      <div className="shop-code-block__row">
                        <span className="shop-code-block__code">
                          {formatShopCode(curShop.shop_code)}
                        </span>
                        <button
                          type="button"
                          className={`shop-code-block__copy${codeCopied ? ' shop-code-block__copy--done' : ''}`}
                          onClick={() => copyShopCode(curShop.shop_code!)}
                          title="คัดลอกรหัส"
                        >
                          {codeCopied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
                        </button>
                      </div>
                    </div>
                  ) : userRole === 'owner' ? (
                    /* ─ ยังไม่มีรหัส (owner เท่านั้น) → form สร้างรหัส ─ */
                    <div className="shop-code-block__generate">
                      <p className="shop-code-block__gen-label">⚠️ ร้านนี้ยังไม่มีรหัสร้าน — เลือกจังหวัดเพื่อสร้างรหัส</p>
                      <div className="shop-code-block__gen-row">
                        <select
                          value={genProvince}
                          onChange={(e) => dispatch({ type: 'PATCH_SETTINGS', payload: { genProvince: e.target.value, genDistrict: '' } })}
                          className="input-field shop-code-block__gen-select"
                        >
                          <option value="">เลือกจังหวัด</option>
                          {PROVINCES.map((prov) => (
                            <option key={prov.postal} value={prov.name}>{prov.name}</option>
                          ))}
                        </select>
                        {IS_BANGKOK(genProvince) && (
                          <select
                            value={genDistrict}
                            onChange={(e) => dispatch({ type: 'PATCH_SETTINGS', payload: { genDistrict: e.target.value } })}
                            className="input-field shop-code-block__gen-select"
                          >
                            <option value="">เลือกเขต</option>
                            {BKK_DISTRICTS.map((d) => (
                              <option key={d.postal} value={d.name}>{d.name}</option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          disabled={!genProvince || (IS_BANGKOK(genProvince) && !genDistrict) || genSaving}
                          onClick={() => void handleGenerateCode()}
                          className="btn-primary shop-code-block__gen-btn"
                        >
                          {genSaving ? '...' : 'สร้างรหัส'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}

            {/* ════ TAB: PRODUCTS ════ */}
            {activeTab === 'products' && (
              <ProductsTab
                products={products}
                shopUnits={shopUnits}
                formOpen={formOpen}
                editingId={editingId}
                formName={formName} setFormName={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formName: v } })}
                formSku={formSku} setFormSku={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formSku: v } })}
                formPrice={formPrice} setFormPrice={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formPrice: v } })}
                formCostPrice={formCostPrice} setFormCostPrice={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formCostPrice: v } })}
                formUnit={formUnit} setFormUnit={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formUnit: v } })}
                formCategory={formCategory} setFormCategory={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formCategory: v } })}
                formBarcode={formBarcode} setFormBarcode={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formBarcode: v } })}
                formImagePreview={formImagePreview}
                uploadError={uploadError}
                saving={saving}
                fileInputRef={fileInputRef}
                stockByProduct={stockByProduct}
                stockEdit={stockEdit} setStockEdit={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { stockEdit: v } })}
                openAdd={openAdd}
                openEdit={openEdit}
                closeForm={closeForm}
                saveProduct={saveProduct}
                deleteProduct={deleteProduct}
                loadStock={loadStock}
                saveStock={saveStock}
                handleFileChange={handleFileChange}
                setFormImageFile={(f) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formImageFile: f } })}
                setFormImageUrl={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formImageUrl: v } })}
                setFormImagePreview={(v) => dispatch({ type: 'PATCH_PRODUCTS', payload: { formImagePreview: v } })}
              />
            )}

            {/* ════ TAB: STOCK ════ */}
            {activeTab === 'stock' && (
              <StockTab
                allStock={allStock}
                stockLoading={stockLoading}
                stockSearch={stockSearch} setStockSearch={(v) => dispatch({ type: 'PATCH_STOCK', payload: { stockSearch: v } })}
                stockBranchFilter={stockBranchFilter} setStockBranchFilter={(v) => dispatch({ type: 'PATCH_STOCK', payload: { stockBranchFilter: v } })}
                stockEditModal={stockEditModal} setStockEditModal={(v) => dispatch({ type: 'PATCH_STOCK', payload: { stockEditModal: v } })}
                stockEditQty={stockEditQty} setStockEditQty={(v) => dispatch({ type: 'PATCH_STOCK', payload: { stockEditQty: v } })}
                stockEditMin={stockEditMin} setStockEditMin={(v) => dispatch({ type: 'PATCH_STOCK', payload: { stockEditMin: v } })}
                stockEditMode={stockEditMode} setStockEditMode={(v) => dispatch({ type: 'PATCH_STOCK', payload: { stockEditMode: v } })}
                stockSaving={stockSaving}
                stockSubView={stockSubView} setStockSubView={(v) => dispatch({ type: 'PATCH_STOCK', payload: { stockSubView: v } })}
                stockHistory={stockHistory}
                histLoading={histLoading}
                histFromDate={histFromDate} setHistFromDate={(v) => dispatch({ type: 'PATCH_STOCK', payload: { histFromDate: v } })}
                histToDate={histToDate} setHistToDate={(v) => dispatch({ type: 'PATCH_STOCK', payload: { histToDate: v } })}
                histBranchFilter={histBranchFilter} setHistBranchFilter={(v) => dispatch({ type: 'PATCH_STOCK', payload: { histBranchFilter: v } })}
                addStockOpen={addStockOpen} setAddStockOpen={(v) => dispatch({ type: 'PATCH_STOCK', payload: { addStockOpen: v } })}
                addStockProductId={addStockProductId} setAddStockProductId={(v) => dispatch({ type: 'PATCH_STOCK', payload: { addStockProductId: v } })}
                addStockBranchId={addStockBranchId} setAddStockBranchId={(v) => dispatch({ type: 'PATCH_STOCK', payload: { addStockBranchId: v } })}
                addStockQty={addStockQty} setAddStockQty={(v) => dispatch({ type: 'PATCH_STOCK', payload: { addStockQty: v } })}
                addStockMin={addStockMin} setAddStockMin={(v) => dispatch({ type: 'PATCH_STOCK', payload: { addStockMin: v } })}
                addStockSaving={addStockSaving} addStockError={addStockError}
                shopUnits={shopUnits} newUnitName={newUnitName} setNewUnitName={(v) => dispatch({ type: 'PATCH_STOCK', payload: { newUnitName: v } })} unitSaving={unitSaving}
                branches={branches} products={products} stockSummary={stockSummary}
                saveStockModal={saveStockModal}
                saveAddStock={saveAddStock}
                addUnit={addUnit}
                deleteUnit={deleteUnit}
                loadStockHistory={loadStockHistory}
              />
            )}

            {/* ════ TAB: ORDERS ════ */}
            {activeTab === 'orders' && (
              <OrdersTab
                orders={orders}
                ordersLoading={ordersLoading}
                ordersError={ordersError}
                orderDetailOpen={orderDetailOpen} setOrderDetailOpen={(v) => dispatch({ type: 'PATCH_ORDERS', payload: { orderDetailOpen: v } })}
                orderDetail={orderDetail} setOrderDetail={(v) => dispatch({ type: 'PATCH_ORDERS', payload: { orderDetail: v } })}
                orderDetailLoading={orderDetailLoading}
                currentPage={currentPage} setCurrentPage={setCurrentPage}
                totalOrders={totalOrders}
                filterStatus={filterStatus} setFilterStatus={(v) => dispatch({ type: 'PATCH_ORDERS', payload: { filterStatus: v } })}
                searchSeq={searchSeq} setSearchSeq={(v) => dispatch({ type: 'PATCH_ORDERS', payload: { searchSeq: v } })}
                searchDate={searchDate} setSearchDate={(v) => dispatch({ type: 'PATCH_ORDERS', payload: { searchDate: v } })}
                searchRef={searchRef} setSearchRef={(v) => dispatch({ type: 'PATCH_ORDERS', payload: { searchRef: v } })}
                ORDERS_PER_PAGE={ORDERS_PER_PAGE}
                totalPages={totalPages}
                monthlyStats={monthlyStats}
                monthlyStatsLoading={monthlyStatsLoading}
                shopId={shopId}
                loadOrders={loadOrders}
                loadMonthlyStats={loadMonthlyStats}
                setMonthlyStats={(v) => dispatch({ type: 'PATCH_ORDERS', payload: { monthlyStats: v } })}
                loadOrderDetail={loadOrderDetail}
              />
            )}

            {/* ════ TAB: MEMBERS ════ */}
            {activeTab === 'members' && (userRole === 'owner' || userRole === 'manager') && (
              <MembersTab
                members={members}
                membersLoading={membersLoading}
                membersSearch={membersSearch} setMembersSearch={(v) => dispatch({ type: 'PATCH_MEMBERS', payload: { membersSearch: v } })}
                membersPage={membersPage} setMembersPage={(v) => dispatch({ type: 'PATCH_MEMBERS', payload: { membersPage: v } })}
                memberEdit={memberEdit} setMemberEdit={(v) => dispatch({ type: 'PATCH_MEMBERS', payload: { memberEdit: v } })}
                memberForm={memberForm} setMemberForm={setMemberForm}
                memberSaving={memberSaving} setMemberSaving={(v) => dispatch({ type: 'PATCH_MEMBERS', payload: { memberSaving: v } })}
                memberError={memberError} setMemberError={(v) => dispatch({ type: 'PATCH_MEMBERS', payload: { memberError: v } })}
                filteredMembers={filteredMembers}
                pagedMembers={pagedMembers}
                membersPageCount={membersPageCount}
                shopId={shopId}
                loadMembers={loadMembers}
              />
            )}

            {/* ════ TAB: USERS (owner only) ════ */}
            {activeTab === 'users' && userRole === 'owner' && (
              <UsersTab
                shopUsers={shopUsers}
                usersLoading={usersLoading}
                inviteEmail={inviteEmail} setInviteEmail={(v) => dispatch({ type: 'PATCH_USERS', payload: { inviteEmail: v } })}
                invitePassword={invitePassword} setInvitePassword={(v) => dispatch({ type: 'PATCH_USERS', payload: { invitePassword: v } })}
                inviteRole={inviteRole} setInviteRole={(v) => dispatch({ type: 'PATCH_USERS', payload: { inviteRole: v } })}
                inviteBranchId={inviteBranchId} setInviteBranchId={(v) => dispatch({ type: 'PATCH_USERS', payload: { inviteBranchId: v } })}
                inviteError={inviteError}
                inviteSuccess={inviteSuccess}
                inviteCreated={inviteCreated} setInviteCreated={(v) => dispatch({ type: 'PATCH_USERS', payload: { inviteCreated: v } })}
                inviting={inviting}
                editUserModal={editUserModal} setEditUserModal={(v) => dispatch({ type: 'PATCH_USERS', payload: { editUserModal: v } })}
                editRole={editRole} setEditRole={(v) => dispatch({ type: 'PATCH_USERS', payload: { editRole: v } })}
                editBranchId={editBranchId} setEditBranchId={(v) => dispatch({ type: 'PATCH_USERS', payload: { editBranchId: v } })}
                editSaving={editSaving}
                branches={branches}
                inviteUser={inviteUser}
                openEditUser={openEditUser}
                saveEditUser={saveEditUser}
                removeUser={removeUser}
                staffList={staffList}
                staffLoading={staffLoading}
                staffNickname={staffNickname} setStaffNickname={(v) => dispatch({ type: 'PATCH_USERS', payload: { staffNickname: v } })}
                staffPin={staffPin} setStaffPin={(v) => dispatch({ type: 'PATCH_USERS', payload: { staffPin: v } })}
                staffRole={staffRole} setStaffRole={(v) => dispatch({ type: 'PATCH_USERS', payload: { staffRole: v } })}
                staffBranchId={staffBranchId} setStaffBranchId={(v) => dispatch({ type: 'PATCH_USERS', payload: { staffBranchId: v } })}
                staffError={staffError}
                staffSuccess={staffSuccess}
                staffCreating={staffCreating}
                editStaffModal={editStaffModal} setEditStaffModal={(v) => dispatch({ type: 'PATCH_USERS', payload: { editStaffModal: v } })}
                editStaffNickname={editStaffNickname} setEditStaffNickname={(v) => dispatch({ type: 'PATCH_USERS', payload: { editStaffNickname: v } })}
                editStaffPin={editStaffPin} setEditStaffPin={(v) => dispatch({ type: 'PATCH_USERS', payload: { editStaffPin: v } })}
                editStaffRole={editStaffRole} setEditStaffRole={(v) => dispatch({ type: 'PATCH_USERS', payload: { editStaffRole: v } })}
                editStaffBranchId={editStaffBranchId} setEditStaffBranchId={(v) => dispatch({ type: 'PATCH_USERS', payload: { editStaffBranchId: v } })}
                editStaffSaving={editStaffSaving}
                editStaffError={editStaffError}
                createStaff={createStaff}
                openEditStaff={openEditStaff}
                saveEditStaffNickname={saveEditStaffNickname}
                saveEditStaffPin={saveEditStaffPin}
                deleteStaff={deleteStaff}
              />
            )}

            {/* ════ TAB: STAFF QR (owner/manager) ════ */}
            {activeTab === 'staff-qr' && (userRole === 'owner' || userRole === 'manager') && shopId && (
              <StaffQrTab shopId={shopId} shopUsers={shopUsers} branches={branches} />
            )}

            {/* ════ TAB: SETTINGS (owner only) ════ */}
            {activeTab === 'settings' && userRole === 'owner' && (
              <SettingsTab
                shopId={shopId}
                branches={branches}
                onBranchesChange={(next) => dispatch({ type: 'PATCH_GLOBAL', payload: { branches: next } })}
                settingsName={settingsName} setSettingsName={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsName: v } })}
                settingsLogoUrl={settingsLogoUrl} setSettingsLogoUrl={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsLogoUrl: v } })}
                settingsLogoFile={settingsLogoFile} setSettingsLogoFile={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsLogoFile: v } })}
                settingsLogoPreview={settingsLogoPreview} setSettingsLogoPreview={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsLogoPreview: v } })}
                settingsLogoUploadError={settingsLogoUploadError}
                settingsVatEnabled={settingsVatEnabled} setSettingsVatEnabled={setSettingsVatEnabled}
                settingsOwnerFirstname={settingsOwnerFirstname} setSettingsOwnerFirstname={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsOwnerFirstname: v } })}
                settingsOwnerLastname={settingsOwnerLastname} setSettingsOwnerLastname={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsOwnerLastname: v } })}
                settingsPromptpayType={settingsPromptpayType} setSettingsPromptpayType={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsPromptpayType: v } })}
                settingsPromptpayNumber={settingsPromptpayNumber} setSettingsPromptpayNumber={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsPromptpayNumber: v } })}
                settingsSaving={settingsSaving}
                settingsError={settingsError}
                settingsSuccess={settingsSuccess}
                settingsLogoInputRef={settingsLogoInputRef}
                displayMode={displayMode}
                settingsMembershipEnabled={settingsMembershipEnabled} setSettingsMembershipEnabled={setSettingsMembershipEnabled}
                settingsPointsPer10={settingsPointsPer10} setSettingsPointsPer10={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsPointsPer10: v } })}
                settingsRedemptionType={settingsRedemptionType} setSettingsRedemptionType={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsRedemptionType: v } })}
                settingsRedemptionRate={settingsRedemptionRate} setSettingsRedemptionRate={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsRedemptionRate: v } })}
                settingsRedemptionBahtPerPoint={settingsRedemptionBahtPerPoint} setSettingsRedemptionBahtPerPoint={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsRedemptionBahtPerPoint: v } })}
                settingsTierSilver={settingsTierSilver} setSettingsTierSilver={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsTierSilver: v } })}
                settingsTierGold={settingsTierGold} setSettingsTierGold={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsTierGold: v } })}
                settingsBirthdayBenefitType={settingsBirthdayBenefitType} setSettingsBirthdayBenefitType={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsBirthdayBenefitType: v } })}
                settingsBirthdayBenefitValue={settingsBirthdayBenefitValue} setSettingsBirthdayBenefitValue={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsBirthdayBenefitValue: v } })}
                settingsBirthdayAutoUsePoints={settingsBirthdayAutoUsePoints} setSettingsBirthdayAutoUsePoints={setSettingsBirthdayAutoUsePoints}
                settingsPrintEnabled={settingsPrintEnabled} setSettingsPrintEnabled={setSettingsPrintEnabled}
                settingsPrinterWidth={settingsPrinterWidth} setSettingsPrinterWidth={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsPrinterWidth: v } })}
                printerMode={printerMode} setPrinterMode={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { printerMode: v } })}
                printerNetIP={printerNetIP} setPrinterNetIP={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { printerNetIP: v } })}
                printerNetPort={printerNetPort} setPrinterNetPort={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { printerNetPort: v } })}
                promoPresets={promoPresets} setPromoPresets={setPromoPresets}
                promoCombos={promoCombos} setPromoCombos={setPromoCombos}
                promoLoading={promoLoading}
                promoError={promoError} setPromoError={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoError: v } })}
                promoFormId={promoFormId} setPromoFormId={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoFormId: v } })}
                promoFormName={promoFormName} setPromoFormName={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoFormName: v } })}
                promoFormType={promoFormType} setPromoFormType={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoFormType: v } })}
                promoFormValue={promoFormValue} setPromoFormValue={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoFormValue: v } })}
                promoFormColor={promoFormColor} setPromoFormColor={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoFormColor: v } })}
                promoFormActive={promoFormActive} setPromoFormActive={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoFormActive: v } })}
                promoSaving={promoSaving} setPromoSaving={(v) => dispatch({ type: 'PATCH_PROMO', payload: { promoSaving: v } })}
                comboFormId={comboFormId} setComboFormId={(v) => dispatch({ type: 'PATCH_PROMO', payload: { comboFormId: v } })}
                comboFormName={comboFormName} setComboFormName={(v) => dispatch({ type: 'PATCH_PROMO', payload: { comboFormName: v } })}
                comboFormPrice={comboFormPrice} setComboFormPrice={(v) => dispatch({ type: 'PATCH_PROMO', payload: { comboFormPrice: v } })}
                comboFormActive={comboFormActive} setComboFormActive={(v) => dispatch({ type: 'PATCH_PROMO', payload: { comboFormActive: v } })}
                comboFormItems={comboFormItems} setComboFormItems={setComboFormItems}
                comboSaving={comboSaving} setComboSaving={(v) => dispatch({ type: 'PATCH_PROMO', payload: { comboSaving: v } })}
                products={products}
                settingsPhone={settingsPhone} setSettingsPhone={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsPhone: v } })}
                settingsTaxId={settingsTaxId} setSettingsTaxId={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsTaxId: v } })}
                settingsAddress={settingsAddress} setSettingsAddress={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsAddress: v } })}
                settingsOpeningHours={settingsOpeningHours} setSettingsOpeningHours={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsOpeningHours: v } })}
                settingsWorkingDays={settingsWorkingDays} setSettingsWorkingDays={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsWorkingDays: v } })}
                settingsGoogleReviewUrl={settingsGoogleReviewUrl} setSettingsGoogleReviewUrl={(v) => dispatch({ type: 'PATCH_SETTINGS', payload: { settingsGoogleReviewUrl: v } })}
                saveSettings={saveSettings}
                saveDisplayMode={saveDisplayMode}
                saveLocalPrinterConfig={saveLocalPrinterConfig}
                handleLogoFileChange={handleLogoFileChange}
              />
            )}

            {/* ════ TAB: AUDIT LOG (owner/manager only) ════ */}
            {activeTab === 'audit' && shopId && (userRole === 'owner' || userRole === 'manager') && (
              <AuditTab shopId={shopId} />
            )}

            {/* ════ TAB: NOTIFICATIONS (owner/manager only) ════ */}
            {activeTab === 'notifications' && shopId && (userRole === 'owner' || userRole === 'manager') && (
              <NotificationsTab shopId={shopId} />
            )}

            <div className="page-admin__links">
              <Link href="/dashboard" className="page-admin__link">← แดชบอร์ด</Link>
              {/* ── POS link — อ่านสาขาล่าสุดจาก localStorage ── */}
              {(() => {
                if (!shopId) return <GoToPOSLink className="page-admin__link">🏪 POS</GoToPOSLink>;
                const shopNameEnc = encodeURIComponent(shops.find((shop) => shop.id === shopId)?.name ?? '');
                if (branches.length === 1) {
                  const b = branches[0];
                  return (
                    <Link
                      href={`/pos?shopId=${shopId}&shopName=${shopNameEnc}&branchId=${b.id}&branchName=${encodeURIComponent(b.name)}`}
                      className="page-admin__link"
                    >
                      🏪 POS
                    </Link>
                  );
                }
                return (
                  <Link
                    href={`/select-branch?shopId=${shopId}&shopName=${shopNameEnc}&posOnly=true`}
                    className="page-admin__link"
                  >
                    🏪 POS
                  </Link>
                );
              })()}
            </div>
          </>
        )}

      </div>

      <footer className="page-admin__footer">
        <a
          href="mailto:support@nexapos.io"
          className="page-admin__support-badge"
          title="ติดต่อฝ่ายสนับสนุน"
        >
          support@nexapos.io
        </a>
      </footer>

    </main>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={
      <main className="page-admin">
        <div className="page-admin__header-wrap"><AuthHeader title="จัดการร้าน" /></div>
        <div className="page-admin__content">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    }>
      <AdminPageInner />
    </Suspense>
  );
}
