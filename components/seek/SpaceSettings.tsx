'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PEOPLE } from '@/lib/seek/data';
import { learnProfiles } from '@/lib/seek/live';
import { AGENTS, type AgentKey } from '@/lib/seek/liveAgents';
import type { LiveClients, Space, Step } from '@/lib/seek/liveClients';
import { workspaceMembers } from '@/lib/seek/liveSync';
import { addStep, addTeammate, archiveSpace, canManageSpaceAgents, deleteStep, removeTeammate, reorderSteps, saveSpace, setLead, setSpaceAgent, syncStatus, updateStep } from '@/lib/seek/liveSpaces';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { Modal, useConfirm } from './Dialogs';
import { useSpaceAgents } from './SpaceTools';
import { Avatar, Switch } from './ui';
import { Ic } from './icons';

/**
 * Space settings (team only): rename the client, its project and reply target; who on your team works on it and who
 * leads; the onboarding checklist (add, edit, remove, reorder); archiving the space when the work is over; and the AI
 * agents that work on this client (the Away assistant in Client chat is turned on here, per client).
 */

export type SpaceSettingsTab = 'General' | 'Team' | 'Checklist' | 'AI agents';
const TABS: SpaceSettingsTab[] = ['General', 'Team', 'Checklist', 'AI agents'];
const REPLY = ['A few hours', 'Same working day', '1 working day', '2 working days', '3 working days'];

export function SpaceSettings({ live, sp, tab: first = 'General', onClose, onArchived }: { live: LiveClients; sp: Space; tab?: SpaceSettingsTab; onClose: () => void; onArchived: () => void }) {
  const [tab, setTab] = useState<SpaceSettingsTab>(first);
  const [ask, confirmDialog] = useConfirm();
  return (
    <Modal
      title={
        <span className="joinorg">
          <span className="av" style={{ width: 28, height: 28, borderRadius: 8, background: sp.color, fontSize: 12 }}>
            {sp.code}
          </span>
          Space settings · {sp.name}
        </span>
      }
      onClose={onClose}
      width={580}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="tabs" role="tablist" style={{ padding: '0 16px' }}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={'tb' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
            {t}
            {t === 'Team' && <span className="badge" style={{ background: 'var(--sb)' }}>{sp.team.length}</span>}
            {t === 'Checklist' && sp.steps.length > 0 && <span className="badge" style={{ background: 'var(--sb)' }}>{sp.steps.length}</span>}
          </button>
        ))}
      </div>
      <div className="mb" style={{ minHeight: 300 }}>
        {tab === 'General' ? (
          <GeneralTab live={live} sp={sp} ask={ask} onArchived={onArchived} />
        ) : tab === 'Team' ? (
          <TeamTab live={live} sp={sp} ask={ask} />
        ) : tab === 'AI agents' ? (
          <AgentsTab live={live} sp={sp} />
        ) : (
          <ChecklistTab live={live} sp={sp} ask={ask} />
        )}
      </div>
      {confirmDialog}
    </Modal>
  );
}

type Ask = ReturnType<typeof useConfirm>[0];

function GeneralTab({ live, sp, ask, onArchived }: { live: LiveClients; sp: Space; ask: Ask; onArchived: () => void }) {
  const { toast } = useSeek();
  const [name, setName] = useState(sp.name);
  const [project, setProject] = useState(sp.project);
  const [reply, setReply] = useState(sp.replyTarget);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== sp.name || project.trim() !== sp.project || reply !== sp.replyTarget;
  const save = async () => {
    if (!name.trim() || !changed || busy) return;
    setBusy(true);
    const err = await saveSpace(sp.id, { name, project, replyTarget: reply });
    setBusy(false);
    toast(err ?? 'Saved');
    if (!err) await live.reload();
  };
  const archive = async () => {
    const ok = await ask({
      title: `Archive ${sp.name}?`,
      body: `It leaves Clients for your team, and ${sp.people.length ? 'the client can no longer open it' : 'nobody can open it'}. Messages, files and decisions are kept.`,
      confirm: 'Archive',
      danger: true,
    });
    if (!ok) return;
    const err = await archiveSpace(sp.id);
    toast(err ?? sp.name + ' archived');
    if (!err) {
      // close first: the space leaves the list when it reloads
      onArchived();
      void live.reload();
    }
  };
  return (
    <form
      style={{ display: 'contents' }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="fld">
        <label htmlFor="ss-n">Client name</label>
        <input id="ss-n" className="inp" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        {!name.trim() && <em style={{ color: 'var(--red)' }}>The space needs a name.</em>}
      </div>
      <div className="fld">
        <label htmlFor="ss-p">
          Project <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input id="ss-p" className="inp" value={project} maxLength={80} placeholder="Website relaunch" onChange={(e) => setProject(e.target.value)} />
      </div>
      <div className="fld">
        <label htmlFor="ss-r">Reply target</label>
        <select id="ss-r" className="inp" value={reply} onChange={(e) => setReply(e.target.value)}>
          {[...new Set([...REPLY, sp.replyTarget])].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <em>How quickly your team aims to reply in Client chat. The client sees it, and the reply timer counts working hours against it.</em>
      </div>
      <div>
        <button type="submit" className="btn pri" disabled={!name.trim() || !changed || busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      <div className="card" style={{ marginTop: 6, borderColor: 'var(--reds)' }}>
        <div className="ct">
          <b>Archive this client</b>
        </div>
        <small style={{ color: 'var(--mu)' }}>When the work is over. The space leaves Clients and the client can no longer sign in to it. Nothing is deleted.</small>
        <div>
          <button type="button" className="btn danger sm" onClick={() => void archive()}>
            Archive {sp.name}
          </button>
        </div>
      </div>
    </form>
  );
}

function TeamTab({ live, sp, ask }: { live: LiveClients; sp: Space; ask: Ask }) {
  const { toast } = useSeek();
  const [mates, setMates] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  // everyone on your team in this workspace (not client guests)
  useEffect(() => {
    if (!live.orgId) return;
    let alive = true;
    void workspaceMembers(live.orgId)
      .catch(() => [])
      .then(async (m) => {
        const ids = m.filter((x) => x.role !== 'guest').map((x) => x.user_id);
        await learnProfiles(ids, live.me);
        if (alive) setMates(ids);
      });
    return () => {
      alive = false;
    };
  }, [live.orgId, live.me]);
  const nameOf = (id: string) => (id === live.me ? 'You' : (PEOPLE[id]?.name ?? 'Teammate'));
  const onTeam = new Set(sp.team.map((t) => t.userId));
  const addable = (mates ?? []).filter((id) => !onTeam.has(id));
  const run = async (p: Promise<string | null>, ok: string) => {
    setBusy(true);
    const err = await p;
    setBusy(false);
    toast(err ?? ok);
    if (!err) await live.reload();
  };
  return (
    <>
      <small style={{ color: 'var(--mu)' }}>Your team on this client gets its notifications. The lead is shown to the client first.</small>
      <div className="ppl">
        {sp.team.map((t) => {
          const k = t.userId === live.me ? 'AH' : t.userId;
          return (
            <div key={t.userId} style={{ alignItems: 'center' }}>
              <Avatar k={k} size={32} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{nameOf(t.userId)}</b>
                <small>{t.isLead ? 'Lead · shown to the client first' : 'Team'}</small>
              </span>
              {!t.isLead && (
                <button type="button" className="btn sm" disabled={busy} onClick={() => void run(setLead(sp.id, t.userId), nameOf(t.userId) + (t.userId === live.me ? ' are' : ' is') + ' now the lead')}>
                  Make lead
                </button>
              )}
              {sp.team.length > 1 && (
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={busy}
                  aria-label={'Remove ' + nameOf(t.userId) + ' from this client'}
                  onClick={async () => {
                    const you = t.userId === live.me;
                    if (!(await ask({ title: you ? 'Leave this client?' : `Remove ${nameOf(t.userId)}?`, body: you ? `You stop getting ${sp.name}’s notifications. You can still open the space.` : `They stop getting ${sp.name}’s notifications. They can still open the space.`, confirm: you ? 'Leave' : 'Remove', danger: true })))
                      return;
                    await run(removeTeammate(sp.id, t.userId), you ? 'You left ' + sp.name : nameOf(t.userId) + ' removed');
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
        {!sp.team.length && <small style={{ color: 'var(--sb)' }}>Nobody on your team is on this client yet.</small>}
      </div>
      <form
        className="fld"
        onSubmit={(e) => {
          e.preventDefault();
          if (pick) void run(addTeammate(sp.id, pick), nameOf(pick) + ' added').then(() => setPick(''));
        }}
      >
        <label htmlFor="ss-add">Add a teammate</label>
        {!mates ? (
          <em>Loading your team…</em>
        ) : addable.length ? (
          <div className="copyrow">
            <select id="ss-add" className="inp" value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1 }}>
              <option value="">Pick someone</option>
              {addable.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn pri" disabled={!pick || busy}>
              Add
            </button>
          </div>
        ) : (
          <em>Everyone on your team is already on this client. Invite more people to the workspace from People.</em>
        )}
      </form>
    </>
  );
}

/** The workspace-level agents that also work on each client (turned on/off and taught in Apps → AI agents). */
const WORKSPACE_AGENTS: { key: AgentKey; name: string; line: string }[] = [
  { key: 'scope_guard', name: 'Scope guard', line: 'Checks the client’s requests against the agreed scope (Scope & hours) and warns your team in Team notes. Never writes to the client.' },
  { key: 'status_drafter', name: 'Status drafter', line: 'Drafts the weekly update from Client chat for you to edit and send yourself. Nothing is posted on its own.' },
  { key: 'retainer_watch', name: 'Retainer watch', line: 'Warns in Team notes when logged time reaches 80% and 100% of the monthly retainer.' },
  { key: 'summariser', name: 'Summariser', line: 'Catch up on Client chat or Team notes with a short summary, only for you.' },
];

function AgentsTab({ live, sp }: { live: LiveClients; sp: Space }) {
  const { toast } = useSeek();
  const { agents, settings, paused } = useSpaceAgents(sp.id, live.orgId);
  const [can, setCan] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void canManageSpaceAgents(sp.id).then((v) => {
      if (alive) setCan(v);
    });
    return () => {
      alive = false;
    };
  }, [sp.id]);
  const saved = !!agents?.includes('away_assistant');
  // the switch moves at once; the saved value takes over again once the change arrives (or the save fails)
  const [want, setWant] = useState<boolean | null>(null);
  useEffect(() => {
    if (want !== null && saved === want) setWant(null);
  }, [saved, want]);
  const away = want ?? saved;
  const awayWs = settings?.get('away_assistant');
  const isOn = (k: AgentKey) => settings?.get(k)?.enabled ?? AGENTS.find((a) => a.key === k)?.on ?? false;
  const lead = sp.team.find((t) => t.isLead);
  const toggle = async () => {
    if (busy || !can || agents == null) return;
    const next = !away;
    setWant(next);
    setBusy(true);
    const err = await setSpaceAgent(sp.id, 'away_assistant', next, live.me);
    setBusy(false);
    if (err) setWant(null);
    toast(err ?? (next ? 'Away assistant turned on for ' + sp.name : 'Away assistant turned off for ' + sp.name));
  };
  return (
    <>
      <small style={{ color: 'var(--mu)' }}>AI that works on this client. Every action is in the agent log (Apps → AI agents).</small>
      {paused && (
        <div className="banner gold" style={{ margin: 0 }}>
          <Ic n="pause" /> <span>All AI is paused for this workspace, so none of these run until an admin resumes it in Apps → AI agents.</span>
        </div>
      )}
      <div className="spag">
        <div className="spag-row main">
          <Avatar k="AI" size={32} />
          <span className="x">
            <b>Away assistant in Client chat</b>
            <small>Replies to your client only when nobody on the team is available; it never makes promises. It says your team will reply, and answers only from what you teach it.</small>
            {away && awayWs && !awayWs.enabled && <small className="spag-warn">On for this client, but turned off for the whole workspace in Apps → AI agents, so it won’t reply.</small>}
            {can === false && <small className="spag-note">Only workspace admins and the lead on this client{lead ? ' (' + (lead.userId === live.me ? 'you' : (PEOPLE[lead.userId]?.name ?? 'the lead')) + ')' : ''} can turn it on or off.</small>}
          </span>
          <Switch on={away} disabled={busy || !can || agents == null} label={away ? 'Turn the Away assistant off for this client' : 'Turn the Away assistant on for this client'} onClick={() => void toggle()} />
        </div>
        <div className="spag-lbl">For every client (workspace settings)</div>
        {WORKSPACE_AGENTS.map((a) => (
          <div key={a.key} className="spag-row">
            <span className="spag-ic" aria-hidden="true">
              <Ic n="ai" size={16} />
            </span>
            <span className="x">
              <b>{a.name}</b>
              <small>{a.line}</small>
            </span>
            <span className={'tag' + (settings && isOn(a.key) && !paused ? ' ai' : '')}>{!settings ? '…' : paused ? 'Paused' : isOn(a.key) ? 'On' : 'Off'}</span>
          </div>
        ))}
      </div>
      <small style={{ color: 'var(--mu)' }}>
        Teach the Away assistant what to say, or turn agents on and off for every client, in{' '}
        <Link href={ROUTES.agents} className="linkbtn">
          Apps → AI agents
        </Link>
        .
      </small>
    </>
  );
}

function ChecklistTab({ live, sp, ask }: { live: LiveClients; sp: Space; ask: Ask }) {
  const { toast } = useSeek();
  const [title, setTitle] = useState('');
  const [side, setSide] = useState<'client' | 'team'>('client');
  const [busy, setBusy] = useState(false);
  const steps = sp.steps;
  const after = async (err: string | null, ok: string, next?: Pick<Step, 'doneAt'>[]) => {
    toast(err ?? ok);
    if (err) return false;
    if (next) await syncStatus(sp, next);
    await live.reload();
    return true;
  };
  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    const pos = steps.length ? Math.max(...steps.map((x) => x.position)) + 1 : 0;
    const err = await addStep(sp.id, { title, side, position: pos });
    if (await after(err, 'Step added', [...steps, { doneAt: null }])) setTitle('');
    setBusy(false);
  };
  const move = async (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= steps.length || busy) return;
    const ids = steps.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setBusy(true);
    await after(await reorderSteps(ids), 'Order saved');
    setBusy(false);
  };
  return (
    <>
      <small style={{ color: 'var(--mu)' }}>
        Client steps show in the client&apos;s Getting started; team steps only show to you. When every step is done, the space moves from onboarding to ongoing.
      </small>
      {steps.length ? (
        <ol className="stepedit">
          {steps.map((x, i) => (
            <StepRow
              key={x.id + x.title + x.side}
              x={x}
              i={i}
              count={steps.length}
              busy={busy}
              onMove={(by) => void move(i, by)}
              onSave={async (p) => {
                setBusy(true);
                await after(await updateStep(x.id, p), 'Step saved');
                setBusy(false);
              }}
              onDelete={async () => {
                if (!(await ask({ title: 'Remove this step?', body: `“${x.title}” is removed from the checklist${x.side === 'client' ? ', for the client too' : ''}.`, confirm: 'Remove', danger: true }))) return;
                setBusy(true);
                await after(await deleteStep(x.id), 'Step removed', steps.filter((y) => y.id !== x.id));
                setBusy(false);
              }}
            />
          ))}
        </ol>
      ) : (
        <div className="empty" style={{ padding: 16 }}>
          No steps yet. Add the things the client (or your team) needs to do to get started, like “Share brand assets” or “Book the kickoff call”.
        </div>
      )}
      <form
        className="fld"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor="ss-step">Add a step</label>
        <div className="copyrow" style={{ flexWrap: 'wrap' }}>
          <input id="ss-step" className="inp" value={title} maxLength={120} placeholder="Share your brand assets" onChange={(e) => setTitle(e.target.value)} style={{ flex: '2 1 220px' }} />
          <select className="inp" aria-label="Who does it" value={side} onChange={(e) => setSide(e.target.value as 'client' | 'team')} style={{ width: 'auto' }}>
            <option value="client">Client does it</option>
            <option value="team">Your team does it</option>
          </select>
          <button type="submit" className="btn pri" disabled={!title.trim() || busy}>
            <Ic n="plus" size={14} /> Add
          </button>
        </div>
      </form>
    </>
  );
}

function StepRow({
  x,
  i,
  count,
  busy,
  onMove,
  onSave,
  onDelete,
}: {
  x: Step;
  i: number;
  count: number;
  busy: boolean;
  onMove: (by: -1 | 1) => void;
  onSave: (p: { title?: string; side?: 'client' | 'team' }) => Promise<void>;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(x.title);
  const dirty = title.trim() !== x.title;
  return (
    <li>
      <span className="n" aria-hidden="true">
        {i + 1}
      </span>
      <input
        className="inp"
        aria-label={`Step ${i + 1}`}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (dirty && title.trim()) void onSave({ title });
          }
        }}
      />
      <select className="inp" aria-label={`Who does step ${i + 1}`} value={x.side} disabled={busy} onChange={(e) => void onSave({ side: e.target.value as 'client' | 'team' })}>
        <option value="client">Client</option>
        <option value="team">Team</option>
      </select>
      {dirty ? (
        <button type="button" className="btn sm pri" disabled={busy || !title.trim()} onClick={() => void onSave({ title })}>
          Save
        </button>
      ) : (
        <span className="acts">
          <button type="button" className="btn sm ghost" disabled={busy || i === 0} aria-label={`Move step ${i + 1} up`} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="btn sm ghost" disabled={busy || i === count - 1} aria-label={`Move step ${i + 1} down`} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="btn sm ghost" disabled={busy} aria-label={`Remove step ${i + 1}`} onClick={onDelete}>
            <Ic n="trash" size={14} />
          </button>
        </span>
      )}
      {x.doneAt && <span className="tag ok">done</span>}
    </li>
  );
}
