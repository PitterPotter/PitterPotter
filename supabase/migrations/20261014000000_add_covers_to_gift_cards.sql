-- Add "covers" to gift_cards for activity vouchers (e.g. school donations)
-- where the voucher entitles the holder to an activity instead of a £ amount.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS covers TEXT;
