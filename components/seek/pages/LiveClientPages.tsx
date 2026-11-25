'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ClientRole } from '@/lib/seek/backend';
import { PEOPLE, type ClientTab, type PersonKey } from '@/lib/seek/data';
import { isEmail } from '@/lib/seek/format';
import { laneKey, namesOf, pending, useLiveClients, type LiveClients, type Space } from '@/lib/seek/liveClients';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { Composer, ConvStart, Feed, type FeedRef } from '../Messages';
import { ClientRail, MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Avatar, OrgMark, SeenText } from '../ui';
import { ClientStatus, useSpaceCalls, WaitingBanner, WaitingForYou } from '../ClientHome';
import { ApprovalsTab, type Approver } from '../Approvals';
import { ScheduleDialog } from '../Meetings';
import { SoundSettings } from '../SoundSettings';
import { clock, dayLabel, downloadIcs, toolName, upcomingMeetings, type Upcoming } from '@/lib/seek/liveMeetings';
import { saveProfile, signOut } from '@/lib/seek/backend';
import { useSpaceWaits, waitFor, type Wait } from '@/lib/seek/liveTimer';
import { FileList, useAttach } from '../Files';
import { PinsList, useSchedule } from '../Extras';
import { useApprovals } from '@/lib/seek/liveApprovals';
import { spaceFiles, type SharedFile } from '@/lib/seek/liveFiles';
import { Ic } from '../icons';
import { SpaceHint, SpaceTabs } from '../SpaceChat';
import { DraftUpdateDialog, ScopeHoursTab } from '../ScopeHours';
import { useConfirm } from '../Dialogs';
import { markRead, spaceUnreadCounts, viewingSpace } from '@/lib/seek/liveSync';
import { flashMessage } from '@/lib/seek/liveDecisions';
import { toUiId } from '@/lib/seek/live';
import type { SpaceSettingsTab } from '../SpaceSettings';
import { SpaceAgentsButton, SpaceCatchUp } from '../SpaceTools';
import dynamic from 'next/dynamic';

// the new-client and space settings dialogs open on a click, so they load then (not with the page)
const ClientInviteDialog = dynamic(() => import('../ClientInviteDialog').then((m) => m.ClientInviteDialog), { ssr: false });
const SpaceSettings = dynamic(() => import('../SpaceSettings').then((m) => m.SpaceSettings), { ssr: false });

/**
 * Client spaces with a real backend. The agency's team sees every client with Client chat, Team notes, Status,
 * Approvals and People; a client (signed in from their invite) sees only their own project space.
 */
export function LiveClientsPage({ scheduling, inviting }: { scheduling?: boolean; inviting?: boolean }) {
  const { s, update } = useSeek();
  const live = useLiveClients();
  // unread counts per client: Home's chat loads them too, but someone can open Clients first
  const team = s.session === 'in' ? (s.orgId ?? null) : null;
  useEffect(() => {
    if (!team) return;
    let alive = true;
    void spaceUnreadCounts(team).then((counts) => {
      if (!alive) return;
      update((d) => {
        d.spUnread = counts;
        if (viewingSpace.key) delete d.spUnread[viewingSpace.key];
      });
    });
    return () => {
      alive = false;
    };
  }, [team]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!live) return null;
  if (s.session === 'client') return <ClientPortal live={live} />;
  if (scheduling) return <LiveMeetings live={live} />;
  return <TeamClients live={live} inviting={inviting} />;
}

const TABS: ClientTab[] = ['Client chat', 'Team notes', 'Status', 'Scope & hours', 'Approvals', 'Files', 'Pins', 'People'];
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
function ClientList({ live, current, onOpen, waits, onNew }: { live: LiveClients; current: Space | null; onOpen: (id: string) => void; waits?: Map<string, Wait>; onNew?: () => void }) {
  const { s } = useSeek();
  const tzLabel = s.ws.tz;
  const unreadIn = (id: string) => (s.spUnread?.[laneKey(id, 'client')] ?? 0) + (s.spUnread?.[laneKey(id, 'team')] ?? 0);
  return (
    <Sidebar
      title="Clients"
      sub="one space per client"
      action={
        <NewClientButton className="btn sm" onNew={onNew}>
          <Ic n="plus" size={14} /> New
        </NewClientButton>
      }
    >
      <div className="sg lbl">Client spaces</div>
      {live.spaces.length ? (
        live.spaces.map((x) => {
          const p = progress(x);
          const w = waitFor(waits?.get(x.id), x.replyTarget, tzLabel);
          const n = unreadIn(x.id);
          return (
            <button key={x.id} type="button" className={'si' + (x.id === current?.id ? ' on' : '') + (n ? ' unread' : '')} aria-current={x.id === current?.id ? 'page' : undefined} onClick={() => onOpen(x.id)}>
              <SpaceMark sp={x} />
              <span className="x">
                <b>{x.name}</b>
                <small>{x.project || 'Client space'}</small>
              </span>
              {n > 0 && (
                <span className="badge" title={n + ' unread in Client chat and Team notes'}>
                  {n > 99 ? '99+' : n}
                  <span className="sr-only"> unread</span>
                </span>
              )}
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
      <NewClientButton className="si" onNew={onNew}>
        <Ic n="plus" size={14} /> New client
      </NewClientButton>
    </Sidebar>
  );
}

// ---------------------------------------------------------------- the agency's view

function TeamClients({ live, inviting }: { live: LiveClients; inviting?: boolean }) {
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
  const [drafting, setDrafting] = useState(false);
  const [newClient, setNewClient] = useState(!!inviting);
  const [settings, setSettings] = useState<SpaceSettingsTab | null>(null);
  const router = useRouter();
  // the details pane stays open or closed as you left it (this device); the first time, only wide screens open it
  useEffect(() => {
    if (window.innerWidth <= 760) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('seek:spacePane');
    } catch {}
    const want = saved ? saved === '1' : window.innerWidth >= 1440;
    setUI({ paneOpen: want });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setPane = (open: boolean) => {
    setUI({ paneOpen: open });
    if (window.innerWidth <= 760) return;
    try {
      localStorage.setItem('seek:spacePane', open ? '1' : '0');
    } catch {}
  };

  // the open Client chat or Team notes counts as read while it is on screen (and new messages in it too)
  const viewKey = sp && (tab === 'Client chat' || tab === 'Team notes') ? laneKey(sp.id, tab === 'Team notes' ? 'team' : 'client') : null;
  const seen = viewKey ? (s.lc?.[viewKey]?.length ?? 0) : 0;
  useEffect(() => {
    viewingSpace.key = viewKey;
    if (!viewKey) return;
    markRead('sp:' + viewKey);
    if (s.spUnread?.[viewKey])
      update((d) => {
        if (d.spUnread) delete d.spUnread[viewKey];
      });
    return () => {
      if (viewingSpace.key === viewKey) viewingSpace.key = null;
    };
  }, [viewKey, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeNew = (id?: string) => {
    setNewClient(false);
    if (id) {
      void live.reload();
      update((d) => {
        d.cs = id;
        d.cTab = 'Client chat';
      });
    }
    if (inviting) router.replace(ROUTES.clients);
  };
  const newDialog = newClient ? <ClientInviteDialog onClose={() => closeNew()} onCreated={(id) => closeNew(id)} /> : null;
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
  const side = <ClientList live={live} current={sp} onOpen={open} waits={waits} onNew={() => setNewClient(true)} />;

  if (!sp) {
    return (
      <Shell active="clients" side={side}>
        <MainHeader title="Clients" sub="one space per client" />
        <div className="pg">
          {live.ready ? (
            <div className="empty">
              <b style={{ display: 'block', fontSize: 17, color: 'var(--ink)' }}>No clients yet</b>
              Each client gets their own space: a Client chat they can see, Team notes they never do, and a short getting-started checklist.
              <br />
              <br />
              <button type="button" className="btn pri" onClick={() => setNewClient(true)}>
                <Ic n="plus" size={14} /> New client
              </button>
            </div>
          ) : (
            <p className="sub">Loading…</p>
          )}
          <HowSpacesWork />
        </div>
        {newDialog}
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

  const tabBadge = (t: ClientTab) =>
    t === 'Status' && sp.status === 'onboarding' && prog.total > 0 ? (
      <span className="badge">{`${prog.done}/${prog.total}`}</span>
    ) : t === 'Approvals' && waiting.length > 0 ? (
      <span className="badge gold">{waiting.length}</span>
    ) : null;
  const tabs = <SpaceTabs tabs={TABS} tab={tab} setTab={setTab} badge={tabBadge} />;
  const sees = clients.length > 1 || !clients.length ? 'see' : 'sees';
  const toJoin = joined.length < clients.length ? pending(sp).length : 0;

  let body: React.ReactNode;
  if (tab === 'Client chat' || team) {
    body = (
      <>
        <Feed
          key={key}
          feed={feed}
          banner={
            team ? (
              <SpaceHint id={sp.id + ':team'} tone="v" icon="lock">
                <b>Private to your team.</b> {readers} never {clients.length > 1 || !clients.length ? 'see' : 'sees'} Team notes.
              </SpaceHint>
            ) : (
              <SpaceHint id={sp.id + ':client'} tone="gold" icon="eye">
                <b>{readers}</b> {sees} everything here{toJoin ? ` (${toJoin} still to join)` : ''}. For internal talk, use{' '}
                <button type="button" className="linkbtn" onClick={() => setTab('Team notes')}>
                  Team notes
                </button>
                .
              </SpaceHint>
            )
          }
          empty={
            team ? (
              <ConvStart mark={<Ic n="lock" size={22} />} title={<>Team notes for {sp.name}</>}>
                Only your team sees this; {readers} never {clients.length > 1 || !clients.length ? 'do' : 'does'}. Plan the work, share drafts and agree on replies before they go to the client.
              </ConvStart>
            ) : (
              <ConvStart
                mark={<SpaceMark sp={sp} size={52} />}
                title={<>Start the conversation with {sp.name}</>}
                actions={
                  <>
                    <button type="button" className="btn sm" onClick={() => setScheduling(true)}>
                      <Ic n="calendar" size={14} /> Schedule a call
                    </button>
                    <button type="button" className="btn sm" onClick={() => setTab('Team notes')}>
                      <Ic n="lock" size={14} /> Open Team notes
                    </button>
                  </>
                }
              >
                <b>{readers}</b> {sees} everything in Client chat{toJoin ? ` (${toJoin} still to join)` : ''}. Say hello, share a file or book a first call.
              </ConvStart>
            )
          }
        />
        {team ? (
          <Composer
            key={'team' + sp.id}
            placeholder="Note for the team…"
            note={<>Team notes · only your team</>}
            people={teamKeys}
            onSend={(t) => live.send(sp.id, 'team', t)}
            onAttach={attachTeam}
            onSchedule={scheduleTeam}
          />
        ) : (
          <Composer
            key={'client' + sp.id}
            placeholder={`Message ${sp.name}…`}
            button="Send to client"
            gold
            note={
              <>
                Visible to <b>{readers}</b>
              </>
            }
            people={[...clientKeys, ...teamKeys]}
            onSend={(t) => {
              toast('Sent to ' + readers);
              return live.send(sp.id, 'client', t);
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
        <Checklist live={live} sp={sp} onEdit={() => setSettings('Checklist')} />
      </>
    );
  } else if (tab === 'Scope & hours') {
    body = <ScopeHoursTab key={sp.id} live={live} sp={sp} onDraft={() => setDrafting(true)} />;
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
        onOpenMessage={(id) => {
          setTab('Client chat');
          flashMessage(toUiId(id));
        }}
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
    body = <PeopleTab live={live} sp={sp} onManageTeam={() => setSettings('Team')} />;
  }

  const pane = ui.paneOpen ? (
    <Pane title="In this client space" className="sp-pane" onClose={() => setPane(false)}>
      <div className="ppl">
        {clients.map((p) => (
          <div key={p.id}>
            {p.userId ? <Avatar k={p.userId} size={32} presence /> : <span className="av" style={{ width: 32, height: 32, background: 'var(--golds)', color: 'var(--gold)', fontSize: 13 }}>{firstName(p)[0]?.toUpperCase()}</span>}
            <span>
              <b>{personName(p)}</b>
              <small>
                client · {p.role}
                {p.userId ? <SeenText id={p.userId} prefix=" · " /> : ' · invited'}
              </small>
            </span>
          </div>
        ))}
        {teamKeys.map((k, i) => (
          <div key={k}>
            <Avatar k={k} size={32} presence />
            <span>
              <b>{nameOf(k)}</b>
              <small>
                team{sp.team[i]?.isLead ? ' · lead' : ''}
                <SeenText id={k} prefix=" · " />
              </small>
            </span>
          </div>
        ))}
        <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setSettings('Team')}>
          Manage your team on this client
        </button>
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
            {waits.get(sp.id)?.lastReply ? 'Replied. Nobody is waiting.' : 'Nobody is waiting. Shown to ' + readers + ' in their space.'}
          </div>
        );
      })()}
      <button type="button" className="btn pri" onClick={() => setScheduling(true)}>
        <Ic n="calendar" /> Schedule a call
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
            {/* AI for this client: catch up on the open lane, and the agents on this space (opens Space settings → AI agents) */}
            <SpaceCatchUp space={sp.id} lane={lane} name={sp.name} />
            <SpaceAgentsButton space={sp.id} ws={live.orgId} onOpen={() => setSettings('AI agents')} compact />
            <button type="button" className="btn sm" onClick={() => setDrafting(true)} title="Draft weekly update (Status drafter)" aria-label="Draft update">
              <Ic n="ai" /> <span className="hide-m hide-n">Draft update</span>
            </button>
            <button type="button" className="btn sm" onClick={() => setScheduling(true)} title="Schedule a call" aria-label="Schedule a call">
              <Ic n="calendar" /> <span className="hide-m hide-n">Schedule</span>
            </button>
            <button type="button" className="btn sm" onClick={() => setSettings('General')} aria-label="Space settings" title="Space settings: name, team, checklist, archive">
              <Ic n="settings" />
            </button>
            <button
              type="button"
              className={'btn sm' + (ui.paneOpen ? ' on' : '')}
              onClick={() => setPane(!ui.paneOpen)}
              aria-label="Space details"
              aria-pressed={ui.paneOpen}
              title={ui.paneOpen ? 'Hide space details' : 'Show space details'}
            >
              <Ic n="panel" />
            </button>
          </>
        }
        below={tabs}
      />
      {body}
      {scheduling && (
        <ScheduleDialog
          sp={sp}
          spaces={live.spaces}
          me={live.me}
          onClose={() => setScheduling(false)}
          onScheduled={(toClient) => setTab(toClient ? 'Client chat' : 'Team notes')}
        />
      )}
      {drafting && (
        <DraftUpdateDialog
          live={live}
          sp={sp}
          readers={readers}
          onClose={() => setDrafting(false)}
          onSent={() => {
            setDrafting(false);
            setTab('Client chat');
          }}
        />
      )}
      {newDialog}
      {settings && <SpaceSettings live={live} sp={sp} tab={settings} onClose={() => setSettings(null)} onArchived={() => setSettings(null)} />}
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
function Checklist({ live, sp, client, onEdit }: { live: LiveClients; sp: Space; client?: boolean; /** team: opens Space settings → Checklist */ onEdit?: () => void }) {
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
          {!client && onEdit && (
            <button type="button" className="btn sm" onClick={onEdit}>
              <Ic n="edit" size={14} /> {steps.length ? 'Edit checklist' : 'Add steps'}
            </button>
          )}
        </div>
        {!client && (
          <small style={{ color: 'var(--mu)' }}>
            {sp.status === 'active'
              ? 'All steps are done. This client space is now ongoing.'
              : next
                ? `Next: ${next.title} · ${next.side === 'client' ? 'on the client' : 'on your team'}`
                : 'No steps yet. Add the things the client or your team must do to get started, and track them here.'}
          </small>
        )}
        {!steps.length && client && <small style={{ color: 'var(--sb)' }}>No steps for this client.</small>}
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
                    toast(x.doneAt ? 'Marked as not done' : 'Done');
                  }}
                >
                  {x.doneAt ? 'Undo' : 'Mark done'}
                </button>
              )}
              {x.kind === 'profile' && <span className={'tag' + (x.doneAt ? ' ok' : '')}>{x.doneAt ? <><Ic n="check" size={12} /> Done</> : 'When they sign in'}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** People at the client: roles, invite status, add / resend / remove. */
function PeopleTab({ live, sp, onManageTeam }: { live: LiveClients; sp: Space; onManageTeam: () => void }) {
  const { toast } = useSeek();
  const [ask, confirmDialog] = useConfirm();
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
                if (!(await ask({ title: `Remove ${personName(p)}?`, body: `They are signed out of ${sp.name} at once. Their messages stay in the record.`, confirm: 'Remove', danger: true }))) return;
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
            <input className="inp" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: '1 1 120px', fontFamily: 'inherit', fontSize: 15, color: 'var(--ink)' }} />
            <input className="inp" type="email" placeholder="name@client.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: '2 1 180px', fontFamily: 'inherit', fontSize: 15, color: 'var(--ink)' }} />
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
          <button type="button" className="btn sm" onClick={onManageTeam}>
            <Ic n="users" size={14} /> Manage team
          </button>
        </div>
        <div className="ppl">
          {sp.team.map((t) => {
            const k = (t.userId === live.me ? 'AH' : t.userId) as PersonKey;
            return (
              <div key={t.userId}>
                <Avatar k={k} size={32} presence />
                <span>
                  <b>{nameOf(k)}</b>
                  <small>
                    {t.isLead ? 'lead' : 'team'}
                    <SeenText id={k} prefix=" · " />
                  </small>
                </span>
              </div>
            );
          })}
          {!sp.team.length && <small style={{ color: 'var(--sb)' }}>Nobody on your team is on this client yet. Press Manage team to add people.</small>}
        </div>
      </div>
      {confirmDialog}
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
              <Ic n="calendar" /> Schedule a meeting
            </button>
          ) : undefined
        }
      />
      <div className="pg">
        {!list ? (
          <p className="sub">Loading…</p>
        ) : !list.length ? (
          <div className="empty">
            <b style={{ display: 'block', fontSize: 17, color: 'var(--ink)' }}>No meetings coming up</b>
            {sp ? 'Press Schedule a meeting and pick the client. The invite is posted in their Client chat with a calendar file.' : 'Add a client first, then schedule calls with them here.'}
          </div>
        ) : (
          <div className="flist">
            {list.map((m) => {
              const d = new Date(m.startsAt);
              const end = new Date(d.getTime() + m.minutes * 60e3);
              return (
                <div key={m.id} className="frow">
                  <span className="av" style={{ width: 36, height: 36, borderRadius: 9, background: m.color, fontSize: 13, flex: 'none' }}>
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
          spaces={live.spaces}
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
  // the space's calls (upcoming and past); undefined while loading
  const calls = useSpaceCalls(sp?.id ?? null);
  const nextCall = calls ? (calls.upcoming[0] ?? null) : undefined;
  const [focusAppr, setFocusAppr] = useState<number | null>(null);
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
    if (t !== 'approvals') setFocusAppr(null);
    setUI({ sideOpen: false });
  };
  /** Opens one approval (from "Waiting for you" or Project status). */
  const openApproval = (id: number) => {
    setTab('approvals');
    setFocusAppr(id);
    setUI({ sideOpen: false });
  };
  const prog = sp ? progress(sp, 'client') : { done: 0, total: 0 };
  // a simple invite has no getting-started checklist: open straight on the conversation (once; Home stays in the
  // sidebar for "Waiting for you")
  const noSteps = !!sp && live.ready && prog.total === 0;
  const landed = useRef(false);
  useEffect(() => {
    if (!sp || !live.ready || landed.current) return;
    landed.current = true;
    if (noSteps && tab === 'start') setTab('chat');
  }, [sp, live.ready, noSteps, tab]);
  const startLabel = prog.total > prog.done ? 'Getting started' : 'Home';
  const agencyMark = <OrgMark name={agency} logo={s.ws.logo} size={30} />;

  const side = (
    <Sidebar title={sp?.name ?? 'Your project'} sub={sp ? `with ${agency}${sp.project ? ' · ' + sp.project : ''}` : ''}>
      <div className="cagency">
        <OrgMark name={agency} logo={s.ws.logo} size={36} />
        <span>
          <b>{agency}</b>
          <small>Your agency on Seek</small>
        </span>
      </div>
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
          ['start', startLabel, prog.total > prog.done ? `${prog.done}/${prog.total}` : ''],
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
          {b && (
            <span className={'tag' + (k === 'approvals' ? ' hot' : '')} title={k === 'approvals' ? b + ' waiting for your approval' : undefined}>
              {b}
            </span>
          )}
        </button>
      ))}
    </Sidebar>
  );

  if (!sp) {
    return (
      <Shell active="clients" side={side} rail={<ClientRail />}>
        <MainHeader title="Your project" sub={agency} mark={agencyMark} />
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
            <>
              <WaitingBanner approvals={appr.list} me={live.me} next={nextCall} onOpenApprovals={() => open('approvals')} />
              <div className="fnote gold">
                <Ic n="clock" size={12} /> {replyLine}
              </div>
            </>
          }
          empty={
            <ConvStart mark={<OrgMark name={agency} logo={s.ws.logo} size={52} />} title={<>Say hello to the {agency} team</>}>
              Ask a question, share a file or check what’s next. {replyLine}
            </ConvStart>
          }
        />
        {canWrite ? (
          <Composer key={'c' + sp.id} placeholder={`Message the ${agency} team…`} people={[...team, ...others]} onSend={(t) => live.send(sp.id, 'client', t)} onAttach={attach} />
        ) : (
          <div className="banner">You can read this conversation. Ask the team if you need to write here.</div>
        )}
      </>
    );
  } else if (tab === 'approvals') {
    body = (
      <ApprovalsTab
        space={sp.id}
        list={appr.list}
        reload={appr.reload}
        me={live.me}
        team={false}
        approvers={[]}
        focus={focusAppr}
        onOpenMessage={(id) => {
          open('chat');
          flashMessage(toUiId(id));
        }}
      />
    );
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
        <div className="card" style={{ maxWidth: 560 }}>
          <SoundSettings />
        </div>
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
    body = <ClientStatus sp={sp} approvals={appr.list} calls={calls} onOpenSteps={() => open('start')} onOpenApproval={openApproval} />;
  } else {
    body = (
      <>
        <div className="pg" style={{ paddingBottom: 0 }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>Welcome{me?.name ? ', ' + firstName(me) : ''}</h2>
            <p style={{ margin: 0, color: 'var(--mu)' }}>
              {prog.total > prog.done ? `A few quick steps so the ${agency} team can get started. Your progress saves as you go.` : `Your project with ${agency}, all in one place.`}
            </p>
          </div>
          <WaitingForYou approvals={appr.list} me={live.me} next={nextCall} onOpenApproval={openApproval} onOpenCalls={() => open('calls')} />
        </div>
        {prog.total > 0 && <Checklist live={live} sp={sp} client />}
        <div className="pg" style={{ paddingTop: 0 }}>
          <div className="card">
            <div className="ct">
              <b>Your team at {agency}</b>
            </div>
            <div className="ppl">
              {sp.team.map((t) => (
                <div key={t.userId}>
                  <Avatar k={t.userId} size={32} presence />
                  <span>
                    <b>{nameOf(t.userId)}</b>
                    <small>
                      {t.isLead ? 'your project lead' : 'team'}
                      <SeenText id={t.userId} prefix=" · " />
                    </small>
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
        mark={agencyMark}
        title={tab === 'chat' ? 'Conversation' : tab === 'status' ? 'Project status' : tab === 'approvals' ? 'Approvals' : tab === 'files' ? 'Files' : tab === 'pins' ? 'Pinned' : tab === 'calls' ? 'Upcoming calls' : tab === 'settings' ? 'Settings' : tab === 'start' && startLabel === 'Home' ? 'Home' : sp.name}
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
      empty={lanes ? 'No files yet. Share one with the + button in Client chat (the client sees it) or Team notes (they never do).' : 'No files yet. Files you and the team share in the conversation show here.'}
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
            <span className="av" style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--v)', fontSize: 16, flex: 'none' }}>
              <Ic n="calendar" />
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
        <em>You always see updates here and under the bell too.</em>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn pri"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const err = await saveProfile({ name: name.trim(), title: title.trim(), notifyEmail: notify, onboarded: true });
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
        <span style={{ flex: 1 }}></span>
        <button type="button" className="btn ghost" onClick={() => void signOut().then(() => location.assign('/signin'))}>
          Sign out
        </button>
      </div>
    </div>
  );
}

/** "＋ New client": opens the invite pop-up where it can, otherwise goes to the invite screen. */
function NewClientButton({ className, onNew, children }: { className: string; onNew?: () => void; children: React.ReactNode }) {
  return onNew ? (
    <button type="button" className={className} onClick={onNew}>
      {children}
    </button>
  ) : (
    <Link className={className} href={ROUTES.invite}>
      {children}
    </Link>
  );
}
