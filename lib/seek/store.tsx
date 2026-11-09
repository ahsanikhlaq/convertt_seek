'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { initialState, STATE_VERSION, type State } from './data';
import { applyTheme } from './theme';

const KEY = 'seek:state';

/** Screen-level UI state that is not saved between sessions. */
export type UI = {
  sideOpen: boolean; // mobile sidebar drawer
  paneOpen: boolean; // right-hand detail pane
  thread: number | null;
  menu: number | null; // message whose "More" menu is open
  chTab: string;
  dWhere: string;
  dType: string;
  hist: number | null;
  logOf: string | null;
  palette: boolean;
  profile: boolean;
};

const initialUI = (): UI => ({
  sideOpen: false,
  paneOpen: typeof window === 'undefined' ? true : window.innerWidth > 760,
  thread: null,
  menu: null,
  chTab: 'Messages',
  dWhere: 'All',
  dType: 'All',
  hist: null,
  logOf: null,
  palette: false,
  profile: false,
});

type ToastState = { text: string; undo: (() => void) | null; key: number } | null;

type Ctx = {
  s: State;
  /** Applies a change to a copy of the state (write to the draft, as with Immer). */
  update: (fn: (d: State) => void) => void;
  ui: UI;
  setUI: (patch: Partial<UI> | ((u: UI) => Partial<UI>)) => void;
  toast: (text: string, undo?: () => void) => void;
  nextId: () => number;
  dark: boolean;
  resetAll: () => void;
};

const StoreCtx = createContext<Ctx | null>(null);

export function useSeek() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useSeek must be used inside <SeekProvider>');
  return c;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // "just sent" highlights only play once, not again after a reload
      const v = JSON.parse(raw, (k, val) => (k === 'flash' ? undefined : val));
      if (v && v.version === STATE_VERSION) return { ...initialState(), ...v };
    }
  } catch {}
  return initialState();
}

export function SeekProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<State | null>(null);
  const [ui, setUIState] = useState<UI>(initialUI);
  const [t, setT] = useState<ToastState>(null);
  const [sysDark, setSysDark] = useState(false);
  const uidRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // load saved state once, on the client
  useEffect(() => {
    const st = load();
    uidRef.current = st.uid;
    setS(st);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSysDark(mq.matches);
    const onMq = () => setSysDark(mq.matches);
    mq.addEventListener?.('change', onMq);
    return () => mq.removeEventListener?.('change', onMq);
  }, []);

  // save
  useEffect(() => {
    if (!s) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...s, uid: uidRef.current }));
      } catch {}
    }, 150);
    return () => clearTimeout(id);
  }, [s]);

  const dark = !!s && (s.mode === 'dark' || (s.mode === 'system' && sysDark));

  // theme tokens
  useEffect(() => {
    if (s) applyTheme(s.theme, dark);
  }, [s?.theme, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // collapse panels when the window becomes phone-sized
  useEffect(() => {
    let wasMobile = innerWidth <= 760;
    const onResize = () => {
      const mobile = innerWidth <= 760;
      if (mobile && !wasMobile) setUIState((u) => ({ ...u, paneOpen: false, thread: null, sideOpen: false }));
      if (!mobile && wasMobile) setUIState((u) => ({ ...u, paneOpen: true }));
      wasMobile = mobile;
    };
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  const update = useCallback((fn: (d: State) => void) => {
    setS((prev) => {
      if (!prev) return prev;
      const d = structuredClone(prev);
      fn(d);
      return d;
    });
  }, []);

  const setUI = useCallback((patch: Partial<UI> | ((u: UI) => Partial<UI>)) => {
    setUIState((u) => ({ ...u, ...(typeof patch === 'function' ? patch(u) : patch) }));
  }, []);

  const toast = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setT({ text, undo: undo || null, key: Date.now() });
    toastTimer.current = setTimeout(() => setT(null), undo ? 6000 : 2600);
  }, []);

  const nextId = useCallback(() => ++uidRef.current, []);

  const resetAll = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    const st = initialState();
    uidRef.current = st.uid;
    setS(st);
    setUIState(initialUI());
  }, []);

  const value = useMemo<Ctx | null>(
    () => (s ? { s, update, ui, setUI, toast, nextId, dark, resetAll } : null),
    [s, update, ui, setUI, toast, nextId, dark, resetAll],
  );

  return (
    <>
      {value ? <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider> : <Splash />}
      <div id="toast" role="status" aria-live="polite" className={t ? 'on' : ''}>
        {t && (
          <>
            <span>{t.text}</span>
            {t.undo && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const u = t.undo;
                    setT(null);
                    u?.();
                  }}
                >
                  Undo
                </button>
                <i>6s</i>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Splash() {
  return (
    <div className="splash" aria-label="Loading Seek">
      <span className="slogo">
        <i>S</i>
        <b>Seek</b>
      </span>
    </div>
  );
}
