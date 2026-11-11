'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { backendOn, currentAccount, DB_SCHEMA, sb, sendInvite } from './backend';
import { PEOPLE, type ChatMessage, type FeedItem, type PersonKey } from './data';
import { initialsOf, channelId as toChannelName, isEmail } from './format';
import { useSeek } from './store';

/**
 * Real team chat for the Channels screen (backend mode only). Channels and messages come from Supabase, new
 * messages arrive live, and everything is written into the same app state the demo uses, so the existing feed,
 * thread pane and composer render it unchanged. You are always person 'AH'; teammates are keyed by user id.
 */

type Row = { id: number; channel_id: string; user_id: string; parent_id: number | null; body: string; created_at: string };
type ChannelRow = { id: string; name: string; description: string };

/** Database ids are offset so they never collide with ids the app hands out locally (decision cards, etc.). */
const OFFSET = 1_000_000_000;
export const toUiId = (dbId: number) => OFFSET + dbId;
export const toDbId = (uiId: number) => (uiId > OFFSET ? uiId - OFFSET : null);

const COLORS = ['#6d4fc2', '#b4531f', '#b0306a', '#1f6b8a', '#8a5300', '#2f7a4f', '#4b154a', '#a03a3a'];
export const colorFor = (id: string) => COLORS[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
export { initialsOf };
export const displayName = (name: string, email: string) => name.trim() || email.split('@')[0] || 'Someone';

export function timeLabel(iso: string) {
  const d = new Date(iso);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm;
}

/** You are always person 'AH'; everyone else is keyed by their user id. */
export const keyFor = (userId: string, me: string | null): PersonKey => (userId === me ? 'AH' : userId);

const learned = new Set<string>();
/** Makes sure these people have a name, colour and initials before their messages render (shared by every screen). */
export async function learnProfiles(ids: string[], me: string | null) {
  const missing = [...new Set(ids)].filter((id) => !learned.has(id));
  if (!missing.length) return;
  const { data } = await sb().from('profiles').select('id, name, email').in('id', missing);
  for (const p of (data ?? []) as { id: string; name: string; email: string }[]) {
    const name = displayName(p.name, p.email);
    const key = keyFor(p.id, me);
    PEOPLE[key] = { name, color: key === 'AH' ? PEOPLE.AH?.color ?? colorFor(p.id) : colorFor(p.id), role: key === 'AH' ? 'You' : p.email, initials: initialsOf(name) };
    learned.add(p.id);
  }
}

/** Saves an invite and emails the person a "Join" link (see sendInvite). Returns a message to show. */
export async function inviteByEmail(workspaceId: string | null, me: string | null, raw: string): Promise<string> {
  const email = raw.trim().toLowerCase();
  if (!isEmail(email)) return 'Enter a valid email';
  if (!workspaceId || !me) return 'Still loading your workspace. Try again in a moment';
  return (await sendInvite(workspaceId, email)).message;
}

export type LiveChat = {
  ready: boolean;
  /** everyone in the workspace, for @mentions and the header */
  people: PersonKey[];
  send: (channel: string, text: string) => Promise<void>;
  reply: (channel: string, rootUiId: number, text: string, alsoToChannel: boolean) => Promise<void>;
  createChannel: (name: string) => Promise<string | null>;
  invite: (email: string) => Promise<string>;
};

export function useLiveChat(): LiveChat | null {
  const { s, update, toast } = useSeek();
  const enabled = backendOn && s.session === 'in';
  const [ready, setReady] = useState(false);
  const [people, setPeople] = useState<PersonKey[]>([]);
  const meRef = useRef<string | null>(null);
  const wsRef = useRef<string | null>(null);
  const chans = useRef(new Map<string, string>()); // channel name → id
  const current = s.workspaces.C.ch;
  const currentRef = useRef(current);
  currentRef.current = current;

  const keyOf = (userId: string): PersonKey => keyFor(userId, meRef.current);
  const learnPeople = useCallback((ids: string[]) => learnProfiles(ids, meRef.current), []);

  const toFeed = useCallback((rows: Row[]): FeedItem[] => {
    const roots: ChatMessage[] = [];
    const byId = new Map<number, ChatMessage>();
    for (const r of rows) {
      if (r.parent_id == null) {
        const m: ChatMessage = { kind: 'msg', id: toUiId(r.id), who: keyOf(r.user_id), time: timeLabel(r.created_at), text: r.body };
        roots.push(m);
        byId.set(r.id, m);
      }
    }
    for (const r of rows) {
      if (r.parent_id == null) continue;
      const root = byId.get(r.parent_id);
      if (root) (root.thread ||= []).push({ who: keyOf(r.user_id), time: timeLabel(r.created_at), text: r.body });
    }
    return roots;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Adds one message (from sending or from the live feed) unless it is already there. */
  const addRow = useCallback(
    (r: Row) => {
      const name = [...chans.current].find(([, id]) => id === r.channel_id)?.[0];
      if (!name) return;
      update((d) => {
        const w = d.workspaces.C;
        if (name !== w.ch) {
          if (r.user_id !== meRef.current) {
            const c = w.channels.find((x) => x.id === name);
            if (c) c.unread = (c.unread || 0) + 1;
          }
          return;
        }
        const list = (w.msgs[name] ||= []);
        if (r.parent_id == null) {
          if (list.some((m) => m.id === toUiId(r.id))) return;
          list.push({ kind: 'msg', id: toUiId(r.id), who: keyOf(r.user_id), time: timeLabel(r.created_at), text: r.body, flash: r.user_id === meRef.current });
        } else {
          const root = list.find((m): m is ChatMessage => m.kind === 'msg' && m.id === toUiId(r.parent_id!));
          if (!root) return;
          const reply = { who: keyOf(r.user_id), time: timeLabel(r.created_at), text: r.body, dbId: r.id };
          root.thread ||= [];
          if (root.thread.some((x) => (x as { dbId?: number }).dbId === r.id)) return;
          root.thread.push(reply);
        }
      });
    },
    [update], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- start: who am I, which workspace, its people and channels; then listen for new messages
  useEffect(() => {
    if (!enabled) return;
    let live: RealtimeChannel | null = null;
    let alive = true;
    (async () => {
      // the account is loaded once at start-up and shared, so this is usually instant
      const acc = await currentAccount();
      if (!alive || !acc?.workspace) return;
      meRef.current = acc.id;
      wsRef.current = acc.workspace.id;
      const ws = acc.workspace.id;

      const [{ data: members }, { data: channels }] = await Promise.all([
        sb().from('workspace_members').select('user_id').eq('workspace_id', ws),
        sb().from('channels').select('id, name, description').eq('workspace_id', ws).order('created_at'),
      ]);
      if (!alive) return;

      // show the channel list straight away; names and faces fill in as they load
      const list = (channels ?? []) as ChannelRow[];
      chans.current = new Map(list.map((c) => [c.name, c.id]));
      update((d) => {
        d.wsId = 'C';
        d.ws.name = acc.workspace!.name;
        d.ws.logo = acc.workspace!.logo ?? undefined;
        const w = d.workspaces.C;
        w.channels = list.map((c) => ({ id: c.name, unread: w.channels.find((x) => x.id === c.name)?.unread ?? 0, desc: c.description }));
        for (const k of Object.keys(w.msgs)) if (!chans.current.has(k)) delete w.msgs[k];
        if (!chans.current.has(w.ch)) w.ch = chans.current.has('general') ? 'general' : list[0]?.name ?? 'general';
      });
      setReady(true);

      live = sb()
        .channel('seek:' + ws)
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'messages', filter: `workspace_id=eq.${ws}` }, async (p) => {
          const r = p.new as Row;
          await learnPeople([r.user_id]);
          addRow(r);
        })
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'channels', filter: `workspace_id=eq.${ws}` }, (p) => {
          const c = p.new as ChannelRow;
          chans.current.set(c.name, c.id);
          update((d) => {
            const w = d.workspaces.C;
            if (!w.channels.some((x) => x.id === c.name)) w.channels.push({ id: c.name, unread: 0, desc: c.description });
          });
        })
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'workspace_members', filter: `workspace_id=eq.${ws}` }, async (p) => {
          const id = (p.new as { user_id: string }).user_id;
          await learnPeople([id]);
          setPeople((xs) => (xs.includes(keyOf(id)) ? xs : [...xs, keyOf(id)]));
        })
        .subscribe();

      const ids = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
      await learnPeople(ids);
      if (!alive) return;
      setPeople((xs) => [...new Set([...ids.map(keyOf), ...xs])]);
    })();
    return () => {
      alive = false;
      if (live) sb().removeChannel(live);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the open channel's messages (latest 300, oldest first)
  useEffect(() => {
    if (!enabled || !ready) return;
    const id = chans.current.get(current);
    if (!id) return;
    let alive = true;
    (async () => {
      const { data, error } = await sb()
        .from('messages')
        .select('id, channel_id, user_id, parent_id, body, created_at')
        .eq('channel_id', id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!alive) return;
      if (error) {
        toast('Couldn’t load messages. Check your connection');
        return;
      }
      const rows = ((data ?? []) as Row[]).reverse();
      await learnPeople(rows.map((r) => r.user_id));
      if (!alive) return;
      update((d) => {
        d.workspaces.C.msgs[current] = toFeed(rows);
      });
    })();
    return () => {
      alive = false;
    };
  }, [enabled, ready, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = async (channel: string, body: string, parent: number | null) => {
    const channel_id = chans.current.get(channel);
    if (!channel_id) return;
    const { data, error } = await sb()
      .from('messages')
      .insert({ channel_id, body, parent_id: parent })
      .select('id, channel_id, user_id, parent_id, body, created_at')
      .single();
    if (error) {
      toast('Message not sent. Check your connection and try again');
      return;
    }
    addRow(data as Row);
  };

  if (!enabled) return null;
  return {
    ready,
    people,
    send: (channel, text) => insert(channel, text, null),
    reply: async (channel, rootUiId, text, also) => {
      const parent = toDbId(rootUiId);
      if (parent == null) return;
      await insert(channel, text, parent);
      if (also) await insert(channel, text, null);
    },
    createChannel: async (raw) => {
      const name = toChannelName(raw);
      if (!name) return 'Use letters, numbers and dashes';
      if (chans.current.has(name)) return '#' + name + ' already exists';
      const { data, error } = await sb()
        .from('channels')
        .insert({ workspace_id: wsRef.current, name, created_by: meRef.current })
        .select('id, name, description')
        .single();
      if (error) return 'Couldn’t create the channel';
      const c = data as ChannelRow;
      chans.current.set(c.name, c.id);
      update((d) => {
        const w = d.workspaces.C;
        if (!w.channels.some((x) => x.id === c.name)) w.channels.push({ id: c.name, unread: 0, desc: c.description });
        w.ch = c.name;
      });
      return null;
    },
    invite: (raw) => inviteByEmail(wsRef.current, meRef.current, raw),
  };
}
