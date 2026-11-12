-- Seek · decisions
-- Anything agreed can be logged as a decision from its message: who, when, where, and the source message. Editing
-- never overwrites: it adds a new decision that replaces the old one, and the old one stays in the history. A
-- decision is visible to exactly the people who can see the conversation it came from (so a decision logged in
-- Client chat is visible to the client; one from Team notes or a channel never is).

create table seek.decisions (
  id                 bigint generated always as identity primary key,
  workspace_id       uuid not null references seek.workspaces (id) on delete cascade,
  text               text not null check (char_length(text) between 1 and 300),
  kind               text not null default 'decision' check (kind in ('decision', 'approval')),
  channel_id         uuid references seek.channels (id) on delete cascade,
  dm_id              uuid references seek.dm_threads (id) on delete cascade,
  space_id           uuid references seek.client_spaces (id) on delete cascade,
  lane               text check (lane in ('client', 'team')),
  source_message_id  bigint references seek.messages (id) on delete set null,
  logged_by          uuid not null default auth.uid() references auth.users (id),
  replaces_id        bigint references seek.decisions (id) on delete set null,
  replaced_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint decisions_in_one_place check (num_nonnulls(channel_id, dm_id, space_id) = 1),
  constraint decisions_lane_only_in_spaces check ((space_id is null) = (lane is null))
);
create index decisions_ws_idx on seek.decisions (workspace_id, created_at desc);
create index decisions_source_idx on seek.decisions (source_message_id);

-- A decision logged from a message takes its place from that message (the insert policy then checks you can see
-- it). The workspace always follows the conversation, and the author is always the caller.
create or replace function seek.decisions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m seek.messages;
begin
  if new.source_message_id is not null then
    select * into m from seek.messages where id = new.source_message_id;
    if not found then
      raise exception 'message not found';
    end if;
    new.channel_id := m.channel_id;
    new.dm_id := m.dm_id;
    new.space_id := m.space_id;
    new.lane := m.lane;
  end if;
  if new.channel_id is not null then
    new.workspace_id := (select c.workspace_id from seek.channels c where c.id = new.channel_id);
  elsif new.dm_id is not null then
    new.workspace_id := (select d.workspace_id from seek.dm_threads d where d.id = new.dm_id);
  else
    new.workspace_id := (select s.workspace_id from seek.client_spaces s where s.id = new.space_id);
  end if;
  new.logged_by := auth.uid();
  new.replaced_at := null;
  return new;
end;
$$;
create trigger seek_decisions_before_insert before insert on seek.decisions for each row execute function seek.decisions_before_insert();

alter table seek.decisions enable row level security;

create policy "decisions: read where you can see the conversation" on seek.decisions
  for select to authenticated using (
    (channel_id is not null and seek.can_see_channel(channel_id))
    or (dm_id is not null and seek.is_dm_member(dm_id))
    or (space_id is not null and (seek.space_side(space_id) = 'team' or (lane = 'client' and seek.space_side(space_id) = 'client')))
  );
-- the team logs decisions (clients see the ones from their Client chat)
create policy "decisions: the team logs them" on seek.decisions
  for insert to authenticated with check (
    (channel_id is not null and seek.can_see_channel(channel_id))
    or (dm_id is not null and seek.is_dm_member(dm_id))
    or (space_id is not null and seek.space_side(space_id) = 'team')
  );
-- undo: the person who logged it can remove it (only while nothing replaced it)
create policy "decisions: undo your own" on seek.decisions
  for delete to authenticated using (logged_by = auth.uid() and replaced_at is null);

-- undoing an edit brings the earlier version back
create or replace function seek.decisions_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.replaces_id is not null then
    update seek.decisions set replaced_at = null where id = old.replaces_id;
  end if;
  return old;
end;
$$;
create trigger seek_decisions_after_delete after delete on seek.decisions for each row execute function seek.decisions_after_delete();

-- Edit = replace: a new decision in the same place, and the old one marked as replaced (history kept).
create or replace function seek.replace_decision(p_id bigint, p_text text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev seek.decisions;
  new_id bigint;
  team boolean;
begin
  select * into prev from seek.decisions where id = p_id;
  if not found or prev.replaced_at is not null then
    raise exception 'decision not found or already replaced';
  end if;
  team := case
    when prev.channel_id is not null then seek.can_see_channel(prev.channel_id)
    when prev.dm_id is not null then seek.is_dm_member(prev.dm_id)
    else seek.space_side(prev.space_id) = 'team'
  end;
  if not coalesce(team, false) then
    raise exception 'you can’t edit this decision';
  end if;
  insert into seek.decisions (text, kind, channel_id, dm_id, space_id, lane, source_message_id, replaces_id)
  values (trim(p_text), prev.kind, prev.channel_id, prev.dm_id, prev.space_id, prev.lane, prev.source_message_id, prev.id)
  returning id into new_id;
  update seek.decisions set replaced_at = now() where id = prev.id;
  return new_id;
end;
$$;
revoke all on function seek.replace_decision(bigint, text) from public, anon;
grant execute on function seek.replace_decision(bigint, text) to authenticated;

-- The log with readable places and names. Runs as the caller, so it only returns decisions (and labels) the
-- caller may see. Pass the organisation, or null for everything you can see (a client's view of their spaces).
create or replace function seek.decision_log(p_ws uuid)
returns table (
  id bigint, text text, kind text, channel_id uuid, channel_name text, dm_id uuid, dm_with_id uuid, dm_with text,
  space_id uuid, space_name text, space_code text, lane text, source_message_id bigint,
  logged_by uuid, logged_by_name text, replaces_id bigint, replaced_at timestamptz, created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id, d.text, d.kind, d.channel_id, c.name, d.dm_id, o.user_id, coalesce(nullif(op.name, ''), split_part(op.email, '@', 1)),
         d.space_id, s.name, s.code, d.lane, d.source_message_id,
         d.logged_by, coalesce(nullif(lp.name, ''), split_part(lp.email, '@', 1)), d.replaces_id, d.replaced_at, d.created_at
    from seek.decisions d
    left join seek.channels c on c.id = d.channel_id
    left join seek.client_spaces s on s.id = d.space_id
    left join seek.profiles lp on lp.id = d.logged_by
    left join lateral (select dm.user_id from seek.dm_members dm where dm.thread_id = d.dm_id and dm.user_id <> auth.uid() limit 1) o on true
    left join seek.profiles op on op.id = o.user_id
   where p_ws is null or d.workspace_id = p_ws
   order by d.created_at desc
   limit 500;
$$;
revoke all on function seek.decision_log(uuid) from public, anon;
grant execute on function seek.decision_log(uuid) to authenticated;

alter publication supabase_realtime add table seek.decisions;
