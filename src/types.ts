export type Page = 'home' | 'baby-prints' | 'parties' | 'pricing' | 'food-drink' | 'faqs' | 'gallery' | 'contact' | 'contact-info' | 'admin' | 'putney' | 'wimbledon' | 'book' | 'buy-gift-card' | 'gift-card-success' | 'gift-card-balance' | 'party-birthday-putney' | 'party-birthday-wimbledon' | 'party-babyshower-putney' | 'party-babyshower-wimbledon' | 'party-corporate-putney' | 'party-corporate-wimbledon' | 'baby-prints-book' | 'party-birthday-detail' | 'party-babyshower-detail' | 'price-list' | 'pottery-painting' | 'sip-and-paint' | 'not-found' | 'party-payment' | 'party-payment-success' | 'manage-booking' | 'privacy-policy' | 'terms-of-service' | 'cookie-policy';

export interface PotteryItem {
  id: string;
  name: string;
  price: string;
  basePrice: number;
  category: 'tableware' | 'decor' | 'kids' | 'seasonal';
  description?: string;
  isPartyEligible?: boolean;
  imageUrls?: string[];
}

export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: 'fees' | 'bookings' | 'fittings' | 'creativity' | 'policies';
}

export interface BookingInquiry {
  id: string;
  studio: 'Putney' | 'Wimbledon';
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  paintersCount: number;
  sessionType: 'painting' | 'birthday-party' | 'baby-shower-hen' | 'clay-imprints' | 'corporate' | 'exclusive-hire' | 'sip-and-paint';
  notes?: string;
  staffNotes?: string;
  status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
  requestDate: string;
  estimatedPrice?: number;
  source?: 'online' | 'walk-in' | 'block';
  giftCardCode?: string;
  giftCardDiscount?: number;
  finalPrice?: number;
  tableId?: string;
  resources?: Array<{ table_id?: string; table_configuration_id?: string; configuration_name?: string; blocked_start?: string; blocked_end?: string }>;
  depositAmount?: number;
  finalSeats?: number;
  finalBalance?: number;
  paymentLinkUrl?: string;
  paymentLinkSentAt?: string;
  paymentStatus?: 'pending' | 'paid' | 'refunded';
  stripePaymentIntentId?: string;
  depositPaidAt?: string;
  finalPaidAt?: string;
  sendDepositLink?: boolean;
  managementToken?: string;
  createdAt?: string;
  photos?: string[];
  photoTags?: Record<number, { label?: string; status: string; x: number; y: number }[]>;
  collectionStatus?: 'painted' | 'ready' | 'collected';
  paintedFlag?: 'rush' | 'return_to_finish' | null;
  readyAt?: string;
  collectedAt?: string;
}

export interface GalleryItem {
  id: string;
  imageUrl: string;
  title: string;
  category: 'creation' | 'studio' | 'party' | 'imprint';
  caption: string;
}

export interface GiftCard {
  id: string;
  code: string;
  amount: number;
  balance: number;
  covers?: string;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  senderEmail?: string;
  message?: string;
  purchaseDate: string;
  expiryDate?: string;
  status: 'active' | 'redeemed' | 'expired' | 'cancelled' | 'disabled';
}

export interface Staff {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: 'super_admin' | 'staff';
  canUpdateStatus: boolean;
  canEditBookings: boolean;
  canAddWalkIns: boolean;
  canDeleteBookings: boolean;
  canEposRefunds?: boolean;
  canEposDiscounts?: boolean;
  canEposManageProducts?: boolean;
  allowedStudios?: ('Putney' | 'Wimbledon')[];
  sessionToken?: string;
  sessionExpiresAt?: string;
  createdAt: string;
}

export type StaffRole = Staff['role'];

export interface AuditLog {
  id: string;
  username: string;
  action: string;
  entity: string;
  entity_id?: string;
  details?: unknown;
  created_at: string;
}

export interface GiftCardApiRow {
  id: string;
  code: string;
  amount: number;
  balance: number;
  covers?: string;
  recipient_name?: string;
  recipient_email?: string;
  sender_name?: string;
  sender_email?: string;
  message?: string;
  purchase_date?: string;
  expiry_date?: string;
  status: 'active' | 'redeemed' | 'expired' | 'cancelled' | 'disabled';
}

export interface StaffApiRow {
  id: string;
  name: string;
  username: string;
  role: 'super_admin' | 'staff';
  can_update_status: boolean;
  can_edit_bookings: boolean;
  can_add_walk_ins: boolean;
  can_delete_bookings: boolean;
  can_epos_refunds?: boolean;
  can_epos_discounts?: boolean;
  can_epos_manage_products?: boolean;
  allowed_studios?: ('Putney' | 'Wimbledon')[];
  created_at: string;
}

export type NotificationType =
  | 'booking_new'
  | 'booking_cancelled'
  | 'booking_status_changed'
  | 'booking_walk_in'
  | 'booking_failed'
  | 'gift_card_purchased'
  | 'gift_card_redeemed'
  | 'collection_ready'
  | 'staff_action'
  | 'epos_refund';

// ---------- EPOS ----------
export type EposStudio = 'Putney' | 'Wimbledon';
export type EposVatTreatment = 'standard' | 'reduced' | 'zero' | 'exempt';
export type EposPaymentMethod = 'cash' | 'card' | 'voucher' | 'other';
export type EposOrderStatus = 'open' | 'partial' | 'paid' | 'void';

export interface EposCategory {
  id: string;
  name: string;
  slug: string;
  color: string;
  sort_order: number;
  active: boolean;
}

export interface EposProduct {
  id: string;
  category_id: string | null;
  name: string;
  sku: string | null;
  price: number;
  vat_treatment: EposVatTreatment;
  vat_rate: number;
  image_url: string | null;
  studios: EposStudio[];
  active: boolean;
  sort_order: number;
}

export interface EposDiscount {
  id: string;
  name: string;
  kind: 'percent' | 'fixed';
  value: number;
  active: boolean;
  sort_order: number;
}

export interface EposOrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  vat_treatment: EposVatTreatment;
  vat_rate: number;
  line_total: number;
}

export interface EposPayment {
  id: string;
  order_id: string;
  method: EposPaymentMethod;
  provider: string;
  amount: number;
  status: 'completed' | 'pending' | 'failed' | 'partially_refunded' | 'refunded';
  reference: string | null;
  gift_card_id: string | null;
  change_given: number | null;
  refunded_amount: number;
  staff_name: string | null;
  created_at: string;
}

export interface EposOrder {
  id: string;
  order_number: string;
  studio: EposStudio;
  table_id: string | null;
  booking_id: string | null;
  customer_name: string | null;
  label: string | null;
  staff_name: string | null;
  status: EposOrderStatus;
  subtotal: number;
  discount_total: number;
  vat_total: number;
  total: number;
  paid_total: number;
  discount_label: string | null;
  notes: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface EposTable {
  table_id: string;
  label: string;
  area: string;
  max_capacity: number;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  entity_type?: string;
  entity_id?: string;
  studio?: string;
  read_at?: string | null;
  created_at: string;
}

export interface NotificationSetting {
  id: string;
  type: NotificationType;
  enabled: boolean;
  studio: string;  // 'All', 'Putney', 'Wimbledon'
  custom_title?: string | null;
  custom_message?: string | null;
  updated_at?: string;
}

export interface EmailTemplate {
  id: string;
  template_key: string;
  name: string;
  subject: string;
  html_content: string;
  available_variables?: string[];
  updated_at: string;
  _editSubject?: string;
  _editHtml?: string;
}

export interface SMSTemplate {
  id: string;
  template_key: string;
  name: string;
  body: string;
  available_variables: string[];
  updated_at: string;
}

export interface EmailLog {
  id: string;
  created_at: string;
  email_type: string;
  recipient: string;
  subject: string;
  status: string;
  booking_id: string | null;
  error: string | null;
  body?: string | null;
  error_code?: number | null;
  error_message?: string | null;
}
