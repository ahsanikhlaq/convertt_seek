'use client';

/**
 * Google Calendar and Google Meet for the person signed in (through the seek-google server function).
 *  · Connect once in Apps → Google Calendar & Meet. Seek can then create Calendar events with a Meet link.
 *  · Scheduling a meeting with "Google Meet" makes the event in your calendar, invites the guests by email, and
 *    puts the Meet link on the meeting. Cancelling it in Seek cancels the event.
 *  · Huddles and calls use a Google Meet link when you're connected (otherwise a Seek video room).
 */
import { backendOn, sb } from './backend';

export type GoogleStatus = { configured: boolean; connected: boolean; email: string };

async function call<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await sb().functions.invoke('seek-google', { body });
  if (error) {
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) return { error: j.error };
    } catch {}
    return { error: 'Couldn’t reach Google. Check your connection' };
  }
  if (data?.error) return { error: data.error };
  return { data: data as T };
}

let cached: { at: number; p: Promise<GoogleStatus | null> } | null = null;
/** Whether Google is set up for Seek and connected for you (remembered for a minute). */
export function googleStatus(fresh = false): Promise<GoogleStatus | null> {
  if (!backendOn) return Promise.resolve(null);
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.p;
  const p = call<GoogleStatus>({ action: 'status' }).then((r) => r.data ?? null);
  cached = { at: Date.now(), p };
  return p;
}

/** Sends you to Google's consent screen; it comes back to Apps. */
export async function connectGoogle(): Promise<string | null> {
  const r = await call<{ url: string }>({ action: 'start' });
  if (!r.data?.url) return r.error ?? 'Couldn’t start connecting Google';
  location.assign(r.data.url);
  return null;
}

/** Back on Apps from Google with ?code&state: saves the connection. Returns an error message, or null. */
export async function finishGoogle(code: string, state: string): Promise<string | null> {
  const r = await call<{ email: string }>({ action: 'finish', code, state });
  cached = null;
  return r.error ?? null;
}

export async function disconnectGoogle(): Promise<string | null> {
  const r = await call({ action: 'disconnect' });
  cached = null;
  return r.error ?? null;
}

/** A Calendar event with a Meet link; guests (Seek user ids) get Google's invitation email. */
export async function googleMeeting(m: { space: string; title: string; startsAt: Date; minutes: number; agenda: string; attendees: string[] }) {
  return call<{ link: string; eventId: string }>({ action: 'event', space: m.space, title: m.title, startsAt: m.startsAt.toISOString(), minutes: m.minutes, agenda: m.agenda, attendees: m.attendees });
}

export function attachGoogleEvent(meeting: number, eventId: string) {
  return call({ action: 'attach', meeting, eventId });
}

export function cancelGoogleEvent(meeting: number) {
  return call({ action: 'cancel', meeting });
}

/** A Meet link for right now, or null when you haven't connected Google. */
export async function instantMeet(title: string): Promise<string | null> {
  const st = await googleStatus();
  if (!st?.connected) return null;
  const r = await call<{ link: string }>({ action: 'instant', title });
  return r.data?.link ?? null;
}
