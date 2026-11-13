'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { backendOn, sb } from './backend';
import { PEOPLE } from './data';

/**
 * Who's active. While you have Seek open, the app tells the server "I'm here" about once a minute (seen_now());
 * teammates count as active if that was in the last 3 minutes. Everyone else shows when they were last seen.
 * People you can see are re-checked every 30 seconds.
 */

const ACTIVE_MS = 3 * 60_000;
type Seen = { at: number | null; status: string };
const seen = new Map<string, Seen>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function refresh(me: string) {
  // everyone whose name we know (teammates, DM partners, client contacts), except you
  const ids = Object.keys(PEOPLE).filter((k) => UUID.test(k) && k !== me);
  if (!ids.length) return;
  const { data } = await sb().from('profiles').select('id, last_seen_at, status').in('id', ids.slice(0, 300));
  for (const r of (data ?? []) as { id: string; last_seen_at: string | null; status: string }[])
    seen.set(r.id, { at: r.last_seen_at ? Date.parse(r.last_seen_at) : null, status: r.status });
  emit();
}

/** Mounted once (app frame): says "I'm here" while Seek is open and keeps everyone's presence fresh. */
export function usePresence(me: string | null) {
  useEffect(() => {
    if (!backendOn || !me) return;
    let last = 0;
    const beat = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 20_000) return;
      last = Date.now();
      void sb().rpc('seen_now').then(() => {});
    };
    beat();
    void refresh(me);
    const b = setInterval(beat, 60_000);
    const r = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(me);
    }, 30_000);
    const onShow = () => {
      beat();
      if (document.visibilityState === 'visible') void refresh(me);
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      clearInterval(b);
      clearInterval(r);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [me]);
}

/** "5 min ago", "2 h ago", "yesterday at 4:10 PM", "Mon 10 Nov". */
function ago(t: number) {
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return Math.floor(m / 60) + ' h ago';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday at ' + time;
  if (Date.now() - t < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'long' }) + ' at ' + time;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === y.getFullYear() ? undefined : 'numeric' });
}

export type Presence = { known: boolean; active: boolean; label: string };

/** Someone's presence: active (green dot), or when they were last seen. Re-renders when it changes. */
export function usePresenceOf(id: string | null | undefined): Presence {
  useSyncExternalStore(subscribe, () => version, () => 0);
  if (!backendOn || !id || id === 'AH') return { known: false, active: false, label: '' };
  const p = seen.get(id);
  if (!p) return { known: false, active: false, label: '' };
  const recent = p.at != null && Date.now() - p.at < ACTIVE_MS;
  if (recent && p.status !== 'aw') return { known: true, active: true, label: 'Active now' };
  if (recent) return { known: true, active: false, label: 'Away' };
  return { known: true, active: false, label: p.at ? 'Last seen ' + ago(p.at) : 'Not active yet' };
}
