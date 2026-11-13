'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { backendOn, currentAccount } from '@/lib/seek/backend';
import type { Decision, LiveDecision } from '@/lib/seek/data';
import { decisionRoute, decisionsCsv, flashMessage, historyOf, loadDecisions, openDecision, replaceDecision, sourceUiId, undoDecision } from '@/lib/seek/liveDecisions';
import { now } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { PromptDialog } from '../Dialogs';
import { MainHeader, Shell, Sidebar } from '../Shell';
import { Ic } from '../icons';

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

const whenLabel = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return 'Today ' + time;
  if (days < 6) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + time;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

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
  const T: [string, string][] = [
    ['All', 'All types'],
    ['decision', 'Decisions'],
    ['approval', 'Approvals from clients'],
    ['client', 'Visible to clients'],
  ];
  const where = W.some(([k]) => k === ui.dWhere) ? ui.dWhere : 'All';
  const type = T.some(([k]) => k === ui.dType) ? ui.dType : 'All';
  const needle = q.trim().toLowerCase();
  const list = current.filter(
    (d) =>
      (where === 'All' || d.place === where) &&
      (type === 'All' || (type === 'client' ? d.client : d.kind === type)) &&
      (!needle || d.text.toLowerCase().includes(needle) || d.by.toLowerCase().includes(needle)),
  );
  const thisWeek = current.filter((d) => Date.now() - new Date(d.at).getTime() < 7 * 864e5).length;

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
      {W.map(([k, l, n]) => (
        <button key={k} type="button" className={'si' + (where === k ? ' on' : '')} aria-pressed={where === k} onClick={() => setUI({ dWhere: k, sideOpen: false })}>
          <span className="x">
            <b>{l}</b>
          </span>
          <span className="tag">{n}</span>
        </button>
      ))}
      <div className="sg lbl">Type</div>
      {T.map(([k, l]) => (
        <button key={k} type="button" className={'si' + (type === k ? ' on' : '')} aria-pressed={type === k} onClick={() => setUI({ dType: k, sideOpen: false })}>
          <span className="x">
            <b>{l}</b>
          </span>
        </button>
      ))}
    </Sidebar>
  );

  return (
    <Shell active="decisions" side={side}>
      <MainHeader
        title="Decisions"
        sub="What the team agreed, who agreed it, and the message it came from."
        right={
          all.length ? (
            <button type="button" className="btn sm" onClick={exportCsv}>
              <span aria-hidden="true" style={{ marginRight: 4 }}>
                <Ic n="download" />
              </span>
              Export
            </button>
          ) : undefined
        }
      />
      <div className="dl">
        <div className="intro">
          <p>{current.length ? 'Edit a decision to replace it; the old version stays in its history.' : 'Nothing logged yet.'}</p>
          <span className="tag v">This week · {thisWeek}</span>
        </div>
        {current.length > 0 && (
          <input className="inp" type="search" placeholder="Search decisions" aria-label="Search decisions" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: '0 0 4px' }} />
        )}
        {!current.length ? (
          <div className="empty">No decisions logged. When the team agrees something, open the message&apos;s More menu and choose Log decision (or press D) so it&apos;s easy to find later.</div>
        ) : list.length ? (
          list.map((d) => {
            const hist = historyOf(all, d);
            return (
              <div key={d.id} className={'dec' + (d.client ? ' gold' : '')}>
                <div className="k">
                  <span>{d.kind === 'approval' ? 'APPROVAL' : 'DECISION'}</span>
                  {d.client && <span className="tag gold">client can see</span>}
                  {hist.length > 0 && <span className="tag">edited</span>}
                  <small style={{ marginLeft: 'auto' }}>{whenLabel(d.at)}</small>
                </div>
                <b>{d.text}</b>
                <small>
                  {hist.length ? 'Edited' : 'Logged'} by {d.by} · {d.place}
                </small>
                <div className="a">
                  {d.source != null && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        update((x) => openDecision(d, x, me));
                        setUI({ chTab: 'Messages', thread: null });
                        router.push(decisionRoute(d));
                        const id = sourceUiId(d);
                        if (id != null) flashMessage(id);
                      }}
                    >
                      Source message
                    </button>
                  )}
                  {d.kind === 'decision' && (
                    <button type="button" className="btn sm ghost" onClick={() => setEditing(d)}>
                      Edit
                    </button>
                  )}
                  {d.kind === 'approval' && <span className="tag gold">signed off by the client · can’t be edited</span>}
                  {hist.length > 0 && (
                    <button type="button" className="btn sm ghost" aria-expanded={ui.hist === d.id} onClick={() => setUI({ hist: ui.hist === d.id ? null : d.id })}>
                      History ({hist.length})
                    </button>
                  )}
                  {me === d.byId && d.kind === 'decision' && (
                    <button type="button" className="btn sm ghost" onClick={() => void remove(d)}>
                      {d.replaces != null ? 'Undo edit' : 'Remove'}
                    </button>
                  )}
                </div>
                {ui.hist === d.id && (
                  <div className="hist">
                    <b style={{ color: 'var(--ink)' }}>History</b>
                    <span>
                      {whenLabel(d.at)} · “{d.text}” · {d.by} (current)
                    </span>
                    {hist.map((h) => (
                      <span key={h.id} style={{ textDecoration: 'line-through' }}>
                        {whenLabel(h.at)} · “{h.text}” · {h.by}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="empty">No decisions match these filters.</div>
        )}
        <div className="how">
          {HOW.map((t, i) => (
            <div key={i}>
              <i>{i + 1}</i>
              {t}
            </div>
          ))}
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

function DemoDecisionsPage() {
  const { s, ui, update, setUI, toast, nextId } = useSeek();
  const router = useRouter();
  const [editing, setEditing] = useState<Decision | null>(null);

  const decs = s.decs;
  const none = false;
  // same order as the prototype (launch-squad, design, Hollow & Bright), then any other place in log order
  const places = Array.from(new Set(['launch-squad', 'design', 'HB', ...decs.map((d) => d.where)])).filter((p) => decs.some((d) => d.where === p));
  const W: [string, string, number][] = [['All', 'All channels', decs.length], ...places.map((p): [string, string, number] => [p, p === 'HB' ? 'Hollow & Bright' : p.startsWith('DM ') ? p : '# ' + p, decs.filter((d) => d.where === p).length])];
  const T: [string, string][] = [
    ['All', 'All types'],
    ['dec', 'Decisions'],
    ['appr', 'Approvals from clients'],
  ];
  const list = decs.filter((d) => (ui.dWhere === 'All' || d.where === ui.dWhere) && (ui.dType === 'All' || d.type === ui.dType));

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
      {W.map(([k, l, n]) => (
        <button key={k} type="button" className={'si' + (ui.dWhere === k ? ' on' : '')} aria-pressed={ui.dWhere === k} onClick={() => setUI({ dWhere: k, sideOpen: false })}>
          <span className="x">
            <b>{l}</b>
          </span>
          <span className="tag">{n}</span>
        </button>
      ))}
      {!none && <div className="sg lbl">Type</div>}
      {!none && T.map(([k, l]) => (
        <button key={k} type="button" className={'si' + (ui.dType === k ? ' on' : '')} aria-pressed={ui.dType === k} onClick={() => setUI({ dType: k, sideOpen: false })}>
          <span className="x">
            <b>{l}</b>
          </span>
        </button>
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
        sub="What the team agreed, who agreed it, and the message it came from."
        right={
          none ? undefined : (
            <button type="button" className="btn sm" onClick={exportCsv}>
              <span aria-hidden="true" style={{ marginRight: 4 }}>
                <Ic n="download" />
              </span>
              Export
            </button>
          )
        }
      />
      <div className="dl">
        {none ? (
          <div className="intro">
            <p>Logging decisions from messages arrives in the next update.</p>
            <span className="tag">Coming soon</span>
          </div>
        ) : (
          <div className="intro">
            <p>Edit or undo a decision from its menu. Edited decisions keep their history.</p>
            <span className="tag v">This week · {list.length}</span>
          </div>
        )}
        {none ? (
          <div className="empty">No decisions logged. When the team agrees something, log it from the message so it&apos;s easy to find later.</div>
        ) : list.length ? (
          list.map((d) => (
            <div key={d.id} className={'dec' + (d.client ? ' gold' : '') + (d.old ? ' old' : '')}>
              <div className="k">
                <span>{d.old ? 'REPLACED' : 'DECISION'}</span>
                {d.client && <span className="tag gold">client</span>}
                <small style={{ marginLeft: 'auto' }}>{d.time}</small>
              </div>
              <b>{d.t}</b>
              <small>
                {d.by} · {whereLabel(d.where)}
              </small>
              <div className="a">
                <button type="button" className="btn sm" onClick={() => (d.old ? setUI({ hist: ui.hist === d.id ? null : d.id }) : openSource(d))}>
                  {d.a}
                </button>
                {!d.old && (
                  <button type="button" className="btn sm ghost" onClick={() => setEditing(d)}>
                    Edit
                  </button>
                )}
              </div>
              {ui.hist === d.id && (
                <div className="hist">
                  <b style={{ color: 'var(--ink)' }}>History</b>
                  {(d.hist || [`${d.time} · "${d.t}" logged`, d.by]).map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="empty">No decisions match these filters.</div>
        )}
        {!none && <div className="how">
          {[
            'Log one from any message: More, then Log decision, or press D.',
            'Undo appears for a few seconds after logging.',
            'Edit a decision to replace it. The old one stays in history.',
            'Clients see decisions made in their Client chat; Team notes decisions stay private.',
          ].map((t, i) => (
            <div key={i}>
              <i>{i + 1}</i>
              {t}
            </div>
          ))}
        </div>}
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
