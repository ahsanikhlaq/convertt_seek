'use client';

import type { State } from './data';

/** Whether your notifications are paused right now (a pause ends by itself at its time). */
export function isPaused(me: State['me']) {
  if (!me.dnd) return false;
  return !me.dndUntil || new Date(me.dndUntil).getTime() > Date.now();
}

/** How long you can pause notifications for: [value, label, minutes]. */
export const PAUSE_FOR: [string, string, number][] = [
  ['30m', '30 minutes', 30],
  ['1h', '1 hour', 60],
  ['2h', '2 hours', 120],
  ['4h', '4 hours', 240],
  ['1d', '1 day', 24 * 60],
  ['1w', '1 week', 7 * 24 * 60],
];

/** "until 4:30 PM" or "until Fri 9:00 AM" for a pause end time. */
export function untilLabel(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return 'until ' + (sameDay ? time : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + time);
}

// Settings that belong to this device only (like Slack's per-device preferences).
const ENTER = 'seek:enterSends';
const PREVIEWS = 'seek:previews';
function read(k: string, fallback: string) {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

/** true: Enter sends and Shift+Enter starts a new line. false: Enter starts a new line and Ctrl/⌘+Enter sends. */
export const enterSends = () => read(ENTER, '1') === '1';
export const setEnterSends = (on: boolean) => write(ENTER, on ? '1' : '0');

/** Whether pictures in messages show as previews (otherwise as file cards). */
export const showPreviews = () => read(PREVIEWS, '1') === '1';
export const setShowPreviews = (on: boolean) => write(PREVIEWS, on ? '1' : '0');
