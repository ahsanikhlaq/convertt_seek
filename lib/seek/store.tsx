'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { backendOn, currentAccount, forgetAccount, sb, type Account } from './backend';
import { DEFAULT_THEME, initialState, PEOPLE, STATE_VERSION, STATUSES, type State } from './data';
import { initialsOf } from './format';
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

/**
 * Copies the signed-in account (or its absence) onto the app state. Used at start-up and after sign-in.
 * With a backend, the prototype's sample chats never show: the saved chats are kept only when they belong to
 * this same account and organization (so a reload shows them at once while fresh ones load).
 */
export function applyAccount(d: State, acc: Account | null) {
  // people who are only a client of an agency (no team of their own) get just their client space
  // a new owner goes straight to organisation setup; invited teammates and clients set up their profile first
  d.session = !acc ? 'out' : acc.workspace ? (acc.onboarded ? 'in' : 'profile') : acc.clientSpaces.length ? (acc.onboarded ? 'client' : 'profile') : 'setup';
  const owner = acc ? acc.id + ':' + (acc.workspace?.id ?? '') : '';
  if (backendOn && d.owner !== owner) {
    d.owner = owner;
    d.workspaces.C = { ch: 'general', channels: [], msgs: {} };
    d.dms = {};
    d.dm = '';
    d.lc = {};
    d.cs = '';
  }
  if (acc && !acc.workspace && acc.clientSpaces[0]) {
    const c = acc.clientSpaces.find((x) => x.id === d.cs) ?? acc.clientSpaces[0];
    d.cs = c.id;
    d.ws.name = c.agency;
    d.ws.logo = c.agencyLogo ?? undefined;
  }
  if (!acc) return;
  d.orgs = acc.orgs.map((o) => ({ id: o.id, name: o.name, logo: o.logo ?? undefined }));
  d.orgId = acc.workspace?.id;
  d.email = acc.email;
  // your real profile replaces the prototype's sample person
  d.me = { ...d.me, email: acc.email, name: acc.name.trim() || acc.email.split('@')[0] || 'You', title: acc.title, tz: acc.timeZone || d.me.tz, dnd: !!acc.dndUntil && new Date(acc.dndUntil) > new Date() };
  const st = STATUSES.find((x) => x[0] === acc.status);
  if (st) d.status = { k: st[0], t: st[1] };
  setMe(d.me.name);
  if (acc.workspace) {
    d.ws.name = acc.workspace.name;
    d.ws.logo = acc.workspace.logo ?? undefined;
    // the organisation's brand colour is everyone's accent unless they picked their own
    if (acc.workspace.accent && d.theme.acc === DEFAULT_THEME.acc) d.theme = { ...d.theme, acc: acc.workspace.accent };
  }
  // a real account starts setup with no sample teammates to invite
  else d.ws.invites = [];
}

/** Your name and initials wherever your avatar shows (you are always person 'AH'). */
export function setMe(name: string) {
  PEOPLE.AH = { ...PEOPLE.AH, name, role: 'You', initials: initialsOf(name) };
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

  // load saved state once, on the client; with a backend, who is signed in comes from Supabase
  useEffect(() => {
    let alive = true;
    (async () => {
      const st = load();
      if (backendOn) {
        const acc = await currentAccount().catch(() => null);
        applyAccount(st, acc);
      }
      if (!alive) return;
      uidRef.current = st.uid;
      setS(st);
    })();
    const sub = backendOn
      ? sb().auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_OUT') {
            forgetAccount();
            setS((p) => (p ? { ...p, session: 'out' } : p));
          }
        }).data.subscription
      : null;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSysDark(mq.matches);
    const onMq = () => setSysDark(mq.matches);
    mq.addEventListener?.('change', onMq);
    return () => {
      alive = false;
      sub?.unsubscribe();
      mq.removeEventListener?.('change', onMq);
    };
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
      // structuredClone needs Safari 15.4+; older iPhones fall back to a JSON copy (state is plain JSON)
      const d: State = typeof structuredClone === 'function' ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
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
    // the toast promises 10s to undo, so keep it up that long
    toastTimer.current = setTimeout(() => setT(null), undo ? 10000 : 2600);
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
                <i>10s</i>
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
