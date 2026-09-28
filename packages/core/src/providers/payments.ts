/**
 * PaymentService abstraction (PCI-conscious): the platform only ever receives a
 * provider token for the card — never a raw card number — and stores references only.
 *
 * PaymentService
 *  ├── StripeProvider   (production)
 *  ├── FutureProvider   (Adyen / Braintree — implement PaymentProvider)
 *  └── MockProvider     (local dev, tests, demo)
 */
export interface AuthorizeRequest {
  amountCents: number;
  currency: 'usd';
  paymentToken: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}
export interface ProviderResult {
  ok: boolean;
  ref: string | null;
  message: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  authorize(req: AuthorizeRequest): Promise<ProviderResult>;
  capture(ref: string, amountCents: number): Promise<ProviderResult>;
  refund(ref: string, amountCents: number, idempotencyKey: string): Promise<ProviderResult>;
  void(ref: string): Promise<ProviderResult>;
}

/**
 * Test tokens (mirroring common processor test conventions):
 *   tok_visa, tok_mastercard, tok_amex → approved
 *   tok_chargeDeclined                 → declined
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private seq = 0;
  private ref() {
    return `mock_pi_${Date.now().toString(36)}${(this.seq++).toString(36)}`;
  }
  async authorize(req: AuthorizeRequest): Promise<ProviderResult> {
    const m = req.paymentToken.match(/^tok_(visa|mastercard|amex|chargeDeclined)(?:_(\d{4}))?$/);
    if (!m) return { ok: false, ref: null, message: 'Unrecognized payment method.' };
    if (m[1] === 'chargeDeclined') return { ok: false, ref: this.ref(), message: 'Your card was declined.' };
    const brand = m[1] === 'visa' ? 'Visa' : m[1] === 'amex' ? 'American Express' : 'Mastercard';
    return { ok: true, ref: this.ref(), message: null, cardBrand: brand, cardLast4: m[2] ?? '4242' };
  }
  async capture(ref: string) {
    return { ok: true, ref, message: null };
  }
  async refund() {
    return { ok: true, ref: this.ref(), message: null };
  }
  async void(ref: string) {
    return { ok: true, ref, message: null };
  }
}

/** Stripe PaymentIntents with manual capture. Requires STRIPE_SECRET_KEY. */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  constructor(private secretKey: string, private fetchImpl: typeof fetch = fetch) {}
  private async call(path: string, form: Record<string, string>, idem?: string) {
    const res = await this.fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(idem ? { 'Idempotency-Key': idem } : {}),
      },
      body: new URLSearchParams(form).toString(),
    });
    const json = (await res.json()) as any;
    return { ok: res.ok, json };
  }
  async authorize(req: AuthorizeRequest): Promise<ProviderResult> {
    const form: Record<string, string> = {
      amount: String(req.amountCents),
      currency: req.currency,
      payment_method: req.paymentToken,
      capture_method: 'manual',
      confirm: 'true',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
    };
    for (const [k, v] of Object.entries(req.metadata)) form[`metadata[${k}]`] = v;
    const { ok, json } = await this.call('payment_intents', form, req.idempotencyKey);
    if (!ok || json.status !== 'requires_capture') {
      return { ok: false, ref: json.id ?? null, message: json.error?.message ?? 'Payment was not authorized.' };
    }
    const card = json.payment_method_details?.card ?? json.charges?.data?.[0]?.payment_method_details?.card;
    return { ok: true, ref: json.id, message: null, cardBrand: card?.brand ?? null, cardLast4: card?.last4 ?? null };
  }
  async capture(ref: string, amountCents: number) {
    const { ok, json } = await this.call(`payment_intents/${ref}/capture`, { amount_to_capture: String(amountCents) });
    return { ok, ref, message: ok ? null : json.error?.message ?? 'Capture failed.' };
  }
  async refund(ref: string, amountCents: number, idem: string) {
    const { ok, json } = await this.call('refunds', { payment_intent: ref, amount: String(amountCents) }, idem);
    return { ok, ref: json.id ?? null, message: ok ? null : json.error?.message ?? 'Refund failed.' };
  }
  async void(ref: string) {
    const { ok, json } = await this.call(`payment_intents/${ref}/cancel`, {});
    return { ok, ref, message: ok ? null : json.error?.message ?? 'Void failed.' };
  }
}
