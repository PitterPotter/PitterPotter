-- Track when each payment was actually received so staff can see
-- "£50 deposit received on 12 Oct" style payment history per booking.
alter table public.bookings add column if not exists deposit_paid_at timestamptz;
alter table public.bookings add column if not exists final_paid_at timestamptz;

-- Backfill: bookings that already recorded a deposit amount were paid when
-- the booking row was created (online) or marked paid by staff (walk-in).
update public.bookings
set deposit_paid_at = created_at
where deposit_amount > 0 and deposit_paid_at is null;

-- Editable template for the deposit payment link email (admin → Email Templates).
INSERT INTO email_templates (template_key, name, subject, html_content, available_variables) VALUES
(
  'party_deposit_link',
  'Party Deposit Payment Link',
  'Deposit required for your party — {{studio}} on {{date}}',
  '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1B2D3C;">
  <h2 style="color: #1B2D3C;">Your party booking — deposit required</h2>
  <p>Hi {{name}},</p>
  <p>Thank you for booking your party at <strong>{{studio}}</strong> on <strong>{{date}}</strong> at <strong>{{time}}</strong>.</p>
  <p>To confirm your booking, please pay the <strong>£{{depositAmount}}</strong> deposit using the secure link below.</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="{{paymentLinkUrl}}" style="background: #1B2D3C; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Pay £{{depositAmount}} deposit</a>
  </p>
  <p>The remaining balance is payable on the day of your party.</p>
  <p style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #DBE7E4; font-size: 12px; color: #666;">
    <strong>{{studio}}</strong><br/>
    {{studioAddress}}<br/>
    {{studioPhone}}
  </p>
  <p>Pitter Potter</p>
</div>',
  ARRAY['bookingId', 'name', 'studio', 'studioAddress', 'studioPhone', 'date', 'time', 'depositAmount', 'paymentLinkUrl']
)
ON CONFLICT (template_key) DO NOTHING;

-- Disable the hourly automatic final-payment-link job. Final balance links
-- are now only sent manually by staff from the admin dashboard.
do $$
begin
  perform cron.unschedule('party-reminder-check');
exception when others then
  -- Job may not exist (e.g. fresh project) — that's fine.
  raise notice 'party-reminder-check not unscheduled: %', sqlerrm;
end $$;
