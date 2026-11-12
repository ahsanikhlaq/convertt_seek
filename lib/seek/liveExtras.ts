'use client';

import { useEffect, useRef } from 'react';
import { backendOn, DB_SCHEMA, sb } from './backend';
import type { FileRef, LiveTask, PersonKey, State } from './data';
import type { FileTarget } from './liveFiles';
import { keyFor, toDbId } from './live';
import { ROUTES } from './routes';
import { useSeek } from './store';

/**
 * Pins, saved messages, tasks, reminders and channel canvases (backend mode). The database decides who can do
 * what (see migration 13); these are thin wrappers plus the hooks that keep saved items and tasks in app state.
 */

// ---------------------------------------------------------------- pins
export async function pinMessage(uiId: number, on: boolean) {
  const id = toDbId(uiId);
  if (id == null) return 'This message isn’t saved yet';
  const { error } = await sb().rpc('pin_message', { p_id: id, p_on: on });
  return error ? 'Couldn’t change the pin. Check your connection' : null;
}

export type PinnedMessage = { id: number; userId: string; body: string; at: string; pinnedAt: string; pinnedBy: string | null; files: FileRef[]; conv: string; lane: string | null };

/** A conversation: a channel, a DM (by the other person) or a client space (one lane, or both for the team). */
export type ConvTarget = { channel: string } | { dmWith: string } | { space: string; lane?: 'client' | 'team' };

/** The thread id of your DM with someone (started if needed). */
export async function dmThreadWith(other: string): Promise<string | null> {
  const { data, error } = await sb().rpc('open_dm', { p_other: other });
  return error || !data ? null : (data as string);
}

/** Pinned messages in a conversation, newest pin first. */
export async function pinsIn(t: ConvTarget): Promise<PinnedMessage[] | null> {
  let q = sb()
    .from('messages')
    .select('id, user_id, body, created_at, pinned_at, pinned_by, files, channel_id, dm_id, space_id, lane')
    .not('pinned_at', 'is', null);
  if ('channel' in t) q = q.eq('channel_id', t.channel);
  else if ('space' in t) {
    q = q.eq('space_id', t.space);
    if (t.lane) q = q.eq('lane', t.lane);
  } else {
    const thread = await dmThreadWith(t.dmWith);
    if (!thread) return null;
    q = q.eq('dm_id', thread);
  }
  const { data, error } = await q.order('pinned_at', { ascending: false }).limit(100);
  if (error) return null;
  type R = { id: number; user_id: string; body: string; created_at: string; pinned_at: string; pinned_by: string | null; files: FileRef[] | null; channel_id: string | null; dm_id: string | null; space_id: string | null; lane: string | null };
  return ((data ?? []) as R[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    body: r.body,
    at: r.created_at,
    pinnedAt: r.pinned_at,
    pinnedBy: r.pinned_by,
    files: r.files ?? [],
    conv: r.channel_id ? 'ch:' + r.channel_id : r.dm_id ? 'dm:' + r.dm_id : 'sp:' + r.space_id + ':' + r.lane,
    lane: r.lane,
  }));
}

// ---------------------------------------------------------------- saved
export async function saveMessage(uiId: number, on: boolean) {
  const id = toDbId(uiId);
  if (id == null) return 'This message isn’t saved yet';
  const { error } = on ? await sb().from('saved').insert({ message_id: id }) : await sb().from('saved').delete().eq('message_id', id);
  return error && !/duplicate/.test(error.message) ? 'Couldn’t update your saved items' : null;
}

export type SavedItem = { messageId: number; savedAt: string; userId: string; body: string; at: string; conv: string; place: string };

/** Where a message lives as 'ch:<id>', 'dm:<id>' or 'sp:<id>:<lane>', with a readable name. */
type MsgRow = {
  id: number;
  user_id: string;
  body: string;
  created_at: string;
  channel_id: string | null;
  dm_id: string | null;
  space_id: string | null;
  lane: string | null;
  channels: { name: string } | null;
  client_spaces: { name: string } | null;
};
const MSG = 'id, user_id, body, created_at, channel_id, dm_id, space_id, lane, channels ( name ), client_spaces ( name )';
const convOf = (m: MsgRow) => (m.channel_id ? 'ch:' + m.channel_id : m.dm_id ? 'dm:' + m.dm_id : 'sp:' + m.space_id + ':' + m.lane);
const placeOf = (m: MsgRow) =>
  m.channel_id ? '# ' + (m.channels?.name ?? 'channel') : m.dm_id ? 'Direct message' : (m.client_spaces?.name ?? 'Client') + (m.lane === 'team' ? ' · Team notes' : ' · Client chat');

export async function savedItems(): Promise<SavedItem[] | null> {
  const { data, error } = await sb().from('saved').select(`message_id, created_at, messages ( ${MSG} )`).order('created_at', { ascending: false }).limit(200);
  if (error) return null;
  type R = { message_id: number; created_at: string; messages: MsgRow | null };
  return ((data ?? []) as unknown as R[])
    .filter((r) => r.messages)
    .map((r) => ({ messageId: r.message_id, savedAt: r.created_at, userId: r.messages!.user_id, body: r.messages!.body, at: r.messages!.created_at, conv: convOf(r.messages!), place: placeOf(r.messages!) }));
}

/** Keeps the ids of your saved messages in app state (for "★ Saved" on messages). Mounted once, in the app frame. */
export function useLiveSaved(me: string | null) {
  const { s, update } = useSeek();
  const on = backendOn && !!me && (s.session === 'in' || s.session === 'client');
  useEffect(() => {
    if (!on) return;
    void sb()
      .from('saved')
      .select('message_id')
      .then(({ data }) => {
        if (data)
          update((d) => {
            d.lsaved = (data as { message_id: number }[]).map((r) => r.message_id);
          });
      });
  }, [on, me]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- tasks
type TaskRow = {
  id: number;
  title: string;
  owner_id: string;
  due_on: string | null;
  source_message_id: number | null;
  status: 'open' | 'done';
  created_by: string;
  created_at: string;
  done_at: string | null;
  messages: MsgRow | null;
};
const toTask = (r: TaskRow): LiveTask => ({
  id: r.id,
  title: r.title,
  owner: r.owner_id,
  due: r.due_on,
  source: r.source_message_id,
  status: r.status,
  by: r.created_by,
  at: r.created_at,
  doneAt: r.done_at,
  conv: r.messages ? convOf(r.messages) : null,
  place: r.messages ? placeOf(r.messages) : null,
});

export async function loadTasks(ws: string): Promise<LiveTask[] | null> {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data, error } = await sb()
    .from('tasks')
    .select(`id, title, owner_id, due_on, source_message_id, status, created_by, created_at, done_at, messages ( ${MSG} )`)
    .eq('workspace_id', ws)
    .or(`status.eq.open,done_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return null;
  return ((data ?? []) as unknown as TaskRow[]).map(toTask);
}

export async function createTask(t: { ws: string; title: string; owner: string; due: string | null; sourceUiId?: number | null }) {
  const src = t.sourceUiId != null ? toDbId(t.sourceUiId) : null;
  const { error } = await sb()
    .from('tasks')
    .insert({ workspace_id: t.ws, title: t.title.trim().slice(0, 200), owner_id: t.owner, due_on: t.due || null, source_message_id: src });
  if (!error) return null;
  return /owner must be on the team/.test(error.message) ? 'The owner must be on the team' : 'Couldn’t create the task. Check your connection';
}

export async function setTaskDone(id: number, done: boolean) {
  const { error } = await sb().from('tasks').update({ status: done ? 'done' : 'open' }).eq('id', id);
  return error ? 'Couldn’t update the task' : null;
}

export async function deleteTask(id: number) {
  const { error, count } = await sb().from('tasks').delete({ count: 'exact' }).eq('id', id);
  return error || count === 0 ? 'Only the person who created it or its owner can delete it' : null;
}

/** Keeps the team's tasks in app state, live. Mounted once, in the app frame (team only). */
export function useLiveTasks(me: string | null) {
  const { s, update } = useSeek();
  const ws = backendOn && !!me && s.session === 'in' ? (s.orgId ?? null) : null;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!ws) return;
    let alive = true;
    const reload = async () => {
      const list = await loadTasks(ws);
      if (alive && list)
        update((d) => {
          d.ltasks = list;
        });
    };
    void reload();
    const ch = sb()
      .channel('seek-tasks:' + ws)
      .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'tasks', filter: `workspace_id=eq.${ws}` }, () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), 300);
      })
      .subscribe();
    return () => {
      alive = false;
      clearTimeout(timer.current);
      sb().removeChannel(ch);
    };
  }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Reloads tasks right away (after you change one). */
export async function refreshTasks(update: (fn: (d: State) => void) => void, ws: string | undefined) {
  if (!ws) return;
  const list = await loadTasks(ws);
  if (list)
    update((d) => {
      d.ltasks = list;
    });
}

// ---------------------------------------------------------------- reminders
export async function remindMe(target: { uiId?: number; task?: number }, at: Date) {
  const message_id = target.uiId != null ? toDbId(target.uiId) : null;
  const { error } = await sb()
    .from('reminders')
    .insert({ message_id, task_id: target.task ?? null, remind_at: at.toISOString() });
  return error ? 'Couldn’t set the reminder' : null;
}

/** Turns due reminders into notifications: on start and every minute while Seek is open. */
export function useReminders(me: string | null) {
  const { s } = useSeek();
  const on = backendOn && !!me && (s.session === 'in' || s.session === 'client');
  useEffect(() => {
    if (!on) return;
    // due reminders become notifications; due Send-later messages are sent
    const fire = () => {
      // supabase-js only sends a query once it is awaited (or then-ed)
      void sb().rpc('fire_my_reminders').then(() => {});
      void sb().rpc('send_my_scheduled').then(() => {});
    };
    fire();
    const id = setInterval(fire, 60e3);
    return () => clearInterval(id);
  }, [on, me]);
}

/** "In 20 minutes", "Tomorrow 09:00"… as moments. */
export function reminderChoices(): [string, Date][] {
  const now = Date.now();
  const at9 = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const monday = (() => {
    const d = new Date();
    const add = ((8 - d.getDay()) % 7) || 7;
    return at9(add);
  })();
  return [
    ['In 20 minutes', new Date(now + 20 * 60e3)],
    ['In 1 hour', new Date(now + 60 * 60e3)],
    ['In 3 hours', new Date(now + 3 * 60 * 60e3)],
    ['Tomorrow at 09:00', at9(1)],
    ['Next Monday at 09:00', monday],
  ];
}

// ---------------------------------------------------------------- canvas
export type Canvas = { body: string; updatedBy: string | null; updatedAt: string | null };

export async function loadCanvas(channel: string): Promise<Canvas | null> {
  const { data, error } = await sb().from('canvases').select('body, updated_by, updated_at').eq('channel_id', channel).maybeSingle();
  if (error) return null;
  const r = data as { body: string; updated_by: string | null; updated_at: string } | null;
  return r ? { body: r.body, updatedBy: r.updated_by, updatedAt: r.updated_at } : { body: '', updatedBy: null, updatedAt: null };
}

/**
 * Saves the canvas. If someone else saved since you opened it (`since`), nothing is overwritten and their version
 * comes back so you can merge.
 */
export async function saveCanvas(channel: string, body: string, me: string, since: string | null): Promise<{ error?: string; conflict?: Canvas; savedAt?: string }> {
  const now = new Date().toISOString();
  if (since == null) {
    const { error } = await sb().from('canvases').insert({ channel_id: channel, body, updated_by: me, updated_at: now });
    if (!error) return { savedAt: now };
    if (!/duplicate/.test(error.message)) return { error: 'Couldn’t save the canvas' };
  } else {
    const { data, error } = await sb()
      .from('canvases')
      .update({ body, updated_by: me, updated_at: now })
      .eq('channel_id', channel)
      .eq('updated_at', since)
      .select('updated_at');
    if (error) return { error: 'Couldn’t save the canvas' };
    if (data && data.length) return { savedAt: now };
  }
  const latest = await loadCanvas(channel);
  return latest ? { conflict: latest } : { error: 'Couldn’t save the canvas' };
}

// ---------------------------------------------------------------- opening a conversation
/** Selects a conversation ('ch:', 'dm:', 'sp:') in app state and returns its route. */
export async function openConversation(conv: string, update: (fn: (d: State) => void) => void, me: string | null): Promise<string> {
  const [kind, id, lane] = conv.split(':');
  if (kind === 'ch') {
    update((d) => {
      const c = d.workspaces.C.channels.find((x) => x.cid === id);
      if (c) {
        d.wsId = 'C';
        d.workspaces.C.ch = c.id;
      }
    });
    return ROUTES.channels;
  }
  if (kind === 'dm') {
    const { data } = await sb().from('dm_members').select('user_id').eq('thread_id', id);
    const other = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id).find((u) => u !== me);
    if (other)
      update((d) => {
        d.dm = keyFor(other, me) as PersonKey;
      });
    return ROUTES.dms;
  }
  if (kind === 'sp')
    update((d) => {
      d.cs = id;
      d.cTab = lane === 'team' ? 'Team notes' : 'Client chat';
    });
  return ROUTES.clients;
}

// ---------------------------------------------------------------- send later

/** Queues a message to send later (delivered by your app at that time). */
export async function scheduleMessage(target: FileTarget, body: string, at: Date, mentions: string[] = []) {
  let where: Record<string, string>;
  if ('channel' in target) where = { channel_id: target.channel };
  else if ('space' in target) where = { space_id: target.space, lane: target.lane };
  else {
    const { data, error } = await sb().rpc('open_dm', { p_other: target.dmWith });
    if (error || !data) return 'Couldn’t open this conversation';
    where = { dm_id: data as string };
  }
  if (at.getTime() < Date.now() + 30e3) return 'Pick a time at least a minute from now';
  const { error } = await sb().from('scheduled_messages').insert({ ...where, body: body.slice(0, 8000), mentions, send_at: at.toISOString() });
  return error ? 'Couldn’t schedule it. Check your connection' : null;
}

export type Scheduled = { id: number; body: string; at: string; place: string };

export async function myScheduled(): Promise<Scheduled[] | null> {
  const { data, error } = await sb()
    .from('scheduled_messages')
    .select('id, body, send_at, channel_id, dm_id, space_id, lane, channels ( name ), client_spaces ( name )')
    .is('sent_at', null)
    .order('send_at');
  if (error) return null;
  type R = { id: number; body: string; send_at: string; channel_id: string | null; dm_id: string | null; space_id: string | null; lane: string | null; channels: { name: string } | null; client_spaces: { name: string } | null };
  return ((data ?? []) as unknown as R[]).map((r) => ({
    id: r.id,
    body: r.body,
    at: r.send_at,
    place: r.channel_id ? '# ' + (r.channels?.name ?? 'channel') : r.dm_id ? 'Direct message' : (r.client_spaces?.name ?? 'Client') + (r.lane === 'team' ? ' · Team notes' : ' · Client chat'),
  }));
}

export async function cancelScheduled(id: number) {
  const { error, count } = await sb().from('scheduled_messages').delete({ count: 'exact' }).eq('id', id);
  return error || count === 0 ? 'It was already sent' : null;
}

/** Edits the text of your own message. */
export async function editMessage(uiId: number, body: string) {
  const id = toDbId(uiId);
  if (id == null) return 'This message isn’t saved yet';
  const { error, count } = await sb().from('messages').update({ body: body.slice(0, 8000) }, { count: 'exact' }).eq('id', id);
  return error || count === 0 ? 'Couldn’t save the edit' : null;
}

/** A link to a message that opens it for anyone who can see it. */
export const messageLink = (uiId: number) => {
  const id = toDbId(uiId);
  return id == null ? null : `${location.origin}/open?m=${id}`;
};

/** Where a message lives ('ch:', 'dm:' or 'sp:'), if you can see it. */
export async function convOfMessage(id: number): Promise<string | null> {
  const { data } = await sb().from('messages').select('channel_id, dm_id, space_id, lane, parent_id').eq('id', id).maybeSingle();
  const m = data as { channel_id: string | null; dm_id: string | null; space_id: string | null; lane: string | null } | null;
  if (!m) return null;
  return m.channel_id ? 'ch:' + m.channel_id : m.dm_id ? 'dm:' + m.dm_id : 'sp:' + m.space_id + ':' + m.lane;
}

// ---------------------------------------------------------------- huddles and calls
/**
 * Starts a huddle (channel) or a call (DM): opens a private Seek video room for you and posts a HUDDLE card so
 * others can join. Rooms are free Jitsi Meet rooms (meet.jit.si) with a random name; the public service may ask the
 * person who starts a room to sign in with Google, GitHub or Facebook.
 */
export async function startHuddle(target: ConvTarget): Promise<string | null> {
  const link = 'https://meet.jit.si/Seek-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  // open the tab now, so popup blockers allow it
  const w = window.open(link, '_blank');
  if (w) w.opener = null;
  let where: Record<string, string>;
  if ('channel' in target) where = { channel_id: target.channel };
  else if ('space' in target) where = { space_id: target.space, lane: target.lane ?? 'team' };
  else {
    const thread = await dmThreadWith(target.dmWith);
    if (!thread) return 'Couldn’t open this conversation';
    where = { dm_id: thread };
  }
  const { error } = await sb()
    .from('messages')
    .insert({ ...where, body: 'dmWith' in target ? '📞 Started a call' : '🎧 Started a huddle', card: { type: 'huddle', link } });
  if (error) {
    w?.close();
    return 'Couldn’t start it. Check your connection';
  }
  if (!w) return 'Your browser blocked the video tab. Allow pop-ups for Seek, or press Join on the card';
  return null;
}
