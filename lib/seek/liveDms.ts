'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { backendOn, currentAccount, DB_SCHEMA, sb } from './backend';
import type { ChatMessage, PersonKey } from './data';
import { inviteByEmail, keyFor, learnProfiles, timeLabel, toUiId } from './live';
import { hydrateReactions, markRead, unreadCounts } from './liveSync';
import { useSeek } from './store';

/**
 * Real direct messages for the DMs screen (backend mode only). Conversations live in seek.dm_threads, their
 * messages in seek.messages, and both arrive live. Data is written into the app state the demo uses
 * (s.dms keyed by the other person, s.dm = the open one), so the existing feed and composer render it.
 */

type Row = { id: number; dm_id: string | null; user_id: string; parent_id: number | null; body: string; created_at: string };

export type LiveDms = {
  ready: boolean;
  /** teammates you can message (everyone in the workspace but you) */
  people: PersonKey[];
  /** opens (or starts) the conversation with a teammate, keyed by their user id */
  open: (k: PersonKey) => Promise<void>;
  send: (text: string) => Promise<void>;
  invite: (email: string, opts?: { role?: 'member' | 'admin'; channels?: string[] }) => Promise<string>;
};

export function useLiveDms(): LiveDms | null {
  const { s, update, toast } = useSeek();
  const enabled = backendOn && s.session === 'in';
  const [ready, setReady] = useState(false);
  const [people, setPeople] = useState<PersonKey[]>([]);
  const me = useRef<string | null>(null);
  const ws = useRef<string | null>(null);
  const threadOf = useRef(new Map<string, string>()); // other user id → thread id
  const otherOf = useRef(new Map<string, string>()); // thread id → other user id
  const current = s.dm;
  const currentRef = useRef(current);
  currentRef.current = current;

  const key = (userId: string) => keyFor(userId, me.current);
  const toMsg = (r: Row, flash = false): ChatMessage => ({ kind: 'msg', id: toUiId(r.id), who: key(r.user_id), time: timeLabel(r.created_at), text: r.body, flash });

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
    (async () => {
      // the account is loaded once at start-up and shared, so this is usually instant
      const acc = await currentAccount();
      if (!alive || !acc?.workspace) return;
      me.current = acc.id;
      ws.current = acc.workspace.id;

      const [{ data: members }, { data: mine }] = await Promise.all([
        sb().from('workspace_members').select('user_id, role').eq('workspace_id', ws.current),
        sb().from('dm_members').select('thread_id').eq('user_id', me.current),
      ]);
      const team = ((members ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'guest').map((m) => m.user_id);
      const threadIds = ((mine ?? []) as { thread_id: string }[]).map((m) => m.thread_id);
      let pairs: { thread_id: string; user_id: string }[] = [];
      let lasts: Row[] = [];
      if (threadIds.length) {
        const [{ data: all }, { data: recent }] = await Promise.all([
          sb().from('dm_members').select('thread_id, user_id').in('thread_id', threadIds),
          sb().from('messages').select('id, dm_id, user_id, parent_id, body, created_at').in('dm_id', threadIds).order('created_at', { ascending: false }).limit(400),
        ]);
        pairs = ((all ?? []) as { thread_id: string; user_id: string }[]).filter((p) => p.user_id !== me.current);
        lasts = (recent ?? []) as Row[];
      }
      const [counts] = await Promise.all([
        unreadCounts(ws.current).catch(() => new Map<string, number>()),
        learnProfiles([...team, ...pairs.map((p) => p.user_id)], me.current),
      ]);
      if (!alive) return;

      threadOf.current = new Map(pairs.map((p) => [p.user_id, p.thread_id]));
      otherOf.current = new Map(pairs.map((p) => [p.thread_id, p.user_id]));
      setPeople(team.filter((id) => id !== me.current).map(key));
      update((d) => {
        d.dms = {}; // the demo's sample conversations don't belong in a real workspace
        // newest conversation first
        const order = [...new Set(lasts.map((r) => r.dm_id!))].concat(pairs.map((p) => p.thread_id));
        for (const t of [...new Set(order)]) {
          const other = otherOf.current.get(t);
          if (!other) continue;
          d.dms[key(other)] = { last: lasts.find((r) => r.dm_id === t)?.body ?? '', unread: counts.get('dm:' + t) ?? 0, msgs: [] };
        }
        if (!d.dms[d.dm]) d.dm = (Object.keys(d.dms)[0] as PersonKey) ?? '';
      });

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
        .subscribe();
      setReady(true);
    })();
    return () => {
      alive = false;
      if (live) sb().removeChannel(live);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the open conversation's messages (latest 300, oldest first)
  useEffect(() => {
    if (!enabled || !ready || !current) return;
    const other = current === 'AH' ? null : current;
    const thread = other ? threadOf.current.get(other) : undefined;
    if (!thread) return;
    markRead('dm:' + thread);
    let alive = true;
    (async () => {
      const { data, error } = await sb()
        .from('messages')
        .select('id, dm_id, user_id, parent_id, body, created_at')
        .eq('dm_id', thread)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!alive) return;
      if (error) {
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
      await hydrateReactions(update, msgs.map((m) => m.id), me.current);
    })();
    return () => {
      alive = false;
    };
  }, [enabled, ready, current]); // eslint-disable-line react-hooks/exhaustive-deps

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
    send: async (text) => {
      const thread = threadOf.current.get(current);
      if (!thread) return;
      const { data, error } = await sb()
        .from('messages')
        .insert({ dm_id: thread, body: text })
        .select('id, dm_id, user_id, parent_id, body, created_at')
        .single();
      if (error) {
        toast('Message not sent. Check your connection and try again');
        return;
      }
      await addRow(data as Row);
    },
    invite: (email, opts) => inviteByEmail(ws.current, me.current, email, opts),
  };
}
