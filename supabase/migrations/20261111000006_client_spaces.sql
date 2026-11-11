-- Seek · phase 3: client spaces
-- Each client gets a space with two conversations: Client chat (the client sees it) and Team notes (team only),
-- plus the people on both sides and an onboarding checklist. Clients are NOT workspace members: they sign in
-- with an emailed code and only ever see their own space's Client chat, people and checklist. The database
-- enforces this; the app never has to hide anything.

-- ---------------------------------------------------------------- tables
create table seek.client_spaces (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),          -- the client, e.g. Hollow & Bright
  project       text not null default '' check (char_length(project) <= 80),       -- e.g. Website relaunch
  code          text not null check (code ~ '^[A-Z0-9]{1,3}$'),                    -- short code, e.g. HB
  color         text not null default '#8a5300' check (color ~ '^#[0-9a-fA-F]{6}$'),
  reply_target  text not null default '1 working day',
  tone          text not null default '',
  never_mention text[] not null default '{}',                                      -- team only
  approvers     jsonb not null default '{}',                                       -- kind of work → client person id
  status        text not null default 'onboarding' check (status in ('onboarding', 'active', 'closed')),
  created_by    uuid not null default auth.uid() references auth.users (id),
  created_at    timestamptz not null default now()
);
create index client_spaces_ws_idx on seek.client_spaces (workspace_id);

-- people at the client; user_id is filled in when they sign in with the invited email
create table seek.client_people (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references seek.client_spaces (id) on delete cascade,
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name        text not null default '',
  role        text not null default 'contributor' check (role in ('approver', 'contributor', 'viewer')),
  user_id     uuid references auth.users (id) on delete set null,
  invited_by  uuid references auth.users (id) on delete set null,
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  removed_at  timestamptz,
  unique (space_id, email)
);
create index client_people_user_idx on seek.client_people (user_id);
create index client_people_email_idx on seek.client_people (lower(email));

-- your team on this client (the lead is shown to the client first)
create table seek.client_team (
  space_id  uuid not null references seek.client_spaces (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  is_lead   boolean not null default false,
  primary key (space_id, user_id)
);

-- the onboarding checklist: client steps (gold) and team steps
create table seek.client_steps (
  id        uuid primary key default gen_random_uuid(),
  space_id  uuid not null references seek.client_spaces (id) on delete cascade,
  kind      text not null default 'custom',  -- profile, assets, approvers, kickoff, scope, logins, custom
  title     text not null check (char_length(title) between 1 and 120),
  detail    text not null default '',
  side      text not null check (side in ('client', 'team')),
  position  int not null default 0,
  done_at   timestamptz,
  done_by   uuid references auth.users (id) on delete set null
);
create index client_steps_space_idx on seek.client_steps (space_id, position);

-- ---------------------------------------------------------------- messages: a channel, a DM or a client space
alter table seek.messages add column space_id uuid references seek.client_spaces (id) on delete cascade;
alter table seek.messages add column lane text check (lane in ('client', 'team'));
alter table seek.messages drop constraint messages_in_one_place;
alter table seek.messages add constraint messages_in_one_place check (num_nonnulls(channel_id, dm_id, space_id) = 1);
alter table seek.messages add constraint messages_lane_only_in_spaces check ((space_id is null) = (lane is null));
create index messages_space_time_idx on seek.messages (space_id, lane, created_at) where space_id is not null;

-- ---------------------------------------------------------------- helpers
-- 'team' (anyone on the agency's team), 'client' (a client person in this space) or null
create or replace function seek.space_side(sp uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from seek.client_spaces s where s.id = sp and seek.is_team(s.workspace_id)) then 'team'
    when exists (select 1 from seek.client_people p where p.space_id = sp and p.user_id = auth.uid() and p.removed_at is null) then 'client'
  end;
$$;

-- a client who may write (approvers and contributors; viewers only read)
create or replace function seek.client_can_write(sp uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from seek.client_people p
    where p.space_id = sp and p.user_id = auth.uid() and p.removed_at is null and p.role <> 'viewer'
  );
$$;

create or replace function seek.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel_id is not null then
    new.workspace_id := (select c.workspace_id from seek.channels c where c.id = new.channel_id);
  elsif new.dm_id is not null then
    new.workspace_id := (select d.workspace_id from seek.dm_threads d where d.id = new.dm_id);
  else
    new.workspace_id := (select s.workspace_id from seek.client_spaces s where s.id = new.space_id);
  end if;
  new.user_id := auth.uid();
  if new.parent_id is not null and not exists (
    select 1 from seek.messages p
    where p.id = new.parent_id and p.parent_id is null
      and p.channel_id is not distinct from new.channel_id and p.dm_id is not distinct from new.dm_id
      and p.space_id is not distinct from new.space_id and p.lane is not distinct from new.lane
  ) then
    raise exception 'a reply must belong to a message in the same conversation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- creating a client space
-- Creates the space with its people, team, checklist and welcome message in one step. Invite emails are sent
-- afterwards by the seek-invite function, one per client person.
create or replace function seek.create_client_space(
  p_ws       uuid,
  p_name     text,
  p_project  text,
  p_code     text,
  p_color    text,
  p_reply    text,
  p_tone     text,
  p_never    text[],
  p_people   jsonb,   -- [{ "email", "name", "role" }]
  p_team     uuid[],  -- teammates on this client (you are added as lead)
  p_steps    jsonb,   -- [{ "kind", "title", "detail", "side" }]
  p_welcome  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp    uuid;
  per   jsonb;
  st    jsonb;
  n     int := 0;
  tm    uuid;
begin
  if not seek.is_team(p_ws) then
    raise exception 'only your team can create client spaces';
  end if;
  insert into seek.client_spaces (workspace_id, name, project, code, color, reply_target, tone, never_mention)
  values (p_ws, trim(p_name), trim(coalesce(p_project, '')), upper(p_code), coalesce(p_color, '#8a5300'),
          coalesce(nullif(p_reply, ''), '1 working day'), coalesce(p_tone, ''), coalesce(p_never, '{}'))
  returning id into sp;

  for per in select * from jsonb_array_elements(coalesce(p_people, '[]'::jsonb)) loop
    insert into seek.client_people (space_id, email, name, role, invited_by)
    values (sp, lower(trim(per ->> 'email')), trim(coalesce(per ->> 'name', '')), coalesce(per ->> 'role', 'contributor'), auth.uid())
    on conflict (space_id, email) do nothing;
  end loop;

  insert into seek.client_team (space_id, user_id, is_lead) values (sp, auth.uid(), true);
  foreach tm in array coalesce(p_team, '{}') loop
    if tm <> auth.uid() and exists (select 1 from seek.workspace_members m where m.workspace_id = p_ws and m.user_id = tm and m.role <> 'guest') then
      insert into seek.client_team (space_id, user_id) values (sp, tm) on conflict do nothing;
    end if;
  end loop;

  for st in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    insert into seek.client_steps (space_id, kind, title, detail, side, position)
    values (sp, coalesce(st ->> 'kind', 'custom'), st ->> 'title', coalesce(st ->> 'detail', ''), coalesce(st ->> 'side', 'client'), n);
    n := n + 1;
  end loop;

  if coalesce(trim(p_welcome), '') <> '' then
    insert into seek.messages (space_id, lane, body) values (sp, 'client', trim(p_welcome));
  end if;
  return sp;
end;
$$;

-- Ticks a checklist step. Clients can tick their own steps; the team can tick any. When every step is done the
-- space switches from onboarding to active.
create or replace function seek.complete_step(p_step uuid, p_done boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st record;
  side text;
begin
  select * into st from seek.client_steps where id = p_step;
  if st is null then
    raise exception 'step not found';
  end if;
  side := seek.space_side(st.space_id);
  if side is null or (side = 'client' and st.side <> 'client') then
    raise exception 'you can’t change this step';
  end if;
  update seek.client_steps
     set done_at = case when p_done then coalesce(done_at, now()) end,
         done_by = case when p_done then coalesce(done_by, auth.uid()) end
   where id = p_step;
  update seek.client_spaces s
     set status = case when not exists (select 1 from seek.client_steps x where x.space_id = s.id and x.done_at is null) then 'active' else 'onboarding' end
   where s.id = st.space_id and s.status <> 'closed';
end;
$$;

-- When someone signs in with an email that was invited, they join those workspaces (team invites) and their
-- client spaces (client invites).
create or replace function seek.accept_my_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_email text := (select lower(u.email) from auth.users u where u.id = auth.uid());
  joined int := 0;
  inv record;
  n int;
begin
  if auth.uid() is null or my_email is null then
    return 0;
  end if;
  for inv in
    select * from seek.workspace_invites i where lower(i.email) = my_email and i.accepted_at is null
  loop
    insert into seek.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, auth.uid(), inv.role)
    on conflict do nothing;
    update seek.workspace_invites set accepted_at = now() where id = inv.id;
    joined := joined + 1;
  end loop;
  update seek.client_people
     set user_id = auth.uid(), joined_at = coalesce(joined_at, now())
   where lower(email) = my_email and user_id is null and removed_at is null;
  get diagnostics n = row_count;
  return joined + n;
end;
$$;

-- The client spaces you belong to as a client (for the client's own view and the welcome screen).
create or replace function seek.my_client_spaces()
returns table (space_id uuid, name text, project text, code text, color text, agency text, agency_logo text, role text, invited_by text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.project, s.code, s.color, w.name, w.logo_url, p.role,
         coalesce(nullif(trim(ip.name), ''), split_part(ip.email, '@', 1))
  from seek.client_people p
  join seek.client_spaces s on s.id = p.space_id
  join seek.workspaces w on w.id = s.workspace_id
  left join seek.profiles ip on ip.id = p.invited_by
  where p.user_id = auth.uid() and p.removed_at is null and s.status <> 'closed'
  order by p.invited_at;
$$;

revoke all on function seek.create_client_space(uuid, text, text, text, text, text, text, text[], jsonb, uuid[], jsonb, text) from public, anon;
revoke all on function seek.complete_step(uuid, boolean) from public, anon;
revoke all on function seek.my_client_spaces() from public, anon;
revoke all on function seek.space_side(uuid) from public, anon;
revoke all on function seek.client_can_write(uuid) from public, anon;
grant execute on function seek.create_client_space(uuid, text, text, text, text, text, text, text[], jsonb, uuid[], jsonb, text) to authenticated;
grant execute on function seek.complete_step(uuid, boolean) to authenticated;
grant execute on function seek.my_client_spaces() to authenticated;
grant execute on function seek.space_side(uuid) to authenticated;
grant execute on function seek.client_can_write(uuid) to authenticated;

-- ---------------------------------------------------------------- row-level security
alter table seek.client_spaces enable row level security;
alter table seek.client_people enable row level security;
alter table seek.client_team   enable row level security;
alter table seek.client_steps  enable row level security;

create policy "client spaces: team and its clients read" on seek.client_spaces
  for select to authenticated using (seek.space_side(id) is not null);
create policy "client spaces: team edits" on seek.client_spaces
  for update to authenticated using (seek.is_team(workspace_id)) with check (seek.is_team(workspace_id));
create policy "client spaces: admins delete" on seek.client_spaces
  for delete to authenticated using (seek.is_admin(workspace_id));

create policy "client people: both sides read" on seek.client_people
  for select to authenticated using (seek.space_side(space_id) is not null);
create policy "client people: team adds" on seek.client_people
  for insert to authenticated with check (seek.space_side(space_id) = 'team' and invited_by = auth.uid());
create policy "client people: team edits" on seek.client_people
  for update to authenticated using (seek.space_side(space_id) = 'team') with check (seek.space_side(space_id) = 'team');

create policy "client team: both sides read" on seek.client_team
  for select to authenticated using (seek.space_side(space_id) is not null);
create policy "client team: team manages" on seek.client_team
  for all to authenticated using (seek.space_side(space_id) = 'team') with check (seek.space_side(space_id) = 'team');

-- clients see their own steps only; the team sees both sides. Ticking goes through complete_step().
create policy "client steps: read" on seek.client_steps
  for select to authenticated using (seek.space_side(space_id) = 'team' or (side = 'client' and seek.space_side(space_id) = 'client'));
create policy "client steps: team manages" on seek.client_steps
  for all to authenticated using (seek.space_side(space_id) = 'team') with check (seek.space_side(space_id) = 'team');

-- messages: clients only ever get Client chat; the team gets both lanes
drop policy "messages: team reads channels, members read DMs" on seek.messages;
create policy "messages: read where you belong" on seek.messages
  for select to authenticated using (
    (channel_id is not null and seek.is_team(workspace_id))
    or (dm_id is not null and seek.is_dm_member(dm_id))
    or (space_id is not null and (seek.space_side(space_id) = 'team' or (lane = 'client' and seek.space_side(space_id) = 'client')))
  );

drop policy "messages: write as yourself where you belong" on seek.messages;
create policy "messages: write as yourself where you belong" on seek.messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and (
      (channel_id is not null and exists (select 1 from seek.channels c where c.id = channel_id and seek.is_team(c.workspace_id)))
      or (dm_id is not null and seek.is_dm_member(dm_id))
      or (space_id is not null and (seek.space_side(space_id) = 'team' or (lane = 'client' and seek.client_can_write(space_id))))
    )
  );

-- profiles: people in the same client space can see each other's names (both sides)
create policy "profiles: read people in your client spaces" on seek.profiles
  for select to authenticated using (
    exists (select 1 from seek.client_people cp where cp.user_id = profiles.id and seek.space_side(cp.space_id) is not null)
    or exists (select 1 from seek.client_team ct where ct.user_id = profiles.id and seek.space_side(ct.space_id) = 'client')
  );

-- ---------------------------------------------------------------- live updates
alter publication supabase_realtime add table seek.client_spaces, seek.client_people, seek.client_steps;
