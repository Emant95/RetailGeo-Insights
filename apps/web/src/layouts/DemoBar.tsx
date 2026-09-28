import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@retailgeo/core';
import { api, demo } from '../api';
import { DemoTransport } from '../api/demo';
import { toast, useSession, useCart } from '../state/store';
import { Modal } from '../ui/kit';

const HOME: Record<string, string> = { consumer: '/', merchant_admin: '/merchant', store_employee: '/merchant', platform_admin: '/admin', platform_support: '/admin' };

/** Beta demo helper: one-click role switching and an email outbox (verification links, MFA codes). */
export function DemoBar() {
  const user = useSession((s) => s.user);
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [outbox, setOutbox] = useState(false);
  const [, force] = useState(0);
  useEffect(() => demo?.onEmail((m) => {
    force((n) => n + 1);
    if (m.kind === 'mfa') toast({ tone: 'info', title: 'Sign-in code (demo email)', body: m.body.match(/\d{6}/)?.[0] });
  }), []);
  if (!demo) return null;

  const switchTo = async (email: string, role: string) => {
    setBusy(email);
    try {
      if (api.current) await api.post('/auth/logout').catch(() => undefined);
      api.setSession(null);
      const r = await api.post('/auth/login', { email, password: DEMO_PASSWORD });
      if (r.mfaRequired) {
        const code = demo!.outbox.sent.filter((m) => m.to === email && m.kind === 'mfa').at(-1)?.body.match(/\d{6}/)?.[0];
        const s = await api.post('/auth/mfa', { challengeId: r.challengeId, code });
        api.setSession(s);
      } else api.setSession(r);
      void useCart.getState().refresh();
      nav(HOME[role]);
    } catch (e) {
      toast({ tone: 'bad', title: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="demo-bar">
      <div className="wrap">
        <strong style={{ letterSpacing: '0.04em' }}>BETA DEMO</strong>
        <span style={{ opacity: 0.75 }} className="desc">Sample data for Dallas–Fort Worth, Houston and Austin.</span>
        <span style={{ opacity: 0.75 }}>View as:</span>
        {DEMO_ACCOUNTS.map((a) => (
          <button key={a.email} aria-pressed={user?.email === a.email} disabled={!!busy} onClick={() => switchTo(a.email, a.role)}>
            {busy === a.email ? '…' : a.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }} />
        <button onClick={() => setOutbox(true)}>Email outbox ({demo.outbox.sent.length})</button>
        <button onClick={() => { DemoTransport.reset(); location.hash = '#/'; location.reload(); }}>Reset data</button>
      </div>
      {outbox && (
        <Modal title="Email outbox" onClose={() => setOutbox(false)} wide>
          <p className="small muted" style={{ marginBottom: 12 }}>In production these go out through the email provider. The demo keeps them here so you can follow verification links and read sign-in codes.</p>
          {demo.outbox.sent.length === 0 ? <p className="muted">No emails yet. Place an order, register, or sign in as the platform admin.</p> : (
            <div className="stack tight">
              {[...demo.outbox.sent].reverse().map((m, i) => (
                <div key={i} className="card pad" style={{ padding: 12 }}>
                  <div className="row between"><strong>{m.subject}</strong><span className="xsmall faint">{new Date(m.at).toLocaleTimeString()}</span></div>
                  <div className="xsmall faint">To {m.to}</div>
                  <div className="small" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{m.body}</div>
                </div>
              ))}
            </div>
          )}
          <p className="xsmall faint" style={{ marginTop: 12 }}>All demo accounts use the password <span className="mono">{DEMO_PASSWORD}</span>.</p>
        </Modal>
      )}
    </div>
  );
}
