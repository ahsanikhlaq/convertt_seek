'use client';

import { sb } from './backend';

/**
 * Search (backend mode): messages, files, decisions, people and client spaces in one query. The database runs it
 * as you, so only what you may see comes back (a client never finds Team notes or other clients).
 */

export type SearchKind = 'all' | 'message' | 'file' | 'decision' | 'person' | 'space';
export const SEARCH_KINDS: [SearchKind, string][] = [
  ['all', 'All'],
  ['message', 'Messages'],
  ['file', 'Files'],
  ['decision', 'Decisions'],
  ['person', 'People'],
  ['space', 'Clients'],
];

export type Found = {
  kind: Exclude<SearchKind, 'all'>;
  ref: string;
  title: string;
  snippet: string | null;
  conv: string | null;
  at: string | null;
  userId: string | null;
  messageId: number | null;
};

export async function searchSeek(q: string, ws: string | null, kind: SearchKind): Promise<Found[] | null> {
  const { data, error } = await sb().rpc('search_seek', { p_q: q, p_ws: ws, p_kind: kind, p_limit: kind === 'all' ? 8 : 40 });
  if (error) return null;
  type R = { kind: Found['kind']; ref: string; title: string; snippet: string | null; conv: string | null; at: string | null; user_id: string | null; message_id: number | null };
  return ((data ?? []) as R[]).map((r) => ({ kind: r.kind, ref: r.ref, title: r.title, snippet: r.snippet, conv: r.conv, at: r.at, userId: r.user_id, messageId: r.message_id }));
}
