'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PEOPLE, type ChatMessage, type DecisionCard, type FeedItem, type PersonKey, type State } from '@/lib/seek/data';
import { localMeetingText, now } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { backendOn } from '@/lib/seek/backend';
import { enterSends } from '@/lib/seek/prefs';
import { toDbId } from '@/lib/seek/live';
import { canRetry, deleteMessage, discardUnsent, removeEverywhere, retryUnsent, setReaction } from '@/lib/seek/liveSync';
import { decisionFrom, decisionsFor, loadDecisions, logDecision as saveDecision, undoDecision } from '@/lib/seek/liveDecisions';
import type { LiveDecision } from '@/lib/seek/data';
import { PromptDialog, usePrompt } from './Dialogs';
import { FileCards } from './Files';
import { canRecord, clockOf } from './recording';
import { HuddleCardView, MeetingCardView } from './Meetings';
import { dueText, RemindDialog, SendLaterDialog, TaskDialog } from './Extras';
import { editMessage, messageLink, pinMessage, saveMessage } from '@/lib/seek/liveExtras';
import { approvalDraft } from '@/lib/seek/liveApprovals';
import { usePopovers } from './Popovers';
import { Avatar, Emoji, RichText } from './ui';
import { Ic, type IconKey } from './icons';
import dynamic from 'next/dynamic';

// opened on a click (record, suggest tasks), so loaded then rather than with every screen
const VoiceRecorder = dynamic(() => import('./Recorder').then((m) => m.VoiceRecorder), { ssr: false });
const VideoRecorder = dynamic(() => import('./Recorder').then((m) => m.VideoRecorder), { ssr: false });
const SuggestTasksDialog = dynamic(() => import('./AiDialogs').then((m) => m.SuggestTasksDialog), { ssr: false });

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

/** "3:45 PM" for a message (its date shows in the day divider above it). */
/** When a message was sent: its saved time, or (sample chats) today at its "HH:MM". */
export function atOf(m: { at?: string; time: string }): string | undefined {
  if (m.at) return m.at;
  const t = /^(\d{1,2}):(\d{2})$/.exec(m.time);
  if (!t) return undefined;
  const d = new Date();
  d.setHours(Number(t[1]), Number(t[2]), 0, 0);
  return d.toISOString();
}

export function clockOf12(m: { at?: string; time: string }) {
  const at = atOf(m);
  if (!at) return m.time;
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Wednesday, 18 November 2026 at 3:06 PM" for a timestamp's tooltip. */
function fullWhen(m: { at?: string; time: string }) {
  const at = atOf(m);
  if (!at) return m.time;
  const d = new Date(at);
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' at ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The message's own text adds nothing next to its card: a meeting or huddle card says it all, and a file sent
 * without a caption gets the file's name as its text. The text stays on the message (notifications, search).
 */
function textIsCardOnly(m: ChatMessage) {
  if (m.failed) return false;
  if (m.card?.type === 'meeting' || m.card?.type === 'huddle') return true;
  const f = m.files;
  if (f?.length) {
    const t = m.text.trim();
    return t === '' || t === (f.length === 1 ? f[0].name : f.length + ' files');
  }
  return false;
}

/** "Today", "Yesterday", "Monday, June 15th" (with the year when it isn't this year). */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const n = d.getDate();
  const th = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  const wd = d.toLocaleDateString('en-US', { weekday: 'long' });
  const mo = d.toLocaleDateString('en-US', { month: 'long' });
  return wd + ', ' + mo + ' ' + n + th + (d.getFullYear() !== today.getFullYear() ? ', ' + d.getFullYear() : '');
}

function MessageRow({ m, feed, inThread, compact }: { m: ChatMessage; feed: FeedRef; inThread?: boolean; compact?: boolean }) {
  const { s, update, ui, setUI, toast, nextId } = useSeek();
  const pop = usePopovers();
  const menuOpen = ui.menu === m.id;
  const [logging, setLogging] = useState(false);
  // the agency's team logs decisions; clients see the ones from their Client chat
  const canLog = s.session === 'in';
  const meId = s.meId ?? null;
  const [dialog, setDialog] = useState<null | 'task' | 'remind' | 'edit' | 'ai-tasks'>(null);
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
  /** Hides the message at once with Undo; it is deleted for everyone when the Undo goes (or when you leave Seek). */
  const remove = () => {
    setUI({ menu: null });
    const dbId = toDbId(m.id);
    if (dbId == null) return;
    const copy = JSON.parse(JSON.stringify(m)) as ChatMessage;
    const restore = () =>
      update((d) => {
        const list = feed.get(d);
        if (list.some((y) => y.kind === 'msg' && y.id === copy.id)) return;
        const i = list.findIndex((y) => y.kind === 'msg' && y.id > copy.id);
        list.splice(i < 0 ? list.length : i, 0, copy);
      });
    update((d) => {
      const list = feed.get(d);
      const i = list.findIndex((y) => y.kind === 'msg' && y.id === m.id);
      if (i >= 0) list.splice(i, 1);
    });
    let state: 'waiting' | 'undone' | 'done' = 'waiting';
    const go = async () => {
      if (state !== 'waiting') return;
      state = 'done';
      clearTimeout(timer);
      removeEventListener('pagehide', go);
      if (await deleteMessage(m.id)) update((d) => removeEverywhere(d, dbId));
      else {
        restore();
        toast('Couldn’t delete it. Check your connection');
      }
    };
    const timer = setTimeout(() => void go(), 10000);
    addEventListener('pagehide', go);
    toast('Message deleted', () => {
      if (state !== 'waiting') return;
      state = 'undone';
      clearTimeout(timer);
      removeEventListener('pagehide', go);
      restore();
      toast('Message restored');
    });
  };

  const rowRef = useRef<HTMLDivElement>(null);
  // touch: a long press (about 450 ms) on the message opens its actions
  const press = useRef<{ t: number; x: number; y: number; at: number } | null>(null);
  const pressedAt = useRef(0);
  const endPress = () => {
    if (press.current) clearTimeout(press.current.t);
    press.current = null;
  };
  useEffect(() => endPress, []);
  // touch: a short tap on a grouped line shows its "⋮" for a few seconds (the first line of a group always has one)
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (!tapped) return;
    const t = setTimeout(() => setTapped(false), 5000);
    return () => clearTimeout(t);
  }, [tapped]);
  const cardOnly = textIsCardOnly(m);
  // close the "More" menu on a click elsewhere
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (Date.now() - pressedAt.current < 800 && rowRef.current?.contains(t)) return; // the finger lifting after a long press
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

  // the "More" menu: focus moves to its first item when it opens
  useEffect(() => {
    if (menuOpen) rowRef.current?.querySelector<HTMLElement>('.mm [role=menuitem]')?.focus({ preventScroll: true });
  }, [menuOpen]);
  /** Arrow keys, Home and End move through the menu; Escape and Tab close it, Escape back to its button. */
  const menuKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setUI({ menu: null });
      rowRef.current?.querySelector<HTMLElement>('.mt [data-more]')?.focus();
    } else if (e.key === 'Tab') {
      // Tab leaves the menu: close it and land on its button rather than lose focus
      e.preventDefault();
      setUI({ menu: null });
      rowRef.current?.querySelector<HTMLElement>('.mt [data-more]')?.focus();
    }
  };

  return (
    <div
      ref={rowRef}
      className={
        'msg' +
        (compact ? ' cmp' : '') +
        (m.ai ? ' ai' : '') +
        (m.client ? ' client' : '') +
        (menuOpen ? ' menu' : '') +
        (m.flash ? ' flash' : '') +
        (tapped ? ' tap' : '') +
        (cardOnly ? ' cardonly' : '') +
        (m.failed ? ' failed' : '')
      }
      data-id={m.id}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || inThread || (e.target as HTMLElement).closest('button,a,input,textarea,select,audio,video')) return;
        endPress();
        const t = window.setTimeout(() => {
          press.current = null;
          pressedAt.current = Date.now();
          setUI({ menu: m.id });
          navigator.vibrate?.(10);
        }, 450);
        press.current = { t, x: e.clientX, y: e.clientY, at: Date.now() };
      }}
      onPointerMove={(e) => {
        const p0 = press.current;
        if (p0 && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > 10) endPress(); // scrolling, not pressing
      }}
      onPointerUp={() => {
        // a short tap (not a long press, not a scroll) reveals this line's "⋮"
        if (press.current && Date.now() - press.current.at < 400) setTapped(true);
        endPress();
      }}
      onPointerCancel={endPress}
      onContextMenu={(e) => {
        // no browser menu on top of the message actions after a long press
        if (Date.now() - pressedAt.current < 800) e.preventDefault();
      }}
    >
      {compact ? (
        <span className="gut" title={fullWhen(m)}>
          {clockOf12(m).replace(/\s?[AP]M$/i, '')}
        </span>
      ) : (
        <Avatar k={m.who} size={36} />
      )}
      <div className="bd">
        {!compact && (
          <div className="nm">
            <b>{p.name}</b>
            {m.ai && <span className="tag ai">AI</span>}
            {m.client && <span className="tag gold">client</span>}
            <small title={fullWhen(m)}>{clockOf12(m)}</small>
            {m.edited && <small className="ed">(edited)</small>}
          </div>
        )}
        {!cardOnly && (
          <div className="tx">
            <RichText text={backendOn ? localMeetingText(m.text, m.at) : m.text} />
          </div>
        )}
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
        {myTasks.map((t) => {
          const due = t.status === 'done' ? 'done' : dueText(t.due);
          return (
            <div key={t.id} className={'task' + (t.status === 'done' ? ' done' : '') + (due === 'overdue' ? ' late' : '')}>
              <i aria-hidden="true">{t.status === 'done' && <Ic n="check" size={11} />}</i>
              <span className="tt">{t.title}</span>
              <small>
                {t.owner === meId ? 'You' : (PEOPLE[t.owner]?.name ?? 'Teammate')} · {due}
              </small>
              <span className="tag v">Task</span>
            </div>
          );
        })}
        {m.task && (
          <div className="task">
            <i aria-hidden="true"></i>
            <span className="tt">{m.task}</span>
            <span className="tag v">Task</span>
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
        {compact && m.edited && <small className="ed">(edited)</small>}
        {!inThread && feed.threads && m.thread && m.thread.length > 0 && (
          <button type="button" className="rlink" onClick={openThread}>
            <span className="rfaces">
              {[...new Set(m.thread.map((r) => r.who))].slice(0, 4).map((k) => (
                <Avatar key={k} k={k} size={24} />
              ))}
            </span>
            <span className="rn">
              {m.thread.length} {m.thread.length === 1 ? 'reply' : 'replies'}
            </span>
            <small>Last reply {m.thread[m.thread.length - 1].time}</small>
          </button>
        )}
        {(isSaved || (backendOn && m.pinned)) && (
          <div className="mflags">
            {backendOn && m.pinned && <span className="mtl"><Ic n="pin" size={12} /> Pinned</span>}
            {isSaved && <span className="mtl"><Ic n="star" size={12} /> Saved</span>}
          </div>
        )}
      </div>
      {!inThread && (
        <button type="button" className="mtt" data-more={m.id} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Message actions" onClick={() => setUI({ menu: menuOpen ? null : m.id })}>
          <Ic n="more" size={17} />
        </button>
      )}
      {!inThread && (
        <div className="mt">
          <button type="button" title="Add reaction" aria-label="Add reaction" onClick={(ev) => pop.openEmoji(ev.currentTarget, react)}>
            <Ic n="react" size={17} />
          </button>
          {feed.threads && (
            <button type="button" title="Reply in thread" aria-label="Reply in thread" onClick={openThread}>
              <Ic n="thread" size={17} />
            </button>
          )}
          {live && (
            <button type="button" className={isSaved ? 'on' : ''} title={isSaved ? 'Remove from saved' : 'Save for later'} aria-label={isSaved ? 'Remove from saved' : 'Save for later'} onClick={() => void toggleSave()}>
              <Ic n="bookmark" size={17} />
            </button>
          )}
          {!backendOn && (
            <button
              type="button"
              className={m.saved ? 'on' : ''}
              title={m.saved ? 'Remove from saved' : 'Save for later'}
              aria-label={m.saved ? 'Remove from saved' : 'Save for later'}
              onClick={() => {
                edit((x) => {
                  x.saved = !x.saved;
                });
                toast(m.saved ? 'Removed from saved' : 'Saved for later');
              }}
            >
              <Ic n="bookmark" size={17} />
            </button>
          )}
          <button type="button" data-more={m.id} aria-haspopup="menu" aria-expanded={menuOpen} title="More actions" aria-label="More actions" onClick={() => setUI({ menu: menuOpen ? null : m.id })}>
            <Ic n="more" size={17} />
          </button>
        </div>
      )}
      {menuOpen && backendOn && (
        <div className="mm" role="menu" aria-label="Message actions" onKeyDown={menuKeys}>
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
                setDialog('ai-tasks');
              }}
            >
              <Ic n="ai" /> Suggest tasks with AI
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
        <div className="mm" role="menu" aria-label="Message actions" onKeyDown={menuKeys}>
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
      {dialog === 'ai-tasks' && createPortal(<SuggestTasksDialog uiId={m.id} onClose={() => setDialog(null)} />, document.body)}
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

export function FeedItemView({ item, feed, inThread, compact }: { item: FeedItem; feed: FeedRef; inThread?: boolean; compact?: boolean }) {
  if (item.kind === 'new')
    return (
      <div className="newsep" role="separator" aria-label="New messages">
        <span>New messages</span>
      </div>
    );
  if (item.kind === 'dec') return <DecisionRow c={item} />;
  if (backendOn) return <LiveMessage m={item} feed={feed} inThread={inThread} compact={compact} />;
  return <MessageRow m={item} feed={feed} inThread={inThread} compact={compact} />;
}

const GROUP_MS = 5 * 60_000;
/** Day dividers before each new day, and whether a message joins the one above (same person, within 5 minutes). */
export function layoutFeed(items: FeedItem[]) {
  const out: ({ day: string; key: string } | { item: FeedItem; compact: boolean })[] = [];
  let prev: ChatMessage | null = null;
  let lastDay = '';
  for (const it of items) {
    const at = it.kind === 'msg' ? atOf(it) : undefined;
    if (at) {
      const day = new Date(at).toDateString();
      if (day !== lastDay) {
        out.push({ day: dayLabel(at), key: 'day:' + day });
        lastDay = day;
        prev = null;
      }
    }
    if (it.kind !== 'msg') {
      out.push({ item: it, compact: false });
      prev = null;
      continue;
    }
    const compact = !!prev && prev.who === it.who && !it.ai && !prev.ai && !!at && !!atOf(prev) && Date.parse(at) - Date.parse(atOf(prev)!) < GROUP_MS && !(prev.thread && prev.thread.length);
    out.push({ item: it, compact });
    prev = it;
  }
  return out;
}

/** A saved message with the decisions logged from it underneath (clients only see Client chat ones). */
function LiveMessage({ m, feed, inThread, compact }: { m: ChatMessage; feed: FeedRef; inThread?: boolean; compact?: boolean }) {
  const { s } = useSeek();
  const decs = decisionsFor(s, m.id);
  return (
    <>
      <MessageRow m={m} feed={feed} inThread={inThread} compact={compact} />
      {decs.map((d) => (
        <LiveDecisionRow key={d.id} d={d} />
      ))}
    </>
  );
}

/**
 * Scrollable message list that sticks to the newest message. If you have scrolled up to read, new messages from
 * others don't pull you down: a "New messages" pill appears instead. `empty` is shown when there are no messages yet.
 */
export function Feed({ feed, banner, footer, children, empty }: { feed: FeedRef; banner?: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode; empty?: React.ReactNode }) {
  const { s } = useSeek();
  const items = feed.get(s);
  const ref = useRef<HTMLDivElement>(null);
  const count = useRef(-1);
  const last = items[items.length - 1];
  // whether the newest message is in view, and how many arrived below while you were reading further up
  const atBottom = useRef(true);
  const [below, setBelow] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grew = items.length - Math.max(count.current, 0);
    const mine = last?.kind === 'msg' && last.who === 'AH';
    if (count.current === -1 || (grew > 0 && (atBottom.current || mine))) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
      setBelow(0);
    } else if (grew > 0) setBelow((n) => n + grew);
    count.current = items.length;
  }, [items.length, last]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && below) setBelow(0);
  };
  const toLatest = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setBelow(0);
  };
  const hasMsgs = items.some((x) => x.kind === 'msg');

  // screen readers: "New message from …" for messages that arrive while the conversation is open (not the history)
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null);
  const seen = useRef<{ where: string; at: number; last: number | null }>({ where: '', at: 0, last: null });
  useEffect(() => {
    const msgs = items.filter((x): x is ChatMessage => x.kind === 'msg');
    const tail = msgs.length ? msgs[msgs.length - 1].id : null;
    const was = seen.current;
    seen.current = { where: feed.where, at: was.where === feed.where ? was.at : Date.now(), last: tail };
    // a different conversation, the first load, or the history still arriving: nothing to say
    if (was.where !== feed.where || was.last == null || Date.now() - was.at < 1500) return;
    const from = msgs.findIndex((x) => x.id === was.last);
    if (from < 0) return;
    const fresh = msgs.slice(from + 1).filter((x) => x.who !== 'AH' && !x.failed);
    if (!fresh.length) return;
    const text =
      fresh.length === 1 ? 'New message from ' + (PEOPLE[fresh[0].who]?.name ?? 'someone') : fresh.length + ' new messages, the last from ' + (PEOPLE[fresh[fresh.length - 1].who]?.name ?? 'someone');
    setSaid((p) => ({ text, n: (p?.n ?? 0) + 1 }));
  }, [items, feed.where]);

  return (
    <>
      <div className="feed" id="feed" ref={ref} onScroll={onScroll}>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {said && <span key={said.n}>{said.text}</span>}
        </div>
        {!hasMsgs && empty ? (
          <div className="fempty-w">
            {banner}
            <div className="fempty">{empty}</div>
          </div>
        ) : (
          banner
        )}
        {layoutFeed(items).map((x) =>
          'day' in x ? (
            <div key={x.key} className="daysep" role="separator" aria-label={x.day}>
              <span>{x.day}</span>
            </div>
          ) : (
            <FeedItemView key={x.item.kind + x.item.id} item={x.item} feed={feed} compact={x.compact} />
          ),
        )}
        {children}
        {footer}
      </div>
      {below > 0 && (
        <button type="button" className="jump latest" onClick={toLatest}>
          <Ic n="down" size={14} /> {below === 1 ? '1 new message' : below + ' new messages'}
        </button>
      )}
    </>
  );
}

/** The start of a conversation: a mark, a title, a line or two about it, and a few things to do first. */
export function ConvStart({ mark, title, children, actions }: { mark: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="cstart">
      <span className="cstart-mk">{mark}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="cstart-a">{actions}</div>}
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

/** "@Name" for the people you can mention (and @everyone / @here), so the box can show them highlighted as you type. */
function mentionPattern(people: PersonKey[]): RegExp {
  const names = [...new Set(mentionItems(people).map((x) => x.n))]
    .filter(Boolean)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  return new RegExp('(^|[\\s(])(@(?:' + names.join('|') + '))(?![\\w])', 'gi');
}

/** The typed text again, behind the (see-through) box, with mentions drawn bold and tinted. */
function MirrorText({ text, re }: { text: string; re: RegExp }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index + m[1].length;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <b key={at} className="cmk">
        {m[2]}
      </b>,
    );
    last = at + m[2].length;
  }
  out.push(text.slice(last));
  // a final newline needs something after it to take up a line, like it does in the box
  return <>{out}{text.endsWith('\n') ? ' ' : null}</>;
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
  /** the client lane: gold, with the send button saying who it goes to */
  gold?: boolean;
  /** who can read what you write, shown in a slim strip at the top of the box */
  note?: React.ReactNode;
  people: PersonKey[];
  /** may return a promise: the send button shows it is sending until it settles */
  onSend: (text: string, alsoToChannel?: boolean) => void | Promise<unknown>;
  thread?: boolean;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  /** backend mode: uploads files with the typed text as their caption; resolves true when sent */
  onAttach?: (files: File[], caption: string) => Promise<boolean>;
  /** backend mode: sends the text later; resolves true when scheduled */
  onSchedule?: (text: string, at: Date) => Promise<boolean>;
}) {
  const { toast } = useSeek();
  const [askLink, linkDialog] = usePrompt();
  const fileIn = useRef<HTMLInputElement>(null);
  // the files on their way up (shown as chips in the box until they are sent)
  const [uploading, setUploading] = useState<string[]>([]);
  const busyUp = uploading.length > 0;
  const [later, setLater] = useState(false);
  const [recording, setRecording] = useState<null | 'voice' | 'video'>(null);
  // messages still on their way to the server
  const [sending, setSending] = useState(0);
  // the formatting bar (Bold, Italic…) shows when you turn it on with Aa; remembered on this device
  const [fmtOn, setFmtOn] = useState(false);
  useEffect(() => {
    try {
      setFmtOn(localStorage.getItem('seek:fmtbar') === '1');
    } catch {}
  }, []);
  const toggleFmt = () => {
    const on = !fmtOn;
    setFmtOn(on);
    try {
      localStorage.setItem('seek:fmtbar', on ? '1' : '0');
    } catch {}
    requestAnimationFrame(() => ta.current?.focus());
  };
  const recordable = !!onAttach && canRecord();
  /** Sends a recorded voice or video message (the typed text, if any, is its caption). */
  const sendRecorded = async (file: File, label: string) => {
    setRecording(null);
    if (!onAttach) return;
    setUploading([label]);
    const ok = await onAttach([file], v.trim() || label);
    setUploading([]);
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
  const mnId = useId();

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

  // mentions show bold and tinted while you type: the box turns see-through over a copy of the text that has them marked
  const peopleKey = people.join(',');
  const mentionRe = useMemo(() => mentionPattern(people), [peopleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const marked = v.includes('@') && (mentionRe.lastIndex = 0, mentionRe.test(v));
  const mirror = useRef<HTMLDivElement>(null);
  const syncMirror = () => {
    const t = ta.current;
    const m = mirror.current;
    if (!t || !m) return;
    const cs = getComputedStyle(t);
    // same text box as the textarea (its scrollbar excluded), so lines wrap in the same places
    m.style.width = t.clientWidth + 'px';
    m.style.height = t.clientHeight + 'px';
    m.style.padding = cs.padding;
    m.style.font = cs.font;
    m.style.letterSpacing = cs.letterSpacing;
    m.style.lineHeight = cs.lineHeight;
    m.scrollTop = t.scrollTop;
  };
  useLayoutEffect(() => {
    if (marked) syncMirror();
  });

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

  /** Wraps the selected text in a format (or inserts the markers and puts the cursor between them). */
  const wrap = (open: string, close = open) => {
    const t = ta.current!;
    const a = t.selectionStart ?? v.length;
    const b = t.selectionEnd ?? a;
    const sel = v.slice(a, b);
    const nv = v.slice(0, a) + open + sel + close + v.slice(b);
    setV(nv);
    requestAnimationFrame(() => {
      t.focus();
      if (sel) t.setSelectionRange(a, a + open.length + sel.length + close.length);
      else t.setSelectionRange(a + open.length, a + open.length);
    });
  };
  /** Starts each selected line (or the current one) with a prefix, e.g. "- " for a bulleted list. */
  const prefixLines = (pre: string) => {
    const t = ta.current!;
    const a = v.lastIndexOf('\n', (t.selectionStart ?? v.length) - 1) + 1;
    const b = t.selectionEnd ?? v.length;
    const block = v.slice(a, b) || '';
    const nb = block.split('\n').map((l) => (l.startsWith(pre) ? l : pre + l)).join('\n');
    const nv = v.slice(0, a) + nb + v.slice(b);
    setV(nv);
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(a + nb.length, a + nb.length);
    });
  };
  const addLink = async () => {
    const t = ta.current!;
    // the selection is kept while the link dialog is open, then put back
    const a = t.selectionStart ?? v.length;
    const b = t.selectionEnd ?? a;
    const url = (await askLink({ title: 'Add a link', label: 'Link (https://…)', confirm: 'Add link' }))?.trim();
    if (!url) return;
    const u = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    t.focus();
    t.setSelectionRange(a, b);
    const sel = t.value.slice(a, b);
    wrap('', sel ? ' (' + u + ')' : u);
  };
  const FORMATS: [IconKey, string, () => void, string?][] = [
    ['bold', 'Bold', () => wrap('*'), 'Ctrl+B'],
    ['italic', 'Italic', () => wrap('_'), 'Ctrl+I'],
    ['strike', 'Strikethrough', () => wrap('~'), 'Ctrl+Shift+X'],
    ['link', 'Link', addLink],
    ['list', 'Bulleted list', () => prefixLines('- ')],
    ['code', 'Code', () => (ta.current && ta.current.selectionStart !== ta.current.selectionEnd && v.slice(ta.current.selectionStart, ta.current.selectionEnd).includes('\n') ? wrap('```\n', '\n```') : wrap('`'))],
  ];

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
    if (!files.length || !onAttach || busyUp) return;
    setUploading(files.map((f) => f.name));
    const ok = await onAttach(files, v.trim());
    setUploading([]);
    if (ok) {
      setV('');
      setMn(null);
    }
  };

  const send = () => {
    const text = v.trim();
    if (!text) return;
    const r = onSend(text, also);
    setV('');
    setMn(null);
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setSending((n) => n + 1);
      void (r as Promise<unknown>).finally(() => setSending((n) => Math.max(0, n - 1)));
    }
  };

  return (
    <div
      className={'comp' + (gold ? ' gold' : '') + (thread ? ' thr' : '') + (fmtOn && !thread ? ' fmt-on' : '')}
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
      {note && !thread && (
        <div className="lane">
          <Ic n={gold ? 'eye' : 'lock'} size={13} />
          <span>{note}</span>
        </div>
      )}
      {!thread && fmtOn && (
        <div className="fmt" role="toolbar" aria-label="Formatting">
          {FORMATS.map(([icon, label, run, keys]) => (
            <button key={icon} type="button" title={label + (keys ? ' (' + keys + ')' : '')} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
              <Ic n={icon} size={16} />
            </button>
          ))}
        </div>
      )}
      {busyUp && (
        <div className="upl" role="status">
          <span className="sr-only">Uploading</span>
          {uploading.map((n, i) => (
            <span key={i} className="upc" title={n}>
              <i className="spin" aria-hidden="true"></i>
              <span>{n}</span>
            </span>
          ))}
        </div>
      )}
      <div className="cmp-ed">
      {marked && (
        <div ref={mirror} className="cmp-mirror" aria-hidden="true">
          <MirrorText text={v} re={mentionRe} />
        </div>
      )}
      <textarea
        ref={ta}
        rows={1}
        className={marked ? 'mk' : undefined}
        onScroll={marked ? syncMirror : undefined}
        placeholder={placeholder}
        aria-label={placeholder}
        // the @mention list: a textarea can't take role=combobox, so it is a textbox with list autocomplete
        aria-autocomplete="list"
        aria-controls={mn ? mnId : undefined}
        aria-activedescendant={mn ? mnId + '-' + mn.i : undefined}
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
          // formatting shortcuts
          if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const k = e.key.toLowerCase();
            if (k === 'b' || k === 'i' || (k === 'x' && e.shiftKey)) {
              e.preventDefault();
              wrap(k === 'b' ? '*' : k === 'i' ? '_' : '~');
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
      </div>
      {mn && (
        <div className="mnp" id={mnId} role="listbox" aria-label="Mention someone">
          <div className="mnh">Mention someone</div>
          {mn.items.map((x, i) => (
            <button
              key={x.n}
              type="button"
              role="option"
              id={mnId + '-' + i}
              tabIndex={-1}
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
                <span className="av" style={{ width: 26, height: 26, background: 'var(--soft)', color: 'var(--vtext)', fontSize: 14.5 }}>
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
              disabled={busyUp}
            >
              <Ic n="plus" size={20} />
            </button>
            <button type="button" className={'ic fmtb' + (fmtOn ? ' on' : '')} onClick={toggleFmt} aria-pressed={fmtOn} aria-label="Formatting" title={fmtOn ? 'Hide formatting' : 'Show formatting'}>
              <Ic n="type" size={18} />
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
            <button type="button" className="ic" onClick={(e) => pop.openEmoji(e.currentTarget, (k) => insert(k))} aria-label="Emoji">
              <Ic n="smile" size={20} />
            </button>
            <button type="button" className="ic" onClick={() => insert('', true)} aria-label="Mention someone">
              <Ic n="at" size={19} />
            </button>
            <button type="button" className="ic slashb" aria-label="Commands" title="Commands (type /)">
              /
            </button>
            {recordable && (
              <button type="button" className="ic" aria-label="Record a voice message" title="Voice message" disabled={busyUp || !!recording} onClick={() => setRecording('voice')}>
                <Ic n="mic" size={19} />
              </button>
            )}
            {recordable && (
              <button type="button" className="ic" aria-label="Record a video message" title="Video message" disabled={busyUp || !!recording} onClick={() => setRecording('video')}>
                <Ic n="video" size={19} />
              </button>
            )}
          </>
        )}
        <span className="sp"></span>
        {!thread && !onAttach && (
          <button type="button" className="btn sm ghost later" title="Send later" aria-label="Send later" onClick={() => toast('Scheduled for tomorrow 09:00')}>
            <Ic n="clock" /> <span className="btxt">Later</span>
          </button>
        )}
        {!thread && onSchedule && (
          <button
            type="button"
            className="btn sm ghost later"
            title="Send later"
            aria-label="Send later"
            onClick={() => (v.trim() ? setLater(true) : toast('Write the message first, then pick when to send it'))}
          >
            <Ic n="clock" /> <span className="btxt">Later</span>
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
        {linkDialog}
        <button
          type="button"
          className={'btn sm send ' + (gold ? 'gold' : 'pri') + (v.trim() ? '' : ' idle') + (sending ? ' busy' : '') + (button !== 'Send' ? ' wl' : '')}
          onClick={send}
          aria-label={button}
          title={button + (enterSends() ? ' (Enter)' : ' (Ctrl+Enter)')}
        >
          {button !== 'Send' && <span className="btxt">{button}</span>}
          <Ic n="send" size={16} />
        </button>
        {sending > 0 && (
          <span className="sr-only" role="status">
            Sending
          </span>
        )}
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
