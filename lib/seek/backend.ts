'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Seek's connection to Supabase (sign-in and data). It is switched on only when both public settings are
 * present; without them the app runs in demo mode, exactly like the product prototype.
 *
 *   NEXT_PUBLIC_SUPABASE_URL       = https://<project>.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  = the project's public "anon" key (safe in the browser: row-level security
 *                                    in supabase/migrations decides what each person can read and write)
 *
 * It talks to Supabase straight from the browser, so it works the same in the desktop app's static export.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const backendOn = Boolean(URL_ && KEY);

/** Seek's tables live in their own schema, so the app can share a Supabase project with others. */
export const DB_SCHEMA = 'seek';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;
let client: Client | null = null;

export function sb(): Client {
  if (!backendOn) throw new Error('Supabase is not configured');
  client ??= createClient(URL_!, KEY!, { db: { schema: DB_SCHEMA }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export type Account = {
  email: string;
  name: string;
  title: string;
  timeZone: string;
  /** false until they've set up their profile (the welcome screen), once, after their first sign-in */
  onboarded: boolean;
  /** null until the person has set up (or been invited to) a workspace */
  workspace: { id: string; name: string; slug: string; role: string } | null;
};

/** Plain-language messages for the errors people actually hit. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  // Supabase's built-in sender allows only a few emails an hour; custom email (Resend) lifts this
  if (m.includes('email rate limit')) return 'Too many sign-in emails were sent in the last hour. Please try again later';
  if (m.includes('rate limit') || m.includes('security purposes')) return 'Please wait a minute before asking for another code';
  if (m.includes('expired') || m.includes('invalid')) return 'That code is wrong or has expired. Check it, or resend a new one';
  if (m.includes('provider is not enabled')) return 'Google sign-in isn’t set up yet. Use your email instead';
  if (m.includes('sending') || m.includes('unexpected_failure') || m.includes('credentials')) return 'We couldn’t send the email right now. Please try again shortly';
  if (m.includes('fetch')) return 'Can’t reach Seek. Check your connection and try again';
  return message;
}

/** Emails a 6-digit sign-in code. Creates the account on first use, so sign-up and sign-in are the same step. */
export async function sendCode(email: string): Promise<string | null> {
  // the email carries a 6-digit code (custom template) or, with Supabase's default email, a sign-in link back here
  const { error } = await sb().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/` } });
  return error ? friendly(error.message) : null;
}

/** Checks the 6-digit code. On success the person is signed in and joins any workspace they were invited to. */
export async function verifyCode(email: string, token: string): Promise<{ error: string | null; account: Account | null }> {
  const { error } = await sb().auth.verifyOtp({ email, token, type: 'email' });
  if (error) return { error: friendly(error.message), account: null };
  return { error: null, account: await currentAccount() };
}

export async function googleSignIn(): Promise<string | null> {
  // otherwise an unconfigured provider sends people to a raw error page
  const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY! } }).then((r) => r.json()).catch(() => null);
  if (settings && !settings.external?.google) return 'Google sign-in isn’t set up yet. Use your email instead';
  const { error } = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } });
  return error ? friendly(error.message) : null;
}

/** Who is signed in, and their first workspace. null when signed out. */
export async function currentAccount(): Promise<Account | null> {
  const { data } = await sb().auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  // anyone invited by email joins those workspaces the first time we see them signed in
  await sb().rpc('accept_my_invites');
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    sb().from('profiles').select('name, title, time_zone, onboarded_at').eq('id', user.id).maybeSingle(),
    sb()
      .from('workspace_members')
      .select('role, joined_at, workspaces ( id, name, slug )')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1),
  ]);
  const m = memberships?.[0] as { role: string; workspaces: { id: string; name: string; slug: string } | null } | undefined;
  const p = (profile ?? {}) as { name?: string; title?: string; time_zone?: string; onboarded_at?: string | null };
  return {
    email: user.email ?? '',
    name: p.name ?? '',
    title: p.title ?? '',
    timeZone: p.time_zone ?? '',
    onboarded: Boolean(p.onboarded_at),
    workspace: m?.workspaces ? { ...m.workspaces, role: m.role } : null,
  };
}

/** The newest invite sent to your email: which workspace, and who invited you. */
export async function myInvite(): Promise<{ workspace: string; invitedBy: string } | null> {
  const { data } = await sb().rpc('my_invite');
  const row = (data as { workspace: string; invited_by: string }[] | null)?.[0];
  return row ? { workspace: row.workspace, invitedBy: row.invited_by } : null;
}

/** Signs in with the one-time link from an invite email (the Join button). */
export async function acceptInviteLink(tokenHash: string): Promise<{ error: string | null; account: Account | null }> {
  const { error } = await sb().auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
  if (error) return { error: friendly(error.message), account: null };
  return { error: null, account: await currentAccount() };
}

/**
 * Invites someone to your workspace: saves the invite and emails them a "Join" link (supabase/functions/seek-invite).
 * Returns a message to show.
 */
export async function sendInvite(workspaceId: string, email: string): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await sb().functions.invoke('seek-invite', {
    body: { workspace_id: workspaceId, email, redirect_to: `${location.origin}/welcome` },
  });
  if (error) {
    // the function's own message, when it sent one
    let msg = '';
    try {
      msg = (await (error as { context?: Response }).context?.json())?.error ?? '';
    } catch {}
    return { ok: false, message: msg || 'Couldn’t send the invite. Try again in a moment' };
  }
  const r = (data ?? {}) as { status?: string; error?: string };
  if (r.status === 'invited') return { ok: true, message: `Invite sent to ${email}` };
  if (r.status === 'existing') return { ok: true, message: `${email} already has a Seek account. We emailed them a sign-in code, and they’ll join when they sign in` };
  return { ok: false, message: `Invite saved, but the email to ${email} couldn’t be sent (${friendly(r.error ?? 'unknown error')})` };
}

export async function createWorkspace(w: { name: string; slug: string; tz: string; size: string; use: string[]; invites: string[] }): Promise<{ error: string | null; id: string | null }> {
  const { data, error } = await sb().rpc('create_workspace', {
    p_name: w.name.trim() || 'My workspace',
    p_slug: w.slug,
    p_time_zone: w.tz,
    p_team_size: w.size,
    p_uses: w.use,
    p_invites: w.invites,
  });
  return error ? { error: friendly(error.message), id: null } : { error: null, id: data as string };
}

/** Saves your profile; the first save also marks it as set up, so the welcome screen doesn't come back. */
export async function saveProfile(p: { name: string; title: string; timeZone?: string }): Promise<string | null> {
  const { data } = await sb().auth.getUser();
  if (!data.user) return 'Not signed in';
  const now = new Date().toISOString();
  const row: Record<string, string> = { name: p.name, title: p.title, updated_at: now };
  if (p.timeZone) row.time_zone = p.timeZone;
  const { error } = await sb().from('profiles').update(row).eq('id', data.user.id);
  if (error) return friendly(error.message);
  await sb().from('profiles').update({ onboarded_at: now }).eq('id', data.user.id).is('onboarded_at', null);
  return null;
}

export async function signOut(): Promise<void> {
  await sb().auth.signOut();
}
