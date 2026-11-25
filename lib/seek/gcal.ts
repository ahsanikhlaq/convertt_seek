'use client';

/**
 * Google Calendar and Google Meet for the person signed in (through the seek-google server function).
 *  · Connect once in Apps → Google Calendar & Meet. Seek can then create Calendar events with a Meet link.
 *  · Scheduling a meeting with "Google Meet" makes the event in your calendar, invites the guests by email, and
 *    puts the Meet link on the meeting. Cancelling it in Seek cancels the event.
 *  · Huddles and calls use a Google Meet link when you're connected (otherwise a Seek video room).
 */
import { backendOn, knownUserId, sb } from './backend';

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

// the last status seen on this device, per person, so Apps and huddles don't wait for the server function
const SAVED = 'seek:googleStatus:';
/** Your last-known Google status on this device (no network), or null when not checked here yet. */
export function knownGoogleStatus(): GoogleStatus | null {
  const uid = knownUserId();
  if (!uid) return null;
  try {
    return JSON.parse(localStorage.getItem(SAVED + uid) || 'null') as GoogleStatus | null;
  } catch {
    return null;
  }
}
function keepStatus(st: GoogleStatus | null) {
  const uid = knownUserId();
  try {
    if (uid && st) localStorage.setItem(SAVED + uid, JSON.stringify(st));
    else if (uid) localStorage.removeItem(SAVED + uid);
  } catch {}
}

let cached: { at: number; p: Promise<GoogleStatus | null> } | null = null;
/** Whether Google is set up for Seek and connected for you (remembered for a minute, and on this device). */
export function googleStatus(fresh = false): Promise<GoogleStatus | null> {
  if (!backendOn) return Promise.resolve(null);
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.p;
  const p = call<GoogleStatus>({ action: 'status' }).then((r) => {
    if (r.data) keepStatus(r.data);
    return r.data ?? null;
  });
  cached = { at: Date.now(), p };
  return p;
}

/** Sends you to Google's consent screen; it comes back to Apps. */
export async function connectGoogle(): Promise<string | null> {
  // the consent screen comes back to Apps; remember where you were, to go back there afterwards, and which app is
  // connecting (a refusal can come back without a state saying whose it is)
  try {
    sessionStorage.setItem('seek.connecting', 'google');
    if (!location.pathname.startsWith('/apps')) sessionStorage.setItem('seek.afterConnect', location.pathname + location.search);
    else sessionStorage.removeItem('seek.afterConnect');
  } catch {}
  const r = await call<{ url: string }>({ action: 'start' });
  if (!r.data?.url) {
    try {
      sessionStorage.removeItem('seek.connecting');
      sessionStorage.removeItem('seek.afterConnect');
    } catch {}
    return r.error ?? 'Couldn’t start connecting Google';
  }
  location.assign(r.data.url);
  return null;
}

/** Back on Apps from Google with ?code&state: saves the connection. Returns the error message, or the account's email. */
export async function finishGoogle(code: string, state: string): Promise<{ error: string | null; email: string }> {
  const r = await call<{ email: string }>({ action: 'finish', code, state });
  cached = null;
  if (r.error || !r.data) {
    keepStatus(null);
    return { error: r.error ?? 'Couldn’t connect Google. Try again', email: '' };
  }
  const email = String(r.data.email ?? '');
  keepStatus({ configured: true, connected: true, email });
  return { error: null, email };
}

export async function disconnectGoogle(): Promise<string | null> {
  const r = await call({ action: 'disconnect' });
  cached = null;
  keepStatus(null);
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

/**
 * A Meet link for right now, or null when you haven't connected Google. `connected`: already known to be connected
 * (saved on this device), so the status check is skipped.
 */
export async function instantMeet(title: string, connected = false): Promise<string | null> {
  if (!connected) {
    const st = await googleStatus();
    if (!st?.connected) return null;
  }
  const r = await call<{ link: string }>({ action: 'instant', title });
  // check again next time (it may have been disconnected elsewhere)
  if (!r.data?.link && connected) keepStatus(null);
  return r.data?.link ?? null;
}
