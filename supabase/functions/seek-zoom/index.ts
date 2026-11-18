// Seek · Zoom meetings, for each person who connects their Zoom account.
//   POST (signed in), body { action }:
//     'status'                    → { configured, connected, email }
//     'start'                     → { url }  Zoom's consent page; it comes back to Seek → Apps
//     'finish' { code, state }    Seek → Apps passes on what Zoom sent back; saves the connection
//     'disconnect'                → {}
//     'meeting' { space, title, startsAt, minutes, agenda }
//                                 → { link, zoomId }  a scheduled Zoom meeting in your account
//     'attach' { meeting, zoomId } links it to the Seek meeting (so cancelling it in Seek deletes it in Zoom)
//     'cancel' { meeting }        → deletes the Zoom meeting after the Seek meeting was cancelled
//     'instant' { title }         → { link }  a Zoom meeting for right now (huddles and calls)
// Secrets: ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (Zoom App Marketplace → your General app, user-managed OAuth).
// The app's redirect URL must be <SITE_URL>/apps; scopes: meeting:write:meeting, meeting:delete:meeting,
// user:read:user (or the classic meeting:write and user:read).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// deno-lint-ignore no-explicit-any
type Client = any;

const SITE = (Deno.env.get('SITE_URL') || 'https://convertt-seek.vercel.app').replace(/\/+$/, '');
const CLIENT_ID = Deno.env.get('ZOOM_CLIENT_ID') || '';
const CLIENT_SECRET = Deno.env.get('ZOOM_CLIENT_SECRET') || '';
const REDIRECT = SITE + '/apps';
const API = 'https://api.zoom.us/v2';

const b64u = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

// ---- the "state" round trip: who asked to connect, signed so it can't be forged. Starts with "zoom." so Seek's
// Apps page knows whose redirect it is (Google uses the same page).
async function sign(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLIENT_SECRET + ':seek-zoom'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
async function makeState(user: string) {
  const body = b64u(new TextEncoder().encode(JSON.stringify({ u: user, t: Date.now() })));
  return 'zoom.' + body + '.' + (await sign(body));
}
async function readState(state: string): Promise<string | null> {
  const [tag, body, sig] = state.split('.');
  if (tag !== 'zoom' || !body || !sig || (await sign(body)) !== sig) return null;
  try {
    const v = JSON.parse(unb64u(body)) as { u: string; t: number };
    return Date.now() - v.t < 30 * 60_000 ? v.u : null;
  } catch {
    return null;
  }
}

// ---- tokens (Zoom gives a new refresh token every time one is used: always keep the latest)
async function token(params: Record<string, string>) {
  const res = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, string | number> };
}

async function save(admin: Client, user: string, data: Record<string, string | number>, email?: string) {
  const row: Record<string, unknown> = {
    user_id: user,
    refresh_token: String(data.refresh_token),
    access_token: String(data.access_token),
    expires_at: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000).toISOString(),
  };
  if (email !== undefined) {
    row.email = email;
    row.connected_at = new Date().toISOString();
  }
  await admin.from('zoom_accounts').upsert(row);
}

/** A working access token for this person, refreshed when needed; null when they aren't connected. */
async function accessFor(admin: Client, user: string): Promise<string | null> {
  const { data: acc } = await admin.from('zoom_accounts').select('refresh_token, access_token, expires_at').eq('user_id', user).maybeSingle();
  if (!acc) return null;
  if (acc.access_token && acc.expires_at && Date.parse(acc.expires_at) - Date.now() > 60_000) return acc.access_token;
  const r = await token({ grant_type: 'refresh_token', refresh_token: acc.refresh_token });
  if (!r.ok || !r.data.access_token) {
    // the app was removed in Zoom, or the token is no longer valid: forget it so the app asks again
    if (r.data.error === 'invalid_grant' || r.data.error === 'invalid_token') await admin.from('zoom_accounts').delete().eq('user_id', user);
    return null;
  }
  await save(admin, user, r.data);
  return String(r.data.access_token);
}

async function zoom(at: string, path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
}

function zoomError(r: { status: number; data: Record<string, unknown> }) {
  const msg = String(r.data.message ?? '').slice(0, 200);
  if (r.status === 401) return 'Zoom access expired. Reconnect Zoom in Apps';
  if (r.status === 400 && /scope/i.test(msg)) return 'Seek isn’t allowed to create meetings in your Zoom. Reconnect Zoom in Apps';
  return 'Zoom said: ' + (msg || 'error ' + r.status);
}

async function createMeeting(at: string, m: { topic: string; start?: Date; minutes: number; agenda: string; instant?: boolean }) {
  const body: Record<string, unknown> = {
    topic: m.topic.slice(0, 200),
    type: m.instant ? 1 : 2,
    duration: m.minutes,
    agenda: m.agenda.slice(0, 2000),
    settings: { join_before_host: true, jbh_time: 0, waiting_room: false, mute_upon_entry: true },
  };
  if (!m.instant && m.start) {
    body.start_time = m.start.toISOString().replace(/\.\d{3}Z$/, 'Z');
    body.timezone = 'UTC';
  }
  const r = await zoom(at, '/users/me/meetings', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return { error: zoomError(r) };
  const link = String(r.data.join_url ?? '');
  if (!link) return { error: 'Zoom made the meeting but didn’t return a link' };
  return { link, zoomId: String(r.data.id) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { db: { schema: 'seek' }, auth: { persistSession: false, autoRefreshToken: false } });
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(auth);
  const user = who?.user;
  if (!user) return json({ error: 'Please sign in again' }, 401);
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {}
  const configured = !!(CLIENT_ID && CLIENT_SECRET);

  try {
    switch (body.action) {
      case 'status': {
        const { data } = await admin.from('zoom_accounts').select('email').eq('user_id', user.id).maybeSingle();
        return json({ configured, connected: !!data, email: data?.email ?? '' });
      }
      case 'start': {
        if (!configured) return json({ error: 'Zoom isn’t set up for Seek yet. An admin needs to add the Zoom client ID and secret in Supabase' }, 400);
        const p = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, state: await makeState(user.id) });
        return json({ url: 'https://zoom.us/oauth/authorize?' + p.toString() });
      }
      case 'finish': {
        const asked = await readState(String(body.state ?? ''));
        const code = String(body.code ?? '');
        if (!configured) return json({ error: 'Zoom isn’t set up for Seek yet' }, 400);
        if (!asked || asked !== user.id || !code) return json({ error: 'That Zoom sign-in link expired. Try connecting again' }, 400);
        const r = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
        if (!r.ok || !r.data.access_token) return json({ error: 'Zoom didn’t accept the sign-in. Try connecting again' }, 400);
        const me = await zoom(String(r.data.access_token), '/users/me');
        await save(admin, user.id, r.data, me.ok ? String(me.data.email ?? '') : '');
        return json({ email: me.ok ? me.data.email : '' });
      }
      case 'disconnect': {
        const { data } = await admin.from('zoom_accounts').select('access_token').eq('user_id', user.id).maybeSingle();
        if (data?.access_token)
          await fetch('https://zoom.us/oauth/revoke?token=' + encodeURIComponent(data.access_token), { method: 'POST', headers: { Authorization: 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET) } }).catch(() => {});
        await admin.from('zoom_accounts').delete().eq('user_id', user.id);
        return json({});
      }
      case 'meeting': {
        const at = await accessFor(admin, user.id);
        if (!at) return json({ error: 'Connect Zoom first (Apps → Zoom)' }, 400);
        const space = String(body.space ?? '');
        const { data: sp } = await admin.from('client_spaces').select('workspace_id, name').eq('id', space).maybeSingle();
        if (!sp) return json({ error: 'Client space not found' }, 404);
        const { data: mem } = await admin.from('workspace_members').select('role').eq('workspace_id', sp.workspace_id).eq('user_id', user.id).maybeSingle();
        if (!mem || mem.role === 'guest') return json({ error: 'Only the team can schedule meetings' }, 403);
        const start = new Date(String(body.startsAt));
        if (Number.isNaN(start.getTime())) return json({ error: 'Pick a time' }, 400);
        const minutes = Math.min(480, Math.max(10, Number(body.minutes) || 30));
        const agenda = [String(body.agenda ?? ''), `Scheduled in Seek with ${sp.name}.`].filter(Boolean).join('\n\n');
        const r = await createMeeting(at, { topic: String(body.title ?? 'Meeting'), start, minutes, agenda });
        return 'error' in r ? json({ error: r.error }, 502) : json(r);
      }
      case 'attach': {
        const meeting = Number(body.meeting);
        const { data: m } = await admin.from('meetings').select('id, created_by').eq('id', meeting).maybeSingle();
        if (!m || m.created_by !== user.id) return json({ error: 'Meeting not found' }, 404);
        await admin.from('zoom_meetings').upsert({ meeting_id: meeting, zoom_id: String(body.zoomId ?? ''), user_id: user.id });
        return json({});
      }
      case 'cancel': {
        const meeting = Number(body.meeting);
        const { data: zm } = await admin.from('zoom_meetings').select('zoom_id, user_id').eq('meeting_id', meeting).maybeSingle();
        if (!zm) return json({ cancelled: false });
        // only after the meeting was cancelled in Seek (the database checked who may)
        const { data: m } = await admin.from('meetings').select('cancelled_at').eq('id', meeting).maybeSingle();
        if (m && !m.cancelled_at) return json({ error: 'Cancel the meeting in Seek first' }, 400);
        const at = await accessFor(admin, zm.user_id);
        if (at) await zoom(at, '/meetings/' + encodeURIComponent(zm.zoom_id), { method: 'DELETE' });
        await admin.from('zoom_meetings').delete().eq('meeting_id', meeting);
        return json({ cancelled: !!at });
      }
      case 'instant': {
        const at = await accessFor(admin, user.id);
        if (!at) return json({ error: 'not connected' }, 400);
        const r = await createMeeting(at, { topic: String(body.title ?? 'Seek huddle'), minutes: 60, agenda: 'Started from Seek.', instant: true });
        return 'error' in r ? json({ error: r.error }, 502) : json({ link: r.link });
      }
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
