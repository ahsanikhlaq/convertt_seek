'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClientSpace, currentAccount, inviteClient, sb } from '@/lib/seek/backend';
import { PEOPLE } from '@/lib/seek/data';
import { isEmail } from '@/lib/seek/format';
import { learnProfiles } from '@/lib/seek/live';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { copyText } from '../InviteDialog';

/**
 * Invite a client (backend mode), as in the prototype: the client's email, the space name and an optional welcome
 * message, plus who on your team works on this client. Sending creates the client's private space and emails them a
 * Join link with a 6-digit code. The middle panel shows the email they get; the right one, what happens next.
 */

const DEFAULT_MSG = 'Chat with the team, follow progress and approve work in one place.';
const codeOf = (name: string) =>
  name
    .split(/[\s&]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase() || 'C';
const spaceFromEmail = (e: string) => {
  const d = e.split('@')[1]?.split('.')[0] ?? '';
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : '';
};

export function LiveInvitePage() {
  const { s, update, toast } = useSeek();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [space, setSpace] = useState('');
  const [msg, setMsg] = useState('');
  const [org, setOrg] = useState<{ id: string; me: string; myName: string } | null>(null);
  const [teammates, setTeammates] = useState<string[]>([]);
  const [team, setTeam] = useState<string[]>([]);
  const [made, setMade] = useState<{ id: string; email: string; space: string; sent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // your organisation and its team, to pick who works on this client
  useEffect(() => {
    void (async () => {
      const acc = await currentAccount();
      if (!acc?.workspace) return;
      setOrg({ id: acc.workspace.id, me: acc.id, myName: (acc.name.trim() || acc.email.split('@')[0]).split(' ')[0] });
      const { data } = await sb().from('workspace_members').select('user_id, role').eq('workspace_id', acc.workspace.id);
      const ids = ((data ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'guest' && m.user_id !== acc.id).map((m) => m.user_id);
      await learnProfiles(ids, acc.id);
      setTeammates(ids);
    })();
  }, []);

  const e = email.trim().toLowerCase();
  const spaceName = space.trim() || spaceFromEmail(e) || 'Client space';
  const agency = s.ws.name || 'your agency';
  const step = made?.sent ? 3 : made ? 2 : 1;

  /** Creates the client's space once (the same space is reused for a second press). */
  const ensureSpace = async (): Promise<string | null> => {
    if (made && made.email === e) return made.id;
    if (!isEmail(e)) {
      toast('Enter the client’s email');
      return null;
    }
    if (!org) return null;
    const { error, id } = await createClientSpace({
      orgId: org.id,
      name: spaceName,
      project: '',
      code: codeOf(spaceName),
      color: '#8a5300',
      replyTarget: '1 working day',
      tone: '',
      neverMention: [],
      people: [{ email: e, name: '', role: 'approver' }],
      team,
      steps: [],
      welcome: msg.trim() || `Welcome to ${spaceName}! ${DEFAULT_MSG}`,
    });
    if (error || !id) {
      toast(error || 'Couldn’t create the client space. Try again');
      return null;
    }
    setMade({ id, email: e, space: spaceName, sent: false });
    return id;
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    const id = await ensureSpace();
    if (!id) {
      setBusy(false);
      return;
    }
    const r = await inviteClient(id, e, msg.trim());
    setBusy(false);
    if (!r.ok) {
      toast(r.message);
      return;
    }
    setMade({ id, email: e, space: spaceName, sent: true });
    toast('Invite sent to ' + e);
  };

  const copyLink = async () => {
    if (busy) return;
    setBusy(true);
    const id = await ensureSpace();
    setBusy(false);
    if (!id) return;
    const ok = await copyText(`${location.origin}/signup`);
    toast(ok ? `Invite link copied. ${e} signs in with that email and lands in ${spaceName}` : 'Couldn’t copy the link');
  };

  const openSpace = () => {
    if (!made) return;
    update((d) => {
      d.cs = made.id;
      d.cTab = 'Client chat';
    });
    router.push(ROUTES.clients);
  };

  const st = (n: number) => (step === n ? 'on' : step > n ? '' : 'dim');
  const chip = (id: string) => {
    const on = team.includes(id);
    return (
      <button key={id} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} disabled={!!made} onClick={() => setTeam((t) => (on ? t.filter((x) => x !== id) : [...t, id]))}>
        {on ? '✓ ' : ''}
        {PEOPLE[id]?.name ?? 'Teammate'}
      </button>
    );
  };

  return (
    <main className="inv">
      <div className="hd">
        <Link className="btn sm" href={ROUTES.clients}>
          ← Clients
        </Link>
        <h1>Invite a client</h1>
        <div className="steps">
          {['You send', 'Client email', 'Client joins'].map((t, n) => (
            <span key={t} style={{ display: 'contents' }}>
              {n > 0 && <hr />}
              <span className={step > n + 1 ? 'd' : step === n + 1 ? 'c' : ''}>
                <i>{step > n + 1 ? '✓' : n + 1}</i>
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
            onSubmit={(ev) => {
              ev.preventDefault();
              void send();
            }}
          >
            <div>
              <b style={{ fontSize: 17 }}>Invite a client</b>
              <div style={{ color: 'var(--mu)', fontSize: 13 }}>They get their own private space.</div>
            </div>
            <div className="fld">
              <label htmlFor="ie">Client email</label>
              <input className="inp" id="ie" type="email" placeholder="chris@client.com" value={email} disabled={!!made} onChange={(ev) => setEmail(ev.target.value)} />
            </div>
            <div className="fld">
              <label htmlFor="isn">Space name</label>
              <input className="inp" id="isn" placeholder={spaceFromEmail(e) || 'Hollow & Bright'} maxLength={80} value={space} disabled={!!made} onChange={(ev) => setSpace(ev.target.value)} />
            </div>
            <div className="fld">
              <label htmlFor="im">
                Welcome message <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea className="inp" id="im" rows={2} maxLength={500} value={msg} disabled={!!made} onChange={(ev) => setMsg(ev.target.value)} />
            </div>
            <div className="fld">
              <label>
                Your team on this client <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(you’re included)</span>
              </label>
              {teammates.length ? (
                <div className="chips">{teammates.map(chip)}</div>
              ) : (
                <em>Just you for now. Teammates you invite to {agency} can be added later from People.</em>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" disabled={busy || !org} onClick={() => void copyLink()}>
                🔗 Copy invite link
              </button>
              <button type="submit" className="btn pri" style={{ flex: 1 }} disabled={busy || !org || made?.sent}>
                {busy ? 'Sending…' : made?.sent ? 'Invite sent ✓' : 'Send invite'}
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
                <b style={{ fontSize: 13.5, display: 'block' }}>
                  {org?.myName ?? 'You'} at {agency}
                </b>
                <small style={{ color: 'var(--sb)' }}>to {e || 'the client'}</small>
              </div>
            </div>
            <h2>
              {org?.myName ?? 'You'} invited you to {spaceName}
            </h2>
            <p>{msg.trim() || DEFAULT_MSG}</p>
            <button type="button" className="btn lg pri" disabled>
              Join now
            </button>
            <p className="fine">No password. You&apos;ll get a sign-in code.</p>
          </div>
        </div>
        <div className={'ip ' + st(3)}>
          <div className="k">
            <b>3 · THE CLIENT JOINS</b>
          </div>
          <div className="c" style={{ alignItems: 'center', textAlign: 'center' }}>
            <span className="av" style={{ width: 52, height: 52, background: 'var(--gold)', borderRadius: 14, fontSize: 18 }}>
              {codeOf(spaceName)}
            </span>
            <div>
              <b style={{ fontSize: 13, color: 'var(--sb)' }}>{spaceName} · Their project space</b>
              <h2 style={{ margin: '4px 0 0', fontSize: 21 }}>{made?.sent ? 'Invite on its way' : 'Waiting for the invite'}</h2>
            </div>
            <p style={{ margin: 0, color: 'var(--mu)' }}>
              {made?.sent
                ? `${made.email} clicks Join, types the 6-digit code from the email and lands in ${made.space}. You’ll get a notification when they write.`
                : 'They click Join, type the 6-digit code from the email and land in their own space. No password.'}
            </p>
            <button type="button" className="btn lg gold" disabled={!made} onClick={openSpace}>
              Open {made ? made.space : 'the space'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
