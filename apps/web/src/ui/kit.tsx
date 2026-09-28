import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { Icon, ICON_PATHS, STORE_TYPE_COLOR, STORE_TYPE_ICON, type IconName } from './icons';
import { usd, miles, label as lbl, STORE_TYPE_LABEL } from '../lib/format';
import { useToasts } from '../state/store';

export function Logo({ sub }: { sub?: string }) {
  return (
    <span className="brand">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <rect x="1" y="1" width="32" height="32" rx="7" fill="var(--brand)" />
        <rect x="3.5" y="3.5" width="27" height="27" rx="5" fill="none" stroke="var(--brand-ink)" strokeWidth="1.6" />
        <path d="M17 8.5a6 6 0 0 0-6 6c0 4.4 6 10.9 6 10.9s6-6.5 6-10.9a6 6 0 0 0-6-6Zm0 8.3a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z" fill="var(--amber)" />
      </svg>
      <span>
        RetailGeo
        {sub && <small>{sub}</small>}
      </span>
    </span>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const d = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, d)}
      {hint && !error && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="err" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; wrapClass?: string };
export function TextField({ label, hint, error, wrapClass, className, ...rest }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapClass}>
      {(id, d) => <input id={id} className={`input ${className ?? ''}`} aria-invalid={!!error} aria-describedby={d} {...rest} />}
    </Field>
  );
}
export function SelectField({ label, hint, error, wrapClass, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string; wrapClass?: string }) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapClass}>
      {(id, d) => <select id={id} className="select" aria-invalid={!!error} aria-describedby={d} {...rest}>{children}</select>}
    </Field>
  );
}
export function TextArea({ label, hint, error, wrapClass, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string; wrapClass?: string }) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapClass}>
      {(id, d) => <textarea id={id} className="textarea" aria-invalid={!!error} aria-describedby={d} {...rest} />}
    </Field>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
    (focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="modal-h">
          <h2 id={id} style={{ fontSize: '1.15rem' }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><Icon name="x" /></button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="bar" />
          <div>
            <strong>{t.title}</strong>
            {t.body && (/^\d{6}$/.test(t.body) ? <span className="code">{t.body}</span> : <div className="small" style={{ opacity: 0.85, marginTop: 2 }}>{t.body}</div>)}
          </div>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="x" className="icon sm" /></button>
        </div>
      ))}
    </div>
  );
}

// ─── Commerce atoms ───────────────────────────────────────────────────
export function StockPill({ status, qty, showQty }: { status: string; qty?: number; showQty?: boolean }) {
  const map: Record<string, [string, string]> = { in_stock: ['ok', 'In stock'], low_stock: ['warn', 'Low stock'], out_of_stock: ['bad', 'Out of stock'] };
  const [tone, text] = map[status] ?? ['', status];
  return <span className={`badge ${tone}`}><span className="dot" />{text}{showQty && qty != null && status !== 'out_of_stock' ? ` · ${qty}` : ''}</span>;
}

export function Distance({ mi }: { mi: number | null | undefined }) {
  if (mi == null) return null;
  return <span className="shield" aria-label={`${mi} miles away`}>{miles(mi)}</span>;
}

export function Price({ cents, was, size = 'md' }: { cents: number; was?: number | null; size?: 'md' | 'lg' }) {
  return (
    <span className="tabular" style={{ font: `800 ${size === 'lg' ? '1.7rem' : '1.1rem'}/1 var(--font-display)` }}>
      {usd(cents)}
      {was != null && was > cents && <span className="was" style={{ textDecoration: 'line-through', color: 'var(--ink-3)', fontSize: '0.8em', fontWeight: 500, marginLeft: 6 }}><span className="sr-only">was </span>{usd(was)}</span>}
    </span>
  );
}

export function OfferTag({ offer }: { offer: { discountType: string; discountValue: number; buyQty?: number | null; getQty?: number | null; name?: string } | null | undefined }) {
  if (!offer) return null;
  const text = offer.discountType === 'percent' ? `${offer.discountValue}% off` : offer.discountType === 'fixed' ? `${usd(offer.discountValue)} off` : `Buy ${offer.buyQty} get ${offer.getQty}`;
  return <span className="tag-offer" title={offer.name}>{text}</span>;
}

export function StoreTypeBadge({ type, size = 44 }: { type: string; size?: number }) {
  return (
    <span className="stype" style={{ background: STORE_TYPE_COLOR[type] ?? 'var(--ink-3)', width: size, height: size, borderRadius: size / 4.4 }} aria-hidden="true">
      <Icon name={STORE_TYPE_ICON[type] ?? 'store'} className="icon" />
    </span>
  );
}
export const storeTypeLabel = (t: string) => STORE_TYPE_LABEL[t] ?? lbl(t);

const CAT_STYLE: Record<string, [string, IconName]> = {
  Grocery: ['#0a6647', 'basket'], 'Health & Pharmacy': ['#a3246b', 'pill'], Household: ['#4a5a2a', 'home'], Automotive: ['#b4541a', 'car'],
  Baby: ['#1f7ea0', 'baby'], Pet: ['#7a5230', 'paw'], Electronics: ['#3b4bb3', 'bolt'],
};
const SUB_TO_PARENT: Record<string, string> = {
  Beverages: 'Grocery', Snacks: 'Grocery', 'Dairy & Eggs': 'Grocery', Produce: 'Grocery', Bakery: 'Grocery', Pantry: 'Grocery', 'Frozen & Ice': 'Grocery', 'International Foods': 'Grocery',
  'Pain & Fever': 'Health & Pharmacy', 'Cold & Allergy': 'Health & Pharmacy', Vitamins: 'Health & Pharmacy', 'Personal Care': 'Health & Pharmacy', 'First Aid': 'Health & Pharmacy',
  Cleaning: 'Household', 'Paper Goods': 'Household', 'Home & Hardware': 'Household', 'Motor Oil & Fluids': 'Automotive', 'Car Care': 'Automotive',
  'Diapers & Wipes': 'Baby', 'Baby Food': 'Baby', Dog: 'Pet', Cat: 'Pet', 'Phone Accessories': 'Electronics', Batteries: 'Electronics',
};

/** Generated packshot tile (no third-party images): category color field, pictogram, brand + size label. */
export function ProductArt({ name, category, brand, size, className = 'art', ratio = '4 / 3' }: { name: string; category?: string | null; brand?: string | null; size?: string | null; className?: string; ratio?: string }) {
  const parent = category ? SUB_TO_PARENT[category] ?? category : 'Grocery';
  const [color, icon] = CAT_STYLE[parent] ?? ['#44544d', 'box'];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rot = (h % 24) - 12;
  return (
    <svg className={className} viewBox="0 0 160 120" style={{ aspectRatio: ratio }} role="img" aria-label={`${name}${size ? `, ${size}` : ''}`} preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="120" fill={color} />
      <circle cx={120 + (h % 20)} cy={20 + (h % 30)} r="46" fill="#fff" opacity="0.08" />
      <circle cx={20} cy={110} r="38" fill="#000" opacity="0.08" />
      <g transform={`translate(80 52) rotate(${rot}) translate(-22 -22)`}>
        <rect x="-4" y="-4" width="52" height="52" rx="12" fill="#fff" opacity="0.16" />
        <svg x="4" y="4" width="36" height="36" viewBox="0 0 24 24"><path d={ICON_PATHS[icon]} fill="#fff" /></svg>
      </g>
      <text x="10" y={size ? 96 : 106} fill="#fff" opacity="0.94" style={{ font: '700 9.5px var(--font-display)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{(brand ?? '').slice(0, 26)}</text>
      {size && <text x="10" y="110" fill="#fff" opacity="0.78" style={{ font: '600 8.5px var(--font-body)' }}>{size.slice(0, 30)}</text>}
    </svg>
  );
}

export function Empty({ icon = 'search', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="glyph"><Icon name={icon} /></span>
      <strong style={{ color: 'var(--ink)' }}>{title}</strong>
      {children && <div className="small" style={{ maxWidth: '44ch' }}>{children}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack tight" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={i === 0 ? 24 : 16} w={i === 0 ? '40%' : `${90 - i * 8}%`} />)}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert bad" role="alert">
      <Icon name="alert" className="icon sm" />
      <div className="grow">{error.message}</div>
      {onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Pager({ page, totalPages, total, onPage, noun = 'results' }: { page: number; totalPages: number; total: number; onPage: (p: number) => void; noun?: string }) {
  if (totalPages <= 1) return <div className="pager small muted">{total} {noun}</div>;
  return (
    <div className="pager">
      <span className="small muted">Page {page} of {totalPages} · {total} {noun}</span>
      <div className="row tight">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Kpi({ label, value, sub, to, tone }: { label: string; value: ReactNode; sub?: ReactNode; to?: string; tone?: 'attn' | 'alert' }) {
  const inner = (
    <>
      <span className="l">{label}</span>
      <span className="v">{value}</span>
      {sub && <span className="small muted">{sub}</span>}
    </>
  );
  return to ? <Link to={to} className={`kpi ${tone ?? ''}`}>{inner}</Link> : <div className={`kpi ${tone ?? ''}`}>{inner}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    completed: 'ok', active: 'ok', approved: 'ok', captured: 'ok', resolved: 'ok', ready: 'brand', accepted: 'brand', verified: 'ok',
    confirmed: 'info', processing: 'info', preparing: 'info', out_for_delivery: 'info', in_progress: 'info', authorized: 'info', submitted: 'info', scheduled: 'info',
    pending: 'warn', pending_acceptance: 'warn', pending_payment: 'warn', pending_review: 'warn', open: 'warn', draft: '', paused: '', pay_in_store: '', planned: '',
    cancelled: 'bad', rejected: 'bad', payment_failed: 'bad', failed: 'bad', suspended: 'bad', disabled: 'bad', refunded: '', partially_refunded: 'warn', expired: '', archived: '', closed: 'bad',
  };
  return <span className={`badge ${tone[status] ?? ''}`}>{lbl(status)}</span>;
}

export function Qty({ value, onChange, min = 1, max = 999, label = 'Quantity' }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label?: string }) {
  return (
    <span className="qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">−</button>
      <input value={value} inputMode="numeric" aria-label={label} onChange={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n))); }} />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase">+</button>
    </span>
  );
}

export function Steps({ steps, current, failed }: { steps: { key: string; label: string }[]; current: string; failed?: boolean }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="steps" role="list" aria-label="Progress">
      {steps.map((s, i) => (
        <div key={s.key} role="listitem" className={`s ${i < idx || (i === idx && i === steps.length - 1) ? 'done' : i === idx ? 'current done' : ''}`} aria-current={i === idx ? 'step' : undefined}>
          <span className="bar" style={failed && i === idx ? { background: 'var(--bad)' } : undefined} />
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Timeline({ items }: { items: { title: string; sub?: string; at: string; state?: 'done' | 'current' | 'bad' }[] }) {
  return (
    <ol className="timeline">
      {items.map((it, i) => (
        <li key={i} className={it.state ?? 'done'}>
          <span className="node">{it.state !== 'current' && <Icon name={it.state === 'bad' ? 'x' : 'check'} className="icon sm" style={{ width: 12, height: 12 }} />}</span>
          <div>
            <div style={{ fontWeight: 600 }}>{it.title}</div>
            <div className="xsmall faint">{it.at}{it.sub ? ` · ${it.sub}` : ''}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export { usd, miles };
