'use client';

import { useEffect, useState } from 'react';
import { backendOn, sb } from './backend';
import { offsetOf } from './liveMeetings';

/**
 * The reply timer (backend mode). A client's wait starts with their first Client chat message after the team's
 * last reply there, and stops when anyone on the team replies. It counts working hours only: Mon–Fri, 09:00–18:00
 * in the agency's time zone (from the workspace setting; this computer's zone when it has none).
 */

export const DAY_START = 9;
export const DAY_END = 18;
const HOURS_PER_DAY = DAY_END - DAY_START;

/** Working milliseconds between two moments in a zone given by its UTC offset (this computer's zone when null). */
export function workingMs(from: Date, to: Date, offset: number | null) {
  if (to <= from) return 0;
  const shift = offset == null ? 0 : offset * 3600e3;
  // walk day by day in the zone's local time
  const local = (d: Date) => (offset == null ? d : new Date(d.getTime() + shift));
  const fromL = local(from);
  const toL = local(to);
  const get = (d: Date) =>
    offset == null
      ? { y: d.getFullYear(), m: d.getMonth(), day: d.getDate(), dow: d.getDay() }
      : { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), dow: d.getUTCDay() };
  const mk = (y: number, m: number, d: number, h: number) => (offset == null ? new Date(y, m, d, h) : new Date(Date.UTC(y, m, d, h)));
  let total = 0;
  let cur = get(fromL);
  for (let i = 0; i < 400; i++) {
    const start = mk(cur.y, cur.m, cur.day, DAY_START);
    const end = mk(cur.y, cur.m, cur.day, DAY_END);
    if (cur.dow >= 1 && cur.dow <= 5) {
      const a = Math.max(start.getTime(), fromL.getTime());
      const b = Math.min(end.getTime(), toL.getTime());
      if (b > a) total += b - a;
    }
    if (end.getTime() >= toL.getTime()) break;
    const next = mk(cur.y, cur.m, cur.day + 1, 0);
    cur = get(next);
  }
  return total;
}

/** A reply target ("4 working hours", "1 working day") in working hours. */
export function targetHours(target: string) {
  const m = /(\d+(?:\.\d+)?)\s*(working\s+)?(hour|day)/i.exec(target);
  if (!m) return HOURS_PER_DAY;
  return Number(m[1]) * (m[3].toLowerCase() === 'day' ? HOURS_PER_DAY : 1);
}

/** "26h", "40m", "2d 3h" for a duration in working milliseconds. */
export function waitLabel(ms: number) {
  const mins = Math.round(ms / 60e3);
  if (mins < 60) return Math.max(mins, 1) + 'm';
  const h = Math.round(mins / 60);
  return h + 'h';
}

export type Wait = { since: string | null; lastReply: string | null };

/** Every client space's wait, refreshed every minute and when new Client chat messages arrive. */
export function useSpaceWaits(ws: string | null, bump: number) {
  const [waits, setWaits] = useState<Map<string, Wait>>(new Map());
  const [, tick] = useState(0);
  useEffect(() => {
    if (!backendOn || !ws) return;
    let alive = true;
    void sb()
      .rpc('space_waits', { p_ws: ws })
      .then(({ data }) => {
        if (!alive || !data) return;
        type R = { space_id: string; waiting_since: string | null; last_team_reply: string | null };
        setWaits(new Map((data as R[]).map((r) => [r.space_id, { since: r.waiting_since, lastReply: r.last_team_reply }])));
      });
    return () => {
      alive = false;
    };
  }, [ws, bump]);
  // re-render every minute so the counts move
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60e3);
    return () => clearInterval(id);
  }, []);
  return waits;
}

/** The wait for one space: working time so far, and whether it's over the target. */
export function waitFor(w: Wait | undefined, target: string, tzLabel: string | undefined) {
  if (!w?.since) return null;
  const ms = workingMs(new Date(w.since), new Date(), offsetOf(tzLabel));
  return { ms, label: waitLabel(ms), over: ms > targetHours(target) * 3600e3 };
}
