'use client';

import { sb } from './backend';

/**
 * Scope guard, Retainer watch and Status drafter (backend mode).
 *  · Scope guard: after a client posts in Client chat, their app asks the server to check it against the agreed scope
 *    (the server does all the checks again and only ever writes to Team notes).
 *  · Retainer watch: the team logs time against a client; the database warns in Team notes at 80% and 100%.
 *  · Status drafter: drafts the weekly client update for a person to edit and send.
 */

// which side this app is on ('client' when a client is signed in), set by useLiveClients
let clientSide = false;
export function setSenderSide(side: 'team' | 'client') {
  clientSide = side === 'client';
}
export const sendingAsClient = () => clientSide;

/** Fire and forget: ask Scope guard to look at a Client chat message the client just sent. */
export function checkScope(messageId: number) {
  if (!clientSide) return;
  void sb()
    .functions.invoke('seek-ai', { body: { action: 'scope', message_id: messageId } })
    .then(
      () => {},
      () => {},
    );
}

export async function saveScope(space: string, scope: string): Promise<string | null> {
  const { error } = await sb().from('client_spaces').update({ scope: scope.slice(0, 8000) }).eq('id', space);
  return error ? 'Couldn’t save the scope. Check your connection' : null;
}

export async function saveRetainer(space: string, hours: number | null): Promise<string | null> {
  const { error } = await sb().from('client_spaces').update({ retainer_hours: hours }).eq('id', space);
  return error ? 'Couldn’t save the retainer. Check your connection' : null;
}

export type TimeEntry = { id: number; userId: string; minutes: number; note: string; workedOn: string; createdAt: string };

/** Time logged on a client between two dates (YYYY-MM-DD, [from, to)), newest first. */
export async function timeEntries(space: string, from: string, to: string): Promise<TimeEntry[] | null> {
  const { data, error } = await sb()
    .from('time_entries')
    .select('id, user_id, minutes, note, worked_on, created_at')
    .eq('space_id', space)
    .gte('worked_on', from)
    .lt('worked_on', to)
    .order('worked_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return null;
  return ((data ?? []) as { id: number; user_id: string; minutes: number; note: string; worked_on: string; created_at: string }[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    minutes: r.minutes,
    note: r.note,
    workedOn: r.worked_on,
    createdAt: r.created_at,
  }));
}

export async function logTime(space: string, minutes: number, workedOn: string, note: string): Promise<string | null> {
  const { error } = await sb().from('time_entries').insert({ space_id: space, minutes, worked_on: workedOn, note: note.trim().slice(0, 300) });
  if (!error) return null;
  return /last year/.test(error.message) ? 'Pick a date in the last year' : 'Couldn’t log the time. Check your connection';
}

export async function deleteTime(id: number): Promise<string | null> {
  const { error } = await sb().from('time_entries').delete().eq('id', id);
  return error ? 'Couldn’t delete it' : null;
}

/** A draft weekly update for the client (nothing is posted). */
export async function draftStatus(space: string): Promise<{ text?: string; sources?: number; error?: string }> {
  const { data, error } = await sb().functions.invoke('seek-ai', { body: { action: 'status', space } });
  if (error) {
    // the function's own message (e.g. "Status drafter is switched off") is in the response body
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) return { error: j.error };
    } catch {}
    return { error: 'The AI couldn’t draft it. Try again shortly' };
  }
  if (data?.error) return { error: data.error };
  return { text: String(data?.text ?? ''), sources: Number(data?.sources ?? 0) };
}
