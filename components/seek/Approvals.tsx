'use client';

import { useEffect, useState } from 'react';
import { PEOPLE, type Approval, type ApprovalRef } from '@/lib/seek/data';
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
import { laneKey } from '@/lib/seek/liveClients';
import { toDbId } from '@/lib/seek/live';
import { sizeLabel, spaceFiles, type SharedFile } from '@/lib/seek/liveFiles';
import { Modal, PromptDialog, useConfirm } from './Dialogs';
import { useOpenFile } from './Files';
import { Ic } from './icons';

export type Approver = { userId: string; name: string };

const nameFor = (id: string, me: string | null) => (id === me ? 'You' : (PEOPLE[id]?.name ?? 'Someone'));
const dayTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function StateTag({ a }: { a: Approval }) {
  if (a.status === 'approved') return <span className="tag ok">Approved</span>;
  if (a.status === 'changes') return <span className="tag red">Changes requested</span>;
  return <span className="tag gold">Waiting · {dueLabel(a.due)}</span>;
}

type Attach = 'none' | 'file' | 'message' | 'link';
const short = (t: string, n = 90) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
const HTTPS = /^https:\/\/\S+$/i;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** What the approval is about: a file or message from Client chat, or a link. Everyone in the space can open it. */
function AttachPicker({ space, value, onChange }: { space: string; value: ApprovalRef | null; onChange: (r: ApprovalRef | null) => void }) {
  const { s } = useSeek();
  const [kind, setKind] = useState<Attach>(value?.kind ?? 'none');
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [url, setUrl] = useState(value?.kind === 'link' ? value.url : '');
  const [label, setLabel] = useState(value?.kind === 'link' ? (value.label ?? '') : '');
  useEffect(() => {
    if (kind !== 'file' || files) return;
    // only Client chat files: the client must be able to open what they approve
    void spaceFiles(space).then((f) => setFiles((f ?? []).filter((x) => x.lane === 'client')));
  }, [kind, files, space]);
  // the latest messages in Client chat (newest first)
  const msgs = (s.lc?.[laneKey(space, 'client')] ?? [])
    .filter((m): m is Extract<typeof m, { kind: 'msg' }> => m.kind === 'msg' && toDbId(m.id) != null && !!m.text.trim() && !m.card)
    .slice(-30)
    .reverse();
  const pick = (k: Attach) => {
    setKind(k);
    onChange(k === 'link' && HTTPS.test(url.trim()) ? { kind: 'link', url: url.trim(), label: label.trim() } : null);
  };
  return (
    <div className="fld">
      <label>
        Attach what&apos;s being approved <span style={{ color: 'var(--sb)', fontWeight: 400 }}>(optional)</span>
      </label>
      <div className="chips" role="radiogroup" aria-label="Attach">
        {(
          [
            ['none', 'Nothing'],
            ['file', 'A file'],
            ['message', 'A message'],
            ['link', 'A link'],
          ] as [Attach, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => pick(k)}>
            {l}
          </button>
        ))}
      </div>
      {kind === 'file' &&
        (!files ? (
          <em>Loading files…</em>
        ) : !files.length ? (
          <em>No files in Client chat yet. Share the file there first (the client must be able to open it), then attach it here.</em>
        ) : (
          <select
            className="inp"
            aria-label="File"
            value={value?.kind === 'file' ? value.path : ''}
            onChange={(e) => {
              const f = files.find((x) => x.path === e.target.value);
              onChange(f ? { kind: 'file', path: f.path, name: f.name, size: f.size, type: f.type } : null);
            }}
          >
            <option value="">Pick a file from Client chat</option>
            {files.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name} · {sizeLabel(f.size)} · {new Date(f.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        ))}
      {kind === 'message' &&
        (!msgs.length ? (
          <em>No messages in Client chat to attach yet.</em>
        ) : (
          <select
            className="inp"
            aria-label="Message"
            value={value?.kind === 'message' ? String(value.id) : ''}
            onChange={(e) => {
              const m = msgs.find((x) => String(toDbId(x.id)) === e.target.value);
              onChange(m ? { kind: 'message', id: toDbId(m.id)!, text: m.text.slice(0, 200) } : null);
            }}
          >
            <option value="">Pick a message from Client chat</option>
            {msgs.map((m) => (
              <option key={m.id} value={String(toDbId(m.id))}>
                {(PEOPLE[m.who]?.name ?? 'Someone').split(' ')[0]} · {m.time}: {short(m.text.replace(/\s+/g, ' '), 70)}
              </option>
            ))}
          </select>
        ))}
      {kind === 'link' && (
        <div className="copyrow" style={{ flexWrap: 'wrap' }}>
          <input
            className="inp"
            type="url"
            aria-label="Link"
            placeholder="https://figma.com/…"
            value={url}
            maxLength={500}
            style={{ flex: '2 1 220px' }}
            onChange={(e) => {
              setUrl(e.target.value);
              const v = e.target.value.trim();
              onChange(HTTPS.test(v) ? { kind: 'link', url: v, label: label.trim() } : null);
            }}
          />
          <input
            className="inp"
            aria-label="Link name (optional)"
            placeholder="Name (optional)"
            value={label}
            maxLength={120}
            style={{ flex: '1 1 140px' }}
            onChange={(e) => {
              setLabel(e.target.value);
              if (value?.kind === 'link') onChange({ ...value, label: e.target.value.trim() });
            }}
          />
          {url.trim() && !HTTPS.test(url.trim()) && <em style={{ flexBasis: '100%' }}>Links must start with https://</em>}
        </div>
      )}
    </div>
  );
}

/** The attached file, message or link on an approval card, with Open. */
function RefPreview({ r, onOpenMessage }: { r: ApprovalRef; onOpenMessage?: (dbId: number) => void }) {
  const openFile = useOpenFile();
  return (
    <div className="aref">
      <span className="aref-i" aria-hidden="true">
        <Ic n={r.kind === 'link' ? 'link' : r.kind === 'file' ? 'download' : 'message'} size={15} />
      </span>
      <span className="x">
        {r.kind === 'file' && (
          <>
            <b>{r.name}</b>
            <small>File in Client chat{r.size ? ' · ' + sizeLabel(r.size) : ''}</small>
          </>
        )}
        {r.kind === 'message' && (
          <>
            <b>“{short(r.text.replace(/\s+/g, ' '), 140)}”</b>
            <small>Message in Client chat</small>
          </>
        )}
        {r.kind === 'link' && (
          <>
            <b>{r.label || hostOf(r.url)}</b>
            <small>{hostOf(r.url)}</small>
          </>
        )}
      </span>
      {r.kind === 'file' && (
        <button type="button" className="btn sm" onClick={() => void openFile({ path: r.path, name: r.name, size: r.size, type: r.type })} aria-label={'Open ' + r.name}>
          Open
        </button>
      )}
      {r.kind === 'message' && onOpenMessage && (
        <button type="button" className="btn sm" onClick={() => onOpenMessage(r.id)} aria-label="Open the message in Client chat">
          Open
        </button>
      )}
      {r.kind === 'link' && (
        <a className="btn sm" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={'Open ' + (r.label || hostOf(r.url)) + ' (new tab)'}>
          Open
        </a>
      )}
    </div>
  );
}

/** The form for asking a client approver to sign off (and for sending it again after changes). */
function RequestDialog({
  space,
  approvers,
  again,
  initial,
  onSubmit,
  onCancel,
}: {
  space: string;
  approvers: Approver[];
  again?: Approval;
  initial?: { title: string };
  onSubmit: (v: { title: string; items: string; approver: string; due: string; ref: ApprovalRef | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(again?.title ?? initial?.title ?? '');
  const [items, setItems] = useState(again?.items ?? '');
  const [approver, setApprover] = useState(again?.approver ?? approvers[0]?.userId ?? '');
  const [due, setDue] = useState(workingDaysFromNow(3));
  const [ref, setRef] = useState<ApprovalRef | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = title.trim() && approver && !busy;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    await onSubmit({ title, items, approver, due, ref });
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
        {!again && <AttachPicker space={space} value={ref} onChange={setRef} />}
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
  focus,
  onOpenMessage,
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
  /** an approval to scroll to and highlight (opened from "Waiting for you") */
  focus?: number | null;
  /** opens a message attached to an approval in Client chat (database id) */
  onOpenMessage?: (dbId: number) => void;
}) {
  const { toast } = useSeek();
  const [confirmAsk, confirmDialog] = useConfirm();
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

  // opened from "Waiting for you": bring that approval into view
  const loaded = !!list;
  useEffect(() => {
    if (!focus || !loaded) return;
    const id = setTimeout(() => document.getElementById('appr-' + focus)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    return () => clearTimeout(id);
  }, [focus, loaded]);

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
            <Ic n="plus" size={14} /> Request approval
          </button>
        </div>
      )}
      {!list ? (
        <p className="sub">Loading…</p>
      ) : !list.length ? (
        <div className="empty">
          <b style={{ display: 'block', fontSize: 17, color: 'var(--ink)' }}>No approvals yet</b>
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
            <div key={a.id} id={'appr-' + a.id} className={'appr' + (a.status === 'approved' ? ' done' : '') + (a.id === focus ? ' focus' : '')}>
              <div className="k">
                <b>{a.title}</b>
                <StateTag a={a} />
              </div>
              {a.items && <div>{a.items}</div>}
              {a.ref && <RefPreview r={a.ref} onOpenMessage={onOpenMessage} />}
              <small>
                Approver: {nameFor(a.approver, me)} · asked by {nameFor(a.requestedBy, me)} on {dayTime(a.requestedAt)}
              </small>
              {a.status === 'approved' && a.respondedAt && (
                <small style={{ color: 'var(--ok)', fontWeight: 600 }}>
                  <Ic n="check" size={14} /> Approved by {nameFor(a.approver, me)} · {dayTime(a.respondedAt)} · logged as a decision
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
                      if (!(await confirmAsk({ title: `Approve “${a.title}”?`, body: (a.items ? a.items + '. ' : '') + 'Your name and the time are recorded, and it is logged as a decision.', confirm: 'Approve' }))) return;
                      done(await respondApproval(a.id, true), 'Approved · the team has been told');
                    }}
                  >
                    <Ic n="check" /> Approve
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
                      if (!(await confirmAsk({ title: 'Withdraw this request?', body: `“${a.title}” is removed and ${nameFor(a.approver, me)} can no longer approve it.`, confirm: 'Withdraw', danger: true }))) return;
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
          space={space}
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
          space={space}
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
      {confirmDialog}
    </div>
  );
}
