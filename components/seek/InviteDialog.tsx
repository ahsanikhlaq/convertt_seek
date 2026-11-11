'use client';

import { useEffect, useId, useState } from 'react';
import { backendOn, currentAccount, joinLink, resetJoinCode } from '@/lib/seek/backend';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { OrgMark } from './ui';

/** Copies text, with a fallback for browsers that block the clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

/** The organization's shareable invite link, with Copy (and, for admins, Reset). */
export function InviteLink({ code, onCode }: { code: string | null; onCode?: (c: string) => void }) {
  const { s, toast } = useSeek();
  const [busy, setBusy] = useState(false);
  const link = code ? joinLink(code) : '';
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (backendOn) void currentAccount().then((a) => setAdmin(['owner', 'admin'].includes(a?.workspace?.role ?? '')));
  }, []);
  return (
    <div className="fld">
      <label>Invite link</label>
      <div className="copyrow">
        <input className="inp" readOnly value={link || 'Loading…'} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn pri" disabled={!link} onClick={async () => toast((await copyText(link)) ? 'Invite link copied' : 'Couldn’t copy. Select the link and copy it')}>
          Copy
        </button>
      </div>
      <em>
        Anyone with this link can join {s.ws.name || 'your organization'} after confirming their email.
        {admin && onCode && (
          <>
            {' '}
            <button
              type="button"
              className="linkbtn"
              disabled={busy}
              onClick={async () => {
                const w = (await currentAccount())?.workspace;
                if (!w) return;
                setBusy(true);
                const r = await resetJoinCode(w.id);
                setBusy(false);
                if (r.code) {
                  onCode(r.code);
                  toast('New invite link ready. The old one no longer works');
                } else toast(r.error ?? 'Couldn’t reset the link');
              }}
            >
              Reset link
            </button>
          </>
        )}
      </em>
    </div>
  );
}

/** Invite people: share the organization's link, or email someone an invite. */
export function InviteDialog({ onClose, invite }: { onClose: () => void; invite: (email: string) => Promise<string> }) {
  const { s, toast } = useSeek();
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!backendOn) {
      setCode('demo-link');
      return;
    }
    void currentAccount().then((a) => setCode(a?.workspace?.joinCode ?? null));
  }, []);

  const send = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    const msg = await invite(email);
    setBusy(false);
    toast(msg);
    if (msg !== 'Enter a valid email') setEmail('');
  };

  return (
    <Modal
      title={
        <span className="joinorg">
          <OrgMark name={s.ws.name} logo={s.ws.logo} size={28} />
          Invite people to {s.ws.name || 'your organization'}
        </span>
      }
      onClose={onClose}
      width={480}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="mb">
        <InviteLink code={code} onCode={setCode} />
        <form
          className="fld"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={id}>Or send an invite by email</label>
          <div className="copyrow">
            <input id={id} className="inp" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)' }} />
            <button type="submit" className="btn" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
          <em>They get an email with a Join button and a 6-digit code.</em>
        </form>
      </div>
    </Modal>
  );
}
