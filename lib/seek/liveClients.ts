'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { backendOn, currentAccount, DB_SCHEMA, inviteClient, completeStep, sb, type ClientRole } from './backend';
import type { ChatMessage } from './data';
import { keyFor, learnProfiles, timeLabel, toUiId } from './live';
import { hydrateReactions } from './liveSync';
import { useSeek } from './store';

/**
 * Real client spaces (backend mode). The agency's team sees every client of its organization, with Client chat
 * and Team notes; a client sees only their own space, and only its Client chat (the database enforces both).
 * Messages are written into app state (s.lc, keyed "<space>:<lane>") so the existing feed and composer render them.
 */

export type Lane = 'client' | 'team';
export type ClientPerson = { id: string; email: string; name: string; role: ClientRole; userId: string | null; joinedAt: string | null; invitedAt: string };
export type TeamMember = { userId: string; isLead: boolean };
export type Step = { id: string; kind: string; title: string; detail: string; side: 'client' | 'team'; position: number; doneAt: string | null };
export type Space = {
  id: string;
  name: string;
  project: string;
  code: string;
  color: string;
  status: 'onboarding' | 'active' | 'closed';
  replyTarget: string;
  tone: string;
  neverMention: string[];
  createdAt: string;
  people: ClientPerson[];
  team: TeamMember[];
  steps: Step[];
};

type Row = { id: number; space_id: string | null; lane: Lane | null; user_id: string; parent_id: number | null; body: string; created_at: string };
const COLS = 'id, space_id, lane, user_id, parent_id, body, created_at';

export const laneKey = (space: string, lane: Lane) => space + ':' + lane;
/** People still to join (invited, not signed in yet). */
export const pending = (sp: Space) => sp.people.filter((p) => !p.userId);
/** "Chris and Priya", "Chris, Priya and Tom", or "the client" when nobody is listed. */
export function namesOf(people: ClientPerson[]) {
  const n = people.map((p) => (p.name.trim() || p.email.split('@')[0]).split(' ')[0]);
  if (!n.length) return 'the client';
  return n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}

export type LiveClients = {
  ready: boolean;
  /** 'team' for the agency, 'client' for a client */
  side: 'team' | 'client';
  me: string | null;
  orgId: string | null;
  spaces: Space[];
  reload: () => Promise<void>;
  send: (space: string, lane: Lane, text: string) => Promise<void>;
  tick: (step: string, done: boolean) => Promise<void>;
  addPerson: (space: string, p: { email: string; name: string; role: ClientRole }) => Promise<string>;
  resend: (space: string, email: string) => Promise<string>;
  setRole: (person: string, role: ClientRole) => Promise<string | null>;
  remove: (person: string) => Promise<string | null>;
};

export function useLiveClients(): LiveClients | null {
  const { s, update, toast } = useSeek();
  const enabled = backendOn && (s.session === 'in' || s.session === 'client');
  const side: 'team' | 'client' = s.session === 'client' ? 'client' : 'team';
  const [ready, setReady] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const me = useRef<string | null>(null);
  const org = useRef<string | null>(null);
  const open = s.cs;
  const lane: Lane = side === 'client' || s.cTab !== 'Team notes' ? 'client' : 'team';

  // people on the client side, so their messages are marked "client" in the team's view
  const clientIds = useRef(new Set<string>());
  const toMsg = (r: Row, flash = false): ChatMessage => ({
    kind: 'msg',
    id: toUiId(r.id),
    who: keyFor(r.user_id, me.current),
    time: timeLabel(r.created_at),
    text: r.body,
    flash,
    client: side === 'team' && clientIds.current.has(r.user_id),
  });

  const load = useCallback(async () => {
    const acc = await currentAccount();
    if (!acc) return;
    me.current = acc.id;
    org.current = acc.workspace?.id ?? null;
    let q = sb()
      .from('client_spaces')
      .select('id, name, project, code, color, status, reply_target, tone, never_mention, created_at, client_people ( id, email, name, role, user_id, joined_at, invited_at, removed_at ), client_team ( user_id, is_lead ), client_steps ( id, kind, title, detail, side, position, done_at )')
      .neq('status', 'closed')
      .order('created_at', { ascending: false });
    if (side === 'team' && acc.workspace) q = q.eq('workspace_id', acc.workspace.id);
    const { data, error } = await q;
    if (error) {
      toast('Couldn’t load clients. Check your connection');
      return;
    }
    type R = {
      id: string; name: string; project: string; code: string; color: string; status: Space['status']; reply_target: string; tone: string; never_mention: string[]; created_at: string;
      client_people: { id: string; email: string; name: string; role: ClientRole; user_id: string | null; joined_at: string | null; invited_at: string; removed_at: string | null }[];
      client_team: { user_id: string; is_lead: boolean }[];
      client_steps: { id: string; kind: string; title: string; detail: string; side: 'client' | 'team'; position: number; done_at: string | null }[];
    };
    const list: Space[] = ((data ?? []) as R[]).map((r) => ({
      id: r.id,
      name: r.name,
      project: r.project,
      code: r.code,
      color: r.color,
      status: r.status,
      replyTarget: r.reply_target,
      tone: r.tone,
      neverMention: r.never_mention ?? [],
      createdAt: r.created_at,
      people: (r.client_people ?? []).filter((p) => !p.removed_at).map((p) => ({ id: p.id, email: p.email, name: p.name, role: p.role, userId: p.user_id, joinedAt: p.joined_at, invitedAt: p.invited_at })),
      team: (r.client_team ?? []).map((t) => ({ userId: t.user_id, isLead: t.is_lead })).sort((a, b) => Number(b.isLead) - Number(a.isLead)),
      steps: (r.client_steps ?? []).map((x) => ({ id: x.id, kind: x.kind, title: x.title, detail: x.detail, side: x.side, position: x.position, doneAt: x.done_at })).sort((a, b) => a.position - b.position),
    }));
    // names and faces for everyone in these spaces
    const ids = list.flatMap((x) => [...x.people.map((p) => p.userId).filter((v): v is string => !!v), ...x.team.map((t) => t.userId)]);
    await learnProfiles(ids, me.current);
    clientIds.current = new Set(list.flatMap((x) => x.people.map((p) => p.userId).filter((v): v is string => !!v)));
    setSpaces(list);
    update((d) => {
      if (!list.some((x) => x.id === d.cs)) d.cs = list[0]?.id ?? '';
    });
    setReady(true);
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- start, and listen for changes (new messages, ticked steps, people joining)
  useEffect(() => {
    if (!enabled) return;
    let live: RealtimeChannel | null = null;
    let alive = true;
    (async () => {
      await load();
      if (!alive) return;
      const reloadSoon = () => void load();
      const filter = side === 'team' && org.current ? `workspace_id=eq.${org.current}` : undefined;
      live = sb()
        .channel('seek-clients:' + (org.current ?? me.current))
        .on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'messages', ...(filter ? { filter } : {}) }, async (p) => {
          const r = p.new as Row;
          if (!r.space_id || !r.lane || r.parent_id != null) return;
          await learnProfiles([r.user_id], me.current);
          update((d) => {
            const k = laneKey(r.space_id!, r.lane!);
            const list = ((d.lc ||= {})[k] ||= []);
            if (!list.some((m) => m.id === toUiId(r.id))) list.push(toMsg(r, r.user_id === me.current));
          });
        })
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'client_steps' }, reloadSoon)
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'client_people' }, reloadSoon)
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'client_spaces' }, reloadSoon)
        .subscribe();
    })();
    return () => {
      alive = false;
      if (live) sb().removeChannel(live);
    };
  }, [enabled, side]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the open conversation's messages (latest 300, oldest first)
  useEffect(() => {
    if (!enabled || !ready || !open) return;
    let alive = true;
    (async () => {
      const { data, error } = await sb().from('messages').select(COLS).eq('space_id', open).eq('lane', lane).is('parent_id', null).order('created_at', { ascending: false }).limit(300);
      if (!alive) return;
      if (error) {
        toast('Couldn’t load messages. Check your connection');
        return;
      }
      const rows = ((data ?? []) as Row[]).reverse();
      await learnProfiles(rows.map((r) => r.user_id), me.current);
      if (!alive) return;
      const msgs = rows.map((r) => toMsg(r));
      update((d) => {
        (d.lc ||= {})[laneKey(open, lane)] = msgs;
      });
      await hydrateReactions(update, msgs.map((m) => m.id), me.current);
    })();
    return () => {
      alive = false;
    };
  }, [enabled, ready, open, lane]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;
  return {
    ready,
    side,
    me: me.current,
    orgId: org.current,
    spaces,
    reload: load,
    send: async (space, ln, text) => {
      const { data, error } = await sb().from('messages').insert({ space_id: space, lane: ln, body: text }).select(COLS).single();
      if (error) {
        toast('Message not sent. Check your connection and try again');
        return;
      }
      const r = data as Row;
      update((d) => {
        const list = ((d.lc ||= {})[laneKey(space, ln)] ||= []);
        if (!list.some((m) => m.id === toUiId(r.id))) list.push(toMsg(r, true));
      });
    },
    tick: async (step, done) => {
      const err = await completeStep(step, done);
      if (err) toast(err);
      await load();
    },
    addPerson: async (space, p) => {
      const email = p.email.trim().toLowerCase();
      const { error } = await sb().from('client_people').insert({ space_id: space, email, name: p.name.trim(), role: p.role, invited_by: me.current });
      if (error) return error.code === '23505' ? email + ' is already in this space' : 'Couldn’t add them. Try again';
      const r = await inviteClient(space, email);
      await load();
      return r.message;
    },
    resend: async (space, email) => (await inviteClient(space, email)).message,
    setRole: async (person, role) => {
      const { error } = await sb().from('client_people').update({ role }).eq('id', person);
      await load();
      return error ? 'Couldn’t change the role' : null;
    },
    remove: async (person) => {
      const { error } = await sb().from('client_people').update({ removed_at: new Date().toISOString() }).eq('id', person);
      await load();
      return error ? 'Couldn’t remove them' : null;
    },
  };
}
