import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, STORE_TYPES, US_STATES } from '@retailgeo/core';
import { api, demo } from '../../api';
import { useCart, useSession, toast } from '../../state/store';
import { useAction } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Logo, SelectField, TextField, storeTypeLabel } from '../../ui/kit';

const homeFor = (roles: string[]) => (roles.includes('platform_admin') || roles.includes('platform_support') ? '/admin' : roles.includes('merchant_admin') || roles.includes('store_employee') ? '/merchant' : '/');

function Shell({ children, title, sub }: { children: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="auth-shell">
      <div className="auth-card stack">
        <Link to="/" style={{ textDecoration: 'none', alignSelf: 'center' }}><Logo /></Link>
        <div className="card pad stack" style={{ padding: 28 }}>
          <div className="stack tight"><h1 style={{ fontSize: '1.5rem' }}>{title}</h1>{sub && <p className="small muted">{sub}</p>}</div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const finish = (s: any) => {
    api.setSession(s);
    void useCart.getState().refresh();
    toast({ tone: 'ok', title: `Signed in as ${s.user.fullName}` });
    nav(params.get('next') ?? homeFor(s.user.roles), { replace: true });
  };
  const login = useAction(async (e?: string, p?: string) => {
    const r = await api.post('/auth/login', { email: e ?? email, password: p ?? password });
    if (r.mfaRequired) {
      setChallenge(r.challengeId);
      if (e) setEmail(e);
      return;
    }
    finish(r);
  });
  const mfa = useAction(async () => finish(await api.post('/auth/mfa', { challengeId: challenge, code })));

  if (challenge) {
    return (
      <Shell title="Enter your sign-in code" sub={`Administrator accounts need a second step. We sent a 6-digit code to ${email}.`}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void mfa.run(); }}>
          <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} error={mfa.error?.message} autoFocus className="mono" style={{ letterSpacing: '0.3em', fontSize: '1.2rem' }} />
          {demo && <p className="xsmall faint">Demo: the code appears in a notification and in the Email outbox.</p>}
          <button className="btn primary lg" disabled={code.length !== 6 || mfa.busy}>Verify and sign in</button>
          <button type="button" className="btn ghost" onClick={() => setChallenge(null)}>Use a different account</button>
        </form>
      </Shell>
    );
  }
  return (
    <Shell title="Sign in" sub="Shoppers, store teams and RetailGeo staff all sign in here.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void login.run(); }}>
        {login.error && !Object.keys(login.error.fields).length && <div className="alert bad" role="alert">{login.error.message}</div>}
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={login.error?.fields.email} />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn primary lg" disabled={login.busy}>{login.busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="row between small"><Link to="/forgot">Forgot password?</Link><Link to="/register">Create an account</Link></div>
      </form>
      {demo && (
        <div className="stack tight">
          <hr className="rule" />
          <span className="eyebrow">Demo accounts</span>
          <div className="demo-accounts">
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" onClick={() => login.run(a.email, DEMO_PASSWORD)} disabled={login.busy}>
                <span><strong>{a.label}</strong><span className="xsmall faint" style={{ display: 'block' }}>{a.name} · {a.email}</span></span>
                <Icon name="chevron" className="icon sm" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

export function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', marketingConsent: false, agree: false });
  const reg = useAction(async () => {
    if (!form.agree) throw new Error('Agree to the Terms and Privacy notice to continue.');
    const s = await api.post('/auth/register', { fullName: form.fullName, email: form.email, password: form.password, marketingConsent: form.marketingConsent });
    api.setSession(s);
    toast({ tone: 'ok', title: 'Welcome to RetailGeo', body: 'Check your email to confirm your address.' });
    nav('/');
  });
  const f = reg.error?.fields ?? {};
  return (
    <Shell title="Create your account" sub="Save stores, order ahead and track pickups.">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void reg.run(); }}>
        <TextField label="Full name" autoComplete="name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={f.fullName} />
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={f.email} />
        <TextField label="Password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={f.password} hint="At least 10 characters, with a letter and a number." />
        <label className="check"><input type="checkbox" checked={form.marketingConsent} onChange={(e) => setForm({ ...form, marketingConsent: e.target.checked })} /> Email me offers from nearby stores (optional)</label>
        <label className="check"><input type="checkbox" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} /> <span>I agree to the <Link to="/legal/terms">Terms</Link> and <Link to="/legal/privacy">Privacy notice</Link></span></label>
        <button className="btn primary lg" disabled={reg.busy}>Create account</button>
        <p className="small muted" style={{ textAlign: 'center' }}>Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const go = useAction(async () => setDone((await api.post('/auth/forgot-password', { email })).message));
  return (
    <Shell title="Reset your password" sub="We'll email you a link that works for 30 minutes.">
      {done ? <div className="alert ok">{done}</div> : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void go.run(); }}>
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={go.error?.fields.email} autoComplete="email" />
          <button className="btn primary lg" disabled={go.busy}>Send reset link</button>
        </form>
      )}
      <Link to="/login" className="small">Back to sign in</Link>
    </Shell>
  );
}

export function Reset() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const go = useAction(async () => { await api.post('/auth/reset-password', { token: params.get('token'), password }); toast({ tone: 'ok', title: 'Password updated. Sign in with your new password.' }); nav('/login'); });
  return (
    <Shell title="Choose a new password">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void go.run(); }}>
        {go.error && !go.error.fields.password && <div className="alert bad">{go.error.message}</div>}
        <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={go.error?.fields.password} hint="At least 10 characters, with a letter and a number." />
        <button className="btn primary lg" disabled={go.busy}>Update password</button>
      </form>
    </Shell>
  );
}

export function Verify() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.post('/auth/verify-email', { token: params.get('token') }).then(() => setState('ok'), (e) => { setState('bad'); setMsg(e.message); });
  }, [params]);
  return (
    <Shell title={state === 'ok' ? 'Email confirmed' : state === 'bad' ? 'Link not valid' : 'Confirming…'}>
      {state === 'ok' && <div className="alert ok">Thanks. Your email address is confirmed.</div>}
      {state === 'bad' && <div className="alert bad">{msg}</div>}
      <Link to="/" className="btn">Go to RetailGeo</Link>
    </Shell>
  );
}

export function Sell() {
  const user = useSession((s) => s.user);
  const nav = useNavigate();
  const [form, setForm] = useState({ legalName: '', dbaName: '', einLast4: '', contactEmail: user?.email ?? '', contactPhone: '', store: { name: '', storeType: 'convenience', addressLine1: '', city: 'Dallas', state: 'TX', zip: '', phone: '' } });
  const [done, setDone] = useState<any>(null);
  const apply = useAction(async () => {
    const r = await api.post('/merchant/applications', { ...form, dbaName: form.dbaName || undefined, einLast4: form.einLast4 || undefined, contactPhone: form.contactPhone || undefined, store: { ...form.store, phone: form.store.phone || undefined } });
    const me = await api.get('/auth/me');
    api.setSession({ ...api.current!, user: me });
    setDone(r);
  });
  const f = apply.error?.fields ?? {};
  const st = (k: keyof typeof form.store, v: string) => setForm({ ...form, store: { ...form.store, [k]: v } });
  return (
    <div className="wrap page" style={{ maxWidth: 920 }}>
      <div className="stack loose">
        <div className="stack tight">
          <span className="eyebrow">Sell on RetailGeo</span>
          <h1>Bring your store onto the local network</h1>
          <p className="muted" style={{ maxWidth: '62ch' }}>Shoppers nearby see what you have in stock. Other stores can source from you when they run low, and you can source from them. Beta is open to physical stores in Dallas–Fort Worth, Houston and Austin.</p>
        </div>
        <div className="grid cols-3">
          {[['pin', 'Be found nearby', 'Your products appear in searches within your service area, with live stock.'], ['swap', 'Store-to-store sourcing', 'Request stock from nearby stores and sell your surplus wholesale.'], ['chart', 'Know what sells', 'Orders, views and inventory history in one dashboard.']].map(([i, t, d]) => (
            <div key={t} className="card pad stack tight"><Icon name={i as any} style={{ color: 'var(--brand-text)' }} /><strong>{t}</strong><span className="small muted">{d}</span></div>
          ))}
        </div>
        {!user ? (
          <div className="card pad row between"><span>Create a free account or sign in to apply.</span><div className="row"><Link to="/register" className="btn primary">Create account</Link><Link to="/login?next=/sell" className="btn">Sign in</Link></div></div>
        ) : done ? (
          <div className="card pad stack">
            <div className="alert ok"><Icon name="check" className="icon sm" /><div><strong>Application received for {done.store.name}.</strong> Our team verifies new stores within two business days{done.marketName ? ` (${done.marketName} market)` : ''}. You can set up your catalog now; it goes live when you're approved.</div></div>
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/merchant')}>Open the merchant portal</button>
          </div>
        ) : (
          <form className="card pad stack loose" onSubmit={(e) => { e.preventDefault(); void apply.run(); }}>
            {apply.error && !Object.keys(f).length && <div className="alert bad">{apply.error.message}</div>}
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend><h2 style={{ fontSize: '1.1rem' }}>Business</h2></legend>
              <div className="form-grid">
                <TextField label="Legal business name" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} error={f.legalName} />
                <TextField label="Doing business as (optional)" value={form.dbaName} onChange={(e) => setForm({ ...form, dbaName: e.target.value })} />
                <TextField label="EIN, last 4 digits" hint="Used to verify your business. We never ask for the full number here." inputMode="numeric" value={form.einLast4} onChange={(e) => setForm({ ...form, einLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })} error={f.einLast4} />
                <TextField label="Business email" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} error={f.contactEmail} />
                <TextField label="Business phone (optional)" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} inputMode="tel" />
              </div>
            </fieldset>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend><h2 style={{ fontSize: '1.1rem' }}>First store</h2></legend>
              <div className="form-grid">
                <TextField label="Store name" value={form.store.name} onChange={(e) => st('name', e.target.value)} error={f['store.name']} />
                <SelectField label="Store type" value={form.store.storeType} onChange={(e) => st('storeType', e.target.value)}>{STORE_TYPES.map((t) => <option key={t} value={t}>{storeTypeLabel(t)}</option>)}</SelectField>
                <TextField label="Street address" wrapClass="span-2" value={form.store.addressLine1} onChange={(e) => st('addressLine1', e.target.value)} error={f['store.addressLine1']} autoComplete="street-address" />
                <TextField label="City" value={form.store.city} onChange={(e) => st('city', e.target.value)} error={f['store.city']} />
                <SelectField label="State" value={form.store.state} onChange={(e) => st('state', e.target.value)}>{Object.entries(US_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
                <TextField label="ZIP code" value={form.store.zip} onChange={(e) => st('zip', e.target.value)} error={f['store.zip']} inputMode="numeric" hint="Beta ZIPs: e.g. 75201–75243, 76102, 77006, 78704" />
                <TextField label="Store phone (optional)" value={form.store.phone} onChange={(e) => st('phone', e.target.value)} inputMode="tel" />
              </div>
            </fieldset>
            <button className="btn primary lg" disabled={apply.busy} style={{ alignSelf: 'flex-start' }}>Submit application</button>
          </form>
        )}
      </div>
    </div>
  );
}

export { homeFor, US_STATES };
