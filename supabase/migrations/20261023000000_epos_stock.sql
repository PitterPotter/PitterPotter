-- EPOS Stock & Inventory for Pitter Potter.
-- Ledger design: epos_stock holds per-(product, studio) balances; every
-- change is a row in epos_stock_movements (sale / receive / transfer /
-- adjust / stocktake). All mutations go through SECURITY DEFINER functions
-- so quantity + movement write atomically and service-role RLS stays intact.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_epos_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE epos_products ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT true;

-- Services are not physical stock.
UPDATE epos_products SET track_stock = false
WHERE category_id IN (SELECT id FROM epos_categories WHERE slug IN ('studio-fees', 'rush-service', 'parties'));

-- Per-studio balance + reorder config.
CREATE TABLE IF NOT EXISTS epos_stock (
  product_id UUID NOT NULL REFERENCES epos_products(id) ON DELETE CASCADE,
  studio TEXT NOT NULL CHECK (studio IN ('Putney','Wimbledon')),
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  reorder_qty INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, studio)
);

-- Immutable movement ledger — the audit trail.
CREATE TABLE IF NOT EXISTS epos_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES epos_products(id) ON DELETE RESTRICT,
  studio TEXT NOT NULL CHECK (studio IN ('Putney','Wimbledon')),
  change_qty INTEGER NOT NULL,                  -- negative = stock out
  type TEXT NOT NULL CHECK (type IN ('sale','receive','transfer_out','transfer_in','adjust','stocktake')),
  reason TEXT,
  order_id UUID REFERENCES epos_orders(id) ON DELETE SET NULL,
  receipt_id UUID,
  transfer_id UUID,
  stocktake_id UUID,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  staff_name TEXT,
  quantity_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON epos_stock_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_studio ON epos_stock_movements(studio, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON epos_stock_movements(type, created_at);
-- Exactly-once sale deduction: one 'sale' movement per product per order,
-- even if pay/checkPayment recalc paths run concurrently or are retried.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_sale_once
  ON epos_stock_movements(product_id, order_id) WHERE type = 'sale' AND order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS epos_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES epos_products(id) ON DELETE RESTRICT,
  from_studio TEXT NOT NULL CHECK (from_studio IN ('Putney','Wimbledon')),
  to_studio TEXT NOT NULL CHECK (to_studio IN ('Putney','Wimbledon')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  note TEXT,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  staff_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deliveries received into a studio.
CREATE TABLE IF NOT EXISTS epos_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio TEXT NOT NULL CHECK (studio IN ('Putney','Wimbledon')),
  note TEXT,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  staff_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS epos_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES epos_receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES epos_products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

-- Physical counts. Auto-applied on submit (per owner decision) — the
-- submitted counts, expected quantities and resulting adjustments are
-- all preserved here for review.
CREATE TABLE IF NOT EXISTS epos_stocktakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio TEXT NOT NULL CHECK (studio IN ('Putney','Wimbledon')),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied')),
  note TEXT,
  staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  staff_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS epos_stocktake_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id UUID NOT NULL REFERENCES epos_stocktakes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES epos_products(id) ON DELETE RESTRICT,
  expected_qty INTEGER NOT NULL,
  counted_qty INTEGER NOT NULL,
  difference INTEGER NOT NULL
);

-- Single movement: upsert balance then record the ledger entry, atomically.
CREATE OR REPLACE FUNCTION epos_apply_stock_movement(
  p_product UUID, p_studio TEXT, p_change INT, p_type TEXT,
  p_reason TEXT DEFAULT NULL, p_receipt UUID DEFAULT NULL,
  p_transfer UUID DEFAULT NULL, p_stocktake UUID DEFAULT NULL,
  p_staff UUID DEFAULT NULL, p_staff_name TEXT DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_qty INT;
BEGIN
  INSERT INTO epos_stock (product_id, studio, quantity)
  VALUES (p_product, p_studio, p_change)
  ON CONFLICT (product_id, studio)
  DO UPDATE SET quantity = epos_stock.quantity + p_change, updated_at = now()
  RETURNING quantity INTO v_qty;

  INSERT INTO epos_stock_movements
    (product_id, studio, change_qty, type, reason, receipt_id, transfer_id, stocktake_id, staff_id, staff_name, quantity_after)
  VALUES
    (p_product, p_studio, p_change, p_type, p_reason, p_receipt, p_transfer, p_stocktake, p_staff, p_staff_name, v_qty);
  RETURN v_qty;
END $$;

-- Deduct a fully-paid order's tracked items. Idempotent via the partial
-- unique index — the movement insert is claimed before the decrement, so
-- concurrent/recalc-repeated calls deduct exactly once.
CREATE OR REPLACE FUNCTION epos_deduct_order_stock(p_order_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  o epos_orders%ROWTYPE;
  it RECORD;
  claimed UUID;
  new_qty INT;
  n INT := 0;
BEGIN
  SELECT * INTO o FROM epos_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR it IN
    SELECT oi.product_id AS pid, SUM(oi.quantity) AS q
    FROM epos_order_items oi
    JOIN epos_products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL AND p.track_stock
    GROUP BY oi.product_id
  LOOP
    INSERT INTO epos_stock_movements
      (product_id, studio, change_qty, type, reason, order_id, quantity_after)
    VALUES
      (it.pid, o.studio, -it.q, 'sale', 'Sale ' || o.order_number, o.id, 0)
    ON CONFLICT (product_id, order_id) WHERE type = 'sale' DO NOTHING
    RETURNING id INTO claimed;

    IF claimed IS NOT NULL THEN
      INSERT INTO epos_stock (product_id, studio, quantity)
      VALUES (it.pid, o.studio, -it.q)
      ON CONFLICT (product_id, studio)
      DO UPDATE SET quantity = epos_stock.quantity - it.q, updated_at = now()
      RETURNING quantity INTO new_qty;
      UPDATE epos_stock_movements SET quantity_after = new_qty WHERE id = claimed;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- Atomic two-leg transfer between studios.
CREATE OR REPLACE FUNCTION epos_transfer_stock(
  p_product UUID, p_from TEXT, p_to TEXT, p_qty INT,
  p_note TEXT, p_staff UUID, p_staff_name TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'source and destination are the same studio'; END IF;
  INSERT INTO epos_transfers (id, product_id, from_studio, to_studio, quantity, note, staff_id, staff_name)
  VALUES (v_id, p_product, p_from, p_to, p_qty, p_note, p_staff, p_staff_name);
  PERFORM epos_apply_stock_movement(p_product, p_from, -p_qty, 'transfer_out', p_note, NULL, v_id, NULL, p_staff, p_staff_name);
  PERFORM epos_apply_stock_movement(p_product, p_to, p_qty, 'transfer_in', p_note, NULL, v_id, NULL, p_staff, p_staff_name);
  RETURN v_id;
END $$;

-- Delivery receipt: header + item rows + 'receive' movements, atomically.
-- p_items: JSONB array of {"productId": "...", "qty": n}
CREATE OR REPLACE FUNCTION epos_receive_stock(
  p_studio TEXT, p_items JSONB, p_note TEXT, p_staff UUID, p_staff_name TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  r RECORD;
BEGIN
  INSERT INTO epos_receipts (id, studio, note, staff_id, staff_name)
  VALUES (v_id, p_studio, p_note, p_staff, p_staff_name);
  FOR r IN SELECT (e->>'productId')::uuid AS pid, (e->>'qty')::int AS qty
           FROM jsonb_array_elements(p_items) e
  LOOP
    IF r.qty IS NULL OR r.qty <= 0 THEN RAISE EXCEPTION 'received quantity must be positive'; END IF;
    INSERT INTO epos_receipt_items (receipt_id, product_id, quantity) VALUES (v_id, r.pid, r.qty);
    PERFORM epos_apply_stock_movement(r.pid, p_studio, r.qty, 'receive', p_note, v_id, NULL, NULL, p_staff, p_staff_name);
  END LOOP;
  RETURN v_id;
END $$;

-- Per-product sold totals from paid orders (for stock overview + reports).
CREATE OR REPLACE VIEW epos_product_sales AS
SELECT oi.product_id, o.studio,
  SUM(oi.quantity) AS qty_sold,
  SUM(oi.line_total) AS revenue
FROM epos_order_items oi
JOIN epos_orders o ON o.id = oi.order_id
WHERE o.status = 'paid' AND oi.product_id IS NOT NULL
GROUP BY oi.product_id, o.studio;

ALTER TABLE epos_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE epos_stocktake_items ENABLE ROW LEVEL SECURITY;
