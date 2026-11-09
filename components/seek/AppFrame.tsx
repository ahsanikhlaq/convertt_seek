'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PEOPLE, STATUSES, WORKSPACES, type PersonKey } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { ROUTES, routeOf, type RouteKey } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { ConfirmDialog, Modal } from './Dialogs';
import { usePopovers } from './Popovers';
import { Avatar, ModeSeg, Switch } from './ui';

const AUTH_ROUTES: RouteKey[] = ['signup', 'setup'];

/** Wraps every screen: sends signed-out people to sign-up, and hosts the palette, profile and shortcuts. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const { s, ui, setUI } = useSeek();
  const router = useRouter();
  const pathname = usePathname();
  const route = routeOf(pathname);

  // where this person is allowed to be
  const target: string | null = (() => {
    if (s.session === 'in') return route && AUTH_ROUTES.includes(route) ? ROUTES.channels : null;
    if (s.session === 'setup') return route === 'setup' || route === 'signup' ? null : ROUTES.setup;
    return route === 'signup' ? null : ROUTES.signup;
  })();

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // close transient UI when the screen changes
  useEffect(() => {
    setUI({ sideOpen: false, menu: null, palette: false, logOf: null });
    document.querySelector('.feed,.dl,.pg,.inv,.auth')?.scrollTo?.(0, 0);
  }, [pathname, setUI]);

  // keyboard: ⌘K / Ctrl+K search, Escape closes the top-most layer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (s.session !== 'in') return;
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
  }, [s.session, setUI]);

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
      {children}
      {s.session === 'in' && ui.palette && <Palette />}
      {s.session === 'in' && ui.profile && <ProfileDrawer />}
    </>
  );
}

/* ---------------- ⌘K palette ---------------- */

type Hit = { label: string; kind: string; go: () => void };

function Palette() {
  const { s, update, setUI } = useSeek();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const ws = s.workspaces[s.wsId];
    const to = (r: RouteKey, fn?: () => void) => () => {
      if (fn) fn();
      setUI({ palette: false, thread: null, chTab: 'Messages' });
      router.push(ROUTES[r]);
    };
    const all: Hit[] = [
      ...ws.channels.map((c) => ({
        label: '# ' + c.id,
        kind: 'channel',
        go: to('channels', () =>
          update((d) => {
            d.workspaces[d.wsId].ch = c.id;
            const x = d.workspaces[d.wsId].channels.find((y) => y.id === c.id);
            if (x) x.unread = 0;
          }),
        ),
      })),
      ...(Object.keys(s.dms) as PersonKey[]).map((k) => ({
        label: 'DM · ' + PEOPLE[k].name,
        kind: 'person',
        go: to('dms', () =>
          update((d) => {
            d.dm = k;
            d.dms[k]!.unread = 0;
          }),
        ),
      })),
      ...s.spaces.map((sp) => ({
        label: sp.name + ' · Client space',
        kind: 'client',
        go: to('clients', () =>
          update((d) => {
            d.cs = sp.id;
            d.cTab = 'Client chat';
          }),
        ),
      })),
      { label: 'Schedule a call', kind: 'meeting', go: to('meetings') },
      { label: 'Decisions log', kind: 'screen', go: to('decisions') },
      { label: 'AI agents', kind: 'screen', go: to('agents') },
      { label: 'All apps', kind: 'screen', go: to('apps') },
      { label: 'Invite a client', kind: 'screen', go: to('invite') },
    ];
    const ql = q.trim().toLowerCase();
    return ql ? all.filter((h) => h.label.toLowerCase().includes(ql)) : all;
  }, [q, s, update, setUI, router]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  return (
    <Modal onClose={() => setUI({ palette: false })} width={520} top>
      <div className="mhd">
        <input
          className="inp"
          placeholder={`Jump to a channel, person or screen in ${WORKSPACES[s.wsId].name}…`}
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
      <div className="mb" style={{ gap: 2, padding: 8 }} ref={listRef} role="listbox" aria-label="Results">
        {hits.length ? (
          hits.map((h, i) => (
            <button key={h.label} type="button" role="option" aria-selected={i === sel} className={'si' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={h.go}>
              <span className="x">
                <b>{h.label}</b>
              </span>
              <span className="tag">{h.kind}</span>
            </button>
          ))
        ) : (
          <div className="empty">No results</div>
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
              <span>Email</span>
              <b>{s.me.email}</b>
            </div>
            <div>
              <span>Local time</span>
              <b>
                {now()} · {s.me.tz}
              </b>
            </div>
            <div>
              <span>Workspace</span>
              <b>{WORKSPACES[s.wsId].name}</b>
            </div>
          </div>
          <div>
            <div className="lbl" style={{ marginBottom: 8 }}>
              Appearance
            </div>
            <ModeSeg />
          </div>
          <div className="trow">
            <div>
              <b>Pause notifications</b>
              <small>Mute everything except urgent for 1 hour</small>
            </div>
            <Switch
              on={s.me.dnd}
              label="Pause notifications"
              onClick={() => {
                update((d) => {
                  d.me.dnd = !d.me.dnd;
                });
                toast(s.me.dnd ? 'Notifications on' : 'Notifications paused for 1 hour');
              }}
            />
          </div>
          <div className="pf-ac">
            <button type="button" className="btn" onClick={(e) => pop.toggleTheme(e.currentTarget)}>
              🎨 Theme & branding
            </button>
            <button type="button" className="btn" onClick={() => toast('Preferences saved')}>
              ⚙ Preferences
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirmReset(true)}>
              ↺ Reset workspace data
            </button>
          </div>
        </div>
        <div className="mf" style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--ln)' }}>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
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
            onClick={() => {
              update((d) => {
                d.me.name = name.trim() || d.me.name;
                d.me.title = title.trim() || d.me.title;
              });
              close();
              toast('Profile saved');
            }}
          >
            Save profile
          </button>
        </div>
      </aside>
      {confirmReset && (
        <ConfirmDialog
          title="Reset workspace data?"
          body="Messages, decisions, settings and theme on this device go back to the start. You will be signed out."
          confirm="Reset"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            resetAll();
            router.push(ROUTES.signup);
          }}
        />
      )}
    </>
  );
}
