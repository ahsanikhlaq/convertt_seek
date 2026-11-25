'use client';

import { useEffect, useState } from 'react';

/**
 * A number that goes up whenever Seek should catch up with the server: the tab comes back after being hidden for
 * a while (browsers pause background tabs, so the live connection can miss messages), the device comes back online,
 * or a live connection comes back after being down for a while. Screens add it to the effects that load the open
 * conversation.
 *
 * Catching up asks the server for a lot at once, so it happens at most once every 30 seconds: one asked for inside
 * that window runs when the window ends (several reasons together catch up once).
 */
let tick = 0;
const subs = new Set<(n: number) => void>();
// hidden for less than this: the live connection most likely kept up, so there is nothing to catch up
const HIDDEN_MS = 2 * 60_000;
// a live connection down for less than this (a blip, a quick reconnect) missed nothing worth a catch-up
const DOWN_MS = 20_000;
const EVERY_MS = 30_000;
let lastRun = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

function run() {
  lastRun = Date.now();
  tick++;
  subs.forEach((f) => f(tick));
}

export function resyncNow() {
  const wait = EVERY_MS - (Date.now() - lastRun);
  if (wait <= 0) {
    if (pending) clearTimeout(pending);
    pending = null;
    run();
  } else if (!pending)
    pending = setTimeout(() => {
      pending = null;
      run();
    }, wait);
}
let hiddenAt = 0;
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_MS) resyncNow();
  });
  window.addEventListener('online', () => resyncNow());
}
export function useResync() {
  const [n, setN] = useState(tick);
  useEffect(() => {
    subs.add(setN);
    return () => {
      subs.delete(setN);
    };
  }, []);
  return n;
}

/** For a live channel's subscribe callback: catch up when it reconnects after being down for more than 20 seconds. */
export function onLiveStatus() {
  let was = false;
  let downAt = 0;
  return (status: string) => {
    if (status === 'SUBSCRIBED') {
      if (was && downAt && Date.now() - downAt > DOWN_MS) resyncNow();
      was = true;
      downAt = 0;
    } else if (was && !downAt) downAt = Date.now(); // CHANNEL_ERROR, TIMED_OUT or CLOSED: it went down
  };
}
