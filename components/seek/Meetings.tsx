'use client';

import { useEffect, useMemo, useState } from 'react';
import { PEOPLE, type HuddleCard, type MeetingCard } from '@/lib/seek/data';
import type { Space } from '@/lib/seek/liveClients';
import {
  cancelMeeting,
  clock,
  dayLabel,
  downloadIcs,
  offsetOf,
  placeOf,
  scheduleMeeting,
  seekRoom,
  suggestSlots,
  TOOLS,
  toolName,
  zonesOf,
  type Tool,
} from '@/lib/seek/liveMeetings';
import { useSeek } from '@/lib/seek/store';
import { Modal } from './Dialogs';
import { Switch } from './ui';
import { Ic } from './icons';

const myZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()!.replace(/_/g, ' ');
  } catch {
    return 'your time';
  }
};
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** "Schedule a meeting with <client>": who, suggested times in both time zones, video, agenda, send and record. */
export function ScheduleDialog({ sp, me, onClose, onScheduled }: { sp: Space; me: string | null; onClose: () => void; onScheduled: (toClient: boolean) => void }) {
  const { toast } = useSeek();
  const clients = sp.people.filter((p) => p.userId);
  const team = sp.team.map((t) => t.userId).filter((id) => id !== me);
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<string[]>([...clients.map((p) => p.userId!), ...team]);
  const [minutes, setMinutes] = useState(30);
  const [their, setTheir] = useState<{ offset: number | null; place: string }>({ offset: null, place: '' });
  const [slot, setSlot] = useState(0);
  const [custom, setCustom] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('meet');
  const [link, setLink] = useState('');
  const [agenda, setAgenda] = useState('');
  const [send, setSend] = useState(true);
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);

  // the client's time zone (from their profile) shapes the suggested times
  useEffect(() => {
    void zonesOf(clients.map((p) => p.userId!)).then((zones) => {
      const z = zones.find((x) => offsetOf(x) != null);
      if (z) setTheir({ offset: offsetOf(z), place: placeOf(z) });
    });
  }, [sp.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots = useMemo(() => suggestSlots(their.offset, minutes), [their.offset, minutes]);
  const startsAt = custom ? new Date(custom) : slots[slot] ?? null;
  const clientNames = clients.filter((p) => who.includes(p.userId!)).map((p) => (p.name.trim() || p.email.split('@')[0]).split(' ')[0]);
  const ok = !!title.trim() && !!startsAt && !Number.isNaN(startsAt.getTime()) && !busy && (tool !== 'person' || !!link.trim());

  const submit = async () => {
    if (!ok || !startsAt) return;
    if (startsAt.getTime() < Date.now()) {
      toast('Pick a time in the future');
      return;
    }
    setBusy(true);
    const err = await scheduleMeeting({
      space: sp.id,
      title,
      startsAt,
      minutes,
      tool,
      link: tool === 'seek' && !link.trim() ? seekRoom() : link,
      agenda,
      sendToClient: send,
      record,
      attendees: who.filter((id) => send || !clients.some((p) => p.userId === id)),
    });
    setBusy(false);
    if (err) {
      toast(err);
      return;
    }
    toast(send && clientNames.length ? `Meeting scheduled · ${clientNames.join(' and ')} ${clientNames.length > 1 ? 'have' : 'has'} been told` : 'Meeting scheduled · posted in Team notes');
    onScheduled(send);
    onClose();
  };

  const chip = (id: string, label: string, gold?: boolean) => {
    const on = who.includes(id);
    return (
      <button
        key={id}
        type="button"
        aria-pressed={on}
        className={'chip' + (on ? ' on' : '')}
        style={gold && on ? { background: 'var(--gold)', borderColor: 'var(--gold)' } : undefined}
        onClick={() => setWho((w) => (on ? w.filter((x) => x !== id) : [...w, id]))}
      >
        {label}
      </button>
    );
  };

  return (
    <Modal
      title={`Schedule a meeting with ${sp.name}`}
      icon={
        <span className="av" style={{ width: 34, height: 34, borderRadius: 9, background: sp.color, fontSize: 12 }}>
          {sp.code}
        </span>
      }
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn pri" disabled={!ok} onClick={() => void submit()}>
            {busy ? 'Scheduling…' : send ? 'Schedule and invite' : 'Schedule'}
          </button>
        </>
      }
    >
      <form
        className="mb"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="fld">
          <label htmlFor="mt-t">Title</label>
          <input id="mt-t" className="inp" value={title} maxLength={120} placeholder="Mobile review" autoFocus onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="fld">
          <label>Who</label>
          <div className="chips">
            {clients.map((p) => chip(p.userId!, (p.name.trim() || p.email.split('@')[0]).split(' ')[0] + ' (client)', true))}
            {team.map((id) => chip(id, PEOPLE[id]?.name?.split(' ')[0] ?? 'Teammate'))}
          </div>
          {sp.people.some((p) => !p.userId) && <em>People who haven&apos;t joined yet can&apos;t be invited until they do.</em>}
        </div>
        <div className="fld">
          <label>Suggested times · inside everyone&apos;s working hours</label>
          {slots.length ? (
            <div className="slots" role="radiogroup" aria-label="Suggested times">
              {slots.map((d, i) => (
                <button
                  key={d.toISOString()}
                  type="button"
                  role="radio"
                  aria-checked={!custom && slot === i}
                  className={'slot' + (!custom && slot === i ? ' on' : '')}
                  onClick={() => {
                    setCustom(null);
                    setSlot(i);
                  }}
                >
                  <small>{dayLabel(d)}</small>
                  <b>
                    {clock(d, null)} {myZone()}
                  </b>
                  <span>{their.offset != null ? `${clock(d, their.offset)} ${their.place}` : 'their time unknown'}</span>
                </button>
              ))}
            </div>
          ) : (
            <em>No shared working hours in the next two weeks. Pick a time below.</em>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="inp"
              type="datetime-local"
              aria-label="Or pick another time"
              style={{ width: 'auto' }}
              value={custom ?? ''}
              min={localInput(new Date())}
              onChange={(e) => setCustom(e.target.value || null)}
            />
            <select className="inp" style={{ width: 'auto' }} aria-label="Length" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
            {custom && their.offset != null && startsAt && <small style={{ color: 'var(--sb)' }}>{`${clock(startsAt, their.offset)} for ${their.place}`}</small>}
          </div>
        </div>
        <div className="fld">
          <label>Video</label>
          <div className="chips">
            {TOOLS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={tool === k} className={'chip' + (tool === k ? ' on' : '')} onClick={() => setTool(k)}>
                {l}
              </button>
            ))}
          </div>
          {tool === 'seek' ? (
            <em>A private video room is created for this call. It opens in the browser (Jitsi Meet); whoever starts it may be asked to sign in with Google, GitHub or Facebook.</em>
          ) : (
            <input
              className="inp"
              aria-label={tool === 'person' ? 'Where' : 'Meeting link'}
              placeholder={tool === 'person' ? 'Where (e.g. Convertt office, 3rd floor)' : `Paste the ${toolName(tool)} link (optional)`}
              value={link}
              maxLength={500}
              onChange={(e) => setLink(e.target.value)}
            />
          )}
        </div>
        <div className="fld">
          <label htmlFor="mt-a">Agenda</label>
          <textarea id="mt-a" className="inp" rows={2} maxLength={2000} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </div>
        <div className="trow">
          <div>
            <b>Send the invite to the client&apos;s space</b>
            <small>{send ? 'Posted in Client chat with a calendar file; they get a notification.' : 'Only posted in Team notes. The client isn’t told.'}</small>
          </div>
          <Switch on={send} label="Send the invite to the client's space" onClick={() => setSend(!send)} />
        </div>
        <div className="trow">
          <div>
            <b>Record and take notes</b>
            <small>{clientNames.length ? clientNames.join(' and ') : 'Everyone'} will see that the call is recorded.</small>
          </div>
          <Switch on={record} label="Record and take notes" onClick={() => setRecord(!record)} />
        </div>
      </form>
    </Modal>
  );
}

/** The MEETING card in a client space feed: when (your time), the tool, Join, Add to calendar, and Cancel for the team. */
export function MeetingCardView({ c }: { c: MeetingCard }) {
  const { s, toast } = useSeek();
  const team = s.session === 'in';
  const start = new Date(c.starts_at);
  const end = new Date(start.getTime() + c.duration * 60e3);
  const over = end.getTime() < Date.now();
  const soon = !over && start.getTime() - Date.now() < 15 * 60e3;
  const canJoin = !c.cancelled && !over && c.link.startsWith('https://');
  return (
    <div className="dec meet" style={{ boxShadow: 'inset 4px 0 0 var(--v)', marginLeft: 0, marginRight: 0 }}>
      <div className="k">
        <span>{c.cancelled ? 'CANCELLED' : 'MEETING'}</span>
        <span className="tag v">{toolName(c.tool)}</span>
        {c.record && !c.cancelled && <span className="tag">recorded</span>}
        {soon && !c.cancelled && <span className="tag ok">starting soon</span>}
      </div>
      <b style={c.cancelled ? { textDecoration: 'line-through', color: 'var(--sb)' } : undefined}>
        {c.title} · {dayLabel(start)} {clock(start, null)}–{clock(end, null)}
      </b>
      {c.agenda && <small style={{ whiteSpace: 'pre-wrap' }}>{c.agenda}</small>}
      {c.tool === 'person' && c.link && <small className="mtl"><Ic n="place" size={12} /> {c.link}</small>}
      {!c.cancelled && !over && (
        <div className="a">
          {canJoin && (
            <a className="btn sm pri" href={c.link} target="_blank" rel="noopener noreferrer">
              Join
            </a>
          )}
          <button type="button" className="btn sm" onClick={() => downloadIcs(c, s.ws.name || 'Seek')}>
            Add to calendar
          </button>
          {team && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={async () => {
                if (!confirm(`Cancel “${c.title}”? Everyone in this conversation sees that it’s cancelled.`)) return;
                const err = await cancelMeeting(c.id);
                toast(err ?? 'Meeting cancelled');
              }}
            >
              Cancel meeting
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A HUDDLE card: a live video room anyone in the conversation can join (it shows as ended after 4 hours). */
export function HuddleCardView({ c, call }: { c: HuddleCard; call?: boolean }) {
  const start = new Date(c.started_at);
  const live = Date.now() - start.getTime() < 4 * 3600e3;
  return (
    <div className="dec meet" style={{ boxShadow: 'inset 4px 0 0 var(--ok)', marginLeft: 0, marginRight: 0 }}>
      <div className="k">
        <span style={{ color: 'var(--ok)' }}>{call ? <><Ic n="phone" size={12} /> CALL</> : <><Ic n="huddle" size={12} /> HUDDLE</>}</span>
        {live ? <span className="tag ok">live</span> : <span className="tag">ended</span>}
        <small style={{ marginLeft: 'auto' }}>started {clock(start, null)}</small>
      </div>
      {live && (
        <div className="a">
          <a className="btn sm pri" href={c.link} target="_blank" rel="noopener noreferrer">
            Join
          </a>
          <small style={{ color: 'var(--sb)', alignSelf: 'center' }}>Opens in your browser · camera and mic optional</small>
        </div>
      )}
    </div>
  );
}
