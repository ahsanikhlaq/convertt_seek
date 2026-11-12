'use client';

import { useEffect } from 'react';
import { backendOn, DB_SCHEMA, sb } from './backend';
import { PEOPLE, type Note, type PersonKey, type State } from './data';
import { keyFor, learnProfiles } from './live';
import { ROUTES } from './routes';
import { useSeek } from './store';

/**
 * Notifications (backend mode). The database writes them when a message arrives (DMs, @mentions, thread replies,
 * client messages); this keeps your latest 50 in app state, live, marks them read, and shows a desktop alert when
 * Seek isn't in front (unless you paused notifications).
 */

type Row = { id: number; kind: Note['kind']; title: string; body: string; conv: string; actor_id: string | null; created_at: string; read_at: string | null };
const toNote = (r: Row): Note => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, conv: r.conv, actor: r.actor_id, at: r.created_at, read: !!r.read_at });
const COLS = 'id, kind, title, body, conv, actor_id, created_at, read_at';

/** The @mentioned people in a message: teammates whose first name (or full name) follows an @. */
export function mentionIds(text: string, candidates: string[]): string[] {
  const out = new Set<string>();
  for (const id of candidates) {
    const name = PEOPLE[id]?.name?.trim();
    if (!name) continue;
    const first = name.split(' ')[0];
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|\\s)@(${esc(name)}|${esc(first)})(?![\\w])`, 'i').test(text)) out.add(id);
  }
  return [...out];
}

/** Where a notification points, and how to open it. */
export function openNote(n: Note, d: State, me: string | null): string {
  const [kind, id, lane] = n.conv.split(':');
  if (kind === 'ch') {
    const c = d.workspaces.C.channels.find((x) => x.cid === id);
    if (c) {
      d.workspaces.C.ch = c.id;
      c.unread = 0;
    }
    return ROUTES.channels;
  }
  if (kind === 'dm') {
    if (n.actor) d.dm = keyFor(n.actor, me) as PersonKey;
    return ROUTES.dms;
  }
  d.cs = id;
  d.cTab = lane === 'team' ? 'Team notes' : 'Client chat';
  return ROUTES.clients;
}

export async function markNotesRead(ids: number[] | 'all') {
  const q = sb().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  await (ids === 'all' ? q : q.in('id', ids));
}

/** Loads your notifications and keeps them live. Mounted once, in the app frame. */
export function useLiveNotes(me: string | null) {
  const { s, update } = useSeek();
  const on = backendOn && !!me && (s.session === 'in' || s.session === 'client');
  const paused = s.me.dnd;
  const focusOnly = s.status.k === 'fc';

  useEffect(() => {
    if (!on) return;
    let alive = true;
    void (async () => {
      const { data } = await sb().from('notifications').select(COLS).order('created_at', { ascending: false }).limit(50);
      const rows = (data ?? []) as Row[];
      await learnProfiles(rows.map((r) => r.actor_id).filter((x): x is string => !!x), me);
      if (alive)
        update((d) => {
          d.notes = rows.map(toNote);
        });
    })();
    const ch = sb()
      .channel('seek-notes:' + me)
      .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'notifications', filter: `user_id=eq.${me}` }, async (p) => {
        const n = toNote(p.new as Row);
        if (n.actor) await learnProfiles([n.actor], me);
        update((d) => {
          const list = (d.notes ||= []);
          if (!list.some((x) => x.id === n.id)) list.unshift(n);
          d.notes = list.slice(0, 50);
        });
        // a desktop alert when Seek isn't in front (paused: none; Focus: only mentions and DMs)
        const away = typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
        if (away && !paused && (!focusOnly || n.kind === 'mention' || n.kind === 'dm') && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const alert = new Notification(n.title, { body: n.body, tag: 'seek-' + n.id });
            alert.onclick = () => window.focus();
          } catch {}
        }
      })
      .subscribe();
    return () => {
      alive = false;
      sb().removeChannel(ch);
    };
  }, [on, me, paused, focusOnly]); // eslint-disable-line react-hooks/exhaustive-deps
}
