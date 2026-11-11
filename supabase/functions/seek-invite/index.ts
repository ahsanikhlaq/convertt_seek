// Seek · invite a teammate by email.
// Called from the app by a signed-in person: { workspace_id, email, redirect_to }. It saves the invite as that
// person (so row-level security decides whether they may invite to the workspace), then emails an invitation
// with Supabase's "Invite user" template. Its Join link opens the app's welcome screen, where the new teammate
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

  let body: { workspace_id?: string; email?: string; redirect_to?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  const workspaceId = String(body.workspace_id ?? '');
  const redirectTo = String(body.redirect_to ?? '') || undefined;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !workspaceId) return json({ error: 'Enter a valid email' }, 400);
  if (email === (user.email ?? '').toLowerCase()) return json({ error: 'That’s your own email' }, 400);

  // saved as the caller, so only people on the workspace's team can invite to it
  const asCaller = createClient(url, anon, { ...opts, global: { headers: { Authorization: 'Bearer ' + token } } });
  const { error: saveErr } = await asCaller.from('workspace_invites').insert({ workspace_id: workspaceId, email, invited_by: user.id });
  if (saveErr && saveErr.code !== '23505') return json({ error: 'You can’t invite people to this workspace' }, 403);

  const [{ data: ws }, { data: me }] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', workspaceId).single(),
    admin.from('profiles').select('name, email').eq('id', user.id).single(),
  ]);
  const inviter = (me?.name ?? '').trim() || (me?.email ?? user.email ?? '').split('@')[0] || 'A teammate';
  const workspace = ws?.name ?? 'their workspace';

  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_by: inviter, workspace } });
  if (!error) return json({ status: 'invited' });

  if ((error as { code?: string }).code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message)) {
    const { error: otpErr } = await createClient(url, anon, opts).auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    return json(otpErr ? { status: 'saved', error: otpErr.message } : { status: 'existing' });
  }
  return json({ status: 'saved', error: error.message });
});
