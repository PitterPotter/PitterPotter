import type {
  Staff, EposCategory, EposProduct, EposDiscount, EposOrder,
  EposOrderItem, EposPayment, EposTable, EposStudio, EposPaymentMethod,
} from '../types';

const functionUrl = (name: string) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

type StaffAuth = Pick<Staff, 'username' | 'sessionToken'>;

async function callEpos<T>(staff: StaffAuth, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(functionUrl('epos'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action, username: staff.username, sessionToken: staff.sessionToken, ...extra }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `EPOS request failed (${response.status})`);
  }
  return data as T;
}

export interface EposBootstrap {
  categories: EposCategory[];
  products: EposProduct[];
  discounts: EposDiscount[];
  stock: Record<string, { quantity: number; min_stock: number }>;
  cardProvider: 'mock' | 'dojo';
}

export const eposBootstrap = (staff: StaffAuth, studio: EposStudio) =>
  callEpos<EposBootstrap>(staff, 'bootstrap', { studio });

export const eposListTables = (staff: StaffAuth, studio: EposStudio) =>
  callEpos<{ tables: EposTable[] }>(staff, 'listTables', { studio });

export const eposOpenOrders = (staff: StaffAuth, studio: EposStudio, tableId?: string) =>
  callEpos<{ orders: EposOrder[] }>(staff, 'openOrders', { studio, ...(tableId ? { tableId } : {}) });

export const eposCreateOrder = (staff: StaffAuth, args: {
  studio: EposStudio; tableId?: string; bookingId?: string; customerName?: string; label?: string;
}) => callEpos<{ order: EposOrder }>(staff, 'createOrder', args);

export const eposGetOrder = (staff: StaffAuth, orderId: string) =>
  callEpos<{ order: EposOrder; items: EposOrderItem[]; payments: EposPayment[] }>(staff, 'getOrder', { orderId });

export const eposAddItem = (staff: StaffAuth, orderId: string, args: {
  productId?: string; quantity?: number; customName?: string; customPrice?: number; customVatTreatment?: string;
}) => callEpos<{ item: EposOrderItem; order: EposOrder }>(staff, 'addItem', { orderId, ...args });

export const eposUpdateItemQty = (staff: StaffAuth, itemId: string, quantity: number) =>
  callEpos<{ order: EposOrder }>(staff, 'updateItemQty', { itemId, quantity });

export const eposRemoveItem = (staff: StaffAuth, itemId: string) =>
  callEpos<{ order: EposOrder }>(staff, 'removeItem', { itemId });

export const eposApplyDiscount = (staff: StaffAuth, orderId: string, args: {
  discountId?: string; kind?: 'percent' | 'fixed'; value?: number; label?: string;
}) => callEpos<{ order: EposOrder }>(staff, 'applyDiscount', { orderId, ...args });

export const eposRemoveDiscount = (staff: StaffAuth, orderId: string) =>
  callEpos<{ order: EposOrder }>(staff, 'removeDiscount', { orderId });

export const eposPay = (staff: StaffAuth, orderId: string, args: {
  method: EposPaymentMethod; amount: number; idempotencyKey: string;
  tendered?: number; voucherCode?: string;
}) => callEpos<{ payment: EposPayment; order: EposOrder; duplicate?: boolean }>(staff, 'pay', { orderId, ...args });

export const eposCheckPayment = (staff: StaffAuth, paymentId: string) =>
  callEpos<{ payment: EposPayment }>(staff, 'checkPayment', { paymentId });

export const eposVoidOrder = (staff: StaffAuth, orderId: string, reason?: string) =>
  callEpos<{ success: boolean }>(staff, 'voidOrder', { orderId, reason });

export const eposRefundPayment = (staff: StaffAuth, paymentId: string, amount?: number) =>
  callEpos<{ success: boolean; refunded: number; order: EposOrder }>(staff, 'refundPayment', { paymentId, amount });

export const eposLinkBooking = (staff: StaffAuth, orderId: string, bookingId: string) =>
  callEpos<{ success: boolean }>(staff, 'linkBooking', { orderId, bookingId });

export const eposLinkTable = (staff: StaffAuth, orderId: string, tableId: string | null) =>
  callEpos<{ success: boolean }>(staff, 'linkTable', { orderId, tableId });

export const eposRenameOrder = (staff: StaffAuth, orderId: string, label: string, customerName?: string) =>
  callEpos<{ success: boolean }>(staff, 'renameOrder', { orderId, label, customerName });

// ---------- Admin ----------
export const eposListProductsAdmin = (staff: StaffAuth) =>
  callEpos<{ categories: EposCategory[]; products: EposProduct[]; discounts: EposDiscount[] }>(staff, 'listProductsAdmin');

export interface EposProductInput {
  id?: string; name: string; sku?: string; categoryId?: string | null;
  price: number; vatTreatment?: string; vatRate?: number; imageUrl?: string;
  studios?: EposStudio[]; active?: boolean; sortOrder?: number;
}
export const eposSaveProduct = (staff: StaffAuth, product: EposProductInput) =>
  callEpos<{ product: EposProduct }>(staff, 'saveProduct', { product });

export const eposDeleteProduct = (staff: StaffAuth, productId: string) =>
  callEpos<{ success: boolean; deactivated?: boolean }>(staff, 'deleteProduct', { productId });

export const eposSaveCategory = (staff: StaffAuth, category: {
  id?: string; name: string; color?: string; sortOrder?: number; active?: boolean;
}) => callEpos<{ category: EposCategory }>(staff, 'saveCategory', { category });

export const eposDeleteCategory = (staff: StaffAuth, categoryId: string) =>
  callEpos<{ success: boolean }>(staff, 'deleteCategory', { categoryId });

export const eposSaveDiscount = (staff: StaffAuth, discount: {
  id?: string; name: string; kind: 'percent' | 'fixed'; value: number; active?: boolean; sortOrder?: number;
}) => callEpos<{ discount: EposDiscount }>(staff, 'saveDiscount', { discount });

export const eposExportProductsCsv = async (staff: StaffAuth): Promise<string> => {
  const response = await fetch(functionUrl('epos'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action: 'exportProducts', username: staff.username, sessionToken: staff.sessionToken }),
  });
  if (!response.ok) throw new Error('Export failed');
  return response.text();
};

export const eposImportProducts = (staff: StaffAuth, csv: string) =>
  callEpos<{ success: boolean; imported: number }>(staff, 'importProducts', { csv });

// ---------- Receipts & reports ----------
export interface EposReceipt {
  order: EposOrder;
  items: EposOrderItem[];
  payments: EposPayment[];
  studio: { address: string; phone: string } | null;
  vatNumber: string;
  html: string;
}
export const eposGetReceipt = (staff: StaffAuth, orderId: string) =>
  callEpos<EposReceipt>(staff, 'getReceipt', { orderId });

export const eposEmailReceipt = (staff: StaffAuth, orderId: string, email: string) =>
  callEpos<{ success: boolean }>(staff, 'emailReceipt', { orderId, email });

export interface EposSalesReport {
  orders: number;
  gross: number;
  vat: number;
  discounts: number;
  refunds: number;
  outstanding: number;
  byStudio: Record<string, number>;
  byMethod: Record<string, number>;
  byCategory: Record<string, number>;
  byVatRate: Record<string, { net: number; vat: number; gross: number }>;
  byDay: Record<string, number>;
  rawOrders: EposOrder[];
}
export const eposSalesReport = (staff: StaffAuth, args: { studio?: string; from?: string; to?: string }) =>
  callEpos<EposSalesReport>(staff, 'salesReport', args);

// ---------- Stock & inventory ----------
export interface StockStudioInfo {
  quantity: number;
  min_stock: number;
  reorder_qty: number;
  qty_sold: number;
  revenue: number;
  low: boolean;
}
export interface StockRow {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  image_url: string | null;
  category_id: string | null;
  category: string;
  track_stock: boolean;
  studios: Record<string, StockStudioInfo>;
}
export const eposStockOverview = (staff: StaffAuth, studio: string) =>
  callEpos<{ rows: StockRow[]; studios: string[] }>(staff, 'stockOverview', { studio });

export const eposStockSetLevels = (staff: StaffAuth, args: {
  productId: string; studio: string; minStock?: number; reorderQty?: number; trackStock?: boolean;
}) => callEpos<{ stock: { quantity: number; min_stock: number; reorder_qty: number } }>(staff, 'stockSetLevels', args);

export const eposStockReceive = (staff: StaffAuth, args: {
  studio: string; items: { productId: string; qty: number }[]; note?: string;
}) => callEpos<{ receiptId: string }>(staff, 'stockReceive', args);

export const eposStockAdjust = (staff: StaffAuth, args: {
  studio: string; productId: string; changeQty: number; reason: string;
}) => callEpos<{ quantity: number }>(staff, 'stockAdjust', args);

export const eposStockTransfer = (staff: StaffAuth, args: {
  productId: string; fromStudio: string; toStudio: string; qty: number; note?: string;
}) => callEpos<{ transferId: string }>(staff, 'stockTransfer', args);

export interface StockMovement {
  id: string;
  product_id: string;
  studio: string;
  change_qty: number;
  type: 'sale' | 'receive' | 'transfer_out' | 'transfer_in' | 'adjust' | 'stocktake';
  reason: string | null;
  order_id: string | null;
  staff_name: string | null;
  quantity_after: number;
  created_at: string;
  epos_products?: { name: string } | null;
}
export const eposStockMovements = (staff: StaffAuth, args: {
  studio?: string; productId?: string; type?: string; from?: string; to?: string; limit?: number;
}) => callEpos<{ movements: StockMovement[] }>(staff, 'stockMovements', args);

export interface ReorderRow {
  product_id: string;
  studio: string;
  quantity: number;
  min_stock: number;
  reorder_qty: number;
  epos_products: { name: string; sku: string | null; price: number; active: boolean; track_stock: boolean; category_id: string | null } | null;
}
export const eposStockReorderList = (staff: StaffAuth, studio: string) =>
  callEpos<{ reorder: ReorderRow[] }>(staff, 'stockReorderList', { studio });

export const eposStocktakeSubmit = (staff: StaffAuth, args: {
  studio: string; counts: { productId: string; counted: number }[]; note?: string;
}) => callEpos<{ stocktakeId: string; lines: number; differences: number }>(staff, 'stocktakeSubmit', args);

export interface StocktakeItem {
  id: string;
  product_id: string;
  expected_qty: number;
  counted_qty: number;
  difference: number;
  epos_products?: { name: string } | null;
}
export interface Stocktake {
  id: string;
  studio: string;
  note: string | null;
  staff_name: string | null;
  created_at: string;
  epos_stocktake_items?: StocktakeItem[];
}
export const eposStocktakeList = (staff: StaffAuth, studio?: string) =>
  callEpos<{ stocktakes: Stocktake[] }>(staff, 'stocktakeList', { studio: studio || 'all' });

export interface StockReportRow {
  product_id: string;
  name: string;
  category: string;
  qty_sold: number;
  revenue: number;
  by_studio: Record<string, { qty: number; revenue: number }>;
  received: number;
  breakages: number;
  adjustments: number;
  transfers_in: number;
  transfers_out: number;
  stocktake: number;
}
export const eposStockReport = (staff: StaffAuth, args: {
  studio?: string; from?: string; to?: string; categoryId?: string; productId?: string;
}) => callEpos<{ products: StockReportRow[]; byStudio: Record<string, { qty: number; revenue: number }> }>(staff, 'stockReport', args);
