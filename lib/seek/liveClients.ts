'use client';

import { notifyOut } from './push';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { backendOn, currentAccount, DB_SCHEMA, inviteClient, completeStep, sb, type ClientRole } from './backend';
import type { ChatMessage, FileRef, MessageCard } from './data';
import { agentWho, keyFor, learnProfiles, timeLabel, toUiId } from './live';
import { debounced, dropEcho, hydrateReactions, keepLocal, messageSinks, SEND_TIMEOUT_MS, settle, showSending } from './liveSync';
import { mentionIds } from './liveNotes';
import { askAwayAssistant, checkScope, setSenderSide } from './liveScope';
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
  /** team view only: the agreed scope (Scope guard checks client requests against it) */
  scope?: string;
  /** team view only: retainer hours per calendar month (null: no retainer) */
  retainerHours?: number | null;
};

// user_id is null (and agent set) for a message written by an agent, e.g. Scope guard in Team notes
type Row = { id: number; space_id: string | null; lane: Lane | null; user_id: string | null; agent?: string | null; parent_id: number | null; body: string; created_at: string; files?: FileRef[]; card?: MessageCard | null; pinned_at?: string | null; edited_at?: string | null };
const COLS = 'id, space_id, lane, user_id, agent, parent_id, body, created_at, files, card, pinned_at, edited_at';
const people = (ids: (string | null)[]) => ids.filter((v): v is string => !!v);

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

// The client spaces last loaded, per person and organisation, in memory and on this device, so the Clients screen
// shows them at once on every visit (and after a reload) while a fresh list loads in the background.
const SPACES = 'seek:spaces';
const spaceMemo = new Map<string, Space[]>();
function cachedSpaces(key: string): Space[] | null {
  const hit = spaceMemo.get(key);
  if (hit) return hit;
  try {
    const v = JSON.parse(localStorage.getItem(SPACES) || 'null') as { key: string; list: Space[] } | null;
    if (v && v.key === key && Array.isArray(v.list)) {
      spaceMemo.set(key, v.list);
      return v.list;
    }
  } catch {}
  return null;
}
function keepSpaces(key: string, list: Space[]) {
  spaceMemo.set(key, list);
  try {
    localStorage.setItem(SPACES, JSON.stringify({ key, list }));
  } catch {}
}
/** The client spaces this device last loaded for you in this workspace (for search jumps); [] when none. */
export function spacesOnDevice(meId: string | null | undefined, orgId: string | null | undefined): Space[] {
  if (!meId || !orgId) return [];
  return cachedSpaces(meId + ':' + orgId) ?? [];
}
const clientIdsOf = (list: Space[]) => new Set(list.flatMap((x) => x.people.map((p) => p.userId).filter((v): v is string => !!v)));

export function useLiveClients(): LiveClients | null {
  const { s, update, toast } = useSeek();
  const enabled = backendOn && (s.session === 'in' || s.session === 'client');
  const side: 'team' | 'client' = s.session === 'client' ? 'client' : 'team';
  // who you are and which organisation is open, from the account saved on this device (no waiting)
  const cacheKey = (s.meId ?? '') + ':' + (side === 'team' ? (s.orgId ?? '') : 'client');
  const [spaces, setSpaces] = useState<Space[]>(() => (enabled && s.meId ? (cachedSpaces(cacheKey) ?? []) : []));
  const [ready, setReady] = useState(() => enabled && !!s.meId && cachedSpaces(cacheKey) != null);
  const me = useRef<string | null>(s.meId ?? null);
  const org = useRef<string | null>(side === 'team' ? (s.orgId ?? null) : null);
  const open = s.cs;
  const lane: Lane = side === 'client' || s.cTab !== 'Team notes' ? 'client' : 'team';

  // people on the client side, so their messages are marked "client" in the team's view
  const clientIds = useRef(clientIdsOf(spaces));
  const toMsg = (r: Row, flash = false): ChatMessage => ({
    kind: 'msg',
    id: toUiId(r.id),
    who: r.agent || !r.user_id ? agentWho(r.agent) : keyFor(r.user_id, me.current),
    ai: !!r.agent || undefined,
    time: timeLabel(r.created_at),
    at: r.created_at,
    text: r.body,
    files: r.files?.length ? r.files : undefined,
    card: r.card ?? undefined,
    pinned: !!r.pinned_at,
    edited: !!r.edited_at,
    flash,
    client: side === 'team' && !!r.user_id && clientIds.current.has(r.user_id),
  });
  setSenderSide(side);

  const load = useCallback(async () => {
    // who you are and the open organisation are known from this device; the account is only loaded when they aren't
    if (!me.current) {
      const acc = await currentAccount();
      if (!acc) return;
      me.current = acc.id;
      org.current = acc.workspace?.id ?? null;
    }
    const ws = side === 'team' ? org.current : null;
    const key = me.current + ':' + (side === 'team' ? (ws ?? '') : 'client');
    const cols = 'id, name, project, code, color, status, reply_target, tone, never_mention, created_at, client_people ( id, email, name, role, user_id, joined_at, invited_at, removed_at ), client_team ( user_id, is_lead ), client_steps ( id, kind, title, detail, side, position, done_at )';
    const query = (select: string) => {
      let q = sb().from('client_spaces').select(select).neq('status', 'closed').order('created_at', { ascending: false });
      if (side === 'team' && ws) q = q.eq('workspace_id', ws);
      return q;
    };
    // the team also gets the agreed scope and retainer (Scope & hours); without them if the database is older
    let { data, error } = await query(side === 'team' ? cols + ', scope, retainer_hours' : cols);
    if (error && side === 'team') ({ data, error } = await query(cols));
    if (error) {
      toast('Couldn’t load clients. Check your connection');
      return;
    }
    type R = {
      id: string; name: string; project: string; code: string; color: string; status: Space['status']; reply_target: string; tone: string; never_mention: string[]; created_at: string;
      scope?: string | null; retainer_hours?: number | string | null;
      client_people: { id: string; email: string; name: string; role: ClientRole; user_id: string | null; joined_at: string | null; invited_at: string; removed_at: string | null }[];
      client_team: { user_id: string; is_lead: boolean }[];
      client_steps: { id: string; kind: string; title: string; detail: string; side: 'client' | 'team'; position: number; done_at: string | null }[];
    };
    const list: Space[] = ((data ?? []) as unknown as R[]).map((r) => ({
      ...(side === 'team' ? { scope: r.scope ?? '', retainerHours: r.retainer_hours == null ? null : Number(r.retainer_hours) } : {}),
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
    clientIds.current = clientIdsOf(list);
    keepSpaces(key, list);
    setSpaces(list);
    update((d) => {
      if (!list.some((x) => x.id === d.cs)) d.cs = list[0]?.id ?? '';
      // messages loaded before the list: mark the ones from the client side (team view)
      if (side === 'team')
        for (const x of list)
          for (const m of d.lc?.[laneKey(x.id, 'client')] ?? []) if (m.kind === 'msg' && !m.ai) m.client = clientIds.current.has(m.who);
    });
    setReady(true);
    // names and faces for everyone in these spaces fill in when they arrive (most are remembered on this device)
    const ids = list.flatMap((x) => [...x.people.map((p) => p.userId).filter((v): v is string => !!v), ...x.team.map((t) => t.userId)]);
    void learnProfiles(ids, me.current).then(() => update(() => {}));
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- start, and listen for changes (new messages, ticked steps, people joining)
  useEffect(() => {
    if (!enabled) return;
    let live: RealtimeChannel | null = null;
    let alive = true;
    // a burst of changes (several steps ticked, people added) reloads the spaces once
    const reloadSoon = debounced(() => void load(), 500);
    const sink = async (row: Record<string, unknown>) => {
      const r = row as unknown as Row;
      if (!r.space_id || !r.lane || r.parent_id != null) return;
      await learnProfiles(people([r.user_id]), me.current);
      update((d) => {
        const k = laneKey(r.space_id!, r.lane!);
        const list = ((d.lc ||= {})[k] ||= []);
        if (list.some((m) => m.id === toUiId(r.id))) return;
        // your own message: its "Sending…" (or "Not sent") copy goes
        if (r.user_id === me.current) dropEcho(list, r.body);
        list.push(toMsg(r, r.user_id === me.current));
      });
    };
    const spaceSink = (r: Record<string, unknown>) => void sink(r);
    (async () => {
      await load();
      if (!alive) return;
      const filter = side === 'team' && org.current ? `workspace_id=eq.${org.current}` : undefined;
      // the team already gets every new message in the workspace (team chat's subscription, lib/seek/live.ts), which
      // hands client space ones over here; a client (guest) has no team chat, so listens itself
      const viaTeamChat = side === 'team';
      if (viaTeamChat) messageSinks.space = spaceSink;
      let ch = sb().channel('seek-clients:' + (org.current ?? me.current));
      if (!viaTeamChat) ch = ch.on('postgres_changes', { event: 'INSERT', schema: DB_SCHEMA, table: 'messages', ...(filter ? { filter } : {}) }, (p) => void sink(p.new as Record<string, unknown>));
      live = ch
        // a meeting card changes when the meeting is cancelled
        .on('postgres_changes', { event: 'UPDATE', schema: DB_SCHEMA, table: 'messages', ...(filter ? { filter } : {}) }, (p) => {
          const r = p.new as Row;
          if (!r.space_id || !r.lane || !r.card) return;
          update((d) => {
            const m = (d.lc?.[laneKey(r.space_id!, r.lane!)] ?? []).find((x) => x.kind === 'msg' && x.id === toUiId(r.id));
            if (m && m.kind === 'msg') m.card = r.card ?? undefined;
          });
        })
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'client_steps' }, reloadSoon)
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'client_people' }, reloadSoon)
        // (steps and people have only a space id, so those two stay unfiltered)
        .on('postgres_changes', { event: '*', schema: DB_SCHEMA, table: 'client_spaces', ...(filter ? { filter } : {}) }, reloadSoon)
        .subscribe();
    })();
    return () => {
      alive = false;
      reloadSoon.cancel();
      if (messageSinks.space === spaceSink) messageSinks.space = null;
      if (live) sb().removeChannel(live);
    };
  }, [enabled, side]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the open conversation's messages (latest 300, oldest first). The space you had open is remembered, so its
  // messages load alongside the list of spaces, not after it.
  const known = !!me.current;
  useEffect(() => {
    if (!enabled || !open || (!known && !ready)) return;
    let alive = true;
    (async () => {
      const { data, error } = await sb().from('messages').select(COLS).eq('space_id', open).eq('lane', lane).is('parent_id', null).order('created_at', { ascending: false }).limit(300);
      if (!alive) return;
      if (error) {
        toast('Couldn’t load messages. Check your connection');
        return;
      }
      const rows = ((data ?? []) as Row[]).reverse();
      const msgs = rows.map((r) => toMsg(r));
      update((d) => {
        const lc = (d.lc ||= {});
        // your messages still sending (or not sent) stay
        lc[laneKey(open, lane)] = keepLocal(lc[laneKey(open, lane)], msgs);
      });
      // names and reactions fill in after the messages are on screen
      await Promise.all([learnProfiles(people(rows.map((r) => r.user_id)), me.current), hydrateReactions(update, msgs.map((m) => m.id), me.current)]);
      if (alive) update(() => {});
    })();
    return () => {
      alive = false;
    };
  }, [enabled, known || ready, open, lane]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;
  return {
    ready,
    side,
    me: me.current,
    orgId: org.current,
    spaces,
    reload: load,
    send: async function send(space: string, ln: Lane, text: string): Promise<void> {
      const sp = spaces.find((x) => x.id === space);
      const who = sp ? [...sp.team.map((t) => t.userId), ...(ln === 'client' ? sp.people.map((p) => p.userId).filter((v): v is string => !!v) : [])].filter((u) => u !== me.current) : [];
      // it shows at once, marked "Sending…"; a send that hangs gives up after 20 seconds and shows as "Not sent"
      const local = showSending(update, (d) => ((d.lc ||= {})[laneKey(space, ln)] ||= []), text);
      let data: unknown = null;
      let error: unknown = null;
      try {
        ({ data, error } = await sb()
          .from('messages')
          .insert({ space_id: space, lane: ln, body: text, mentions: mentionIds(text, who) })
          .select(COLS)
          .abortSignal(AbortSignal.timeout(SEND_TIMEOUT_MS))
          .single());
      } catch (e) {
        error = e;
      }
      if (error || !data) {
        settle(update, local, () => send(space, ln, text));
        return;
      }
      notifyOut();
      const r = data as Row;
      // a client's request in Client chat: Scope guard checks it against the agreed scope (notes go to Team notes only),
      // and the Away assistant may answer if it's on for this space and nobody on the team is available (both in the
      // background; neither slows the send)
      if (side === 'client' && ln === 'client') {
        checkScope(r.id);
        askAwayAssistant(r.id);
      }
      update((d) => {
        const list = ((d.lc ||= {})[laneKey(space, ln)] ||= []);
        if (!list.some((m) => m.id === toUiId(r.id))) {
          dropEcho(list, r.body);
          list.push(toMsg(r, true));
        }
      });
      settle(update, local);
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
