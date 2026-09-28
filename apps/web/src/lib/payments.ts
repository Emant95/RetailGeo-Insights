/**
 * Client-side card tokenization port. The raw card number never reaches RetailGeo servers:
 * production mounts the processor's hosted fields (e.g. Stripe Elements) and sends only the
 * resulting payment-method token. The beta/demo uses processor-style test cards.
 */
export interface CardInput {
  number: string;
  exp: string;
  cvc: string;
  zip: string;
}

export function luhn(num: string) {
  const d = num.replace(/\D/g, '');
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return d.length >= 13 && sum % 10 === 0;
}

export function validateCard(c: CardInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!luhn(c.number)) e.number = 'Check the card number.';
  const m = c.exp.match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!m) e.exp = 'Use MM/YY.';
  else {
    const month = Number(m[1]);
    const exp = new Date(2000 + Number(m[2]), month, 1);
    if (month < 1 || month > 12 || exp < new Date()) e.exp = 'This card has expired.';
  }
  if (!/^\d{3,4}$/.test(c.cvc)) e.cvc = 'Enter the 3- or 4-digit code.';
  if (!/^\d{5}$/.test(c.zip)) e.zip = 'Enter the billing ZIP code.';
  return e;
}

export async function tokenizeCard(c: CardInput): Promise<string> {
  const d = c.number.replace(/\D/g, '');
  await new Promise((r) => setTimeout(r, 350));
  if (d === '4000000000000002') return 'tok_chargeDeclined';
  const brand = d.startsWith('4') ? 'visa' : d.startsWith('5') || d.startsWith('2') ? 'mastercard' : d.startsWith('3') ? 'amex' : 'visa';
  return `tok_${brand}_${d.slice(-4)}`;
}

export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', note: 'Visa · approved' },
  { number: '5555 5555 5555 4444', note: 'Mastercard · approved' },
  { number: '4000 0000 0000 0002', note: 'Declined' },
];
