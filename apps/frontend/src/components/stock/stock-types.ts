export interface Shop    { id: string; name: string; role?: string; }
export interface Branch  { id: string; name: string; }
export interface Product { id: string; name: string; sku: string | null; unit: string; category: string | null; image_url: string | null; }
export interface AllStockRow {
  product_id: string; product_name: string; sku: string | null;
  unit: string; category: string | null; image_url: string | null;
  show_on_pos: boolean;
  branch_id: string; branch_name: string; quantity: number; min_qty: number;
  updated_at: string | null;
}
export interface StockTxRow {
  id: string; branch_id: string; branch_name: string;
  product_id: string; product_name: string; sku: string | null; unit: string;
  type: string; qty_before: number; qty_change: number; qty_after: number;
  note: string | null; created_at: string;
}
export interface ShopUnit { id: string; name: string; }
export interface ProductStock {
  product_id: string; product_name: string; sku: string | null;
  unit: string; category: string | null; image_url: string | null;
  show_on_pos: boolean;
  branches: Array<{ branch_id: string; branch_name: string; quantity: number; min_qty: number; updated_at: string | null }>;
  totalQty: number; isLow: boolean; isWarn: boolean;
}
export const TX_LABELS: Record<string, string> = {
  manual_set: 'ตั้งค่า', manual_add: 'เพิ่ม', sale_deduct: 'ขาย', adjustment: 'ปรับปรุง',
  transfer_out: 'โอนออก', transfer_in: 'โอนเข้า',
};
