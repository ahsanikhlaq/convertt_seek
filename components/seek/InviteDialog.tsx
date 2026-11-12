'use client';

import { useEffect, useId, useState } from 'react';
import { backendOn, currentAccount, joinLink, resetJoinCode } from '@/lib/seek/backend';
import { isEmail } from '@/lib/seek/format';
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

/** Emails as tags: type or paste addresses, press Enter (or a comma) to add one; × removes it. */
export function EmailTags({ emails, onChange, placeholder = 'Add email, press Enter', id }: { emails: string[]; onChange: (e: string[]) => void; placeholder?: string; id?: string }) {
  const [v, setV] = useState('');
  const { toast } = useSeek();
  const add = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter((x) => !isEmail(x));
    const good = parts.filter((x) => isEmail(x) && !emails.includes(x));
    if (good.length) onChange([...emails, ...good]);
    if (bad.length) toast(bad[0] + ' isn’t a valid email');
    setV(bad.join(' '));
  };
  return (
    <div className="tagin">
      {emails.map((e) => (
        <span key={e}>
          {e}
          <button type="button" aria-label={'Remove ' + e} onClick={() => onChange(emails.filter((x) => x !== e))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="email"
        placeholder={emails.length ? '' : placeholder}
        aria-label="Add email"
        value={v}
        onChange={(e) => {
          const val = e.target.value;
          if (/[,;\s]$/.test(val)) add(val);
          else setV(val);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(v);
          } else if (e.key === 'Backspace' && !v && emails.length) onChange(emails.slice(0, -1));
        }}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          if (/[\s,;]/.test(t.trim())) {
            e.preventDefault();
            add(t);
          }
        }}
        onBlur={() => v.trim() && add(v)}
      />
    </div>
  );
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
export function InviteDialog({
  onClose,
  invite,
  channels = [],
}: {
  onClose: () => void;
  invite: (email: string, opts?: { role?: 'member' | 'admin'; channels?: string[] }) => Promise<string>;
  /** private channels you can give the new people (open channels everyone sees anyway) */
  channels?: { id: string; name: string }[];
  /** kept for callers; roles are changed in Workspace settings */
  admin?: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const { s, toast } = useSeek();
  const [code, setCode] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
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
    if (busy || !emails.length) return;
    setBusy(true);
    const failed: string[] = [];
    let last = '';
    for (const e of emails) {
      last = await invite(e, { role: 'member', channels: picked });
      if (!/^Invite sent|already has a Seek account/.test(last)) failed.push(e);
    }
    setBusy(false);
    if (emails.length === 1) toast(last);
    else toast(failed.length ? `${emails.length - failed.length} invites sent. Couldn’t invite ${failed.join(', ')}` : `${emails.length} invites sent`);
    setEmails(failed);
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
          <label htmlFor={id}>Invite teammates by email</label>
          <EmailTags id={id} emails={emails} onChange={setEmails} />
          <em>They get an email with a Join button and a 6-digit code.</em>
          {channels.length > 0 && (
            <div className="fld" style={{ marginTop: 6 }}>
              <label>Private channels they can see</label>
              <div className="chips">
                {channels.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <button key={c.id} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setPicked((xs) => (on ? xs.filter((x) => x !== c.id) : [...xs, c.id]))}>
                      {on ? '✓ ' : '🔒 '}
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <em>Open (#) channels are visible to everyone on the team. Pick the private ones this person should see.</em>
            </div>
          )}
          <button type="submit" className="btn pri" style={{ marginTop: 8 }} disabled={busy || !emails.length}>
            {busy ? 'Sending…' : emails.length > 1 ? `Send ${emails.length} invites` : 'Send invite'}
          </button>
        </form>
      </div>
    </Modal>
  );
}
