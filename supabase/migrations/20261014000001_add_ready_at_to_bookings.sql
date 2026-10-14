-- Records when a booking's "ready to collect" notification was sent, shown
-- on Ready cards like collected_at is on Collected cards.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ DEFAULT NULL;
