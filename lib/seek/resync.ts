'use client';

import { useEffect, useState } from 'react';

/**
 * A number that goes up whenever Seek should catch up with the server: the tab comes back after being hidden for
 * a while (browsers pause background tabs, so the live connection can miss messages), or the device comes back
 * online. Screens add it to the effects that load the open conversation.
 */
let tick = 0;
const subs = new Set<(n: number) => void>();
export function resyncNow() {
  tick++;
  subs.forEach((f) => f(tick));
}
let hiddenAt = 0;
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 15_000) resyncNow();
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

/** For a live channel's subscribe callback: catch up when it reconnects after a drop. */
export function onLiveStatus() {
  let was = false;
  return (status: string) => {
    if (status === 'SUBSCRIBED') {
      if (was) resyncNow();
      was = true;
    }
  };
}
