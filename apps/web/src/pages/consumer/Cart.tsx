import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useCart, useSession, toast } from '../../state/store';
import { track, useAction, useApi } from '../../lib/hooks';
import { tokenizeCard, validateCard, TEST_CARDS, type CardInput } from '../../lib/payments';
import { Icon } from '../../ui/icons';
import { Empty, ErrorNote, LoadingBlock, ProductArt, Qty, StockPill, StoreTypeBadge, TextField, SelectField, TextArea, usd } from '../../ui/kit';
import { US_STATES } from '@retailgeo/core';

export function Cart() {
  const { data, loading, error, reload, setData } = useApi<any>('/cart');
  const setCount = useCart((s) => s.setCount);
  useEffect(() => { if (data) setCount(data.itemCount); }, [data, setCount]);
  const update = useAction(async (id: string, quantity: number) => {
    const c = await api.patch(`/cart/items/${id}`, { quantity });
    setData(c);
  });
  if (loading && !data) return <div className="wrap page"><LoadingBlock /></div>;
  return (
    <div className="wrap page stack">
      <h1 style={{ fontSize: '1.7rem' }}>Your cart</h1>
      <ErrorNote error={error} onRetry={reload} />
      {data && data.groups.length === 0 && (
        <div className="card"><Empty icon="cart" title="Your cart is empty" action={<Link to="/" className="btn primary">Find something nearby</Link>}>Add items from any store. Each store checks out separately because each one fulfills its own order.</Empty></div>
      )}
      {data?.groups.map((g: any) => (
        <section key={g.store.id} className="card" aria-labelledby={`g-${g.store.id}`}>
          <div className="card-h">
            <div className="row nowrap" style={{ minWidth: 0 }}>
              <StoreTypeBadge type={g.store.storeType} size={36} />
              <div style={{ minWidth: 0 }}>
                <h2 id={`g-${g.store.id}`} style={{ fontSize: '1.05rem' }}><Link to={`/store/${g.store.slug}`} style={{ color: 'inherit' }}>{g.store.name}</Link></h2>
                <div className="xsmall muted">{g.store.addressLine1}, {g.store.city} · <span style={{ color: g.store.isOpen ? 'var(--ok)' : undefined }}>{g.store.label}</span></div>
              </div>
            </div>
            <Link to={`/checkout/${g.store.id}`} className={`btn primary ${g.hasIssues ? 'disabled' : ''}`} aria-disabled={g.hasIssues} onClick={(e) => g.hasIssues && e.preventDefault()}>
              Check out · {usd(g.totals.totalCents)}
            </Link>
          </div>
          <div className="divider-list">
            {g.items.map((it: any) => (
              <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) auto', gap: 14, padding: '12px 18px', alignItems: 'center' }}>
                <div style={{ borderRadius: 8, overflow: 'hidden' }}><ProductArt name={it.product.name} size={it.product.size} ratio="1 / 1" /></div>
                <div className="stack tight" style={{ gap: 3, minWidth: 0 }}>
                  <Link to={`/product/${it.product.id}`} style={{ fontWeight: 700, color: 'inherit' }}>{it.product.name}</Link>
                  <span className="xsmall muted">{it.product.size} · {usd(it.unitCents)} each</span>
                  <div className="row tight">
                    <StockPill status={it.stockStatus} />
                    {it.offer && <span className="badge amber">{it.offer.name}: −{usd(it.discountCents)}</span>}
                  </div>
                  {it.issue && <span className="small" style={{ color: 'var(--bad)', fontWeight: 600 }}>{it.issue}</span>}
                </div>
                <div className="stack tight" style={{ alignItems: 'flex-end' }}>
                  <strong className="num">{usd(it.totalCents)}</strong>
                  <Qty value={it.quantity} max={Math.max(1, it.available)} onChange={(n) => update.run(it.id, n)} label={`Quantity of ${it.product.name}`} />
                  <button className="btn ghost sm danger" onClick={() => update.run(it.id, 0)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          <div className="card-b" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '4px 16px', borderTop: '1px solid var(--line)', fontSize: '0.92rem' }}>
            <span className="muted">Subtotal</span><span className="num r">{usd(g.totals.subtotalCents)}</span>
            {g.totals.discountCents > 0 && <><span className="muted">Offers</span><span className="num" style={{ color: 'var(--ok)' }}>−{usd(g.totals.discountCents)}</span></>}
            <span className="muted">Estimated tax ({g.totals.taxRate}%)</span><span className="num">{usd(g.totals.taxCents)}</span>
            <strong>Total for pickup</strong><strong className="num">{usd(g.totals.totalCents)}</strong>
          </div>
          {g.hasIssues && <div className="alert warn" style={{ margin: '0 18px 18px' }}>Fix the items marked above to check out from this store.</div>}
        </section>
      ))}
    </div>
  );
}

export function Checkout() {
  const { storeId } = useParams();
  const nav = useNavigate();
  const user = useSession((s) => s.user);
  const { data: cart, reload } = useApi<any>('/cart');
  const { data: addresses } = useApi<any[]>('/users/me/addresses');
  const g = useMemo(() => cart?.groups.find((x: any) => x.store.id === storeId), [cart, storeId]);
  const [fulfillment, setFulfillment] = useState<'pickup' | 'curbside' | 'delivery'>('pickup');
  const [addr, setAddr] = useState({ line1: '', city: 'Dallas', state: 'TX', zip: '' });
  const [method, setMethod] = useState<'card' | 'pay_in_store'>('card');
  const [card, setCard] = useState<CardInput>({ number: '', exp: '', cvc: '', zip: '' });
  const [cardErr, setCardErr] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<ApiError | null>(null);
  useEffect(() => { if (g) track('checkout_started', g.store.id); }, [g?.store.id]);
  useEffect(() => {
    const d = addresses?.find((a) => a.isDefault);
    if (d) setAddr({ line1: d.line1, city: d.city, state: d.state, zip: d.zip });
  }, [addresses]);

  const fee = fulfillment === 'delivery' ? g?.store.deliveryFeeCents ?? 0 : 0;
  const total = g ? g.totals.totalCents + fee : 0;
  const place = useAction(async () => {
    setProblem(null);
    let paymentToken: string | undefined;
    if (method === 'card') {
      const errs = validateCard(card);
      setCardErr(errs);
      if (Object.keys(errs).length) throw new ApiError(422, 'VALIDATION_FAILED', 'Check your card details.', []);
      paymentToken = await tokenizeCard(card);
    }
    try {
      const order = await api.post('/orders/checkout', {
        storeId, fulfillmentType: fulfillment, paymentMethod: method, paymentToken, notes: notes || undefined,
        deliveryAddress: fulfillment === 'delivery' ? addr : undefined, expectedTotalCents: total,
      }, { idempotent: true });
      void useCart.getState().refresh();
      toast({ tone: 'ok', title: `Order ${order.number} placed`, body: `${g.store.name} has your order.` });
      nav(`/account/orders/${order.id}?placed=1`);
    } catch (e) {
      if (e instanceof ApiError) {
        setProblem(e);
        if (e.code === 'CONFLICT' || e.code === 'INSUFFICIENT_STOCK') await reload();
      }
      throw e;
    }
  });

  if (!user) return null;
  if (!cart) return <div className="wrap page"><LoadingBlock /></div>;
  if (!g) return <div className="wrap page"><Empty icon="cart" title="Nothing to check out from this store" action={<Link className="btn" to="/cart">Back to cart</Link>} /></div>;
  const f = place.error?.fields ?? {};

  return (
    <div className="wrap page">
      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', alignItems: 'start' }}>
        <form className="stack loose" onSubmit={(e) => { e.preventDefault(); void place.run(); }} noValidate>
          <div className="stack tight">
            <Link to="/cart" className="small row tight"><Icon name="back" className="icon sm" /> Cart</Link>
            <h1 style={{ fontSize: '1.7rem' }}>Check out from {g.store.name}</h1>
          </div>
          {problem && (
            <div className="alert bad" role="alert">
              <Icon name="alert" className="icon sm" />
              <div>
                <strong>{problem.message}</strong>
                {Array.isArray(problem.details) && problem.details.filter((d: any) => d.issue).map((d: any) => <div key={d.storeProductId} className="small">{d.product}: {d.issue}</div>)}
              </div>
            </div>
          )}

          <fieldset className="card pad stack" style={{ border: '1px solid var(--line)' }}>
            <legend className="eyebrow" style={{ padding: '0 6px' }}>1 · How do you want it?</legend>
            <div className="grid cols-3" role="radiogroup" aria-label="Fulfillment">
              {([['pickup', 'Store pickup', 'Ready in about 30 min'], ['curbside', 'Curbside', 'We bring it to your car'], ['delivery', 'Delivery', g.store.deliveryEnabled ? `${usd(g.store.deliveryFeeCents)} · within ${g.store.serviceRadiusMi} mi` : 'Not offered by this store']] as const).map(([k, t, sub]) => (
                <label key={k} className="card pad" style={{ padding: 12, cursor: k === 'delivery' && !g.store.deliveryEnabled ? 'not-allowed' : 'pointer', opacity: k === 'delivery' && !g.store.deliveryEnabled ? 0.5 : 1, borderColor: fulfillment === k ? 'var(--brand)' : undefined, boxShadow: fulfillment === k ? 'inset 0 0 0 1px var(--brand)' : undefined }}>
                  <input type="radio" name="ff" className="sr-only" checked={fulfillment === k} disabled={k === 'delivery' && !g.store.deliveryEnabled} onChange={() => { setFulfillment(k); if (k === 'delivery') setMethod('card'); }} />
                  <strong style={{ display: 'block' }}>{t}</strong>
                  <span className="xsmall muted">{sub}</span>
                </label>
              ))}
            </div>
            {fulfillment === 'delivery' && (
              <div className="form-grid">
                <TextField label="Street address" wrapClass="span-2" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} error={f['deliveryAddress.line1']} autoComplete="street-address" />
                <TextField label="City" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} error={f['deliveryAddress.city']} autoComplete="address-level2" />
                <SelectField label="State" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })}>
                  {Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </SelectField>
                <TextField label="ZIP code" inputMode="numeric" value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} error={f['deliveryAddress.zip'] ?? f.deliveryAddress} autoComplete="postal-code" />
              </div>
            )}
            <TextArea label="Notes for the store (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
          </fieldset>

          <fieldset className="card pad stack" style={{ border: '1px solid var(--line)' }}>
            <legend className="eyebrow" style={{ padding: '0 6px' }}>2 · Payment</legend>
            <div className="segmented" role="group" aria-label="Payment method">
              <button type="button" aria-pressed={method === 'card'} onClick={() => setMethod('card')}>Card</button>
              <button type="button" aria-pressed={method === 'pay_in_store'} disabled={fulfillment === 'delivery'} onClick={() => setMethod('pay_in_store')}>Pay at pickup</button>
            </div>
            {method === 'card' ? (
              <>
                <div className="form-grid">
                  <TextField label="Card number" wrapClass="span-2" inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value.replace(/[^\d ]/g, '').slice(0, 23) })} error={cardErr.number} placeholder="1234 1234 1234 1234" />
                  <TextField label="Expires" placeholder="MM/YY" autoComplete="cc-exp" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value.slice(0, 5) })} error={cardErr.exp} />
                  <TextField label="Security code" inputMode="numeric" autoComplete="cc-csc" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })} error={cardErr.cvc} />
                  <TextField label="Billing ZIP" inputMode="numeric" autoComplete="postal-code" value={card.zip} onChange={(e) => setCard({ ...card, zip: e.target.value.replace(/\D/g, '').slice(0, 5) })} error={cardErr.zip} />
                </div>
                <div className="panel small">
                  <div className="row tight" style={{ marginBottom: 6 }}><Icon name="shield" className="icon sm" /><strong>Beta test cards</strong></div>
                  <div className="stack tight" style={{ gap: 4 }}>
                    {TEST_CARDS.map((t) => (
                      <button key={t.number} type="button" className="btn ghost sm" style={{ justifyContent: 'space-between' }} onClick={() => setCard({ number: t.number, exp: '12/29', cvc: '123', zip: '75214' })}>
                        <span className="mono">{t.number}</span><span className="faint">{t.note}</span>
                      </button>
                    ))}
                  </div>
                  <p className="xsmall faint" style={{ marginTop: 6 }}>Your card is authorized now and charged when the store marks the order ready. RetailGeo never stores card numbers.</p>
                </div>
              </>
            ) : (
              <p className="small muted">Pay the store when you pick up. The store may cancel unpaid orders after closing time.</p>
            )}
          </fieldset>

          <button className="btn primary lg" type="submit" disabled={place.busy}>{place.busy ? 'Placing order…' : `Place order · ${usd(total)}`}</button>
          <p className="xsmall faint">By placing this order you agree to the store's pickup policy and RetailGeo's Terms. Taxes are estimated at the store's local rate.</p>
        </form>

        <aside className="card" aria-label="Order summary" style={{ position: 'sticky', top: 140 }}>
          <div className="card-h"><h2 style={{ fontSize: '1.05rem' }}>Order summary</h2><span className="small muted">{g.items.reduce((s: number, i: any) => s + i.quantity, 0)} items</span></div>
          <div className="divider-list">
            {g.items.map((it: any) => (
              <div key={it.id} className="row between nowrap" style={{ padding: '10px 18px', fontSize: '0.9rem' }}>
                <span className="ellipsis">{it.quantity} × {it.product.name}</span>
                <span className="num">{usd(it.totalCents)}</span>
              </div>
            ))}
          </div>
          <div className="card-b" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 16px', borderTop: '1px solid var(--line)' }}>
            <span className="muted">Subtotal</span><span className="num">{usd(g.totals.subtotalCents)}</span>
            {g.totals.discountCents > 0 && <><span className="muted">Offers</span><span className="num" style={{ color: 'var(--ok)' }}>−{usd(g.totals.discountCents)}</span></>}
            <span className="muted">Tax ({g.totals.taxRate}%, {g.store.state})</span><span className="num">{usd(g.totals.taxCents)}</span>
            {fee > 0 && <><span className="muted">Delivery</span><span className="num">{usd(fee)}</span></>}
            <strong style={{ fontSize: '1.1rem' }}>Total</strong><strong className="num" style={{ fontSize: '1.1rem' }}>{usd(total)}</strong>
          </div>
        </aside>
      </div>
    </div>
  );
}
