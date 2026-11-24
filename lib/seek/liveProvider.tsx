'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLiveChatEngine, type LiveChat } from './live';
import { useLiveDmsEngine, type LiveDms } from './liveDms';

/**
 * Team chat and DMs, loaded once per app session and kept live. Mounted once, in the app frame, so going back to
 * Home or DMs shows what is already there instead of loading it all again; it catches up only when Seek resyncs
 * (back to the tab after a while, back online, reconnected). Screens read it with useLiveChat() / useLiveDms(), which
 * also tell it that the screen is open (so the open conversation is marked read only while you can see it).
 */

type Slot<T> = { value: T | null; watch: () => () => void };
const ChatCtx = createContext<Slot<LiveChat> | null>(null);
const DmsCtx = createContext<Slot<LiveDms> | null>(null);

function useWatchers() {
  const [n, setN] = useState(0);
  const watch = useCallback(() => {
    setN((x) => x + 1);
    return () => setN((x) => x - 1);
  }, []);
  return [n > 0, watch] as const;
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [chatOpen, watchChat] = useWatchers();
  const [dmsOpen, watchDms] = useWatchers();
  const chat = useLiveChatEngine(chatOpen);
  const dms = useLiveDmsEngine(dmsOpen);
  return (
    <ChatCtx.Provider value={{ value: chat, watch: watchChat }}>
      <DmsCtx.Provider value={{ value: dms, watch: watchDms }}>{children}</DmsCtx.Provider>
    </ChatCtx.Provider>
  );
}

/** Real team chat for the Channels screen (backend mode only; null in demo mode). See lib/seek/live.ts. */
export function useLiveChat(): LiveChat | null {
  const c = useContext(ChatCtx);
  const watch = c?.watch;
  useEffect(() => watch?.(), [watch]);
  return c?.value ?? null;
}

/** Real direct messages for the DMs screen (backend mode only; null in demo mode). See lib/seek/liveDms.ts. */
export function useLiveDms(): LiveDms | null {
  const c = useContext(DmsCtx);
  const watch = c?.watch;
  useEffect(() => watch?.(), [watch]);
  return c?.value ?? null;
}
