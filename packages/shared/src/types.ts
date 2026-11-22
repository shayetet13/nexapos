export type CustomerId = string & { readonly brand: unique symbol };
export type ShopId = string & { readonly brand: unique symbol };
export type BranchId = string & { readonly brand: unique symbol };
export type UserId = string & { readonly brand: unique symbol };
export type ProductId = string & { readonly brand: unique symbol };
export type OrderId = string & { readonly brand: unique symbol };

export type Role = 'owner' | 'manager' | 'cashier' | 'viewer';
export type OrderStatus = 'pending' | 'paid' | 'void' | 'refunded';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other';

export interface Shop {
  id: ShopId;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface Branch {
  id: BranchId;
  shop_id: ShopId;
  name: string;
  address?: string;
  created_at: Date;
  updated_at: Date;
}

export interface User {
  id:         UserId;
  email:      string;
  is_staff:   boolean;
  created_at: Date;
  updated_at: Date;
}

/** พนักงานที่สร้างด้วย nickname+PIN (ไม่มี email จริง) */
export interface StaffMember {
  user_id:    UserId;
  shop_id:    ShopId;
  nickname:   string;
  role:       Exclude<Role, 'owner'>;
  branch_id?: BranchId;
  created_at: Date;
}

export interface Product {
  id: ProductId;
  shop_id: ShopId;
  name: string;
  sku?: string;
  price: number;
  created_at: Date;
  updated_at: Date;
}

export interface BranchStock {
  branch_id: BranchId;
  product_id: ProductId;
  quantity: number;
  updated_at: Date;
}

export interface Order {
  id: OrderId;
  shop_id: ShopId;
  branch_id: BranchId;
  user_id: UserId;
  status: OrderStatus;
  total: number;
  payment_method?: PaymentMethod;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItem {
  id: string;
  order_id: OrderId;
  product_id: ProductId;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export type CustomerTier = 'bronze' | 'silver' | 'gold';

export interface Customer {
  id:          CustomerId;
  shop_id:     ShopId;
  name:        string;
  phone?:      string;
  email?:      string;
  birthday?:   string; // YYYY-MM-DD
  points:      number;
  total_spent: number;
  tier:        CustomerTier;
  notes?:      string;
  created_at:  Date;
  updated_at:  Date;
}

export interface MembershipConfig {
  enabled?:                    boolean;
  points_per_10_baht?:         number;
  redemption_rate?:           number;
  redemption_type?:           'points_per_10_baht' | 'baht_per_point';
  redemption_baht_per_point?:  number;
  tier_silver?:               number;
  tier_gold?:                 number;
  birthday_benefit_type?:     'percent' | 'fixed';
  birthday_benefit_value?:    number;
  birthday_auto_use_points?:  boolean;
}

export interface Log {
  id: string;
  shop_id: ShopId;
  action: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  user_id?: UserId;
  created_at: Date;
}

export interface Event {
  id: string;
  shop_id: ShopId;
  branch_id?: BranchId;
  type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}
