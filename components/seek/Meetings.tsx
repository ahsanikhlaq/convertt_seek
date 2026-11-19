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
  TOOLS,
  toolName,
  zonesOf,
  type Tool,
} from '@/lib/seek/liveMeetings';
import { useSeek } from '@/lib/seek/store';
import { attachGoogleEvent, connectGoogle, googleMeeting, googleStatus, type GoogleStatus } from '@/lib/seek/gcal';
import { attachZoomMeeting, connectZoom, zoomMeeting, zoomStatus, type ZoomStatus } from '@/lib/seek/zoom';
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

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// ---- time zones (the browser's own list; times are worked out with Intl, so daylight saving is handled)
const myTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
/** Minutes the zone is ahead of UTC at that moment. */
function zoneOffset(tz: string, at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((wall - at.getTime()) / 60000);
}
/** 'YYYY-MM-DDTHH:mm' read as the clock on the wall in that zone → the moment it is. */
function zoned(v: string, tz: string) {
  const [d, t] = v.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let at = guess - zoneOffset(tz, new Date(guess)) * 60000;
  at = guess - zoneOffset(tz, new Date(at)) * 60000;
  return new Date(at);
}
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const gmt = (tz: string) => {
  const o = zoneOffset(tz, new Date());
  const a = Math.abs(o);
  return `GMT${o < 0 ? '−' : '+'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
};
const COMMON_TZ: [string, string][] = [
  ['America/New_York', 'US Eastern (New York)'],
  ['America/Chicago', 'US Central (Chicago)'],
  ['America/Denver', 'US Mountain (Denver)'],
  ['America/Los_Angeles', 'US Pacific (Los Angeles)'],
  ['America/Toronto', 'Canada (Toronto)'],
  ['Europe/London', 'UK (London)'],
  ['Europe/Dublin', 'Ireland (Dublin)'],
  ['Europe/Berlin', 'Central Europe (Berlin)'],
  ['Europe/Paris', 'France (Paris)'],
  ['Asia/Dubai', 'UAE (Dubai)'],
  ['Asia/Riyadh', 'Saudi Arabia (Riyadh)'],
  ['Asia/Karachi', 'Pakistan (Karachi)'],
  ['Asia/Kolkata', 'India (Kolkata)'],
  ['Asia/Singapore', 'Singapore'],
  ['Australia/Sydney', 'Australia (Sydney)'],
  ['UTC', 'UTC'],
];
const tzName = (tz: string) => COMMON_TZ.find(([z]) => z === tz)?.[1] ?? tz.split('/').pop()!.replace(/_/g, ' ');
function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return COMMON_TZ.map(([z]) => z);
  }
}
const nextQuarter = () => {
  const t = new Date(Date.now() + 15 * 60e3);
  t.setSeconds(0, 0);
  t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15);
  return t;
};
/** Every quarter hour of that day (in the zone); today, only the ones still ahead. */
function timesFor(day: string, tz: string) {
  const out: string[] = [];
  const min = day === todayIn(tz) ? nextQuarter() : null;
  for (let m = 0; m < 24 * 60; m += 15) {
    const v = pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    if (min && zoned(day + 'T' + v, tz) < min) continue;
    out.push(v);
  }
  return out;
}
const hm = (v: string) => new Date('2000-01-01T' + v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Pick any day on a month calendar, any quarter hour, in any time zone. value is 'YYYY-MM-DDTHH:mm' on the zone's clock. */
function DateTimePick({ value, tz, onChange, onTz }: { value: string | null; tz: string; onChange: (v: string) => void; onTz: (tz: string) => void }) {
  const today = todayIn(tz);
  const day = value?.slice(0, 10) ?? null;
  const time = value?.slice(11, 16) ?? null;
  const [month, setMonth] = useState(() => {
    const d = new Date((day ?? today) + 'T00:00');
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const lead = (month.getDay() + 6) % 7; // weeks start on Monday
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const firstMonth = ymd(month).slice(0, 7) <= today.slice(0, 7);
  const times = useMemo(() => (day ? timesFor(day, tz) : []), [day, tz]);
  const zones = useMemo(() => {
    const mine = myTz();
    const common = COMMON_TZ.map(([z]) => z);
    return { mine, common, rest: allZones().filter((z) => z !== mine && !common.includes(z)) };
  }, []);

  const pickDay = (d: Date) => {
    const k = ymd(d);
    const list = timesFor(k, tz);
    if (!list.length) return; // nothing left today
    onChange(k + 'T' + (time && list.includes(time) ? time : list.includes('10:00') ? '10:00' : list[0]));
  };

  return (
    <div className="dtp">
      <div className="mcal">
        <div className="mcal-h">
          <button type="button" className="mcal-nav" aria-label="Previous month" disabled={firstMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ‹
          </button>
          <b>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
          <button type="button" className="mcal-nav" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            ›
          </button>
        </div>
        <div className="mcal-g">
          {WEEK.map((w) => (
            <span key={w} className="mcal-w">
              {w}
            </span>
          ))}
          {cells.map((d, i) =>
            d ? (
              <button
                key={i}
                type="button"
                disabled={ymd(d) < today}
                aria-pressed={ymd(d) === day}
                aria-label={d.toDateString()}
                className={'mcal-d' + (ymd(d) === day ? ' on' : '') + (ymd(d) === today ? ' now' : '') + (d.getDay() % 6 === 0 ? ' we' : '')}
                onClick={() => pickDay(d)}
              >
                {d.getDate()}
              </button>
            ) : (
              <span key={i} />
            ),
          )}
        </div>
      </div>
      <div className="dtp-side">
        <label className="dtp-t">
          <span>Time</span>
          <select className="inp" value={day ? time ?? '' : ''} disabled={!day} onChange={(e) => day && e.target.value && onChange(day + 'T' + e.target.value)}>
            {!day && <option value="">Pick a day first</option>}
            {times.map((v) => (
              <option key={v} value={v}>
                {hm(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="dtp-t">
          <span>Time zone</span>
          <select className="inp" value={tz} onChange={(e) => onTz(e.target.value)}>
            <optgroup label="Your time zone">
              <option value={zones.mine}>
                {tzName(zones.mine)} · {gmt(zones.mine)}
              </option>
            </optgroup>
            <optgroup label="Common">
              {zones.common
                .filter((z) => z !== zones.mine)
                .map((z) => (
                  <option key={z} value={z}>
                    {tzName(z)} · {gmt(z)}
                  </option>
                ))}
            </optgroup>
            <optgroup label="All time zones">
              {zones.rest.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')} · {gmt(z)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
    </div>
  );
}

/** "Schedule a meeting with <client>": who, a date and time in any time zone, video, agenda, send and record. */
export function ScheduleDialog({ sp, me, onClose, onScheduled }: { sp: Space; me: string | null; onClose: () => void; onScheduled: (toClient: boolean) => void }) {
  const { toast } = useSeek();
  const clients = sp.people.filter((p) => p.userId);
  const team = sp.team.map((t) => t.userId).filter((id) => id !== me);
  const [title, setTitle] = useState('');
  const [who, setWho] = useState<string[]>([...clients.map((p) => p.userId!), ...team]);
  const [minutes, setMinutes] = useState(30);
  const [their, setTheir] = useState<{ offset: number | null; place: string }>({ offset: null, place: '' });
  const [custom, setCustom] = useState<string | null>(null);
  const [picking, setPicking] = useState(true);
  const [tz, setTz] = useState(myTz);
  const [tool, setTool] = useState<Tool>('meet');
  const [link, setLink] = useState('');
  const [agenda, setAgenda] = useState('');
  const [send, setSend] = useState(true);
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [zoom, setZoom] = useState<ZoomStatus | null>(null);
  useEffect(() => {
    void googleStatus().then(setGoogle);
    void zoomStatus().then(setZoom);
  }, []);
  // Google Meet with Google connected and no link pasted: Seek makes the Calendar event and the Meet link
  const autoMeet = tool === 'meet' && !!google?.connected && !link.trim();
  // Zoom with Zoom connected and no link pasted: Seek makes the Zoom meeting
  const autoZoom = tool === 'zoom' && !!zoom?.connected && !link.trim();

  // the client's time zone (from their profile) shapes the suggested times
  useEffect(() => {
    void zonesOf(clients.map((p) => p.userId!)).then((zones) => {
      const z = zones.find((x) => offsetOf(x) != null);
      if (z) setTheir({ offset: offsetOf(z), place: placeOf(z) });
    });
  }, [sp.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the picked day and time, read on the chosen zone's clock
  const startsAt = custom ? zoned(custom, tz) : null;
  const clientNames = clients.filter((p) => who.includes(p.userId!)).map((p) => (p.name.trim() || p.email.split('@')[0]).split(' ')[0]);
  const ok = !!title.trim() && !!startsAt && !Number.isNaN(startsAt.getTime()) && !busy && (tool !== 'person' || !!link.trim());

  const submit = async () => {
    if (!ok || !startsAt) return;
    if (startsAt.getTime() < Date.now()) {
      toast('Pick a time in the future');
      return;
    }
    setBusy(true);
    const attendees = who.filter((id) => send || !clients.some((p) => p.userId === id));
    let meetLink = tool === 'seek' && !link.trim() ? seekRoom() : link;
    let eventId: string | null = null;
    if (autoMeet) {
      const g = await googleMeeting({ space: sp.id, title, startsAt, minutes, agenda, attendees });
      if (!g.data) {
        setBusy(false);
        toast(g.error ?? 'Couldn’t create the Google Meet link');
        return;
      }
      meetLink = g.data.link;
      eventId = g.data.eventId;
    }
    let zoomId: string | null = null;
    if (autoZoom) {
      const zm = await zoomMeeting({ space: sp.id, title, startsAt, minutes, agenda });
      if (!zm.data) {
        setBusy(false);
        toast(zm.error ?? 'Couldn’t create the Zoom meeting');
        return;
      }
      meetLink = zm.data.link;
      zoomId = zm.data.zoomId;
    }
    const { error: err, id } = await scheduleMeeting({
      space: sp.id,
      title,
      startsAt,
      minutes,
      tool,
      link: meetLink,
      agenda,
      sendToClient: send,
      record,
      attendees,
    });
    if (!err && id && eventId) await attachGoogleEvent(id, eventId);
    if (!err && id && zoomId) await attachZoomMeeting(id, zoomId);
    setBusy(false);
    if (err) {
      toast(err);
      return;
    }
    const told = send && clientNames.length ? ` · ${clientNames.join(' and ')} ${clientNames.length > 1 ? 'have' : 'has'} been told` : ' · posted in Team notes';
    toast(eventId ? 'Meeting scheduled with Google Meet · invitations sent from your calendar' : (zoomId ? 'Meeting scheduled with a new Zoom meeting' : 'Meeting scheduled') + told);
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
        <span className="av" style={{ width: 34, height: 34, borderRadius: 9, background: sp.color, fontSize: 13 }}>
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
          <label>When</label>
          <button type="button" className={'pickbtn' + (custom ? ' on' : '')} aria-expanded={picking} onClick={() => setPicking(!picking)}>
            <Ic n="calendar" size={15} />
            {custom ? `${dayLabel(new Date(custom.slice(0, 10) + 'T00:00'))} at ${hm(custom.slice(11, 16))} · ${tzName(tz)}` : 'Pick a date & time'}
            <Ic n="chevron" size={13} />
          </button>
          {picking && <DateTimePick value={custom} tz={tz} onChange={setCustom} onTz={setTz} />}
          {startsAt && (tz !== myTz() || their.offset != null) && (
            <small className="whenhint">
              {[
                tz !== myTz() ? `${startsAt.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} your time (${myZone()})` : '',
                their.offset != null ? `${clock(startsAt, their.offset)} for ${their.place}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="inp" style={{ width: 'auto' }} aria-label="Length" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
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
          {tool === 'meet' && google?.connected && (
            <em className="gmeet ok">
              <Ic n="check" size={13} /> Seek creates the Google Meet link and adds the meeting to your Google Calendar ({google.email}). Guests get Google’s invitation email.
              Or paste a link below to use your own.
            </em>
          )}
          {tool === 'meet' && google && !google.connected && (
            <em className="gmeet">
              {google.configured ? (
                <>
                  <span>
                    Meetings are booked from <b>your own</b> Google Calendar. Connect yours once and Seek creates the Meet link and emails the invites. Everyone on the team connects their own.
                  </span>
                  <button type="button" className="btn sm pri" onClick={async () => {
                    const e = await connectGoogle();
                    if (e) toast(e);
                  }}>
                    Connect my Google Calendar
                  </button>
                  <span className="sub">Or paste a Meet link below.</span>
                </>
              ) : (
                'Paste a Google Meet link. (An admin can set up Google in Apps so Seek creates the link and the invite.)'
              )}
            </em>
          )}
          {tool === 'zoom' && zoom?.connected && (
            <em className="gmeet ok">
              <Ic n="check" size={13} /> Seek creates the Zoom meeting in your Zoom account ({zoom.email}) and puts its link on the invite. Or paste a link below to use your own.
            </em>
          )}
          {tool === 'zoom' && zoom && !zoom.connected && (
            <em className="gmeet">
              {zoom.configured ? (
                <>
                  <span>
                    Zoom meetings are created in <b>your own</b> Zoom account. Connect yours once and Seek makes the meeting and its link. Everyone on the team connects their own.
                  </span>
                  <button type="button" className="btn sm pri" onClick={async () => {
                    const e = await connectZoom();
                    if (e) toast(e);
                  }}>
                    Connect my Zoom
                  </button>
                  <span className="sub">Or paste a Zoom link below.</span>
                </>
              ) : (
                'Paste a Zoom link. (An admin can set up Zoom in Apps so Seek creates the meeting.)'
              )}
            </em>
          )}
          {tool === 'seek' ? (
            <em>A private video room is created for this call. It opens in the browser (Jitsi Meet); whoever starts it may be asked to sign in with Google, GitHub or Facebook.</em>
          ) : (
            <input
              className="inp"
              aria-label={tool === 'person' ? 'Where' : 'Meeting link'}
              placeholder={tool === 'person' ? 'Where (e.g. Convertt office, 3rd floor)' : autoMeet || (tool === 'meet' && google?.connected) ? 'Leave empty: Seek creates the Meet link' : autoZoom || (tool === 'zoom' && zoom?.connected) ? 'Leave empty: Seek creates the Zoom meeting' : `Paste the ${toolName(tool)} link (optional)`}
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
