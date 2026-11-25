// Seek · Google Calendar and Google Meet, for each person who connects their Google account.
//   POST (signed in), body { action }:
//     'status'                    → { configured, connected, email }
//     'start'                     → { url }  Google's consent page; it comes back to Seek → Apps
//     'finish' { code, state }    Seek → Apps passes on what Google sent back; saves the connection
//     'disconnect'                → {}
//     'event' { space, title, startsAt, minutes, agenda, attendees: user ids }
//                                 → { link, eventId }  a Calendar event with a Meet link; invitations are emailed
//     'attach' { meeting, eventId } links that event to the Seek meeting (so cancelling cancels it)
//     'cancel' { meeting }        → cancels the Calendar event (and tells the guests)
//     'instant' { title }         → { link }  a Meet link for right now (huddles and calls)
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (from Google Cloud → Credentials → OAuth client, type "Web").
// The OAuth client's redirect URI must be <SITE_URL>/apps (Seek's Apps page finishes the connection while you're
// signed in, so this function keeps Supabase's normal sign-in check).
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
// trimmed: a pasted key often carries a space or line break
const CLIENT_ID = (Deno.env.get('GOOGLE_CLIENT_ID') || '').trim();
const CLIENT_SECRET = (Deno.env.get('GOOGLE_CLIENT_SECRET') || '').trim();
const REDIRECT = SITE + '/apps';
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

const b64u = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

// ---- the "state" round trip: who asked to connect, signed so it can't be forged
async function sign(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLIENT_SECRET + ':seek-google'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
async function makeState(user: string) {
  const body = b64u(new TextEncoder().encode(JSON.stringify({ u: user, t: Date.now() })));
  return body + '.' + (await sign(body));
}
async function readState(state: string): Promise<string | null> {
  const [body, sig] = state.split('.');
  if (!body || !sig || (await sign(body)) !== sig) return null;
  try {
    const v = JSON.parse(unb64u(body)) as { u: string; t: number };
    return Date.now() - v.t < 30 * 60_000 ? v.u : null;
  } catch {
    return null;
  }
}

// ---- tokens
/** Why Google refused a token request, in a form that is safe to show (error code and description only). */
function why(data: Record<string, string | number>) {
  const code = String(data.error ?? '').slice(0, 60);
  const desc = String(data.error_description ?? data.reason ?? '').slice(0, 160);
  if (code === 'invalid_client') return ' (Google says the client ID or secret is wrong: check both in Supabase → Edge Functions → Secrets, with no spaces)';
  if (code === 'redirect_uri_mismatch') return ' (Google says the redirect URL doesn’t match: it must be exactly ' + REDIRECT + ')';
  return code ? ` (Google: ${code}${desc ? ' – ' + desc : ''})` : '';
}

async function token(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, string | number> };
}

/** A working access token for this person, refreshed when needed; null when they aren't connected. */
async function accessFor(admin: Client, user: string): Promise<string | null> {
  const { data: acc } = await admin.from('google_accounts').select('refresh_token, access_token, expires_at').eq('user_id', user).maybeSingle();
  if (!acc) return null;
  if (acc.access_token && acc.expires_at && Date.parse(acc.expires_at) - Date.now() > 60_000) return acc.access_token;
  const r = await token({ grant_type: 'refresh_token', refresh_token: acc.refresh_token });
  if (!r.ok) {
    // access was removed in their Google account: forget the connection so the app asks again
    if (r.data.error === 'invalid_grant') await admin.from('google_accounts').delete().eq('user_id', user);
    return null;
  }
  const at = String(r.data.access_token);
  await admin
    .from('google_accounts')
    .update({ access_token: at, expires_at: new Date(Date.now() + Number(r.data.expires_in ?? 3600) * 1000).toISOString() })
    .eq('user_id', user);
  return at;
}

async function cal(at: string, path: string, init: RequestInit = {}) {
  const res = await fetch(CAL + path, { ...init, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
}

type GEvent = { id?: string; hangoutLink?: string; conferenceData?: { createRequest?: { status?: { statusCode?: string } }; entryPoints?: { entryPointType: string; uri: string }[] } };
const meetOf = (e: GEvent) => e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || '';

/** Creates a Calendar event with a Google Meet link (waits briefly if Google is still making the link). */
async function createEvent(at: string, ev: Record<string, unknown>, invite: boolean) {
  const body = { ...ev, conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } };
  const r = await cal(at, `?conferenceDataVersion=1&sendUpdates=${invite ? 'all' : 'none'}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return { error: googleError(r) };
  let e = r.data as GEvent;
  for (let i = 0; i < 4 && !meetOf(e) && e.id; i++) {
    await new Promise((res) => setTimeout(res, 800));
    const g = await cal(at, '/' + encodeURIComponent(e.id));
    if (g.ok) e = g.data as GEvent;
  }
  const link = meetOf(e);
  if (!link) return { error: 'Google made the event but not a Meet link. Check that Google Meet is on for your account' };
  return { link, eventId: e.id! };
}

function googleError(r: { status: number; data: Record<string, unknown> }) {
  const msg = ((r.data.error as { message?: string } | undefined)?.message ?? '').slice(0, 200);
  if (r.status === 401) return 'Google access expired. Reconnect Google in Apps';
  if (r.status === 403 && /insufficient|scope/i.test(msg)) return 'Seek isn’t allowed to use your calendar. Reconnect Google in Apps and tick the calendar box';
  if (r.status === 403 && /disabled|not been used/i.test(msg)) return 'The Google Calendar API isn’t turned on in the Google Cloud project';
  return 'Google said: ' + (msg || 'error ' + r.status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { db: { schema: 'seek' }, auth: { persistSession: false, autoRefreshToken: false } });

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
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
        const { data } = await admin.from('google_accounts').select('email').eq('user_id', user.id).maybeSingle();
        return json({ configured, connected: !!data, email: data?.email ?? '' });
      }
      case 'start': {
        if (!configured) return json({ error: 'Google isn’t set up for Seek yet. An admin needs to add the Google client ID and secret in Supabase' }, 400);
        const p = new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'offline',
          // always ask which Google account: a shared computer is often signed in to someone else's
          prompt: 'select_account consent',
          include_granted_scopes: 'true',
          state: await makeState(user.id),
          login_hint: user.email ?? '',
        });
        return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString() });
      }
      case 'finish': {
        // what Google sent back to Seek → Apps; the state must have been made for this same person
        const asked = await readState(String(body.state ?? ''));
        const code = String(body.code ?? '');
        if (!configured) return json({ error: 'Google isn’t set up for Seek yet' }, 400);
        if (!asked || asked !== user.id || !code) return json({ error: 'That Google sign-in link expired. Try connecting again' }, 400);
        const r = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
        if (!r.ok) {
          console.error('google token exchange failed', r.data.error, r.data.error_description);
          return json({ error: 'Google didn’t accept the sign-in' + why(r.data) + '. Try connecting again' }, 400);
        }
        // Google's granular consent lets people leave the calendar box unticked: then Seek can't make events
        const scope = String(r.data.scope ?? '');
        if (!scope.split(/\s+/).includes('https://www.googleapis.com/auth/calendar.events') && !/auth\/calendar(\s|$)/.test(scope))
          return json({ error: 'Google connected without calendar access. Click Connect again and tick the box that lets Seek manage your calendar events.' }, 400);
        let email = '';
        try {
          email = JSON.parse(unb64u(String(r.data.id_token).split('.')[1])).email ?? '';
        } catch {}
        const { data: old } = await admin.from('google_accounts').select('refresh_token').eq('user_id', user.id).maybeSingle();
        const refresh = String(r.data.refresh_token ?? old?.refresh_token ?? '');
        if (!refresh) return json({ error: 'Google didn’t give Seek lasting access. Remove Seek in your Google account’s third-party access, then connect again' }, 400);
        const { error: saveError } = await admin.from('google_accounts').upsert({
          user_id: user.id,
          email,
          refresh_token: refresh,
          access_token: String(r.data.access_token),
          expires_at: new Date(Date.now() + Number(r.data.expires_in ?? 3600) * 1000).toISOString(),
          connected_at: new Date().toISOString(),
        });
        if (saveError) {
          console.error('google_accounts upsert failed', saveError.code, saveError.message);
          return json({ error: 'Google signed you in, but Seek couldn’t save the connection. Try connecting again in a minute' }, 500);
        }
        return json({ email });
      }
      case 'disconnect': {
        const { data } = await admin.from('google_accounts').select('refresh_token').eq('user_id', user.id).maybeSingle();
        if (data?.refresh_token) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(data.refresh_token), { method: 'POST' }).catch(() => {});
        await admin.from('google_accounts').delete().eq('user_id', user.id);
        return json({});
      }
      case 'event': {
        const at = await accessFor(admin, user.id);
        if (!at) return json({ error: 'Connect Google first (Apps → Google Calendar & Meet)' }, 400);
        const space = String(body.space ?? '');
        const { data: sp } = await admin.from('client_spaces').select('workspace_id, name').eq('id', space).maybeSingle();
        if (!sp) return json({ error: 'Client space not found' }, 404);
        const { data: mem } = await admin.from('workspace_members').select('role').eq('workspace_id', sp.workspace_id).eq('user_id', user.id).maybeSingle();
        if (!mem || mem.role === 'guest') return json({ error: 'Only the team can schedule meetings' }, 403);
        // guests: the chosen teammates and client people (by their Seek account), never anyone else
        const asked = (Array.isArray(body.attendees) ? body.attendees : []).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 50);
        const [{ data: tm }, { data: cp }] = await Promise.all([
          admin.from('workspace_members').select('user_id').eq('workspace_id', sp.workspace_id).in('user_id', asked.length ? asked : ['00000000-0000-0000-0000-000000000000']),
          admin.from('client_people').select('user_id').eq('space_id', space).is('removed_at', null).in('user_id', asked.length ? asked : ['00000000-0000-0000-0000-000000000000']),
        ]);
        const ids = [...new Set([...((tm ?? []) as { user_id: string }[]), ...((cp ?? []) as { user_id: string }[])].map((x) => x.user_id))];
        const { data: ps } = ids.length ? await admin.from('profiles').select('email').in('id', ids) : { data: [] };
        const emails = [...new Set(((ps ?? []) as { email: string }[]).map((p) => p.email).filter(Boolean))].filter((e) => e !== user.email);
        const start = new Date(String(body.startsAt));
        const minutes = Math.min(480, Math.max(10, Number(body.minutes) || 30));
        if (Number.isNaN(start.getTime())) return json({ error: 'Pick a time' }, 400);
        const r = await createEvent(
          at,
          {
            summary: String(body.title ?? 'Meeting').slice(0, 120),
            description: [String(body.agenda ?? '').slice(0, 2000), `Scheduled in Seek with ${sp.name}.`].filter(Boolean).join('\n\n'),
            start: { dateTime: start.toISOString() },
            end: { dateTime: new Date(start.getTime() + minutes * 60_000).toISOString() },
            attendees: emails.map((email) => ({ email })),
            guestsCanSeeOtherGuests: true,
          },
          true,
        );
        return 'error' in r ? json({ error: r.error }, 502) : json(r);
      }
      case 'attach': {
        const meeting = Number(body.meeting);
        const { data: m } = await admin.from('meetings').select('id, created_by').eq('id', meeting).maybeSingle();
        if (!m || m.created_by !== user.id) return json({ error: 'Meeting not found' }, 404);
        await admin.from('google_events').upsert({ meeting_id: meeting, event_id: String(body.eventId ?? ''), user_id: user.id });
        return json({});
      }
      case 'cancel': {
        const meeting = Number(body.meeting);
        const { data: ge } = await admin.from('google_events').select('event_id, user_id').eq('meeting_id', meeting).maybeSingle();
        if (!ge) return json({ cancelled: false });
        // the meeting was cancelled in Seek (the database checked who may); remove the organiser's event
        const { data: m } = await admin.from('meetings').select('cancelled_at').eq('id', meeting).maybeSingle();
        if (m && !m.cancelled_at) return json({ error: 'Cancel the meeting in Seek first' }, 400);
        const at = await accessFor(admin, ge.user_id);
        if (at) await cal(at, '/' + encodeURIComponent(ge.event_id) + '?sendUpdates=all', { method: 'DELETE' });
        await admin.from('google_events').delete().eq('meeting_id', meeting);
        return json({ cancelled: !!at });
      }
      case 'instant': {
        const at = await accessFor(admin, user.id);
        if (!at) return json({ error: 'not connected' }, 400);
        const now = new Date();
        const r = await createEvent(
          at,
          {
            summary: String(body.title ?? 'Seek huddle').slice(0, 120),
            description: 'Started from Seek.',
            start: { dateTime: now.toISOString() },
            end: { dateTime: new Date(now.getTime() + 60 * 60_000).toISOString() },
            transparency: 'transparent',
          },
          false,
        );
        return 'error' in r ? json({ error: r.error }, 502) : json({ link: r.link });
      }
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
