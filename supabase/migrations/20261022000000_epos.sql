-- EPOS (Electronic Point of Sale) schema for Pitter Potter.
-- All tables are service-role only — access is exclusively through the
-- `epos` edge function, which enforces auth + permissions.

-- Staff EPOS permissions. Follows the existing can_* pattern:
-- super_admin bypasses all checks; a "manager" is a staff row with these on.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_epos_refunds BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_epos_discounts BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_epos_manage_products BOOLEAN NOT NULL DEFAULT false;

-- Sequential order numbers for receipts.
CREATE SEQUENCE IF NOT EXISTS epos_order_seq START 1;
CREATE OR REPLACE FUNCTION nextval_epos_order_seq() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT nextval('epos_order_seq') $$;

-- Product categories (till tiles).
CREATE TABLE IF NOT EXISTS epos_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#1B2D3C',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Products. price is VAT-inclusive (shelf price), as on the shop floor.
-- vat_treatment drives the effective rate; vat_rate is stored so custom
-- rates remain possible and reporting can group by it.
CREATE TABLE IF NOT EXISTS epos_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES epos_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  vat_treatment TEXT NOT NULL DEFAULT 'standard' CHECK (vat_treatment IN ('standard','reduced','zero','exempt')),
  vat_rate NUMERIC(5,4) NOT NULL DEFAULT 0.20,
  image_url TEXT,
  studios TEXT[] NOT NULL DEFAULT '{Putney,Wimbledon}',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_epos_products_category ON epos_products(category_id);
CREATE INDEX IF NOT EXISTS idx_epos_products_active ON epos_products(active);

-- Preset discounts/promotions (manager-maintained).
CREATE TABLE IF NOT EXISTS epos_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value NUMERIC(10,2) NOT NULL CHECK (value >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders. An order may link to a table and/or a booking; several orders
-- can sit on the same table (split bills) and one order can cover a walk-in.
CREATE TABLE IF NOT EXISTS epos_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  studio TEXT NOT NULL CHECK (studio IN ('Putney','Wimbledon')),
  table_id TEXT,
  booking_id TEXT REFERENCES bookings(booking_id) ON DELETE SET NULL,
  customer_name TEXT,
  label TEXT,                    -- e.g. 'Seat 1' / payer name for split bills
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  staff_name TEXT,               -- snapshot for receipts
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','partial','paid','void')),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,   -- items gross (VAT-inclusive)
  discount_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  vat_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,      -- subtotal - discount
  paid_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_label TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_epos_orders_studio ON epos_orders(studio, created_at);
CREATE INDEX IF NOT EXISTS idx_epos_orders_table ON epos_orders(studio, table_id) WHERE status IN ('open','partial');
CREATE INDEX IF NOT EXISTS idx_epos_orders_booking ON epos_orders(booking_id);
CREATE INDEX IF NOT EXISTS idx_epos_orders_status ON epos_orders(status);

-- Line items. name/price/vat are snapshots so product edits never
-- rewrite historical receipts.
CREATE TABLE IF NOT EXISTS epos_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES epos_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES epos_products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  vat_treatment TEXT NOT NULL DEFAULT 'standard',
  vat_rate NUMERIC(5,4) NOT NULL DEFAULT 0.20,
  line_total NUMERIC(10,2) NOT NULL,           -- unit_price * quantity (gross)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_epos_order_items_order ON epos_order_items(order_id);

-- Payments. Multiple payments per order = split payments / partial payments.
-- idempotency_key protects against duplicate submissions on retry.
CREATE TABLE IF NOT EXISTS epos_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES epos_orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash','card','voucher','other')),
  provider TEXT NOT NULL DEFAULT 'manual',     -- 'manual' | 'mock' | 'dojo'
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','pending','failed','partially_refunded','refunded')),
  reference TEXT,                -- dojo payment id / voucher code / till note
  gift_card_id UUID,
  change_given NUMERIC(10,2),    -- cash change returned
  refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  staff_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_epos_payments_order ON epos_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_epos_payments_created ON epos_payments(created_at);

-- Register Putney's physical tables so both studios share one table
-- registry (matches src/components/PutneyFloorPlan.tsx labels). The
-- allocation engine ignores non-Wimbledon studios, so this changes no
-- capacity behaviour — it only gives EPOS a data source.
INSERT INTO studio_tables (studio, table_id, area, table_type, min_capacity, max_capacity, joinable, label, sort_order, active)
VALUES
  ('Putney','T1','MAIN','SMALL_SQUARE',1,5,false,'T1',1,true),
  ('Putney','T2','MAIN','SMALL_SQUARE',1,2,false,'T2',2,true),
  ('Putney','T3','MAIN','SMALL_SQUARE',1,2,false,'T3',3,true),
  ('Putney','T4','MAIN','SMALL_SQUARE',1,5,false,'T4',4,true),
  ('Putney','T5','MAIN','LARGE_RECTANGLE',1,6,false,'T5',5,true),
  ('Putney','T6','MAIN','LARGE_RECTANGLE',1,6,false,'T6',6,true),
  ('Putney','T7','PARTY','LARGE_RECTANGLE',1,8,false,'T7',7,true),
  ('Putney','T8','PARTY','SMALL_SQUARE',1,2,false,'T8',8,true),
  ('Putney','T9','PARTY','SMALL_SQUARE',1,2,false,'T9',9,true),
  ('Putney','T10','PARTY','LARGE_RECTANGLE',1,8,false,'T10',10,true)
ON CONFLICT (studio, table_id) DO NOTHING;

-- Till categories (matching the existing register layout).
INSERT INTO epos_categories (name, slug, color, sort_order) VALUES
  ('Studio/Writing Fees','studio-fees','#D97706',1),
  ('Mugs','mugs','#1E3A8A',2),
  ('Small Animals','small-animals','#7C3AED',3),
  ('Plates/Bowls/Kitchen','plates-bowls-kitchen','#64748B',4),
  ('Moneybanks','moneybanks','#DC2626',5),
  ('Vases/Jugs/Boxes','vases-jugs-boxes','#65A30D',6),
  ('Tiles and Ornaments','tiles-and-ornaments','#9333EA',7),
  ('Drinks','drinks','#C2410C',8),
  ('Christmas','christmas','#4B5563',9),
  ('Party','parties','#16A34A',10),
  ('Rush Service','rush-service','#A16207',11)
ON CONFLICT (slug) DO NOTHING;

-- RLS: service-role only, matching studio_tables convention.
ALTER TABLE epos_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_payments ENABLE ROW LEVEL SECURITY;
