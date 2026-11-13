'use client';

import { useEffect, useState } from 'react';
import { backendOn, sb } from '@/lib/seek/backend';
import { clock, offsetOf, placeOf } from '@/lib/seek/liveMeetings';
import { PEOPLE, STATUSES, type DmThread, type PersonKey } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { useLiveDms } from '@/lib/seek/liveDms';
import { useSeek } from '@/lib/seek/store';
import { Modal } from '../Dialogs';
import { InviteDialog } from '../InviteDialog';
import { Composer, Feed, type FeedRef } from '../Messages';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Avatar, SeenText } from '../ui';
import { FileList, useAttach } from '../Files';
import { PinsList, useSchedule } from '../Extras';
import { startHuddle } from '@/lib/seek/liveExtras';
import { dmFiles, type SharedFile } from '@/lib/seek/liveFiles';
import { Ic, StatusMark } from '../icons';

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
  const attach = useAttach(dm && dm !== 'AH' ? { dmWith: dm } : null);
  const schedule = useSchedule(dm && dm !== 'AH' ? { dmWith: dm } : null);
  const [tab, setTab] = useState<'Messages' | 'Files' | 'Pins'>('Messages');
  const [info, setInfo] = useState<{ title: string; pronouns: string; workHours: string; timeZone: string; status: string; email: string } | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!dm || dm === 'AH' || !ui.paneOpen) return;
    let alive = true;
    void sb()
      .from('profiles')
      .select('title, pronouns, work_hours, time_zone, status, email')
      .eq('id', dm)
      .maybeSingle()
      .then(({ data }) => {
        const p = data as { title: string; pronouns: string; work_hours: string; time_zone: string; status: string; email: string } | null;
        if (alive && p) setInfo({ title: p.title, pronouns: p.pronouns, workHours: p.work_hours, timeZone: p.time_zone, status: p.status, email: p.email });
      });
    return () => {
      alive = false;
    };
  }, [dm, ui.paneOpen]);
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const msgs = dm ? (s.dms[dm]?.msgs ?? []) : [];
  const pinned = msgs.filter((m) => m.kind === 'msg' && m.pinned).length;
  const withFiles = msgs.filter((m) => m.kind === 'msg' && m.files?.length).length;
  useEffect(() => {
    setTab('Messages');
  }, [dm]);
  useEffect(() => {
    if (tab !== 'Files' || !dm || dm === 'AH') return;
    let alive = true;
    setFiles(null);
    void dmFiles(dm).then((f) => alive && setFiles(f ?? []));
    return () => {
      alive = false;
    };
  }, [tab, dm, withFiles]);

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
      <Avatar k={k} size={30} presence />
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
          <Ic n="compose" />
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
        <Ic n="plus" size={14} /> Invite people
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
      sub={
        <>
          <SeenText id={dm} />
          {PEOPLE[dm]?.role ? <span>{(dm !== 'AH' ? ' · ' : '') + PEOPLE[dm]?.role}</span> : null}
        </>
      }
      below={
        <div className="tabs" role="tablist">
          {(['Messages', 'Files', 'Pins'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={'tb' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
              {t}
              {t === 'Pins' && pinned > 0 ? <span className="badge" style={{ background: 'var(--sb)' }}>{pinned}</span> : null}
            </button>
          ))}
        </div>
      }
      right={
        <>
          {dm !== 'AH' && (
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                const err = await startHuddle({ dmWith: dm });
                toast(err ?? 'Call started · ' + nameOf(dm) + ' can join from the chat');
              }}
            >
              <Ic n="phone" /> Call
            </button>
          )}
          <button type="button" className="btn sm" onClick={() => setUI((u) => ({ paneOpen: !u.paneOpen }))} aria-label="Profile details" aria-pressed={ui.paneOpen}>
            <Ic n="info" />
          </button>
        </>
      }
    />
  ) : (
    <MainHeader title="Direct messages" sub="Private conversations with one teammate" />
  );

  const pane =
    dm && ui.paneOpen ? (
      <Pane title="Profile" onClose={() => setUI({ paneOpen: false })}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <Avatar k={dm} size={72} presence />
          <div>
            <b style={{ fontSize: 17 }}>{nameOf(dm)}</b>
            <div style={{ fontSize: 13 }}>
              <SeenText id={dm} />
            </div>
            <div style={{ color: 'var(--sb)', fontSize: 13 }}>
              {[info?.title, info?.pronouns].filter(Boolean).join(' · ') || PEOPLE[dm]?.role}
            </div>
          </div>
        </div>
        {info && (
          <div className="kv" style={{ marginTop: 12 }}>
            <div>
              <span>Status</span>
              <b className="mtl"><StatusMark k={info.status} /> {(STATUSES.find((x) => x[0] === info.status) ?? STATUSES[0])[1]}</b>
            </div>
            <div>
              <span>Local time</span>
              <b>
                {clock(new Date(), offsetOf(info.timeZone))}
                {info.timeZone ? ' · ' + placeOf(info.timeZone) : ''}
              </b>
            </div>
            <div>
              <span>Working hours</span>
              <b>Mon–Fri {info.workHours}</b>
            </div>
            <div>
              <span>Email</span>
              <b style={{ overflowWrap: 'anywhere' }}>{info.email}</b>
            </div>
          </div>
        )}
      </Pane>
    ) : undefined;

  return (
    <Shell active="dms" side={side} pane={pane}>
      {header}
      {dm && tab === 'Files' ? (
        <div className="pg">
          <FileList files={files} me={s.meId ?? null} empty={'No files yet. Share one with the + button in the message box.'} />
        </div>
      ) : dm && tab === 'Pins' ? (
        <div className="pg">
          <PinsList target={dm !== 'AH' ? { dmWith: dm } : null} me={s.meId ?? null} where={'this conversation'} reloadKey={pinned} />
        </div>
      ) : dm ? (
        <>
          <Feed key={dm} feed={feed} banner={<div className="banner v"><Ic n="lock" size={14} /> This conversation is just between you and {nameOf(dm)}.</div>} />
          <Composer key={'c' + dm} placeholder={'Message ' + nameOf(dm)} people={[dm, 'AH']} onSend={(t) => void live?.send(t)} onAttach={attach} onSchedule={schedule} />
        </>
      ) : (
        <div className="pg">
          <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>{live?.ready ? 'Pick a teammate to start a private conversation.' : 'Loading your conversations…'}</span>
            <button type="button" className="btn pri" onClick={() => setPicking(true)}>
              <Ic n="compose" /> New message
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
          <Ic n="compose" />
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
          <button type="button" className="btn sm" onClick={() => toast('Huddle started · others can join')}>
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
            <button type="button" className="btn sm" onClick={() => toast('Huddle started · others can join')}>
              <Ic n="huddle" /> Huddle
            </button>
            <button type="button" className="btn sm" onClick={() => setUI((u) => ({ paneOpen: !u.paneOpen }))} aria-label="Profile details" aria-pressed={ui.paneOpen}>
              <Ic n="info" />
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
      <Feed key={dm} feed={feed} banner={<div className="banner v"><Ic n="lock" size={14} /> This conversation is just between you and {p.name}.</div>} />
      <Composer key={'c' + dm} placeholder={'Message ' + p.name} people={[dm, 'AH']} onSend={send} />
    </Shell>
  );
}
