'use client';

import { backendOn } from '@/lib/seek/backend';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { WORKSPACES, type WorkspaceId } from '@/lib/seek/data';
import { ROUTES, type RouteKey } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { usePopovers } from './Popovers';
import { Avatar, Icon, Logo, ModeSeg, OrgMark, StatusDot, type IconName } from './ui';

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

const NAV: [RouteKey, IconName, string][] = [
  ['channels', 'team', 'Team'],
  ['dms', 'dm', 'DMs'],
  ['clients', 'cl', 'Clients'],
  ['meetings', 'mt', 'Meetings'],
  ['decisions', 'dc', 'Decisions'],
  ['agents', 'ap', 'Apps'],
];

/** The workspaces to list: the two samples in demo mode, or just your real one with a backend. */
function useWorkspaceList() {
  const { s } = useSeek();
  const wsIds: WorkspaceId[] = backendOn ? ['C'] : (Object.keys(WORKSPACES) as WorkspaceId[]);
  const wsName = (w: WorkspaceId) => (backendOn ? s.ws.name || 'Workspace' : WORKSPACES[w].name);
  // your organization's logo (or first letter) with a backend; the sample workspaces' letters in demo mode
  const wsLetter = (w: WorkspaceId): React.ReactNode => (backendOn ? <OrgMark name={s.ws.name} logo={s.ws.logo} /> : w);
  return { wsIds, wsName, wsLetter };
}

function Rail({ active }: { active: RouteKey }) {
  const { s, setUI, toast } = useSeek();
  const { wsIds, wsName, wsLetter } = useWorkspaceList();
  const sw = useWorkspaceSwitch();
  const dot: Partial<Record<RouteKey, boolean>> = {
    dms: Object.values(s.dms).some((d) => d && d.unread > 0),
    clients: !backendOn && !s.replied,
  };
  return (
    <nav className="rail" aria-label="Main">
      {wsIds.map((w) => (
        <button key={w} type="button" className={'wsb' + (s.wsId === w ? ' on' : '')} onClick={() => sw(w)} title={wsName(w)} aria-label={'Workspace ' + wsName(w)}>
          {wsLetter(w)}
        </button>
      ))}
      <button type="button" className="wsb add" onClick={() => toast('Create or join another workspace')} aria-label="Add a workspace">
        ＋
      </button>
      <span className="sep"></span>
      {NAV.map(([r, i, l]) => {
        const on = active === r || (r === 'agents' && active === 'apps');
        return (
          <Link key={r} href={ROUTES[r]} className={'ri' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined} onClick={() => setUI({ sideOpen: false })}>
            <Icon name={i} />
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
        ⌕ <span>Search {backendOn ? s.ws.name || 'Seek' : WORKSPACES[s.wsId].name}</span>
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
          {dark ? '☀' : '☾'}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => toast('Help centre opens in a new tab')}>
          ? Help
        </button>
        <button type="button" className="btn sm ghost" onClick={() => toast(backendOn ? 'No new notifications' : '3 new notifications')} aria-label={backendOn ? 'Notifications, none new' : 'Notifications, 3 new'}>
          🔔{!backendOn && <span className="badge" style={{ marginLeft: 2 }}>3</span>}
        </button>
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
  const { wsIds, wsName, wsLetter } = useWorkspaceList();
  const pop = usePopovers();
  const sw = useWorkspaceSwitch();
  return (
    <aside className="side" aria-label={title}>
      <div className="sh">
        <div className="dbrand">
          <Logo />
          <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={(e) => pop.toggleTheme(e.currentTarget)}>
            🎨 Theme
          </button>
        </div>
        <div className="mrow">
          <ModeSeg />
        </div>
        <div className="wsrow">
          {wsIds.map((w) => (
            <button key={w} type="button" className={'si' + (s.wsId === w ? ' on' : '')} style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--sln)' }} onClick={() => sw(w)}>
              <span className={'wsb' + (s.wsId === w ? ' on' : '')} style={{ width: 24, height: 24, fontSize: 12, borderRadius: 7 }}>
                {wsLetter(w)}
              </span>
              {wsName(w)}
            </button>
          ))}
        </div>
        <div className="t">
          <b role="heading" aria-level={1}>
            {title}
          </b>
          {action}
          <button type="button" className="btn sm ghost close" style={{ display: 'none' }} onClick={() => setUI({ sideOpen: false })} aria-label="Close menu">
            ✕
          </button>
        </div>
        <small>{sub}</small>
        <button type="button" className="search" onClick={() => setUI({ palette: true, sideOpen: false })} style={{ width: '100%', textAlign: 'left' }}>
          ⌕ Search {backendOn ? s.ws.name || 'Seek' : WORKSPACES[s.wsId].name} <kbd>⌘K</kbd>
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
          ☰
        </button>
        <span className="mlogo" aria-hidden="true">
          S
        </span>
        <div className="tt">
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        {right}
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
          ×
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

export function Shell({ active, side, pane, rail, children }: { active: RouteKey; side: React.ReactNode; pane?: React.ReactNode; rail?: React.ReactNode; children: React.ReactNode }) {
  const { ui } = useSeek();
  return (
    <div className={'app' + (ui.sideOpen ? ' side-open' : '') + (pane ? ' has-pane' : '')}>
      {rail ?? <Rail active={active} />}
      <TopBar />
      {side}
      <main className="main">{children}</main>
      {pane}
    </div>
  );
}
