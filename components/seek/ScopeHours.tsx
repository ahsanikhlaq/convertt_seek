'use client';

import { useEffect, useState } from 'react';
import { PEOPLE } from '@/lib/seek/data';
import { keyFor, learnProfiles } from '@/lib/seek/live';
import type { LiveClients, Space } from '@/lib/seek/liveClients';
import { deleteTime, draftStatus, logTime, saveRetainer, saveScope, timeEntries, type TimeEntry } from '@/lib/seek/liveScope';
import { fmtHours, fmtMinutes, monthRange, parseDuration, parseRetainer, retainerUse, today } from '@/lib/seek/hours';
import { useSeek } from '@/lib/seek/store';
import { Modal, useConfirm } from './Dialogs';
import { Ic } from './icons';
import { Avatar } from './ui';

/**
 * A client space's "Scope & hours" tab (team only): the agreed scope Scope guard checks client requests against,
 * the monthly retainer with time logged against it (Retainer watch warns in Team notes at 80% and 100%), and the
 * weekly client update drafted by Status drafter.
 */
export function ScopeHoursTab({ live, sp, onDraft }: { live: LiveClients; sp: Space; onDraft: () => void }) {
  return (
    <div className="pg ag-pg">
      <ScopeCard live={live} sp={sp} />
      <RetainerCard live={live} sp={sp} />
      <div className="card">
        <div className="ct">
          <Ic n="ai" />
          <b>Weekly client update</b>
        </div>
        <small className="ag-help">Status drafter writes a draft from the last 7 days of Client chat, decisions and approvals (never Team notes). You edit it, then send it to {sp.name} or copy it.</small>
        <div>
          <button type="button" className="btn" onClick={onDraft}>
            <Ic n="ai" /> Draft weekly update
          </button>
        </div>
      </div>
    </div>
  );
}

function ScopeCard({ live, sp }: { live: LiveClients; sp: Space }) {
  const { toast } = useSeek();
  const saved = sp.scope ?? '';
  const [text, setText] = useState(saved);
  const [base, setBase] = useState(saved);
  const [busy, setBusy] = useState(false);
  // someone else saved a new scope: take it, unless you're in the middle of editing
  useEffect(() => {
    if (text === base) setText(saved);
    setBase(saved);
  }, [saved, sp.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = text !== saved;
  return (
    <div className="card">
      <div className="ct">
        <Ic n="shield" />
        <b>Agreed scope</b>
        {!saved.trim() && <span className="tag">not set</span>}
      </div>
      <small className="ag-help">
        What {sp.name} has agreed to: deliverables, rounds of changes, what’s excluded. Scope guard checks each new request in Client chat against it and, when one looks outside it, posts a note with a draft change request in Team notes. The client never sees these notes.
      </small>
      <textarea
        className="inp ag-scope"
        aria-label={'Agreed scope for ' + sp.name}
        value={text}
        maxLength={8000}
        rows={8}
        placeholder={'e.g.\n- 5-page marketing website (Home, About, Services, Work, Contact)\n- 2 rounds of design changes per page\n- Not included: copywriting, blog, e-commerce, ongoing SEO'}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ag-row">
        <small className="ag-help">{text.length > 7000 ? `${text.length} / 8000` : ''}</small>
        <span style={{ flex: 1 }} />
        {dirty && (
          <button type="button" className="btn sm ghost" onClick={() => setText(saved)}>
            Undo changes
          </button>
        )}
        <button
          type="button"
          className="btn sm pri"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            const err = await saveScope(sp.id, text.trim());
            setBusy(false);
            if (err) return toast(err);
            await live.reload();
            toast('Scope saved');
          }}
        >
          {busy ? 'Saving…' : 'Save scope'}
        </button>
      </div>
    </div>
  );
}

function RetainerCard({ live, sp }: { live: LiveClients; sp: Space }) {
  const { toast } = useSeek();
  const [ask, confirmDialog] = useConfirm();
  const month = monthRange();
  const hours = sp.retainerHours ?? null;
  const [ret, setRet] = useState(hours == null ? '' : String(hours));
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [tick, setTick] = useState(0);
  const [dur, setDur] = useState('');
  const [day, setDay] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setRet(hours == null ? '' : String(hours)), [hours, sp.id]);
  useEffect(() => {
    let alive = true;
    setEntries(null);
    void timeEntries(sp.id, month.from, month.to).then(async (l) => {
      if (l) await learnProfiles([...new Set(l.map((e) => e.userId))], live.me);
      if (alive) setEntries(l ?? []);
    });
    return () => {
      alive = false;
    };
  }, [sp.id, tick, month.from]); // eslint-disable-line react-hooks/exhaustive-deps

  const used = (entries ?? []).reduce((n, e) => n + e.minutes, 0);
  const use = retainerUse(used, hours);
  const mins = parseDuration(dur);

  const saveRet = async () => {
    const h = parseRetainer(ret);
    if (h !== null && Number.isNaN(h)) return toast('Enter hours from 0.5 to 1000, or leave it empty for no retainer');
    const err = await saveRetainer(sp.id, h);
    if (err) return toast(err);
    await live.reload();
    toast(h == null ? 'Retainer removed' : `Retainer set to ${h} hours a month`);
  };

  const log = async () => {
    if (mins == null) return toast('Enter the time like 1.5, 1:30 or 1h 30m (up to 24 hours)');
    if (!day) return toast('Pick the day you worked');
    setBusy(true);
    const err = await logTime(sp.id, mins, day, note);
    setBusy(false);
    if (err) return toast(err);
    setDur('');
    setNote('');
    setTick((t) => t + 1);
    toast(`Logged ${fmtMinutes(mins)}` + (day < month.from || day >= month.to ? ' (not this month)' : ''));
  };

  return (
    <div className="card">
      <div className="ct">
        <Ic n="clock" />
        <b>Retainer</b>
        {use && <span className={'tag' + (use.band === 'over' ? ' red' : use.band === 'warn' ? ' gold' : '')}>{use.pct}%</span>}
      </div>
      <small className="ag-help">Hours {sp.name} pays for each calendar month. Retainer watch posts in Team notes when the time logged reaches 80% and again at 100%.</small>
      <form
        className="ag-row"
        onSubmit={(e) => {
          e.preventDefault();
          void saveRet();
        }}
      >
        <label htmlFor={'ag-ret-' + sp.id} className="ag-lbl">
          Hours per month
        </label>
        <input id={'ag-ret-' + sp.id} className="inp ag-num" inputMode="decimal" placeholder="none" value={ret} onChange={(e) => setRet(e.target.value)} />
        <button type="submit" className="btn sm" disabled={ret.trim() === (hours == null ? '' : String(hours))}>
          Save
        </button>
      </form>

      <div className="ag-use">
        <div className="ag-row">
          <b>{month.label}</b>
          <span style={{ flex: 1 }} />
          <span className={'ag-num-l' + (use ? ' ' + use.band : '')}>
            {entries ? (hours ? `${fmtHours(used)} of ${hours} h used` : `${fmtHours(used)} h logged`) : 'Loading…'}
          </span>
        </div>
        {use && (
          <div className={'ag-bar ' + use.band} role="progressbar" aria-label="Retainer used this month" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(use.pct, 100)} aria-valuetext={use.pct + '%'}>
            <i style={{ width: Math.min(use.pct, 100) + '%' }} />
          </div>
        )}
      </div>

      <form
        className="ag-log"
        onSubmit={(e) => {
          e.preventDefault();
          void log();
        }}
      >
        <div className="fld ag-f-dur">
          <label htmlFor={'ag-d-' + sp.id}>Time</label>
          <input id={'ag-d-' + sp.id} className="inp" placeholder="1.5 or 1h 30m" value={dur} onChange={(e) => setDur(e.target.value)} />
          <em>{dur.trim() ? (mins == null ? 'Like 1.5, 1:30 or 1h 30m' : fmtMinutes(mins)) : 'Hours, or h and min'}</em>
        </div>
        <div className="fld ag-f-day">
          <label htmlFor={'ag-w-' + sp.id}>Day</label>
          <input id={'ag-w-' + sp.id} className="inp" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="fld ag-f-note">
          <label htmlFor={'ag-n-' + sp.id}>Note</label>
          <input id={'ag-n-' + sp.id} className="inp" maxLength={300} placeholder="What you worked on" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="submit" className="btn pri ag-f-go" disabled={busy || !dur.trim()}>
          {busy ? 'Logging…' : 'Log time'}
        </button>
      </form>

      {entries && entries.length > 0 && (
        <div className="ag-list" aria-label={'Time logged in ' + month.label}>
          {entries.map((e) => {
            const k = keyFor(e.userId, live.me);
            const mine = e.userId === live.me;
            return (
              <div key={e.id} className="ag-entry">
                <Avatar k={k} size={26} />
                <span className="x">
                  <b>
                    {mine ? 'You' : PEOPLE[k]?.name ?? 'Someone'} · {fmtMinutes(e.minutes)}
                  </b>
                  <small>
                    {new Date(e.workedOn + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {e.note ? ' · ' + e.note : ''}
                  </small>
                </span>
                {mine && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    aria-label="Delete this entry"
                    title="Delete"
                    onClick={async () => {
                      if (!(await ask({ title: 'Delete this time entry?', body: `${fmtMinutes(e.minutes)} logged on ${new Date(e.workedOn + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}.`, confirm: 'Delete', danger: true }))) return;
                      const err = await deleteTime(e.id);
                      if (err) return toast(err);
                      setTick((t) => t + 1);
                      toast('Deleted');
                    }}
                  >
                    <Ic n="trash" size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {entries && !entries.length && <small className="ag-help">No time logged in {month.label} yet.</small>}
      {confirmDialog}
    </div>
  );
}

/** Status drafter's weekly update: edit it, then send it to the client (as you) or copy it. */
export function DraftUpdateDialog({ live, sp, readers, onClose, onSent }: { live: LiveClients; sp: Space; readers: string; onClose: () => void; onSent: () => void }) {
  const { toast } = useSeek();
  const [text, setText] = useState('');
  const [state, setState] = useState<{ busy: boolean; error: string | null; sources: number }>({ busy: true, error: null, sources: 0 });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ busy: true, error: null, sources: 0 });
    void draftStatus(sp.id).then((r) => {
      if (!alive) return;
      if (r.error) setState({ busy: false, error: r.error, sources: 0 });
      else {
        setText(r.text ?? '');
        setState({ busy: false, error: null, sources: r.sources ?? 0 });
      }
    });
    return () => {
      alive = false;
    };
  }, [sp.id, round]);

  const body = text.trim();
  return (
    <Modal
      title={'Weekly update for ' + sp.name}
      icon={<Ic n="ai" />}
      onClose={onClose}
      width={620}
      footer={
        <div className="ag-foot">
          <button type="button" className="btn ghost" onClick={() => setRound((n) => n + 1)} disabled={state.busy}>
            <Ic n="reset" size={14} /> Redraft
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn"
            disabled={!body}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(body);
                toast('Copied');
              } catch {
                toast('Couldn’t copy. Select the text and copy it');
              }
            }}
          >
            <Ic n="copy" size={14} /> Copy
          </button>
          <button
            type="button"
            className="btn gold"
            disabled={!body || state.busy}
            onClick={() => {
              void live.send(sp.id, 'client', body.slice(0, 8000));
              toast('Sent to ' + readers);
              onSent();
            }}
          >
            <Ic n="send" size={14} /> Send to client
          </button>
        </div>
      }
    >
      <div className="mb">
        {state.busy ? (
          <div className="aiwait">
            <Ic n="ai" /> Reading this week’s Client chat…
          </div>
        ) : state.error ? (
          <div className="empty">{state.error}</div>
        ) : (
          <>
            <textarea className="inp ag-draft" aria-label="Draft update" value={text} maxLength={8000} rows={14} onChange={(e) => setText(e.target.value)} />
            <small className="aifoot" style={{ marginTop: 0 }}>
              Status drafter · from {state.sources} Client chat message{state.sources === 1 ? '' : 's'} in the last 7 days, never Team notes · AI can make mistakes, so check it before you send. It goes to {readers} as you.
            </small>
          </>
        )}
      </div>
    </Modal>
  );
}
