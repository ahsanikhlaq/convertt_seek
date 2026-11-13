'use client';

import { useEffect, useId, useState } from 'react';
import { PEOPLE, type PersonKey } from '@/lib/seek/data';
import { channelId } from '@/lib/seek/format';
import type { LiveChat } from '@/lib/seek/live';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { Avatar, SeenText } from './ui';

const nameOf = (k: PersonKey) => PEOPLE[k]?.name ?? 'Someone';

/** Teammates as a tick list (everyone but you). */
function PeoplePicker({ people, picked, onToggle }: { people: PersonKey[]; picked: string[]; onToggle: (k: string) => void }) {
  if (!people.length) return <em>Nobody else is in your workspace yet. Invite people first, then add them here.</em>;
  return (
    <div className="mb" style={{ gap: 2, padding: 0, maxHeight: 220, overflow: 'auto' }}>
      {people.map((k) => {
        const on = picked.includes(k);
        return (
          <label key={k} className="si" style={{ cursor: 'pointer' }}>
            <Avatar k={k} size={26} />
            <span className="x">
              <b>{nameOf(k)}</b>
              <small>{PEOPLE[k]?.role}</small>
            </span>
            <input type="checkbox" checked={on} onChange={() => onToggle(k)} aria-label={nameOf(k)} />
          </label>
        );
      })}
    </div>
  );
}

/** New channel: name, description, and who can see it (everyone, or only the people you add). */
export function NewChannelDialog({ live, onClose, onCreated }: { live: LiveChat; onClose: () => void; onCreated: (name: string) => void }) {
  const { s, toast } = useSeek();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [priv, setPriv] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const others = live.people.filter((k) => k !== 'AH');

  const create = async () => {
    const n = channelId(name);
    if (!n) {
      toast('Use letters, numbers and dashes');
      return;
    }
    setBusy(true);
    const err = await live.createChannel(n, { private: priv, members: picked, description: desc });
    setBusy(false);
    if (err) {
      toast(err);
      return;
    }
    toast(`#${n} created${priv ? ` · ${picked.length ? picked.length + ' added' : 'only you for now'}` : ''}`);
    onCreated(n);
  };

  return (
    <Modal
      title="Create a channel"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" onClick={create} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create channel'}
          </button>
        </>
      }
    >
      <form
        className="mb"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="fld">
          <label htmlFor={id + 'n'}>Name</label>
          <input id={id + 'n'} className="inp" placeholder="e.g. launch-squad" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <em className="mono">#{channelId(name) || 'channel-name'}</em>
        </div>
        <div className="fld">
          <label htmlFor={id + 'd'}>
            Description <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input id={id + 'd'} className="inp" placeholder="What is it for?" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="fld">
          <label>Who can see it</label>
          <div className="chips">
            <button type="button" className={'chip' + (priv ? ' on' : '')} aria-pressed={priv} onClick={() => setPriv(true)}>
              🔒 Only people I add
            </button>
            <button type="button" className={'chip' + (!priv ? ' on' : '')} aria-pressed={!priv} onClick={() => setPriv(false)}>
              # Everyone in {s.ws.name || 'the workspace'}
            </button>
          </div>
          <em>{priv ? 'Only the people you add (and admins) can see it. New teammates don’t see it unless you add them.' : 'Everyone on the team, including people who join later, can see it.'}</em>
        </div>
        {priv && (
          <div className="fld">
            <label>Add people</label>
            <PeoplePicker people={others} picked={picked} onToggle={(k) => setPicked((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]))} />
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Who is in a private channel: add teammates, remove people. */
export function ChannelMembersDialog({ live, channel, onClose }: { live: LiveChat; channel: string; onClose: () => void }) {
  const { toast } = useSeek();
  const [members, setMembers] = useState<string[] | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const info = live.channels.get(channel);

  const load = async () => setMembers(await live.members(channel));
  useEffect(() => {
    void load();
  }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const others = live.people.filter((k) => k !== 'AH' && !(members ?? []).includes(k));

  const add = async () => {
    setBusy(true);
    let failed = '';
    for (const u of adding) {
      const err = await live.addMember(channel, u);
      if (err) failed = err;
    }
    setBusy(false);
    setAdding([]);
    toast(failed || `Added to #${channel}`);
    await load();
  };

  return (
    <Modal title={`🔒 #${channel} · members`} onClose={onClose} width={460} footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <div className="mb">
        <em>Only these people {live.admin ? '(and admins)' : 'and admins'} can see #{channel}.</em>
        {members === null ? (
          <p className="sub">Loading…</p>
        ) : (
          <div className="ppl">
            {(members ?? []).map((u) => {
              const you = u === live.me;
              const canRemove = live.admin || info?.createdBy === live.me;
              return (
                <div key={u}>
                  <Avatar k={you ? 'AH' : u} size={30} presence />
                  <span style={{ flex: 1 }}>
                    <b>{you ? 'You' : nameOf(u)}</b>
                    <small>
                      {info?.createdBy === u ? 'created the channel' : 'member'}
                      {!you && <SeenText id={u} prefix=" · " />}
                    </small>
                  </span>
                  {canRemove && !you && (
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={async () => {
                        const err = await live.removeMember(channel, u);
                        toast(err ?? `${nameOf(u)} removed from #${channel}`);
                        await load();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="fld">
          <label>Add people</label>
          <PeoplePicker people={others} picked={adding} onToggle={(k) => setAdding((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]))} />
          {adding.length > 0 && (
            <button type="button" className="btn pri" style={{ alignSelf: 'flex-start' }} onClick={add} disabled={busy}>
              {busy ? 'Adding…' : `Add ${adding.length}`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
