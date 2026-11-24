'use client';

import { sb } from './backend';
import type { Space, Step } from './liveClients';

/**
 * Changing a client space after it is made (backend mode): its name, project and reply target, the team on it and
 * its lead, the onboarding checklist, and archiving it. Row-level security already lets anyone on the agency's team
 * edit their clients' spaces (see 20261111000006_client_spaces.sql), so these are plain updates; an update that
 * changes no row means the database said no.
 */

const NO = 'Only your team can change this client';
const why = (error: { message: string } | null, rows: unknown[] | null) => (error ? 'Couldn’t save that. Check your connection' : !rows?.length ? NO : null);

export async function saveSpace(id: string, p: { name: string; project: string; replyTarget: string }): Promise<string | null> {
  const name = p.name.trim();
  if (!name) return 'Give the client space a name';
  const { data, error } = await sb()
    .from('client_spaces')
    .update({ name: name.slice(0, 80), project: p.project.trim().slice(0, 80), reply_target: p.replyTarget.trim().slice(0, 60) || '1 working day' })
    .eq('id', id)
    .select('id');
  return why(error, data);
}

/** Archives the space: it leaves Clients for the team and the client's sign-in. Messages and files are kept. */
export async function archiveSpace(id: string): Promise<string | null> {
  const { data, error } = await sb().from('client_spaces').update({ status: 'closed' }).eq('id', id).select('id');
  return why(error, data);
}

export async function addTeammate(space: string, userId: string): Promise<string | null> {
  const { error } = await sb().from('client_team').insert({ space_id: space, user_id: userId });
  if (error && error.code !== '23505') return 'Couldn’t add them. Only your team can change this client';
  return null;
}

export async function removeTeammate(space: string, userId: string): Promise<string | null> {
  const { data, error } = await sb().from('client_team').delete().eq('space_id', space).eq('user_id', userId).select('user_id');
  return why(error, data);
}

/** Makes one teammate the lead (shown to the client first); everyone else on this client is no longer lead. */
export async function setLead(space: string, userId: string): Promise<string | null> {
  const on = await sb().from('client_team').update({ is_lead: true }).eq('space_id', space).eq('user_id', userId).select('user_id');
  const err = why(on.error, on.data);
  if (err) return err;
  const off = await sb().from('client_team').update({ is_lead: false }).eq('space_id', space).neq('user_id', userId).select('user_id');
  return off.error ? 'Couldn’t save that. Check your connection' : null;
}

export async function addStep(space: string, s: { title: string; side: 'client' | 'team'; position: number }): Promise<string | null> {
  const title = s.title.trim();
  if (!title) return 'Write the step first';
  const { error } = await sb()
    .from('client_steps')
    .insert({ space_id: space, kind: 'custom', title: title.slice(0, 120), side: s.side, position: s.position });
  return error ? 'Couldn’t add the step. Only your team can change this client' : null;
}

export async function updateStep(id: string, p: { title?: string; side?: 'client' | 'team'; detail?: string }): Promise<string | null> {
  const patch: Record<string, string> = {};
  if (p.title != null) {
    if (!p.title.trim()) return 'A step needs a title';
    patch.title = p.title.trim().slice(0, 120);
  }
  if (p.side) patch.side = p.side;
  if (p.detail != null) patch.detail = p.detail.trim().slice(0, 300);
  const { data, error } = await sb().from('client_steps').update(patch).eq('id', id).select('id');
  return why(error, data);
}

export async function deleteStep(id: string): Promise<string | null> {
  const { data, error } = await sb().from('client_steps').delete().eq('id', id).select('id');
  return why(error, data);
}

/** Saves a new order: each step's position becomes its place in `ids`. */
export async function reorderSteps(ids: string[]): Promise<string | null> {
  const res = await Promise.all(ids.map((id, i) => sb().from('client_steps').update({ position: i }).eq('id', id).select('id')));
  const bad = res.find((r) => r.error || !r.data?.length);
  return bad ? why(bad.error, bad.data) : null;
}

/**
 * Onboarding while any step is open, ongoing once every step is done (as ticking a step does on the server).
 * Called after steps are added or removed; an archived space stays archived.
 */
export async function syncStatus(sp: Space, steps: Pick<Step, 'doneAt'>[]): Promise<void> {
  if (sp.status === 'closed') return;
  const status = steps.length && steps.every((x) => x.doneAt) ? 'active' : steps.length ? 'onboarding' : sp.status;
  if (status !== sp.status) await sb().from('client_spaces').update({ status }).eq('id', sp.id);
}
