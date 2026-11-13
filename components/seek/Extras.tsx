'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { orgPeople, type OrgPerson } from '@/lib/seek/backend';
import { PEOPLE, type LiveTask } from '@/lib/seek/data';
import {
  pinsIn,
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
  cancelScheduled,
  myScheduled,
  scheduleMessage,
  type Canvas,
  type ConvTarget,
  type PinnedMessage,
  type SavedItem,
  type Scheduled,
} from '@/lib/seek/liveExtras';
import type { FileTarget } from '@/lib/seek/liveFiles';
import { mentionIds } from '@/lib/seek/liveNotes';
import { toUiId } from '@/lib/seek/live';
import { flashMessage } from '@/lib/seek/liveDecisions';
import { workingDaysFromNow } from '@/lib/seek/liveApprovals';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { FileCards } from './Files';
import { Avatar, RichText } from './ui';
import { Ic } from './icons';

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
        <small style={{ color: 'var(--sb)' }}>The reminder arrives in your notifications (and as a desktop alert if you turned those on).</small>
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
    <Modal title="Saved" icon={<Ic n="star" />} onClose={onClose} width={560}>
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
                <Ic n="close" size={14} />
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
      title="Tasks"
      icon={<Ic n="task" />}
      onClose={onClose}
      width={580}
      footer={
        <button type="button" className="btn pri" onClick={() => setMaking(true)}>
          <Ic n="plus" size={14} /> New task
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
                    <Ic n="alarm" size={14} />
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
                    <Ic n="close" size={14} />
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
export function PinsList({ target, me, where, reloadKey = 0, canUnpin = true }: { target: ConvTarget | null; me: string | null; where: string; reloadKey?: number; canUnpin?: boolean }) {
  const { toast } = useSeek();
  const [pins, setPins] = useState<PinnedMessage[] | null>(null);
  const jump = useJump(me);
  const key = target ? JSON.stringify(target) : '';
  useEffect(() => {
    if (!target) return;
    let alive = true;
    void pinsIn(target).then((l) => alive && setPins(l ?? []));
    return () => {
      alive = false;
    };
  }, [key, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null;
  if (!pins) return <p className="sub">Loading…</p>;
  if (!pins.length) return <div className="empty">Nothing pinned yet. Pin important messages (More → Pin, or P) so everyone in {where} can find them.</div>;
  return (
    <div className="flist">
      {pins.map((p) => (
        <div key={p.id} className="dec" style={{ margin: 0, boxShadow: 'inset 4px 0 0 var(--v)' }}>
          <div className="k">
            <span className="mtl"><Ic n="pin" size={12} /> PINNED</span>
            {p.lane === 'client' && <span className="tag gold">Client chat</span>}
            {p.lane === 'team' && <span className="tag">Team notes</span>}
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
            <button type="button" className="btn sm" onClick={() => void jump(p.conv, p.id)}>
              Jump to message
            </button>
            {canUnpin && (
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
            )}
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

/** Send later: quick choices or any time. */
export function SendLaterDialog({ onPick, onClose }: { onPick: (at: Date) => Promise<void>; onClose: () => void }) {
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (at: Date) => {
    if (busy) return;
    setBusy(true);
    await onPick(at);
    setBusy(false);
  };
  const choices = reminderChoices().filter(([l]) => l !== 'In 20 minutes');
  return (
    <Modal title="Send later" onClose={onClose} width={380}>
      <div className="mb">
        <div className="ppl" style={{ gap: 6 }}>
          {choices.map(([l, d]) => (
            <button key={l} type="button" className="btn" disabled={busy} style={{ justifyContent: 'space-between', display: 'flex' }} onClick={() => void pick(d)}>
              <span>{l}</span>
              <small style={{ color: 'var(--sb)' }}>{d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small>
            </button>
          ))}
        </div>
        <div className="fld">
          <label htmlFor="sl-c">Or pick a time</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="sl-c" className="inp" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button type="button" className="btn pri" disabled={!custom || busy} onClick={() => void pick(new Date(custom))}>
              Schedule
            </button>
          </div>
        </div>
        <small style={{ color: 'var(--sb)' }}>Seek sends it at that time while it&apos;s open on one of your devices, or as soon as you next open it. Find and cancel it under Scheduled.</small>
      </div>
    </Modal>
  );
}

/** The composer's Send later handler for a conversation. */
export function useSchedule(target: FileTarget | null, candidates: string[] = []) {
  const { toast } = useSeek();
  if (!target) return undefined;
  return async (text: string, at: Date) => {
    const err = await scheduleMessage(target, text, at, mentionIds(text, candidates.filter((k) => k !== 'AH')));
    toast(err ?? 'Scheduled for ' + at.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
    return !err;
  };
}

/** Your scheduled messages, with Cancel. */
export function ScheduledDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useSeek();
  const [items, setItems] = useState<Scheduled[] | null>(null);
  useEffect(() => {
    void myScheduled().then((l) => setItems(l ?? []));
  }, []);
  return (
    <Modal title="Scheduled" icon={<Ic n="clock" />} onClose={onClose} width={520}>
      <div className="mb" style={{ minHeight: 160 }}>
        {!items ? (
          <p className="sub">Loading…</p>
        ) : !items.length ? (
          <div className="empty">Nothing scheduled. Write a message and press Later to send it at a set time.</div>
        ) : (
          items.map((it) => (
            <div key={it.id} className="frow" style={{ alignItems: 'flex-start' }}>
              <span className="x">
                <small>
                  {new Date(it.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {it.place}
                </small>
                <div style={{ fontSize: 13.5, overflowWrap: 'anywhere' }}>{it.body.length > 280 ? it.body.slice(0, 280) + '…' : it.body}</div>
              </span>
              <button
                type="button"
                className="btn sm ghost"
                onClick={async () => {
                  const err = await cancelScheduled(it.id);
                  toast(err ?? 'Cancelled · it won’t be sent');
                  setItems((l) => (l ?? []).filter((x) => x.id !== it.id));
                }}
              >
                Cancel
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
