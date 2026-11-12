'use client';

import { useEffect, useRef } from 'react';
import { backendOn, DB_SCHEMA, sb } from './backend';
import type { LiveDecision, PersonKey, State } from './data';
import { keyFor, toDbId, toUiId } from './live';
import { ROUTES } from './routes';
import { useSeek } from './store';

/**
 * The decision log (backend mode). Anything agreed can be logged from its message; the database keeps who, when,
 * where and the source message, and only shows a decision to people who can see the conversation it came from.
 * Editing adds a new decision that replaces the old one (history kept); undo removes your own.
 */

type Row = {
  id: number;
  text: string;
  kind: LiveDecision['kind'];
  channel_id: string | null;
  channel_name: string | null;
  dm_id: string | null;
  dm_with_id: string | null;
  dm_with: string | null;
  space_id: string | null;
  space_name: string | null;
  space_code: string | null;
  lane: 'client' | 'team' | null;
  source_message_id: number | null;
  logged_by: string;
  logged_by_name: string | null;
  replaces_id: number | null;
  replaced_at: string | null;
  created_at: string;
};

const toDecision = (r: Row): LiveDecision => ({
  id: r.id,
  text: r.text,
  kind: r.kind,
  conv: r.channel_id ? 'ch:' + r.channel_id : r.dm_id ? 'dm:' + r.dm_id : 'sp:' + r.space_id + ':' + r.lane,
  place: r.channel_id
    ? '# ' + (r.channel_name ?? 'channel')
    : r.dm_id
      ? 'DM · ' + (r.dm_with ?? 'teammate')
      : (r.space_name ?? 'Client') + (r.lane === 'team' ? ' · Team notes' : ' · Client chat'),
  dmWith: r.dm_with_id ?? undefined,
  client: r.lane === 'client',
  source: r.source_message_id,
  by: r.logged_by_name ?? 'Someone',
  byId: r.logged_by,
  replaces: r.replaces_id,
  replacedAt: r.replaced_at,
  at: r.created_at,
});

/** Turns a message into a short decision ("Let's ship B on Friday." → "Ship B on Friday"). */
export function decisionFrom(text: string) {
  const t = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(ok(ay)?|so|great|agreed)[,!.:]?\s+/i, '')
    .replace(/^let'?s\s+/i, '')
    .replace(/[.!]+$/, '');
  const one = t.charAt(0).toUpperCase() + t.slice(1);
  return one.length > 300 ? one.slice(0, 297) + '…' : one;
}

export async function loadDecisions(ws: string | null): Promise<LiveDecision[] | null> {
  const { data, error } = await sb().rpc('decision_log', { p_ws: ws });
  if (error) return null;
  return ((data ?? []) as Row[]).map(toDecision);
}

/** Logs a decision from a message (by its UI id). Returns the new decision's id, or an error message. */
export async function logDecision(uiId: number, text: string): Promise<{ id?: number; error?: string }> {
  const src = toDbId(uiId);
  if (src == null) return { error: 'This message isn’t saved yet' };
  const { data, error } = await sb().from('decisions').insert({ text: text.trim(), source_message_id: src }).select('id').single();
  if (error) return { error: /row-level security/i.test(error.message) ? 'You can’t log decisions here' : 'Couldn’t log the decision. Check your connection' };
  return { id: (data as { id: number }).id };
}

export async function undoDecision(id: number) {
  const { error, count } = await sb().from('decisions').delete({ count: 'exact' }).eq('id', id);
  return !error && count !== 0;
}

export async function replaceDecision(id: number, text: string): Promise<string | null> {
  const { error } = await sb().rpc('replace_decision', { p_id: id, p_text: text });
  return error ? (/already replaced/.test(error.message) ? 'Someone already edited this decision. Reload to see it' : 'Couldn’t save the edit. Check your connection') : null;
}

/** The current (not replaced) decisions logged from a message. */
export const decisionsFor = (s: State, uiId: number) => {
  const src = toDbId(uiId);
  return src == null ? [] : (s.ldecs ?? []).filter((d) => d.source === src && !d.replacedAt);
};

/** Earlier versions of a decision, newest first. */
export function historyOf(all: LiveDecision[], d: LiveDecision) {
  const out: LiveDecision[] = [];
  let at = d.replaces;
  while (at != null) {
    const prev = all.find((x) => x.id === at);
    if (!prev || out.includes(prev)) break;
    out.push(prev);
    at = prev.replaces;
  }
  return out;
}

/** The screen a decision's conversation is on. */
export const decisionRoute = (dec: LiveDecision): string => (dec.conv.startsWith('ch:') ? ROUTES.channels : dec.conv.startsWith('dm:') ? ROUTES.dms : ROUTES.clients);

/** Selects the conversation a decision came from (call inside update; then go to decisionRoute and flash). */
export function openDecision(dec: LiveDecision, d: State, me: string | null) {
  const [kind, id, lane] = dec.conv.split(':');
  if (kind === 'ch') {
    const c = d.workspaces.C.channels.find((x) => x.cid === id);
    if (c) {
      d.wsId = 'C';
      d.workspaces.C.ch = c.id;
    }
  } else if (kind === 'dm') {
    if (dec.dmWith) d.dm = keyFor(dec.dmWith, me) as PersonKey;
  } else {
    d.cs = id;
    d.cTab = lane === 'team' ? 'Team notes' : 'Client chat';
  }
}

export const sourceUiId = (dec: LiveDecision) => (dec.source == null ? null : toUiId(dec.source));

/** Scrolls to a message once it is on screen and makes it flash. */
export function flashMessage(uiId: number) {
  let tries = 0;
  const look = () => {
    const el = document.querySelector<HTMLElement>(`.msg[data-id="${uiId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    } else if (++tries < 25) setTimeout(look, 200);
  };
  setTimeout(look, 150);
}

/** Loads the decision log and keeps it live. Mounted once, in the app frame. */
export function useLiveDecisions(me: string | null) {
  const { s, update } = useSeek();
  const team = s.session === 'in';
  const on = backendOn && !!me && (team || s.session === 'client');
  const ws = team ? (s.orgId ?? null) : null;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!on || (team && !ws)) return;
    let alive = true;
    const reload = async () => {
      const list = await loadDecisions(ws);
      if (alive && list)
        update((d) => {
          d.ldecs = list;
        });
    };
    void reload();
    // any change (logged, edited, undone) reloads the log, a moment later so bursts load once
    const later = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void reload(), 300);
    };
    const ch = sb()
      .channel('seek-decisions:' + (ws ?? me))
      .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'decisions', ...(ws ? { filter: `workspace_id=eq.${ws}` } : {}) }, later)
      .subscribe();
    return () => {
      alive = false;
      clearTimeout(timer.current);
      sb().removeChannel(ch);
    };
  }, [on, team, ws, me]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A decision as a CSV row for export. */
export function decisionsCsv(list: LiveDecision[]) {
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rows = [
    ['Decision', 'Logged by', 'Where', 'When', 'Type', 'Status', 'Client can see'],
    ...list.map((d) => [d.text, d.by, d.place, when(d.at), d.kind === 'approval' ? 'Approval' : 'Decision', d.replacedAt ? 'Replaced ' + when(d.replacedAt) : 'Current', d.client ? 'Yes' : 'No']),
  ];
  // a leading = + - @ would run as a formula in spreadsheets
  const cell = (c: string) => '"' + String(c).replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"';
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}
