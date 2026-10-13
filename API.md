# Pitter Potter Admin API

For building external tools (desktop app, integrations) against the bookings system.

## Base URL

```
https://xjtfjlhykfvkckziyvxk.supabase.co/functions/v1
```

## Headers (every request)

```
Content-Type: application/json
Authorization: Bearer <ANON_KEY>
apikey: <ANON_KEY>
```

The anon key is public (it ships in the website bundle). Ask the owner for the current value or copy it from the site's `.env.local` (`VITE_SUPABASE_ANON_KEY`).

## Auth flow

1. `POST /staff-login` with `{ "username": "...", "password": "..." }`
2. Response contains `sessionToken` — store it. **Tokens do not expire.**
3. Pass `{ username, sessionToken }` in the body of every subsequent call.
4. If you get a `401`, re-run the login and update the stored token.

## Endpoints

### `staff-login`

```json
{ "username": "staffuser", "password": "secret" }
```

Returns: `{ id, name, username, role, canUpdateStatus, canEditBookings, canAddWalkIns, canDeleteBookings, allowedStudios, sessionToken }`

### `admin-bookings`

Single function, dispatched by `action`. All bodies include `username` + `sessionToken`.

| action | Extra fields | Returns |
|---|---|---|
| `load` | — | `Booking[]` (newest first) |
| `create` | `booking: Booking` | `{ success, warning? }` |
| `update` | `booking: Booking` (must include `id`) | `{ success, warning? }` |
| `patch` | `booking: { id, ...fields }` (writes only sent fields) | `{ success }` |
| `updateStatus` | `id`, `status` | `{ success }` |
| `updateCollection` | `id`, `collectionStatus`, `collectedAt?` | `{ success }` |
| `sendDepositLink` | `id` (party booking, unpaid deposit) | `{ success }` — emails the Stripe deposit link |
| `delete` | `id` | `{ success }` |

Notes:

- `warning` is a non-null string when the slot is over capacity — the booking is still created/updated.
- `update`/`create`/`patch` run Wimbledon table allocation automatically.
- Non-party bookings must not carry party payment fields (`depositAmount`, `finalBalance`, `paymentStatus`, etc.) — the server strips them.
- Staff accounts with `allowedStudios` can only see/edit bookings for those studios; permissions like `canEditBookings`, `canDeleteBookings` are enforced server-side.

### Other functions

| Function | Purpose |
|---|---|
| `get-capacity` | `POST { studio, date, sessionType }` → available slots |
| `send-collection-ready` | `POST { bookingId }` → sends ready-to-collect email + SMS |
| `admin-notifications` | Admin notifications |
| `admin-settings` | Settings key/value store (`load`/`update` by `key`) |
| `admin-sms` | SMS send/test/logs/usage (super_admin only) |
| `admin-gift-cards` | Gift card list/manage |

## Booking object

```ts
interface Booking {
  id: string;                    // e.g. "PP-2847"
  studio: 'Putney' | 'Wimbledon';
  name: string;
  email?: string;
  phone?: string;
  date: string;                  // "YYYY-MM-DD"
  time: string;                  // "HH:mm"
  paintersCount: number;
  sessionType: 'painting' | 'clay-imprints' | 'sip-and-paint'
             | 'birthday-party' | 'baby-shower-hen' | 'corporate';
  notes?: string;                // customer notes
  staffNotes?: string;           // internal-only
  status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
  requestDate?: string;          // ISO timestamp
  estimatedPrice?: number;
  finalPrice?: number;
  source?: string;               // "online" | "walk-in" | ...
  giftCardCode?: string;
  giftCardDiscount?: number;
  tableId?: string;
  resources?: unknown;           // Wimbledon table allocation
  // Party bookings only:
  depositAmount?: number;
  finalSeats?: number;
  finalBalance?: number;
  paymentLinkUrl?: string;
  paymentLinkSentAt?: string;
  paymentStatus?: string;
  stripePaymentIntentId?: string;
  depositPaidAt?: string;        // ISO timestamp when the deposit was received
  finalPaidAt?: string;          // ISO timestamp when the final balance was paid
  sendDepositLink?: boolean;     // create only: emails the deposit payment link
  // Collections:
  collectionStatus?: 'painted' | 'ready' | 'collected';
  collectedAt?: string;
  // System:
  managementToken?: string;      // powers /manage-booking?token=...
  photos?: string[];
  photoTags?: Record<string, unknown>;
  createdAt?: string;
}
```

### Example

```json
{
  "id": "PP-2847",
  "studio": "Wimbledon",
  "name": "Evonne Smith",
  "email": "evonne@example.com",
  "phone": "+447700900123",
  "date": "2026-10-15",
  "time": "14:30",
  "paintersCount": 3,
  "sessionType": "painting",
  "status": "confirmed",
  "requestDate": "2026-10-02T10:14:22.000Z",
  "estimatedPrice": 45,
  "source": "online",
  "managementToken": "a1b2c3d4-...",
  "createdAt": "2026-10-02T10:14:22.000Z"
}
```
