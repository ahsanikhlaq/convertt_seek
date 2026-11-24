'use client';

import { useEffect, useState } from 'react';
import { PEOPLE, type Approval } from '@/lib/seek/data';
import { dueLabel } from '@/lib/seek/liveApprovals';
import { laneKey, type Space } from '@/lib/seek/liveClients';
import { clientDecisions, type SpaceDecision } from '@/lib/seek/liveDecisions';
import { localWhen, spaceMeetings, toolName, type SpaceMeeting } from '@/lib/seek/liveMeetings';
import { useSeek } from '@/lib/seek/store';
import { Ic } from './icons';

/**
 * The client's own portal: "Waiting for you" (approvals that need them and the next call), a compact version of it
 * above their Client chat, and their Project status (getting-started steps, calls, decisions and approvals). All
 * of it is data the client can already read; the database decides what that is.
 */

/** The space's calls the client can see, reloaded when something new arrives in their conversation. */
export function useSpaceCalls(space: string | null) {
  const { s } = useSeek();
  const [calls, setCalls] = useState<{ upcoming: SpaceMeeting[]; past: SpaceMeeting[] } | null>(null);
  const msgs = space ? (s.lc?.[laneKey(space, 'client')]?.length ?? 0) : 0;
  useEffect(() => {
    if (!space) {
      setCalls(null);
      return;
    }
    let alive = true;
    void spaceMeetings(space).then((r) => alive && setCalls(r ?? { upcoming: [], past: [] }));
    // a call that ends while the page is open moves from upcoming to past
    const t = setInterval(() => void spaceMeetings(space).then((r) => alive && r && setCalls(r)), 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [space, msgs]);
  return calls;
}

const who = (id: string, me: string | null) => (id === me ? 'you' : (PEOPLE[id]?.name ?? 'someone at your company'));
const httpsLink = (m: SpaceMeeting) => (m.link.startsWith('https://') ? m.link : null);

/** Approvals still to answer: the ones you approve first. */
function pendingOf(list: Approval[] | null, me: string | null) {
  const open = (list ?? []).filter((a) => a.status === 'requested');
  return [...open.filter((a) => a.approver === me), ...open.filter((a) => a.approver !== me)];
}

/** "Waiting for you" at the top of the client's start page. */
export function WaitingForYou({
  approvals,
  me,
  next,
  onOpenApproval,
  onOpenCalls,
}: {
  approvals: Approval[] | null;
  me: string | null;
  next: SpaceMeeting | null | undefined;
  onOpenApproval: (id: number) => void;
  onOpenCalls: () => void;
}) {
  const open = pendingOf(approvals, me);
  const mine = open.filter((a) => a.approver === me).length;
  const loading = approvals === null || next === undefined;
  const link = next ? httpsLink(next) : null;
  return (
    <section className="card wfy" aria-labelledby="wfy-h">
      <div className="ct">
        <b id="wfy-h">Waiting for you</b>
        {mine > 0 && <span className="tag gold">{mine}</span>}
      </div>
      {open.map((a) => {
        const yours = a.approver === me;
        return (
          <div key={a.id} className="wfy-row">
            <i className="gold" aria-hidden="true">
              <Ic n="check" size={16} />
            </i>
            <span className="x">
              <b>
                {a.title}
                {a.items ? ' · ' + a.items : ''}
              </b>
              <small>
                {yours ? 'Needs your approval' : 'Waiting for ' + who(a.approver, me)} · {dueLabel(a.due)}
              </small>
            </span>
            <button type="button" className={'btn sm' + (yours ? ' gold' : '')} onClick={() => onOpenApproval(a.id)}>
              {yours ? 'Approve' : 'Review'}
            </button>
          </div>
        );
      })}
      {next && (
        <div className="wfy-row">
          <i aria-hidden="true">
            <Ic n="calendar" size={16} />
          </i>
          <span className="x">
            <b>Next call: {next.title}</b>
            <small>
              {localWhen(next.startsAt, next.minutes)} (your time) · {toolName(next.tool)}
            </small>
          </span>
          {link ? (
            <a className="btn sm pri" href={link} target="_blank" rel="noopener noreferrer">
              Join
            </a>
          ) : (
            <button type="button" className="btn sm" onClick={onOpenCalls}>
              Details
            </button>
          )}
        </div>
      )}
      {!open.length && !next && (
        <div className="wfy-done">
          <Ic n="check" size={18} />
          <span>
            <b>{loading ? 'Checking…' : 'You’re all caught up'}</b>
            {!loading && <small>Nothing needs you right now. Approvals and calls from the team show up here.</small>}
          </span>
        </div>
      )}
    </section>
  );
}

/** The compact version above the client's conversation; nothing when nothing is waiting. */
export function WaitingBanner({ approvals, me, next, onOpenApprovals }: { approvals: Approval[] | null; me: string | null; next: SpaceMeeting | null | undefined; onOpenApprovals: () => void }) {
  const mine = pendingOf(approvals, me).filter((a) => a.approver === me).length;
  const link = next ? httpsLink(next) : null;
  // only a call in the next week is worth a banner
  const soon = next && new Date(next.startsAt).getTime() - Date.now() < 7 * 864e5 ? next : null;
  if (!mine && !soon) return null;
  return (
    <div className="banner gold wfyb" role="status">
      <Ic n="bell" size={14} />
      <span>
        {mine > 0 && (
          <>
            <b>
              {mine} approval{mine === 1 ? '' : 's'}
            </b>{' '}
            waiting for you ·{' '}
            <button type="button" className="linkbtn" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={onOpenApprovals}>
              Review
            </button>
          </>
        )}
        {mine > 0 && soon && <span className="wfyb-sep"> · </span>}
        {soon && (
          <>
            Next call <b>{localWhen(soon.startsAt, soon.minutes)}</b>
            {link && (
              <>
                {' · '}
                <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', fontWeight: 600 }}>
                  Join
                </a>
              </>
            )}
          </>
        )}
      </span>
    </div>
  );
}

/** The client's Project status: their getting-started steps, calls, and recent decisions and approvals. */
export function ClientStatus({
  sp,
  approvals,
  calls,
  onOpenSteps,
  onOpenApproval,
}: {
  sp: Space;
  approvals: Approval[] | null;
  calls: { upcoming: SpaceMeeting[]; past: SpaceMeeting[] } | null;
  onOpenSteps: () => void;
  onOpenApproval: (id: number) => void;
}) {
  const { s } = useSeek();
  const steps = sp.steps.filter((x) => x.side === 'client');
  const done = steps.filter((x) => x.doneAt).length;
  const left = steps.length - done;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const next = steps.find((x) => !x.doneAt);
  const nextCall = calls?.upcoming[0] ?? null;

  // decisions logged in the conversation (approvals are logged as decisions too), reloaded when it changes
  const [decs, setDecs] = useState<SpaceDecision[] | null>(null);
  const msgs = s.lc?.[laneKey(sp.id, 'client')]?.length ?? 0;
  useEffect(() => {
    let alive = true;
    void clientDecisions(sp.id).then((r) => alive && setDecs(r ?? []));
    return () => {
      alive = false;
    };
  }, [sp.id, msgs, approvals]);

  type Item = { key: string; tag: string; tone: string; text: string; at: string; approval?: number };
  const items: Item[] = [
    ...(decs ?? []).map((d) => ({ key: 'd' + d.id, tag: d.kind === 'approval' ? 'Approved' : 'Decision', tone: d.kind === 'approval' ? 'ok' : 'v', text: d.text, at: d.at })),
    ...(approvals ?? [])
      .filter((a) => a.status === 'changes')
      .map((a) => ({ key: 'a' + a.id, tag: 'Changes asked', tone: 'gold', text: a.title + (a.note ? ': ' + a.note : ''), at: a.respondedAt ?? a.requestedAt, approval: a.id })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="pg">
      <div className="stats">
        {(
          [
            [sp.status === 'onboarding' ? 'Getting started' : 'Ongoing', 'stage'],
            [steps.length ? `${done}/${steps.length}` : '—', 'your steps done'],
            [nextCall ? localWhen(nextCall.startsAt, nextCall.minutes).split(',')[0] : '—', 'next call'],
            [sp.replyTarget, 'reply target'],
          ] as [string, string][]
        ).map(([a, b]) => (
          <div key={b} className="stat">
            <b>{a}</b>
            <span>{b}</span>
          </div>
        ))}
      </div>

      {steps.length > 0 && (
        <div className="card">
          <div className="ct">
            <b>Getting started</b>
            <span className={'tag ' + (left ? 'gold' : 'ok')}>{left ? `${left} to go` : 'All done'}</span>
          </div>
          <div className="pbar" role="progressbar" aria-label="Getting started" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i style={{ width: pct + '%' }} />
          </div>
          <small style={{ color: 'var(--mu)' }}>
            {done} of {steps.length} done{next ? ` · Next: ${next.title}` : '. Thank you!'}
          </small>
          <ul className="slist">
            {steps.map((x) => (
              <li key={x.id} className={x.doneAt ? 'done' : ''}>
                <Ic n={x.doneAt ? 'check' : 'clock'} size={14} />
                <span>{x.title}</span>
                {x.doneAt && <small>{day(x.doneAt)}</small>}
              </li>
            ))}
          </ul>
          {left > 0 && (
            <button type="button" className="btn sm gold" style={{ alignSelf: 'flex-start' }} onClick={onOpenSteps}>
              Open your steps
            </button>
          )}
        </div>
      )}

      <div className="card">
        <div className="ct">
          <b>Calls</b>
        </div>
        {!calls ? (
          <small style={{ color: 'var(--sb)' }}>Loading…</small>
        ) : (
          <>
            <div className="lbl">Coming up</div>
            {calls.upcoming.length ? (
              calls.upcoming.slice(0, 5).map((m) => (
                <div key={m.id} className="trow" style={{ alignItems: 'center' }}>
                  <div>
                    <b>{m.title}</b>
                    <small>
                      {localWhen(m.startsAt, m.minutes)} (your time) · {toolName(m.tool)}
                    </small>
                  </div>
                  {httpsLink(m) && (
                    <a className="btn sm pri" href={httpsLink(m)!} target="_blank" rel="noopener noreferrer">
                      Join
                    </a>
                  )}
                </div>
              ))
            ) : (
              <small style={{ color: 'var(--sb)' }}>No calls booked. When the team schedules one with you, it shows here.</small>
            )}
            {calls.past.length > 0 && (
              <>
                <div className="lbl" style={{ marginTop: 6 }}>
                  Earlier
                </div>
                {calls.past.map((m) => (
                  <div key={m.id} className="trow">
                    <div>
                      <b style={{ fontWeight: 500 }}>{m.title}</b>
                      <small>{new Date(m.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: new Date(m.startsAt).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}</small>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="ct">
          <b>Recent decisions and approvals</b>
        </div>
        {!decs ? (
          <small style={{ color: 'var(--sb)' }}>Loading…</small>
        ) : items.length ? (
          items.map((it) => (
            <div key={it.key} className="trow" style={{ alignItems: 'center' }}>
              <span className={'tag ' + it.tone}>{it.tag}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 500 }}>{it.text}</b>
                <small>{day(it.at)}</small>
              </div>
              {it.approval != null && (
                <button type="button" className="btn sm" onClick={() => onOpenApproval(it.approval!)}>
                  Open
                </button>
              )}
            </div>
          ))
        ) : (
          <small style={{ color: 'var(--sb)' }}>Nothing decided yet. Decisions and approvals from your conversation show up here.</small>
        )}
      </div>
    </div>
  );
}
