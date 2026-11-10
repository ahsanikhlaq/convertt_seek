-- Seek · phase 1: accounts and workspaces
-- People sign in with Supabase Auth (6-digit email code, later Google). Everything here is protected by
-- row-level security: a person only ever sees workspaces they belong to, and the people in them.

-- ---------------------------------------------------------------- profiles
-- One row per signed-in person, created automatically when they first sign in.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text not null default '',
  title       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- workspaces
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9]{1,40}$'),
  time_zone   text not null default 'Lahore (GMT+5)',
  team_size   text not null default '1–10',
  uses        text[] not null default '{}',
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now()
);

-- owner: created it · admin: manages people and settings · member: the team · guest: a client (phase 3)
create type public.member_role as enum ('owner', 'admin', 'member', 'guest');

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.member_role not null default 'member',
  joined_at     timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role          public.member_role not null default 'member',
  invited_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  unique (workspace_id, email)
);

-- ---------------------------------------------------------------- helpers
-- security definer so policies can ask "is this person in that workspace?" without recursing into RLS.
create or replace function public.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

create or replace function public.is_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

-- Creates a workspace, makes the caller its owner and records teammate invites, all in one step.
create or replace function public.create_workspace(
  p_name text,
  p_slug text,
  p_time_zone text,
  p_team_size text,
  p_uses text[],
  p_invites text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
  v_base text := coalesce(nullif(p_slug, ''), 'workspace');
  v_slug text := v_base;
  n     int := 1;
  inv   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  -- keep the address unique: convertt, convertt2, convertt3, …
  while exists (select 1 from public.workspaces w where w.slug = v_slug) loop
    n := n + 1;
    v_slug := left(v_base, 38) || n;
  end loop;

  insert into public.workspaces (name, slug, time_zone, team_size, uses, created_by)
  values (p_name, v_slug, p_time_zone, p_team_size, coalesce(p_uses, '{}'), auth.uid())
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role) values (ws_id, auth.uid(), 'owner');

  foreach inv in array coalesce(p_invites, '{}') loop
    insert into public.workspace_invites (workspace_id, email, invited_by)
    values (ws_id, lower(trim(inv)), auth.uid())
    on conflict (workspace_id, email) do nothing;
  end loop;

  return ws_id;
end;
$$;

-- When someone signs in with an email that was invited, they join those workspaces.
create or replace function public.accept_my_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_email text := (select lower(u.email) from auth.users u where u.id = auth.uid());
  joined int := 0;
  inv record;
begin
  if auth.uid() is null or my_email is null then
    return 0;
  end if;
  for inv in
    select * from public.workspace_invites i where lower(i.email) = my_email and i.accepted_at is null
  loop
    insert into public.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, auth.uid(), inv.role)
    on conflict do nothing;
    update public.workspace_invites set accepted_at = now() where id = inv.id;
    joined := joined + 1;
  end loop;
  return joined;
end;
$$;

revoke all on function public.create_workspace(text, text, text, text, text[], text[]) from public, anon;
revoke all on function public.accept_my_invites() from public, anon;
grant execute on function public.create_workspace(text, text, text, text, text[], text[]) to authenticated;
grant execute on function public.accept_my_invites() to authenticated;

-- ---------------------------------------------------------------- row-level security
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

-- profiles: yourself, plus anyone you share a workspace with
create policy "profiles: read self and teammates" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- workspaces: members read, admins edit; creating goes through create_workspace()
create policy "workspaces: members read" on public.workspaces
  for select to authenticated using (public.is_member(id));
create policy "workspaces: admins update" on public.workspaces
  for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

-- members: visible to fellow members; admins manage; anyone may leave
create policy "members: members read" on public.workspace_members
  for select to authenticated using (public.is_member(workspace_id));
create policy "members: admins update" on public.workspace_members
  for update to authenticated using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id));
create policy "members: admins remove, or leave" on public.workspace_members
  for delete to authenticated using (public.is_admin(workspace_id) or user_id = auth.uid());

-- invites: admins see and manage their workspace's invites
create policy "invites: admins read" on public.workspace_invites
  for select to authenticated using (public.is_admin(workspace_id));
create policy "invites: admins add" on public.workspace_invites
  for insert to authenticated with check (public.is_admin(workspace_id) and invited_by = auth.uid());
create policy "invites: admins remove" on public.workspace_invites
  for delete to authenticated using (public.is_admin(workspace_id));
