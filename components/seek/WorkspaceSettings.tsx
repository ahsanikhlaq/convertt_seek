'use client';

import { useEffect, useRef, useState } from 'react';
import {
  cancelInvite,
  companyDomain,
  currentAccount,
  orgPeople,
  orgSettings,
  pendingInvites,
  removeFromOrg,
  sendInvite,
  setDomainJoin,
  setMemberRole,
  updateOrg,
  uploadLogo,
  type OrgPerson,
  type PendingInvite,
} from '@/lib/seek/backend';
import { STATUSES } from '@/lib/seek/data';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { InviteLink } from './InviteDialog';
import { OrgMark, Switch } from './ui';

type Tab = 'General' | 'People' | 'Invites';

/** Workspace settings: the organisation's profile, its people and their roles, and pending invites. */
export function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const { s, update, toast } = useSeek();
  const [tab, setTab] = useState<Tab>('General');
  const [org, setOrg] = useState<{ id: string; role: string; joinCode: string; me: string } | null>(null);
  const [name, setName] = useState(s.ws.name);
  const [domain, setDomain] = useState<{ on: boolean; mine: string | null }>({ on: false, mine: null });
  const [people, setPeople] = useState<OrgPerson[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logoIn = useRef<HTMLInputElement>(null);
  const admin = org ? ['owner', 'admin'].includes(org.role) : false;

  const loadPeople = async (id: string, isAdmin: boolean) => {
    setPeople(await orgPeople(id));
    if (isAdmin) setInvites(await pendingInvites(id));
  };

  useEffect(() => {
    void (async () => {
      const acc = await currentAccount();
      const w = acc?.workspace;
      if (!acc || !w) return;
      const isAdmin = ['owner', 'admin'].includes(w.role);
      setOrg({ id: w.id, role: w.role, joinCode: w.joinCode, me: acc.id });
      setCode(w.joinCode);
      const st = await orgSettings(w.id);
      if (st) {
        setName(st.name);
        setDomain({ on: st.allowDomain, mine: companyDomain(acc.email) });
      }
      await loadPeople(w.id, isAdmin);
    })();
  }, []);

  const saveGeneral = async () => {
    if (!org) return;
    setBusy(true);
    const err = await updateOrg(org.id, { name });
    setBusy(false);
    if (err) {
      toast(err);
      return;
    }
    update((d) => {
      d.ws.name = name.trim();
      const o = d.orgs?.find((x) => x.id === org.id);
      if (o) o.name = name.trim();
    });
    toast('Workspace settings saved');
  };

  const changeLogo = async (f: File | undefined) => {
    if (!f || !org) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type) || f.size > 2 * 1024 * 1024) {
      toast('Choose a PNG, JPG or WebP image up to 2 MB');
      return;
    }
    setBusy(true);
    const r = await uploadLogo(org.id, f);
    setBusy(false);
    if (r.error || !r.url) {
      toast(r.error ?? 'Couldn’t upload the logo');
      return;
    }
    update((d) => {
      d.ws.logo = r.url!;
    });
    toast('Logo updated');
  };

  const statusOf = (k: string) => STATUSES.find((x) => x[0] === k)?.[2] ?? '🟢';
  const label = (p: OrgPerson) => p.name.trim() || p.email.split('@')[0];

  return (
    <Modal
      title={
        <span className="joinorg">
          <OrgMark name={s.ws.name} logo={s.ws.logo} size={28} />
          Workspace settings
        </span>
      }
      onClose={onClose}
      width={560}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="tabs" role="tablist" style={{ padding: '0 16px' }}>
        {(['General', 'People', ...(admin ? ['Invites'] : [])] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={'tb' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
            {t}
            {t === 'People' && people ? <span className="badge" style={{ background: 'var(--sb)' }}>{people.length}</span> : null}
            {t === 'Invites' && invites?.length ? <span className="badge">{invites.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="mb" style={{ minHeight: 280 }}>
        {!org ? (
          <p className="sub">Loading…</p>
        ) : tab === 'General' ? (
          <>
            {!admin && <em>Only owners and admins can change these settings.</em>}
            <div className="logopick">
              <OrgMark name={name} logo={s.ws.logo} size={52} />
              {admin && (
                <div className="acts">
                  <button type="button" className="btn sm" disabled={busy} onClick={() => logoIn.current?.click()}>
                    {s.ws.logo ? 'Change logo' : 'Upload logo'}
                  </button>
                  <small>PNG, JPG or WebP up to 2 MB. Cropped to a square.</small>
                  <input
                    ref={logoIn}
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      void changeLogo(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
              )}
            </div>
            <div className="fld">
              <label htmlFor="wsname">Organisation name</label>
              <input id="wsname" className="inp" value={name} disabled={!admin} maxLength={50} onChange={(e) => setName(e.target.value)} />
            </div>
            {admin && (
              <button type="button" className="btn pri" style={{ alignSelf: 'flex-start' }} disabled={busy || !name.trim()} onClick={saveGeneral}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            )}
            <InviteLink code={code} onCode={setCode} />
            {admin && domain.mine && (
              <div className="trow">
                <div>
                  <b>Anyone with an @{domain.mine} email can join</b>
                  <small>They join as members after confirming their email.</small>
                </div>
                <Switch
                  on={domain.on}
                  label={'Anyone with an @' + domain.mine + ' email can join'}
                  onClick={async () => {
                    const err = await setDomainJoin(org.id, !domain.on);
                    if (err) {
                      toast(err);
                      return;
                    }
                    setDomain((x) => ({ ...x, on: !x.on }));
                    toast(domain.on ? 'Domain joining is off' : 'Anyone at @' + domain.mine + ' can now join');
                  }}
                />
              </div>
            )}
          </>
        ) : tab === 'People' ? (
          <div className="ppl">
            {!people ? (
              <p className="sub">Loading…</p>
            ) : (
              people.map((p) => {
                const you = p.userId === org.me;
                return (
                  <div key={p.userId} style={{ alignItems: 'center' }}>
                    <span className="av" style={{ width: 34, height: 34, background: 'var(--v)', fontSize: 13 }}>
                      {label(p).slice(0, 2).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>
                        {label(p)}
                        {you ? ' (you)' : ''} <small style={{ fontWeight: 400 }}>{statusOf(p.status)}</small>
                      </b>
                      <small>
                        {p.email}
                        {p.title ? ' · ' + p.title : ''}
                      </small>
                    </span>
                    {admin && p.role !== 'owner' && !you ? (
                      <>
                        <select
                          className="inp"
                          style={{ width: 'auto' }}
                          aria-label={'Role for ' + label(p)}
                          value={p.role}
                          onChange={async (e) => {
                            const err = await setMemberRole(org.id, p.userId, e.target.value as 'admin' | 'member');
                            toast(err ?? `${label(p)} is now ${e.target.value === 'admin' ? 'an admin' : 'a member'}`);
                            await loadPeople(org.id, admin);
                          }}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={async () => {
                            if (!confirm(`Remove ${label(p)} from ${s.ws.name}? They lose access at once. Their messages stay.`)) return;
                            const err = await removeFromOrg(org.id, p.userId);
                            toast(err ?? label(p) + ' removed');
                            await loadPeople(org.id, admin);
                          }}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <span className="tag">{p.role === 'owner' ? 'Owner' : p.role === 'admin' ? 'Admin' : 'Member'}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <>
            {!invites ? (
              <p className="sub">Loading…</p>
            ) : invites.length ? (
              invites.map((i) => (
                <div key={i.id} className="trow" style={{ alignItems: 'center' }}>
                  <div>
                    <b>{i.email}</b>
                    <small>
                      {i.role === 'admin' ? 'Admin' : 'Member'} · invited {new Date(i.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </small>
                  </div>
                  <button type="button" className="btn sm" onClick={async () => toast((await sendInvite(org.id, i.email, { role: i.role === 'admin' ? 'admin' : 'member' })).message)}>
                    Resend
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={async () => {
                      const err = await cancelInvite(i.id);
                      toast(err ?? 'Invite to ' + i.email + ' cancelled');
                      setInvites(await pendingInvites(org.id));
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ))
            ) : (
              <div className="empty">No pending invites. Everyone you invited has joined.</div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
