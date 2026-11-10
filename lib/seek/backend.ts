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

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (!backendOn) throw new Error('Supabase is not configured');
  client ??= createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export type Account = {
  email: string;
  name: string;
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
    sb().from('profiles').select('name').eq('id', user.id).maybeSingle(),
    sb()
      .from('workspace_members')
      .select('role, joined_at, workspaces ( id, name, slug )')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1),
  ]);
  const m = memberships?.[0] as { role: string; workspaces: { id: string; name: string; slug: string } | null } | undefined;
  return {
    email: user.email ?? '',
    name: (profile?.name as string | undefined) ?? '',
    workspace: m?.workspaces ? { ...m.workspaces, role: m.role } : null,
  };
}

export async function createWorkspace(w: { name: string; slug: string; tz: string; size: string; use: string[]; invites: string[] }): Promise<string | null> {
  const { error } = await sb().rpc('create_workspace', {
    p_name: w.name.trim() || 'My workspace',
    p_slug: w.slug,
    p_time_zone: w.tz,
    p_team_size: w.size,
    p_uses: w.use,
    p_invites: w.invites,
  });
  return error ? friendly(error.message) : null;
}

export async function saveProfile(name: string, title: string): Promise<string | null> {
  const { data } = await sb().auth.getUser();
  if (!data.user) return 'Not signed in';
  const { error } = await sb().from('profiles').update({ name, title, updated_at: new Date().toISOString() }).eq('id', data.user.id);
  return error ? friendly(error.message) : null;
}

export async function signOut(): Promise<void> {
  await sb().auth.signOut();
}
