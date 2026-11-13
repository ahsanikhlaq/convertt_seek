'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PEOPLE, STATUSES, WORKSPACES, type PersonKey } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { backendOn, currentAccount, saveLook, saveProfile, saveStatus, signOut, uploadAvatar } from '@/lib/seek/backend';
import { prototypeName, ROUTES, routeFromPrototype, routeOf, type RouteKey } from '@/lib/seek/routes';
import { setMe, useSeek } from '@/lib/seek/store';
import { useLiveSync } from '@/lib/seek/liveSync';
import { useLiveNotes } from '@/lib/seek/liveNotes';
import { useLiveDecisions } from '@/lib/seek/liveDecisions';
import { useLiveSaved, useLiveTasks, useReminders } from '@/lib/seek/liveExtras';
import { useWorkspaceEmoji } from '@/lib/seek/liveEmoji';
import { SEARCH_KINDS, searchSeek, type Found, type SearchKind } from '@/lib/seek/liveSearch';
import { dmThreadWith, openConversation } from '@/lib/seek/liveExtras';
import { flashMessage } from '@/lib/seek/liveDecisions';
import { toUiId } from '@/lib/seek/live';
import { useOpenFile } from './Files';
import { ConfirmDialog, Modal } from './Dialogs';
import { WorkspaceSettings } from './WorkspaceSettings';
import { PauseSelect } from './PauseSelect';
import { usePopovers } from './Popovers';
import { Avatar, OrgMark } from './ui';

/**
 * Wraps every screen and hosts the palette, profile and shortcuts. In demo mode, as in the product prototype,
 * every screen opens directly; with a real backend (lib/seek/backend.ts) signed-out people go to sign-up.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const { s, ui, setUI } = useSeek();
  const router = useRouter();
  const pathname = usePathname();
  const route = routeOf(pathname);

  // live reactions and deletions, wherever they happen
  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    if (backendOn && (s.session === 'in' || s.session === 'client')) void currentAccount().then((a) => setMeId(a?.id ?? null));
  }, [s.session]);
  useLiveSync(meId);
  useLiveNotes(meId);
  useLiveDecisions(meId);
  useWorkspaceEmoji(meId);
  useSaveLook();
  const online = useOnline();
  useLiveSaved(meId);
  useLiveTasks(meId);
  useReminders(meId);

  // with a real backend, screens need a signed-in account with a profile; demo mode keeps every screen open like
  // the prototype. The welcome and join screens are always open: invite emails and invite links land there,
  // signed in or not.
  const allowed: Record<typeof s.session, RouteKey[] | null> = {
    in: null,
    profile: ['welcome'],
    setup: ['setup', 'signup', 'welcome'],
    out: ['signup', 'welcome'],
    // a client only ever sees their own client space
    client: ['clients', 'open', 'account'],
  };
  const home = { in: ROUTES.channels, profile: ROUTES.welcome, setup: ROUTES.setup, out: ROUTES.signup, client: ROUTES.clients }[s.session];
  const ok = allowed[s.session];
  const target: string | null =
    !backendOn || route === 'welcome' || route === 'join' || route === 'privacy' || route === 'terms'
      ? null
      : ok
        ? route && ok.includes(route)
          ? null
          : home
        : route === 'signup' || route === 'setup'
          ? home
          : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // prototype links (`#client`, `#schedule`, …) and its review page (`seekGo`) open the matching screen
  useEffect(() => {
    const open = (name: unknown) => {
      const r = typeof name === 'string' ? routeFromPrototype(name) : null;
      if (r) router.replace(ROUTES[r]);
      return !!r;
    };
    // the new path replaces the URL, hash included
    const onHash = () => open(location.hash);
    const onMsg = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && 'seekGo' in e.data) open(e.data.seekGo);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('message', onMsg);
    };
  }, [router]);

  // close transient UI when the screen changes, and tell a review page around us where we are
  useEffect(() => {
    setUI({ sideOpen: false, menu: null, palette: false, logOf: null });
    document.querySelector('.feed,.dl,.pg,.inv,.auth')?.scrollTo?.(0, 0);
    if (route && window.parent !== window) {
      try {
        window.parent.postMessage({ seekRoute: prototypeName(route) }, '*');
      } catch {}
    }
  }, [pathname, route, setUI]);

  // keyboard: ⌘K / Ctrl+K search, Escape closes the top-most layer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setUI((u) => ({ palette: !u.palette }));
        return;
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setUI((u) => {
          if (u.palette) return { palette: false };
          if (u.profile) return { profile: false };
          if (u.logOf) return { logOf: null };
          if (u.menu != null) return { menu: null };
          if (u.sideOpen) return { sideOpen: false };
          return {};
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setUI]);

  // the desktop app's menu navigates by dispatching this event
  useEffect(() => {
    const onNav = (e: Event) => {
      const to = (e as CustomEvent<string>).detail;
      if (typeof to === 'string' && to.startsWith('/')) router.push(to);
    };
    window.addEventListener('seek:navigate', onNav);
    return () => window.removeEventListener('seek:navigate', onNav);
  }, [router]);

  if (target) return null;

  return (
    <>
      {backendOn && !online && (
        <div className="offline" role="status">
          You&apos;re offline. Messages that don&apos;t send are kept and go when you&apos;re back.
        </div>
      )}
      {children}
      {ui.palette && <Palette />}
      {ui.profile && <ProfileDrawer />}
    </>
  );
}

/* ---------------- ⌘K palette ---------------- */

type Hit = { label: string; kind: string; go: () => void; sub?: string; key?: string };

function Palette() {
  const { s, update, setUI } = useSeek();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // backend mode: real search over messages, files, decisions, people and client spaces
  const [kind, setKind] = useState<SearchKind>('all');
  const [found, setFound] = useState<Found[] | null>(null);
  const toast = useSeek().toast;
  const openFile = useOpenFile();
  const searching = backendOn && q.trim().length >= 2;
  useEffect(() => {
    if (!searching) {
      setFound(null);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      void searchSeek(q.trim(), s.session === 'in' ? (s.orgId ?? null) : null, kind).then((r) => alive && setFound(r ?? []));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, kind, searching]); // eslint-disable-line react-hooks/exhaustive-deps
  const openFound = async (f: Found) => {
    setUI({ palette: false, thread: null, chTab: 'Messages' });
    if (f.kind === 'file') {
      void openFile({ path: f.ref, name: f.title, size: 0, type: '' });
      return;
    }
    if (f.kind === 'person') {
      if (!f.userId) return;
      const thread = await dmThreadWith(f.userId);
      if (!thread) return toast('You can message people on your team');
      router.push(await openConversation('dm:' + thread, update, s.meId ?? null));
      return;
    }
    if (!f.conv) return;
    router.push(await openConversation(f.conv, update, s.meId ?? null));
    if (f.messageId != null) flashMessage(toUiId(f.messageId));
  };

  const hits = useMemo<Hit[]>(() => {
    // with a backend only your real team's channels are listed (the sample workspace and client spaces are not)
    const ws = backendOn ? s.workspaces.C : s.workspaces[s.wsId];
    const to = (r: RouteKey, fn?: () => void) => () => {
      if (fn) fn();
      setUI({ palette: false, thread: null, chTab: 'Messages' });
      router.push(ROUTES[r]);
    };
    const all: Hit[] = [
      ...ws.channels.map((c) => ({
        label: '# ' + c.id,
        kind: 'channels',
        go: to('channels', () =>
          update((d) => {
            if (backendOn) d.wsId = 'C';
            d.workspaces[d.wsId].ch = c.id;
            const x = d.workspaces[d.wsId].channels.find((y) => y.id === c.id);
            if (x) x.unread = 0;
          }),
        ),
      })),
      ...(Object.keys(s.dms) as PersonKey[]).map((k) => ({
        label: 'DM · ' + (PEOPLE[k]?.name ?? 'Someone'),
        kind: 'dms',
        go: to('dms', () =>
          update((d) => {
            d.dm = k;
            d.dms[k]!.unread = 0;
          }),
        ),
      })),
      ...(backendOn ? [] : s.spaces).map((sp) => ({
        label: sp.name + ' · Client chat',
        kind: 'client',
        go: to('clients', () =>
          update((d) => {
            d.cs = sp.id;
            d.cTab = 'Client chat';
          }),
        ),
      })),
      { label: 'Schedule a call', kind: 'schedule', go: to('meetings') },
      { label: 'Decisions log', kind: 'decisions', go: to('decisions') },
      { label: 'AI agents', kind: 'agents', go: to('agents') },
      { label: 'All apps', kind: 'apps', go: to('apps') },
      { label: 'Invite a client', kind: 'invite', go: to('invite') },
      { label: 'Workspace setup', kind: 'setup', go: to('setup') },
      { label: 'Sign up screen', kind: 'signup', go: to('signup') },
    ];
    const ql = q.trim().toLowerCase();
    // a client only ever gets their own space, so the team's screens aren't offered
    const base = s.session === 'client' ? [] : ql ? all.filter((h) => h.label.toLowerCase().includes(ql)) : all;
    const KIND: Record<Found['kind'], string> = { message: 'message', file: 'file', decision: 'decision', person: 'person', space: 'client' };
    const live: Hit[] = (found ?? []).map((f) => ({
      key: f.kind + ':' + f.ref,
      label: f.kind === 'message' ? (f.snippet ?? '') : f.title,
      sub:
        f.kind === 'message'
          ? (PEOPLE[f.userId === s.meId ? 'AH' : (f.userId ?? '')]?.name ?? 'Someone') + ' · ' + (f.conv?.startsWith('ch:') ? '#' : '') + f.title + (f.at ? ' · ' + new Date(f.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')
          : (f.snippet ?? undefined),
      kind: KIND[f.kind],
      go: () => void openFound(f),
    }));
    return kind === 'all' ? [...base, ...live] : live;
  }, [q, s, update, setUI, router, found, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  return (
    <Modal onClose={() => setUI({ palette: false })} width={520} top>
      <div className="mhd">
        <input
          className="inp"
          placeholder={backendOn ? 'Search messages, files, decisions, people…' : 'Jump to a channel, person or screen…'}
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (hits.length) setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              hits[sel]?.go();
            }
          }}
          style={{ border: 0, boxShadow: 'none', height: 36, padding: 0 }}
        />
        <kbd className="hide-m">esc</kbd>
      </div>
      {searching && (
        <div className="chips" style={{ padding: '0 12px 6px', flexWrap: 'wrap' }}>
          {SEARCH_KINDS.filter(([k]) => s.session !== 'client' || (k !== 'person' && k !== 'space')).map(([k, l]) => (
            <button key={k} type="button" className={'chip' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <div className="mb" style={{ gap: 2, padding: 8 }} ref={listRef} role="listbox" aria-label="Results">
        {hits.length ? (
          hits.map((h, i) => (
            <button key={h.key ?? h.label} type="button" role="option" aria-selected={i === sel} className={'si' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={h.go}>
              <span className="x">
                <b style={h.sub ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' } : undefined}>{h.label}</b>
                {h.sub && <small>{h.sub}</small>}
              </span>
              <span className="tag">{h.kind}</span>
            </button>
          ))
        ) : (
          <div className="empty">{searching && !found ? 'Searching…' : searching ? 'No results for “' + q.trim() + '”' + (kind !== 'all' ? ' in ' + SEARCH_KINDS.find((x) => x[0] === kind)![1].toLowerCase() : '') : 'No results'}</div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- profile drawer ---------------- */

function ProfileDrawer() {
  const { s, update, setUI, toast, resetAll } = useSeek();
  const router = useRouter();
  const pop = usePopovers();
  const [name, setName] = useState(s.me.name);
  const [title, setTitle] = useState(s.me.title);
  const [confirmReset, setConfirmReset] = useState(false);
  const close = () => setUI({ profile: false });
  const st = STATUSES.find((x) => x[0] === s.status.k)!;
  // admins open workspace settings (name, logo, …) from here
  const [org, setOrg] = useState<{ id: string; admin: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  useEffect(() => {
    if (!backendOn) return;
    void currentAccount().then((a) => a?.workspace && setOrg({ id: a.workspace.id, admin: ['owner', 'admin'].includes(a.workspace.role) }));
  }, []);
  const photoIn = useRef<HTMLInputElement>(null);
  const changePhoto = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) {
      toast('Choose a PNG, JPG or WebP image up to 5 MB');
      return;
    }
    setUploading(true);
    const r = await uploadAvatar(f);
    setUploading(false);
    if (r.error || !r.url) {
      toast(r.error ?? 'Couldn’t upload the photo');
      return;
    }
    PEOPLE.AH = { ...PEOPLE.AH, photo: r.url };
    update(() => {});
    toast('Photo updated');
  };

  return (
    <>
      <div className="scrim" style={{ background: 'rgba(20,10,20,.35)' }} onClick={close}></div>
      <aside className="drawer prof" role="dialog" aria-label="Profile">
        <div className="ph">
          <b>Profile</b>
          <button type="button" className="x" onClick={close} aria-label="Close profile">
            ×
          </button>
        </div>
        <div className="pb">
          <div className="pf-top">
            <span className="pf-av">
              <Avatar k="AH" size={84} />
              <span className={'st ' + s.status.k}></span>
              {backendOn && (
                <>
                  <button type="button" className="pf-photo" disabled={uploading} onClick={() => photoIn.current?.click()} aria-label="Change your photo" title="Change your photo">
                    ✎
                  </button>
                  <input
                    ref={photoIn}
                    type="file"
                    hidden
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      void changePhoto(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </>
              )}
            </span>
            <div>
              <b className="pf-n">{s.me.name}</b>
              <small>{s.me.title}</small>
              <span className="pf-s">
                {st[2]} {s.status.t}
              </span>
            </div>
          </div>
          <div>
            <div className="lbl" style={{ marginBottom: 8 }}>
              Set a status
            </div>
            <div className="pf-st">
              {STATUSES.map(([k, t, i]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={s.status.k === k}
                  className={s.status.k === k ? 'on' : ''}
                  onClick={() => {
                    update((d) => {
                      d.status = { k, t };
                    });
                    if (backendOn) void saveStatus({ status: k });
                    toast('Status: ' + t);
                  }}
                >
                  {i} {t}
                </button>
              ))}
            </div>
          </div>
          <div className="fld">
            <label htmlFor="pfn">Display name</label>
            <input className="inp" id="pfn" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="pft">Title</label>
            <input className="inp" id="pft" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="kv">
            <div>
              <span>Signed in as</span>
              <b>{s.me.email}</b>
            </div>
            <div>
              <span>Local time</span>
              <b>
                {now()} · {s.me.tz}
              </b>
            </div>
            <div>
              <span>Organization</span>
              <b style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {backendOn && <OrgMark name={s.ws.name} logo={s.ws.logo} size={22} />}
                {backendOn ? s.ws.name : WORKSPACES[s.wsId].name}
              </b>
            </div>
          </div>
          <PauseSelect id="pf-pause" />
          <div className="pf-ac">
            <button type="button" className="btn" onClick={(e) => pop.toggleTheme(e.currentTarget)}>
              🎨 Theme & branding
            </button>
            {backendOn ? (
              org && (
                <button type="button" className="btn" onClick={() => setWsOpen(true)}>
                  ⚙ Workspace settings
                </button>
              )
            ) : (
              <button type="button" className="btn ghost" onClick={() => setConfirmReset(true)}>
                ↺ Reset workspace data
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn pf-acct"
            onClick={() => {
              close();
              router.push(ROUTES.account);
            }}
          >
            <span>
              ⚙ Account settings
              <small>Notifications, sounds, messages, time zone, sign-in</small>
            </span>
            <i aria-hidden="true">›</i>
          </button>
        </div>
        <div className="mf" style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--ln)' }}>
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (backendOn) await signOut();
              update((d) => {
                d.session = 'out';
              });
              close();
              router.push(ROUTES.signup);
              toast('Signed out');
            }}
          >
            Sign out
          </button>
          <span style={{ flex: 1 }}></span>
          <button
            type="button"
            className="btn pri"
            onClick={async () => {
              const n = name.trim() || s.me.name;
              const ti = title.trim() || s.me.title;
              if (backendOn) {
                const err = await saveProfile({ name: n, title: ti });
                if (err) {
                  toast(err);
                  return;
                }
              }
              setMe(n);
              update((d) => {
                d.me.name = n;
                d.me.title = ti;
              });
              close();
              toast('Profile saved');
            }}
          >
            Save profile
          </button>
        </div>
      </aside>
      {wsOpen && <WorkspaceSettings onClose={() => setWsOpen(false)} />}
      {confirmReset && (
        <ConfirmDialog
          title="Reset workspace data?"
          body="Messages, decisions, settings and theme on this device go back to the start. You will be signed out."
          confirm="Reset"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            if (backendOn) await signOut();
            resetAll();
            router.push(ROUTES.signup);
          }}
        />
      )}
    </>
  );
}

/** Whether the browser is online (for the "You're offline" banner). */
function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const sync = () => setOn(navigator.onLine);
    sync();
    addEventListener('online', sync);
    addEventListener('offline', sync);
    return () => {
      removeEventListener('online', sync);
      removeEventListener('offline', sync);
    };
  }, []);
  return on;
}

/** Saves your theme and light/dark mode to your account (a moment after you change them). */
function useSaveLook() {
  const { s, update } = useSeek();
  const on = backendOn && (s.session === 'in' || s.session === 'client');
  const look = JSON.stringify({ theme: s.theme, mode: s.mode });
  useEffect(() => {
    if (!on || !s.savedLook || look === s.savedLook) return;
    const id = setTimeout(() => {
      void saveLook({ theme: s.theme as unknown as Record<string, string>, mode: s.mode });
      update((d) => {
        d.savedLook = look;
      });
    }, 1200);
    return () => clearTimeout(id);
  }, [on, look, s.savedLook]); // eslint-disable-line react-hooks/exhaustive-deps
}
