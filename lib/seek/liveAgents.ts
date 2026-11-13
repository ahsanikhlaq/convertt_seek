'use client';

import { sb } from './backend';

/**
 * AI agent settings (backend mode): each agent's on/off and permission level, Pause all AI, and the agent log.
 * Only admins change them (the database checks). The agents themselves run on the server once the AI
 * connection (a Claude API key) is added; until then they're set up but idle.
 */

export type AgentKey = 'summariser' | 'task_suggester' | 'away_assistant' | 'scope_guard' | 'retainer_watch' | 'status_drafter';
export type Level = 'suggest' | 'ask' | 'act';

export const LEVELS: [Level, string, string][] = [
  ['suggest', 'Suggest only', 'Shows a suggestion; a person acts.'],
  ['ask', 'Asks before acting', 'Prepares the action; a person approves.'],
  ['act', 'Acts', 'Acts on its own inside the rules, and logs it.'],
];
export const levelName = (l: Level) => LEVELS.find((x) => x[0] === l)?.[1] ?? l;

/** The six agents from the spec, with their defaults. Client-visible ones never act on their own. */
export const AGENTS: { key: AgentKey; name: string; does: string; level: Level; client: boolean; on: boolean; needs?: string }[] = [
  { key: 'summariser', name: 'Summariser', does: 'Catch-up on a channel or /summarize, with links to every source.', level: 'suggest', client: false, on: true },
  { key: 'task_suggester', name: 'Task suggester', does: 'Proposes tasks from messages. You accept or dismiss.', level: 'suggest', client: false, on: true },
  { key: 'away_assistant', name: 'Away assistant', does: 'A channel member that replies when nobody on the team is around: answers from what you teach it, or says you’ll get back to them.', level: 'ask', client: true, on: true },
  { key: 'scope_guard', name: 'Scope guard', does: 'Flags requests outside the accepted scope and drafts a change request.', level: 'suggest', client: false, on: true, needs: 'each client’s agreed scope' },
  { key: 'retainer_watch', name: 'Retainer watch', does: 'Warns in Team notes at 80% and 100% of a retainer.', level: 'suggest', client: false, on: true, needs: 'retainer hours tracking' },
  { key: 'status_drafter', name: 'Status drafter', does: 'Drafts the weekly client update for your review.', level: 'ask', client: true, on: false },
];

export type AgentState = { enabled: boolean; level: Level };
export type LogEntry = { id: number; agent: string; at: string; action: string; conv: string | null; sources: string[] };

export async function loadAgents(ws: string): Promise<{ settings: Map<AgentKey, AgentState>; paused: boolean; pausedBy: string | null } | null> {
  const [{ data: rows, error }, { data: w }] = await Promise.all([
    sb().from('agent_settings').select('agent, enabled, level').eq('workspace_id', ws),
    sb().from('workspaces').select('ai_paused, ai_paused_by').eq('id', ws).maybeSingle(),
  ]);
  if (error) return null;
  const settings = new Map<AgentKey, AgentState>();
  for (const a of AGENTS) settings.set(a.key, { enabled: a.on, level: a.level });
  for (const r of (rows ?? []) as { agent: AgentKey; enabled: boolean; level: Level }[]) settings.set(r.agent, { enabled: r.enabled, level: r.level });
  const ww = w as { ai_paused: boolean; ai_paused_by: string | null } | null;
  return { settings, paused: !!ww?.ai_paused, pausedBy: ww?.ai_paused_by ?? null };
}

export async function setAgent(ws: string, agent: AgentKey, enabled: boolean, level: Level) {
  const { error } = await sb().rpc('set_agent', { p_ws: ws, p_agent: agent, p_enabled: enabled, p_level: level });
  return error ? (/admins/.test(error.message) ? 'Only admins can change agents' : 'Couldn’t save. Check your connection') : null;
}

/** What the assistant knows: instructions (tone, what to say) and knowledge (facts, FAQs). */
export async function loadTraining(ws: string, agent: AgentKey): Promise<{ instructions: string; knowledge: string }> {
  const { data } = await sb().from('agent_settings').select('instructions, knowledge').eq('workspace_id', ws).eq('agent', agent).maybeSingle();
  const d = data as { instructions?: string; knowledge?: string } | null;
  return { instructions: d?.instructions ?? '', knowledge: d?.knowledge ?? '' };
}

export async function saveTraining(ws: string, agent: AgentKey, instructions: string, knowledge: string) {
  const { error } = await sb().rpc('set_agent_training', { p_ws: ws, p_agent: agent, p_instructions: instructions, p_knowledge: knowledge });
  return error ? (/admins/.test(error.message) ? 'Only admins can teach agents' : 'Couldn’t save. Check your connection') : null;
}

/** Agents that are running now (the others are switched on but not built yet). */
export const RUNNING: AgentKey[] = ['summariser', 'task_suggester', 'away_assistant'];

export async function setAiPaused(ws: string, paused: boolean) {
  const { error } = await sb().rpc('set_ai_paused', { p_ws: ws, p_paused: paused });
  return error ? (/admins/.test(error.message) ? 'Only admins can pause AI' : 'Couldn’t save. Check your connection') : null;
}

export async function agentLog(ws: string, agent: AgentKey | 'all' | null): Promise<LogEntry[] | null> {
  let q = sb().from('agent_log').select('id, agent, at, action, conv, sources').eq('workspace_id', ws);
  if (agent && agent !== 'all') q = q.in('agent', [agent, 'all']);
  const { data, error } = await q.order('at', { ascending: false }).limit(100);
  if (error) return null;
  return ((data ?? []) as { id: number; agent: string; at: string; action: string; conv: string | null; sources: unknown }[]).map((r) => ({
    ...r,
    sources: Array.isArray(r.sources) ? (r.sources as unknown[]).map(String) : [],
  }));
}
