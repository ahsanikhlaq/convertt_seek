-- Seek · notifications, channel notification levels, status, and workspace people settings
-- Notifications are written by the database when a message arrives, so nobody can fake or miss one:
--   DMs → the other people in the DM · @mentions and @everyone/@here → those people (if they can see the channel)
--   thread replies → the thread's author and everyone who replied · client messages → the team on that client,
--   and the team's Client chat replies → the client people. Muted channels only notify mentions.

-- ---------------------------------------------------------------- status and pause
alter table seek.profiles
  add column status       text not null default 'on' check (status in ('on', 'mt', 'fc', 'aw')),
  add column status_text  text not null default '' check (char_length(status_text) <= 80),
  add column dnd_until    timestamptz;

-- ---------------------------------------------------------------- mentions on messages
alter table seek.messages add column mentions uuid[] not null default '{}';

-- ---------------------------------------------------------------- channel notification level
create table seek.channel_prefs (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel_id  uuid not null references seek.channels (id) on delete cascade,
  level       text not null default 'normal' check (level in ('normal', 'digest', 'mute')),
  muted_until timestamptz,
  primary key (user_id, channel_id)
);
alter table seek.channel_prefs enable row level security;
create policy "channel prefs: your own" on seek.channel_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- notifications
create table seek.notifications (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  workspace_id  uuid references seek.workspaces (id) on delete cascade,
  kind          text not null check (kind in ('dm', 'mention', 'reply', 'client', 'team')),
  actor_id      uuid references auth.users (id) on delete set null,
  title         text not null,
  body          text not null default '',
  conv          text not null,          -- where it happened: 'ch:<id>', 'dm:<id>' or 'sp:<id>:<lane>'
  message_id    bigint references seek.messages (id) on delete cascade,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index notifications_user_idx on seek.notifications (user_id, created_at desc);
alter table seek.notifications enable row level security;
create policy "notifications: read your own" on seek.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications: mark your own read" on seek.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: clear your own" on seek.notifications
  for delete to authenticated using (user_id = auth.uid());

-- can this person (not the caller) see the channel?
create or replace function seek.user_sees_channel(ch uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from seek.channels c
    join seek.workspace_members w on w.workspace_id = c.workspace_id and w.user_id = uid and w.role <> 'guest'
    where c.id = ch
      and (not c.private or w.role in ('owner', 'admin')
           or exists (select 1 from seek.channel_members m where m.channel_id = c.id and m.user_id = uid))
  );
$$;
revoke all on function seek.user_sees_channel(uuid, uuid) from public, anon, authenticated;

create or replace function seek.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who     text := (select coalesce(nullif(trim(p.name), ''), split_part(p.email, '@', 1)) from seek.profiles p where p.id = new.user_id);
  snippet text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 160);
  chname  text;
  everyone boolean := new.body ~* '(^|\s)@(everyone|here)\M';
  sp      record;
begin
  -- direct messages: everyone else in the conversation
  if new.dm_id is not null then
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select m.user_id, new.workspace_id, 'dm', new.user_id, who, snippet, 'dm:' || new.dm_id, new.id
    from seek.dm_members m where m.thread_id = new.dm_id and m.user_id <> new.user_id;
    return new;
  end if;

  -- channels: mentions (and @everyone/@here), then thread replies
  if new.channel_id is not null then
    chname := (select c.name from seek.channels c where c.id = new.channel_id);
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select distinct u, new.workspace_id, 'mention', new.user_id, who || ' mentioned you in #' || chname, snippet, 'ch:' || new.channel_id, new.id
    from (
      select unnest(new.mentions) as u
      union
      select w.user_id from seek.workspace_members w where everyone and w.workspace_id = new.workspace_id and w.role <> 'guest'
    ) t
    where u <> new.user_id and seek.user_sees_channel(new.channel_id, u);

    if new.parent_id is not null then
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select distinct x.user_id, new.workspace_id, 'reply', new.user_id, who || ' replied in a thread in #' || chname, snippet, 'ch:' || new.channel_id, new.id
      from seek.messages x
      where (x.id = new.parent_id or x.parent_id = new.parent_id)
        and x.user_id <> new.user_id
        and not (x.user_id = any (new.mentions)) and not everyone
        and seek.user_sees_channel(new.channel_id, x.user_id)
        and not exists (select 1 from seek.channel_prefs p where p.user_id = x.user_id and p.channel_id = new.channel_id
                        and p.level = 'mute' and (p.muted_until is null or p.muted_until > now()));
    end if;
    return new;
  end if;

  -- client spaces
  if new.space_id is not null then
    select s.name into sp from seek.client_spaces s where s.id = new.space_id;
    if new.lane = 'client' and exists (select 1 from seek.client_people p where p.space_id = new.space_id and p.user_id = new.user_id and p.removed_at is null) then
      -- a client wrote: the team on this client hears about it
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select t.user_id, new.workspace_id, 'client', new.user_id, who || ' (' || sp.name || ')', snippet, 'sp:' || new.space_id || ':client', new.id
      from seek.client_team t where t.space_id = new.space_id and t.user_id <> new.user_id;
    elsif new.lane = 'client' then
      -- the team replied in Client chat: the client people hear about it
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select p.user_id, new.workspace_id, 'team', new.user_id, who || ' replied in ' || sp.name, snippet, 'sp:' || new.space_id || ':client', new.id
      from seek.client_people p where p.space_id = new.space_id and p.user_id is not null and p.removed_at is null and p.user_id <> new.user_id;
    end if;
    -- mentions in either lane (Team notes mentions only ever reach the team)
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select distinct u, new.workspace_id, 'mention', new.user_id, who || ' mentioned you in ' || sp.name, snippet, 'sp:' || new.space_id || ':' || new.lane, new.id
    from unnest(new.mentions) u
    where u <> new.user_id
      and (exists (select 1 from seek.workspace_members w where w.workspace_id = new.workspace_id and w.user_id = u and w.role <> 'guest')
           or (new.lane = 'client' and exists (select 1 from seek.client_people p where p.space_id = new.space_id and p.user_id = u and p.removed_at is null)));
  end if;
  return new;
end;
$$;

create trigger seek_notify_on_message after insert on seek.messages for each row execute function seek.notify_on_message();

-- ---------------------------------------------------------------- workspace people (admins)
-- Everyone in the organisation with their role and when they joined, plus pending invites (admins only).
create or replace function seek.org_people(p_ws uuid)
returns table (user_id uuid, name text, email text, title text, role text, joined_at timestamptz, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.name, p.email, p.title, m.role::text, m.joined_at, p.status
  from seek.workspace_members m join seek.profiles p on p.id = m.user_id
  where m.workspace_id = p_ws and m.role <> 'guest' and seek.is_member(p_ws)
  order by m.joined_at;
$$;
revoke all on function seek.org_people(uuid) from public, anon;
grant execute on function seek.org_people(uuid) to authenticated;

-- Admins change a teammate's role (never the owner's, and nobody can make a second owner).
create or replace function seek.set_member_role(p_ws uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not seek.is_admin(p_ws) then
    raise exception 'only admins can change roles';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'role must be admin or member';
  end if;
  if exists (select 1 from seek.workspace_members m where m.workspace_id = p_ws and m.user_id = p_user and m.role = 'owner') then
    raise exception 'the owner’s role can’t be changed';
  end if;
  update seek.workspace_members set role = p_role::seek.member_role where workspace_id = p_ws and user_id = p_user;
end;
$$;
revoke all on function seek.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function seek.set_member_role(uuid, uuid, text) to authenticated;

-- the owner can never be removed (the existing policy lets admins remove members)
create or replace function seek.protect_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- (deleting the whole workspace or the owner's account still works: then the parent row is already gone)
  if old.role = 'owner'
     and exists (select 1 from seek.workspaces w where w.id = old.workspace_id)
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'the owner can’t be removed';
  end if;
  return old;
end;
$$;
create trigger seek_protect_owner before delete on seek.workspace_members for each row execute function seek.protect_owner();

-- ---------------------------------------------------------------- live updates
alter publication supabase_realtime add table seek.notifications;
