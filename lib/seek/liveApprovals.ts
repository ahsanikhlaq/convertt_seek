'use client';

import { useEffect, useRef, useState } from 'react';
import { backendOn, DB_SCHEMA, sb } from './backend';
import type { Approval } from './data';

/**
 * Formal approvals in a client space (backend mode). The team asks a client approver to sign off something exact by
 * a date; only that approver answers (Approve, or Request changes with a note). Approving logs an approval in the
 * decision log. The database enforces who can do what; these are thin wrappers.
 */

type Row = {
  id: number;
  space_id: string;
  title: string;
  items: string;
  approver_id: string;
  due_on: string | null;
  status: Approval['status'];
  note: string;
  requested_by: string;
  requested_at: string;
  responded_at: string | null;
  last_nudged_at: string | null;
};
const COLS = 'id, space_id, title, items, approver_id, due_on, status, note, requested_by, requested_at, responded_at, last_nudged_at';
const toApproval = (r: Row): Approval => ({
  id: r.id,
  spaceId: r.space_id,
  title: r.title,
  items: r.items,
  approver: r.approver_id,
  due: r.due_on,
  status: r.status,
  note: r.note,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  respondedAt: r.responded_at,
  nudgedAt: r.last_nudged_at,
});

/** Turns a database error into something a person can act on. */
const why = (m: string, fallback: string) => {
  const known = [
    'pick an approver who has joined this space',
    'only the approver can answer this',
    'this approval was already answered',
    'say what should change',
    'already nudged in the last 24 hours',
    'this approval isn’t waiting',
    'only the team on this client can',
  ].find((k) => m.includes(k));
  if (!known) return fallback;
  if (known.startsWith('already nudged')) return 'Already nudged in the last 24 hours';
  return known.charAt(0).toUpperCase() + known.slice(1);
};

/** The space's approvals, newest first, kept live. */
export function useApprovals(space: string | null) {
  const [list, setList] = useState<Approval[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!backendOn || !space) {
      setList(null);
      return;
    }
    let alive = true;
    setList(null);
    const load = async () => {
      const { data, error } = await sb().from('approvals').select(COLS).eq('space_id', space).order('created_at', { ascending: false });
      if (alive && !error) setList(((data ?? []) as Row[]).map(toApproval));
    };
    void load();
    const ch = sb()
      .channel('seek-approvals:' + space)
      .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'approvals', filter: `space_id=eq.${space}` }, () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void load(), 250);
      })
      .subscribe();
    return () => {
      alive = false;
      clearTimeout(timer.current);
      sb().removeChannel(ch);
    };
  }, [space, tick]);

  return { list, reload: () => setTick((t) => t + 1) };
}

export async function requestApproval(space: string, a: { title: string; items: string; approver: string; due: string | null; decision?: number | null }) {
  const { error } = await sb().rpc('request_approval', {
    p_space: space,
    p_title: a.title.trim().slice(0, 120),
    p_items: a.items.trim().slice(0, 500),
    p_approver: a.approver,
    p_due: a.due || null,
    p_decision: a.decision ?? null,
  });
  return error ? why(error.message, 'Couldn’t send the request. Check your connection') : null;
}

export async function respondApproval(id: number, approve: boolean, note = '') {
  const { error } = await sb().rpc('respond_approval', { p_id: id, p_approve: approve, p_note: note.trim().slice(0, 1000) });
  return error ? why(error.message, 'Couldn’t send your answer. Check your connection') : null;
}

export async function rerequestApproval(id: number, items: string, due: string | null) {
  const { error } = await sb().rpc('rerequest_approval', { p_id: id, p_items: items.trim().slice(0, 500), p_due: due || null });
  return error ? why(error.message, 'Couldn’t send it again. Check your connection') : null;
}

export async function nudgeApproval(id: number) {
  const { error } = await sb().rpc('nudge_approval', { p_id: id });
  return error ? why(error.message, 'Couldn’t send the reminder. Check your connection') : null;
}

export async function withdrawApproval(id: number) {
  const { error, count } = await sb().from('approvals').delete({ count: 'exact' }).eq('id', id);
  return error || count === 0 ? 'Couldn’t withdraw it' : null;
}

/** "Thu 14 Nov", or "today"/"tomorrow"/"overdue". */
export function dueLabel(due: string | null) {
  if (!due) return 'no due date';
  const d = new Date(due + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 864e5);
  if (days < 0) return 'overdue (' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ')';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return 'due ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** A date input value n working days from today. */
export function workingDaysFromNow(n: number) {
  const d = new Date();
  while (n > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Set by "Request formal approval" on a Client chat decision; the Approvals tab opens its form with it. */
export const approvalDraft: { current: { decision: number; title: string; space: string } | null } = { current: null };
