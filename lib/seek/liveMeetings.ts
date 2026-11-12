'use client';

import { sb } from './backend';
import type { MeetingCard } from './data';

/**
 * Meetings with clients (backend mode). Scheduling posts a MEETING card in Client chat (or Team notes when the
 * invite isn't sent to the client); the database checks who may schedule, cancel and see each meeting.
 */

export type Tool = MeetingCard['tool'];
export const TOOLS: [Tool, string][] = [
  ['meet', 'Google Meet'],
  ['zoom', 'Zoom'],
  ['seek', 'Seek video'],
  ['person', 'In person'],
];
export const toolName = (t: Tool) => TOOLS.find((x) => x[0] === t)?.[1] ?? t;

/** Hours from UTC in a zone label such as "London (GMT+1)" or "New York (GMT-4)"; null when there is none. */
export function offsetOf(label: string | null | undefined): number | null {
  const m = /GMT\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i.exec(label ?? '');
  if (!m) return /\b(GMT|UTC)\b/i.test(label ?? '') ? 0 : null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60);
}
export const placeOf = (label: string) => label.replace(/\s*\(.*\)\s*$/, '').trim() || label;

const pad = (n: number) => String(n).padStart(2, '0');
/** "15:00" for a moment in a zone given by its UTC offset (or this computer's zone when null). */
export function clock(d: Date, offset: number | null) {
  if (offset == null) return pad(d.getHours()) + ':' + pad(d.getMinutes());
  const t = new Date(d.getTime() + offset * 3600e3);
  return pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes());
}
export function dayLabel(d: Date) {
  const today = new Date();
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Working hours: Mon–Fri, 09:00 to 17:30 (the meeting has to end by then). */
function inHours(d: Date, offset: number | null, minutes: number) {
  const t = offset == null ? d : new Date(d.getTime() + offset * 3600e3);
  const day = offset == null ? t.getDay() : t.getUTCDay();
  const h = offset == null ? t.getHours() + t.getMinutes() / 60 : t.getUTCHours() + t.getUTCMinutes() / 60;
  return day >= 1 && day <= 5 && h >= 9 && h + minutes / 60 <= 17.5;
}

/** Up to three times inside everyone's working hours (yours and the client's), one per day, soonest first. */
export function suggestSlots(theirOffset: number | null, minutes: number, count = 3): Date[] {
  const out: Date[] = [];
  const t = new Date(Date.now() + 60 * 60e3);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() < 30 ? 30 : 60);
  for (let i = 0; i < 14 * 48 && out.length < count; i++, t.setTime(t.getTime() + 30 * 60e3)) {
    if (!inHours(t, null, minutes) || (theirOffset != null && !inHours(t, theirOffset, minutes))) continue;
    if (out.some((x) => x.toDateString() === t.toDateString())) continue;
    out.push(new Date(t));
  }
  return out;
}

export async function scheduleMeeting(m: {
  space: string;
  title: string;
  startsAt: Date;
  minutes: number;
  tool: Tool;
  link: string;
  agenda: string;
  sendToClient: boolean;
  record: boolean;
  attendees: string[];
}) {
  const { error } = await sb().rpc('schedule_meeting', {
    p_space: m.space,
    p_title: m.title.trim().slice(0, 120),
    p_starts_at: m.startsAt.toISOString(),
    p_duration: m.minutes,
    p_tool: m.tool,
    p_link: m.link.trim().slice(0, 500),
    p_agenda: m.agenda.trim().slice(0, 2000),
    p_send_to_client: m.sendToClient,
    p_record: m.record,
    p_attendees: m.attendees,
  });
  if (!error) return null;
  if (/future/.test(error.message)) return 'Pick a time in the future';
  if (/https/.test(error.message)) return 'The video link must start with https://';
  return 'Couldn’t schedule it. Check your connection';
}

export async function cancelMeeting(id: number) {
  const { error } = await sb().rpc('cancel_meeting', { p_id: id });
  return error ? 'Couldn’t cancel it. Check your connection' : null;
}

export type Upcoming = { id: number; title: string; startsAt: string; minutes: number; tool: Tool; link: string; spaceId: string; space: string; code: string; color: string; toClient: boolean };

/** The next meetings across your client spaces (not cancelled, not long over). */
export async function upcomingMeetings(): Promise<Upcoming[] | null> {
  const { data, error } = await sb()
    .from('meetings')
    .select('id, title, starts_at, duration_min, tool, link, send_to_client, space_id, client_spaces ( name, code, color )')
    .is('cancelled_at', null)
    .gte('starts_at', new Date(Date.now() - 60 * 60e3).toISOString())
    .order('starts_at')
    .limit(50);
  if (error) return null;
  type R = { id: number; title: string; starts_at: string; duration_min: number; tool: Tool; link: string; send_to_client: boolean; space_id: string; client_spaces: { name: string; code: string; color: string } | null };
  return ((data ?? []) as unknown as R[]).map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.starts_at,
    minutes: r.duration_min,
    tool: r.tool,
    link: r.link,
    spaceId: r.space_id,
    space: r.client_spaces?.name ?? 'Client',
    code: r.client_spaces?.code ?? '',
    color: r.client_spaces?.color ?? '#8a5300',
    toClient: r.send_to_client,
  }));
}

/** Time zone labels of people (to suggest times inside the client's working hours). */
export async function zonesOf(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data } = await sb().from('profiles').select('time_zone').in('id', ids);
  return ((data ?? []) as { time_zone: string }[]).map((r) => r.time_zone).filter(Boolean);
}

/** A calendar file (.ics) for the meeting, saved by the browser. */
export function downloadIcs(c: Pick<MeetingCard, 'id' | 'title' | 'starts_at' | 'duration' | 'tool' | 'link' | 'agenda'>, org: string) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const start = new Date(c.starts_at);
  const end = new Date(start.getTime() + c.duration * 60e3);
  const where = c.link || toolName(c.tool);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Seek by Convertt//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:seek-meeting-${c.id}@seek`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(c.title + ' · ' + org)}`,
    `LOCATION:${esc(where)}`,
    `DESCRIPTION:${esc([c.agenda, c.link ? 'Join: ' + c.link : ''].filter(Boolean).join('\n\n'))}`,
    ...(c.link.startsWith('https://') ? [`URL:${c.link}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  a.download = c.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) + '.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A Seek video room: a free Jitsi Meet room with a random, unguessable name (no account needed). */
export const seekRoom = () => 'https://meet.jit.si/Seek-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
