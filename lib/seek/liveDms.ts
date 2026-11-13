'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { accountFor, backendOn, DB_SCHEMA, sb } from './backend';
import type { ChatMessage, FileRef, MessageCard, PersonKey } from './data';
import { inviteByEmail, keyFor, learnProfiles, timeLabel, toUiId } from './live';
import { hydrateReactions, markNotSent, markRead, unreadCounts } from './liveSync';
import { useSeek } from './store';
import { onLiveStatus, useResync } from './resync';

/**
 * Real direct messages for the DMs screen (backend mode only). Conversations live in seek.dm_threads, their
 * messages in seek.messages, and both arrive live. Data is written into the app state the demo uses
 * (s.dms keyed by the other person, s.dm = the open one), so the existing feed and composer render it.
 */

type Row = { id: number; dm_id: string | null; user_id: string; parent_id: number | null; body: string; created_at: string; files?: FileRef[]; pinned_at?: string | null; edited_at?: string | null; card?: MessageCard | null };

export type LiveDms = {
  ready: boolean;
  /** teammates you can message (everyone in the workspace but you) */
  people: PersonKey[];
  /** opens (or starts) the conversation with a teammate, keyed by their user id */
  open: (k: PersonKey) => Promise<void>;
  send: (text: string) => Promise<void>;
  invite: (email: string, opts?: { role?: 'member' | 'admin'; channels?: string[] }) => Promise<string>;
};

// who your DMs are with (user id → conversation id), remembered on this device so a reload opens the last
// conversation straight away; refreshed from the server on every visit and removed with the rest on sign-out
const THREADS = 'seek:dmThreads';
function savedThreads(me: string | null): [string, string][] {
  try {
    const v = JSON.parse(localStorage.getItem(THREADS) || 'null') as { me: string; pairs: [string, string][] } | null;
    return v && me && v.me === me ? v.pairs : [];
  } catch {
    return [];
  }
}
function keepThreads(me: string | null, pairs: [string, string][]) {
  try {
    if (me) localStorage.setItem(THREADS, JSON.stringify({ me, pairs }));
  } catch {}
}

export function useLiveDms(): LiveDms | null {
  const { s, update, toast } = useSeek();
  const enabled = backendOn && s.session === 'in';
  const [ready, setReady] = useState(false);
  const sync = useResync();
  const [people, setPeople] = useState<PersonKey[]>([]);
  // start from what this device saved last time, so the open conversation loads at once
  const me = useRef<string | null>(s.meId ?? null);
  const ws = useRef<string | null>(s.orgId ?? null);
  const saved = savedThreads(s.meId ?? null);
  const threadOf = useRef(new Map<string, string>(saved)); // other user id → thread id
  const otherOf = useRef(new Map<string, string>(saved.map(([u, t]) => [t, u]))); // thread id → other user id
  const loadedFor = useRef('');
  const orgKey = s.orgId ?? null;
  const syncSeen = useRef(0);
  const current = s.dm;
  const currentRef = useRef(current);
  currentRef.current = current;

  const key = (userId: string) => keyFor(userId, me.current);
  const toMsg = (r: Row, flash = false): ChatMessage => ({ kind: 'msg', id: toUiId(r.id), who: key(r.user_id), time: timeLabel(r.created_at), at: r.created_at, text: r.body, files: r.files?.length ? r.files : undefined, pinned: !!r.pinned_at, edited: !!r.edited_at, card: r.card ?? undefined, flash });

  /** Registers a conversation so it shows in the list (with no messages loaded yet). */
  const remember = (thread: string, other: string, last = '') => {
    threadOf.current.set(other, thread);
    otherOf.current.set(thread, other);
    update((d) => {
      const k = key(other);
      if (!d.dms[k]) d.dms[k] = { last, unread: 0, msgs: [] };
      else if (last) d.dms[k]!.last = last;
    });
  };

  /** Finds who a conversation is with (for DMs someone else just started with you). */
  const learnThread = async (thread: string) => {
    if (otherOf.current.has(thread)) return otherOf.current.get(thread)!;
    const { data } = await sb().from('dm_members').select('user_id').eq('thread_id', thread);
    const other = ((data ?? []) as { user_id: string }[]).map((m) => m.user_id).find((id) => id !== me.current);
    if (!other) return null;
    await learnProfiles([other], me.current);
    remember(thread, other);
    return other;
  };

  /** Adds a message (sent here or arriving live) to its conversation, once. */
  const addRow = async (r: Row) => {
    if (!r.dm_id || r.parent_id != null) return;
    const other = await learnThread(r.dm_id);
    if (!other) return;
    await learnProfiles([r.user_id], me.current);
    if (key(other) === currentRef.current) markRead('dm:' + r.dm_id);
    update((d) => {
      const k = key(other);
      const t = (d.dms[k] ||= { last: '', unread: 0, msgs: [] });
      t.last = r.body;
      if (d.dm === k) {
        if (!t.msgs.some((m) => m.id === toUiId(r.id))) t.msgs.push(toMsg(r, r.user_id === me.current));
      } else if (r.user_id !== me.current) {
        t.unread = (t.unread || 0) + 1;
      }
    });
  };

  // ---- start: workspace, teammates, your conversations and their last messages; then listen live
  useEffect(() => {
    if (!enabled) return;
    let live: RealtimeChannel | null = null;
    let alive = true;
    setReady(false);
    (async () => {
      // the workspace that is open (when you switch, everything here starts again for the new one)
      const acc = await accountFor(orgKey);
      if (!alive || !acc?.workspace) return;
      loadedFor.current = '';
      me.current = acc.id;
      ws.current = acc.workspace.id;

      // everything in one round trip: teammates, who your conversations are with, their latest messages, unread counts
      // (the database only returns conversations you're in)
      const [{ data: members }, { data: all }, { data: recent }, counts] = await Promise.all([
        sb().from('workspace_members').select('user_id, role').eq('workspace_id', ws.current),
        sb().from('dm_members').select('thread_id, user_id'),
        sb().from('messages').select('id, dm_id, user_id, parent_id, body, created_at, files, pinned_at, edited_at, card').eq('workspace_id', ws.current).not('dm_id', 'is', null).order('created_at', { ascending: false }).limit(400),
        unreadCounts(ws.current).catch(() => new Map<string, number>()),
      ]);
      const team = ((members ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'guest').map((m) => m.user_id);
      const pairs = ((all ?? []) as { thread_id: string; user_id: string }[]).filter((p) => p.user_id !== me.current);
      const lasts = (recent ?? []) as Row[];
      if (!alive) return;

      threadOf.current = new Map(pairs.map((p) => [p.user_id, p.thread_id]));
      otherOf.current = new Map(pairs.map((p) => [p.thread_id, p.user_id]));
      keepThreads(me.current, pairs.map((p) => [p.user_id, p.thread_id]));
      setPeople(team.filter((id) => id !== me.current).map(key));
      update((d) => {
        // keep the messages already on screen; drop conversations that aren't yours (or the demo's samples)
        const prev = d.dms;
        d.dms = {};
        // newest conversation first
        const order = [...new Set(lasts.map((r) => r.dm_id!))].concat(pairs.map((p) => p.thread_id));
        for (const t of [...new Set(order)]) {
          const other = otherOf.current.get(t);
          if (!other) continue;
          const k = key(other);
          d.dms[k] = { last: lasts.find((r) => r.dm_id === t)?.body ?? '', unread: counts.get('dm:' + t) ?? 0, msgs: prev[k]?.msgs ?? [] };
        }
        if (!d.dms[d.dm]) d.dm = (Object.keys(d.dms)[0] as PersonKey) ?? '';
      });
      // names and photos fill in afterwards (most are already remembered on this device)
      void learnProfiles([...team, ...pairs.map((p) => p.user_id)], me.current).then(() => alive && update(() => {}));

      live = sb()
        .channel('seek-dms:' + ws.current)
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'messages', filter: `workspace_id=eq.${ws.current}` }, (p) => {
          void addRow(p.new as Row);
        })
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'dm_members', filter: `user_id=eq.${me.current}` }, (p) => {
          void learnThread((p.new as { thread_id: string }).thread_id);
        })
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'workspace_members', filter: `workspace_id=eq.${ws.current}` }, async (p) => {
          const m = p.new as { user_id: string; role: string };
          if (m.role === 'guest' || m.user_id === me.current) return;
          await learnProfiles([m.user_id], me.current);
          setPeople((xs) => (xs.includes(key(m.user_id)) ? xs : [...xs, key(m.user_id)]));
        })
        .subscribe(onLiveStatus());
      setReady(true);
    })();
    return () => {
      alive = false;
      if (live) sb().removeChannel(live);
    };
  }, [enabled, orgKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the open conversation's messages (latest 300, oldest first)
  useEffect(() => {
    if (!enabled || !current) return;
    const other = current === 'AH' ? null : current;
    const thread = other ? threadOf.current.get(other) : undefined;
    if (!thread) return;
    // catching up reloads the open conversation even if it was loaded already
    if (syncSeen.current !== sync) {
      syncSeen.current = sync;
      loadedFor.current = '';
    }
    // loaded as soon as we know the conversation (from this device); not again when the list refreshes
    if (loadedFor.current === thread) return;
    loadedFor.current = thread;
    markRead('dm:' + thread);
    let alive = true;
    let done = false;
    (async () => {
      const { data, error } = await sb()
        .from('messages')
        .select('id, dm_id, user_id, parent_id, body, created_at, files, pinned_at, edited_at, card')
        .eq('dm_id', thread)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!alive) return;
      if (error) {
        loadedFor.current = '';
        toast('Couldn’t load messages. Check your connection');
        return;
      }
      const rows = ((data ?? []) as Row[]).reverse();
      const msgs = rows.map((r) => toMsg(r));
      update((d) => {
        const t = (d.dms[current] ||= { last: '', unread: 0, msgs: [] });
        t.msgs = msgs;
        t.unread = 0;
      });
      done = true;
      await hydrateReactions(update, msgs.map((m) => m.id), me.current);
    })();
    return () => {
      alive = false;
      // a finished load stays loaded; an unfinished one is tried again
      if (!done && loadedFor.current === thread) loadedFor.current = '';
    };
  }, [enabled, ready, current, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // catching up (back to the tab, back online, reconnected): reload the open conversation and unread counts
  useEffect(() => {
    if (!enabled || !sync || !ws.current) return;
    void unreadCounts(ws.current).then((counts) =>
      update((d) => {
        for (const [other, thread] of threadOf.current) {
          const t = d.dms[key(other)];
          if (t && key(other) !== d.dm) t.unread = counts.get('dm:' + thread) ?? 0;
        }
      }),
    );
  }, [sync]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;
  return {
    ready,
    people,
    open: async (k) => {
      // k is a teammate's user id (teammates are keyed by id); 'AH' is you
      if (k === 'AH') return;
      let thread = threadOf.current.get(k);
      if (!thread) {
        const { data, error } = await sb().rpc('open_dm', { p_other: k });
        if (error || !data) {
          toast('Couldn’t start the conversation');
          return;
        }
        thread = data as string;
        remember(thread, k);
      }
      update((d) => {
        d.dm = k;
        const t = (d.dms[k] ||= { last: '', unread: 0, msgs: [] });
        t.unread = 0;
      });
    },
    send: async function send(text: string) {
      const k = current;
      const thread = threadOf.current.get(k);
      if (!thread) return;
      const { data, error } = await sb()
        .from('messages')
        .insert({ dm_id: thread, body: text })
        .select('id, dm_id, user_id, parent_id, body, created_at, files, pinned_at, edited_at, card')
        .single();
      if (error) {
        markNotSent(update, (d) => (d.dms[k] ||= { last: '', unread: 0, msgs: [] }).msgs, text, () => send(text));
        return;
      }
      await addRow(data as Row);
    },
    invite: (email, opts) => inviteByEmail(ws.current, me.current, email, opts),
  };
}
