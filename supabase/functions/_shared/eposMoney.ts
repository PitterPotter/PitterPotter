// Shared EPOS money + VAT maths.
//
// All financial calculation lives HERE, in integer pence, so the web admin,
// iPad app and every report see identical figures. Clients never compute
// totals — they display what the server returns.
//
// Prices on products are VAT-INCLUSIVE (shelf prices). VAT is extracted
// per line: vat = gross - gross / (1 + rate), rounded to the penny.

export type VatTreatment = 'standard' | 'reduced' | 'zero' | 'exempt';

export const VAT_RATES: Record<VatTreatment, number> = {
  standard: 0.20,
  reduced: 0.05,
  zero: 0,
  exempt: 0,
};

export function vatRateFor(treatment: VatTreatment): number {
  return VAT_RATES[treatment] ?? 0.20;
}

export function isVatTreatment(v: unknown): v is VatTreatment {
  return v === 'standard' || v === 'reduced' || v === 'zero' || v === 'exempt';
}

export function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}

export function toPounds(pence: number): number {
  return pence / 100;
}

/** VAT portion of a VAT-inclusive gross amount (pence → pence). */
export function vatFromGross(grossPence: number, rate: number): number {
  if (rate <= 0) return 0;
  return Math.round(grossPence - grossPence / (1 + rate));
}

export interface EposLine {
  quantity: number;
  unit_price: number;   // pounds, VAT-inclusive
  vat_rate: number;
  vat_treatment?: string;
}

export interface OrderTotals {
  subtotal: number;      // pounds — items gross
  vat: number;           // pounds — VAT contained in the items
  discount: number;      // pounds
  total: number;         // pounds — subtotal - discount (never below 0)
  vatAfterDiscount: number; // VAT actually due after discounting
}

/**
 * Order totals from item lines.
 * Discount is applied pro-rata across VATable lines for the VAT-due figure,
 * so vatAfterDiscount = vat * (total / subtotal) approximated per line.
 */
export function computeTotals(lines: EposLine[], discountPence: number): OrderTotals {
  let subtotalPence = 0;
  let vatPence = 0;
  const vatablePence: number[] = [];

  for (const line of lines) {
    const gross = toPence(line.unit_price * line.quantity);
    const vat = line.vat_treatment === 'exempt' ? 0 : vatFromGross(gross, line.vat_rate);
    subtotalPence += gross;
    vatPence += vat;
    vatablePence.push(vat);
  }

  const cappedDiscount = Math.min(Math.max(0, discountPence), subtotalPence);
  const totalPence = subtotalPence - cappedDiscount;

  // Distribute the discount pro-rata over lines that carry VAT so the
  // post-discount VAT figure stays correct to the penny.
  let vatAfterPence = 0;
  if (subtotalPence === 0 || cappedDiscount === 0) {
    vatAfterPence = vatPence;
  } else {
    let remaining = cappedDiscount;
    let remainingVat = vatPence;
    lines.forEach((line, i) => {
      const gross = toPence(line.unit_price * line.quantity);
      const isLast = i === lines.length - 1;
      const share = isLast ? remaining : Math.round(cappedDiscount * gross / subtotalPence);
      remaining -= share;
      const net = gross - share;
      const lineVat = line.vat_treatment === 'exempt' ? 0 : vatFromGross(net, line.vat_rate);
      vatAfterPence += lineVat;
    });
    void remainingVat;
  }

  return {
    subtotal: toPounds(subtotalPence),
    vat: toPounds(vatPence),
    discount: toPounds(cappedDiscount),
    total: toPounds(totalPence),
    vatAfterDiscount: toPounds(vatAfterPence),
  };
}

export function formatOrderNumber(seq: number): string {
  return `POS-${String(seq).padStart(6, '0')}`;
}
