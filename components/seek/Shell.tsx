'use client';

import { useEffect, useState } from 'react';

import { backendOn, forgetAccount, preferOrg } from '@/lib/seek/backend';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WORKSPACES, type WorkspaceId } from '@/lib/seek/data';
import { ROUTES, type RouteKey } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { NotesBell } from './NotesBell';
import { usePopovers } from './Popovers';
import { Avatar, Icon, Logo, ModeSeg, OrgMark, StatusDot, type IconName } from './ui';
import { Ic } from './icons';
import { useResync } from '@/lib/seek/resync';
import { unreadCounts } from '@/lib/seek/liveSync';

export function useWorkspaceSwitch() {
  const { s, update, setUI, toast } = useSeek();
  const router = useRouter();
  return (w: WorkspaceId) => {
    if (w === s.wsId) {
      toast('You are in ' + (backendOn ? s.ws.name : WORKSPACES[w].name));
      return;
    }
    update((d) => {
      d.wsId = w;
    });
    setUI({ thread: null, sideOpen: false, chTab: 'Messages' });
    router.push(ROUTES.channels);
    toast('Switched to ' + WORKSPACES[w].name);
  };
}

/** The People rail icon: two heads, drawn like the rail's other line icons. */
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2" />
    </svg>
  );
}

const NAV: [RouteKey, IconName | 'people', string][] = [
  ['channels', 'team', 'Home'],
  ['dms', 'dm', 'DMs'],
  ['people', 'people', 'People'],
  ['clients', 'cl', 'Clients'],
  ['meetings', 'mt', 'Meetings'],
  ['decisions', 'dc', 'Decisions'],
  ['agents', 'ap', 'Apps'],
];

type WsItem = { key: string; name: string; mark: React.ReactNode; on: boolean; open: () => void; unread?: number };

/** Unread messages in your other organisations (checked every minute, and when you come back to Seek). */
function useOtherOrgUnread(ids: string[]) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const sync = useResync();
  const key = ids.join(',');
  useEffect(() => {
    if (!backendOn || !ids.length) return;
    let alive = true;
    const check = async () => {
      const res = await Promise.all(ids.map((id) => unreadCounts(id).then((m) => [id, [...m.values()].reduce((a, b) => a + b, 0)] as const).catch(() => [id, 0] as const)));
      if (alive) setCounts(new Map(res));
    };
    void check();
    const t = setInterval(() => document.visibilityState === 'visible' && void check(), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key, sync]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}

/** The workspaces to list: the two samples in demo mode, or every organisation you belong to with a backend. */
function useWorkspaceList(): { items: WsItem[] } {
  const { s, toast } = useSeek();
  const sw = useWorkspaceSwitch();
  const other = useOtherOrgUnread(backendOn ? (s.orgs ?? []).filter((o) => o.id !== s.orgId).map((o) => o.id) : []);
  if (!backendOn)
    return {
      items: (Object.keys(WORKSPACES) as WorkspaceId[]).map((w) => ({ key: w, name: WORKSPACES[w].name, mark: w, on: s.wsId === w, open: () => sw(w) })),
    };
  const orgs = s.orgs?.length ? s.orgs : [{ id: s.orgId ?? 'current', name: s.ws.name || 'Workspace', logo: s.ws.logo }];
  return {
    items: orgs.map((o) => {
      const on = o.id === s.orgId || orgs.length === 1;
      return {
        unread: on ? 0 : (other.get(o.id) ?? 0),
        key: o.id,
        name: o.name,
        mark: <OrgMark name={o.name} logo={on ? s.ws.logo ?? o.logo : o.logo} />,
        on,
        open: () => {
          if (on) {
            toast('You are in ' + o.name);
            return;
          }
          // open the other organisation: everything reloads for it
          preferOrg(o.id);
          forgetAccount();
          toast('Switching to ' + o.name + '…');
          location.assign(ROUTES.channels);
        },
      };
    }),
  };
}

function Rail({ active }: { active: RouteKey }) {
  const { s, ui, setUI, toast } = useSeek();
  const { items } = useWorkspaceList();
  const dot: Partial<Record<RouteKey, boolean>> = {
    dms: Object.values(s.dms).some((d) => d && d.unread > 0),
    clients: !backendOn && !s.replied,
  };
  return (
    <nav className="rail" aria-label="Main">
      {items.map((w) => (
        <button key={w.key} type="button" className={'wsb' + (w.on ? ' on' : '')} onClick={w.open} title={w.name + (w.unread ? ' · ' + w.unread + ' unread' : '')} aria-label={'Workspace ' + w.name + (w.unread ? ', ' + w.unread + ' unread' : '')}>
          {w.mark}
          {!!w.unread && <span className="wsun">{w.unread > 99 ? '99+' : w.unread}</span>}
        </button>
      ))}
      <button type="button" className="wsb add" onClick={() => toast('Create or join another workspace')} aria-label="Add a workspace">
        <Ic n="plus" size={18} />
      </button>
      <span className="sep"></span>
      {NAV.map(([r, i, l]) => {
        const on = r === 'channels' ? active === 'channels' || (active === 'dms' && ui.home) : r === 'dms' ? active === 'dms' && !ui.home : active === r || (r === 'agents' && active === 'apps');
        return (
          <Link key={r} href={ROUTES[r]} className={'ri' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined} onClick={() => setUI({ sideOpen: false, home: false })}>
            {i === 'people' ? <PeopleIcon /> : <Icon name={i} />}
            {l}
            {dot[r] && <span className="dot"></span>}
          </Link>
        );
      })}
      <button type="button" className="me" onClick={() => setUI((u) => ({ profile: !u.profile }))} aria-label="Your profile">
        <Avatar k="AH" size={34} />
        <StatusDot />
      </button>
    </nav>
  );
}

function TopBar() {
  const { s, dark, update, setUI, toast } = useSeek();
  const pop = usePopovers();
  return (
    <header className="tbar">
      <Logo />
      <button type="button" className="tthm" onClick={(e) => pop.toggleTheme(e.currentTarget)} title="Theme and branding">
        <span className="sw3">
          <i style={{ background: 'var(--sbg)' }}></i>
          <i style={{ background: 'var(--body)' }}></i>
          <i style={{ background: 'var(--v)' }}></i>
        </span>
        Theme
      </button>
      <button type="button" className="tsearch" onClick={() => setUI({ palette: true })}>
        <Ic n="search" /> <span>Search {backendOn ? s.ws.name || 'Seek' : WORKSPACES[s.wsId].name}</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="tr">
        <button
          type="button"
          className="tmode"
          title="Switch light / dark"
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => {
            update((d) => {
              d.mode = dark ? 'light' : 'dark';
            });
            toast(dark ? 'Light mode on' : 'Dark mode on');
          }}
        >
          {dark ? <Ic n="sun" /> : <Ic n="moon" />}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => toast('Help centre opens in a new tab')}>
          <Ic n="help" /> Help
        </button>
        {backendOn ? (
          <NotesBell />
        ) : (
          <button type="button" className="btn sm ghost" onClick={() => toast('3 new notifications')} aria-label="Notifications, 3 new">
            <Ic n="bell" size={18} /><span className="badge" style={{ marginLeft: 2 }}>3</span>
          </button>
        )}
        <button type="button" className="tme" onClick={() => setUI((u) => ({ profile: !u.profile }))} aria-label="Your profile">
          <Avatar k="AH" size={30} />
          <StatusDot />
        </button>
      </div>
    </header>
  );
}

/** Left list column (becomes a full-screen drawer on phones). */
export function Sidebar({ title, sub, action, children }: { title: string; sub: string; action?: React.ReactNode; children: React.ReactNode }) {
  const { s, setUI } = useSeek();
  const { items } = useWorkspaceList();
  const pop = usePopovers();
  return (
    <aside className="side" aria-label={title}>
      <div className="sh">
        <div className="dbrand">
          <Logo />
          <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={(e) => pop.toggleTheme(e.currentTarget)}>
            <Ic n="palette" /> Theme
          </button>
        </div>
        <div className="mrow">
          <ModeSeg />
        </div>
        <div className="wsrow">
          {items.map((w) => (
            <button key={w.key} type="button" className={'si' + (w.on ? ' on' : '')} style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--sln)' }} onClick={w.open}>
              <span className={'wsb' + (w.on ? ' on' : '')} style={{ width: 24, height: 24, fontSize: 13, borderRadius: 7 }}>
                {w.mark}
              </span>
              {w.name}
            </button>
          ))}
        </div>
        <div className="t">
          <b role="heading" aria-level={1}>
            {title}
          </b>
          {action}
          <button type="button" className="btn sm ghost close" style={{ display: 'none' }} onClick={() => setUI({ sideOpen: false })} aria-label="Close menu">
            <Ic n="close" />
          </button>
        </div>
        <small>{sub}</small>
        <button type="button" className="search" onClick={() => setUI({ palette: true, sideOpen: false })} style={{ width: '100%', textAlign: 'left' }}>
          <Ic n="search" /> Search {backendOn ? s.ws.name || 'Seek' : WORKSPACES[s.wsId].name} <kbd>⌘K</kbd>
        </button>
      </div>
      <div className="sl">{children}</div>
    </aside>
  );
}

/** Header row of the main column. */
export function MainHeader({ title, sub, right, below }: { title: React.ReactNode; sub: React.ReactNode; right?: React.ReactNode; below?: React.ReactNode }) {
  const { setUI } = useSeek();
  return (
    <>
      <div className="mh">
        <button type="button" className="menu" onClick={() => setUI((u) => ({ sideOpen: !u.sideOpen }))} aria-label="Menu">
          <Ic n="menu" size={20} />
        </button>
        <span className="mlogo" aria-hidden="true">
          S
        </span>
        <div className="tt">
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        {right}
        {backendOn && (
          <span className="mbell">
            <NotesBell />
          </span>
        )}
        <button type="button" className="mprof" onClick={() => setUI((u) => ({ profile: !u.profile }))} aria-label="Your profile">
          <Avatar k="AH" size={32} />
          <StatusDot />
        </button>
      </div>
      {below}
    </>
  );
}

/** Right-hand detail pane (full screen on phones). */
export function Pane({ title, sub, icon, onClose, children }: { title: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="pane">
      <div className="ph">
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{title}</b>
          {sub && <small>{sub}</small>}
        </div>
        <button type="button" className="x" onClick={onClose} aria-label="Close panel">
          <Ic n="close" size={16} />
        </button>
      </div>
      <div className="pb">{children}</div>
    </aside>
  );
}

/** The left rail for a client: their agency's mark and their profile, nothing of the agency's team. */
export function ClientRail() {
  const { s, setUI } = useSeek();
  return (
    <nav className="rail" aria-label="Main">
      <span className="wsb on" title={s.ws.name} aria-label={s.ws.name}>
        <OrgMark name={s.ws.name} logo={s.ws.logo} />
      </span>
      <span className="sep"></span>
      <span className="ri on" aria-current="page">
        <Icon name="cl" />
        Project
      </span>
      <button type="button" className="me" onClick={() => setUI((u) => ({ profile: !u.profile }))} aria-label="Your profile">
        <Avatar k="AH" size={34} />
        <StatusDot />
      </button>
    </nav>
  );
}

/** `wide`: no list column; the page uses the full width (Account settings). */
export function Shell({ active, side, pane, rail, wide, children }: { active: RouteKey; side: React.ReactNode; pane?: React.ReactNode; rail?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  const { ui } = useSeek();
  return (
    <div className={'app' + (ui.sideOpen ? ' side-open' : '') + (pane ? ' has-pane' : '') + (wide ? ' wide' : '')}>
      {rail ?? <Rail active={active} />}
      <TopBar />
      {side}
      <main className="main">{children}</main>
      {pane}
    </div>
  );
}
