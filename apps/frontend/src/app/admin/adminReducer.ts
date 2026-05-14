// adminReducer.ts — centralised state for AdminPageInner
// All types are defined here to avoid circular imports with page.tsx

// ── Domain types ───────────────────────────────────────────────
export interface Shop {
  id: string; name: string; role?: string;
  shop_code?: string | null;
  province?: string | null;
  district?: string | null;
  postal_code?: string | null;
  shop_mode?: 'retail' | 'full_service_restaurant';
}
export interface Branch { id: string; name: string; address?: string | null; is_active: boolean; created_at: string; }
export interface Product {
  id: string; name: string; sku: string | null; price: string; image_url: string | null;
  category: string | null; unit: string; cost_price: string | null; barcode: string | null;
  show_on_pos: boolean;
}
export interface StockRow { branch_id: string; branch_name: string; quantity: number; min_qty: number; }
export interface AllStockRow {
  product_id: string; product_name: string; sku: string | null;
  unit: string; category: string | null; image_url: string | null;
  branch_id: string; branch_name: string; quantity: number; min_qty: number;
  updated_at: string | null;
}
export interface ShopUnit { id: string; name: string; }
export interface StockTxRow {
  id: string; branch_id: string; branch_name: string;
  product_id: string; product_name: string; sku: string | null; unit: string;
  type: string; qty_before: number; qty_change: number; qty_after: number;
  note: string | null; created_at: string;
}
export type OrderStatus = 'pending' | 'paid' | 'void' | 'refunded';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other';
export interface Order {
  id: string;
  order_number?: number;
  daily_seq?: number;
  branch_name: string;
  user_email: string;
  status: OrderStatus;
  total: string;
  payment_method: PaymentMethod | null;
  created_at: string;
  ref_code?: string | null;
  receipt_token?: string | null;
}
export interface OrderDetailItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
}
export interface OrderDetail {
  id: string;
  order_number: number;
  daily_seq: number;
  status: OrderStatus;
  total: string;
  payment_method: PaymentMethod | null;
  created_at: string;
  branch_id: string;
  branch_name: string;
  items: OrderDetailItem[];
}
export interface ShopUser { user_id: string; email: string; role: string; branch_id: string | null; }
export interface Member {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  points: number;
  total_spent: string;
  tier: string;
  notes: string | null;
  created_at: string;
}
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
export interface MonthlyStats {
  revenue: number;
  orderCount: number;
  cogs: number;
  grossProfit: number;
}

// ── Domain state shapes ────────────────────────────────────────
export interface GlobalState {
  shops: Shop[];
  shopId: string | null;
  userRole: string | null;
  branches: Branch[];
  loading: boolean;
  error: string | null;
}

export interface ProductsState {
  products: Product[];
  formOpen: boolean;
  editingId: string | null;
  formName: string;
  formSku: string;
  formPrice: string;
  formCostPrice: string;
  formUnit: string;
  formCategory: string;
  formBarcode: string;
  formImageUrl: string | null;
  formImageFile: File | null;
  formImagePreview: string | null;
  uploadError: string | null;
  saving: boolean;
  stockByProduct: Record<string, StockRow[]>;
  stockEdit: { productId: string; branchId: string; quantity: string } | null;
}

export interface StockState {
  allStock: AllStockRow[];
  stockLoading: boolean;
  stockSearch: string;
  stockBranchFilter: string;
  stockEditModal: AllStockRow | null;
  stockEditQty: string;
  stockEditMin: string;
  stockEditMode: 'set' | 'add' | 'remove';
  stockSaving: boolean;
  stockSubView: 'list' | 'history';
  stockHistory: StockTxRow[];
  histLoading: boolean;
  histFromDate: string;
  histToDate: string;
  histBranchFilter: string;
  addStockOpen: boolean;
  addStockProductId: string;
  addStockBranchId: string;
  addStockQty: string;
  addStockMin: string;
  addStockSaving: boolean;
  addStockError: string | null;
  shopUnits: ShopUnit[];
  newUnitName: string;
  unitSaving: boolean;
}

export interface PromoState {
  promoPresets: PromotionPreset[];
  promoCombos: ComboDef[];
  promoLoading: boolean;
  promoError: string | null;
  promoFormId: string | null;
  promoFormName: string;
  promoFormType: PromoType;
  promoFormValue: number;
  promoFormColor: string;
  promoFormActive: boolean;
  promoSaving: boolean;
  comboFormId: string | null;
  comboFormName: string;
  comboFormPrice: number;
  comboFormActive: boolean;
  comboFormItems: Array<{ id: string; quantity: number }>;
  comboSaving: boolean;
}

export interface OrdersState {
  orders: Order[];
  ordersLoading: boolean;
  ordersError: string | null;
  orderDetailOpen: boolean;
  orderDetail: OrderDetail | null;
  orderDetailLoading: boolean;
  currentPage: number;
  totalOrders: number;
  filterStatus: OrderStatus | 'all';
  searchSeq: string;
  searchDate: string;
  searchRef: string;
  monthlyStats: MonthlyStats | null;
  monthlyStatsLoading: boolean;
}

export interface StaffItem {
  user_id: string;
  nickname: string;
  role: 'manager' | 'cashier' | 'viewer';
  branch_id: string | null;
  created_at: string;
}

export interface UsersState {
  shopUsers: ShopUser[];
  usersLoading: boolean;
  inviteEmail: string;
  invitePassword: string;
  inviteRole: 'manager' | 'cashier' | 'viewer';
  inviteBranchId: string;
  inviteError: string | null;
  inviteSuccess: string | null;
  inviteCreated: { email: string; password: string } | null;
  inviting: boolean;
  editUserModal: ShopUser | null;
  editRole: 'manager' | 'cashier' | 'viewer';
  editBranchId: string;
  editSaving: boolean;
  // Staff (nickname + PIN) state
  staffList: StaffItem[];
  staffLoading: boolean;
  staffNickname: string;
  staffPin: string;
  staffRole: 'manager' | 'cashier' | 'viewer';
  staffBranchId: string;
  staffError: string | null;
  staffSuccess: string | null;
  staffCreating: boolean;
  editStaffModal: StaffItem | null;
  editStaffNickname: string;
  editStaffPin: string;
  editStaffRole: 'manager' | 'cashier' | 'viewer';
  editStaffBranchId: string;
  editStaffSaving: boolean;
  editStaffError: string | null;
}

export interface MembersState {
  members: Member[];
  membersLoading: boolean;
  membersSearch: string;
  membersPage: number;
  memberEdit: Member | null;
  memberForm: { name: string; phone: string; email: string; birthday: string; notes: string };
  memberSaving: boolean;
  memberError: string | null;
}

export interface SettingsState {
  settingsName: string;
  settingsLogoUrl: string | null;
  settingsLogoFile: File | null;
  settingsLogoPreview: string | null;
  settingsLogoUploadError: string | null;
  settingsVatEnabled: boolean;
  settingsOwnerFirstname: string;
  settingsOwnerLastname: string;
  settingsPromptpayType: 'phone' | 'id_card';
  settingsPromptpayNumber: string;
  settingsSaving: boolean;
  settingsError: string | null;
  settingsSuccess: string | null;
  displayMode: 'browser' | 'monitor';
  settingsMembershipEnabled: boolean;
  settingsPointsPer10: number;
  settingsRedemptionType: 'points_per_10_baht' | 'baht_per_point';
  settingsRedemptionRate: number;
  settingsRedemptionBahtPerPoint: number;
  settingsTierSilver: number;
  settingsTierGold: number;
  settingsBirthdayBenefitType: 'percent' | 'fixed';
  settingsBirthdayBenefitValue: number;
  settingsBirthdayAutoUsePoints: boolean;
  settingsPrintEnabled: boolean;
  settingsPrinterWidth: 32 | 48;
  printerMode: 'bluetooth' | 'usb' | 'network' | 'browser';
  printerNetIP: string;
  printerNetPort: string;
  printerCodePage: number;
  genProvince: string;
  genDistrict: string;
  genSaving: boolean;
  codeCopied: boolean;
  settingsPhone: string;
  settingsTaxId: string;
  settingsAddress: string;
  settingsOpeningHours: string;
  settingsWorkingDays: string;
  settingsGoogleReviewUrl: string;
}

export interface AdminState {
  global: GlobalState;
  products: ProductsState;
  stock: StockState;
  promo: PromoState;
  orders: OrdersState;
  users: UsersState;
  members: MembersState;
  settings: SettingsState;
}

// ── Actions ────────────────────────────────────────────────────
export type AdminAction =
  | { type: 'PATCH_GLOBAL';   payload: Partial<GlobalState>   }
  | { type: 'PATCH_PRODUCTS'; payload: Partial<ProductsState> }
  | { type: 'PATCH_STOCK';    payload: Partial<StockState>    }
  | { type: 'PATCH_PROMO';    payload: Partial<PromoState>    }
  | { type: 'PATCH_ORDERS';   payload: Partial<OrdersState>   }
  | { type: 'PATCH_USERS';    payload: Partial<UsersState>    }
  | { type: 'PATCH_MEMBERS';  payload: Partial<MembersState>  }
  | { type: 'PATCH_SETTINGS'; payload: Partial<SettingsState> };

// ── Reducer ────────────────────────────────────────────────────
export function adminReducer(state: AdminState, action: AdminAction): AdminState {
  switch (action.type) {
    case 'PATCH_GLOBAL':   return { ...state, global:   { ...state.global,   ...action.payload } };
    case 'PATCH_PRODUCTS': return { ...state, products: { ...state.products, ...action.payload } };
    case 'PATCH_STOCK':    return { ...state, stock:    { ...state.stock,    ...action.payload } };
    case 'PATCH_PROMO':    return { ...state, promo:    { ...state.promo,    ...action.payload } };
    case 'PATCH_ORDERS':   return { ...state, orders:   { ...state.orders,   ...action.payload } };
    case 'PATCH_USERS':    return { ...state, users:    { ...state.users,    ...action.payload } };
    case 'PATCH_MEMBERS':  return { ...state, members:  { ...state.members,  ...action.payload } };
    case 'PATCH_SETTINGS': return { ...state, settings: { ...state.settings, ...action.payload } };
    default: return state;
  }
}

// ── Initial state ──────────────────────────────────────────────
export const initialAdminState: AdminState = {
  global: {
    shops: [], shopId: null, userRole: null, branches: [],
    loading: true, error: null,
  },
  products: {
    products: [], formOpen: false, editingId: null,
    formName: '', formSku: '', formPrice: '', formCostPrice: '',
    formUnit: 'อัน', formCategory: '', formBarcode: '',
    formImageUrl: null, formImageFile: null, formImagePreview: null,
    uploadError: null, saving: false,
    stockByProduct: {}, stockEdit: null,
  },
  stock: {
    allStock: [], stockLoading: false,
    stockSearch: '', stockBranchFilter: '', stockEditModal: null,
    stockEditQty: '', stockEditMin: '', stockEditMode: 'set', stockSaving: false,
    stockSubView: 'list', stockHistory: [], histLoading: false,
    histFromDate: '', histToDate: '', histBranchFilter: '',
    addStockOpen: false, addStockProductId: '', addStockBranchId: '',
    addStockQty: '0', addStockMin: '5', addStockSaving: false, addStockError: null,
    shopUnits: [], newUnitName: '', unitSaving: false,
  },
  promo: {
    promoPresets: [], promoCombos: [], promoLoading: false, promoError: null,
    promoFormId: null, promoFormName: '', promoFormType: 'percent',
    promoFormValue: 0, promoFormColor: '', promoFormActive: true, promoSaving: false,
    comboFormId: null, comboFormName: '', comboFormPrice: 0, comboFormActive: true,
    comboFormItems: [], comboSaving: false,
  },
  orders: {
    orders: [], ordersLoading: false, ordersError: null,
    orderDetailOpen: false, orderDetail: null, orderDetailLoading: false,
    currentPage: 1, totalOrders: 0, filterStatus: 'all', searchSeq: '', searchDate: '', searchRef: '',
    monthlyStats: null, monthlyStatsLoading: false,
  },
  users: {
    shopUsers: [], usersLoading: false,
    inviteEmail: '', invitePassword: '', inviteRole: 'cashier', inviteBranchId: '',
    inviteError: null, inviteSuccess: null, inviteCreated: null, inviting: false,
    editUserModal: null, editRole: 'cashier', editBranchId: '', editSaving: false,
    staffList: [], staffLoading: false,
    staffNickname: '', staffPin: '', staffRole: 'cashier', staffBranchId: '',
    staffError: null, staffSuccess: null, staffCreating: false,
    editStaffModal: null, editStaffNickname: '', editStaffPin: '',
    editStaffRole: 'cashier', editStaffBranchId: '',
    editStaffSaving: false, editStaffError: null,
  },
  members: {
    members: [], membersLoading: false, membersSearch: '',
    membersPage: 1, memberEdit: null,
    memberForm: { name: '', phone: '', email: '', birthday: '', notes: '' },
    memberSaving: false, memberError: null,
  },
  settings: {
    settingsName: '', settingsLogoUrl: null, settingsLogoFile: null,
    settingsLogoPreview: null, settingsLogoUploadError: null, settingsVatEnabled: true,
    settingsOwnerFirstname: '', settingsOwnerLastname: '',
    settingsPromptpayType: 'phone', settingsPromptpayNumber: '',
    settingsSaving: false, settingsError: null, settingsSuccess: null,
    displayMode: 'browser', settingsMembershipEnabled: true,
    settingsPointsPer10: 10, settingsRedemptionType: 'points_per_10_baht',
    settingsRedemptionRate: 100, settingsRedemptionBahtPerPoint: 0.1,
    settingsTierSilver: 1000, settingsTierGold: 5000,
    settingsBirthdayBenefitType: 'percent', settingsBirthdayBenefitValue: 0,
    settingsBirthdayAutoUsePoints: true, settingsPrintEnabled: false,
    settingsPrinterWidth: 48, printerMode: 'browser', printerNetIP: '',
    printerNetPort: '9100', printerCodePage: 20, genProvince: '', genDistrict: '', genSaving: false,
    codeCopied: false,
    settingsPhone: '', settingsTaxId: '', settingsAddress: '',
    settingsOpeningHours: '', settingsWorkingDays: '', settingsGoogleReviewUrl: '',
  },
};
