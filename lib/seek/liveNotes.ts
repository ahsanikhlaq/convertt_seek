'use client';

import { useEffect } from 'react';
import { backendOn, DB_SCHEMA, DEFAULT_NOTIFY, sb } from './backend';
import { inSchedule } from './prefs';
import { PEOPLE, type Note, type PersonKey, type State } from './data';
import { keyFor, learnProfiles } from './live';
import { ROUTES } from './routes';
import { useSeek } from './store';
import { playSound, type SoundKey } from './sounds';

/**
 * Notifications (backend mode). The database writes them when a message arrives (DMs, @mentions, thread replies,
 * client messages); this keeps your latest 50 in app state, live, marks them read, and shows a desktop alert when
 * Seek isn't in front (unless you paused notifications).
 */

type Row = { id: number; kind: Note['kind']; title: string; body: string; conv: string; actor_id: string | null; created_at: string; read_at: string | null; workspace_id: string | null; message_id: number | null };
const toNote = (r: Row): Note => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, conv: r.conv, actor: r.actor_id, at: r.created_at, read: !!r.read_at, ws: r.workspace_id, messageId: r.message_id });
const COLS = 'id, kind, title, body, conv, actor_id, created_at, read_at, workspace_id, message_id';

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
  if (kind !== 'sp') return ROUTES.channels;
  d.cs = id;
  d.cTab = lane === 'team' ? 'Team notes' : lane === 'approvals' ? 'Approvals' : 'Client chat';
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
  // a pause ends by itself at its time, even if nothing else changes on screen
  const pauseEnd = s.me.dnd ? (s.me.dndUntil ? Date.parse(s.me.dndUntil) : Infinity) : 0;
  const focusOnly = s.status.k === 'fc';
  const snd = s.me.sound ?? { key: 'chime', volume: 70, play: 'all' as const, alertSecs: 8 };
  const np = s.me.notify ?? DEFAULT_NOTIFY;
  const npKey = JSON.stringify(np);
  const tz = s.me.tz;

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
        // sound (your choice and volume) and a desktop alert when Seek isn't in front (paused: none; Focus: only
        // mentions and DMs)
        const important = n.kind === 'mention' || n.kind === 'dm' || n.kind === 'approval' || n.kind === 'reminder' || n.kind === 'keyword' || n.kind === 'huddle';
        // quiet while paused, outside your notification schedule, or when you chose "Nothing"
        const paused = Date.now() < pauseEnd || np.level === 'nothing' || !inSchedule(np.schedule, tz);
        if (!paused && (!focusOnly || important) && (snd.play === 'all' || (snd.play === 'important' && important))) playSound(snd.key as SoundKey, snd.volume);
        const away = typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
        if (away && !paused && np.desktop && (!focusOnly || n.kind === 'mention' || n.kind === 'dm') && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const alert = new Notification(n.title, { body: np.preview ? n.body : 'New activity in Seek', tag: 'seek-' + n.id, requireInteraction: snd.alertSecs === 0, silent: true });
            alert.onclick = () => window.focus();
            if (snd.alertSecs > 0) setTimeout(() => alert.close(), snd.alertSecs * 1000);
          } catch {}
        }
      })
      .subscribe();
    return () => {
      alive = false;
      sb().removeChannel(ch);
    };
  }, [on, me, pauseEnd, focusOnly, snd.key, snd.volume, snd.play, snd.alertSecs, npKey, tz]); // eslint-disable-line react-hooks/exhaustive-deps
}
