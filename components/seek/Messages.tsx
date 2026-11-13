'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PEOPLE, type ChatMessage, type DecisionCard, type FeedItem, type PersonKey, type State } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { backendOn } from '@/lib/seek/backend';
import { enterSends } from '@/lib/seek/prefs';
import { toDbId } from '@/lib/seek/live';
import { canRetry, deleteMessage, discardUnsent, removeEverywhere, retryUnsent, setReaction } from '@/lib/seek/liveSync';
import { decisionFrom, decisionsFor, loadDecisions, logDecision as saveDecision, undoDecision } from '@/lib/seek/liveDecisions';
import type { LiveDecision } from '@/lib/seek/data';
import { PromptDialog } from './Dialogs';
import { FileCards } from './Files';
import { canRecord, clockOf, VideoRecorder, VoiceRecorder } from './Recorder';
import { HuddleCardView, MeetingCardView } from './Meetings';
import { dueText, RemindDialog, SendLaterDialog, TaskDialog } from './Extras';
import { editMessage, messageLink, pinMessage, saveMessage } from '@/lib/seek/liveExtras';
import { approvalDraft } from '@/lib/seek/liveApprovals';
import { usePopovers } from './Popovers';
import { Avatar, Emoji, RichText } from './ui';
import { Ic } from './icons';

/** Where a feed lives in the state, so actions can write back to it. */
export type FeedRef = {
  get: (s: State) => FeedItem[];
  /** decision log "where" value for decisions logged from this feed */
  where: string;
  /** decisions logged here are visible to the client */
  clientVisible?: boolean;
  threads?: boolean;
};

const findMsg = (list: FeedItem[], id: number) => list.find((m): m is ChatMessage => m.kind === 'msg' && m.id === id);

/* ---------------- one message ---------------- */

function MessageRow({ m, feed, inThread }: { m: ChatMessage; feed: FeedRef; inThread?: boolean }) {
  const { s, update, ui, setUI, toast, nextId } = useSeek();
  const pop = usePopovers();
  const menuOpen = ui.menu === m.id;
  const [logging, setLogging] = useState(false);
  // the agency's team logs decisions; clients see the ones from their Client chat
  const canLog = s.session === 'in';
  const meId = s.meId ?? null;
  const [dialog, setDialog] = useState<null | 'task' | 'remind' | 'edit'>(null);
  const dbId = toDbId(m.id);
  const isSaved = backendOn ? dbId != null && (s.lsaved ?? []).includes(dbId) : !!m.saved;
  const myTasks = backendOn && dbId != null ? (s.ltasks ?? []).filter((t) => t.source === dbId) : [];

  /** Backend mode: save for yourself (★ Saved). */
  const toggleSave = async () => {
    setUI({ menu: null });
    if (dbId == null) return;
    const on = !isSaved;
    update((d) => {
      d.lsaved = on ? [...(d.lsaved ?? []), dbId] : (d.lsaved ?? []).filter((x) => x !== dbId);
    });
    const err = await saveMessage(m.id, on);
    if (err) {
      update((d) => {
        d.lsaved = !on ? [...(d.lsaved ?? []), dbId] : (d.lsaved ?? []).filter((x) => x !== dbId);
      });
      toast(err);
    } else toast(on ? 'Saved for later' : 'Removed from saved');
  };
  /** Backend mode: pin for everyone in the conversation. */
  const togglePin = async () => {
    setUI({ menu: null });
    const on = !m.pinned;
    const err = await pinMessage(m.id, on);
    if (err) return toast(err);
    edit((x) => {
      x.pinned = on;
    });
    toast(on ? 'Pinned for everyone here' : 'Unpinned');
  };
  const rx = m.rx || {};
  const p = PEOPLE[m.who] ?? { name: 'Someone', color: '#7a6179', role: '' };

  const edit = (fn: (x: ChatMessage, list: FeedItem[]) => void) =>
    update((d) => {
      const list = feed.get(d);
      const x = findMsg(list, m.id);
      if (x) fn(x, list);
    });

  const live = backendOn && toDbId(m.id) != null;
  const mine = (e: string) => (backendOn ? !!m.mx?.includes(e) : m.myrx === e);

  /** Backend mode: several reactions per person, saved and shown to everyone live. */
  const reactLive = async (e: string) => {
    const on = !m.mx?.includes(e);
    const flip = (add: boolean) =>
      edit((x) => {
        const rx = { ...(x.rx ?? {}) };
        const n = (rx[e] ?? 0) + (add ? 1 : -1);
        if (n > 0) rx[e] = n;
        else delete rx[e];
        x.rx = rx;
        x.mx = add ? [...(x.mx ?? []), e] : (x.mx ?? []).filter((y) => y !== e);
      });
    flip(on);
    if (!(await setReaction(m.id, e, on))) {
      flip(!on);
      toast('Couldn’t save the reaction. Check your connection');
    }
  };

  const react = (e: string) =>
    live
      ? void reactLive(e)
      : edit((x) => {
      x.rx = x.rx || {};
      if (x.myrx === e) {
        x.rx[e]--;
        if (!x.rx[e]) delete x.rx[e];
        x.myrx = null;
      } else {
        if (x.myrx) {
          x.rx[x.myrx]--;
          if (!x.rx[x.myrx]) delete x.rx[x.myrx];
        }
        x.rx[e] = (x.rx[e] || 0) + 1;
        x.myrx = e;
      }
    });

  const openThread = () => {
    edit((x) => {
      if (!x.thread) x.thread = [];
    });
    setUI({ thread: m.id, menu: null });
  };

  const makeTask = () => {
    edit((x) => {
      x.task = x.text.slice(0, 40) + (x.text.length > 40 ? '…' : '') + ' · due today';
    });
    setUI({ menu: null });
    toast('Task created and assigned');
  };

  const logDecision = () => {
    const decId = nextId();
    const logId = nextId();
    const text = m.text.replace(/^Let's /, '').replace(/ so .*/, '').replace(/\.$/, '');
    const by = `Logged by Ahsan from ${p.name}'s message · just now`;
    edit((_, list) => {
      const card: DecisionCard = { kind: 'dec', id: decId, text, by, flash: true, gold: feed.clientVisible };
      list.splice(list.findIndex((y) => y.id === m.id) + 1, 0, card);
    });
    update((d) => {
      d.decs.unshift({ id: logId, t: text, by, where: feed.where, time: 'Just now', type: 'dec', client: feed.clientVisible, a: 'Source message' });
    });
    setUI({ menu: null });
    toast('Decision logged', () => {
      update((d) => {
        const list = feed.get(d);
        const i = list.findIndex((y) => y.kind === 'dec' && y.id === decId);
        if (i >= 0) list.splice(i, 1);
        d.decs = d.decs.filter((x) => x.id !== logId);
      });
      toast('Decision removed');
    });
  };

  /** Backend mode: saves the decision (you can rephrase it first), with Undo for a few seconds. */
  const logLive = async (text: string) => {
    setLogging(false);
    const r = await saveDecision(m.id, text);
    if (r.error || r.id == null) {
      toast(r.error ?? 'Couldn’t log the decision');
      return;
    }
    const reload = async () => {
      const list = await loadDecisions(s.session === 'in' ? (s.orgId ?? null) : null);
      if (list)
        update((d) => {
          d.ldecs = list;
        });
    };
    await reload();
    toast('Decision logged', async () => {
      if (await undoDecision(r.id!)) {
        await reload();
        toast('Decision removed');
      } else toast('Couldn’t undo it. Remove it from the Decisions log');
    });
  };

  const copyText = async () => {
    setUI({ menu: null });
    try {
      await navigator.clipboard.writeText(m.text);
      toast('Message copied');
    } catch {
      toast('Couldn’t copy. Select the text and copy it');
    }
  };
  const copyLink = async () => {
    setUI({ menu: null });
    const url = messageLink(m.id);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied · it opens for anyone who can see this conversation');
    } catch {
      toast(url);
    }
  };
  const saveEdit = async (text: string) => {
    setDialog(null);
    if (text === m.text) return;
    const err = await editMessage(m.id, text);
    if (err) return toast(err);
    edit((x) => {
      x.text = text;
      x.edited = true;
    });
  };
  const remove = async () => {
    setUI({ menu: null });
    if (!confirm('Delete this message for everyone? This can’t be undone.')) return;
    if (await deleteMessage(m.id)) {
      update((d) => removeEverywhere(d, toDbId(m.id)!));
      toast('Message deleted');
    } else toast('Couldn’t delete it. Check your connection');
  };

  const rowRef = useRef<HTMLDivElement>(null);
  // close the "More" menu on a click elsewhere
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (rowRef.current?.querySelector('.mm')?.contains(t) || t.closest?.('[data-more="' + m.id + '"]')) return;
      setUI({ menu: null });
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, m.id, setUI]);

  // keyboard shortcuts shown in the "More" menu
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (backendOn) {
        if (k === 'l') void (live ? copyLink() : copyText());
        else if (k === 'e' && live && m.who === 'AH') {
          e.preventDefault();
          setUI({ menu: null });
          setDialog('edit');
        } else if (k === 's' && live) {
          e.preventDefault();
          void toggleSave();
        } else if (k === 'p' && live && canLog) {
          e.preventDefault();
          void togglePin();
        } else if (k === 't' && live && canLog) {
          e.preventDefault();
          setUI({ menu: null });
          setDialog('task');
        } else if (k === 'r' && live) {
          e.preventDefault();
          setUI({ menu: null });
          setDialog('remind');
        } else if (k === 'd' && live && canLog) {
          e.preventDefault();
          setUI({ menu: null });
          setLogging(true);
        } else if (k === 'escape') setUI({ menu: null });
        return;
      }
      if (k === 't') makeTask();
      else if (k === 'd') logDecision();
      else if (k === 'r') {
        setUI({ menu: null });
        toast('Reminder set for tomorrow 09:00');
      } else if (k === 'l') {
        setUI({ menu: null });
        toast('Link copied');
      } else if (k === 'escape') setUI({ menu: null });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div ref={rowRef} className={'msg' + (m.ai ? ' ai' : '') + (m.client ? ' client' : '') + (menuOpen ? ' menu' : '') + (m.flash ? ' flash' : '')} data-id={m.id}>
      <Avatar k={m.who} size={36} />
      <div className="bd">
        <div className="nm">
          <b>{p.name}</b>
          {m.ai && <span className="tag ai">AI</span>}
          {m.client && <span className="tag gold">client</span>}
          <small>
            {m.time}
            {m.edited ? ' · edited' : ''}
          </small>
        </div>
        <div className="tx" style={m.failed ? { opacity: 0.6 } : undefined}>
          <RichText text={m.text} />
        </div>
        {m.failed && (
          <div className="unsent" role="status">
            <b>Not sent</b>
            {canRetry(m.id) && (
              <button type="button" className="linkbtn" onClick={() => void retryUnsent(update, m.id)}>
                Retry
              </button>
            )}
            <button type="button" className="linkbtn" onClick={() => discardUnsent(update, m.id)}>
              Discard
            </button>
          </div>
        )}
        {m.src && (
          <button type="button" className="src linkbtn" onClick={() => toast('Sources: 9 messages in #launch-squad')}>
            {m.src}
          </button>
        )}
        {m.file && (
          <div className="file">
            <i>{m.file[0].split('.').pop()!.toUpperCase()}</i>
            <div>
              <b>{m.file[0]}</b>
              <small>{m.file[1]}</small>
            </div>
          </div>
        )}
        {m.files && m.files.length > 0 && <FileCards files={m.files} />}
        {m.card?.type === 'meeting' && <MeetingCardView c={m.card} />}
        {m.card?.type === 'huddle' && <HuddleCardView c={m.card} call={m.text.startsWith('📞')} />}
        {m.after && (
          <div className="tx" style={{ marginTop: 6 }}>
            <RichText text={m.after} />
          </div>
        )}
        {myTasks.map((t) => (
          <div key={t.id} className="task" style={t.status === 'done' ? { opacity: 0.6 } : undefined}>
            <i></i>
            <span style={t.status === 'done' ? { textDecoration: 'line-through' } : undefined}>{t.title}</span> · {t.owner === meId ? 'you' : (PEOPLE[t.owner]?.name ?? 'teammate')} · {t.status === 'done' ? 'done' : dueText(t.due)} <span className="tag v">task</span>
          </div>
        ))}
        {m.task && (
          <div className="task">
            <i></i>
            {m.task} <span className="tag v">task</span>
          </div>
        )}
        {Object.keys(rx).length > 0 && (
          <div className="reacts">
            {Object.entries(rx).map(([e, n]) => (
              <button key={e} type="button" className={'rx' + (mine(e) ? ' me' : '')} onClick={() => react(e)} aria-pressed={mine(e)}>
                <Emoji k={e} /> {n}
              </button>
            ))}
            <button type="button" className="rx add" title="Add reaction" aria-label="Add reaction" onClick={(ev) => pop.openEmoji(ev.currentTarget, react)}>
              <Ic n="react" size={16} />
            </button>
          </div>
        )}
        {!inThread && feed.threads && m.thread && m.thread.length > 0 && (
          <button type="button" className="rlink" onClick={openThread}>
            {m.thread.length} {m.thread.length === 1 ? 'reply' : 'replies'} <small>last {m.thread[m.thread.length - 1].time}</small>
          </button>
        )}
        {(isSaved || (backendOn && m.pinned)) && (
          <div style={{ fontSize: 12.5, color: 'var(--v)', marginTop: 4, fontWeight: 600, display: 'flex', gap: 10 }}>
            {backendOn && m.pinned && <span className="mtl"><Ic n="pin" size={12} /> Pinned</span>}
            {isSaved && <span className="mtl"><Ic n="star" size={12} /> Saved</span>}
          </div>
        )}
      </div>
      {!inThread && (
        <div className="mt">
          {feed.threads && (
            <button type="button" onClick={openThread}>
              Reply
            </button>
          )}
          <button type="button" onClick={(ev) => pop.openEmoji(ev.currentTarget, react)}>
            React
          </button>
          {live && (
            <button type="button" className={isSaved ? 'on' : ''} onClick={() => void toggleSave()}>
              {isSaved ? 'Saved' : 'Save'}
            </button>
          )}
          {!backendOn && (
            <button
              type="button"
              className={m.saved ? 'on' : ''}
              onClick={() => {
                edit((x) => {
                  x.saved = !x.saved;
                });
                toast(m.saved ? 'Removed from saved' : 'Saved for later');
              }}
            >
              {m.saved ? 'Saved' : 'Save'}
            </button>
          )}
          <button type="button" data-more={m.id} aria-expanded={menuOpen} onClick={() => setUI({ menu: menuOpen ? null : m.id })}>
            More
          </button>
        </div>
      )}
      {menuOpen && backendOn && (
        <div className="mm" role="menu">
          {live && canLog && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setUI({ menu: null });
                setDialog('task');
              }}
            >
              <Ic n="task" /> Make task <kbd>T</kbd>
            </button>
          )}
          {live && canLog && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setUI({ menu: null });
                setLogging(true);
              }}
            >
              <Ic n="decision" /> Log decision <kbd>D</kbd>
            </button>
          )}
          {live && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setUI({ menu: null });
                setDialog('remind');
              }}
            >
              <Ic n="alarm" /> Remind me <kbd>R</kbd>
            </button>
          )}
          {live && canLog && (
            <button type="button" role="menuitem" onClick={() => void togglePin()}>
              <Ic n="pin" /> {m.pinned ? 'Unpin' : 'Pin'} <kbd>P</kbd>
            </button>
          )}
          {live && (
            <button type="button" role="menuitem" onClick={() => void toggleSave()}>
              <Ic n="star" /> {isSaved ? 'Remove from saved' : 'Save'} <kbd>S</kbd>
            </button>
          )}
          {live && (
            <button type="button" role="menuitem" onClick={() => void copyLink()}>
              <Ic n="link" /> Copy link <kbd>L</kbd>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => void copyText()}>
            ⧉ Copy text{live ? '' : ' '}
            {!live && <kbd>L</kbd>}
          </button>
          {live && m.who === 'AH' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setUI({ menu: null });
                setDialog('edit');
              }}
            >
              <Ic n="edit" /> Edit message <kbd>E</kbd>
            </button>
          )}
          {live && m.who === 'AH' && (
            <button type="button" role="menuitem" onClick={() => void remove()} style={{ color: 'var(--red)' }}>
              <Ic n="trash" /> Delete message
            </button>
          )}
        </div>
      )}
      {menuOpen && !backendOn && (
        <div className="mm" role="menu">
          <button type="button" role="menuitem" onClick={makeTask}>
            <Ic n="task" /> Make task <kbd>T</kbd>
          </button>
          <button type="button" role="menuitem" onClick={logDecision}>
            <Ic n="decision" /> Log decision <kbd>D</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setUI({ menu: null });
              toast('Reminder set for tomorrow 09:00');
            }}
          >
            <Ic n="alarm" /> Remind me <kbd>R</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setUI({ menu: null });
              toast('Link copied');
            }}
          >
            <Ic n="link" /> Copy link <kbd>L</kbd>
          </button>
        </div>
      )}
      {dialog === 'task' && createPortal(<TaskDialog initial={m.text.replace(/\s+/g, ' ').trim()} sourceUiId={m.id} me={meId} onClose={() => setDialog(null)} />, document.body)}
      {dialog === 'edit' &&
        createPortal(<PromptDialog title="Edit message" label="Message" initial={m.text} confirm="Save" multiline onCancel={() => setDialog(null)} onSubmit={(t) => void saveEdit(t)} />, document.body)}
      {dialog === 'remind' && createPortal(<RemindDialog target={{ uiId: m.id }} onClose={() => setDialog(null)} />, document.body)}
      {logging &&
        createPortal(
        <PromptDialog
          title="Log decision"
          label={feed.clientVisible ? 'Decision (the client will see it)' : 'Decision'}
          initial={decisionFrom(m.text)}
          confirm="Log decision"
          multiline
          onCancel={() => setLogging(false)}
          onSubmit={(t) => void logLive(t.slice(0, 300))}
        />,
          document.body,
        )}
    </div>
  );
}

/* ---------------- a saved decision under its message (backend mode) ---------------- */

function LiveDecisionRow({ d }: { d: LiveDecision }) {
  const { s, update } = useSeek();
  const when = new Date(d.at);
  const today = when.toDateString() === new Date().toDateString();
  const label = today ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div className={'dec' + (d.client ? ' gold' : '')}>
      <div className="k">
        <span>{d.kind === 'approval' ? 'APPROVAL' : 'DECISION'}</span>
        {d.client && <span className="tag gold">client</span>}
        {d.replaces != null && <span className="tag">edited</span>}
      </div>
      <b>{d.text}</b>
      <small>
        Logged by {d.by} · {label}
      </small>
      {s.session === 'in' && (
        <div className="a">
          {d.client && d.kind === 'decision' && d.conv.startsWith('sp:') && (
            <button
              type="button"
              className="btn sm gold"
              onClick={() => {
                approvalDraft.current = { decision: d.id, title: d.text, space: d.conv.split(':')[1] };
                update((x) => {
                  x.cTab = 'Approvals';
                });
              }}
            >
              Request formal approval
            </button>
          )}
          <Link className="btn sm" href={ROUTES.decisions}>
            Open log
          </Link>
        </div>
      )}
    </div>
  );
}

/* ---------------- decision card inside a feed ---------------- */

function DecisionRow({ c }: { c: DecisionCard }) {
  const { s, update, toast } = useSeek();
  return (
    <div className={'dec' + (c.gold ? ' gold' : '') + (c.flash ? ' flash' : '')}>
      <div className="k">
        <span>DECISION</span>
        {c.gold && <span className="tag gold">client</span>}
      </div>
      <b>{c.text}</b>
      <small>{c.by}</small>
      <div className="a">
        {c.req &&
          (s.approval === 'open' ? (
            <button
              type="button"
              className="btn sm gold"
              onClick={() => {
                update((d) => {
                  d.approval = 'req';
                });
                toast('Formal approval sent to Chris · due Thursday');
              }}
            >
              Request formal approval
            </button>
          ) : (
            <span className="tag gold">{s.approval === 'done' ? 'Approved by Chris' : 'Formal approval requested · due Thu'}</span>
          ))}
        <Link className="btn sm" href={ROUTES.decisions}>
          Open log
        </Link>
      </div>
    </div>
  );
}

/* ---------------- feed ---------------- */

export function FeedItemView({ item, feed, inThread }: { item: FeedItem; feed: FeedRef; inThread?: boolean }) {
  if (item.kind === 'new') return <div className="newsep">New</div>;
  if (item.kind === 'dec') return <DecisionRow c={item} />;
  if (backendOn) return <LiveMessage m={item} feed={feed} inThread={inThread} />;
  return <MessageRow m={item} feed={feed} inThread={inThread} />;
}

/** A saved message with the decisions logged from it underneath (clients only see Client chat ones). */
function LiveMessage({ m, feed, inThread }: { m: ChatMessage; feed: FeedRef; inThread?: boolean }) {
  const { s } = useSeek();
  const decs = decisionsFor(s, m.id);
  return (
    <>
      <MessageRow m={m} feed={feed} inThread={inThread} />
      {decs.map((d) => (
        <LiveDecisionRow key={d.id} d={d} />
      ))}
    </>
  );
}

/** Scrollable message list that sticks to the newest message. */
export function Feed({ feed, banner, footer, children }: { feed: FeedRef; banner?: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode }) {
  const { s } = useSeek();
  const items = feed.get(s);
  const ref = useRef<HTMLDivElement>(null);
  const count = useRef(-1);
  const last = items[items.length - 1];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (count.current === -1 || items.length > count.current) el.scrollTop = el.scrollHeight;
    count.current = items.length;
  }, [items.length, last]);

  return (
    <div className="feed" id="feed" ref={ref}>
      {banner}
      {items.map((m) => (
        <FeedItemView key={m.kind + m.id} item={m} feed={feed} />
      ))}
      {children}
      {footer}
    </div>
  );
}

/* ---------------- composer ---------------- */

type MentionItem = { k: PersonKey | null; n: string; full?: string; d: string };

function mentionItems(people: PersonKey[]): MentionItem[] {
  return [
    { k: null, n: 'everyone', d: 'Notify everyone in this conversation' },
    { k: null, n: 'here', d: 'Notify people who are online' },
    ...people.map((k) => ({
      k,
      n: (PEOPLE[k]?.name ?? 'Someone').split(' ')[0],
      full: PEOPLE[k]?.name ?? 'Someone',
      d: (PEOPLE[k]?.role ?? '') + (k === 'CH' || k === 'PR' ? ' · client' : ''),
    })),
  ];
}

export function Composer({
  placeholder,
  button = 'Send',
  gold,
  note,
  people,
  onSend,
  thread,
  autoFocus,
  style,
  onAttach,
  onSchedule,
}: {
  placeholder: string;
  button?: string;
  gold?: boolean;
  note?: string;
  people: PersonKey[];
  onSend: (text: string, alsoToChannel?: boolean) => void;
  thread?: boolean;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  /** backend mode: uploads files with the typed text as their caption; resolves true when sent */
  onAttach?: (files: File[], caption: string) => Promise<boolean>;
  /** backend mode: sends the text later; resolves true when scheduled */
  onSchedule?: (text: string, at: Date) => Promise<boolean>;
}) {
  const { toast } = useSeek();
  const fileIn = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [later, setLater] = useState(false);
  const [recording, setRecording] = useState<null | 'voice' | 'video'>(null);
  const recordable = !!onAttach && canRecord();
  /** Sends a recorded voice or video message (the typed text, if any, is its caption). */
  const sendRecorded = async (file: File, label: string) => {
    setRecording(null);
    if (!onAttach) return;
    setUploading(1);
    const ok = await onAttach([file], v.trim() || label);
    setUploading(0);
    if (ok) {
      setV('');
      setMn(null);
    }
  };
  const pop = usePopovers();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState('');
  const [also, setAlso] = useState(false);
  const [mn, setMn] = useState<{ items: MentionItem[]; i: number } | null>(null);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  // auto-grow
  useLayoutEffect(() => {
    const t = ta.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 140) + 'px';
  }, [v]);

  const refreshMentions = (val: string, caret: number) => {
    const m = val.slice(0, caret).match(/(^|\s)@(\w*)$/);
    if (!m) return setMn(null);
    const q = m[2].toLowerCase();
    const items = mentionItems(people).filter((x) => x.n.toLowerCase().startsWith(q) || (x.full || '').toLowerCase().includes(q));
    setMn(items.length ? { items, i: Math.min(mn?.i ?? 0, items.length - 1) } : null);
  };

  const pickMention = (x: MentionItem) => {
    const t = ta.current!;
    const pos = t.selectionStart;
    const before = v.slice(0, pos).replace(/@(\w*)$/, '@' + x.n + ' ');
    const nv = before + v.slice(pos);
    setV(nv);
    setMn(null);
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(before.length, before.length);
    });
  };

  const insert = (txt: string, mention?: boolean) => {
    const t = ta.current!;
    const p = t.selectionStart ?? v.length;
    const pre = v.slice(0, p);
    const add = mention ? (pre && !/\s$/.test(pre) ? ' ' : '') + '@' : txt + ' ';
    const nv = pre + add + v.slice(p);
    setV(nv);
    requestAnimationFrame(() => {
      t.focus();
      const np = p + add.length;
      t.setSelectionRange(np, np);
      if (mention) refreshMentions(nv, np);
    });
  };

  const attach = async (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list ?? []);
    if (!files.length || !onAttach || uploading) return;
    setUploading(files.length);
    const ok = await onAttach(files, v.trim());
    setUploading(0);
    if (ok) {
      setV('');
      setMn(null);
    }
  };

  const send = () => {
    const text = v.trim();
    if (!text) return;
    onSend(text, also);
    setV('');
    setMn(null);
  };

  return (
    <div
      className={'comp' + (gold ? ' gold' : '')}
      style={{ position: 'relative', ...style }}
      onDragOver={onAttach ? (e) => e.preventDefault() : undefined}
      onDrop={
        onAttach
          ? (e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              void attach(e.dataTransfer.files);
            }
          : undefined
      }
    >
      <textarea
        ref={ta}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          refreshMentions(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (mn) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setMn({ ...mn, i: (mn.i + d + mn.items.length) % mn.items.length });
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              pickMention(mn.items[mn.i]);
              return;
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setMn(null);
              return;
            }
          }
          // Enter sends (Shift+Enter: new line), or, if you chose so in Account settings, Ctrl/⌘+Enter sends
          const sendKey = enterSends() ? !e.shiftKey && !e.ctrlKey && !e.metaKey : e.ctrlKey || e.metaKey;
          if (e.key === 'Enter' && sendKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        onBlur={() => setTimeout(() => setMn(null), 120)}
      />
      {mn && (
        <div className="mnp" role="listbox" aria-label="Mention someone">
          <div className="mnh">Mention someone</div>
          {mn.items.map((x, i) => (
            <button
              key={x.n}
              type="button"
              role="option"
              aria-selected={i === mn.i}
              className={'mni' + (i === mn.i ? ' on' : '')}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(x);
              }}
            >
              {x.k ? (
                <Avatar k={x.k} size={26} />
              ) : (
                <span className="av" style={{ width: 26, height: 26, background: 'var(--soft)', color: 'var(--v)', fontSize: 14.5 }}>
                  <Ic n="at" size={19} />
                </span>
              )}
              <span className="x">
                <b>{x.k ? x.full : '@' + x.n}</b>
                <small>{x.d}</small>
              </span>
              {x.k && x.k !== 'AH' && <i className="pres"></i>}
            </button>
          ))}
        </div>
      )}
      {recording === 'voice' && (
        <VoiceRecorder onCancel={() => setRecording(null)} onSend={(f, secs) => void sendRecorded(f, 'Voice message · ' + clockOf(secs))} />
      )}
      {recording === 'video' &&
        createPortal(<VideoRecorder onClose={() => setRecording(null)} onSend={(f, secs) => void sendRecorded(f, 'Video message · ' + clockOf(secs))} />, document.body)}
      <div className="cr">
        {thread ? (
          <label style={{ fontSize: 13, color: 'var(--sb)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> Also send to the channel
          </label>
        ) : (
          <>
            <button
              type="button"
              className="ic"
              onClick={() => (onAttach ? fileIn.current?.click() : toast('Attach a file'))}
              aria-label="Attach files"
              title="Attach files (up to 100 MB each)"
              disabled={!!uploading}
            >
              <Ic n="plus" size={20} />
            </button>
            {onAttach && (
              <input
                ref={fileIn}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void attach(e.target.files);
                  e.target.value = '';
                }}
              />
            )}
            {uploading > 0 && <small className="up">Uploading {uploading === 1 ? 'file' : uploading + ' files'}…</small>}
            <button type="button" className="ic" onClick={(e) => pop.openEmoji(e.currentTarget, (k) => insert(k))} aria-label="Emoji">
              <Ic n="smile" size={20} />
            </button>
            <button type="button" className="ic" onClick={() => insert('', true)} aria-label="Mention someone">
              <Ic n="at" size={19} />
            </button>
            {recordable && (
              <button type="button" className="ic" aria-label="Record a voice message" title="Voice message" disabled={!!uploading || !!recording} onClick={() => setRecording('voice')}>
                <Ic n="mic" size={19} />
              </button>
            )}
            {recordable && (
              <button type="button" className="ic" aria-label="Record a video message" title="Video message" disabled={!!uploading || !!recording} onClick={() => setRecording('video')}>
                <Ic n="video" size={19} />
              </button>
            )}
            {note && <small>{note}</small>}
          </>
        )}
        <span className="sp"></span>
        {!thread && !onAttach && (
          <button type="button" className="btn sm ghost" onClick={() => toast('Scheduled for tomorrow 09:00')}>
            Send later
          </button>
        )}
        {!thread && onSchedule && (
          <button
            type="button"
            className="btn sm ghost"
            title="Send later"
            onClick={() => (v.trim() ? setLater(true) : toast('Write the message first, then pick when to send it'))}
          >
            <Ic n="clock" /> Later
          </button>
        )}
        {later && onSchedule &&
          createPortal(
            <SendLaterDialog
              onClose={() => setLater(false)}
              onPick={async (at) => {
                if (await onSchedule(v.trim(), at)) {
                  setV('');
                  setMn(null);
                  setLater(false);
                }
              }}
            />,
            document.body,
          )}
        <button type="button" className={'btn sm ' + (gold ? 'gold' : 'pri')} onClick={send}>
          {button}
        </button>
      </div>
    </div>
  );
}

/* ---------------- thread pane ---------------- */

export function useSendTo(feed: FeedRef) {
  const { update, nextId } = useSeek();
  return (text: string) => {
    const id = nextId();
    update((d) => {
      feed.get(d).push({ kind: 'msg', id, who: 'AH', time: now(), text, flash: true });
    });
    return id;
  };
}

export function ThreadPane({
  feed,
  people,
  onReply,
}: {
  feed: FeedRef;
  people: PersonKey[];
  /** with a backend, replies are saved (and appear through the live feed) instead of only in local state */
  onReply?: (rootId: number, text: string, alsoToChannel: boolean) => void;
}) {
  const { s, ui, update, setUI, nextId } = useSeek();
  const root = ui.thread != null ? findMsg(feed.get(s), ui.thread) : undefined;
  const bodyRef = useRef<HTMLDivElement>(null);
  const n = root?.thread?.length ?? 0;
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [n]);
  if (!root) return null;
  const replies = root.thread || [];
  return (
    <aside className="pane">
      <div className="ph">
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>Thread</b>
          <small>{root.text.slice(0, 34)}…</small>
        </div>
        <button type="button" className="x" onClick={() => setUI({ thread: null })} aria-label="Close thread">
          <Ic n="close" size={16} />
        </button>
      </div>
      <div className="pb" ref={bodyRef}>
        <MessageRow m={root} feed={feed} inThread />
        <div className="daysep" style={{ margin: 0 }}>
          {replies.length || 'No'} {replies.length === 1 ? 'reply' : 'replies'}
        </div>
        {replies.map((r, i) => (
          <MessageRow key={i} m={{ kind: 'msg', id: -1 - i, ...r }} feed={feed} inThread />
        ))}
      </div>
      <Composer
          style={{ margin: '0 12px 12px' }}
          key={root.id}
          placeholder="Reply in thread"
          button="Reply"
          thread
          autoFocus
          people={people}
          onSend={(text, also) => {
            if (onReply) {
              onReply(root.id, text, !!also);
              return;
            }
            const id = nextId();
            update((d) => {
              const list = feed.get(d);
              const x = findMsg(list, root.id);
              if (!x) return;
              (x.thread = x.thread || []).push({ who: 'AH', time: now(), text });
              if (also) list.push({ kind: 'msg', id, who: 'AH', time: now(), text, flash: true });
            });
          }}
        />
    </aside>
  );
}
