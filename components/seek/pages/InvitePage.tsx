'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isEmail } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { CodeInput } from '../CodeInput';

export function InvitePage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const i = s.inv;
  const [email, setEmail] = useState(i.email);
  const [space, setSpace] = useState(i.space);
  const [msg, setMsg] = useState(i.msg);
  const st = (n: number) => (i.step === n ? 'on' : i.step > n ? '' : 'dim');

  const sendInvite = () => {
    const e = email.trim();
    if (!isEmail(e)) {
      toast("Enter the client's email");
      return;
    }
    update((d) => {
      d.inv = { step: 2, email: e, space: space.trim() || 'Client space', msg };
    });
    toast('Invite sent to ' + e);
  };

  const openSpace = () => {
    if (i.step < 3) return;
    update((d) => {
      d.inv.step = 1;
      d.cs = 'HB';
      d.cTab = 'Client chat';
    });
    toast('Chris joined Hollow & Bright ✓');
    router.push(ROUTES.clients);
  };

  return (
    <div className="inv">
      <div className="hd">
        <Link className="btn sm" href={ROUTES.clients}>
          ← Clients
        </Link>
        <h1>Invite a client</h1>
        <div className="steps">
          {['You send', 'Client email', 'Client joins'].map((t, n) => (
            <span key={t} style={{ display: 'contents' }}>
              {n > 0 && <hr />}
              <span className={i.step > n + 1 ? 'd' : i.step === n + 1 ? 'c' : ''}>
                <i>{i.step > n + 1 ? '✓' : n + 1}</i>
                <span className="hide-m">{t}</span>
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="row">
        <div className={'ip ' + st(1)}>
          <div className="k">
            <b>1 · YOU SEND THE INVITE</b>
          </div>
          <form
            className="c"
            onSubmit={(e) => {
              e.preventDefault();
              sendInvite();
            }}
          >
            <div>
              <b style={{ fontSize: 17 }}>Invite a client</b>
              <div style={{ color: 'var(--mu)', fontSize: 13 }}>They get their own private space.</div>
            </div>
            <div className="fld">
              <label htmlFor="ie">Client email</label>
              <input className="inp" id="ie" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="fld">
              <label htmlFor="isn">Space name</label>
              <input className="inp" id="isn" value={space} onChange={(e) => setSpace(e.target.value)} />
            </div>
            <div className="fld">
              <label htmlFor="im">
                Welcome message <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea className="inp" id="im" rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={() => toast('Invite link copied')}>
                🔗 Copy invite link
              </button>
              <button type="submit" className="btn pri" style={{ flex: 1 }}>
                Send invite
              </button>
            </div>
          </form>
        </div>
        <div className={'ip ' + st(2)}>
          <div className="k">
            <b>2 · THE CLIENT GETS AN EMAIL</b>
            <span className="tag">Inbox</span>
          </div>
          <div className="c email">
            <div className="fr">
              <span className="av" style={{ width: 34, height: 34, background: 'var(--v)', borderRadius: 10, fontSize: 14 }}>
                S
              </span>
              <div>
                <b style={{ fontSize: 13.5, display: 'block' }}>Ahsan at Convertt</b>
                <small style={{ color: 'var(--sb)' }}>to {i.email}</small>
              </div>
            </div>
            <h3>Ahsan invited you to {i.space}</h3>
            <p>{i.msg || 'Chat with the team, follow progress and approve work in one place.'}</p>
            <button
              type="button"
              className="btn lg pri"
              disabled={i.step < 2}
              onClick={() =>
                update((d) => {
                  d.inv.step = 3;
                })
              }
            >
              Join now
            </button>
            <p className="fine">No password. You'll get a sign-in code.</p>
          </div>
        </div>
        <div className={'ip ' + st(3)}>
          <div className="k">
            <b>3 · THE CLIENT JOINS</b>
          </div>
          <div className="c" style={{ alignItems: 'center', textAlign: 'center' }}>
            <span className="av" style={{ width: 52, height: 52, background: 'var(--gold)', borderRadius: 14, fontSize: 18 }}>
              HB
            </span>
            <div>
              <b style={{ fontSize: 13, color: 'var(--sb)' }}>{i.space} · Your project space</b>
              <h3 style={{ margin: '4px 0 0', fontSize: 21 }}>Welcome, Chris</h3>
            </div>
            <p style={{ margin: 0, color: 'var(--mu)' }}>Enter the 6-digit code we just emailed you.</p>
            <CodeInput key={i.step} disabled={i.step < 3} onComplete={openSpace} label="Client sign-in code" />
            <button type="button" className="btn lg gold" disabled={i.step < 3} onClick={openSpace}>
              Open my space
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
