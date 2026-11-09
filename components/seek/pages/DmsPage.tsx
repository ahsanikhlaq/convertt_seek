'use client';

import { PEOPLE, type DmThread, type PersonKey } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { useSeek } from '@/lib/seek/store';
import { Composer, Feed, type FeedRef } from '../Messages';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Avatar } from '../ui';

export function DmsPage() {
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
          <b style={{ color: 'var(--ok)' }}>● Available</b>
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
              <button key={t} type="button" role="tab" aria-selected={i === 0} className={'tb' + (i === 0 ? ' on' : '')} onClick={() => i && toast(t + ' with ' + p.name)}>
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
