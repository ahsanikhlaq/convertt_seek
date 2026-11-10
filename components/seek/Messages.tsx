'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PEOPLE, type ChatMessage, type DecisionCard, type FeedItem, type PersonKey, type State } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { usePopovers } from './Popovers';
import { Avatar, Emoji, RichText } from './ui';

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
  const { update, ui, setUI, toast, nextId } = useSeek();
  const pop = usePopovers();
  const menuOpen = ui.menu === m.id;
  const rx = m.rx || {};
  const p = PEOPLE[m.who] ?? { name: 'Someone', color: '#7a6179', role: '' };

  const edit = (fn: (x: ChatMessage, list: FeedItem[]) => void) =>
    update((d) => {
      const list = feed.get(d);
      const x = findMsg(list, m.id);
      if (x) fn(x, list);
    });

  const react = (e: string) =>
    edit((x) => {
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
          <small>{m.time}</small>
        </div>
        <div className="tx">
          <RichText text={m.text} />
        </div>
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
        {m.after && (
          <div className="tx" style={{ marginTop: 6 }}>
            <RichText text={m.after} />
          </div>
        )}
        {m.task && (
          <div className="task">
            <i></i>
            {m.task} <span className="tag v">task</span>
          </div>
        )}
        {Object.keys(rx).length > 0 && (
          <div className="reacts">
            {Object.entries(rx).map(([e, n]) => (
              <button key={e} type="button" className={'rx' + (m.myrx === e ? ' me' : '')} onClick={() => react(e)} aria-pressed={m.myrx === e}>
                <Emoji k={e} /> {n}
              </button>
            ))}
            <button type="button" className="rx add" title="Add reaction" aria-label="Add reaction" onClick={(ev) => pop.openEmoji(ev.currentTarget, react)}>
              ☺＋
            </button>
          </div>
        )}
        {!inThread && feed.threads && m.thread && m.thread.length > 0 && (
          <button type="button" className="rlink" onClick={openThread}>
            {m.thread.length} {m.thread.length === 1 ? 'reply' : 'replies'} <small>last {m.thread[m.thread.length - 1].time}</small>
          </button>
        )}
        {m.saved && <div style={{ fontSize: 11.5, color: 'var(--v)', marginTop: 4, fontWeight: 600 }}>★ Saved</div>}
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
          <button type="button" data-more={m.id} aria-expanded={menuOpen} onClick={() => setUI({ menu: menuOpen ? null : m.id })}>
            More
          </button>
        </div>
      )}
      {menuOpen && (
        <div className="mm" role="menu">
          <button type="button" role="menuitem" onClick={makeTask}>
            ☐ Make task <kbd>T</kbd>
          </button>
          <button type="button" role="menuitem" onClick={logDecision}>
            ◇ Log decision <kbd>D</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setUI({ menu: null });
              toast('Reminder set for tomorrow 09:00');
            }}
          >
            ⏰ Remind me <kbd>R</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setUI({ menu: null });
              toast('Link copied');
            }}
          >
            🔗 Copy link <kbd>L</kbd>
          </button>
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
  return <MessageRow m={item} feed={feed} inThread={inThread} />;
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
      n: PEOPLE[k].name.split(' ')[0],
      full: PEOPLE[k].name,
      d: PEOPLE[k].role + (k === 'CH' || k === 'PR' ? ' · client' : ''),
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
}) {
  const { toast } = useSeek();
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

  const send = () => {
    const text = v.trim();
    if (!text) return;
    onSend(text, also);
    setV('');
    setMn(null);
  };

  return (
    <div className={'comp' + (gold ? ' gold' : '')} style={{ position: 'relative', ...style }}>
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
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
                <span className="av" style={{ width: 26, height: 26, background: 'var(--soft)', color: 'var(--v)', fontSize: 13 }}>
                  @
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
      <div className="cr">
        {thread ? (
          <label style={{ fontSize: 12, color: 'var(--sb)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> Also send to the channel
          </label>
        ) : (
          <>
            <button type="button" className="ic" onClick={() => toast('Attach a file')} aria-label="Attach a file">
              ＋
            </button>
            <button type="button" className="ic" onClick={(e) => pop.openEmoji(e.currentTarget, (k) => insert(k))} aria-label="Emoji">
              ☺
            </button>
            <button type="button" className="ic" onClick={() => insert('', true)} aria-label="Mention someone">
              @
            </button>
            {note && <small>{note}</small>}
          </>
        )}
        <span className="sp"></span>
        {!thread && (
          <button type="button" className="btn sm ghost" onClick={() => toast('Scheduled for tomorrow 09:00')}>
            Send later
          </button>
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
          ×
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
