'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { backendOn, currentAccount } from '@/lib/seek/backend';
import { PEOPLE, type Decision, type LiveDecision, type PersonKey } from '@/lib/seek/data';
import { keyFor } from '@/lib/seek/live';
import { decisionRoute, decisionsCsv, flashMessage, historyOf, loadDecisions, openDecision, replaceDecision, sourceUiId, undoDecision } from '@/lib/seek/liveDecisions';
import { initialsOf, now } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { PromptDialog } from '../Dialogs';
import { MainHeader, Shell, Sidebar } from '../Shell';
import { Ic, type IconKey } from '../icons';
import { Avatar } from '../ui';

const whereLabel = (w: string) => (w === 'HB' ? 'Hollow & Bright' : w.startsWith('DM ') ? w : '#' + w);

export function DecisionsPage() {
  return backendOn ? <LiveDecisionsPage /> : <DemoDecisionsPage />;
}

const HOW = [
  'Log one from any message: More, then Log decision, or press D.',
  'Undo appears for a few seconds after logging.',
  'Edit a decision to replace it. The old one stays in history.',
  'Clients see decisions made in their Client chat; Team notes decisions stay private.',
];

const DESC = 'What the team agreed, who agreed it, and the message it came from.';

const whenLabel = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return 'Today ' + time;
  if (days < 6) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + time;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

/* ---------- display helpers (no data changes) ---------- */

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fullDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday", or "Mon 10 Nov" (with the year when it isn't this year). */
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

const WEEKDAYS: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
/** Demo times are "Mon 10:12" or "Just now". */
const demoDay = (time: string) => (/^(just now|today)/i.test(time) ? 'Today' : WEEKDAYS[time.split(' ')[0]] ?? 'Earlier');
const demoTime = (time: string) => (WEEKDAYS[time.split(' ')[0]] ? time.split(' ').slice(1).join(' ') : time);

function groupBy<T>(items: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of items) {
    const k = key(x);
    const a = m.get(k);
    if (a) a.push(x);
    else m.set(k, [x]);
  }
  return Array.from(m.entries());
}

/** A live place ("# general", "DM · Sara", "Hollow & Bright · Client chat") as an icon and a short label. */
function placeParts(place: string): { icon: IconKey; label: string } {
  if (place.startsWith('# ')) return { icon: 'hash', label: place.slice(2) };
  if (place.startsWith('DM · ')) return { icon: 'user', label: place.slice(5) };
  if (place.endsWith(' · Team notes')) return { icon: 'lock', label: place };
  return { icon: 'users', label: place };
}
/** A demo place ("launch-squad", "HB", "DM Sara"). */
function demoPlaceParts(w: string): { icon: IconKey; label: string } {
  if (w === 'HB') return { icon: 'users', label: 'Hollow & Bright' };
  if (w.startsWith('DM ')) return { icon: 'user', label: w.slice(3) };
  return { icon: 'hash', label: w };
}

/** The person's avatar when we know them, otherwise their initials on a neutral circle. */
function Who({ k, name }: { k: PersonKey | null; name: string }) {
  if (k && PEOPLE[k]) return <Avatar k={k} size={22} className="dz-av" />;
  return (
    <span className="av dz-av dz-av0" style={{ width: 22, height: 22, fontSize: 9 }} aria-hidden="true">
      {initialsOf(name) || <Ic n="user" size={12} />}
    </span>
  );
}

function Pill({ tone, icon, children }: { tone: 'gold' | 'v' | 'mu'; icon: IconKey; children: React.ReactNode }) {
  return (
    <span className={'dz-pill ' + tone}>
      <Ic n={icon} size={12} />
      {children}
    </span>
  );
}

function PlaceChip({ icon, label }: { icon: IconKey; label: string }) {
  return (
    <span className="dz-chip" title={label}>
      <Ic n={icon} size={12} />
      <span>{label}</span>
    </span>
  );
}

function Steps() {
  return (
    <ol className="dz-steps">
      {HOW.map((t, i) => (
        <li key={i}>
          <i>{i + 1}</i>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

/** Nothing logged yet: what decisions are and how to log one. */
function EmptyState() {
  return (
    <div className="dz-empty">
      <span className="dz-empty-ic">
        <Ic n="decision" size={26} />
      </span>
      <h2>No decisions yet</h2>
      <p>When the team agrees on something, log it from the message so everyone can find it later, with who agreed and where.</p>
      <Steps />
    </div>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="dz-empty dz-nomatch">
      <span className="dz-empty-ic">
        <Ic n="search" size={22} />
      </span>
      <h2>No decisions match</h2>
      <p>Try another search, or show decisions from everywhere.</p>
      <button type="button" className="btn sm" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}

/** A small "How decisions work" disclosure, shown under the list. */
function HowLink() {
  return (
    <details className="dz-how">
      <summary>
        <Ic n="help" size={15} />
        How decisions work
        <Ic n="chevron" size={14} className="dz-caret" />
      </summary>
      <Steps />
    </details>
  );
}

/** Counts on the left, search on the right. */
function Toolbar({ total, week, shown, filtered, q, setQ, onClear }: { total: number; week: number; shown: number; filtered: boolean; q: string; setQ: (v: string) => void; onClear: () => void }) {
  return (
    <div className="dz-bar">
      <div className="dz-sum">
        {filtered ? (
          <>
            <span>
              Showing <b>{shown}</b> of {total}
            </span>
            <button type="button" className="dz-clear" onClick={onClear}>
              <Ic n="close" size={13} />
              Clear
            </button>
          </>
        ) : (
          <>
            <span>
              <b>{total}</b> {total === 1 ? 'decision' : 'decisions'}
            </span>
            <span className="dz-dot" aria-hidden="true" />
            <span>
              <b>{week}</b> this week
            </span>
          </>
        )}
      </div>
      <label className="dz-search">
        <Ic n="search" size={16} />
        <input type="search" placeholder="Search decisions or people" aria-label="Search decisions" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button type="button" className="dz-x" aria-label="Clear search" onClick={() => setQ('')}>
            <Ic n="close" size={14} />
          </button>
        )}
      </label>
    </div>
  );
}

function DayHead({ label, n }: { label: string; n: number }) {
  return (
    <div className="dz-day">
      <span>{label}</span>
      <i aria-hidden="true" />
      <small>{n}</small>
    </div>
  );
}

function SideRow({ on, icon, label, n, onClick }: { on: boolean; icon: IconKey; label: string; n?: number; onClick: () => void }) {
  return (
    <button type="button" className={'si dz-si' + (on ? ' on' : '')} aria-pressed={on} onClick={onClick}>
      <span className="h">
        <Ic n={icon} size={15} />
      </span>
      <span className="x">
        <b>{label}</b>
      </span>
      {n != null && <span className="tag dz-n">{n}</span>}
    </button>
  );
}

/** Backend mode: the real decision log, filtered by place and type, with edit history, undo and CSV export. */
function LiveDecisionsPage() {
  const { s, ui, update, setUI, toast } = useSeek();
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [editing, setEditing] = useState<LiveDecision | null>(null);
  const [q, setQ] = useState('');
  const all = s.ldecs ?? [];
  const current = all.filter((d) => !d.replacedAt);

  useEffect(() => {
    void currentAccount().then((a) => setMe(a?.id ?? null));
  }, []);

  const reload = async () => {
    const list = await loadDecisions(s.orgId ?? null);
    if (list)
      update((d) => {
        d.ldecs = list;
      });
  };

  const places = Array.from(new Set(current.map((d) => d.place))).sort((a, b) => a.localeCompare(b));
  const W: [string, string, number][] = [['All', 'Everywhere', current.length], ...places.map((p): [string, string, number] => [p, p, current.filter((d) => d.place === p).length])];
  const T: [string, string, IconKey][] = [
    ['All', 'All types', 'list'],
    ['decision', 'Decisions', 'decision'],
    ['approval', 'Approvals from clients', 'check'],
    ['client', 'Visible to clients', 'eye'],
  ];
  const where = W.some(([k]) => k === ui.dWhere) ? ui.dWhere : 'All';
  const type = T.some(([k]) => k === ui.dType) ? ui.dType : 'All';
  const needle = q.trim().toLowerCase();
  const inWhere = current.filter((d) => where === 'All' || d.place === where);
  const ofType = (d: LiveDecision, t: string) => t === 'All' || (t === 'client' ? d.client : d.kind === t);
  const list = inWhere.filter((d) => ofType(d, type) && (!needle || d.text.toLowerCase().includes(needle) || d.by.toLowerCase().includes(needle)));
  const thisWeek = current.filter((d) => Date.now() - new Date(d.at).getTime() < 7 * 864e5).length;
  const filtered = where !== 'All' || type !== 'All' || !!needle;
  const clear = () => {
    setQ('');
    setUI({ dWhere: 'All', dType: 'All' });
  };
  const days = groupBy(
    [...list].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    (d) => dayLabel(d.at),
  );

  const remove = async (d: LiveDecision) => {
    if (!confirm(`Remove “${d.text}” from the log?` + (d.replaces != null ? ' The previous version comes back.' : ''))) return;
    if (await undoDecision(d.id)) {
      await reload();
      toast('Decision removed');
    } else toast('Couldn’t remove it. Only the person who logged it can');
  };

  const exportCsv = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + decisionsCsv(all)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'decisions-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Exported ' + all.length + ' decisions, including replaced ones');
  };

  const side = (
    <Sidebar title="Decisions" sub="agreements, with where they came from">
      <div className="sg lbl">Where</div>
      {W.map(([k, l, n]) => {
        const p = k === 'All' ? { icon: 'globe' as IconKey, label: l } : placeParts(l);
        return <SideRow key={k} on={where === k} icon={p.icon} label={p.label} n={n} onClick={() => setUI({ dWhere: k, sideOpen: false })} />;
      })}
      <div className="sg lbl">Type</div>
      {T.map(([k, l, icon]) => (
        <SideRow key={k} on={type === k} icon={icon} label={l} n={inWhere.filter((d) => ofType(d, k)).length} onClick={() => setUI({ dType: k, sideOpen: false })} />
      ))}
    </Sidebar>
  );

  return (
    <Shell active="decisions" side={side}>
      <MainHeader
        title="Decisions"
        sub={DESC}
        right={
          all.length ? (
            <button type="button" className="btn sm" onClick={exportCsv}>
              <Ic n="download" />
              Export
            </button>
          ) : undefined
        }
      />
      <div className="dz-wrap">
        <div className="dz-in">
          {!current.length ? (
            <EmptyState />
          ) : (
            <>
              <Toolbar total={current.length} week={thisWeek} shown={list.length} filtered={filtered} q={q} setQ={setQ} onClear={clear} />
              {list.length ? (
                days.map(([label, items]) => (
                  <section key={label} className="dz-group" aria-label={label}>
                    <DayHead label={label} n={items.length} />
                    {items.map((d) => {
                      const hist = historyOf(all, d);
                      const pl = placeParts(d.place);
                      const open = ui.hist === d.id;
                      return (
                        <article key={d.id} className={'dz-card' + (d.kind === 'approval' ? ' appr' : d.client ? ' client' : '')}>
                          <span className="dz-ic" aria-hidden="true">
                            <Ic n={d.kind === 'approval' ? 'check' : 'decision'} size={17} />
                          </span>
                          <div className="dz-body">
                            <div className="dz-top">
                              <h3 className="dz-title">{d.text}</h3>
                              <time className="dz-time" dateTime={d.at} title={fullDate(d.at)}>
                                {timeOf(d.at)}
                              </time>
                            </div>
                            <div className="dz-meta">
                              <span className="dz-who">
                                <Who k={keyFor(d.byId, me)} name={d.by} />
                                <b>{d.by}</b>
                              </span>
                              <PlaceChip icon={pl.icon} label={pl.label} />
                              {d.kind === 'approval' && (
                                <Pill tone="gold" icon="check">
                                  Approval
                                </Pill>
                              )}
                              {d.client && (
                                <Pill tone="gold" icon="eye">
                                  Client-visible
                                </Pill>
                              )}
                              {hist.length > 0 && (
                                <Pill tone="mu" icon="edit">
                                  Edited
                                </Pill>
                              )}
                            </div>
                            <div className="dz-acts">
                              {d.source != null && (
                                <button
                                  type="button"
                                  className="dz-act"
                                  onClick={() => {
                                    update((x) => openDecision(d, x, me));
                                    setUI({ chTab: 'Messages', thread: null });
                                    router.push(decisionRoute(d));
                                    const id = sourceUiId(d);
                                    if (id != null) flashMessage(id);
                                  }}
                                >
                                  <Ic n="message" size={15} />
                                  Source message
                                </button>
                              )}
                              {d.kind === 'decision' && (
                                <button type="button" className="dz-act" onClick={() => setEditing(d)}>
                                  <Ic n="edit" size={15} />
                                  Edit
                                </button>
                              )}
                              {hist.length > 0 && (
                                <button type="button" className={'dz-act' + (open ? ' on' : '')} aria-expanded={open} onClick={() => setUI({ hist: open ? null : d.id })}>
                                  <Ic n="recent" size={15} />
                                  History
                                  <span className="dz-cnt">{hist.length}</span>
                                </button>
                              )}
                              {me === d.byId && d.kind === 'decision' && (
                                <button type="button" className="dz-act dz-danger" onClick={() => void remove(d)}>
                                  <Ic n={d.replaces != null ? 'reset' : 'trash'} size={15} />
                                  {d.replaces != null ? 'Undo edit' : 'Remove'}
                                </button>
                              )}
                              {d.kind === 'approval' && (
                                <span className="dz-note">
                                  <Ic n="lock" size={13} />
                                  Signed off by the client · can’t be edited
                                </span>
                              )}
                            </div>
                            {open && (
                              <ol className="dz-hist" aria-label="History">
                                <li className="cur">
                                  <span className="dz-hd" aria-hidden="true" />
                                  <div>
                                    <b>“{d.text}”</b>
                                    <small>
                                      {whenLabel(d.at)} · {d.by} · current
                                    </small>
                                  </div>
                                </li>
                                {hist.map((h) => (
                                  <li key={h.id}>
                                    <span className="dz-hd" aria-hidden="true" />
                                    <div>
                                      <s>“{h.text}”</s>
                                      <small>
                                        {whenLabel(h.at)} · {h.by}
                                      </small>
                                    </div>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </section>
                ))
              ) : (
                <NoMatch onClear={clear} />
              )}
              <HowLink />
            </>
          )}
        </div>
      </div>
      {editing && (
        <PromptDialog
          title="Edit decision"
          label={editing.client ? 'Decision (the client will see the change)' : 'Decision'}
          initial={editing.text}
          confirm="Replace decision"
          multiline
          onCancel={() => setEditing(null)}
          onSubmit={async (n) => {
            const d = editing;
            setEditing(null);
            if (n === d.text) return;
            const err = await replaceDecision(d.id, n.slice(0, 300));
            if (err) {
              toast(err);
              return;
            }
            await reload();
            toast('Decision replaced · history kept');
          }}
        />
      )}
    </Shell>
  );
}

/** Demo: who a sample decision is by ("Logged by Ahsan from…", or the logger in a replaced one's history). */
function demoPerson(d: Decision): PersonKey | null {
  const name = /\bby ([A-Z]\w+)/.exec(d.by)?.[1] ?? /\bby ([A-Z]\w+)/.exec(d.hist?.[0] ?? '')?.[1];
  if (!name) return null;
  const hit = (Object.keys(PEOPLE) as PersonKey[]).find((k) => PEOPLE[k]?.name.split(' ')[0] === name);
  return hit ?? null;
}

function DemoDecisionsPage() {
  const { s, ui, update, setUI, toast, nextId } = useSeek();
  const router = useRouter();
  const [editing, setEditing] = useState<Decision | null>(null);
  const [q, setQ] = useState('');

  const decs = s.decs;
  // same order as the prototype (launch-squad, design, Hollow & Bright), then any other place in log order
  const places = Array.from(new Set(['launch-squad', 'design', 'HB', ...decs.map((d) => d.where)])).filter((p) => decs.some((d) => d.where === p));
  const W: [string, string, number][] = [['All', 'All channels', decs.length], ...places.map((p): [string, string, number] => [p, p === 'HB' ? 'Hollow & Bright' : p.startsWith('DM ') ? p : '# ' + p, decs.filter((d) => d.where === p).length])];
  const T: [string, string, IconKey][] = [
    ['All', 'All types', 'list'],
    ['dec', 'Decisions', 'decision'],
    ['appr', 'Approvals from clients', 'check'],
  ];
  const needle = q.trim().toLowerCase();
  const inWhere = decs.filter((d) => ui.dWhere === 'All' || d.where === ui.dWhere);
  const list = inWhere.filter((d) => (ui.dType === 'All' || d.type === ui.dType) && (!needle || d.t.toLowerCase().includes(needle) || d.by.toLowerCase().includes(needle)));
  const current = decs.filter((d) => !d.old).length;
  const filtered = ui.dWhere !== 'All' || ui.dType !== 'All' || !!needle;
  const clear = () => {
    setQ('');
    setUI({ dWhere: 'All', dType: 'All' });
  };
  const days = groupBy(list, (d) => demoDay(d.time));

  const openSource = (d: Decision) => {
    if (d.where === 'HB') {
      update((x) => {
        x.cTab = 'Client chat';
        x.cs = 'HB';
      });
      router.push(ROUTES.clients);
    } else if (d.where.startsWith('DM ')) {
      router.push(ROUTES.dms);
    } else {
      const wsId = s.workspaces.C.channels.some((c) => c.id === d.where) ? 'C' : 'K';
      update((x) => {
        x.wsId = wsId;
        x.workspaces[wsId].ch = d.where;
      });
      setUI({ chTab: 'Messages', thread: null });
      router.push(ROUTES.channels);
    }
  };

  const side = (
    <Sidebar title="Decisions" sub="agreements, with where they came from">
      <div className="sg lbl">Where</div>
      {W.map(([k, l, n]) => {
        const p = k === 'All' ? { icon: 'globe' as IconKey, label: l } : demoPlaceParts(k);
        return <SideRow key={k} on={ui.dWhere === k} icon={p.icon} label={p.label} n={n} onClick={() => setUI({ dWhere: k, sideOpen: false })} />;
      })}
      <div className="sg lbl">Type</div>
      {T.map(([k, l, icon]) => (
        <SideRow key={k} on={ui.dType === k} icon={icon} label={l} n={inWhere.filter((d) => k === 'All' || d.type === k).length} onClick={() => setUI({ dType: k, sideOpen: false })} />
      ))}
    </Sidebar>
  );

  const exportCsv = () => {
    const rows = [['Decision', 'By', 'Where', 'When', 'Type', 'Status'], ...decs.map((d) => [d.t, d.by, whereLabel(d.where), d.time, d.type === 'appr' ? 'Approval' : 'Decision', d.old ? 'Replaced' : 'Current'])];
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'decisions.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Exported decisions.csv');
  };

  return (
    <Shell active="decisions" side={side}>
      <MainHeader
        title="Decisions"
        sub={DESC}
        right={
          <button type="button" className="btn sm" onClick={exportCsv}>
            <Ic n="download" />
            Export
          </button>
        }
      />
      <div className="dz-wrap">
        <div className="dz-in">
          {!decs.length ? (
            <EmptyState />
          ) : (
            <>
              <Toolbar total={current} week={current} shown={list.length} filtered={filtered} q={q} setQ={setQ} onClear={clear} />
              {list.length ? (
                days.map(([label, items]) => (
                  <section key={label} className="dz-group" aria-label={label}>
                    <DayHead label={label} n={items.length} />
                    {items.map((d) => {
                      const pl = demoPlaceParts(d.where);
                      const open = ui.hist === d.id;
                      return (
                        <article key={d.id} className={'dz-card' + (d.old ? ' old' : d.type === 'appr' ? ' appr' : d.client ? ' client' : '')}>
                          <span className="dz-ic" aria-hidden="true">
                            <Ic n={d.old ? 'recent' : d.type === 'appr' ? 'check' : 'decision'} size={17} />
                          </span>
                          <div className="dz-body">
                            <div className="dz-top">
                              <h3 className="dz-title">{d.t}</h3>
                              <span className="dz-time">{demoTime(d.time)}</span>
                            </div>
                            <div className="dz-meta">
                              <span className="dz-who">
                                <Who k={demoPerson(d)} name={d.by} />
                                <span className="dz-by">{d.by}</span>
                              </span>
                              <PlaceChip icon={pl.icon} label={pl.label} />
                              {d.old && (
                                <Pill tone="mu" icon="reset">
                                  Replaced
                                </Pill>
                              )}
                              {d.type === 'appr' && (
                                <Pill tone="gold" icon="check">
                                  Approval
                                </Pill>
                              )}
                              {d.client && (
                                <Pill tone="gold" icon="eye">
                                  Client-visible
                                </Pill>
                              )}
                            </div>
                            <div className="dz-acts">
                              <button
                                type="button"
                                className={'dz-act' + (d.old && open ? ' on' : '')}
                                aria-expanded={d.old ? open : undefined}
                                onClick={() => (d.old ? setUI({ hist: open ? null : d.id }) : openSource(d))}
                              >
                                <Ic n={d.old ? 'recent' : d.a === 'Huddle notes' ? 'huddle' : 'message'} size={15} />
                                {d.a}
                              </button>
                              {!d.old && (
                                <button type="button" className="dz-act" onClick={() => setEditing(d)}>
                                  <Ic n="edit" size={15} />
                                  Edit
                                </button>
                              )}
                            </div>
                            {open && (
                              <ol className="dz-hist" aria-label="History">
                                {(d.hist || [`${d.time} · "${d.t}" logged`, d.by]).map((line, i) => (
                                  <li key={i} className={i === 0 ? '' : 'cur'}>
                                    <span className="dz-hd" aria-hidden="true" />
                                    <div>
                                      <small>{line}</small>
                                    </div>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </section>
                ))
              ) : (
                <NoMatch onClear={clear} />
              )}
              <HowLink />
            </>
          )}
        </div>
      </div>
      {editing && (
        <PromptDialog
          title="Edit decision"
          label="Decision"
          initial={editing.t}
          confirm="Replace decision"
          multiline
          onCancel={() => setEditing(null)}
          onSubmit={(n) => {
            if (n === editing.t) {
              setEditing(null);
              return;
            }
            update((x) => {
              const d = x.decs.find((y) => y.id === editing.id);
              if (!d) return;
              x.decs.splice(x.decs.indexOf(d), 0, { id: nextId(), t: n, by: 'Edited by Ahsan · replaces previous', where: d.where, time: 'Just now', type: d.type, client: d.client, a: 'Source message' });
              d.old = true;
              const logger = /\bby (\w+)/.exec(d.by)?.[1] || 'Ahsan';
              d.hist = [`${d.time} · "${d.t}" logged by ${logger}`, `${new Date().toLocaleDateString('en-GB', { weekday: 'short' })} ${now()} · Replaced by "${n}"`];
              d.by = 'Replaced by "' + n + '" · history kept';
              d.a = 'History';
            });
            setEditing(null);
            toast('Decision replaced · history kept');
          }}
        />
      )}
    </Shell>
  );
}
