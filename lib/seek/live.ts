'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { backendOn, currentAccount, DB_SCHEMA, sb, sendInvite } from './backend';
import { PEOPLE, type ChatMessage, type FeedItem, type FileRef, type MessageCard, type PersonKey } from './data';
import { initialsOf, channelId as toChannelName, isEmail } from './format';
import { hydrateReactions, markNotSent, markRead, unreadCounts } from './liveSync';
import { mentionIds } from './liveNotes';
import { useSeek } from './store';

/**
 * Real team chat for the Channels screen (backend mode only). Channels and messages come from Supabase, new
 * messages arrive live, and everything is written into the same app state the demo uses, so the existing feed,
 * thread pane and composer render it unchanged. You are always person 'AH'; teammates are keyed by user id.
 */

type Row = { id: number; channel_id: string; user_id: string; parent_id: number | null; body: string; created_at: string; files?: FileRef[]; pinned_at?: string | null; edited_at?: string | null; card?: MessageCard | null };
type ChannelRow = { id: string; name: string; description: string; private?: boolean; created_by?: string | null };

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

// Names and photos of people you've seen, remembered on this device so saved chats show who wrote what at once
// (they're refreshed from the server once per visit).
const PEOPLE_KEY = 'seek:people';
type KnownPerson = { name: string; email: string; photo?: string };
function knownPeople(): Record<string, KnownPerson> {
  try {
    return JSON.parse(localStorage.getItem(PEOPLE_KEY) || '{}') as Record<string, KnownPerson>;
  } catch {
    return {};
  }
}
if (typeof window !== 'undefined')
  for (const [id, p] of Object.entries(knownPeople()))
    if (!PEOPLE[id]) PEOPLE[id] = { name: p.name, color: colorFor(id), role: p.email, initials: initialsOf(p.name), photo: p.photo };

/** Makes sure these people have a name, colour and initials before their messages render (shared by every screen). */
export async function learnProfiles(ids: string[], me: string | null) {
  const missing = [...new Set(ids)].filter((id) => !learned.has(id));
  if (!missing.length) return;
  const { data } = await sb().from('profiles').select('id, name, email, avatar_url').in('id', missing);
  const known = knownPeople();
  for (const p of (data ?? []) as { id: string; name: string; email: string; avatar_url: string | null }[]) {
    const name = displayName(p.name, p.email);
    const key = keyFor(p.id, me);
    PEOPLE[key] = { name, color: key === 'AH' ? PEOPLE.AH?.color ?? colorFor(p.id) : colorFor(p.id), role: key === 'AH' ? 'You' : p.email, initials: initialsOf(name), photo: key === 'AH' ? PEOPLE.AH?.photo : (p.avatar_url ?? undefined) };
    if (key !== 'AH') known[p.id] = { name, email: p.email, photo: p.avatar_url ?? undefined };
    learned.add(p.id);
  }
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(known));
  } catch {}
}

/** Saves an invite and emails the person a "Join" link (see sendInvite). Returns a message to show. */
export async function inviteByEmail(
  workspaceId: string | null,
  me: string | null,
  raw: string,
  opts: { role?: 'member' | 'admin'; channels?: string[] } = {},
): Promise<string> {
  const email = raw.trim().toLowerCase();
  if (!isEmail(email)) return 'Enter a valid email';
  if (!workspaceId || !me) return 'Still loading your workspace. Try again in a moment';
  return (await sendInvite(workspaceId, email, opts)).message;
}

export type ChannelInfo = { id: string; name: string; private: boolean; createdBy: string | null };

export type LiveChat = {
  ready: boolean;
  /** everyone in the workspace, for @mentions and the header */
  people: PersonKey[];
  /** you're an owner or admin (see every channel, manage people) */
  admin: boolean;
  /** your user id */
  me: string | null;
  /** the channels you can see, by name */
  channels: Map<string, ChannelInfo>;
  send: (channel: string, text: string) => Promise<void>;
  reply: (channel: string, rootUiId: number, text: string, alsoToChannel: boolean) => Promise<void>;
  createChannel: (name: string, opts?: { private?: boolean; members?: string[]; description?: string }) => Promise<string | null>;
  invite: (email: string, opts?: { role?: 'member' | 'admin'; channels?: string[] }) => Promise<string>;
  /** people in a private channel (user ids) */
  members: (channel: string) => Promise<string[]>;
  addMember: (channel: string, userId: string) => Promise<string | null>;
  removeMember: (channel: string, userId: string) => Promise<string | null>;
  /** your notification level for a channel */
  setLevel: (channel: string, level: 'normal' | 'all' | 'digest' | 'mute') => Promise<string | null>;
};

export function useLiveChat(): LiveChat | null {
  const { s, update, toast } = useSeek();
  const enabled = backendOn && s.session === 'in';
  const [ready, setReady] = useState(false);
  const [people, setPeople] = useState<PersonKey[]>([]);
  const [admin, setAdmin] = useState(false);
  const [info, setInfo] = useState(new Map<string, ChannelInfo>());
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
        const m: ChatMessage = { kind: 'msg', id: toUiId(r.id), who: keyOf(r.user_id), time: timeLabel(r.created_at), text: r.body, files: r.files?.length ? r.files : undefined, pinned: !!r.pinned_at, edited: !!r.edited_at, card: r.card ?? undefined };
        roots.push(m);
        byId.set(r.id, m);
      }
    }
    for (const r of rows) {
      if (r.parent_id == null) continue;
      const root = byId.get(r.parent_id);
      // dbId lets a deleted reply disappear live
      const reply = { who: keyOf(r.user_id), time: timeLabel(r.created_at), text: r.body, dbId: r.id };
      if (root) (root.thread ||= []).push(reply);
    }
    return roots;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Adds one message (from sending or from the live feed) unless it is already there. */
  const addRow = useCallback(
    (r: Row) => {
      const name = [...chans.current].find(([, id]) => id === r.channel_id)?.[0];
      if (!name) return;
      if (name === currentRef.current) markRead('ch:' + r.channel_id);
      update((d) => {
        const w = d.workspaces.C;
        if (name !== w.ch) {
          if (r.user_id !== meRef.current && r.parent_id == null) {
            const c = w.channels.find((x) => x.id === name);
            if (c) c.unread = (c.unread || 0) + 1;
          }
          return;
        }
        const list = (w.msgs[name] ||= []);
        if (r.parent_id == null) {
          if (list.some((m) => m.id === toUiId(r.id))) return;
          list.push({ kind: 'msg', id: toUiId(r.id), who: keyOf(r.user_id), time: timeLabel(r.created_at), text: r.body, files: r.files?.length ? r.files : undefined, flash: r.user_id === meRef.current });
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

  /** (Re)loads the channels you can see, with unread counts saved on the server. */
  const loadChannels = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws) return;
    const [{ data: channels }, counts, { data: prefs }] = await Promise.all([
      sb().from('channels').select('id, name, description, private, created_by').eq('workspace_id', ws).order('created_at'),
      unreadCounts(ws).catch(() => new Map<string, number>()),
      sb().from('channel_prefs').select('channel_id, level, muted_until'),
    ]);
    // your notification level per channel: Digest or Muted show as a tag
    const tierOf = new Map(
      ((prefs ?? []) as { channel_id: string; level: string; muted_until: string | null }[])
        .filter((p) => p.level !== 'mute' || !p.muted_until || new Date(p.muted_until) > new Date())
        .map((p) => [p.channel_id, p.level === 'digest' ? 'Digest' : p.level === 'mute' ? 'Muted' : p.level === 'all' ? 'Everything' : undefined]),
    );
    const list = (channels ?? []) as ChannelRow[];
    chans.current = new Map(list.map((c) => [c.name, c.id]));
    setInfo(new Map(list.map((c) => [c.name, { id: c.id, name: c.name, private: !!c.private, createdBy: c.created_by ?? null }])));
    update((d) => {
      const w = d.workspaces.C;
      w.channels = list.map((c) => ({ id: c.name, cid: c.id, unread: c.name === w.ch ? 0 : counts.get('ch:' + c.id) ?? 0, desc: c.description, private: !!c.private, tier: tierOf.get(c.id) }));
      for (const k of Object.keys(w.msgs)) if (!chans.current.has(k)) delete w.msgs[k];
      if (!chans.current.has(w.ch)) w.ch = chans.current.has('general') ? 'general' : list[0]?.name ?? 'general';
    });
  }, [update]);

  // ---- start: who am I, which workspace, its people and channels; then listen for changes
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
      setAdmin(['owner', 'admin'].includes(acc.workspace.role));
      const ws = acc.workspace.id;
      update((d) => {
        d.wsId = 'C';
        d.ws.name = acc.workspace!.name;
        d.ws.logo = acc.workspace!.logo ?? undefined;
      });

      const [{ data: members }] = await Promise.all([sb().from('workspace_members').select('user_id, role').eq('workspace_id', ws), loadChannels()]);
      if (!alive) return;
      setReady(true);

      live = sb()
        .channel('seek:' + ws)
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'messages', filter: `workspace_id=eq.${ws}` }, async (p) => {
          const r = p.new as Row;
          if (!r.channel_id) return;
          await learnPeople([r.user_id]);
          addRow(r);
        })
        // new channels you can see, and private channels you're added to or removed from
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'channels', filter: `workspace_id=eq.${ws}` }, () => void loadChannels())
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'channel_members', filter: `user_id=eq.${acc.id}` }, () => void loadChannels())
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'workspace_members', filter: `workspace_id=eq.${ws}` }, async (p) => {
          const m = p.new as { user_id: string; role: string };
          if (m.role === 'guest') return;
          await learnPeople([m.user_id]);
          setPeople((xs) => (xs.includes(keyOf(m.user_id)) ? xs : [...xs, keyOf(m.user_id)]));
        })
        .subscribe();

      const ids = ((members ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'guest').map((m) => m.user_id);
      await learnPeople(ids);
      if (!alive) return;
      setPeople((xs) => [...new Set([...ids.map(keyOf), ...xs])]);
    })();
    return () => {
      alive = false;
      if (live) sb().removeChannel(live);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the open channel's messages (latest 300, oldest first), its reactions, and mark it read
  useEffect(() => {
    if (!enabled || !ready) return;
    const id = chans.current.get(current);
    if (!id) return;
    markRead('ch:' + id);
    let alive = true;
    (async () => {
      const { data, error } = await sb()
        .from('messages')
        .select('id, channel_id, user_id, parent_id, body, created_at, files, pinned_at, edited_at, card')
        .eq('channel_id', id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!alive) return;
      if (error) {
        toast('Couldn’t load messages. Check your connection');
        return;
      }
      const rows = ((data ?? []) as Row[]).reverse();
      const feed = toFeed(rows);
      update((d) => {
        d.workspaces.C.msgs[current] = feed;
        const c = d.workspaces.C.channels.find((x) => x.id === current);
        if (c) c.unread = 0;
      });
      // names and reactions load together, after the messages are on screen
      await Promise.all([learnPeople(rows.map((r) => r.user_id)), hydrateReactions(update, feed.map((m) => m.id), meRef.current)]);
      if (alive) update(() => {});
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
      .insert({ channel_id, body, parent_id: parent, mentions: mentionIds(body, people.filter((k) => k !== 'AH')) })
      .select('id, channel_id, user_id, parent_id, body, created_at, files, pinned_at, edited_at, card')
      .single();
    if (error) {
      if (parent == null) {
        const name = channel;
        markNotSent(update, (d) => (d.workspaces.C.msgs[name] ||= []), body, () => insert(channel, body, null));
      } else toast('Reply not sent. Check your connection and try again');
      return;
    }
    addRow(data as Row);
  };

  const idOf = (channel: string) => chans.current.get(channel) ?? null;

  if (!enabled) return null;
  return {
    ready,
    people,
    admin,
    me: meRef.current,
    channels: info,
    send: (channel, text) => insert(channel, text, null),
    reply: async (channel, rootUiId, text, also) => {
      const parent = toDbId(rootUiId);
      if (parent == null) return;
      await insert(channel, text, parent);
      if (also) await insert(channel, text, null);
    },
    createChannel: async (raw, opts = {}) => {
      const name = toChannelName(raw);
      if (!name) return 'Use letters, numbers and dashes';
      if (chans.current.has(name)) return '#' + name + ' already exists';
      const { data, error } = await sb()
        .from('channels')
        .insert({ workspace_id: wsRef.current, name, created_by: meRef.current, private: !!opts.private, description: opts.description?.trim() ?? '' })
        .select('id, name, description, private, created_by')
        .single();
      if (error) return error.code === '23505' ? '#' + name + ' already exists' : 'Couldn’t create the channel';
      const c = data as ChannelRow;
      if (opts.private && opts.members?.length) {
        await sb()
          .from('channel_members')
          .insert(opts.members.filter((u) => u !== meRef.current).map((u) => ({ channel_id: c.id, user_id: u, added_by: meRef.current })));
      }
      await loadChannels();
      update((d) => {
        d.workspaces.C.ch = c.name;
      });
      return null;
    },
    invite: (raw, opts) => inviteByEmail(wsRef.current, meRef.current, raw, opts),
    members: async (channel) => {
      const id = idOf(channel);
      if (!id) return [];
      const { data } = await sb().from('channel_members').select('user_id').eq('channel_id', id);
      const ids = ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
      await learnPeople(ids);
      return ids;
    },
    addMember: async (channel, userId) => {
      const id = idOf(channel);
      if (!id) return 'Channel not found';
      const { error } = await sb().from('channel_members').insert({ channel_id: id, user_id: userId, added_by: meRef.current });
      return error && error.code !== '23505' ? 'Only admins, the channel’s creator and its members can add people' : null;
    },
    setLevel: async (channel, level) => {
      const id = idOf(channel);
      if (!id) return 'Channel not found';
      const { error } = await sb().from('channel_prefs').upsert({ channel_id: id, level, muted_until: null }, { onConflict: 'user_id,channel_id' });
      if (error) return 'Couldn’t save that. Try again';
      update((d) => {
        const c = d.workspaces.C.channels.find((x) => x.id === channel);
        if (c) c.tier = level === 'digest' ? 'Digest' : level === 'mute' ? 'Muted' : level === 'all' ? 'Everything' : undefined;
      });
      return null;
    },
    removeMember: async (channel, userId) => {
      const id = idOf(channel);
      if (!id) return 'Channel not found';
      const { error } = await sb().from('channel_members').delete().eq('channel_id', id).eq('user_id', userId);
      if (!error && userId === meRef.current) await loadChannels();
      return error ? 'Only admins and the channel’s creator can remove people' : null;
    },
  };
}
