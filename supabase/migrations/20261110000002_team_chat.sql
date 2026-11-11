-- Seek · phase 2: team chat
-- Channels and messages (with thread replies), saved in the database and pushed live to everyone in the
-- workspace through Supabase Realtime. Clients (guests) are kept out of team channels; their own space comes in
-- phase 3.

-- ---------------------------------------------------------------- helpers
-- A teammate: any member of the workspace except a client guest.
create or replace function seek.is_team(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from seek.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role <> 'guest'
  );
$$;

-- ---------------------------------------------------------------- channels
create table seek.channels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  name          text not null check (name ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  description   text not null default '',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, name)
);

-- ---------------------------------------------------------------- messages
create table seek.messages (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  channel_id    uuid not null references seek.channels (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id     bigint references seek.messages (id) on delete cascade, -- set for thread replies
  body          text not null check (char_length(body) between 1 and 8000),
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index messages_channel_time_idx on seek.messages (channel_id, created_at);
create index messages_parent_idx on seek.messages (parent_id) where parent_id is not null;

-- A message always belongs to its channel's workspace and is always sent as the signed-in person.
create or replace function seek.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.workspace_id := (select c.workspace_id from seek.channels c where c.id = new.channel_id);
  new.user_id := auth.uid();
  if new.parent_id is not null and not exists (
    select 1 from seek.messages p where p.id = new.parent_id and p.channel_id = new.channel_id and p.parent_id is null
  ) then
    raise exception 'a reply must belong to a message in the same channel';
  end if;
  return new;
end;
$$;

create trigger messages_before_insert
  before insert on seek.messages
  for each row execute function seek.messages_before_insert();

-- ---------------------------------------------------------------- default channels
-- New workspaces start with #general, #announcements and #random.
create or replace function seek.add_default_channels(ws uuid, who uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into seek.channels (workspace_id, name, description, created_by) values
    (ws, 'general', 'Everyone in the workspace', who),
    (ws, 'announcements', 'Team news', who),
    (ws, 'random', 'Off-topic', who)
  on conflict (workspace_id, name) do nothing;
$$;
revoke all on function seek.add_default_channels(uuid, uuid) from public, anon, authenticated;

create or replace function seek.workspaces_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform seek.add_default_channels(new.id, new.created_by);
  return new;
end;
$$;

create trigger workspaces_after_insert
  after insert on seek.workspaces
  for each row execute function seek.workspaces_after_insert();

-- workspaces created before this migration get their channels too
select seek.add_default_channels(w.id, w.created_by) from seek.workspaces w;

-- ---------------------------------------------------------------- row-level security
alter table seek.channels enable row level security;
alter table seek.messages enable row level security;

create policy "channels: team reads" on seek.channels
  for select to authenticated using (seek.is_team(workspace_id));
create policy "channels: team creates" on seek.channels
  for insert to authenticated with check (seek.is_team(workspace_id) and created_by = auth.uid());
create policy "channels: creator or admin edits" on seek.channels
  for update to authenticated using (created_by = auth.uid() or seek.is_admin(workspace_id))
  with check (created_by = auth.uid() or seek.is_admin(workspace_id));
create policy "channels: admins delete" on seek.channels
  for delete to authenticated using (seek.is_admin(workspace_id));

create policy "messages: team reads" on seek.messages
  for select to authenticated using (seek.is_team(workspace_id));
create policy "messages: team writes as themselves" on seek.messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from seek.channels c where c.id = channel_id and seek.is_team(c.workspace_id))
  );
create policy "messages: authors edit" on seek.messages
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "messages: authors or admins delete" on seek.messages
  for delete to authenticated using (user_id = auth.uid() or seek.is_admin(workspace_id));

-- ---------------------------------------------------------------- invites: any teammate may invite
drop policy if exists "invites: admins add" on seek.workspace_invites;
create policy "invites: team adds" on seek.workspace_invites
  for insert to authenticated with check (seek.is_team(workspace_id) and invited_by = auth.uid());
drop policy if exists "invites: admins read" on seek.workspace_invites;
create policy "invites: team reads" on seek.workspace_invites
  for select to authenticated using (seek.is_team(workspace_id));

-- ---------------------------------------------------------------- live updates
-- Realtime only delivers rows the receiving person is allowed to read (the policies above).
alter publication supabase_realtime add table seek.messages, seek.channels, seek.workspace_members;
