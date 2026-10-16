// Card payment provider for EPOS.
//
// Provider selection is env-driven:
//   EPOS_PAYMENT_PROVIDER = 'mock' (default) | 'dojo'
//   DOJO_API_KEY                              — required when provider = 'dojo'
//   DOJO_SOFTWARE_HOUSE_ID, DOJO_RESELLER_ID  — required for terminal calls
//   DOJO_TERMINAL_ID_PUTNEY / DOJO_TERMINAL_ID_WIMBLEDON — per-studio terminal ids
//     (or DOJO_TERMINAL_ID for a shared default)
//
// Dojo Pay-at-Counter flow (docs.dojo.tech):
//   POST /payment-intents           -> create the charge
//   POST /terminal-sessions         -> push it onto a specific terminal
//   GET  /payment-intents/{id}      -> poll status (webhooks are also available)
//   POST /terminal-sessions         -> matchedRefund/unlinkedRefund sessions
// Dojo auth uses `Authorization: Basic <api_key>` — "Basic " is a literal
// prefix; the key is NOT base64-encoded. Terminal requests additionally need
// software-house-id and reseller-id headers.
//
// Until Dojo credentials exist, every card payment goes through the mock,
// which completes immediately with a mock_ reference. Live Dojo calls are
// never attempted without the credentials being explicitly configured.

const DOJO_API = 'https://api.dojo.tech';
const DOJO_VERSION = '2024-02-05';

export interface CardPaymentResult {
  status: 'completed' | 'pending' | 'failed';
  reference: string;
  provider: string;
  detail?: string;
}

export function cardProvider(): 'mock' | 'dojo' {
  return Deno.env.get('EPOS_PAYMENT_PROVIDER') === 'dojo' ? 'dojo' : 'mock';
}

function dojoCreds(): { apiKey: string; softwareHouseId: string; resellerId: string } | null {
  const apiKey = Deno.env.get('DOJO_API_KEY');
  if (!apiKey) return null;
  return {
    apiKey,
    softwareHouseId: Deno.env.get('DOJO_SOFTWARE_HOUSE_ID') || 'softwareHouse1',
    resellerId: Deno.env.get('DOJO_RESELLER_ID') || 'reseller1',
  };
}

function dojoHeaders(apiKey: string, terminal = false): Record<string, string> {
  const h: Record<string, string> = {
    'Authorization': `Basic ${apiKey}`,
    'Content-Type': 'application/json',
    'version': DOJO_VERSION,
  };
  if (terminal) {
    const c = dojoCreds();
    if (c) {
      h['software-house-id'] = c.softwareHouseId;
      h['reseller-id'] = c.resellerId;
    }
  }
  return h;
}

function dojoTerminalId(studio?: string | null): string | null {
  if (studio === 'Putney') return Deno.env.get('DOJO_TERMINAL_ID_PUTNEY') || Deno.env.get('DOJO_TERMINAL_ID') || null;
  if (studio === 'Wimbledon') return Deno.env.get('DOJO_TERMINAL_ID_WIMBLEDON') || Deno.env.get('DOJO_TERMINAL_ID') || null;
  return Deno.env.get('DOJO_TERMINAL_ID') || null;
}

export async function createCardPayment(
  amountPence: number,
  orderNumber: string,
  studio?: string | null,
): Promise<CardPaymentResult> {
  if (cardProvider() === 'dojo') {
    const creds = dojoCreds();
    const terminalId = dojoTerminalId(studio);
    if (!creds || !terminalId) {
      return {
        status: 'failed',
        reference: '',
        provider: 'dojo',
        detail: 'Dojo is selected but DOJO_API_KEY / DOJO_TERMINAL_ID[_<STUDIO>] are not configured',
      };
    }
    return createDojoTerminalPayment(creds.apiKey, terminalId, amountPence, orderNumber);
  }
  return {
    status: 'completed',
    reference: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'mock',
  };
}

async function createDojoTerminalPayment(
  apiKey: string,
  terminalId: string,
  amountPence: number,
  orderNumber: string,
): Promise<CardPaymentResult> {
  try {
    const intentResp = await fetch(`${DOJO_API}/payment-intents`, {
      method: 'POST',
      headers: dojoHeaders(apiKey),
      body: JSON.stringify({
        amount: { value: amountPence, currencyCode: 'GBP' },
        reference: orderNumber,
        description: `Pitter Potter order ${orderNumber}`,
        paymentMethods: ['Card'],
      }),
    });
    const intent = await intentResp.json().catch(() => ({}));
    if (!intentResp.ok || !intent.id) {
      return { status: 'failed', reference: '', provider: 'dojo', detail: intent?.message || 'Failed to create Dojo payment intent' };
    }

    const sessionResp = await fetch(`${DOJO_API}/terminal-sessions`, {
      method: 'POST',
      headers: dojoHeaders(apiKey, true),
      body: JSON.stringify({
        terminalId,
        details: {
          sale: { paymentIntentId: intent.id },
          sessionType: 'Sale',
        },
      }),
    });
    const session = await sessionResp.json().catch(() => ({}));
    const sessionId = session.id || session.terminalSessionId;
    if (!sessionResp.ok || !sessionId) {
      return { status: 'failed', reference: intent.id, provider: 'dojo', detail: session?.message || 'Failed to send payment to terminal' };
    }

    // The terminal session is asynchronous — the customer pays on the device
    // and the payment lands later via poll/webhook. reference format:
    //   <paymentIntentId>|<terminalSessionId>
    return { status: 'pending', reference: `${intent.id}|${sessionId}`, provider: 'dojo' };
  } catch (err) {
    return { status: 'failed', reference: '', provider: 'dojo', detail: err instanceof Error ? err.message : String(err) };
  }
}

// Dojo matched refund — pushes a negative transaction for a prior payment
// intent onto the studio terminal (card must be present). Returns pending;
// the refund completes asynchronously on the terminal.
export async function createDojoRefund(
  paymentIntentId: string,
  studio?: string | null,
): Promise<CardPaymentResult> {
  const creds = dojoCreds();
  const terminalId = dojoTerminalId(studio);
  if (!creds || !terminalId) {
    return { status: 'failed', reference: '', provider: 'dojo', detail: 'Dojo credentials / terminal id not configured' };
  }
  try {
    const sessionResp = await fetch(`${DOJO_API}/terminal-sessions`, {
      method: 'POST',
      headers: dojoHeaders(creds.apiKey, true),
      body: JSON.stringify({
        terminalId,
        details: {
          matchedRefund: { paymentIntentId },
          sessionType: 'MatchedRefund',
        },
      }),
    });
    const session = await sessionResp.json().catch(() => ({}));
    const sessionId = session.id || session.terminalSessionId;
    if (!sessionResp.ok || !sessionId) {
      return { status: 'failed', reference: paymentIntentId, provider: 'dojo', detail: session?.message || 'Failed to send refund to terminal' };
    }
    return { status: 'pending', reference: `${paymentIntentId}|${sessionId}`, provider: 'dojo' };
  } catch (err) {
    return { status: 'failed', reference: paymentIntentId, provider: 'dojo', detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkDojoPaymentStatus(
  apiKey: string,
  paymentIntentId: string,
): Promise<'completed' | 'pending' | 'failed'> {
  try {
    const resp = await fetch(`${DOJO_API}/payment-intents/${paymentIntentId}`, {
      headers: dojoHeaders(apiKey),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return 'pending';
    const status = String(data.status || '').toLowerCase();
    if (status === 'captured' || status === 'paid' || status === 'created' && data.amountCaptured > 0) return 'completed';
    if (status === 'cancelled' || status === 'failed' || status === 'declined') return 'failed';
    return 'pending';
  } catch {
    return 'pending';
  }
}
