'use client';

import { useEffect, useState } from 'react';
import { createClientSpace, currentAccount, inviteClient, sb } from '@/lib/seek/backend';
import { PEOPLE } from '@/lib/seek/data';
import { isEmail } from '@/lib/seek/format';
import { learnProfiles } from '@/lib/seek/live';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { copyText } from './InviteDialog';

/**
 * Invite a client (backend mode): the pop-up from Clients → ＋ New. The client's email, the name of their space, an
 * optional welcome message and who on your team works on this client. Send invite creates the client's private
 * space and emails them "X invited you to <space>" with a Join button and a 6-digit code.
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

export function ClientInviteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (spaceId: string) => void }) {
  const { s, toast } = useSeek();
  const [email, setEmail] = useState('');
  const [space, setSpace] = useState('');
  const [msg, setMsg] = useState('');
  const [org, setOrg] = useState<string | null>(null);
  const [teammates, setTeammates] = useState<string[]>([]);
  const [team, setTeam] = useState<string[]>([]);
  const [made, setMade] = useState<{ id: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // your organisation and its team, to pick who works on this client
  useEffect(() => {
    void (async () => {
      const acc = await currentAccount();
      if (!acc?.workspace) return;
      setOrg(acc.workspace.id);
      const { data } = await sb().from('workspace_members').select('user_id, role').eq('workspace_id', acc.workspace.id);
      const ids = ((data ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'guest' && m.user_id !== acc.id).map((m) => m.user_id);
      await learnProfiles(ids, acc.id);
      setTeammates(ids);
    })();
  }, []);

  const e = email.trim().toLowerCase();
  const spaceName = space.trim() || spaceFromEmail(e) || 'Client space';

  /** Creates the client's space once (pressing again reuses it). */
  const ensureSpace = async (): Promise<string | null> => {
    if (made && made.email === e) return made.id;
    if (!isEmail(e)) {
      toast('Enter the client’s email');
      return null;
    }
    if (!org) return null;
    const { error, id } = await createClientSpace({
      orgId: org,
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
    setMade({ id, email: e });
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
    toast(`Invite sent to ${e} · ${spaceName} is ready`);
    onCreated(id);
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

  return (
    <Modal
      title="Invite a client"
      icon={
        <span className="av" style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gold)', fontSize: 12 }}>
          {codeOf(spaceName)}
        </span>
      }
      onClose={() => {
        if (made) onCreated(made.id);
        else onClose();
      }}
      width={500}
      footer={
        <>
          <button type="button" className="btn" disabled={busy || !org} onClick={() => void copyLink()}>
            🔗 Copy invite link
          </button>
          <button type="button" className="btn pri" style={{ flex: 1 }} disabled={busy || !org} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </>
      }
    >
      <form
        className="mb"
        onSubmit={(ev) => {
          ev.preventDefault();
          void send();
        }}
      >
        <p style={{ margin: 0, color: 'var(--mu)', fontSize: 13.5 }}>They get their own private space and an email with a Join now button. Clicking it emails them a sign-in code. No password.</p>
        <div className="fld">
          <label htmlFor="ci-e">Client email</label>
          <input className="inp" id="ci-e" type="email" placeholder="chris@client.com" value={email} disabled={!!made} autoFocus onChange={(ev) => setEmail(ev.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="ci-s">Space name</label>
          <input className="inp" id="ci-s" placeholder={spaceFromEmail(e) || 'Hollow & Bright'} maxLength={80} value={space} disabled={!!made} onChange={(ev) => setSpace(ev.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="ci-m">
            Welcome message <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea className="inp" id="ci-m" rows={3} maxLength={500} placeholder={DEFAULT_MSG} value={msg} disabled={!!made} onChange={(ev) => setMsg(ev.target.value)} />
        </div>
        <div className="fld">
          <label>
            Your team on this client <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(you’re included)</span>
          </label>
          {teammates.length ? (
            <div className="chips">
              {teammates.map((id) => {
                const on = team.includes(id);
                return (
                  <button key={id} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} disabled={!!made} onClick={() => setTeam((t) => (on ? t.filter((x) => x !== id) : [...t, id]))}>
                    {on ? '✓ ' : ''}
                    {PEOPLE[id]?.name ?? 'Teammate'}
                  </button>
                );
              })}
            </div>
          ) : (
            <em>Just you for now. Teammates you invite to {s.ws.name || 'your workspace'} can be added later from People.</em>
          )}
        </div>
      </form>
    </Modal>
  );
}
