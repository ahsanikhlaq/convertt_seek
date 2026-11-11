'use client';

import { useState } from 'react';
import { backendOn } from '@/lib/seek/backend';
import { PEOPLE, type DmThread, type PersonKey } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { useLiveDms } from '@/lib/seek/liveDms';
import { useSeek } from '@/lib/seek/store';
import { Modal } from '../Dialogs';
import { InviteDialog } from '../InviteDialog';
import { Composer, Feed, type FeedRef } from '../Messages';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Avatar } from '../ui';

export function DmsPage() {
  // with a backend, DMs are real (lib/seek/liveDms.ts); the demo below stays exactly like the prototype
  return backendOn ? <LiveDmsPage /> : <DemoDmsPage />;
}

const nameOf = (k: PersonKey) => PEOPLE[k]?.name ?? 'Someone';

function LiveDmsPage() {
  const { s, ui, setUI, toast } = useSeek();
  const live = useLiveDms();
  const [picking, setPicking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const threads = Object.entries(s.dms) as [PersonKey, DmThread][];
  const dm = s.dms[s.dm] ? s.dm : null;
  const feed: FeedRef = { get: (d) => (d.dms[dm as PersonKey] ||= { last: '', unread: 0, msgs: [] }).msgs, where: 'DM ' + (dm ? nameOf(dm) : '') };
  const others = (live?.people ?? []).filter((k) => !s.dms[k]);

  const open = async (k: PersonKey) => {
    setPicking(false);
    setUI({ sideOpen: false, menu: null });
    await live?.open(k);
  };
  const invite = async () => {
    if (!live || busy) return;
    setBusy(true);
    const msg = await live.invite(email);
    setBusy(false);
    toast(msg);
    if (msg !== 'Enter a valid email') {
      setEmail('');
      setPicking(false);
    }
  };

  const person = (k: PersonKey, sub: string, onClick: () => void, extra?: React.ReactNode, on = false) => (
    <button key={k} type="button" className={'si' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <Avatar k={k} size={30} />
      <span className="x">
        <b>{nameOf(k)}</b>
        <small>{sub}</small>
      </span>
      {extra}
    </button>
  );

  const side = (
    <Sidebar
      title="DMs"
      sub="private conversations"
      action={
        <button type="button" className="btn sm" onClick={() => setPicking(true)} aria-label="New message">
          ✎
        </button>
      }
    >
      <div className="sg lbl">Recent</div>
      {threads.length ? (
        threads.map(([k, x]) => person(k, x.last || 'No messages yet', () => void open(k), x.unread ? <span className="badge">{x.unread}</span> : null, k === dm))
      ) : (
        <div className="si" style={{ cursor: 'default' }}>
          <span className="x">
            <small>No conversations yet</small>
          </span>
        </div>
      )}
      {others.length > 0 && <div className="sg lbl">Teammates</div>}
      {others.map((k) => person(k, 'Start a conversation', () => void open(k)))}
      <button type="button" className="si" onClick={() => setInviting(true)}>
        ＋ Invite people
      </button>
    </Sidebar>
  );

  const picker = picking && (
    <Modal
      title="New message"
      onClose={() => setPicking(false)}
      width={440}
      footer={
        <form
          style={{ display: 'flex', gap: 8, width: '100%' }}
          onSubmit={(e) => {
            e.preventDefault();
            void invite();
          }}
        >
          <input className="inp" type="email" placeholder="Invite someone new by email" aria-label="Invite by email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1 }} />
          <button type="submit" className="btn pri" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Invite'}
          </button>
        </form>
      }
    >
      <div className="mb" style={{ gap: 2, padding: 8 }}>
        {live?.people.length ? (
          live.people.map((k) => person(k, PEOPLE[k]?.role ?? '', () => void open(k)))
        ) : (
          <div className="empty">Nobody else is in your workspace yet. Invite someone below, and you can message them as soon as they sign in.</div>
        )}
      </div>
    </Modal>
  );

  const header = dm ? (
    <MainHeader
      title={nameOf(dm)}
      sub={PEOPLE[dm]?.role ?? ''}
      right={
        <button type="button" className="btn sm" onClick={() => setUI((u) => ({ paneOpen: !u.paneOpen }))} aria-label="Profile details" aria-pressed={ui.paneOpen}>
          ⓘ
        </button>
      }
    />
  ) : (
    <MainHeader title="Direct messages" sub="Private conversations with one teammate" />
  );

  const pane =
    dm && ui.paneOpen ? (
      <Pane title="Profile" onClose={() => setUI({ paneOpen: false })}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <Avatar k={dm} size={72} />
          <div>
            <b style={{ fontSize: 17 }}>{nameOf(dm)}</b>
            <div style={{ color: 'var(--sb)', fontSize: 13 }}>{PEOPLE[dm]?.role}</div>
          </div>
        </div>
      </Pane>
    ) : undefined;

  return (
    <Shell active="dms" side={side} pane={pane}>
      {header}
      {dm ? (
        <>
          <Feed key={dm} feed={feed} banner={<div className="banner v">🔒 This conversation is just between you and {nameOf(dm)}.</div>} />
          <Composer key={'c' + dm} placeholder={'Message ' + nameOf(dm)} people={[dm, 'AH']} onSend={(t) => void live?.send(t)} />
        </>
      ) : (
        <div className="pg">
          <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>{live?.ready ? 'Pick a teammate to start a private conversation.' : 'Loading your conversations…'}</span>
            <button type="button" className="btn pri" onClick={() => setPicking(true)}>
              ✎ New message
            </button>
          </div>
        </div>
      )}
      {picker}
      {inviting && live && <InviteDialog onClose={() => setInviting(false)} invite={live.invite} />}
    </Shell>
  );
}

function DemoDmsPage() {
  const { s, ui, update, setUI, toast, nextId } = useSeek();
  const dm = s.dms[s.dm] ? s.dm : (Object.keys(s.dms)[0] as PersonKey);
  const p = PEOPLE[dm];
  const feed: FeedRef = { get: (d) => d.dms[dm]!.msgs, where: 'DM ' + p.name };

  const open = (k: PersonKey) => {
    update((d) => {
      d.dm = k;
      d.dms[k]!.unread = 0;
    });
    setUI({ sideOpen: false, menu: null });
  };

  const send = (text: string) => {
    update((d) => {
      const t = d.dms[dm]!;
      t.msgs.push({ kind: 'msg', id: nextId(), who: 'AH', time: now(), text, flash: true });
      t.last = text;
    });
    if (dm === 'MO') {
      const id = nextId();
      setTimeout(() => {
        update((d) => {
          const t = d.dms.MO!;
          t.msgs.push({ kind: 'msg', id, who: 'MO', time: now(), text: 'Sounds good 👍', flash: true });
          t.last = 'Sounds good 👍';
        });
      }, 1800);
    }
  };

  const side = (
    <Sidebar
      title="DMs"
      sub="private conversations"
      action={
        <button type="button" className="btn sm" onClick={() => toast('Pick people to message')} aria-label="New message">
          ✎
        </button>
      }
    >
      <div className="sg lbl">Recent</div>
      {(Object.entries(s.dms) as [PersonKey, DmThread][]).map(([k, x]) => (
        <button key={k} type="button" className={'si' + (k === dm ? ' on' : '') + (x.unread ? ' unread' : '')} aria-current={k === dm ? 'page' : undefined} onClick={() => open(k)}>
          <Avatar k={k} size={30} />
          <span className="x">
            <b>
              {PEOPLE[k].name}
              {k === 'ZA' ? ' (design intern)' : ''}
            </b>
            <small>{x.last}</small>
          </span>
          {x.unread ? <span className="badge">{x.unread}</span> : null}
        </button>
      ))}
      <button type="button" className="si" onClick={() => toast('Group DM: Syed, Momina')}>
        <Avatar k="SY" size={30} />
        <span className="x">
          <b>Syed, Momina</b>
          <small>Friday lunch?</small>
        </span>
      </button>
    </Sidebar>
  );

  const pane = ui.paneOpen ? (
    <Pane title="Profile" onClose={() => setUI({ paneOpen: false })}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
        <Avatar k={dm} size={72} />
        <div>
          <b style={{ fontSize: 17 }}>
            {p.name} {dm === 'MO' ? 'Omar' : ''}
          </b>
          <div style={{ color: 'var(--sb)', fontSize: 13 }}>
            {p.role} · {dm === 'MO' ? 'she/her' : 'they/them'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn sm" onClick={() => toast('🎧 Huddle started · others can join')}>
            Call
          </button>
          <button type="button" className="btn sm" onClick={() => toast('Muted for 1 hour')}>
            Mute
          </button>
        </div>
      </div>
      <div className="kv">
        <div>
          <span>Local time</span>
          <b>14:10 Lahore</b>
        </div>
        <div>
          <span>Hours</span>
          <b>Mon–Fri 9–6</b>
        </div>
        <div>
          <span>Status</span>
          <b className="oktxt">● Available</b>
        </div>
      </div>
      <div>
        <div className="lbl" style={{ marginBottom: 8 }}>
          In common
        </div>
        <div className="chips">
          <span className="tag"># launch-squad</span>
          <span className="tag"># dev-team</span>
          <span className="tag gold">Hollow & Bright</span>
          <span className="tag gold">Acme Foods</span>
        </div>
      </div>
    </Pane>
  ) : undefined;

  return (
    <Shell active="dms" side={side} pane={pane}>
      <MainHeader
        title={p.name}
        sub={`${p.role} · available · 14:10 in Lahore`}
        right={
          <>
            <button type="button" className="btn sm" onClick={() => toast('🎧 Huddle started · others can join')}>
              🎧 Huddle
            </button>
            <button type="button" className="btn sm" onClick={() => setUI((u) => ({ paneOpen: !u.paneOpen }))} aria-label="Profile details" aria-pressed={ui.paneOpen}>
              ⓘ
            </button>
          </>
        }
        below={
          <div className="tabs" role="tablist">
            {['Messages', 'Files', 'Pins'].map((t, i) => (
              <button key={t} type="button" role="tab" aria-selected={i === 0} className={'tb' + (i === 0 ? ' on' : '')} onClick={() => toast(t)}>
                {t}
              </button>
            ))}
          </div>
        }
      />
      <Feed key={dm} feed={feed} banner={<div className="banner v">🔒 This conversation is just between you and {p.name}.</div>} />
      <Composer key={'c' + dm} placeholder={'Message ' + p.name} people={[dm, 'AH']} onSend={send} />
    </Shell>
  );
}
