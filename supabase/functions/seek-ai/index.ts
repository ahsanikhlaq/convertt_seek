// Seek · AI agents (testing on Google's free Gemini API).
// Called from the app by a signed-in person:
//   { action: 'summarise', conv: 'ch:<id>' | 'dm:<id>' | 'sp:<id>:<lane>' }  → a catch-up of the latest messages
//   { action: 'tasks', message_id: <id> }                                       → tasks suggested from one message
// Everything is read AS THE CALLER (row-level security), so the AI only ever sees what that person can see, and
// the answer goes back only to them (nothing is posted). Each run checks that the agent is on and AI isn't paused
// for the workspace, and is written to the agent log with its sources.
// Secrets (Supabase → Edge Functions → Secrets): GEMINI_API_KEY (required), GEMINI_MODEL (optional).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Google's "latest Flash-Lite" alias answers in a few seconds on the free tier (and keeps working as models are
// renamed); set GEMINI_MODEL to pin another
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-lite-latest';
const DEFAULT_ON: Record<string, boolean> = { summariser: true, task_suggester: true };

// when the main model is busy (503), over its free limit (429) or slow, Flash answers instead (each model has its own
// free quota)
const FALLBACK = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-flash-latest';
let used = MODEL; // which model answered (returned to the app, for the footnote)

async function call(model: string, key: string, body: Record<string, unknown>, thinking: boolean): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const gen = body.generationConfig as Record<string, unknown>;
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      // quick answers: the least "thinking" the model allows (older models don't know this setting; see below)
      body: JSON.stringify({ ...body, generationConfig: thinking ? { ...gen, thinkingConfig: { thinkingLevel: 'minimal' } } : gen }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function gemini(system: string, prompt: string, asJson = false): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('AI isn’t connected yet. An admin needs to add the Gemini API key in Supabase.');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1500, ...(asJson ? { responseMimeType: 'application/json' } : {}) },
  };
  let last = 0;
  let why = '';
  for (const model of [...new Set([MODEL, FALLBACK])]) {
    let res: Response;
    try {
      res = await call(model, key, body, true);
      // a model that doesn't accept the thinking setting: ask again without it
      if (res.status === 400) res = await call(model, key, body, false);
    } catch {
      last = 504; // too slow: try the next model
      continue;
    }
    if (res.ok) {
      const out = await res.json();
      const text = (out?.candidates?.[0]?.content?.parts ?? [])
        .filter((p: { thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text ?? '')
        .join('')
        .trim();
      if (text) {
        used = model;
        return text;
      }
      last = 204;
      continue;
    }
    last = res.status;
    why = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status !== 429 && res.status < 500) break; // a real error (bad key, bad request): don't retry
  }
  if (last === 429) throw new Error('The free AI limit is used up for now. Try again in a minute (or tomorrow if the daily limit is reached).');
  if (last === 401 || last === 403 || /API key|API_KEY/i.test(why)) throw new Error('The Gemini API key was refused. Check the GEMINI_API_KEY secret in Supabase.');
  if (last === 504 || last === 503) throw new Error('The AI is busy right now. Try again in a minute.');
  if (last === 204) throw new Error('The AI returned nothing. Try again.');
  throw new Error('The AI service didn’t answer (' + last + '). Try again shortly.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const opts = { db: { schema: 'seek' }, auth: { persistSession: false, autoRefreshToken: false } };
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(url, service, opts);
  const { data: who } = await admin.auth.getUser(token);
  const user = who?.user;
  if (!user) return json({ error: 'Please sign in again' }, 401);
  // every read below is as the caller: they only get what they can already see
  const db = createClient(url, anon, { ...opts, global: { headers: { Authorization: 'Bearer ' + token } } });

  let body: { action?: string; conv?: string; message_id?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  // a little guard against runaway use of the free quota: 12 runs a minute per person
  const { count } = await admin.from('agent_log').select('id', { count: 'exact', head: true }).eq('actor_id', user.id).gte('at', new Date(Date.now() - 60_000).toISOString()).in('agent', ['summariser', 'task_suggester']);
  if ((count ?? 0) >= 12) return json({ error: 'That’s a lot of AI requests in a minute. Try again shortly.' }, 429);

  type Msg = { id: number; user_id: string; body: string; created_at: string; workspace_id: string; parent_id: number | null };
  const cols = 'id, user_id, body, created_at, workspace_id, parent_id';
  let agent: 'summariser' | 'task_suggester';
  let msgs: Msg[] = [];
  let where = '';
  let conv = '';

  if (body.action === 'summarise') {
    agent = 'summariser';
    conv = String(body.conv ?? '');
    const [kind, id, lane] = conv.split(':');
    let q = db.from('messages').select(cols).order('created_at', { ascending: false }).limit(80);
    if (kind === 'ch') {
      q = q.eq('channel_id', id);
      const { data: c } = await db.from('channels').select('name').eq('id', id).maybeSingle();
      if (!c) return json({ error: 'Channel not found' }, 404);
      where = '#' + c.name;
    } else if (kind === 'dm') {
      q = q.eq('dm_id', id);
      where = 'this conversation';
    } else if (kind === 'sp' && (lane === 'client' || lane === 'team')) {
      q = q.eq('space_id', id).eq('lane', lane);
      const { data: s } = await db.from('client_spaces').select('name').eq('id', id).maybeSingle();
      if (!s) return json({ error: 'Space not found' }, 404);
      where = s.name + (lane === 'team' ? ' · Team notes' : ' · Client chat');
    } else return json({ error: 'Bad request' }, 400);
    const { data } = await q;
    msgs = ((data ?? []) as Msg[]).reverse();
    if (!msgs.length) return json({ error: 'Nothing to summarise yet' }, 400);
  } else if (body.action === 'tasks') {
    agent = 'task_suggester';
    const { data } = await db.from('messages').select(cols + ', channel_id, dm_id, space_id, lane').eq('id', Number(body.message_id)).maybeSingle();
    if (!data) return json({ error: 'Message not found' }, 404);
    msgs = [data as Msg];
    const d = data as Msg & { channel_id: string | null; dm_id: string | null; space_id: string | null; lane: string | null };
    conv = d.channel_id ? 'ch:' + d.channel_id : d.dm_id ? 'dm:' + d.dm_id : 'sp:' + d.space_id + ':' + d.lane;
  } else return json({ error: 'Unknown action' }, 400);

  const ws = msgs[0].workspace_id;
  // the agent must be on, and AI not paused, for this workspace
  const [{ data: w }, { data: setting }] = await Promise.all([
    admin.from('workspaces').select('ai_paused').eq('id', ws).single(),
    admin.from('agent_settings').select('enabled').eq('workspace_id', ws).eq('agent', agent).maybeSingle(),
  ]);
  if (w?.ai_paused) return json({ error: 'AI is paused for this workspace' }, 403);
  if (!(setting ? setting.enabled : DEFAULT_ON[agent])) return json({ error: 'This agent is switched off in Apps → AI agents' }, 403);

  // names for the transcript
  const ids = [...new Set(msgs.map((m) => m.user_id))];
  const { data: people } = await db.from('profiles').select('id, name, email').in('id', ids);
  const nameOf = new Map(((people ?? []) as { id: string; name: string; email: string }[]).map((p) => [p.id, (p.name || '').trim() || p.email.split('@')[0]]));
  const lines = msgs.map((m) => `[${m.id}] ${new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ')} ${nameOf.get(m.user_id) ?? 'Someone'}${m.parent_id ? ' (thread reply)' : ''}: ${m.body.replace(/\s+/g, ' ').slice(0, 1500)}`);

  try {
    if (agent === 'summariser') {
      const text = await gemini(
        'You are Seek’s Summariser for an agency team chat. Write a short, neutral catch-up of the conversation for someone who missed it. ' +
          'Use 3 to 7 bullet points starting with "- ", most important first: decisions made, open questions, who is doing what, deadlines. ' +
          'Name people. Do not invent anything that is not in the messages. No preamble, no closing line. Keep it under 120 words.',
        `Conversation: ${where}\nMessages (oldest first):\n${lines.join('\n')}`,
      );
      await admin.from('agent_log').insert({ workspace_id: ws, agent, action: `Summarised ${where} for ${nameOf.get(user.id) ?? 'a teammate'}`, conv, sources: msgs.map((m) => m.id).slice(-80), actor_id: user.id });
      return json({ text, sources: msgs.length, model: used });
    }
    const raw = await gemini(
      'You are Seek’s Task suggester. From the message, list concrete tasks someone should do. Return JSON only: ' +
        '{"tasks":[{"title":"short imperative, max 80 chars","due":"YYYY-MM-DD or null"}]}. ' +
        'Only include tasks clearly implied by the message; return {"tasks":[]} if there are none. At most 5. Today is ' + new Date().toISOString().slice(0, 10) + '.',
      lines.join('\n'),
      true,
    );
    let tasks: { title: string; due: string | null }[] = [];
    try {
      const parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim());
      tasks = (Array.isArray(parsed?.tasks) ? parsed.tasks : [])
        .map((t: { title?: unknown; due?: unknown }) => ({ title: String(t.title ?? '').trim().slice(0, 120), due: /^\d{4}-\d{2}-\d{2}$/.test(String(t.due)) ? String(t.due) : null }))
        .filter((t: { title: string }) => t.title)
        .slice(0, 5);
    } catch {
      return json({ error: 'The AI answer couldn’t be read. Try again.' }, 502);
    }
    await admin.from('agent_log').insert({ workspace_id: ws, agent, action: `Suggested ${tasks.length} task${tasks.length === 1 ? '' : 's'} for ${nameOf.get(user.id) ?? 'a teammate'}`, conv, sources: [msgs[0].id], actor_id: user.id });
    return json({ tasks, model: used });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 502);
  }
});
