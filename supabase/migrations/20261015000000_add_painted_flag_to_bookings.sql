-- Painted queue flags: 'rush' (paid express service) and 'return_to_finish'
-- (customer coming back to finish painting). Nullable; buckets in the Painted
-- tab filter on these values.
alter table bookings add column if not exists painted_flag text;
