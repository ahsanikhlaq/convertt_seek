// Seek · invite a teammate, or a client to their client space, by email.
// Called from the app by a signed-in person: { workspace_id | space_id, email, redirect_to }. A client invite
// (space_id) needs the person to be listed in that space already; the email then reads "X invited you to
// <client>'s project space". A teammate invite (workspace_id) saves the invite as the caller (so row-level
// security decides whether they may invite to the workspace). Both are emailed with Supabase's "Invite user" template. Its Join link opens the app's welcome screen, where the new teammate
// signs in, sets up their profile and lands in #general. People who already have a Seek account get a sign-in
// email instead and join the workspace the next time they sign in.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

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

  let body: { workspace_id?: string; space_id?: string; email?: string; redirect_to?: string; role?: string; channels?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  const workspaceId = String(body.workspace_id ?? '');
  const spaceId = String(body.space_id ?? '');
  const redirectTo = String(body.redirect_to ?? '') || undefined;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || (!workspaceId && !spaceId)) return json({ error: 'Enter a valid email' }, 400);
  if (email === (user.email ?? '').toLowerCase()) return json({ error: 'That’s your own email' }, 400);

  // checked as the caller, so row-level security decides who may invite
  const asCaller = createClient(url, anon, { ...opts, global: { headers: { Authorization: 'Bearer ' + token } } });
  const { data: me } = await admin.from('profiles').select('name, email').eq('id', user.id).single();
  const inviter = (me?.name ?? '').trim() || (me?.email ?? user.email ?? '').split('@')[0] || 'A teammate';
  let data: Record<string, string>;

  if (spaceId) {
    // a client: the person must already be listed in the space (the New client wizard or the People tab adds them)
    const { data: person } = await asCaller.from('client_people').select('id, name').eq('space_id', spaceId).eq('email', email).maybeSingle();
    if (!person) return json({ error: 'Add this person to the client space first' }, 403);
    const { data: sp } = await admin.from('client_spaces').select('name, project, reply_target, workspaces ( name )').eq('id', spaceId).single();
    const agency = (sp?.workspaces as { name?: string } | null)?.name ?? 'your agency';
    data = {
      invited_by: inviter,
      workspace: `${sp?.name ?? 'your'}’s project space`,
      space: sp?.name ?? '',
      project: sp?.project ?? '',
      agency,
      reply_target: sp?.reply_target ?? '',
      name: person.name ?? '',
    };
  } else {
    // a teammate: saved as an invite with their role and the private channels they'll see (row-level security
    // checks the caller may invite, may give that role and can see those channels)
    const role = body.role === 'admin' ? 'admin' : 'member';
    const channels = Array.isArray(body.channels) ? body.channels.filter((c) => typeof c === 'string').slice(0, 200) : [];
    const { error: saveErr } = await asCaller.from('workspace_invites').insert({ workspace_id: workspaceId, email, invited_by: user.id, role, channels });
    if (saveErr?.code === '23505') {
      const { error: upErr } = await asCaller.from('workspace_invites').update({ role, channels }).eq('workspace_id', workspaceId).eq('email', email).is('accepted_at', null);
      if (upErr) return json({ error: 'You can’t invite people with that role or to those channels' }, 403);
    } else if (saveErr) return json({ error: role === 'admin' ? 'Only admins can invite admins' : 'You can’t invite people to this workspace' }, 403);
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', workspaceId).single();
    data = { invited_by: inviter, workspace: ws?.name ?? 'their workspace' };
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data });
  if (!error) return json({ status: 'invited' });

  if ((error as { code?: string }).code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message)) {
    const { error: otpErr } = await createClient(url, anon, opts).auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    return json(otpErr ? { status: 'saved', error: otpErr.message } : { status: 'existing' });
  }
  return json({ status: 'saved', error: error.message });
});
