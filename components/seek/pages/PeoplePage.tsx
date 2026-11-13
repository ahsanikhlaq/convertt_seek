'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { backendOn, orgPeople, sb } from '@/lib/seek/backend';
import { PEOPLE, WORKSPACES, type PersonKey } from '@/lib/seek/data';
import { colorFor, displayName, initialsOf, keyFor, learnProfiles } from '@/lib/seek/live';
import { usePresenceOf } from '@/lib/seek/presence';
import { useResync } from '@/lib/seek/resync';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { MainHeader, Pane, Shell, Sidebar } from '../Shell';
import { Ic, StatusMark, type IconKey } from '../icons';
import { Avatar } from '../ui';

/**
 * People: everyone in the workspace (not guests or clients), with their photo, title, role, status and local time.
 * Click someone to open their profile on the right (full screen on phones), message them or copy their email.
 */

type Role = 'owner' | 'admin' | 'member';
type Person = {
  id: string;
  key: PersonKey;
  name: string;
  email: string;
  title: string;
  role: Role;
  joinedAt: string | null;
  /** on · mt · fc · aw */
  status: string;
  dndUntil: string | null;
  lastSeen: number | null;
  pronouns: string;
  timeZone: string;
  workHours: string;
  me: boolean;
};
type Filter = 'all' | 'admins' | 'active';

const ACTIVE_MS = 3 * 60_000;
const STATUS_LABEL: Record<string, string> = { on: 'Available', mt: 'In a meeting', fc: 'Focus time', aw: 'Away' };
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const FILTERS: [Filter, string][] = [
  ['all', 'Everyone'],
  ['admins', 'Admins'],
  ['active', 'Active now'],
];

const asRole = (r: string): Role => (r === 'owner' || r === 'admin' ? r : 'member');

// ---------------------------------------------------------------- time helpers

/** Minutes from UTC for a time zone: an IANA name ("Asia/Karachi") or a label like "Lahore (GMT+5)". */
function offsetOf(tz: string, at = new Date()): number | null {
  const t = (tz || '').trim();
  if (!t) return null;
  const parse = (s: string) => {
    const m = /(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i.exec(s);
    if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
    return /\b(GMT|UTC)\b/i.test(s) ? 0 : null;
  };
  if (t.includes('/') || /^(UTC|GMT)$/i.test(t)) {
    try {
      const name = new Intl.DateTimeFormat('en-US', { timeZone: t, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
      const off = parse(name);
      if (off != null) return off;
    } catch {
      // not a zone this browser knows; fall back to the label
    }
  }
  return parse(t);
}

const gmt = (off: number) => {
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return 'GMT' + (off === 0 ? '' : (off < 0 ? '−' : '+') + h + (m ? ':' + String(m).padStart(2, '0') : ''));
};

/** "Karachi (GMT+5)" for an IANA zone; a label is shown as it is. */
function zoneLabel(tz: string): string {
  const t = (tz || '').trim();
  if (!t.includes('/')) return t;
  const city = t.split('/').pop()!.replace(/_/g, ' ');
  const off = offsetOf(t);
  return off == null ? city : `${city} (${gmt(off)})`;
}

/** Their wall-clock time now, in your locale's format ("4:12 PM"). */
function timeAt(off: number, now: number) {
  return new Date(now + off * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

/** "Same time as you", "5 h ahead of you", "3 h 30 min behind you". */
function diffLabel(off: number) {
  const mine = -new Date().getTimezoneOffset();
  const d = off - mine;
  if (d === 0) return 'Same time as you';
  const h = Math.floor(Math.abs(d) / 60);
  const m = Math.abs(d) % 60;
  return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '') + (d > 0 ? ' ahead of you' : ' behind you');
}

/** Whether their local time falls inside their working hours ("09:00–18:00"); null when either is unknown. */
function workingNow(hours: string, off: number | null, now: number): boolean | null {
  const m = /(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/.exec(hours || '');
  if (!m || off == null) return null;
  const local = new Date(now + off * 60_000);
  const t = local.getUTCHours() * 60 + local.getUTCMinutes();
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = Number(m[3]) * 60 + Number(m[4]);
  if (a === b) return null;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** "5 min ago", "2 h ago", "yesterday at 4:10 PM", "Monday at 9:00 AM", "10 Nov". */
function ago(t: number, now: number) {
  const m = Math.floor((now - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return Math.floor(m / 60) + ' h ago';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday at ' + time;
  if (now - t < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'long' }) + ' at ' + time;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === y.getFullYear() ? undefined : 'numeric' });
}

/** Ticks every 30 seconds so local times and "last seen" stay current. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

type Pres = { active: boolean; label: string };

/** Presence from what this page loaded (the shared presence store wins when it knows the person). */
function presenceFrom(p: Person, now: number): Pres {
  if (p.me) return p.status === 'aw' ? { active: false, label: 'Away' } : { active: true, label: 'Active now' };
  const recent = p.lastSeen != null && now - p.lastSeen < ACTIVE_MS;
  if (recent && p.status !== 'aw') return { active: true, label: 'Active now' };
  if (recent) return { active: false, label: 'Away' };
  return { active: false, label: p.lastSeen ? 'Last seen ' + ago(p.lastSeen, now) : 'Not active yet' };
}

function usePres(p: Person, now: number): Pres {
  const shared = usePresenceOf(p.me ? null : p.key);
  return shared.known ? { active: shared.active, label: shared.label } : presenceFrom(p, now);
}

const pausedUntil = (p: Person, now: number) => {
  if (!p.dndUntil) return null;
  const t = Date.parse(p.dndUntil);
  if (!(t > now)) return null;
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString() ? time : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + time;
};

// ---------------------------------------------------------------- data

type ProfileRow = { id: string; avatar_url: string | null; pronouns: string | null; time_zone: string | null; work_hours: string | null; status: string | null; dnd_until: string | null; last_seen_at: string | null };

/** Everyone in the open organisation (backend) with what a teammate can read of their profile. */
async function loadPeople(orgId: string, meId: string | null): Promise<Person[]> {
  const rows = await orgPeople(orgId);
  const ids = rows.map((r) => r.userId);
  if (!ids.length) return [];
  const { data } = await sb().from('profiles').select('id, avatar_url, pronouns, time_zone, work_hours, status, dnd_until, last_seen_at').in('id', ids);
  const extra = new Map(((data ?? []) as ProfileRow[]).map((p) => [p.id, p]));
  // names and photos everywhere else in the app (cached on this device); this page fills in its own right away
  void learnProfiles(ids, meId).catch(() => {});
  return rows.map((r) => {
    const x = extra.get(r.userId);
    const key = keyFor(r.userId, meId);
    const name = displayName(r.name || '', r.email || '');
    if (key !== 'AH') {
      const cur = PEOPLE[key];
      PEOPLE[key] = { name, color: cur?.color ?? colorFor(r.userId), role: r.email, initials: initialsOf(name), photo: x?.avatar_url ?? cur?.photo };
    }
    return {
      id: r.userId,
      key,
      name,
      email: r.email || '',
      title: r.title || '',
      role: asRole(r.role),
      joinedAt: r.joinedAt,
      status: x?.status ?? r.status ?? 'on',
      dndUntil: x?.dnd_until ?? null,
      lastSeen: x?.last_seen_at ? Date.parse(x.last_seen_at) : null,
      pronouns: x?.pronouns ?? '',
      timeZone: x?.time_zone ?? '',
      workHours: x?.work_hours ?? '',
      me: key === 'AH',
    };
  });
}

/** The prototype's sample team, so the page isn't empty without a backend. */
function demoPeople(me: { name: string; title: string; email: string; tz: string; pronouns?: string; workHours?: string }, status: string): Person[] {
  const now = Date.now();
  const base = { joinedAt: null, dndUntil: null, me: false };
  return [
    { ...base, id: 'AH', key: 'AH', name: me.name, email: me.email, title: me.title, role: 'owner', status, lastSeen: now, pronouns: me.pronouns ?? 'he/him', timeZone: me.tz, workHours: me.workHours ?? '09:00–18:00', me: true },
    { ...base, id: 'SY', key: 'SY', name: PEOPLE.SY?.name ?? 'Syed', email: 'syed@convertt.co', title: 'Designer', role: 'admin', status: 'mt', lastSeen: now - 60_000, pronouns: 'he/him', timeZone: 'Asia/Karachi', workHours: '10:00–19:00' },
    { ...base, id: 'MO', key: 'MO', name: PEOPLE.MO?.name ?? 'Momina', email: 'momina@convertt.co', title: 'Developer', role: 'member', status: 'fc', lastSeen: now - 30_000, pronouns: 'she/her', timeZone: 'Europe/London', workHours: '09:00–17:30' },
    { ...base, id: 'ZA', key: 'ZA', name: PEOPLE.ZA?.name ?? 'Zara', email: 'zara@convertt.co', title: 'Design intern', role: 'member', status: 'aw', lastSeen: now - 2 * 3_600_000, pronouns: '', timeZone: 'Asia/Dubai', workHours: '09:00–15:00' },
  ];
}

// ---------------------------------------------------------------- pieces

/** A large photo with a presence dot (the shared Avatar shows the live dot when it knows the person). */
function Photo({ p, size, pres }: { p: Person; size: number; pres: Pres }) {
  const shared = usePresenceOf(p.me ? null : p.key);
  if (shared.known) return <Avatar k={p.key} size={size} presence />;
  return (
    <span className="pav" title={p.name + ' · ' + pres.label}>
      <Avatar k={p.key} size={size} />
      <i className={'pdot' + (pres.active ? ' on' : '')} role="img" aria-label={pres.label} />
    </span>
  );
}

function RoleTag({ role }: { role: Role }) {
  return <span className={'tag pp-role ' + role + (role === 'owner' ? ' gold' : role === 'admin' ? ' v' : '')}>{ROLE_LABEL[role]}</span>;
}

function Card({ p, on, now, onOpen }: { p: Person; on: boolean; now: number; onOpen: () => void }) {
  const pres = usePres(p, now);
  const off = offsetOf(p.timeZone);
  return (
    <button type="button" className={'pp-card' + (on ? ' on' : '')} aria-pressed={on} onClick={onOpen} aria-label={'View ' + p.name + (p.me ? ' (you)' : '') + ' profile'}>
      <span className="pp-ph">
        <Photo p={p} size={72} pres={pres} />
      </span>
      <span className="pp-body">
        <span className="pp-nm">
          <b>{p.name}</b>
          {p.me && <span className="pp-you">(you)</span>}
        </span>
        <span className="pp-ti">{p.title || <i>No title yet</i>}</span>
        <span className="pp-tags">
          <RoleTag role={p.role} />
        </span>
        <span className="pp-ft">
          <span className="pp-st">
            <StatusMark k={p.status} />
            <span>{STATUS_LABEL[p.status] ?? 'Available'}</span>
            <span className={'pp-seen' + (pres.active ? ' on' : '')}>· {pres.label}</span>
          </span>
          {off != null && (
            <span className="pp-tm">
              <Ic n="clock" size={13} />
              {timeAt(off, now)} local time
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="pp-card pp-sk" aria-hidden="true">
      <span className="pp-ph">
        <i className="pp-skav" />
      </span>
      <span className="pp-body">
        <i className="pp-skl" style={{ width: '60%' }} />
        <i className="pp-skl" style={{ width: '40%' }} />
        <i className="pp-skl" style={{ width: '30%' }} />
      </span>
    </div>
  );
}

function Row({ icon, label, children }: { icon: IconKey; label: string; children: React.ReactNode }) {
  return (
    <div className="pp-row">
      <Ic n={icon} size={16} className="pp-ri" />
      <div>
        <span className="pp-rl">{label}</span>
        <div className="pp-rv">{children}</div>
      </div>
    </div>
  );
}

function Profile({ p, now, onMessage, onCopy }: { p: Person; now: number; onMessage: () => void; onCopy: () => void }) {
  const pres = usePres(p, now);
  const off = offsetOf(p.timeZone);
  const paused = pausedUntil(p, now);
  const working = workingNow(p.workHours, off, now);
  const joined = p.joinedAt ? new Date(p.joinedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return (
    <div className="pp-prof">
      <div className="pp-hero">
        <Photo p={p} size={112} pres={pres} />
        <div className="pp-hn">
          <h2>
            {p.name}
            {p.me && <span className="pp-you"> (you)</span>}
          </h2>
          {p.pronouns && <span className="pp-pro">{p.pronouns}</span>}
        </div>
        {p.title && <p className="pp-ht">{p.title}</p>}
        <div className="pp-tags">
          <RoleTag role={p.role} />
          <span className={'pp-pill' + (pres.active ? ' on' : '')}>
            <i className="pp-pd" aria-hidden="true" />
            {pres.label}
          </span>
        </div>
      </div>

      <div className="pp-acts">
        {p.me ? (
          <Link href={ROUTES.account} className="btn pri">
            <Ic n="edit" size={15} /> Edit profile
          </Link>
        ) : (
          <button type="button" className="btn pri" onClick={onMessage}>
            <Ic n="message" size={15} /> Message
          </button>
        )}
        {p.email && (
          <button type="button" className="btn" onClick={onCopy}>
            <Ic n="copy" size={15} /> Copy email
          </button>
        )}
      </div>

      <div className="pp-rows">
        <Row icon="dot" label="Status">
          <span className="pp-st">
            <StatusMark k={p.status} /> {STATUS_LABEL[p.status] ?? 'Available'}
          </span>
          {paused && <small>Notifications paused until {paused}</small>}
        </Row>
        <Row icon="recent" label="Activity">
          <span className={'pp-seen' + (pres.active ? ' on' : '')}>{pres.label}</span>
        </Row>
        <Row icon="clock" label="Local time">
          {off != null ? (
            <>
              {timeAt(off, now)}
              <small>{p.me ? 'Your time' : diffLabel(off)}</small>
            </>
          ) : (
            <span className="pp-none">Not set</span>
          )}
        </Row>
        <Row icon="globe" label="Time zone">
          {p.timeZone ? zoneLabel(p.timeZone) : <span className="pp-none">Not set</span>}
        </Row>
        <Row icon="calendar" label="Working hours">
          {p.workHours ? (
            <>
              <span className="pp-wh">
                {p.workHours}
                {working != null && <span className={'tag' + (working ? ' ok' : '')}>{working ? 'Working now' : 'Outside working hours'}</span>}
              </span>
              {off != null && <small>in their time zone</small>}
            </>
          ) : (
            <span className="pp-none">Not set</span>
          )}
        </Row>
        <Row icon="mail" label="Email">
          {p.email ? (
            <a href={'mailto:' + p.email} className="pp-mail">
              {p.email}
            </a>
          ) : (
            <span className="pp-none">Hidden</span>
          )}
        </Row>
        {joined && (
          <Row icon="users" label="Joined">
            {joined}
          </Row>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export function PeoplePage() {
  const { s, update, setUI, toast } = useSeek();
  const router = useRouter();
  const sync = useResync();
  const now = useNow();
  const [loaded, setLoaded] = useState<Person[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const orgId = s.orgId ?? null;
  const meId = s.meId ?? null;
  const wsName = backendOn ? s.ws.name || 'your workspace' : WORKSPACES[s.wsId].name;

  // load (and refresh every minute while the page is visible, and when Seek catches up after being away)
  useEffect(() => {
    if (!backendOn || !orgId) return;
    let alive = true;
    const load = async () => {
      try {
        const list = await loadPeople(orgId, meId);
        if (alive) setLoaded(list);
      } catch {
        if (alive) setLoaded((x) => x ?? []);
      }
    };
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [orgId, meId, sync]);

  // your own card follows your profile and status as you change them
  const people = useMemo<Person[] | null>(() => {
    const base = backendOn ? loaded : demoPeople(s.me, s.status.k);
    if (!base) return null;
    return base
      .map((p) => (p.me ? { ...p, name: s.me.name || p.name, title: s.me.title ?? p.title, status: s.status.k, dndUntil: s.me.dndUntil ?? p.dndUntil, pronouns: s.me.pronouns ?? p.pronouns, timeZone: s.me.tz || p.timeZone, workHours: s.me.workHours ?? p.workHours } : p))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [loaded, s.me, s.status.k]);

  const all = people ?? [];
  const counts: Record<Filter, number> = {
    all: all.length,
    admins: all.filter((p) => p.role !== 'member').length,
    active: all.filter((p) => presenceFrom(p, now).active).length,
  };
  const needle = q.trim().toLowerCase();
  const list = all.filter(
    (p) =>
      (filter === 'all' || (filter === 'admins' ? p.role !== 'member' : presenceFrom(p, now).active)) &&
      (!needle || p.name.toLowerCase().includes(needle) || p.title.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)),
  );
  const sel = all.find((p) => p.id === open) ?? null;

  // Escape closes the profile
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const message = async (p: Person) => {
    if (p.me) return;
    if (backendOn) {
      // starts the conversation if there isn't one yet (the DMs screen then loads it)
      const { error } = await sb().rpc('open_dm', { p_other: p.id });
      if (error) {
        toast('Couldn’t start the conversation');
        return;
      }
    }
    update((d) => {
      d.dm = p.key;
      const t = (d.dms[p.key] ||= { last: '', unread: 0, msgs: [] });
      t.unread = 0;
    });
    setUI({ home: false, sideOpen: false, menu: null, thread: null });
    router.push(ROUTES.dms);
  };

  const copy = async (p: Person) => {
    try {
      await navigator.clipboard.writeText(p.email);
      toast('Email copied');
    } catch {
      toast(p.email);
    }
  };

  const side = (
    <Sidebar title="People" sub={'everyone in ' + wsName}>
      <div className="sg lbl">Show</div>
      {FILTERS.map(([k, l]) => (
        <button
          key={k}
          type="button"
          className={'si' + (filter === k ? ' on' : '')}
          aria-pressed={filter === k}
          onClick={() => {
            setFilter(k);
            setUI({ sideOpen: false });
          }}
        >
          <span className="h">
            <Ic n={k === 'all' ? 'users' : k === 'admins' ? 'shield' : 'dot'} size={14} />
          </span>
          <span className="x">
            <b>{l}</b>
          </span>
          {people && <span className="tag">{counts[k]}</span>}
        </button>
      ))}
      <div className="sg lbl">Team</div>
      <Link href={ROUTES.invite} className="si" onClick={() => setUI({ sideOpen: false })}>
        <span className="h">
          <Ic n="plus" size={14} />
        </span>
        <span className="x">
          <b>Invite people</b>
        </span>
      </Link>
      <Link href={ROUTES.account} className="si" onClick={() => setUI({ sideOpen: false })}>
        <span className="h">
          <Ic n="user" size={14} />
        </span>
        <span className="x">
          <b>Edit your profile</b>
        </span>
      </Link>
    </Sidebar>
  );

  const pane = sel ? (
    <Pane title="Profile" onClose={() => setOpen(null)}>
      <Profile p={sel} now={now} onMessage={() => void message(sel)} onCopy={() => void copy(sel)} />
    </Pane>
  ) : undefined;

  const n = all.length;
  return (
    <Shell active="people" side={side} pane={pane}>
      <MainHeader
        title="People"
        sub={people ? `${n} ${n === 1 ? 'member' : 'members'} in ${wsName}` : 'Loading the team…'}
        right={
          <Link href={ROUTES.invite} className="btn sm hide-m">
            <Ic n="plus" size={14} /> Invite people
          </Link>
        }
      />
      <div className="pp-wrap">
        <div className="pp-bar">
          <label className="pp-search">
            <Ic n="search" size={16} />
            <input className="inp" type="search" placeholder="Search by name, title or email" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="chips pp-chips" role="group" aria-label="Filter people">
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" className={'chip' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
                {people && <span className="pp-n">{counts[k]}</span>}
              </button>
            ))}
          </div>
        </div>

        {!people ? (
          <div className="pp-grid" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : list.length ? (
          <div className="pp-grid">
            {list.map((p) => (
              <Card key={p.id} p={p} on={open === p.id} now={now} onOpen={() => setOpen(open === p.id ? null : p.id)} />
            ))}
          </div>
        ) : (
          <div className="empty pp-empty">
            <Ic n="users" size={28} />
            <b>{needle ? 'No one matches “' + q.trim() + '”' : filter === 'active' ? 'No one is active right now' : filter === 'admins' ? 'No admins yet' : 'No one here yet'}</b>
            <span>{needle || filter !== 'all' ? 'Try another search or show everyone.' : 'Invite your team to see them here.'}</span>
            {needle || filter !== 'all' ? (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setQ('');
                  setFilter('all');
                }}
              >
                Show everyone
              </button>
            ) : (
              <Link href={ROUTES.invite} className="btn sm pri">
                Invite people
              </Link>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
