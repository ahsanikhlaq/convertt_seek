'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { backendOn, DB_SCHEMA, sb } from '@/lib/seek/backend';
import { loadAgents, type AgentKey, type AgentState } from '@/lib/seek/liveAgents';
import type { Lane } from '@/lib/seek/liveClients';
import { onSpaceAgents, spaceAgents, type SpaceAgent } from '@/lib/seek/liveSpaces';
import { useSeek } from '@/lib/seek/store';
import { Ic } from './icons';

const CatchUpDialog = dynamic(() => import('./AiDialogs').then((m) => m.CatchUpDialog), { ssr: false });

/**
 * Team-channel conveniences for a client space's header (team side only; both render nothing for a client):
 *  · SpaceAgentsButton: shows whether the space's AI agents are on and opens Space settings → AI agents.
 *  · SpaceCatchUp: "Catch up", an AI summary of the open lane (Client chat or Team notes), like in channels.
 */

let channelNo = 0;

/**
 * The agents turned on for a client space (team only), kept up to date live. `agents` is null while loading.
 * With `ws`, also the workspace's agent settings and whether all AI is paused (for "on, but off for everyone").
 */
export function useSpaceAgents(space: string, ws?: string | null): { agents: SpaceAgent[] | null; settings: Map<AgentKey, AgentState> | null; paused: boolean } {
  const { s } = useSeek();
  const team = backendOn && s.session === 'in';
  const [agents, setAgents] = useState<SpaceAgent[] | null>(null);
  const [work, setWork] = useState<{ settings: Map<AgentKey, AgentState>; paused: boolean } | null>(null);

  useEffect(() => {
    if (!team || !space) return;
    let alive = true;
    let live: RealtimeChannel | null = null;
    const load = () =>
      void spaceAgents(space).then((a) => {
        if (alive && a) setAgents(a);
      });
    setAgents(null);
    load();
    // (a delete can't be filtered by space in Realtime, so any change reloads this space's list)
    live = sb()
      .channel('seek-space-agents:' + space + ':' + ++channelNo)
      .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'space_agents' }, load)
      .subscribe();
    const off = onSpaceAgents((sp, a) => {
      if (alive && sp === space) setAgents(a);
    });
    return () => {
      alive = false;
      off();
      if (live) sb().removeChannel(live);
    };
  }, [team, space]);

  useEffect(() => {
    if (!team || !ws) return;
    let alive = true;
    void loadAgents(ws).then((r) => {
      if (alive && r) setWork({ settings: r.settings, paused: r.paused });
    });
    return () => {
      alive = false;
    };
  }, [team, ws]);

  return { agents, settings: work?.settings ?? null, paused: !!work?.paused };
}

export type SpaceAgentsButtonProps = {
  /** the client space's id */
  space: string;
  /** the workspace id (live.orgId): with it, the dot also goes out when the agent is off for everyone or AI is paused */
  ws?: string | null;
  /** open Space settings on the AI agents tab, e.g. () => setSettings('AI agents') */
  onOpen: () => void;
  /** icon only (no "Agents" label) */
  compact?: boolean;
  className?: string;
};

/** A compact header button: AI icon, "Agents", and a small dot while an agent replies in this space's Client chat. */
export function SpaceAgentsButton({ space, ws, onOpen, compact, className }: SpaceAgentsButtonProps) {
  const { s } = useSeek();
  const { agents, settings, paused } = useSpaceAgents(space, ws);
  if (!backendOn || s.session !== 'in') return null;
  const away = !!agents?.includes('away_assistant');
  const live = away && !paused && (settings?.get('away_assistant')?.enabled ?? true);
  const title = away
    ? live
      ? 'AI agents · the Away assistant is on in Client chat'
      : 'AI agents · the Away assistant is on here, but ' + (paused ? 'all AI is paused' : 'it’s turned off for the workspace')
    : 'AI agents for this client';
  return (
    <button type="button" className={'btn sm spagbtn' + (className ? ' ' + className : '')} onClick={onOpen} title={title} aria-label={title}>
      <Ic n="ai" />
      {!compact && <span className="hide-m">Agents</span>}
      {away && <span className={'spagdot' + (live ? ' on' : '')} aria-hidden="true" />}
    </button>
  );
}

export type SpaceCatchUpProps = {
  /** the client space's id */
  space: string;
  /** the lane being read: 'client' (Client chat) or 'team' (Team notes) */
  lane: Lane;
  /** the client's name, for the dialog title ("Catch up on Hollow & Bright · Client chat") */
  name: string;
  className?: string;
};

/** "Catch up": the Summariser on the open lane, shown in the same dialog as in channels and DMs. */
export function SpaceCatchUp({ space, lane, name, className }: SpaceCatchUpProps) {
  const { s } = useSeek();
  const [open, setOpen] = useState(false);
  if (!backendOn || s.session !== 'in' || !space) return null;
  return (
    <>
      <button type="button" className={'btn sm' + (className ? ' ' + className : '')} onClick={() => setOpen(true)} title="An AI summary of the latest messages">
        <Ic n="ai" /> <span className="hide-m">Catch up</span>
      </button>
      {open && <CatchUpDialog conv={'sp:' + space + ':' + lane} where={name + (lane === 'team' ? ' · Team notes' : ' · Client chat')} onClose={() => setOpen(false)} />}
    </>
  );
}
