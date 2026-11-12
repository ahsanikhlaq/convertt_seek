'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { orgPeople, type OrgPerson } from '@/lib/seek/backend';
import { PEOPLE, type LiveTask } from '@/lib/seek/data';
import {
  channelPins,
  createTask,
  deleteTask,
  loadCanvas,
  openConversation,
  pinMessage,
  refreshTasks,
  reminderChoices,
  remindMe,
  saveCanvas,
  savedItems,
  saveMessage,
  setTaskDone,
  type Canvas,
  type PinnedMessage,
  type SavedItem,
} from '@/lib/seek/liveExtras';
import { toUiId } from '@/lib/seek/live';
import { flashMessage } from '@/lib/seek/liveDecisions';
import { workingDaysFromNow } from '@/lib/seek/liveApprovals';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { FileCards } from './Files';
import { Avatar, RichText } from './ui';

const nameFor = (id: string, me: string | null) => (id === me ? 'You' : (PEOPLE[id]?.name ?? 'Someone'));
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
export const dueText = (due: string | null) => {
  if (!due) return 'no due date';
  const d = new Date(due + 'T12:00:00');
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  const days = Math.round((d.getTime() - t.getTime()) / 864e5);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return 'due ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

/** Make task: title (from the message), owner and due date. */
export function TaskDialog({ initial, sourceUiId, me, onClose }: { initial: string; sourceUiId: number | null; me: string | null; onClose: () => void }) {
  const { s, update, toast } = useSeek();
  const [title, setTitle] = useState(initial.slice(0, 200));
  const [people, setPeople] = useState<OrgPerson[] | null>(null);
  const [owner, setOwner] = useState(me ?? '');
  const [due, setDue] = useState(workingDaysFromNow(1));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.orgId) void orgPeople(s.orgId).then(setPeople);
  }, [s.orgId]);
  const submit = async () => {
    if (!title.trim() || !owner || !s.orgId || busy) return;
    setBusy(true);
    const err = await createTask({ ws: s.orgId, title, owner, due: due || null, sourceUiId });
    setBusy(false);
    if (err) {
      toast(err);
      return;
    }
    void refreshTasks(update, s.orgId);
    toast(owner === me ? 'Task created' : 'Task created and assigned to ' + (people?.find((p) => p.userId === owner)?.name || 'them'));
    onClose();
  };
  return (
    <Modal
      title="Make task"
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" disabled={!title.trim() || !owner || busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create task'}
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
          <label htmlFor="tk-t">Task</label>
          <textarea id="tk-t" className="inp" rows={2} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="tk-o">Owner</label>
          <select id="tk-o" className="inp" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {!people && <option value={owner}>Loading…</option>}
            {people?.map((p) => (
              <option key={p.userId} value={p.userId}>
                {(p.name.trim() || p.email.split('@')[0]) + (p.userId === me ? ' (you)' : '')}
              </option>
            ))}
          </select>
        </div>
        <div className="fld">
          <label htmlFor="tk-d">Due</label>
          <input id="tk-d" className="inp" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}

/** Remind me: a few quick choices or any time. */
export function RemindDialog({ target, onClose }: { target: { uiId?: number; task?: number }; onClose: () => void }) {
  const { toast } = useSeek();
  const [custom, setCustom] = useState('');
  const set = async (label: string, at: Date) => {
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now()) {
      toast('Pick a time in the future');
      return;
    }
    const err = await remindMe(target, at);
    toast(err ?? 'Reminder set · ' + label.charAt(0).toLowerCase() + label.slice(1));
    if (!err) onClose();
  };
  return (
    <Modal title="Remind me" onClose={onClose} width={380}>
      <div className="mb">
        <div className="ppl" style={{ gap: 6 }}>
          {reminderChoices().map(([l, d]) => (
            <button key={l} type="button" className="btn" style={{ justifyContent: 'space-between', display: 'flex' }} onClick={() => void set(l, d)}>
              <span>{l}</span>
              <small style={{ color: 'var(--sb)' }}>{d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small>
            </button>
          ))}
        </div>
        <div className="fld">
          <label htmlFor="rm-c">Or pick a time</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="rm-c" className="inp" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button type="button" className="btn pri" disabled={!custom} onClick={() => void set('on ' + new Date(custom).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), new Date(custom))}>
              Set
            </button>
          </div>
        </div>
        <small style={{ color: 'var(--sb)' }}>The reminder arrives in your 🔔 (and as a desktop alert if you turned those on).</small>
      </div>
    </Modal>
  );
}

/** Jump to a conversation and flash the message. */
function useJump(me: string | null) {
  const { update, setUI } = useSeek();
  const router = useRouter();
  return async (conv: string, messageId: number | null) => {
    const route = await openConversation(conv, update, me);
    setUI({ chTab: 'Messages', thread: null });
    router.push(route);
    if (messageId != null) flashMessage(toUiId(messageId));
  };
}

/** Your saved messages, newest first. */
export function SavedDialog({ me, onClose }: { me: string | null; onClose: () => void }) {
  const { update, toast } = useSeek();
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const jump = useJump(me);
  useEffect(() => {
    void savedItems().then((l) => setItems(l ?? []));
  }, []);
  return (
    <Modal title="★ Saved" onClose={onClose} width={560}>
      <div className="mb" style={{ minHeight: 200 }}>
        {!items ? (
          <p className="sub">Loading…</p>
        ) : !items.length ? (
          <div className="empty">Nothing saved yet. Hover a message and press Save to keep it here.</div>
        ) : (
          items.map((it) => (
            <div key={it.messageId} className="frow" style={{ alignItems: 'flex-start' }}>
              <Avatar k={it.userId === me ? 'AH' : it.userId} size={30} />
              <span className="x">
                <small>
                  {nameFor(it.userId, me)} · {it.place} · {when(it.at)}
                </small>
                <div style={{ fontSize: 13.5, overflowWrap: 'anywhere' }}>
                  <RichText text={it.body.length > 280 ? it.body.slice(0, 280) + '…' : it.body} />
                </div>
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  onClose();
                  void jump(it.conv, it.messageId);
                }}
              >
                Open
              </button>
              <button
                type="button"
                className="btn sm ghost"
                aria-label="Remove from saved"
                onClick={async () => {
                  const err = await saveMessage(toUiId(it.messageId), false);
                  if (err) return toast(err);
                  setItems((l) => (l ?? []).filter((x) => x.messageId !== it.messageId));
                  update((d) => {
                    d.lsaved = (d.lsaved ?? []).filter((x) => x !== it.messageId);
                  });
                }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

/** The team's tasks: yours, everyone's open ones, and recently done. */
export function TasksDialog({ me, onClose }: { me: string | null; onClose: () => void }) {
  const { s, update, toast } = useSeek();
  const [view, setView] = useState<'mine' | 'open' | 'done'>('mine');
  const [making, setMaking] = useState(false);
  const [reminding, setReminding] = useState<number | null>(null);
  const jump = useJump(me);
  const all = s.ltasks ?? [];
  const list = all
    .filter((t) => (view === 'done' ? t.status === 'done' : t.status === 'open' && (view === 'open' || t.owner === me)))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const count = (v: typeof view) => all.filter((t) => (v === 'done' ? t.status === 'done' : t.status === 'open' && (v === 'open' || t.owner === me))).length;
  const act = async (p: Promise<string | null>, ok: string) => {
    const err = await p;
    toast(err ?? ok);
    if (!err) void refreshTasks(update, s.orgId);
  };
  return (
    <Modal
      title="☐ Tasks"
      onClose={onClose}
      width={580}
      footer={
        <button type="button" className="btn pri" onClick={() => setMaking(true)}>
          ＋ New task
        </button>
      }
    >
      <div className="tabs" role="tablist" style={{ padding: '0 16px' }}>
        {(
          [
            ['mine', 'Mine'],
            ['open', 'All open'],
            ['done', 'Done'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={'tb' + (view === k ? ' on' : '')} onClick={() => setView(k)}>
            {l} <span className="badge" style={{ background: 'var(--sb)' }}>{count(k)}</span>
          </button>
        ))}
      </div>
      <div className="mb" style={{ minHeight: 220 }}>
        {!list.length ? (
          <div className="empty">{view === 'mine' ? 'Nothing on your plate. Turn any message into a task from its More menu (or press T).' : view === 'open' ? 'No open tasks.' : 'Nothing finished in the last two weeks.'}</div>
        ) : (
          list.map((t: LiveTask) => {
            const late = t.status === 'open' && dueText(t.due) === 'overdue';
            return (
              <div key={t.id} className="frow">
                <input
                  type="checkbox"
                  aria-label={t.status === 'done' ? 'Mark as not done' : 'Mark as done'}
                  checked={t.status === 'done'}
                  onChange={(e) => void act(setTaskDone(t.id, e.target.checked), e.target.checked ? 'Task done' : 'Task reopened')}
                  style={{ width: 18, height: 18, flex: 'none' }}
                />
                <span className="x">
                  <b style={t.status === 'done' ? { textDecoration: 'line-through', color: 'var(--sb)' } : undefined}>{t.title}</b>
                  <small>
                    {nameFor(t.owner, me)} · <span style={late ? { color: 'var(--red)', fontWeight: 600 } : undefined}>{dueText(t.due)}</span>
                    {t.place ? ' · ' + t.place : ''}
                  </small>
                </span>
                {t.conv && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      onClose();
                      void jump(t.conv!, t.source);
                    }}
                  >
                    Open
                  </button>
                )}
                {t.status === 'open' && (
                  <button type="button" className="btn sm ghost" aria-label="Remind me" title="Remind me" onClick={() => setReminding(t.id)}>
                    ⏰
                  </button>
                )}
                {(t.by === me || t.owner === me) && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    aria-label="Delete task"
                    onClick={() => {
                      if (confirm(`Delete the task “${t.title}”?`)) void act(deleteTask(t.id), 'Task deleted');
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      {making && <TaskDialog initial="" sourceUiId={null} me={me} onClose={() => setMaking(false)} />}
      {reminding != null && <RemindDialog target={{ task: reminding }} onClose={() => setReminding(null)} />}
    </Modal>
  );
}

/** A channel's pinned messages (Pins tab). */
export function PinsList({ channel, me, name }: { channel: string | null; me: string | null; name: string }) {
  const { s, toast } = useSeek();
  const [pins, setPins] = useState<PinnedMessage[] | null>(null);
  const jump = useJump(me);
  // reload when a message in this channel is pinned or unpinned here
  const pinnedHere = (s.workspaces.C.msgs[name] ?? []).filter((m) => m.kind === 'msg' && m.pinned).length;
  useEffect(() => {
    if (!channel) return;
    let alive = true;
    void channelPins(channel).then((l) => alive && setPins(l ?? []));
    return () => {
      alive = false;
    };
  }, [channel, pinnedHere]);
  if (!channel) return null;
  if (!pins) return <p className="sub">Loading…</p>;
  if (!pins.length) return <div className="empty">Nothing pinned yet. Pin important messages (More → Pin, or P) so everyone in #{name} can find them.</div>;
  return (
    <div className="flist">
      {pins.map((p) => (
        <div key={p.id} className="dec" style={{ margin: 0, boxShadow: 'inset 4px 0 0 var(--v)' }}>
          <div className="k">
            <span>📌 PINNED</span>
            <small style={{ marginLeft: 'auto' }}>
              {p.pinnedBy ? 'by ' + nameFor(p.pinnedBy, me) + ' · ' : ''}
              {when(p.pinnedAt)}
            </small>
          </div>
          <small>
            {nameFor(p.userId, me)} · {when(p.at)}
          </small>
          <div style={{ fontSize: 14, overflowWrap: 'anywhere' }}>
            <RichText text={p.body} />
          </div>
          {p.files.length > 0 && <FileCards files={p.files} />}
          <div className="a">
            <button type="button" className="btn sm" onClick={() => void jump('ch:' + channel, p.id)}>
              Jump to message
            </button>
            <button
              type="button"
              className="btn sm ghost"
              onClick={async () => {
                const err = await pinMessage(toUiId(p.id), false);
                if (err) return toast(err);
                setPins((l) => (l ?? []).filter((x) => x.id !== p.id));
                toast('Unpinned');
              }}
            >
              Unpin
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The channel's canvas: one shared page (brief, owners, key dates). Saving never overwrites someone else's edit. */
export function CanvasEditor({ channel, me, name }: { channel: string | null; me: string | null; name: string }) {
  const { toast } = useSeek();
  const [c, setC] = useState<Canvas | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!channel) return;
    let alive = true;
    void loadCanvas(channel).then((x) => {
      if (!alive || !x) return;
      setC(x);
      setText(x.body);
    });
    return () => {
      alive = false;
    };
  }, [channel]);
  if (!channel) return null;
  if (!c) return <p className="sub">Loading…</p>;
  const save = async () => {
    if (!me) return;
    setBusy(true);
    const r = await saveCanvas(channel, text, me, c.updatedAt);
    setBusy(false);
    if (r.error) return toast(r.error);
    if (r.conflict) {
      toast(`${nameFor(r.conflict.updatedBy ?? '', me)} changed the canvas meanwhile. Their version is shown; copy your changes back in.`);
      setC(r.conflict);
      setText(r.conflict.body);
      return;
    }
    setC({ body: text, updatedBy: me, updatedAt: r.savedAt ?? null });
    setEditing(false);
    toast('Canvas saved');
  };
  if (!editing)
    return (
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="ct">
          <b>Canvas · #{name}</b>
          <button type="button" className="btn sm" onClick={() => setEditing(true)}>
            {c.body ? 'Edit' : 'Start the canvas'}
          </button>
        </div>
        {c.body ? (
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
            <RichText text={c.body} />
          </div>
        ) : (
          <p style={{ margin: 0, color: 'var(--mu)' }}>A canvas keeps the channel&apos;s brief, owners and key dates in one place everyone can edit.</p>
        )}
        {c.updatedAt && (
          <small style={{ color: 'var(--sb)' }}>
            Last edited by {nameFor(c.updatedBy ?? '', me)} · {when(c.updatedAt)}
          </small>
        )}
      </div>
    );
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="ct">
        <b>Editing the canvas · #{name}</b>
      </div>
      <textarea
        className="inp"
        rows={14}
        maxLength={20000}
        value={text}
        aria-label="Canvas"
        placeholder={'Goal:\nOwners:\nKey dates:\nLinks:'}
        onChange={(e) => setText(e.target.value)}
        style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn pri" disabled={busy || text === c.body} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText(c.body);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
