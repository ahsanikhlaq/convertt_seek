'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ClientRole } from '@/lib/seek/backend';
import { PEOPLE, type ClientTab, type PersonKey } from '@/lib/seek/data';
import { isEmail } from '@/lib/seek/format';
import { laneKey, namesOf, pending, useLiveClients, type LiveClients, type Space } from '@/lib/seek/liveClients';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { Composer, Feed, type FeedRef } from '../Messages';
import { ClientRail, MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Avatar } from '../ui';
import { ApprovalsTab, type Approver } from '../Approvals';
import { ScheduleDialog } from '../Meetings';
import { clock, dayLabel, downloadIcs, toolName, upcomingMeetings, type Upcoming } from '@/lib/seek/liveMeetings';
import { saveProfile, signOut } from '@/lib/seek/backend';
import { useSpaceWaits, waitFor, type Wait } from '@/lib/seek/liveTimer';
import { FileList, useAttach } from '../Files';
import { PinsList, useSchedule } from '../Extras';
import { useApprovals } from '@/lib/seek/liveApprovals';
import { spaceFiles, type SharedFile } from '@/lib/seek/liveFiles';

/**
 * Client spaces with a real backend. The agency's team sees every client with Client chat, Team notes, Status,
 * Approvals and People; a client (signed in from their invite) sees only their own project space.
 */
export function LiveClientsPage({ scheduling }: { scheduling?: boolean }) {
  const { s } = useSeek();
  const live = useLiveClients();
  if (!live) return null;
  if (s.session === 'client') return <ClientPortal live={live} />;
  if (scheduling) return <LiveMeetings live={live} />;
  return <TeamClients live={live} />;
}

const TABS: ClientTab[] = ['Client chat', 'Team notes', 'Status', 'Approvals', 'Files', 'Pins', 'People'];
const ROLES: [ClientRole, string][] = [
  ['approver', 'Approver'],
  ['contributor', 'Contributor'],
  ['viewer', 'Viewer'],
];
const nameOf = (k: PersonKey) => PEOPLE[k]?.name ?? 'Someone';
const personName = (p: { name: string; email: string }) => p.name.trim() || p.email.split('@')[0];
const firstName = (p: { name: string; email: string }) => personName(p).split(' ')[0];

function SpaceMark({ sp, size = 30 }: { sp: Pick<Space, 'code' | 'color'>; size?: number }) {
  return (
    <span className="av" style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), background: sp.color, fontSize: Math.round(size * 0.37) }}>
      {sp.code}
    </span>
  );
}

function progress(sp: Space, side?: 'client' | 'team') {
  const steps = side ? sp.steps.filter((x) => x.side === side) : sp.steps;
  return { done: steps.filter((x) => x.doneAt).length, total: steps.length };
}

/** The Clients sidebar: every client space, newest first. */
function ClientList({ live, current, onOpen, waits }: { live: LiveClients; current: Space | null; onOpen: (id: string) => void; waits?: Map<string, Wait> }) {
  const tzLabel = useSeek().s.ws.tz;
  return (
    <Sidebar
      title="Clients"
      sub="one space per client"
      action={
        <Link className="btn sm" href={ROUTES.invite}>
          ＋ New
        </Link>
      }
    >
      <div className="sg lbl">Client spaces</div>
      {live.spaces.length ? (
        live.spaces.map((x) => {
          const p = progress(x);
          const w = waitFor(waits?.get(x.id), x.replyTarget, tzLabel);
          return (
            <button key={x.id} type="button" className={'si' + (x.id === current?.id ? ' on' : '')} aria-current={x.id === current?.id ? 'page' : undefined} onClick={() => onOpen(x.id)}>
              <SpaceMark sp={x} />
              <span className="x">
                <b>{x.name}</b>
                <small>{x.project || 'Client space'}</small>
              </span>
              {w ? (
                <span className={'tag' + (w.over ? ' red' : '')} title={'Waiting for a reply · ' + w.label + ' of working time'}>
                  {w.label}
                </span>
              ) : (
                x.status === 'onboarding' && p.total > 0 && <span className="tag">{`${p.done}/${p.total}`}</span>
              )}
            </button>
          );
        })
      ) : (
        <div className="si" style={{ cursor: 'default' }}>
          <span className="x">
            <small>{live.ready ? 'No clients yet' : 'Loading…'}</small>
          </span>
        </div>
      )}
      <Link className="si" href={ROUTES.invite}>
        ＋ New client
      </Link>
    </Sidebar>
  );
}

// ---------------------------------------------------------------- the agency's view

function TeamClients({ live }: { live: LiveClients }) {
  const { s, ui, update, setUI, toast } = useSeek();
  const sp = live.spaces.find((x) => x.id === s.cs) ?? null;
  const tab = TABS.includes(s.cTab) ? s.cTab : 'Client chat';
  const setTab = (t: ClientTab) =>
    update((d) => {
      d.cTab = t;
    });
  const open = (id: string) => {
    update((d) => {
      d.cs = id;
    });
    setUI({ sideOpen: false });
  };

  const appr = useApprovals(sp?.id ?? null);
  const [scheduling, setScheduling] = useState(false);
  const tzLabel = s.ws.tz;
  const clientMsgs = live.spaces.reduce((n, x) => n + (s.lc?.[laneKey(x.id, 'client')]?.length ?? 0), 0);
  const waits = useSpaceWaits(live.orgId, clientMsgs);
  const [nextMeeting, setNextMeeting] = useState<Upcoming | null>(null);
  useEffect(() => {
    if (!sp) return;
    let alive = true;
    void upcomingMeetings().then((l) => alive && setNextMeeting((l ?? []).find((m) => m.spaceId === sp.id) ?? null));
    return () => {
      alive = false;
    };
  }, [sp?.id, clientMsgs]); // eslint-disable-line react-hooks/exhaustive-deps
  const attachTeam = useAttach(sp ? { space: sp.id, lane: 'team' } : null);
  const attachClient = useAttach(sp ? { space: sp.id, lane: 'client' } : null);
  const peopleHere = sp ? ([...sp.people.filter((p) => p.userId).map((p) => p.userId!), ...sp.team.map((t) => t.userId)] as string[]) : [];
  const scheduleTeam = useSchedule(sp ? { space: sp.id, lane: 'team' } : null, sp ? sp.team.map((t) => t.userId) : []);
  const scheduleClient = useSchedule(sp ? { space: sp.id, lane: 'client' } : null, peopleHere);
  const side = <ClientList live={live} current={sp} onOpen={open} waits={waits} />;

  if (!sp) {
    return (
      <Shell active="clients" side={side}>
        <MainHeader title="Clients" sub="one space per client" />
        <div className="pg">
          {live.ready ? (
            <div className="empty">
              <b style={{ display: 'block', fontSize: 16, color: 'var(--ink)' }}>No clients yet</b>
              Each client gets their own space: a Client chat they can see, Team notes they never do, and a short getting-started checklist.
              <br />
              <br />
              <Link className="btn pri" href={ROUTES.invite}>
                ＋ New client
              </Link>
            </div>
          ) : (
            <p className="sub">Loading…</p>
          )}
          <HowSpacesWork />
        </div>
      </Shell>
    );
  }

  const clients = sp.people;
  const joined = clients.filter((p) => p.userId);
  const readers = namesOf(joined.length ? joined : clients);
  const team = tab === 'Team notes';
  const lane = team ? 'team' : 'client';
  const key = laneKey(sp.id, lane);
  const feed: FeedRef = { get: (d) => ((d.lc ||= {})[key] ||= []), where: sp.code, clientVisible: !team };
  const teamKeys = sp.team.map((t) => (t.userId === live.me ? 'AH' : t.userId)) as PersonKey[];
  const clientKeys = joined.map((p) => p.userId as PersonKey);
  const prog = progress(sp);
  const approvers: Approver[] = sp.people.filter((p) => p.role === 'approver' && p.userId).map((p) => ({ userId: p.userId!, name: personName(p) }));
  const waiting = (appr.list ?? []).filter((a) => a.status === 'requested');

  const tabs = (
    <div className="tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={'tb' + (tab === t ? ' on' : '') + (t === 'Client chat' ? ' gold' : '')} onClick={() => setTab(t)}>
          {t}
          {t === 'Status' && sp.status === 'onboarding' && prog.total > 0 && <span className="badge">{`${prog.done}/${prog.total}`}</span>}
          {t === 'Approvals' && waiting.length > 0 && <span className="badge" style={{ background: 'var(--gold)' }}>{waiting.length}</span>}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (tab === 'Client chat' || team) {
    body = (
      <>
        <Feed
          key={key}
          feed={feed}
          banner={
            team ? (
              <div className="banner v">
                🔒{' '}
                <span>
                  <b>Team notes</b> are private to your team. {readers} never see this.
                </span>
              </div>
            ) : (
              <div className="banner gold">
                👁{' '}
                <span>
                  <b>{readers}</b> {clients.length > 1 || !clients.length ? 'see' : 'sees'} everything in Client chat
                  {joined.length < clients.length ? ` (${pending(sp).length} still to join)` : ''}. For internal discussion, use{' '}
                  <button type="button" className="linkbtn" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={() => setTab('Team notes')}>
                    Team notes
                  </button>
                  .
                </span>
              </div>
            )
          }
        />
        {team ? (
          <Composer key={'team' + sp.id} placeholder="Note for the team…" people={teamKeys} onSend={(t) => void live.send(sp.id, 'team', t)} onAttach={attachTeam} onSchedule={scheduleTeam} />
        ) : (
          <Composer
            key={'client' + sp.id}
            placeholder={`Message ${sp.name}…`}
            button="Send to client"
            gold
            note={`Client chat · Visible to ${readers}`}
            people={[...clientKeys, ...teamKeys]}
            onSend={(t) => {
              void live.send(sp.id, 'client', t);
              toast('Sent to ' + readers);
            }}
            onAttach={attachClient}
            onSchedule={scheduleClient}
          />
        )}
      </>
    );
  } else if (tab === 'Status') {
    const w = waitFor(waits.get(sp.id), sp.replyTarget, tzLabel);
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    body = (
      <>
        <div className="pg" style={{ paddingBottom: 0 }}>
          <div className="stats">
            {(
              [
                [prog.total ? pct + '%' : '—', 'checklist complete'],
                [nextMeeting ? dayLabel(new Date(nextMeeting.startsAt)) + ' ' + clock(new Date(nextMeeting.startsAt), null) : '—', 'next meeting'],
                [String(waiting.length), waiting.length === 1 ? 'open approval' : 'open approvals'],
                [w ? w.label : 'replied', w ? 'client waiting' : 'reply timer'],
              ] as [string, string][]
            ).map(([a, b]) => (
              <div key={b} className="stat" style={b === 'client waiting' && w?.over ? { color: 'var(--red)' } : undefined}>
                <b>{a}</b>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
        <Checklist live={live} sp={sp} />
      </>
    );
  } else if (tab === 'Approvals') {
    body = (
      <ApprovalsTab
        space={sp.id}
        list={appr.list}
        reload={appr.reload}
        me={live.me}
        team
        approvers={approvers}
        pendingApprovers={sp.people.filter((p) => p.role === 'approver' && !p.userId).map(firstName)}
      />
    );
  } else if (tab === 'Files') {
    body = (
      <div className="pg">
        <SpaceFiles space={sp.id} me={live.me} lanes />
      </div>
    );
  } else if (tab === 'Pins') {
    const pinnedHere = (['client', 'team'] as const).reduce((n, l) => n + (s.lc?.[laneKey(sp.id, l)] ?? []).filter((m) => m.kind === 'msg' && m.pinned).length, 0);
    body = (
      <div className="pg">
        <PinsList target={{ space: sp.id }} me={live.me} where={'this space'} reloadKey={pinnedHere} />
      </div>
    );
  } else {
    body = <PeopleTab live={live} sp={sp} />;
  }

  const pane = ui.paneOpen ? (
    <Pane title="In this client space" onClose={() => setUI({ paneOpen: false })}>
      <div className="ppl">
        {clients.map((p) => (
          <div key={p.id}>
            {p.userId ? <Avatar k={p.userId} size={32} /> : <span className="av" style={{ width: 32, height: 32, background: 'var(--golds)', color: 'var(--gold)', fontSize: 12 }}>{firstName(p)[0]?.toUpperCase()}</span>}
            <span>
              <b>{personName(p)}</b>
              <small>
                client · {p.role}
                {p.userId ? '' : ' · invited'}
              </small>
            </span>
          </div>
        ))}
        {teamKeys.map((k, i) => (
          <div key={k}>
            <Avatar k={k} size={32} />
            <span>
              <b>{nameOf(k)}</b>
              <small>team{sp.team[i]?.isLead ? ' · lead' : ''}</small>
            </span>
          </div>
        ))}
      </div>
      {(() => {
        const w = waitFor(waits.get(sp.id), sp.replyTarget, tzLabel);
        return w ? (
          <div className={'timer' + (w.over ? ' late' : ' wait')}>
            <b>Reply target: {sp.replyTarget}</b>
            {readers} {clients.length > 1 ? 'have' : 'has'} waited {w.label} (working hours). The timer stops when anyone on the team replies in Client chat.
          </div>
        ) : (
          <div className="timer ok">
            <b>Reply target: {sp.replyTarget}</b>
            {waits.get(sp.id)?.lastReply ? 'Replied ✓ Nobody is waiting.' : 'Nobody is waiting. Shown to ' + readers + ' in their space.'}
          </div>
        );
      })()}
      <button type="button" className="btn pri" onClick={() => setScheduling(true)}>
        ▤ Schedule a call
      </button>
      {waiting.length > 0 && (
        <div className="card">
          <div className="ct">
            <b>Waiting for approval</b>
            <span className="tag gold">{waiting.length}</span>
          </div>
          {waiting.slice(0, 3).map((a) => (
            <small key={a.id} style={{ display: 'block' }}>
              {a.title} · {PEOPLE[a.approver]?.name ?? 'client'}
            </small>
          ))}
          <button type="button" className="btn sm" onClick={() => setTab('Approvals')}>
            Open approvals
          </button>
        </div>
      )}
      {sp.status === 'onboarding' && prog.total > 0 && (
        <div className="card">
          <div className="ct">
            <b>Onboarding</b>
            <span className="tag gold">{`${prog.done}/${prog.total}`}</span>
          </div>
          <button type="button" className="btn sm" onClick={() => setTab('Status')}>
            Open checklist
          </button>
        </div>
      )}
    </Pane>
  ) : undefined;

  return (
    <Shell active="clients" side={side} pane={pane}>
      <MainHeader
        title={sp.name}
        sub={`Client space${sp.project ? ' · ' + sp.project.toLowerCase() : ''}${sp.status === 'onboarding' ? ' · onboarding' : ''}`}
        right={
          <>
            <span className="stack hide-m">
              {clientKeys.slice(0, 3).map((k) => (
                <Avatar key={k} k={k} size={26} />
              ))}
            </span>
            <button type="button" className="btn sm" onClick={() => setScheduling(true)} title="Schedule a call">
              ▤ <span className="hide-m">Schedule</span>
            </button>
            <button type="button" className="btn sm" onClick={() => setUI((u) => ({ paneOpen: !u.paneOpen }))} aria-label="Space details" aria-pressed={ui.paneOpen}>
              ⓘ
            </button>
          </>
        }
        below={tabs}
      />
      {body}
      {scheduling && (
        <ScheduleDialog
          sp={sp}
          me={live.me}
          onClose={() => setScheduling(false)}
          onScheduled={(toClient) => setTab(toClient ? 'Client chat' : 'Team notes')}
        />
      )}
    </Shell>
  );
}

function HowSpacesWork() {
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="ct">
        <b>How client spaces work</b>
      </div>
      <small style={{ color: 'var(--mu)', lineHeight: 1.7 }}>
        <b style={{ color: 'var(--gold)' }}>Client chat</b> · the client sees every message here.
        <br />
        <b>Team notes</b> · only your team. The client never sees it.
        <br />
        <b>Onboarding</b> · steps the client completes in their space.
        <br />
        <b>Reply target</b> · how quickly your team aims to reply, shown to the client.
      </small>
    </div>
  );
}

/** The onboarding checklist (team view: both sides; client view: only their steps). */
function Checklist({ live, sp, client }: { live: LiveClients; sp: Space; client?: boolean }) {
  const { toast } = useSeek();
  const steps = client ? sp.steps.filter((x) => x.side === 'client') : sp.steps;
  const done = steps.filter((x) => x.doneAt).length;
  const next = steps.find((x) => !x.doneAt);
  return (
    <div className="pg">
      <div className="card">
        <div className="ct">
          <b>{client ? 'Getting started' : 'Onboarding'}</b>
          <span className={'tag ' + (done === steps.length && steps.length ? 'ok' : 'gold')}>{`${done} of ${steps.length} done`}</span>
        </div>
        {!client && (
          <small style={{ color: 'var(--mu)' }}>
            {sp.status === 'active'
              ? 'All steps are done. This client space is now ongoing.'
              : next
                ? `Next: ${next.title} · ${next.side === 'client' ? 'on the client' : 'on your team'}`
                : 'Add steps to track onboarding.'}
          </small>
        )}
        {!steps.length && <small style={{ color: 'var(--sb)' }}>No steps for this client.</small>}
        {steps.map((x, i) => {
          const mine = client ? x.side === 'client' : true;
          return (
            <div key={x.id} className="trow" style={{ alignItems: 'center' }}>
              <div>
                <b style={{ textDecoration: x.doneAt ? 'line-through' : undefined, color: x.doneAt ? 'var(--sb)' : undefined }}>
                  {i + 1}. {x.title}
                </b>
                <small>
                  {x.detail || (x.side === 'client' ? 'client step' : 'team step')}
                  {x.doneAt ? ' · done ' + new Date(x.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                </small>
              </div>
              {!client && <span className={'tag' + (x.side === 'client' ? ' gold' : '')}>{x.side}</span>}
              {mine && x.kind !== 'profile' && (
                <button
                  type="button"
                  className={'btn sm' + (x.doneAt ? '' : client ? ' gold' : ' pri')}
                  onClick={async () => {
                    await live.tick(x.id, !x.doneAt);
                    toast(x.doneAt ? 'Marked as not done' : 'Done ✓');
                  }}
                >
                  {x.doneAt ? 'Undo' : 'Mark done'}
                </button>
              )}
              {x.kind === 'profile' && <span className={'tag' + (x.doneAt ? ' ok' : '')}>{x.doneAt ? '✓ Done' : 'When they sign in'}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** People at the client: roles, invite status, add / resend / remove. */
function PeopleTab({ live, sp }: { live: LiveClients; sp: Space }) {
  const { toast } = useSeek();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<ClientRole>('contributor');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!isEmail(email.trim())) {
      toast('Enter their email');
      return;
    }
    setBusy(true);
    const msg = await live.addPerson(sp.id, { email, name, role });
    setBusy(false);
    toast(msg);
    setEmail('');
    setName('');
  };
  return (
    <div className="pg">
      <div className="card">
        <div className="ct">
          <b>People at {sp.name}</b>
          <span className="tag">{sp.people.length}</span>
        </div>
        <small style={{ color: 'var(--mu)' }}>Approvers can formally approve, contributors can write and upload, viewers can only read.</small>
        {sp.people.map((p) => (
          <div key={p.id} className="trow" style={{ alignItems: 'center' }}>
            <div>
              <b>{personName(p)}</b>
              <small>
                {p.email} · {p.userId ? 'joined' : 'invite pending'}
              </small>
            </div>
            <select
              className="inp"
              style={{ width: 'auto' }}
              aria-label={'Role for ' + personName(p)}
              value={p.role}
              onChange={async (e) => {
                const err = await live.setRole(p.id, e.target.value as ClientRole);
                toast(err ?? 'Role changed');
              }}
            >
              {ROLES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {!p.userId && (
              <button type="button" className="btn sm" onClick={async () => toast(await live.resend(sp.id, p.email))}>
                Resend
              </button>
            )}
            <button
              type="button"
              className="btn sm ghost"
              onClick={async () => {
                if (!confirm(`Remove ${personName(p)} from ${sp.name}? They are signed out of the space at once. Their messages stay in the record.`)) return;
                const err = await live.remove(p.id);
                toast(err ?? personName(p) + ' removed');
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <form
          className="fld"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label>Add client person</label>
          <div className="copyrow" style={{ flexWrap: 'wrap' }}>
            <input className="inp" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 120px', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)' }} />
            <input className="inp" type="email" placeholder="name@client.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: '2 1 180px', fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)' }} />
            <select className="inp" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value as ClientRole)} aria-label="Role">
              {ROLES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button type="submit" className="btn pri" disabled={busy}>
              {busy ? 'Inviting…' : 'Add and invite'}
            </button>
          </div>
          <em>They get an email with a Join button. No password.</em>
        </form>
      </div>
      <div className="card">
        <div className="ct">
          <b>Your team on this client</b>
        </div>
        <div className="ppl">
          {sp.team.map((t) => {
            const k = (t.userId === live.me ? 'AH' : t.userId) as PersonKey;
            return (
              <div key={t.userId}>
                <Avatar k={k} size={32} />
                <span>
                  <b>{nameOf(k)}</b>
                  <small>{t.isLead ? 'lead' : 'team'}</small>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LiveMeetings({ live }: { live: LiveClients }) {
  const { s, update, setUI } = useSeek();
  const router = useRouter();
  const sp = live.spaces.find((x) => x.id === s.cs) ?? live.spaces[0] ?? null;
  const [list, setList] = useState<Upcoming[] | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void upcomingMeetings().then((l) => alive && setList(l ?? []));
    return () => {
      alive = false;
    };
  }, [tick]);
  const openSpace = (id: string, toClient: boolean) => {
    update((d) => {
      d.cs = id;
      d.cTab = toClient ? 'Client chat' : 'Team notes';
    });
    router.push(ROUTES.clients);
  };
  return (
    <Shell
      active="meetings"
      side={
        <ClientList
          live={live}
          current={sp}
          onOpen={(id) => {
            update((d) => {
              d.cs = id;
            });
            setUI({ sideOpen: false });
          }}
        />
      }
    >
      <MainHeader
        title="Meetings"
        sub="calls with your clients, in your time"
        right={
          sp ? (
            <button type="button" className="btn sm pri" onClick={() => setScheduling(true)}>
              ▤ Schedule with {sp.name}
            </button>
          ) : undefined
        }
      />
      <div className="pg">
        {!list ? (
          <p className="sub">Loading…</p>
        ) : !list.length ? (
          <div className="empty">
            <b style={{ display: 'block', fontSize: 16, color: 'var(--ink)' }}>No meetings coming up</b>
            {sp ? 'Pick a client on the left and schedule a call. The invite is posted in their Client chat with a calendar file.' : 'Add a client first, then schedule calls with them here.'}
          </div>
        ) : (
          <div className="flist">
            {list.map((m) => {
              const d = new Date(m.startsAt);
              const end = new Date(d.getTime() + m.minutes * 60e3);
              return (
                <div key={m.id} className="frow">
                  <span className="av" style={{ width: 36, height: 36, borderRadius: 9, background: m.color, fontSize: 12, flex: 'none' }}>
                    {m.code}
                  </span>
                  <span className="x">
                    <b>{m.title}</b>
                    <small>
                      {dayLabel(d)} {clock(d, null)}–{clock(end, null)} · {m.space} · {toolName(m.tool)}
                      {m.toClient ? '' : ' · team only'}
                    </small>
                  </span>
                  {m.link.startsWith('https://') && (
                    <a className="btn sm pri" href={m.link} target="_blank" rel="noopener noreferrer">
                      Join
                    </a>
                  )}
                  <button type="button" className="btn sm" onClick={() => openSpace(m.spaceId, m.toClient)}>
                    Open
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {scheduling && sp && (
        <ScheduleDialog
          sp={sp}
          me={live.me}
          onClose={() => setScheduling(false)}
          onScheduled={() => setTick((t) => t + 1)}
        />
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- the client's own view

type PortalTab = 'start' | 'chat' | 'status' | 'approvals' | 'files' | 'pins' | 'calls' | 'settings';

function ClientPortal({ live }: { live: LiveClients }) {
  const { s, update, setUI } = useSeek();
  const [tab, setTab] = useState<PortalTab>('start');
  const sp = live.spaces.find((x) => x.id === s.cs) ?? live.spaces[0] ?? null;
  const me = sp?.people.find((p) => p.userId === live.me) ?? null;
  const canWrite = !!me && me.role !== 'viewer';
  const agency = s.ws.name || 'your agency';
  const appr = useApprovals(sp?.id ?? null);
  const attach = useAttach(sp && canWrite ? { space: sp.id, lane: 'client' } : null);
  const mineWaiting = (appr.list ?? []).filter((a) => a.status === 'requested' && a.approver === live.me).length;
  // a notification about an approval opens the Approvals tab
  useEffect(() => {
    if (s.cTab === 'Approvals') {
      setTab('approvals');
      update((d) => {
        d.cTab = 'Client chat';
      });
    }
  }, [s.cTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // the profile step is done once they've signed in and set up their profile
  const profileStep = sp?.steps.find((x) => x.kind === 'profile' && !x.doneAt)?.id;
  useEffect(() => {
    if (profileStep && live.ready) void live.tick(profileStep, true);
  }, [profileStep, live.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (t: PortalTab) => {
    setTab(t);
    setUI({ sideOpen: false });
  };
  const prog = sp ? progress(sp, 'client') : { done: 0, total: 0 };
  // a simple invite has no getting-started checklist: open straight on the conversation
  const noSteps = !!sp && live.ready && prog.total === 0;
  useEffect(() => {
    if (noSteps && tab === 'start') setTab('chat');
  }, [noSteps, tab]);

  const side = (
    <Sidebar title={sp?.name ?? 'Your project'} sub={sp ? `with ${agency}${sp.project ? ' · ' + sp.project : ''}` : ''}>
      {live.spaces.length > 1 && (
        <>
          <div className="sg lbl">Your projects</div>
          {live.spaces.map((x) => (
            <button
              key={x.id}
              type="button"
              className={'si' + (x.id === sp?.id ? ' on' : '')}
              onClick={() =>
                update((d) => {
                  d.cs = x.id;
                })
              }
            >
              <SpaceMark sp={x} />
              <span className="x">
                <b>{x.name}</b>
                <small>{x.project}</small>
              </span>
            </button>
          ))}
        </>
      )}
      <div className="sg lbl">Your space</div>
      {(
        [
          ...(noSteps ? [] : ([['start', 'Getting started', prog.total ? `${prog.done}/${prog.total}` : '']] as [PortalTab, string, string][])),
          ['chat', 'Conversation', ''],
          ['status', 'Project status', ''],
          ['approvals', 'Approvals', mineWaiting ? String(mineWaiting) : ''],
          ['files', 'Files', ''],
          ['pins', 'Pinned', ''],
          ['calls', 'Upcoming calls', ''],
          ['settings', 'Settings', ''],
        ] as [PortalTab, string, string][]
      ).map(([k, l, b]) => (
        <button key={k} type="button" className={'si' + (tab === k ? ' on' : '')} aria-current={tab === k ? 'page' : undefined} onClick={() => open(k)}>
          <span className="x">
            <b>{l}</b>
          </span>
          {b && <span className="tag">{b}</span>}
        </button>
      ))}
    </Sidebar>
  );

  if (!sp) {
    return (
      <Shell active="clients" side={side} rail={<ClientRail />}>
        <MainHeader title="Your project" sub={agency} />
        <div className="pg">
          <div className="empty">{live.ready ? 'You don’t have a project space yet. Use the link in your invite email.' : 'Loading…'}</div>
        </div>
      </Shell>
    );
  }

  const team = sp.team.map((t) => t.userId as PersonKey);
  const others = sp.people.filter((p) => p.userId && p.userId !== live.me).map((p) => p.userId as PersonKey);
  const key = laneKey(sp.id, 'client');
  const feed: FeedRef = { get: (d) => ((d.lc ||= {})[key] ||= []), where: sp.code, clientVisible: true };
  const replyLine = `The ${agency} team replies within ${sp.replyTarget}.`;

  let body: React.ReactNode;
  if (tab === 'chat') {
    body = (
      <>
        <Feed
          key={key}
          feed={feed}
          banner={
            <div className="banner gold">
              🕑 <span>{replyLine}</span>
            </div>
          }
        />
        {canWrite ? (
          <Composer key={'c' + sp.id} placeholder={`Message the ${agency} team…`} people={[...team, ...others]} onSend={(t) => void live.send(sp.id, 'client', t)} onAttach={attach} />
        ) : (
          <div className="banner">You can read this conversation. Ask the team if you need to write here.</div>
        )}
      </>
    );
  } else if (tab === 'approvals') {
    body = <ApprovalsTab space={sp.id} list={appr.list} reload={appr.reload} me={live.me} team={false} approvers={[]} />;
  } else if (tab === 'calls') {
    body = (
      <div className="pg">
        <UpcomingCalls space={sp.id} />
      </div>
    );
  } else if (tab === 'settings') {
    body = (
      <div className="pg">
        <ClientSettings agency={agency} />
      </div>
    );
  } else if (tab === 'pins') {
    body = (
      <div className="pg">
        <PinsList target={{ space: sp.id, lane: 'client' }} me={live.me} where={'your conversation'} canUnpin={false} />
      </div>
    );
  } else if (tab === 'files') {
    body = (
      <div className="pg">
        <SpaceFiles space={sp.id} me={live.me} />
      </div>
    );
  } else if (tab === 'status') {
    const all = progress(sp, 'client');
    body = (
      <div className="pg">
        <div className="stats">
          {[
            [sp.status === 'onboarding' ? 'Getting started' : 'Ongoing', 'stage'],
            [`${all.done}/${all.total}`, 'your steps done'],
            [sp.replyTarget, 'reply target'],
          ].map(([a, b]) => (
            <div key={b} className="stat">
              <b>{a}</b>
              <span>{b}</span>
            </div>
          ))}
        </div>
        <div className="empty">Milestones and dates your team shares will show here.</div>
      </div>
    );
  } else {
    body = (
      <>
        <div className="pg" style={{ paddingBottom: 0 }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>Welcome{me?.name ? ', ' + firstName(me) : ''}</h2>
            <p style={{ margin: 0, color: 'var(--mu)' }}>A few quick steps so the {agency} team can get started. Your progress saves as you go.</p>
          </div>
        </div>
        <Checklist live={live} sp={sp} client />
        <div className="pg" style={{ paddingTop: 0 }}>
          <div className="card">
            <div className="ct">
              <b>Your team at {agency}</b>
            </div>
            <div className="ppl">
              {sp.team.map((t) => (
                <div key={t.userId}>
                  <Avatar k={t.userId} size={32} />
                  <span>
                    <b>{nameOf(t.userId)}</b>
                    <small>{t.isLead ? 'your project lead' : 'team'}</small>
                  </span>
                </div>
              ))}
            </div>
            <small style={{ color: 'var(--mu)' }}>{replyLine}</small>
            <button type="button" className="btn gold" onClick={() => open('chat')}>
              Say hello
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <Shell active="clients" side={side} rail={<ClientRail />}>
      <MainHeader
        title={tab === 'chat' ? 'Conversation' : tab === 'status' ? 'Project status' : tab === 'approvals' ? 'Approvals' : tab === 'files' ? 'Files' : tab === 'pins' ? 'Pinned' : tab === 'calls' ? 'Upcoming calls' : tab === 'settings' ? 'Settings' : sp.name}
        sub={tab === 'chat' ? `You${others.length ? ', ' + others.map((k) => nameOf(k).split(' ')[0]).join(', ') : ''} and the ${agency} team` : `${sp.project || 'Project space'} · with ${agency}`}
        right={
          <span className="stack hide-m">
            {team.slice(0, 3).map((k) => (
              <Avatar key={k} k={k} size={26} />
            ))}
          </span>
        }
      />
      {body}
    </Shell>
  );
}

/** Every file shared in a client space that you can see (clients: only Client chat), newest first. */
function SpaceFiles({ space, me, lanes }: { space: string; me: string | null; lanes?: boolean }) {
  const { s } = useSeek();
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  // reload when a message with files arrives in either lane
  const count = (['client', 'team'] as const).reduce((n, l) => n + (s.lc?.[laneKey(space, l)] ?? []).filter((m) => m.kind === 'msg' && m.files?.length).length, 0);
  useEffect(() => {
    let alive = true;
    void spaceFiles(space).then((f) => alive && setFiles(f ?? []));
    return () => {
      alive = false;
    };
  }, [space, count]);
  return (
    <FileList
      files={files}
      me={me}
      lanes={lanes}
      empty={lanes ? 'No files yet. Share one with ＋ in Client chat (the client sees it) or Team notes (they never do).' : 'No files yet. Files you and the team share in the conversation show here.'}
    />
  );
}

/** The client's upcoming calls with the agency (only the ones sent to them), with Join and Add to calendar. */
function UpcomingCalls({ space }: { space: string }) {
  const { s } = useSeek();
  const [list, setList] = useState<Upcoming[] | null>(null);
  const msgs = s.lc?.[laneKey(space, 'client')]?.length ?? 0;
  useEffect(() => {
    let alive = true;
    void upcomingMeetings().then((l) => alive && setList((l ?? []).filter((m) => m.spaceId === space)));
    return () => {
      alive = false;
    };
  }, [space, msgs]);
  if (!list) return <p className="sub">Loading…</p>;
  if (!list.length) return <div className="empty">No calls booked. When the team schedules one with you, it shows here and in your conversation.</div>;
  return (
    <div className="flist">
      {list.map((m) => {
        const d = new Date(m.startsAt);
        const end = new Date(d.getTime() + m.minutes * 60e3);
        return (
          <div key={m.id} className="frow">
            <span className="av" style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--v)', fontSize: 15, flex: 'none' }}>
              ▤
            </span>
            <span className="x">
              <b>{m.title}</b>
              <small>
                {dayLabel(d)} {clock(d, null)}–{clock(end, null)} (your time) · {toolName(m.tool)}
              </small>
            </span>
            {m.link.startsWith('https://') && (
              <a className="btn sm pri" href={m.link} target="_blank" rel="noopener noreferrer">
                Join
              </a>
            )}
            <button
              type="button"
              className="btn sm"
              onClick={() => downloadIcs({ id: m.id, title: m.title, starts_at: m.startsAt, duration: m.minutes, tool: m.tool, link: m.link, agenda: '' }, s.ws.name || 'Seek')}
            >
              Add to calendar
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The client's own settings: their name and title, how often they get email, desktop alerts, sign out. */
function ClientSettings({ agency }: { agency: string }) {
  const { s, update, toast } = useSeek();
  const [name, setName] = useState(s.me.name);
  const [title, setTitle] = useState(s.me.title);
  const [notify, setNotify] = useState<'instant' | 'daily' | 'off'>(s.me.notifyEmail ?? 'instant');
  const [busy, setBusy] = useState(false);
  const canAlert = typeof window !== 'undefined' && 'Notification' in window;
  const [alerts, setAlerts] = useState(canAlert ? Notification.permission : 'denied');
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="ct">
        <b>Your details</b>
      </div>
      <div className="fld">
        <label htmlFor="cs-n">Your name</label>
        <input id="cs-n" className="inp" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="fld">
        <label htmlFor="cs-t">Your role</label>
        <input id="cs-t" className="inp" value={title} maxLength={60} placeholder="e.g. Marketing lead" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="fld">
        <label htmlFor="cs-e">Email me about replies, approvals and calls</label>
        <select id="cs-e" className="inp" value={notify} onChange={(e) => setNotify(e.target.value as typeof notify)}>
          <option value="instant">As they happen</option>
          <option value="daily">Once a day (summary)</option>
          <option value="off">Never (I’ll check Seek)</option>
        </select>
        <em>Saved now; email starts once {agency}’s Seek email sending is set up. You always see updates here and in 🔔.</em>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn pri"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const err = await saveProfile({ name: name.trim(), title: title.trim(), notifyEmail: notify });
            setBusy(false);
            if (err) return toast(err);
            update((d) => {
              d.me.name = name.trim();
              d.me.title = title.trim();
              d.me.notifyEmail = notify;
            });
            toast('Settings saved');
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {canAlert && alerts !== 'granted' && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const r = await Notification.requestPermission();
              setAlerts(r);
              toast(r === 'granted' ? 'Desktop alerts are on' : 'Desktop alerts stay off (you can allow them in your browser)');
            }}
          >
            Get desktop alerts
          </button>
        )}
        <span style={{ flex: 1 }}></span>
        <button type="button" className="btn ghost" onClick={() => void signOut().then(() => location.assign('/signup'))}>
          Sign out
        </button>
      </div>
    </div>
  );
}
