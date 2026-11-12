-- Seek · editing messages and Send later
-- Editing: authors may change only the text of their own message (not where it lives, its files, pins or cards),
-- and the database stamps edited_at. Send later: a message waits in seek.scheduled_messages until its time; the
-- author's app delivers due ones every minute while Seek is open on any of their devices (and on the next start
-- otherwise). Delivery re-checks that the author may still write there.

-- ---------------------------------------------------------------- editing: the text only
revoke update on seek.messages from authenticated;
grant update (body) on seek.messages to authenticated;

create or replace function seek.messages_before_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;
create trigger seek_messages_before_edit before update on seek.messages for each row execute function seek.messages_before_edit();

-- ---------------------------------------------------------------- send later
create table seek.scheduled_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel_id  uuid references seek.channels (id) on delete cascade,
  dm_id       uuid references seek.dm_threads (id) on delete cascade,
  space_id    uuid references seek.client_spaces (id) on delete cascade,
  lane        text check (lane in ('client', 'team')),
  body        text not null check (char_length(body) between 1 and 8000),
  mentions    uuid[] not null default '{}',
  send_at     timestamptz not null,
  sent_at     timestamptz,
  message_id  bigint references seek.messages (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint scheduled_in_one_place check (num_nonnulls(channel_id, dm_id, space_id) = 1),
  constraint scheduled_lane_only_in_spaces check ((space_id is null) = (lane is null))
);
create index scheduled_due_idx on seek.scheduled_messages (user_id, send_at) where sent_at is null;
alter table seek.scheduled_messages enable row level security;

-- can the caller write a message here right now? (the same rule as writing a message)
create or replace function seek.can_write_to(p_channel uuid, p_dm uuid, p_space uuid, p_lane text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_channel is not null then coalesce(seek.can_see_channel(p_channel), false)
      and exists (select 1 from seek.channels c where c.id = p_channel and seek.is_team(c.workspace_id))
    when p_dm is not null then coalesce(seek.is_dm_member(p_dm), false)
    when p_space is not null then seek.space_side(p_space) = 'team' or (p_lane = 'client' and coalesce(seek.client_can_write(p_space), false))
    else false
  end;
$$;
revoke all on function seek.can_write_to(uuid, uuid, uuid, text) from public, anon;
grant execute on function seek.can_write_to(uuid, uuid, uuid, text) to authenticated;

create policy "scheduled: your own" on seek.scheduled_messages for select to authenticated using (user_id = auth.uid());
create policy "scheduled: where you can write" on seek.scheduled_messages for insert to authenticated
  with check (user_id = auth.uid() and send_at > now() and seek.can_write_to(channel_id, dm_id, space_id, lane));
create policy "scheduled: cancel your own" on seek.scheduled_messages for delete to authenticated using (user_id = auth.uid() and sent_at is null);

-- Sends your due scheduled messages (as you, through the normal insert, so notifications fire as usual).
create or replace function seek.send_my_scheduled()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s seek.scheduled_messages;
  msg bigint;
  n int := 0;
begin
  for s in
    select * from seek.scheduled_messages
     where user_id = auth.uid() and sent_at is null and send_at <= now()
     order by send_at
     for update skip locked
  loop
    if seek.can_write_to(s.channel_id, s.dm_id, s.space_id, s.lane) then
      insert into seek.messages (channel_id, dm_id, space_id, lane, user_id, body, mentions)
      values (s.channel_id, s.dm_id, s.space_id, s.lane, s.user_id, s.body, s.mentions)
      returning id into msg;
      update seek.scheduled_messages set sent_at = now(), message_id = msg where id = s.id;
      n := n + 1;
    else
      -- you lost access: drop it instead of retrying forever
      update seek.scheduled_messages set sent_at = now() where id = s.id;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function seek.send_my_scheduled() from public, anon;
grant execute on function seek.send_my_scheduled() to authenticated;
