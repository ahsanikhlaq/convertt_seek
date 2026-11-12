'use client';

import { useEffect, useState } from 'react';
import { PEOPLE, type Approval } from '@/lib/seek/data';
import {
  approvalDraft,
  dueLabel,
  nudgeApproval,
  requestApproval,
  rerequestApproval,
  respondApproval,
  withdrawApproval,
  workingDaysFromNow,
} from '@/lib/seek/liveApprovals';
import { useSeek } from '@/lib/seek/store';
import { Modal, PromptDialog } from './Dialogs';

export type Approver = { userId: string; name: string };

const nameFor = (id: string, me: string | null) => (id === me ? 'You' : (PEOPLE[id]?.name ?? 'Someone'));
const dayTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function StateTag({ a }: { a: Approval }) {
  if (a.status === 'approved') return <span className="tag ok">Approved</span>;
  if (a.status === 'changes') return <span className="tag red">Changes requested</span>;
  return <span className="tag gold">Waiting · {dueLabel(a.due)}</span>;
}

/** The form for asking a client approver to sign off (and for sending it again after changes). */
function RequestDialog({
  approvers,
  again,
  initial,
  onSubmit,
  onCancel,
}: {
  approvers: Approver[];
  again?: Approval;
  initial?: { title: string };
  onSubmit: (v: { title: string; items: string; approver: string; due: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(again?.title ?? initial?.title ?? '');
  const [items, setItems] = useState(again?.items ?? '');
  const [approver, setApprover] = useState(again?.approver ?? approvers[0]?.userId ?? '');
  const [due, setDue] = useState(workingDaysFromNow(3));
  const [busy, setBusy] = useState(false);
  const ok = title.trim() && approver && !busy;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    await onSubmit({ title, items, approver, due });
    setBusy(false);
  };
  return (
    <Modal
      title={again ? 'Ask again for approval' : 'Request formal approval'}
      onClose={onCancel}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn gold" disabled={!ok} onClick={() => void submit()}>
            {busy ? 'Sending…' : again ? 'Send again' : 'Send request'}
          </button>
        </>
      }
    >
      <form
        className="mb"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="fld">
          <label htmlFor="ap-t">What needs approval</label>
          <input id="ap-t" className="inp" value={title} maxLength={120} disabled={!!again} placeholder="Hero direction B" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="ap-i">Exact versions or items</label>
          <input id="ap-i" className="inp" value={items} maxLength={500} placeholder="desktop v4 + mobile v1" onChange={(e) => setItems(e.target.value)} />
          <em>Name the exact file versions, so the approval can&apos;t be mistaken later.</em>
        </div>
        {!again && (
          <div className="fld">
            <label htmlFor="ap-a">Approver</label>
            <select id="ap-a" className="inp" value={approver} onChange={(e) => setApprover(e.target.value)}>
              {approvers.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="fld">
          <label htmlFor="ap-d">Due</label>
          <input id="ap-d" className="inp" type="date" value={due} min={workingDaysFromNow(0)} onChange={(e) => setDue(e.target.value)} />
        </div>
        <small style={{ color: 'var(--sb)' }}>The approver gets a notification in Seek. Only they can approve or ask for changes.</small>
      </form>
    </Modal>
  );
}

/**
 * The Approvals tab of a client space. The team requests, nudges (once a day), sends again after changes, or
 * withdraws; the client approver sees big Approve / Request changes buttons. Everyone else reads.
 */
export function ApprovalsTab({
  space,
  list,
  reload,
  me,
  team,
  approvers,
  pendingApprovers,
}: {
  space: string;
  list: Approval[] | null;
  reload: () => void;
  me: string | null;
  team: boolean;
  /** client approvers who have joined (only they can be asked) */
  approvers: Approver[];
  /** approvers still to join, named in the empty state */
  pendingApprovers?: string[];
}) {
  const { toast } = useSeek();
  const [asking, setAsking] = useState<{ decision?: number; title?: string } | null>(null);
  const [again, setAgain] = useState<Approval | null>(null);
  const [changing, setChanging] = useState<Approval | null>(null);

  // "Request formal approval" on a Client chat decision opens the form here
  useEffect(() => {
    const d = approvalDraft.current;
    if (team && d && d.space === space) {
      approvalDraft.current = null;
      setAsking({ decision: d.decision, title: d.title });
    }
  }, [team, space]);

  const done = (err: string | null, ok: string) => {
    toast(err ?? ok);
    if (!err) reload();
    return !err;
  };

  const ask = () => {
    if (!approvers.length) {
      toast(pendingApprovers?.length ? `${pendingApprovers.join(', ')} must join before they can approve` : 'Add a client approver in People first');
      return;
    }
    setAsking({});
  };

  return (
    <div className="pg">
      {team && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <p style={{ margin: 0, color: 'var(--mu)', flex: 1, minWidth: 220 }}>Formal sign-off on exact versions. A “yes” in Client chat is a decision, not an approval.</p>
          <button type="button" className="btn gold" onClick={ask}>
            ＋ Request approval
          </button>
        </div>
      )}
      {!list ? (
        <p className="sub">Loading…</p>
      ) : !list.length ? (
        <div className="empty">
          <b style={{ display: 'block', fontSize: 16, color: 'var(--ink)' }}>No approvals yet</b>
          {team
            ? approvers.length
              ? 'Ask ' + approvers.map((a) => a.name.split(' ')[0]).join(' or ') + ' to sign off a deliverable. Their answer is logged as a decision.'
              : 'Approvals need a client approver. Set someone’s role to Approver in People.'
            : 'When the team needs your sign-off, it shows here.'}
        </div>
      ) : (
        list.map((a) => {
          const mine = a.approver === me && a.status === 'requested';
          const nudgedToday = !!a.nudgedAt && Date.now() - new Date(a.nudgedAt).getTime() < 864e5;
          return (
            <div key={a.id} className={'appr' + (a.status === 'approved' ? ' done' : '')}>
              <div className="k">
                <b>{a.title}</b>
                <StateTag a={a} />
              </div>
              {a.items && <div>{a.items}</div>}
              <small>
                Approver: {nameFor(a.approver, me)} · asked by {nameFor(a.requestedBy, me)} on {dayTime(a.requestedAt)}
              </small>
              {a.status === 'approved' && a.respondedAt && (
                <small style={{ color: 'var(--ok)', fontWeight: 600 }}>
                  ✓ Approved by {nameFor(a.approver, me)} · {dayTime(a.respondedAt)} · logged as a decision
                </small>
              )}
              {a.status === 'changes' && (
                <div className="note">
                  <b>{nameFor(a.approver, me)} asked for changes{a.respondedAt ? ' · ' + dayTime(a.respondedAt) : ''}</b>
                  <div>{a.note}</div>
                </div>
              )}
              {mine && (
                <div className="a">
                  <button
                    type="button"
                    className="btn gold big"
                    onClick={async () => {
                      if (!confirm(`Approve “${a.title}${a.items ? ' · ' + a.items : ''}”? Your name and the time are recorded.`)) return;
                      done(await respondApproval(a.id, true), 'Approved · the team has been told');
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button type="button" className="btn big" onClick={() => setChanging(a)}>
                    Request changes
                  </button>
                </div>
              )}
              {team && a.status !== 'approved' && (
                <div className="a">
                  {a.status === 'requested' && (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={nudgedToday}
                      title={nudgedToday ? 'You can nudge once a day' : undefined}
                      onClick={async () => done(await nudgeApproval(a.id), 'Reminder sent to ' + nameFor(a.approver, me))}
                    >
                      {nudgedToday ? 'Nudged today' : 'Nudge ' + nameFor(a.approver, me).split(' ')[0]}
                    </button>
                  )}
                  {a.status === 'changes' && (
                    <button type="button" className="btn sm gold" onClick={() => setAgain(a)}>
                      Send again
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={async () => {
                      if (!confirm(`Withdraw the approval request “${a.title}”?`)) return;
                      done(await withdrawApproval(a.id), 'Request withdrawn');
                    }}
                  >
                    Withdraw
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
      {asking && (
        <RequestDialog
          approvers={approvers}
          initial={asking.title ? { title: asking.title } : undefined}
          onCancel={() => setAsking(null)}
          onSubmit={async (v) => {
            const err = await requestApproval(space, { ...v, decision: asking.decision ?? null });
            if (done(err, 'Approval requested from ' + (approvers.find((x) => x.userId === v.approver)?.name ?? 'the client'))) setAsking(null);
          }}
        />
      )}
      {again && (
        <RequestDialog
          approvers={approvers}
          again={again}
          onCancel={() => setAgain(null)}
          onSubmit={async (v) => {
            if (done(await rerequestApproval(again.id, v.items, v.due), 'Sent again to ' + nameFor(again.approver, me))) setAgain(null);
          }}
        />
      )}
      {changing && (
        <PromptDialog
          title="Request changes"
          label="What should change?"
          confirm="Send to the team"
          multiline
          onCancel={() => setChanging(null)}
          onSubmit={async (note) => {
            const a = changing;
            setChanging(null);
            done(await respondApproval(a.id, false, note), 'Sent · the team will update it');
          }}
        />
      )}
    </div>
  );
}
