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
  id: string;
  email: string;
  name: string;
  title: string;
  timeZone: string;
  /** false until they've set up their profile (the welcome screen), once, after their first sign-in */
  onboarded: boolean;
  /** null until the person has set up (or been invited to) a workspace */
  workspace: Org | null;
  /** client spaces this person was invited to as a client (empty for the agency's team) */
  clientSpaces: ClientSpaceRef[];
  /** every organisation you belong to (the rail lists them; one is open) */
  orgs: Org[];
};

/** A client space you belong to as a client. */
export type ClientSpaceRef = { id: string; name: string; project: string; code: string; color: string; agency: string; agencyLogo: string | null; role: string; invitedBy: string };

/** A workspace (organization) you belong to. */
export type Org = { id: string; name: string; slug: string; role: string; logo: string | null; joinCode: string; accent: string | null };

/** Plain-language messages for the errors people actually hit. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  // Supabase's built-in sender allows only a few emails an hour; custom email (Resend) lifts this
  if (m.includes('email rate limit')) return 'Too many sign-in emails were sent in the last hour. Please try again later';
  const secs = /(\d+)\s*seconds?/.exec(m)?.[1];
  if (m.includes('rate limit') || m.includes('security purposes')) return secs ? `You can ask for a new code in ${secs} seconds` : 'Please wait a minute before asking for another code';
  if (m.includes('invite link not valid')) return 'This invite link isn’t valid any more. Ask your team for a new one';
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

/** Seconds to wait before another code can be sent, from a message like "…in 42 seconds" (0 when none). */
export function waitSeconds(message: string | null): number {
  const n = message ? /in (\d+) seconds/.exec(message)?.[1] : undefined;
  return n ? Number(n) : 0;
}

/**
 * Checks the 6-digit code. On success the person is signed in and joins any workspace they were invited to.
 * An invite email's code is an "invite" code until the account is confirmed, so for invites both kinds are tried.
 */
export async function verifyCode(email: string, token: string, kind: 'email' | 'invite' = 'email'): Promise<{ error: string | null; account: Account | null }> {
  let { error } = await sb().auth.verifyOtp({ email, token, type: kind });
  if (error && kind === 'invite') ({ error } = await sb().auth.verifyOtp({ email, token, type: 'email' }));
  if (error) return { error: friendly(error.message), account: null };
  return { error: null, account: await currentAccount(true) };
}

export async function googleSignIn(): Promise<string | null> {
  // otherwise an unconfigured provider sends people to a raw error page
  const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY! } }).then((r) => r.json()).catch(() => null);
  if (settings && !settings.external?.google) return 'Google sign-in isn’t set up yet. Use your email instead';
  const { error } = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } });
  return error ? friendly(error.message) : null;
}

/** The organization you last opened (or joined), so people in more than one land in the right place. */
const PREF = 'seek:org';
export function preferOrg(id: string) {
  try {
    localStorage.setItem(PREF, id);
  } catch {}
}

// Every screen asks who is signed in; the answer is loaded once and shared, and reloaded after anything changes it.
let cached: { uid: string; p: Promise<Account | null> } | null = null;
export function forgetAccount() {
  cached = null;
}

/** Who is signed in, and their organization. null when signed out. Pass fresh=true after changing either. */
export async function currentAccount(fresh = false): Promise<Account | null> {
  const { data } = await sb().auth.getSession();
  const user = data.session?.user;
  if (!user) {
    cached = null;
    return null;
  }
  if (!fresh && cached?.uid === user.id) return cached.p;
  const p = loadAccount(user.id, user.email ?? '');
  cached = { uid: user.id, p };
  p.catch(() => {
    if (cached?.p === p) cached = null;
  });
  return p;
}

type OrgRow = { id: string; name: string; slug: string; logo_url: string | null; join_code: string; brand_accent: string | null };

async function loadAccount(id: string, email: string): Promise<Account> {
  // anyone invited by email joins those workspaces the first time we see them signed in
  await sb().rpc('accept_my_invites');
  const [{ data: profile }, { data: memberships }, { data: spaces }] = await Promise.all([
    sb().from('profiles').select('name, title, time_zone, onboarded_at').eq('id', id).maybeSingle(),
    sb()
      .from('workspace_members')
      .select('role, joined_at, workspaces ( id, name, slug, logo_url, join_code, brand_accent )')
      .eq('user_id', id)
      .order('joined_at', { ascending: true })
      .limit(20),
    sb().rpc('my_client_spaces'),
  ]);
  type SpaceRow = { space_id: string; name: string; project: string; code: string; color: string; agency: string; agency_logo: string | null; role: string; invited_by: string };
  const clientSpaces = ((spaces ?? []) as SpaceRow[]).map((r) => ({
    id: r.space_id,
    name: r.name,
    project: r.project,
    code: r.code,
    color: r.color,
    agency: r.agency,
    agencyLogo: r.agency_logo,
    role: r.role,
    invitedBy: r.invited_by,
  }));
  const rows = (memberships ?? []) as unknown as { role: string; workspaces: OrgRow | null }[];
  let pref: string | null = null;
  try {
    pref = localStorage.getItem(PREF);
  } catch {}
  const m = rows.find((r) => r.workspaces?.id === pref) ?? rows.find((r) => r.workspaces);
  const w = m?.workspaces;
  const p = (profile ?? {}) as { name?: string; title?: string; time_zone?: string; onboarded_at?: string | null };
  return {
    id,
    email,
    name: p.name ?? '',
    title: p.title ?? '',
    timeZone: p.time_zone ?? '',
    onboarded: Boolean(p.onboarded_at),
    workspace: w ? { id: w.id, name: w.name, slug: w.slug, role: m!.role, logo: w.logo_url, joinCode: w.join_code, accent: w.brand_accent } : null,
    clientSpaces,
    orgs: rows
      .filter((r) => r.workspaces && r.role !== 'guest')
      .map((r) => ({ id: r.workspaces!.id, name: r.workspaces!.name, slug: r.workspaces!.slug, role: r.role, logo: r.workspaces!.logo_url, joinCode: r.workspaces!.join_code, accent: r.workspaces!.brand_accent })),
  };
}

/** The shareable link that lets anyone join your organization. */
export const joinLink = (code: string) => `${location.origin}/join?c=${encodeURIComponent(code)}`;

/** What an invite link points to (shown before signing in). null if the link isn't valid. */
export async function joinInfo(code: string): Promise<{ name: string; logo: string | null; members: number } | null> {
  const { data } = await sb().rpc('join_info', { p_code: code });
  const row = (data as { name: string; logo_url: string | null; members: number }[] | null)?.[0];
  return row ? { name: row.name, logo: row.logo_url, members: row.members } : null;
}

/** Joins the organization behind an invite link (signed in). */
export async function joinByCode(code: string): Promise<{ error: string | null; account: Account | null }> {
  const { data, error } = await sb().rpc('join_by_code', { p_code: code });
  if (error) return { error: friendly(error.message), account: null };
  preferOrg(data as string);
  return { error: null, account: await currentAccount(true) };
}

/** Admins: a new invite link (the old one stops working). Returns the new code. */
export async function resetJoinCode(orgId: string): Promise<{ error: string | null; code: string | null }> {
  const { data, error } = await sb().rpc('reset_join_code', { p_ws: orgId });
  forgetAccount();
  return error ? { error: friendly(error.message), code: null } : { error: null, code: data as string };
}

/** Crops an image to a centred square and shrinks it to 256px PNG (logos show in square tiles). */
async function toLogoPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('That file isn’t an image we can read'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.max(1, Math.min(256, side));
    const c = document.createElement('canvas');
    c.width = out;
    c.height = out;
    c.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Couldn’t read that image'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads an organization's logo (admins only) and saves it on the organization. Returns its public URL. */
export async function uploadLogo(orgId: string, file: File): Promise<{ error: string | null; url: string | null }> {
  try {
    const png = await toLogoPng(file);
    const path = `${orgId}/logo-${Date.now()}.png`;
    const store = sb().storage.from('seek-logos');
    const { error } = await store.upload(path, png, { contentType: 'image/png', cacheControl: '31536000' });
    if (error) return { error: 'Couldn’t upload the logo. ' + friendly(error.message), url: null };
    const url = store.getPublicUrl(path).data.publicUrl;
    const { error: e2 } = await sb().from('workspaces').update({ logo_url: url }).eq('id', orgId);
    forgetAccount();
    return e2 ? { error: friendly(e2.message), url: null } : { error: null, url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Couldn’t upload the logo', url: null };
  }
}

/** Admins: renames the organization. */
export async function renameOrg(orgId: string, name: string): Promise<string | null> {
  const { error } = await sb().from('workspaces').update({ name: name.trim() }).eq('id', orgId);
  forgetAccount();
  return error ? friendly(error.message) : null;
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
  if (error) {
    // kept in the console so a failed link can be diagnosed
    console.warn('Seek: invite link not accepted:', error.message);
    return { error: friendly(error.message), account: null };
  }
  return { error: null, account: await currentAccount(true) };
}

/**
 * Invites someone to your workspace: saves the invite and emails them a "Join" link (supabase/functions/seek-invite).
 * Returns a message to show.
 */
export async function sendInvite(workspaceId: string, email: string, opts: { role?: 'member' | 'admin'; channels?: string[] } = {}): Promise<{ ok: boolean; message: string }> {
  return invite({ workspace_id: workspaceId, email, role: opts.role ?? 'member', channels: opts.channels ?? [] });
}

/** Emails a client their invite to a client space (they must already be listed in its people). */
export async function inviteClient(spaceId: string, email: string): Promise<{ ok: boolean; message: string }> {
  return invite({ space_id: spaceId, email });
}

async function invite(body: { workspace_id?: string; space_id?: string; email: string; role?: string; channels?: string[] }): Promise<{ ok: boolean; message: string }> {
  const email = body.email;
  const { data, error } = await sb().functions.invoke('seek-invite', {
    body: { ...body, redirect_to: `${location.origin}/welcome` },
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

/** Personal email providers: "anyone at @domain can join" is never offered for these. */
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com'];
export const companyDomain = (email: string) => {
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  return d && !FREE_MAIL.includes(d) ? d : null;
};

/** Is this workspace address free? (checked on the server; reserved words are never free) */
export async function slugAvailable(slug: string): Promise<boolean> {
  const { data } = await sb().rpc('slug_available', { p_slug: slug });
  return data === true;
}

/** Creates the organisation with the exact address chosen. Fails with a clear message if it was taken meanwhile. */
export async function createOrganisation(o: { name: string; slug: string; tz: string; size: string; use: string[]; accent: string; website: string; allowDomain: boolean }): Promise<{ error: string | null; id: string | null }> {
  const { data, error } = await sb().rpc('create_organisation', {
    p_name: o.name.trim(),
    p_slug: o.slug,
    p_time_zone: o.tz,
    p_team_size: o.size,
    p_uses: o.use,
    p_accent: o.accent,
    p_website: o.website.trim(),
    p_allow_domain: o.allowDomain,
  });
  forgetAccount();
  if (error) return { error: /address taken/i.test(error.message) ? 'That address was just taken. Try another one' : friendly(error.message), id: null };
  preferOrg(data as string);
  return { error: null, id: data as string };
}

/** Organisations that let anyone with your email's company domain join. */
export async function joinableOrgs(): Promise<{ id: string; name: string; slug: string; logo: string | null; members: number }[]> {
  const { data } = await sb().rpc('joinable_orgs');
  return ((data ?? []) as { id: string; name: string; slug: string; logo_url: string | null; members: number }[]).map((r) => ({ id: r.id, name: r.name, slug: r.slug, logo: r.logo_url, members: r.members }));
}

/** Admins: let anyone with your company email domain join (never personal email providers). */
export async function setDomainJoin(orgId: string, on: boolean): Promise<string | null> {
  const { error } = await sb().rpc('set_domain_join', { p_ws: orgId, p_on: on });
  return error ? friendly(error.message) : null;
}

export async function joinByDomain(orgId: string): Promise<{ error: string | null; account: Account | null }> {
  const { error } = await sb().rpc('join_by_domain', { p_ws: orgId });
  if (error) return { error: friendly(error.message), account: null };
  preferOrg(orgId);
  return { error: null, account: await currentAccount(true) };
}

export async function createWorkspace(w:{ name: string; slug: string; tz: string; size: string; use: string[]; invites: string[] }): Promise<{ error: string | null; id: string | null }> {
  const { data, error } = await sb().rpc('create_workspace', {
    p_name: w.name.trim() || 'My workspace',
    p_slug: w.slug,
    p_time_zone: w.tz,
    p_team_size: w.size,
    p_uses: w.use,
    p_invites: w.invites,
  });
  forgetAccount();
  if (error) return { error: friendly(error.message), id: null };
  preferOrg(data as string);
  return { error: null, id: data as string };
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
  forgetAccount();
  return null;
}

// ---------------------------------------------------------------- client spaces

export type ClientRole = 'approver' | 'contributor' | 'viewer';
export type NewClientSpace = {
  orgId: string;
  name: string;
  project: string;
  code: string;
  color: string;
  replyTarget: string;
  tone: string;
  neverMention: string[];
  people: { email: string; name: string; role: ClientRole }[];
  team: string[];
  steps: { kind: string; title: string; detail: string; side: 'client' | 'team' }[];
  welcome: string;
};

/** Creates a client space with its people, team, checklist and welcome message. Invites are sent separately. */
export async function createClientSpace(c: NewClientSpace): Promise<{ error: string | null; id: string | null }> {
  const { data, error } = await sb().rpc('create_client_space', {
    p_ws: c.orgId,
    p_name: c.name,
    p_project: c.project,
    p_code: c.code,
    p_color: c.color,
    p_reply: c.replyTarget,
    p_tone: c.tone,
    p_never: c.neverMention,
    p_people: c.people,
    p_team: c.team,
    p_steps: c.steps,
    p_welcome: c.welcome,
  });
  return error ? { error: friendly(error.message), id: null } : { error: null, id: data as string };
}

/** Ticks (or unticks) an onboarding step. */
export async function completeStep(stepId: string, done = true): Promise<string | null> {
  const { error } = await sb().rpc('complete_step', { p_step: stepId, p_done: done });
  return error ? friendly(error.message) : null;
}

export async function signOut(): Promise<void> {
  forgetAccount();
  await sb().auth.signOut();
}
