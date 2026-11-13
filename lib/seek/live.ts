'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { backendOn, currentAccount, DB_SCHEMA, quickAccount, sb, sendInvite } from './backend';
import { PEOPLE, type ChatMessage, type FeedItem, type FileRef, type MessageCard, type PersonKey } from './data';
import { initialsOf, channelId as toChannelName, isEmail } from './format';
import { hydrateReactions, markNotSent, markRead, unreadCounts } from './liveSync';
import { mentionIds } from './liveNotes';
import { useSeek } from './store';
import { onLiveStatus, useResync } from './resync';

/**
 * Real team chat for the Channels screen (backend mode only). Channels and messages come from Supabase, new
 * messages arrive live, and everything is written into the same app state the demo uses, so the existing feed,
 * thread pane and composer render it unchanged. You are always person 'AH'; teammates are keyed by user id.
 */

type Row = { id: number; channel_id: string; user_id: string | null; agent?: string | null; parent_id: number | null; body: string; created_at: string; files?: FileRef[]; pinned_at?: string | null; edited_at?: string | null; card?: MessageCard | null };
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
// the AI assistant (an agent, not a person) shows as "Seek assistant" in real workspaces
if (backendOn) PEOPLE.AI = { name: 'Seek assistant', color: '#5a48c0', role: 'AI assistant', initials: 'AI' };

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
  const missing = [...new Set(ids)].filter((id) => id && !learned.has(id));
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

export type ChannelInfo = { id: string; name: string; private: boolean; createdBy: string | null; description?: string; joined: boolean; assistant?: boolean };

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
  /** people in a channel (user ids) */
  members: (channel: string) => Promise<string[]>;
  /** join a public channel (it appears in your sidebar and opens) */
  join: (channel: string) => Promise<string | null>;
  /** leave a channel (not #general) */
  leave: (channel: string) => Promise<string | null>;
  /** delete a channel and its messages (admins; not #general) */
  deleteChannel: (channel: string) => Promise<string | null>;
  /** add or remove the AI assistant (admins and the channel's creator) */
  setAssistant: (channel: string, on: boolean) => Promise<string | null>;
  addMember: (channel: string, userId: string) => Promise<string | null>;
  removeMember: (channel: string, userId: string) => Promise<string | null>;
  /** your notification level for a channel */
  setLevel: (channel: string, level: 'normal' | 'all' | 'digest' | 'mute') => Promise<string | null>;
};

export function useLiveChat(): LiveChat | null {
  const { s, update, toast } = useSeek();
  const enabled = backendOn && s.session === 'in';
  const [ready, setReady] = useState(false);
  const sync = useResync();
  const [people, setPeople] = useState<PersonKey[]>([]);
  const [admin, setAdmin] = useState(false);
  const [info, setInfo] = useState(new Map<string, ChannelInfo>());
  // start from what this device saved last time (who you are, your channels), so the open channel loads at once
  const meRef = useRef<string | null>(s.meId ?? null);
  const wsRef = useRef<string | null>(s.orgId ?? null);
  const chans = useRef(new Map<string, string>(s.workspaces.C.channels.filter((c) => c.cid).map((c) => [c.id, c.cid!]))); // channel name → id
  const loadedFor = useRef('');
  const allChans = useRef(new Map<string, string>()); // every channel you can see (joined or not), name → id
  const agentChans = useRef(new Set<string>()); // channel ids that have the AI assistant
  const syncSeen = useRef(0);
  const current = s.workspaces.C.ch;
  const currentRef = useRef(current);
  currentRef.current = current;

  const keyOf = (userId: string): PersonKey => keyFor(userId, meRef.current);
  const learnPeople = useCallback((ids: string[]) => learnProfiles(ids, meRef.current), []);

  const whoOf = (r: { user_id: string | null; agent?: string | null }): PersonKey => (r.agent || !r.user_id ? 'AI' : keyOf(r.user_id));

  const toFeed = useCallback((rows: Row[]): FeedItem[] => {
    const roots: ChatMessage[] = [];
    const byId = new Map<number, ChatMessage>();
    for (const r of rows) {
      if (r.parent_id == null) {
        const m: ChatMessage = { kind: 'msg', id: toUiId(r.id), who: whoOf(r), ai: !!r.agent || undefined, time: timeLabel(r.created_at), at: r.created_at, text: r.body, files: r.files?.length ? r.files : undefined, pinned: !!r.pinned_at, edited: !!r.edited_at, card: r.card ?? undefined };
        roots.push(m);
        byId.set(r.id, m);
      }
    }
    for (const r of rows) {
      if (r.parent_id == null) continue;
      const root = byId.get(r.parent_id);
      // dbId lets a deleted reply disappear live
      const reply = { who: whoOf(r), time: timeLabel(r.created_at), text: r.body, dbId: r.id };
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
          list.push({ kind: 'msg', id: toUiId(r.id), who: whoOf(r), ai: !!r.agent || undefined, time: timeLabel(r.created_at), at: r.created_at, text: r.body, files: r.files?.length ? r.files : undefined, flash: r.user_id === meRef.current });
        } else {
          const root = list.find((m): m is ChatMessage => m.kind === 'msg' && m.id === toUiId(r.parent_id!));
          if (!root) return;
          const reply = { who: whoOf(r), time: timeLabel(r.created_at), text: r.body, dbId: r.id };
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
    const [{ data: channels }, counts, { data: prefs }, { data: mine }, { data: agents }] = await Promise.all([
      sb().from('channels').select('id, name, description, private, created_by').eq('workspace_id', ws).order('created_at'),
      unreadCounts(ws).catch(() => new Map<string, number>()),
      sb().from('channel_prefs').select('channel_id, level, muted_until'),
      sb().from('channel_members').select('channel_id').eq('user_id', meRef.current ?? ''),
      sb().from('channel_agents').select('channel_id'),
    ]);
    agentChans.current = new Set(((agents ?? []) as { channel_id: string }[]).map((a) => a.channel_id));
    // your channels are the ones you're a member of; the rest of the public ones are under Browse channels
    const joined = new Set(((mine ?? []) as { channel_id: string }[]).map((m) => m.channel_id));
    // your notification level per channel: Digest or Muted show as a tag
    const tierOf = new Map(
      ((prefs ?? []) as { channel_id: string; level: string; muted_until: string | null }[])
        .filter((p) => p.level !== 'mute' || !p.muted_until || new Date(p.muted_until) > new Date())
        .map((p) => [p.channel_id, p.level === 'digest' ? 'Digest' : p.level === 'mute' ? 'Muted' : p.level === 'all' ? 'Everything' : undefined]),
    );
    const all = (channels ?? []) as ChannelRow[];
    const list = all.filter((c) => joined.has(c.id));
    chans.current = new Map(list.map((c) => [c.name, c.id]));
    allChans.current = new Map(all.map((c) => [c.name, c.id]));
    setInfo(new Map(all.map((c) => [c.name, { id: c.id, name: c.name, private: !!c.private, createdBy: c.created_by ?? null, description: c.description, joined: joined.has(c.id), assistant: agentChans.current.has(c.id) }])));
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
      // the last-known account (no network) when there is one; it's refreshed in the background at start-up
      const acc = (await quickAccount()) ?? (await currentAccount());
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
          if (r.user_id) await learnPeople([r.user_id]);
          addRow(r);
        })
        // new channels you can see, and private channels you're added to or removed from
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'channels', filter: `workspace_id=eq.${ws}` }, () => void loadChannels())
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'channel_members', filter: `user_id=eq.${acc.id}` }, () => void loadChannels())
        // a channel deleted, or someone removed from one (deletes can't be filtered, so any of them reloads the list)
        .on('postgres_changes', { event: 'DELETE', schema: DB_SCHEMA, table: 'channels' }, () => void loadChannels())
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'channel_agents' }, () => void loadChannels())
        .on('postgres_changes', { event: 'DELETE', schema: DB_SCHEMA, table: 'channel_members' }, () => void loadChannels())
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'workspace_members', filter: `workspace_id=eq.${ws}` }, async (p) => {
          const m = p.new as { user_id: string; role: string };
          if (m.role === 'guest') return;
          await learnPeople([m.user_id]);
          setPeople((xs) => (xs.includes(keyOf(m.user_id)) ? xs : [...xs, keyOf(m.user_id)]));
        })
        .subscribe(onLiveStatus());

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
    if (!enabled) return;
    const id = chans.current.get(current);
    if (!id) return;
    // catching up reloads the open channel even if it was loaded already
    if (syncSeen.current !== sync) {
      syncSeen.current = sync;
      loadedFor.current = '';
    }
    // loaded as soon as we know the channel (from this device's saved list); not again when the list refreshes
    if (loadedFor.current === id) return;
    loadedFor.current = id;
    markRead('ch:' + id);
    let alive = true;
    let done = false;
    (async () => {
      const { data, error } = await sb()
        .from('messages')
        .select('id, channel_id, user_id, agent, parent_id, body, created_at, files, pinned_at, edited_at, card')
        .eq('channel_id', id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!alive) return;
      if (error) {
        loadedFor.current = '';
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
      done = true;
      // names and reactions load together, after the messages are on screen
      await Promise.all([learnPeople(rows.map((r) => r.user_id).filter((x): x is string => !!x)), hydrateReactions(update, feed.map((m) => m.id), meRef.current)]);
      if (alive) update(() => {});
    })();
    return () => {
      alive = false;
      // a finished load stays loaded; an unfinished one is tried again
      if (!done && loadedFor.current === id) loadedFor.current = '';
    };
  }, [enabled, ready, current, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // catching up (back to the tab, back online, reconnected): reload the open channel and the unread counts
  useEffect(() => {
    if (!enabled || !sync) return;
    void loadChannels();
  }, [sync]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = async (channel: string, body: string, parent: number | null) => {
    const channel_id = chans.current.get(channel);
    if (!channel_id) return;
    const { data, error } = await sb()
      .from('messages')
      .insert({ channel_id, body, parent_id: parent, mentions: mentionIds(body, people.filter((k) => k !== 'AH')) })
      .select('id, channel_id, user_id, agent, parent_id, body, created_at, files, pinned_at, edited_at, card')
      .single();
    if (error) {
      if (parent == null) {
        const name = channel;
        markNotSent(update, (d) => (d.workspaces.C.msgs[name] ||= []), body, () => insert(channel, body, null));
      } else toast('Reply not sent. Check your connection and try again');
      return;
    }
    addRow(data as Row);
    if (parent == null && agentChans.current.has(channel_id))
      void sb()
        .functions.invoke('seek-ai', { body: { action: 'away', message_id: (data as Row).id } })
        .then(() => {});
  };

  const idOf = (channel: string) => chans.current.get(channel) ?? allChans.current.get(channel) ?? null;

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
      // private: the people you picked; public: the whole team (anyone can leave it later)
      const add = opts.private ? (opts.members ?? []) : people.filter((k) => k !== 'AH');
      const others = [...new Set(add)].filter((u) => u !== meRef.current);
      if (others.length) await sb().from('channel_members').insert(others.map((u) => ({ channel_id: c.id, user_id: u, added_by: meRef.current })));
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
      const { data, error } = await sb().from('channel_members').delete().eq('channel_id', id).eq('user_id', userId).select('user_id');
      if (error) return /general/i.test(error.message) ? 'Everyone on the team is in #general' : 'Couldn’t remove them. Try again';
      if (!data?.length) return 'Only admins and the channel’s creator can remove people';
      if (userId === meRef.current) await loadChannels();
      return null;
    },
    join: async (channel) => {
      const id = idOf(channel);
      if (!id || !meRef.current) return 'Channel not found';
      const { error } = await sb().from('channel_members').insert({ channel_id: id, user_id: meRef.current, added_by: meRef.current });
      if (error && error.code !== '23505') return 'Couldn’t join #' + channel + '. Private channels need someone in them to add you';
      await loadChannels();
      update((d) => {
        d.workspaces.C.ch = channel;
      });
      return null;
    },
    leave: async (channel) => {
      const id = idOf(channel);
      if (!id || !meRef.current) return 'Channel not found';
      if (channel === 'general') return 'Everyone on the team is in #general';
      const { error } = await sb().from('channel_members').delete().eq('channel_id', id).eq('user_id', meRef.current);
      if (error) return /general/i.test(error.message) ? 'Everyone on the team is in #general' : 'Couldn’t leave. Try again';
      await loadChannels();
      return null;
    },
    setAssistant: async (channel, on) => {
      const id = idOf(channel);
      if (!id) return 'Channel not found';
      const q = on
        ? sb().from('channel_agents').insert({ channel_id: id, agent: 'away_assistant', added_by: meRef.current }).select('channel_id')
        : sb().from('channel_agents').delete().eq('channel_id', id).eq('agent', 'away_assistant').select('channel_id');
      const { data, error } = await q;
      if ((error && error.code !== '23505') || (!error && !data?.length && !on)) return 'Only admins and the channel’s creator can change the assistant';
      await loadChannels();
      return null;
    },
    deleteChannel: async (channel) => {
      const id = idOf(channel);
      if (!id) return 'Channel not found';
      if (channel === 'general') return '#general can’t be deleted';
      const { data, error } = await sb().from('channels').delete().eq('id', id).select('id');
      if (error) return /general/i.test(error.message) ? '#general can’t be deleted' : 'Couldn’t delete the channel. Try again';
      if (!data?.length) return 'Only admins can delete channels';
      await loadChannels();
      return null;
    },
  };
}
