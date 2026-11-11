-- Seek · phase 2b: direct messages
-- One-to-one conversations between teammates in the same workspace. They reuse seek.messages (a message now
-- belongs to either a channel or a DM), so sending, threads and live updates work the same way. Only the two
-- people in a DM can ever read it — not admins, not other teammates.

-- ---------------------------------------------------------------- conversations
create table seek.dm_threads (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  created_at    timestamptz not null default now()
);

create table seek.dm_members (
  thread_id  uuid not null references seek.dm_threads (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  primary key (thread_id, user_id)
);
create index dm_members_user_idx on seek.dm_members (user_id);

create or replace function seek.is_dm_member(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from seek.dm_members m where m.thread_id = t and m.user_id = auth.uid());
$$;

-- Finds the DM between you and a teammate, or starts one. Both of you must be on the team of a shared workspace.
create or replace function seek.open_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  t  uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_other is null or p_other = auth.uid() then
    raise exception 'pick someone else to message';
  end if;

  select a.workspace_id into ws
  from seek.workspace_members a
  join seek.workspace_members b on b.workspace_id = a.workspace_id
  where a.user_id = auth.uid() and b.user_id = p_other and a.role <> 'guest' and b.role <> 'guest'
  order by a.joined_at
  limit 1;
  if ws is null then
    raise exception 'you can only message people in your workspace';
  end if;

  select d.id into t
  from seek.dm_threads d
  where d.workspace_id = ws
    and exists (select 1 from seek.dm_members m where m.thread_id = d.id and m.user_id = auth.uid())
    and exists (select 1 from seek.dm_members m where m.thread_id = d.id and m.user_id = p_other)
    and (select count(*) from seek.dm_members m where m.thread_id = d.id) = 2
  limit 1;

  if t is null then
    insert into seek.dm_threads (workspace_id) values (ws) returning id into t;
    insert into seek.dm_members (thread_id, user_id) values (t, auth.uid()), (t, p_other);
  end if;
  return t;
end;
$$;
revoke all on function seek.open_dm(uuid) from public, anon;
grant execute on function seek.open_dm(uuid) to authenticated;

-- ---------------------------------------------------------------- messages: a channel or a DM
alter table seek.messages alter column channel_id drop not null;
alter table seek.messages add column dm_id uuid references seek.dm_threads (id) on delete cascade;
alter table seek.messages add constraint messages_in_one_place check ((channel_id is null) <> (dm_id is null));
create index messages_dm_time_idx on seek.messages (dm_id, created_at) where dm_id is not null;

create or replace function seek.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel_id is not null then
    new.workspace_id := (select c.workspace_id from seek.channels c where c.id = new.channel_id);
  else
    new.workspace_id := (select d.workspace_id from seek.dm_threads d where d.id = new.dm_id);
  end if;
  new.user_id := auth.uid();
  if new.parent_id is not null and not exists (
    select 1 from seek.messages p
    where p.id = new.parent_id and p.parent_id is null
      and p.channel_id is not distinct from new.channel_id and p.dm_id is not distinct from new.dm_id
  ) then
    raise exception 'a reply must belong to a message in the same conversation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- row-level security
alter table seek.dm_threads enable row level security;
alter table seek.dm_members enable row level security;

-- conversations are created only through open_dm(); people see the ones they are in
create policy "dm threads: members read" on seek.dm_threads
  for select to authenticated using (seek.is_dm_member(id));
create policy "dm members: members read" on seek.dm_members
  for select to authenticated using (seek.is_dm_member(thread_id));

drop policy "messages: team reads" on seek.messages;
create policy "messages: team reads channels, members read DMs" on seek.messages
  for select to authenticated using (
    (channel_id is not null and seek.is_team(workspace_id))
    or (dm_id is not null and seek.is_dm_member(dm_id))
  );

drop policy "messages: team writes as themselves" on seek.messages;
create policy "messages: write as yourself where you belong" on seek.messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and (
      (channel_id is not null and exists (select 1 from seek.channels c where c.id = channel_id and seek.is_team(c.workspace_id)))
      or (dm_id is not null and seek.is_dm_member(dm_id))
    )
  );

-- admins may tidy channels, but never other people's DMs
drop policy "messages: authors or admins delete" on seek.messages;
create policy "messages: authors delete, admins delete in channels" on seek.messages
  for delete to authenticated using (user_id = auth.uid() or (channel_id is not null and seek.is_admin(workspace_id)));

-- ---------------------------------------------------------------- live updates
-- new DMs started with you appear straight away (messages are already published)
alter publication supabase_realtime add table seek.dm_members;
