-- Seek · channel membership for every channel, like Slack
--   · Every channel has members. Public channels: anyone on the team can find and join them (Browse channels) and
--     leave them again. Private channels: members add people. Admins and the channel's creator remove people.
--   · #general: everyone on the team is always in it (added when they join the team); nobody can leave it or be
--     removed from it while they're on the team, and it can't be deleted.
--   · Admins delete channels (#general excepted).
--   · People already on a team keep every public channel they have now (they're made members of all of them).
--   · "Every new post", keyword and huddle notifications reach a channel's members only; @mentions still reach anyone
--     on the team who can see the channel.

-- ---------------------------------------------------------------- 1. today's public channels: everyone is a member
insert into seek.channel_members (channel_id, user_id, added_by)
select c.id, w.user_id, c.created_by
from seek.channels c
join seek.workspace_members w on w.workspace_id = c.workspace_id and w.role <> 'guest'
where not c.private
on conflict do nothing;

-- ---------------------------------------------------------------- 2. a channel's creator is its first member
create or replace function seek.channels_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into seek.channel_members (channel_id, user_id, added_by) values (new.id, new.created_by, new.created_by) on conflict do nothing;
  end if;
  -- #general: the whole team
  if new.name = 'general' and not new.private then
    insert into seek.channel_members (channel_id, user_id, added_by)
    select new.id, w.user_id, new.created_by from seek.workspace_members w where w.workspace_id = new.workspace_id and w.role <> 'guest'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- 3. joining the team puts you in #general; leaving it takes you out of its channels
create or replace function seek.team_member_channels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.role <> 'guest' then
      insert into seek.channel_members (channel_id, user_id, added_by)
      select c.id, new.user_id, new.user_id from seek.channels c where c.workspace_id = new.workspace_id and c.name = 'general'
      on conflict do nothing;
    end if;
    return new;
  end if;
  delete from seek.channel_members m using seek.channels c
  where m.channel_id = c.id and c.workspace_id = old.workspace_id and m.user_id = old.user_id;
  return old;
end;
$$;
drop trigger if exists seek_team_member_channels on seek.workspace_members;
create trigger seek_team_member_channels after insert or delete on seek.workspace_members
  for each row execute function seek.team_member_channels();

-- ---------------------------------------------------------------- 4. #general stays: no leaving it, no deleting it
create or replace function seek.protect_general_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from seek.channels c
    join seek.workspace_members w on w.workspace_id = c.workspace_id and w.user_id = old.user_id and w.role <> 'guest'
    where c.id = old.channel_id and c.name = 'general' and not c.private
  ) then
    raise exception 'Everyone on the team is in #general';
  end if;
  return old;
end;
$$;
drop trigger if exists seek_protect_general_member on seek.channel_members;
create trigger seek_protect_general_member before delete on seek.channel_members
  for each row execute function seek.protect_general_member();

create or replace function seek.protect_general_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- deleting the whole workspace still works (its row is gone by then)
  if old.name = 'general' and exists (select 1 from seek.workspaces w where w.id = old.workspace_id) then
    raise exception '#general can’t be deleted';
  end if;
  return old;
end;
$$;
drop trigger if exists seek_protect_general_channel on seek.channels;
create trigger seek_protect_general_channel before delete on seek.channels
  for each row execute function seek.protect_general_channel();

-- ---------------------------------------------------------------- 5. who may add people to a channel
-- you can join a public channel yourself; admins, the creator and members add others (teammates only)
drop policy "channel members: add" on seek.channel_members;
create policy "channel members: add" on seek.channel_members
  for insert to authenticated with check (
    added_by = auth.uid()
    and exists (
      select 1 from seek.channels c
      where c.id = channel_id
        and seek.is_team(c.workspace_id)
        and ((not c.private and channel_members.user_id = auth.uid())
             or seek.is_admin(c.workspace_id) or c.created_by = auth.uid()
             or exists (select 1 from seek.channel_members x where x.channel_id = c.id and x.user_id = auth.uid()))
        and exists (select 1 from seek.workspace_members w where w.workspace_id = c.workspace_id and w.user_id = channel_members.user_id and w.role <> 'guest')
    )
  );

-- ---------------------------------------------------------------- 6. notifications follow membership
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
  huddle  boolean := coalesce(new.card->>'type', '') = 'huddle';
  sp      record;
begin
  -- direct messages: everyone else in the conversation
  if new.dm_id is not null then
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select m.user_id, new.workspace_id, 'dm', new.user_id, who, snippet, 'dm:' || new.dm_id, new.id
    from seek.dm_members m where m.thread_id = new.dm_id and m.user_id <> new.user_id;
    return new;
  end if;

  -- channels: each person gets at most one notification per message, the most specific one
  if new.channel_id is not null then
    chname := (select c.name from seek.channels c where c.id = new.channel_id);

    -- 1. @mentions and @everyone/@here
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select distinct u, new.workspace_id, 'mention', new.user_id, who || ' mentioned you in #' || chname, snippet, 'ch:' || new.channel_id, new.id
    from (
      select unnest(new.mentions) as u
      union
      select w.user_id from seek.workspace_members w where everyone and w.workspace_id = new.workspace_id and w.role <> 'guest'
    ) t
    where u <> new.user_id and seek.user_sees_channel(new.channel_id, u);

    -- 2. replies in threads you're in (unless you turned those off, or muted the channel)
    if new.parent_id is not null then
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select distinct x.user_id, new.workspace_id, 'reply', new.user_id, who || ' replied in a thread in #' || chname, snippet, 'ch:' || new.channel_id, new.id
      from seek.messages x
      left join seek.notify_prefs pr on pr.user_id = x.user_id
      where (x.id = new.parent_id or x.parent_id = new.parent_id)
        and x.user_id <> new.user_id
        and coalesce(pr.threads, true)
        and seek.user_sees_channel(new.channel_id, x.user_id)
        and seek.channel_level(new.channel_id, x.user_id) <> 'mute'
        and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = x.user_id);
    end if;

    -- 3. huddles that start in the channel
    if huddle then
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select w.user_id, new.workspace_id, 'huddle', new.user_id, who || ' started a huddle in #' || chname, 'Join from the channel', 'ch:' || new.channel_id, new.id
      from seek.workspace_members w
      left join seek.notify_prefs pr on pr.user_id = w.user_id
      where w.workspace_id = new.workspace_id and w.role <> 'guest' and w.user_id <> new.user_id
        and coalesce(pr.huddles, true)
        and seek.user_sees_channel(new.channel_id, w.user_id)
        and exists (select 1 from seek.channel_members cm where cm.channel_id = new.channel_id and cm.user_id = w.user_id)
        and seek.channel_level(new.channel_id, w.user_id) <> 'mute'
        and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = w.user_id);
      return new;
    end if;

    -- 4. your keywords (in new posts, and in threads you're in)
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select w.user_id, new.workspace_id, 'keyword', new.user_id, who || ' used one of your keywords in #' || chname, snippet, 'ch:' || new.channel_id, new.id
    from seek.workspace_members w
    join seek.notify_prefs pr on pr.user_id = w.user_id and cardinality(pr.keywords) > 0
    where w.workspace_id = new.workspace_id and w.role <> 'guest' and w.user_id <> new.user_id
      and exists (select 1 from unnest(pr.keywords) k where seek.keyword_hit(new.body, k))
      and seek.user_sees_channel(new.channel_id, w.user_id)
      and exists (select 1 from seek.channel_members cm where cm.channel_id = new.channel_id and cm.user_id = w.user_id)
      and seek.channel_level(new.channel_id, w.user_id) <> 'mute'
      and (new.parent_id is null or exists (select 1 from seek.messages x where (x.id = new.parent_id or x.parent_id = new.parent_id) and x.user_id = w.user_id))
      and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = w.user_id);

    -- 5. every new post, for people who want everything (by default, or in this channel)
    if new.parent_id is null then
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select w.user_id, new.workspace_id, 'channel', new.user_id, who || ' in #' || chname, snippet, 'ch:' || new.channel_id, new.id
      from seek.workspace_members w
      left join seek.notify_prefs pr on pr.user_id = w.user_id
      where w.workspace_id = new.workspace_id and w.role <> 'guest' and w.user_id <> new.user_id
        and (seek.channel_level(new.channel_id, w.user_id) = 'all'
             or (pr.level = 'all' and seek.channel_level(new.channel_id, w.user_id) = 'normal'))
        and seek.user_sees_channel(new.channel_id, w.user_id)
        and exists (select 1 from seek.channel_members cm where cm.channel_id = new.channel_id and cm.user_id = w.user_id)
        and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = w.user_id);
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
