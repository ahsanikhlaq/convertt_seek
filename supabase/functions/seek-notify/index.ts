// Seek · notifications that reach people who aren't in Seek right now.
//   · Phone and desktop push (Web Push): as soon as a notification is created for someone who hasn't had Seek open
//     in the last 2 minutes.
//   · Email (through Brevo), for people who chose "As they happen": straight away if they've been away 10+ minutes,
//     otherwise once it has been unread for 10 minutes. Several unread notifications go out as one email, at most
//     one email per person every 10 minutes. "Once a day" sends one summary after 9:00 in their time zone.
//   · Paused notifications and notification schedules are respected; nothing is sent for what's already read.
// The app calls this after it sends a message ({ action: 'flush' }) and every few minutes while open, so pending
// emails go out even when nobody is sending. Other actions: 'vapid' (the public push key), 'test' (a push to
// your own devices).
// Secrets: BREVO_API_KEY (for email; push works without it), NOTIFY_FROM (sender email, optional), SITE_URL
// (optional). Push keys are created on first use and kept in seek.server_keys (server only).
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
const FROM = Deno.env.get('NOTIFY_FROM') || '';
const PUSH_AWAY_MS = 2 * 60_000;
const EMAIL_AWAY_MS = 10 * 60_000;
const EMAIL_GAP_MS = 10 * 60_000;

// ---------------------------------------------------------------- base64url
const b64u = {
  enc(buf: ArrayBuffer | Uint8Array) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(s: string) {
    const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(t, (c) => c.charCodeAt(0));
  },
};
const enc = new TextEncoder();
const concat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of xs) {
    out.set(x, i);
    i += x.length;
  }
  return out;
};

// ---------------------------------------------------------------- Web Push (RFC 8291 aes128gcm, RFC 8292 VAPID)
type Vapid = { publicKey: string; privateKey: string }; // base64url: uncompressed point (65 bytes), and d

/** The server's push keys: made once, then kept in seek.server_keys. */
async function vapid(admin: Client): Promise<Vapid> {
  const { data } = await admin.from('server_keys').select('value').eq('name', 'vapid').maybeSingle();
  if (data?.value) return data.value as Vapid;
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const v: Vapid = { publicKey: b64u.enc(pub), privateKey: jwk.d! };
  await admin.from('server_keys').insert({ name: 'vapid', value: v });
  // two first calls at once: use whichever was saved first
  const { data: again } = await admin.from('server_keys').select('value').eq('name', 'vapid').single();
  return again.value as Vapid;
}

async function vapidAuth(endpoint: string, v: Vapid) {
  const pub = b64u.dec(v.publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: v.privateKey, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${v.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const k = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, k, bytes * 8));
}

/** Encrypts a payload for one browser (aes128gcm, one record). */
export async function encryptPush(payload: Uint8Array, p256dh: string, auth: string) {
  const ua = b64u.dec(p256dh);
  const secret = b64u.dec(auth);
  const eph = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(secret, shared, concat(enc.encode('WebPush: info\0'), ua, as), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([as.length]), as, body);
}

type Sub = { endpoint: string; p256dh: string; auth: string; user_id: string };

/** Sends one push; returns false when the browser has gone away (the subscription should be removed). */
async function sendPush(sub: Sub, msg: Record<string, unknown>, v: Vapid): Promise<boolean> {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuth(sub.endpoint, v),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body: await encryptPush(enc.encode(JSON.stringify(msg)), sub.p256dh, sub.auth),
    });
    await res.body?.cancel();
    return !(res.status === 404 || res.status === 410);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- email (Brevo)
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function sendEmail(to: { email: string; name: string }, subject: string, html: string, text: string): Promise<{ ok: boolean; why?: string }> {
  const key = Deno.env.get('BREVO_API_KEY');
  if (!key) return { ok: false, why: 'The BREVO_API_KEY secret isn’t set in Supabase' };
  if (!FROM) return { ok: false, why: 'The NOTIFY_FROM secret (the sender email) isn’t set in Supabase' };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'Seek', email: FROM }, to: [to], subject, htmlContent: html, textContent: text, tags: ['seek-notify'] }),
  });
  if (res.ok) {
    await res.body?.cancel();
    return { ok: true };
  }
  // Brevo's own reason (wrong key, sender not verified, daily limit…), for the test button
  const why = await res.text().catch(() => '');
  let msg = why;
  try {
    msg = JSON.parse(why).message ?? why;
  } catch {}
  return { ok: false, why: 'Brevo said: ' + (msg || 'error ' + res.status).slice(0, 200) };
}

type Note = { id: number; user_id: string; workspace_id: string | null; kind: string; title: string; body: string; conv: string; message_id: number | null; created_at: string };

const linkOf = (n: Note) => (n.message_id ? `${SITE}/open?m=${n.message_id}${n.workspace_id ? '&w=' + n.workspace_id : ''}` : SITE + '/channels');
const headline = (n: Note) => (n.kind === 'dm' ? `${n.title} sent you a message` : n.title);

function emailOf(notes: Note[], first: string, daily: boolean) {
  const subject = daily
    ? `Your Seek summary: ${notes.length} unread`
    : notes.length === 1
      ? headline(notes[0])
      : `${notes.length} unread messages in Seek`;
  const rows = notes
    .slice(0, 20)
    .map(
      (n) => `<tr><td style="padding:14px 0;border-top:1px solid #eee3ee">
  <div style="font-weight:600;color:#261325;font-size:15px">${esc(headline(n))}</div>
  ${n.body ? `<div style="color:#5f4a5e;font-size:14px;margin-top:4px;line-height:1.45">${esc(n.body.slice(0, 220))}</div>` : ''}
  <a href="${linkOf(n)}" style="display:inline-block;margin-top:8px;color:#4b154a;font-weight:600;font-size:14px;text-decoration:none">Open in Seek →</a>
</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f8f4f8;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4f8;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px 28px 22px">
<tr><td style="padding-bottom:16px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:8px;background:#4b154a;color:#fff;font-weight:800">S</span>
<span style="font-weight:700;font-size:16px;color:#261325;vertical-align:middle;margin-left:8px">Seek</span></td></tr>
<tr><td style="font-size:20px;font-weight:700;color:#261325;padding-bottom:6px">${daily ? 'Here’s what you missed' : `Hi ${esc(first)}, you have ${notes.length === 1 ? 'a new message' : notes.length + ' unread messages'}`}</td></tr>
<tr><td style="font-size:14px;color:#7a6179;padding-bottom:6px">${daily ? 'Unread from the last day.' : 'Sent while you were away from Seek.'}</td></tr>
${rows}
${notes.length > 20 ? `<tr><td style="padding-top:12px;font-size:14px;color:#5f4a5e">and ${notes.length - 20} more.</td></tr>` : ''}
<tr><td style="padding-top:20px"><a href="${SITE}/channels" style="display:inline-block;background:#4b154a;color:#fff;font-weight:600;font-size:15px;padding:11px 20px;border-radius:10px;text-decoration:none">Open Seek</a></td></tr>
</table>
<div style="max-width:520px;font-size:12px;color:#9a8599;padding:14px 8px;line-height:1.5">You get these emails because of your notification settings. Change them in Seek: Account settings → Notifications → Email.</div>
</td></tr></table></body></html>`;
  const text = [daily ? 'Here’s what you missed in Seek' : `Hi ${first}, you have unread messages in Seek`, '', ...notes.slice(0, 20).map((n) => `• ${headline(n)}${n.body ? ': ' + n.body.slice(0, 160) : ''}\n  ${linkOf(n)}`), '', 'Change these emails in Seek: Account settings → Notifications → Email.'].join('\n');
  return { subject, html, text };
}

// ---------------------------------------------------------------- who wants what, right now
type Person = { id: string; email: string; name: string; last_seen_at: string | null; dnd_until: string | null; notify_email: string; time_zone: string | null; desktop: boolean; preview: boolean; schedule: { days: number[]; from: string; to: string } | null };

/** Minutes since midnight and weekday (0 = Sun) in a time zone ("Asia/Karachi" or labels like "Lahore (GMT+5)"). */
function zoned(at: Date, tz: string | null) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), min: (Number(g('hour')) % 24) * 60 + Number(g('minute')), day: at.toLocaleDateString('en-CA', { timeZone: tz || 'UTC' }) };
  } catch {
    const o = /(?:GMT|UTC)\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?/i.exec(tz ?? '');
    const off = o ? (o[1] === '+' ? 1 : -1) * (Number(o[2]) * 60 + Number(o[3] ?? 0)) : 0;
    const d = new Date(at.getTime() + off * 60_000);
    return { wd: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), day: d.toISOString().slice(0, 10) };
  }
}
const hm = (x: string) => {
  const [h, m] = x.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** Paused, or outside their notification schedule. */
function quiet(p: Person) {
  if (p.dnd_until && Date.parse(p.dnd_until) > Date.now()) return true;
  const s = p.schedule;
  if (!s || !Array.isArray(s.days)) return false;
  const z = zoned(new Date(), p.time_zone);
  return !(s.days.includes(z.wd) && z.min >= hm(s.from) && z.min < hm(s.to));
}
const away = (p: Person, ms: number) => !p.last_seen_at || Date.now() - Date.parse(p.last_seen_at) > ms;

async function people(admin: Client, ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const [{ data: ps }, { data: np }] = await Promise.all([
    admin.from('profiles').select('id, email, name, last_seen_at, dnd_until, notify_email, time_zone').in('id', ids),
    admin.from('notify_prefs').select('user_id, desktop, preview, schedule').in('user_id', ids),
  ]);
  const pref = new Map(((np ?? []) as { user_id: string; desktop: boolean; preview: boolean; schedule: Person['schedule'] }[]).map((x) => [x.user_id, x]));
  return new Map(
    ((ps ?? []) as Omit<Person, 'desktop' | 'preview' | 'schedule'>[]).map((p) => {
      const x = pref.get(p.id);
      return [p.id, { ...p, name: (p.name || '').trim() || (p.email || '').split('@')[0], desktop: x?.desktop ?? true, preview: x?.preview ?? true, schedule: x?.schedule ?? null }];
    }),
  );
}

// ---------------------------------------------------------------- the work
async function flush(admin: Client) {
  const out = { pushed: 0, emailed: 0, digests: 0 };
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const COLS = 'id, user_id, workspace_id, kind, title, body, conv, message_id, created_at';

  // 1. push: new notifications not looked at yet (each one only once)
  const { data: fresh } = await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).is('pushed_at', null).is('read_at', null).gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString()).select(COLS);
  const newNotes = (fresh ?? []) as Note[];
  // 2. email candidates: unread, not emailed, from the last day
  const { data: pend } = await admin.from('notifications').select(COLS).is('emailed_at', null).is('read_at', null).gte('created_at', since).order('created_at').limit(500);
  const pending = (pend ?? []) as Note[];

  const who = await people(admin, [...new Set([...newNotes, ...pending].map((n) => n.user_id))]);

  if (newNotes.length) {
    const targets = newNotes.filter((n) => {
      const p = who.get(n.user_id);
      return p && p.desktop && !quiet(p) && away(p, PUSH_AWAY_MS);
    });
    if (targets.length) {
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, user_id').in('user_id', [...new Set(targets.map((n) => n.user_id))]);
      const v = await vapid(admin);
      const gone: string[] = [];
      await Promise.all(
        targets.flatMap((n) => {
          const p = who.get(n.user_id)!;
          const msg = { title: n.kind === 'dm' ? n.title : n.title, body: p.preview ? n.body.slice(0, 180) || 'New message' : 'New message', url: linkOf(n).replace(SITE, ''), tag: n.conv };
          return ((subs ?? []) as Sub[])
            .filter((s) => s.user_id === n.user_id)
            .map(async (s) => {
              const ok = await sendPush(s, msg, v);
              if (ok) out.pushed++;
              else gone.push(s.endpoint);
            });
        }),
      );
      if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
    }
  }

  // 3. emails, grouped per person
  const mine = new Map<string, Note[]>();
  for (const n of pending) (mine.get(n.user_id) ?? mine.set(n.user_id, []).get(n.user_id)!).push(n);
  if (mine.size && Deno.env.get('BREVO_API_KEY') && FROM) {
    const { data: st } = await admin.from('notify_state').select('user_id, last_email_at, last_digest_on').in('user_id', [...mine.keys()]);
    const state = new Map(((st ?? []) as { user_id: string; last_email_at: string | null; last_digest_on: string | null }[]).map((x) => [x.user_id, x]));
    for (const [uid, notes] of mine) {
      const p = who.get(uid);
      if (!p?.email) continue;
      const s = state.get(uid);
      if (p.notify_email === 'instant') {
        if (quiet(p)) continue;
        if (s?.last_email_at && Date.now() - Date.parse(s.last_email_at) < EMAIL_GAP_MS) continue;
        // away a while already: now. Otherwise once a note has waited 10 minutes and they still haven't looked
        const due = away(p, EMAIL_AWAY_MS) || (away(p, PUSH_AWAY_MS) && notes.some((n) => Date.now() - Date.parse(n.created_at) > EMAIL_AWAY_MS));
        if (!due) continue;
        const e = emailOf(notes, p.name.split(/\s+/)[0], false);
        if ((await sendEmail({ email: p.email, name: p.name }, e.subject, e.html, e.text)).ok) {
          out.emailed++;
          await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', notes.map((n) => n.id));
          await admin.from('notify_state').upsert({ user_id: uid, last_email_at: new Date().toISOString(), last_digest_on: s?.last_digest_on ?? null });
        }
      } else if (p.notify_email === 'daily') {
        const z = zoned(new Date(), p.time_zone);
        if (z.min < 9 * 60 || s?.last_digest_on === z.day) continue;
        const e = emailOf(notes, p.name.split(/\s+/)[0], true);
        if ((await sendEmail({ email: p.email, name: p.name }, e.subject, e.html, e.text)).ok) {
          out.digests++;
          await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', notes.map((n) => n.id));
          await admin.from('notify_state').upsert({ user_id: uid, last_email_at: s?.last_email_at ?? null, last_digest_on: z.day });
        }
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { db: { schema: 'seek' }, auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await admin.auth.getUser(token);
  const user = who?.user;
  if (!user) return json({ error: 'Please sign in again' }, 401);

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    if (body.action === 'vapid') return json({ publicKey: (await vapid(admin)).publicKey });
    if (body.action === 'test-email') {
      const p = (await people(admin, [user.id])).get(user.id);
      const to = p?.email || user.email;
      if (!to) return json({ error: 'Your account has no email address' }, 400);
      const sample: Note = { id: 0, user_id: user.id, workspace_id: null, kind: 'dm', title: 'Seek', body: 'This is a test. Unread direct messages, mentions, replies and client messages will reach you like this when you’re away.', conv: 'test', message_id: null, created_at: new Date().toISOString() };
      const e = emailOf([sample], (p?.name || 'there').split(/\s+/)[0], false);
      const r = await sendEmail({ email: to, name: p?.name || to }, 'Seek email notifications are on', e.html, e.text);
      return r.ok ? json({ sent: to }) : json({ error: r.why }, 502);
    }
    if (body.action === 'test') {
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, user_id').eq('user_id', user.id);
      const list = (subs ?? []) as Sub[];
      if (!list.length) return json({ error: 'Turn on notifications on this device first' }, 400);
      const v = await vapid(admin);
      let sent = 0;
      for (const s of list) if (await sendPush(s, { title: 'Seek notifications are on', body: 'This is how new messages will reach you when you’re away from Seek.', url: '/channels', tag: 'seek-test' }, v)) sent++;
      return json({ sent, devices: list.length });
    }
    return json(await flush(admin));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
