'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Decision } from '@/lib/seek/data';
import { now } from '@/lib/seek/format';
import { ROUTES } from '@/lib/seek/routes';
import { useSeek } from '@/lib/seek/store';
import { PromptDialog } from '../Dialogs';
import { MainHeader, Shell, Sidebar } from '../Shell';

const whereLabel = (w: string) => (w === 'HB' ? 'Hollow & Bright' : w.startsWith('DM ') ? w : '#' + w);

export function DecisionsPage() {
  const { s, ui, update, setUI, toast, nextId } = useSeek();
  const router = useRouter();
  const [editing, setEditing] = useState<Decision | null>(null);

  // same order as the prototype (launch-squad, design, Hollow & Bright), then any other place in log order
  const places = Array.from(new Set(['launch-squad', 'design', 'HB', ...s.decs.map((d) => d.where)])).filter((p) => s.decs.some((d) => d.where === p));
  const W: [string, string, number][] = [['All', 'All channels', s.decs.length], ...places.map((p): [string, string, number] => [p, p === 'HB' ? 'Hollow & Bright' : p.startsWith('DM ') ? p : '# ' + p, s.decs.filter((d) => d.where === p).length])];
  const T: [string, string][] = [
    ['All', 'All types'],
    ['dec', 'Decisions'],
    ['appr', 'Approvals from clients'],
  ];
  const list = s.decs.filter((d) => (ui.dWhere === 'All' || d.where === ui.dWhere) && (ui.dType === 'All' || d.type === ui.dType));

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
      <div className="sg lbl">Type</div>
      {T.map(([k, l]) => (
        <button key={k} type="button" className={'si' + (ui.dType === k ? ' on' : '')} aria-pressed={ui.dType === k} onClick={() => setUI({ dType: k, sideOpen: false })}>
          <span className="x">
            <b>{l}</b>
          </span>
        </button>
      ))}
    </Sidebar>
  );

  const exportCsv = () => {
    const rows = [['Decision', 'By', 'Where', 'When', 'Type', 'Status'], ...s.decs.map((d) => [d.t, d.by, whereLabel(d.where), d.time, d.type === 'appr' ? 'Approval' : 'Decision', d.old ? 'Replaced' : 'Current'])];
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
          <button type="button" className="btn sm" onClick={exportCsv}>
            ⇩ Export
          </button>
        }
      />
      <div className="dl">
        <div className="intro">
          <p>Edit or undo a decision from its menu. Edited decisions keep their history.</p>
          <span className="tag v">This week · {list.length}</span>
        </div>
        {list.length ? (
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
        <div className="how">
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
