'use client';

import { useEffect } from 'react';
import { backendOn, DB_SCHEMA, sb } from './backend';
import type { ChatMessage, FeedItem, State , MessageCard } from './data';
import { toDbId, toUiId } from './live';
import { useSeek } from './store';

/**
 * What every live conversation shares (channels, DMs and client spaces): saved reactions, deleting your own
 * messages (removed for everyone, live), and each person's read position (so unread counts survive a reload).
 */

/** Every feed in the app state (channels, DMs, client spaces). */
function* feeds(d: State): Generator<FeedItem[]> {
  for (const list of Object.values(d.workspaces.C.msgs)) if (list) yield list;
  for (const t of Object.values(d.dms)) if (t) yield t.msgs;
  for (const list of Object.values(d.lc ?? {})) if (list) yield list;
}

// ---------------------------------------------------------------- messages that didn't send
// A failed send stays in its conversation, marked "Not sent", with Retry; it is retried by itself when the
// connection comes back. Local ids are negative, so they never clash with saved messages.
const retries = new Map<number, () => Promise<void>>();
let localId = -1;

/** Shows your message as "Not sent" in the feed, with a way to send it again. */
export function markNotSent(update: (fn: (d: State) => void) => void, list: (d: State) => FeedItem[], text: string, retry: () => Promise<void>) {
  const id = localId--;
  retries.set(id, retry);
  const t = new Date();
  const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  update((d) => {
    list(d).push({ kind: 'msg', id, who: 'AH', time, text, failed: true });
  });
}

function dropLocal(d: State, id: number) {
  for (const list of feeds(d)) {
    const i = list.findIndex((x) => x.kind === 'msg' && x.id === id);
    if (i >= 0) list.splice(i, 1);
  }
}

/** Sends a "Not sent" message again (it is removed first; it comes back marked if this fails too). */
export async function retryUnsent(update: (fn: (d: State) => void) => void, id: number) {
  const fn = retries.get(id);
  update((d) => dropLocal(d, id));
  retries.delete(id);
  if (fn) await fn();
}

export const canRetry = (id: number) => retries.has(id);

export function discardUnsent(update: (fn: (d: State) => void) => void, id: number) {
  retries.delete(id);
  update((d) => dropLocal(d, id));
}

/** Runs fn on the message with this UI id, wherever it is. */
export function onMessage(d: State, uiId: number, fn: (m: ChatMessage, list: FeedItem[]) => void) {
  for (const list of feeds(d)) {
    const m = list.find((x): x is ChatMessage => x.kind === 'msg' && x.id === uiId);
    if (m) {
      fn(m, list);
      return;
    }
  }
}

/** Loads saved reactions for these messages and writes the counts (and yours) onto them. */
export async function hydrateReactions(update: (fn: (d: State) => void) => void, uiIds: number[], me: string | null) {
  const ids = uiIds.map(toDbId).filter((x): x is number => x != null);
  if (!ids.length) return;
  const { data } = await sb().from('reactions').select('message_id, user_id, emoji').in('message_id', ids.slice(-400));
  const byMsg = new Map<number, { rx: Record<string, number>; mx: string[] }>();
  for (const r of (data ?? []) as { message_id: number; user_id: string; emoji: string }[]) {
    const e = byMsg.get(r.message_id) ?? { rx: {}, mx: [] };
    e.rx[r.emoji] = (e.rx[r.emoji] || 0) + 1;
    if (r.user_id === me) e.mx.push(r.emoji);
    byMsg.set(r.message_id, e);
  }
  if (!byMsg.size) return;
  update((d) => {
    for (const [id, e] of byMsg)
      onMessage(d, toUiId(id), (m) => {
        m.rx = e.rx;
        m.mx = e.mx;
      });
  });
}

/** Adds or removes your reaction (saved; others see it live). */
export async function setReaction(uiId: number, emoji: string, on: boolean): Promise<boolean> {
  const id = toDbId(uiId);
  if (id == null) return false;
  const q = on ? sb().from('reactions').insert({ message_id: id, emoji }) : sb().from('reactions').delete().eq('message_id', id).eq('emoji', emoji);
  const { error } = await q;
  return !error || error.code === '23505';
}

/** Deletes one of your own messages, for everyone. */
export async function deleteMessage(uiId: number): Promise<boolean> {
  const id = toDbId(uiId);
  if (id == null) return false;
  const { error } = await sb().from('messages').delete().eq('id', id);
  return !error;
}

// ---- read positions: 'ch:<channel>', 'dm:<thread>', 'sp:<space>:<lane>'
const lastMark = new Map<string, number>();
/** Saves that you've read this conversation up to now (at most every 3 seconds per conversation). */
export function markRead(conv: string) {
  if (!backendOn) return;
  const t = Date.now();
  if (t - (lastMark.get(conv) ?? 0) < 3000) return;
  lastMark.set(conv, t);
  // supabase-js only sends a query once it is awaited (or then-ed)
  void sb()
    .from('reads')
    .upsert({ conv, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,conv' })
    .then(({ error }) => {
      if (error) lastMark.delete(conv);
    });
}

/** Unread counts per conversation in this organisation (channels and DMs). */
export async function unreadCounts(orgId: string): Promise<Map<string, number>> {
  const { data } = await sb().rpc('unread_counts', { p_ws: orgId });
  return new Map(((data ?? []) as { conv: string; n: number }[]).map((r) => [r.conv, r.n]));
}

/** Live reactions and deletions from everyone, applied to whatever is on screen. Mounted once, in the app frame. */
export function useLiveSync(me: string | null) {
  const { s, update } = useSeek();
  const on = backendOn && !!me && (s.session === 'in' || s.session === 'client');
  useEffect(() => {
    if (!on) return;
    // back online: send whatever didn't go through
    const onOnline = () => {
      for (const id of [...retries.keys()]) void retryUnsent(update, id);
    };
    addEventListener('online', onOnline);
    const ch = sb()
      .channel('seek-sync:' + me)
      .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'reactions' }, (p) => {
        const r = p.new as { message_id: number; user_id: string; emoji: string };
        if (r.user_id === me) return; // already shown when you reacted
        update((d) =>
          onMessage(d, toUiId(r.message_id), (m) => {
            m.rx = { ...(m.rx ?? {}), [r.emoji]: (m.rx?.[r.emoji] ?? 0) + 1 };
          }),
        );
      })
      .on('postgres_changes', { event: 'DELETE', schema: DB_SCHEMA, table: 'reactions' }, (p) => {
        const r = p.old as { message_id?: number; user_id?: string; emoji?: string };
        if (!r.message_id || !r.emoji || r.user_id === me) return;
        update((d) =>
          onMessage(d, toUiId(r.message_id!), (m) => {
            const n = (m.rx?.[r.emoji!] ?? 0) - 1;
            const rx = { ...(m.rx ?? {}) };
            if (n > 0) rx[r.emoji!] = n;
            else delete rx[r.emoji!];
            m.rx = rx;
          }),
        );
      })
      .on('postgres_changes', { event: 'UPDATE', schema: DB_SCHEMA, table: 'messages' }, (p) => {
        const r = p.new as { id: number; body: string; edited_at: string | null; pinned_at: string | null; card: MessageCard | null };
        if (!r.id) return;
        update((d) =>
          onMessage(d, toUiId(r.id), (m) => {
            m.text = r.body;
            m.edited = !!r.edited_at;
            m.pinned = !!r.pinned_at;
            if (r.card) m.card = r.card;
          }),
        );
      })
      .on('postgres_changes', { event: 'DELETE', schema: DB_SCHEMA, table: 'messages' }, (p) => {
        const id = (p.old as { id?: number }).id;
        if (!id) return;
        update((d) => removeEverywhere(d, id));
      })
      .subscribe();
    return () => {
      removeEventListener('online', onOnline);
      sb().removeChannel(ch);
    };
  }, [on, me]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Removes a deleted message (or thread reply) from every feed. */
export function removeEverywhere(d: State, dbId: number) {
  const ui = toUiId(dbId);
  for (const list of feeds(d)) {
    const i = list.findIndex((x) => x.kind === 'msg' && x.id === ui);
    if (i >= 0) list.splice(i, 1);
    for (const x of list)
      if (x.kind === 'msg' && x.thread?.length) x.thread = x.thread.filter((r) => (r as { dbId?: number }).dbId !== dbId);
  }
}
