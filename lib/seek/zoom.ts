'use client';

/**
 * Zoom meetings for the person signed in (through the seek-zoom server function).
 *  · Connect once in Apps → Zoom. Seek can then create Zoom meetings in your Zoom account.
 *  · Scheduling a meeting with "Zoom" creates the Zoom meeting and puts its join link on the Seek meeting.
 *    Cancelling it in Seek deletes it in Zoom.
 *  · Huddles use a Zoom link when Google isn't connected but Zoom is.
 */
import { backendOn, sb } from './backend';

export type ZoomStatus = { configured: boolean; connected: boolean; email: string };

async function call<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await sb().functions.invoke('seek-zoom', { body });
  if (error) {
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) return { error: j.error };
    } catch {}
    return { error: 'Couldn’t reach Zoom. Check your connection' };
  }
  if (data?.error) return { error: data.error };
  return { data: data as T };
}

let cached: { at: number; p: Promise<ZoomStatus | null> } | null = null;
/** Whether Zoom is set up for Seek and connected for you (remembered for a minute). */
export function zoomStatus(fresh = false): Promise<ZoomStatus | null> {
  if (!backendOn) return Promise.resolve(null);
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.p;
  const p = call<ZoomStatus>({ action: 'status' }).then((r) => r.data ?? null);
  cached = { at: Date.now(), p };
  return p;
}

/** Sends you to Zoom's consent screen; it comes back to Apps. */
export async function connectZoom(): Promise<string | null> {
  const r = await call<{ url: string }>({ action: 'start' });
  if (!r.data?.url) return r.error ?? 'Couldn’t start connecting Zoom';
  location.assign(r.data.url);
  return null;
}

/** Back on Apps from Zoom with ?code&state (state starts with "zoom."): saves the connection. */
export async function finishZoom(code: string, state: string): Promise<string | null> {
  const r = await call<{ email: string }>({ action: 'finish', code, state });
  cached = null;
  return r.error ?? null;
}

export async function disconnectZoom(): Promise<string | null> {
  const r = await call({ action: 'disconnect' });
  cached = null;
  return r.error ?? null;
}

/** A scheduled Zoom meeting in your Zoom account. */
export function zoomMeeting(m: { space: string; title: string; startsAt: Date; minutes: number; agenda: string }) {
  return call<{ link: string; zoomId: string }>({ action: 'meeting', space: m.space, title: m.title, startsAt: m.startsAt.toISOString(), minutes: m.minutes, agenda: m.agenda });
}

export function attachZoomMeeting(meeting: number, zoomId: string) {
  return call({ action: 'attach', meeting, zoomId });
}

export function cancelZoomMeeting(meeting: number) {
  return call({ action: 'cancel', meeting });
}

/** A Zoom link for right now, or null when you haven't connected Zoom. */
export async function instantZoom(title: string): Promise<string | null> {
  const st = await zoomStatus();
  if (!st?.connected) return null;
  const r = await call<{ link: string }>({ action: 'instant', title });
  return r.data?.link ?? null;
}
