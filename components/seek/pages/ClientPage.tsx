'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { backendOn } from '@/lib/seek/backend';
import { LiveClientsPage } from './LiveClientPages';
import { PEOPLE, SLOT_LABELS, SLOTS, type ClientTab, type PersonKey } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { Modal } from '../Dialogs';
import { Composer, Feed, type FeedRef } from '../Messages';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Avatar, Switch } from '../ui';
import { Ic } from '../icons';

const TABS: ClientTab[] = ['Client chat', 'Team notes', 'Status', 'Approvals', 'People'];
const CLIENT_PEOPLE: PersonKey[] = ['CH', 'PR', 'AH', 'MO'];

export function ClientPage({ scheduling }: { scheduling?: boolean }) {
  // with a backend, client spaces are real (LiveClientPages); the demo below stays exactly like the prototype
  return backendOn ? <LiveClientsPage scheduling={scheduling} /> : <DemoClientPage scheduling={scheduling} />;
}

function DemoClientPage({ scheduling }: { scheduling?: boolean }) {
  const { s, ui, update, setUI, toast, nextId } = useSeek();
  const router = useRouter();
  const sp = s.spaces.find((x) => x.id === s.cs) || s.spaces[0];
  const isHB = sp.id === 'HB';
  const tab = s.cTab;
  const team = tab === 'Team notes';
  const chatTab = tab === 'Client chat' || team ? tab : 'Client chat';
  const feed: FeedRef = { get: (d) => d.cmsgs[chatTab], where: 'HB', clientVisible: !team };

  const setTab = (t: ClientTab) =>
    update((d) => {
      d.cTab = t;
    });

  const approve = () => {
    update((d) => {
      d.approval = 'done';
      d.decs.unshift({ id: nextId(), t: 'Hero B approved (desktop v4 + mobile v1)', by: 'Formal approval by Chris', where: 'HB', time: 'Just now', type: 'appr', client: true, a: 'Source message' });
    });
    toast('Chris approved · logged as a decision');
  };
  const nudge = () => toast('Nudge sent to Chris by email and in his space');

  const send = (text: string) => {
    const id = nextId();
    update((d) => {
      d.cmsgs[chatTab].push({ kind: 'msg', id, who: 'AH', time: now(), text, flash: true });
      if (!team) d.replied = true;
    });
    if (!team)
      toast('Sent to Chris and Priya', () =>
        update((d) => {
          d.cmsgs['Client chat'] = d.cmsgs['Client chat'].filter((x) => x.id !== id);
          d.replied = false;
        }),
      );
  };

  const side = (
    <Sidebar
      title="Clients"
      sub="one space per client"
      action={
        <Link className="btn sm" href={ROUTES.invite}>
          <Ic n="plus" size={14} /> New
        </Link>
      }
    >
      <div className="sg lbl">Client spaces</div>
      {s.spaces.map((x) => (
        <button
          key={x.id}
          type="button"
          className={'si' + (x.id === sp.id ? ' on' : '')}
          aria-current={x.id === sp.id ? 'page' : undefined}
          onClick={() => {
            update((d) => {
              d.cs = x.id;
            });
            setUI({ sideOpen: false });
          }}
        >
          <span className="av" style={{ width: 30, height: 30, borderRadius: 8, background: x.color, fontSize: 12 }}>
            {x.id}
          </span>
          <span className="x">
            <b>{x.name}</b>
            <small>{x.desc}</small>
          </span>
          <span className={'tag' + (x.id === 'HB' && !s.replied ? ' red' : '')}>{x.id === 'HB' && s.replied ? 'replied' : x.wait}</span>
        </button>
      ))}
      <div className="sg lbl">Overview</div>
      <button type="button" className="si" onClick={() => toast('All clients: ' + s.spaces.length + ' active')}>
        All clients
      </button>
    </Sidebar>
  );

  const tabs = (
    <div className="tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={'tb' + (tab === t ? ' on' : '') + (t === 'Client chat' ? ' gold' : '')} onClick={() => setTab(t)}>
          {t}
          {t === 'Team notes' && <span className="badge">2</span>}
          {t === 'Approvals' && s.approval !== 'done' && (
            <span className="badge" style={{ background: 'var(--gold)' }}>
              1
            </span>
          )}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (!isHB) {
    body = (
      <div className="empty">
        <b style={{ display: 'block', fontSize: 17, color: 'var(--ink)' }}>{sp.name}</b>
        {sp.desc} · Client chat is quiet.
        <br />
        <br />
        <button
          type="button"
          className="btn"
          onClick={() =>
            update((d) => {
              d.cs = 'HB';
            })
          }
        >
          Open Hollow & Bright
        </button>
      </div>
    );
  } else if (tab === 'Client chat' || team) {
    body = (
      <>
        <Feed
          key={tab}
          feed={feed}
          banner={
            team ? (
              <div className="banner v">
                <Ic n="lock" size={13} />{' '}
                <span>
                  <b>Team notes</b> are private to your team. Chris and Priya never see this.
                </span>
              </div>
            ) : (
              <div className="banner gold">
                <Ic n="eye" size={13} />{' '}
                <span>
                  <b>Chris and Priya</b> see everything in Client chat. For internal discussion, use{' '}
                  <button type="button" className="linkbtn" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={() => setTab('Team notes')}>
                    Team notes
                  </button>
                  .
                </span>
              </div>
            )
          }
          footer={
            s.meeting && !team ? (
              <div className="dec" style={{ boxShadow: 'inset 4px 0 0 var(--v)' }}>
                <div className="k">
                  <span>MEETING</span>
                  <span className="tag v">{s.meeting.tool}</span>
                </div>
                <b>
                  {s.meeting.title} · {s.meeting.when}
                </b>
                <small>Invite sent to Chris and Priya with a calendar file</small>
              </div>
            ) : null
          }
        />
        {team ? (
          <Composer key="team" placeholder="Note for the team…" people={['AH', 'SY', 'MO']} onSend={send} />
        ) : (
          <Composer key="client" placeholder="Message Hollow & Bright…" button="Send to client" gold note="Client chat · Visible to Chris and Priya" people={CLIENT_PEOPLE} onSend={send} />
        )}
      </>
    );
  } else if (tab === 'Approvals') {
    body = (
      <div className="pg">
        <div className="card">
          <div className="ct">
            <b>Hero B · desktop v4 + mobile v1</b>
            <span className={'tag ' + (s.approval === 'done' ? 'ok' : 'gold')}>{s.approval === 'done' ? 'Approved' : s.approval === 'req' ? 'Requested' : 'Open'}</span>
          </div>
          <small style={{ color: 'var(--sb)' }}>Approver: Chris · due Thursday</small>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {s.approval === 'done' ? (
              <span className="tag ok"><Ic n="check" size={12} /> Approved by Chris · logged as decision</span>
            ) : (
              <>
                <button type="button" className="btn sm" onClick={nudge}>
                  Nudge Chris
                </button>
                <button type="button" className="btn sm gold" onClick={approve}>
                  Simulate: Chris approves
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  } else if (tab === 'Status') {
    body = (
      <div className="pg">
        <div className="stats">
          {[
            ['62%', 'complete'],
            ['Wed', 'launch'],
            [s.approval === 'done' ? '0' : '1', 'open approval'],
            [s.replied ? '0h' : '26h', 'longest wait'],
          ].map(([a, b]) => (
            <div key={b} className="stat">
              <b>{a}</b>
              <span>{b}</span>
            </div>
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="pg">
        <div className="ppl">
          {CLIENT_PEOPLE.map((k) => (
            <div key={k}>
              <Avatar k={k} size={34} />
              <span>
                <b>{PEOPLE[k].name}</b>
                <small>{k === 'CH' || k === 'PR' ? PEOPLE[k].role : 'team'}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const pane =
    isHB && ui.paneOpen ? (
      <Pane title="In this client space" onClose={() => setUI({ paneOpen: false })}>
        <div className="ppl">
          {CLIENT_PEOPLE.map((k) => (
            <div key={k}>
              <Avatar k={k} size={32} />
              <span>
                <b>{PEOPLE[k].name}</b>
                <small>{k === 'CH' ? 'client · approver' : k === 'PR' ? 'client · copy' : k === 'AH' ? 'team · lead' : 'team'}</small>
              </span>
            </div>
          ))}
        </div>
        {s.replied ? (
          <div className="timer ok">
            <b>Replied</b>Timer stopped when the team replied.
          </div>
        ) : (
          <div className="timer">
            <b>Reply target: 1 working day</b>Chris has waited 26h. The timer stops when anyone on the team replies.
          </div>
        )}
        <div className="card">
          <div className="ct">
            <b>Open approval</b>
            <span className={'tag ' + (s.approval === 'done' ? 'ok' : 'gold')}>{s.approval === 'done' ? 'Approved' : 'Due Thu'}</span>
          </div>
          <small style={{ color: 'var(--mu)' }}>
            Hero B · desktop v4 + mobile v1
            <br />
            Chris · due Thursday
          </small>
          {s.approval !== 'done' && (
            <button type="button" className="btn sm" onClick={nudge}>
              Nudge Chris
            </button>
          )}
        </div>
        <Link className="btn pri" href={ROUTES.meetings}>
          <Ic n="calendar" /> Schedule a call
        </Link>
      </Pane>
    ) : undefined;

  return (
    <Shell active={scheduling ? 'meetings' : 'clients'} side={side} pane={pane}>
      <MainHeader
        title={sp.name}
        sub={`Client space · ${sp.desc.toLowerCase()}`}
        right={
          <>
            <span className="stack hide-m">
              <Avatar k="CH" size={26} />
              <Avatar k="PR" size={26} />
            </span>
            <Link className="btn sm" href={ROUTES.meetings}>
              <Ic n="calendar" /> <span className="hide-m">Schedule</span>
            </Link>
            <button type="button" className="btn sm" onClick={() => setUI((u) => ({ paneOpen: !u.paneOpen }))} aria-label="Space details" aria-pressed={ui.paneOpen}>
              <Ic n="info" />
            </button>
          </>
        }
        below={isHB ? tabs : undefined}
      />
      {body}
      {scheduling && <ScheduleDialog onClose={() => router.push(ROUTES.clients)} />}
    </Shell>
  );
}

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const { s, update, toast } = useSeek();
  const x = s.sched;
  const [title, setTitle] = useState(x.title);
  const [agenda, setAgenda] = useState(x.agenda);
  const set = (fn: (y: typeof x) => void) =>
    update((d) => {
      fn(d.sched);
    });

  const schedule = () => {
    const t = title.trim() || 'Meeting';
    update((d) => {
      d.sched.title = t;
      d.sched.agenda = agenda;
      d.meeting = { title: t, when: SLOT_LABELS[d.sched.slot], tool: d.sched.tool };
      d.cTab = 'Client chat';
      d.cs = 'HB';
    });
    toast('Meeting scheduled · invite sent to Chris and Priya');
    onClose();
  };

  return (
    <Modal
      title="Schedule a meeting with Hollow & Bright"
      icon={
        <span className="av" style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--gold)', fontSize: 13 }}>
          HB
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" onClick={schedule}>
            Schedule and invite
          </button>
        </>
      }
    >
      <div className="mb">
        <div className="fld">
          <label htmlFor="stt">Title</label>
          <input className="inp" id="stt" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="fld">
          <label>Who</label>
          <div className="tagin">
            <span style={{ background: 'var(--golds)', color: 'var(--gold)' }}>Chris (client)</span>
            <span style={{ background: 'var(--golds)', color: 'var(--gold)' }}>Priya (client)</span>
            <span>Momina</span>
            <input placeholder="Add people" aria-label="Add people" />
          </div>
        </div>
        <div className="fld">
          <label>Suggested times · inside everyone's working hours</label>
          <div className="slots" role="radiogroup" aria-label="Suggested times">
            {SLOTS.map((sl, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={x.slot === i}
                className={'slot' + (x.slot === i ? ' on' : '')}
                onClick={() =>
                  set((y) => {
                    y.slot = i;
                  })
                }
              >
                <small>{sl[0]}</small>
                <b>{sl[1]}</b>
                <span>{sl[2]}</span>
              </button>
            ))}
          </div>
          <em>
            <button type="button" className="linkbtn" onClick={() => toast('Opens a calendar picker')}>
              Or pick another time
            </button>{' '}
            · 30 minutes
          </em>
        </div>
        <div className="fld">
          <label>Video</label>
          <div className="chips">
            {['Google Meet', 'Zoom', 'Seek video', 'In person'].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={x.tool === t}
                className={'chip' + (x.tool === t ? ' on' : '')}
                onClick={() =>
                  set((y) => {
                    y.tool = t;
                  })
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="fld">
          <label htmlFor="sag">Agenda</label>
          <textarea className="inp" id="sag" rows={2} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </div>
        <div className="trow">
          <div>
            <b>Send the invite to the client's space and email</b>
            <small>Includes a calendar file.</small>
          </div>
          <Switch
            on={x.send}
            label="Send the invite"
            onClick={() =>
              set((y) => {
                y.send = !y.send;
              })
            }
          />
        </div>
        <div className="trow">
          <div>
            <b>Record and take AI notes</b>
            <small>Chris and Priya are told when recording starts. Notes go to Team notes first; you choose what to share.</small>
          </div>
          <Switch
            on={x.rec}
            label="Record and take AI notes"
            onClick={() =>
              set((y) => {
                y.rec = !y.rec;
              })
            }
          />
        </div>
      </div>
    </Modal>
  );
}
