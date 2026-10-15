# Pitter Potter — Agent Notes

## Git policy

**Do NOT `git push` unless the owner explicitly asks for it.** Committing locally is fine
if asked, but pushing to `origin` requires an explicit instruction each time.

## Always update both web AND iOS

Per project owner: **every admin-facing change must be applied to both the web admin
(`src/components/AdminDashboardView.tsx` + `src/components/admin/*`) and the iOS admin app
(`ios-admin/PitterPotterAdmin/**`).** Do not implement a feature on one platform only.

**Batch iOS releases:** the owner does not want frequent TestFlight versions. iOS changes
may stay uncommitted (or committed without a build) until the owner asks — then commit
everything and upload **one** TestFlight build containing all accumulated changes.

## Global location switcher (Putney / Wimbledon)

Both apps share the same model:

- **Single global studio selection** — `'all' | 'Putney' | 'Wimbledon'`. Web: `studioFilter`
  state in `AdminDashboardView.tsx` (persisted in `localStorage` `pp_admin_filters`); iOS:
  `BookingsViewModel.selectedStudio` (persisted in `UserDefaults`).
- `super_admin` sees all three options; other staff are limited to `allowedStudios`
  (iOS: `Staff.visibleStudios`; web: `visibleStudios` derived from `staffAllowedStudios`).
- All location-specific surfaces read the **scoped** list — web: `scopedInquiries`;
  iOS: `bookingsVM.visibleBookings`. This covers dashboard metrics, calendar/day views,
  Painted/Ready/Collected, session-type counts, floor plan, analytics, notifications,
  capacity, closures, and creation-form defaults.
- **Keep the unfiltered list for id/token lookups** (QR scans, detail by id, status updates)
  so a booking stays actionable after switching location mid-task.
- Location-independent data (gift cards, audit logs, staff mgmt, email/SMS logs) is not scoped.
- Backend authorization in `supabase/functions/admin-bookings/index.ts` remains
  authoritative — UI filtering must never be the only access control.
- When rendering filtered sub-lists that mutate by array index (capacity rows, closed
  dates), keep `(item, index)` pairs — never re-index after filtering.

## Commands

- Web dev: `npm run dev` (port 3000)
- Typecheck: `npm run lint` (`tsc --noEmit`)
- Tests: `npm test` — NOTE: `supabase/functions/_shared/capacity.test.ts` has 4
  pre-existing failures (mock chain missing `.order`); unrelated to component changes.
- Build: `npm run build`
- iOS admin build: `xcodebuild -project ios-admin/PitterPotterAdmin.xcodeproj -scheme PitterPotterAdmin -destination 'generic/platform=iOS Simulator' build`
- Supabase CLI: `npx supabase` (installed as devDependency; auth via `SUPABASE_ACCESS_TOKEN` in `.env.local`)

## Environment / secrets

- `.env.local` is gitignored via `.env*`. Server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`) live there — **never** prefix them with
  `VITE_` or they ship in the browser bundle.
- Git `origin` uses SSH (`git@github.com:PitterPotter/PitterPotter.git`) — HTTPS token
  in keychain lacks push permission.
- Node is via nvm (v24.21.0); `~/.bash_profile` sources `~/.bashrc` so login shells get it.
