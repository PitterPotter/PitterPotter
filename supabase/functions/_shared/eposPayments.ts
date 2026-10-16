// Card payment provider for EPOS.
//
// Provider selection is env-driven:
//   EPOS_PAYMENT_PROVIDER = 'mock' (default) | 'dojo'
//   DOJO_API_KEY, DOJO_TERMINAL_ID — required when provider = 'dojo'
//
// Until Dojo credentials exist, every card payment goes through the mock,
// which completes immediately with a mock_ reference. Live Dojo calls are
// never attempted without the credentials being explicitly configured.

export interface CardPaymentResult {
  status: 'completed' | 'pending' | 'failed';
  reference: string;
  provider: string;
  detail?: string;
}

export function cardProvider(): 'mock' | 'dojo' {
  return Deno.env.get('EPOS_PAYMENT_PROVIDER') === 'dojo' ? 'dojo' : 'mock';
}

export async function createCardPayment(
  amountPence: number,
  orderNumber: string,
): Promise<CardPaymentResult> {
  if (cardProvider() === 'dojo') {
    const apiKey = Deno.env.get('DOJO_API_KEY');
    const terminalId = Deno.env.get('DOJO_TERMINAL_ID');
    if (!apiKey || !terminalId) {
      return {
        status: 'failed',
        reference: '',
        provider: 'dojo',
        detail: 'Dojo is selected but DOJO_API_KEY / DOJO_TERMINAL_ID are not configured',
      };
    }
    return createDojoTerminalPayment(apiKey, terminalId, amountPence, orderNumber);
  }
  return {
    status: 'completed',
    reference: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider: 'mock',
  };
}

// Dojo card-present flow (docs.dojo.tech): create a payment intent for the
// amount, then send it to the paired terminal via a terminal session.
// Requires the terminal to be paired to this integration's credentials.
async function createDojoTerminalPayment(
  apiKey: string,
  terminalId: string,
  amountPence: number,
  orderNumber: string,
): Promise<CardPaymentResult> {
  try {
    const intentResp = await fetch('https://api.dojo.tech/payment-intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'version': '2024-02-05',
      },
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

    const sessionResp = await fetch(`https://api.dojo.tech/terminal-sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'version': '2024-02-05',
      },
      body: JSON.stringify({ terminalId, details: { paymentIntentId: intent.id } }),
    });
    const session = await sessionResp.json().catch(() => ({}));
    if (!sessionResp.ok || !session.terminalSessionId) {
      return { status: 'failed', reference: intent.id, provider: 'dojo', detail: session?.message || 'Failed to send payment to terminal' };
    }

    // The terminal session is asynchronous — the payment lands later via
    // webhook/poll. Return pending with the session id as the reference.
    return { status: 'pending', reference: `${intent.id}|${session.terminalSessionId}`, provider: 'dojo' };
  } catch (err) {
    return { status: 'failed', reference: '', provider: 'dojo', detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkDojoPaymentStatus(
  apiKey: string,
  paymentIntentId: string,
): Promise<'completed' | 'pending' | 'failed'> {
  try {
    const resp = await fetch(`https://api.dojo.tech/payment-intents/${paymentIntentId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'version': '2024-02-05' },
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
