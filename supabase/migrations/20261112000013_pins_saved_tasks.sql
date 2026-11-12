-- Seek · pins, saved messages, tasks, reminders and channel canvases
-- Pins: anyone who can see a conversation pins a message for everyone in it (in a client space only the team pins).
-- Saved: your own bookmarks. Tasks: the team turns a message into a task with an owner and a due date; tasks are
-- team-only (clients never see them). Reminders: "remind me about this message" — when due, the app turns them into
-- notifications. Canvas: one shared page per channel (its brief, owners, key dates).

-- ---------------------------------------------------------------- can the caller see this message?
create or replace function seek.message_visible(p_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.channel_id is not null then seek.can_see_channel(m.channel_id)
      when m.dm_id is not null then seek.is_dm_member(m.dm_id)
      else seek.space_side(m.space_id) = 'team' or (m.lane = 'client' and seek.space_side(m.space_id) = 'client')
    end
    from seek.messages m where m.id = p_id), false);
$$;
revoke all on function seek.message_visible(bigint) from public, anon;
grant execute on function seek.message_visible(bigint) to authenticated;

-- ---------------------------------------------------------------- pins
alter table seek.messages add column pinned_at timestamptz, add column pinned_by uuid references auth.users (id) on delete set null;

create or replace function seek.pin_message(p_id bigint, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m seek.messages;
begin
  select * into m from seek.messages where id = p_id;
  if not found or not seek.message_visible(p_id) or (m.space_id is not null and seek.space_side(m.space_id) <> 'team') then
    raise exception 'you can’t pin this message';
  end if;
  update seek.messages
     set pinned_at = case when p_on then coalesce(pinned_at, now()) end,
         pinned_by = case when p_on then coalesce(pinned_by, auth.uid()) end
   where id = p_id;
end;
$$;
revoke all on function seek.pin_message(bigint, boolean) from public, anon;
grant execute on function seek.pin_message(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------- saved
create table seek.saved (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id  bigint not null references seek.messages (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table seek.saved enable row level security;
create policy "saved: your own" on seek.saved for select to authenticated using (user_id = auth.uid());
create policy "saved: save what you can see" on seek.saved for insert to authenticated
  with check (user_id = auth.uid() and seek.message_visible(message_id));
create policy "saved: unsave your own" on seek.saved for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- tasks (team only)
create table seek.tasks (
  id                 bigint generated always as identity primary key,
  workspace_id       uuid not null references seek.workspaces (id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 200),
  owner_id           uuid not null references auth.users (id) on delete cascade,
  due_on             date,
  source_message_id  bigint references seek.messages (id) on delete set null,
  status             text not null default 'open' check (status in ('open', 'done')),
  created_by         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at         timestamptz not null default now(),
  done_at            timestamptz
);
create index tasks_ws_idx on seek.tasks (workspace_id, status, due_on);
create index tasks_source_idx on seek.tasks (source_message_id);
alter table seek.tasks enable row level security;

create or replace function seek.tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.source_message_id is not null then
      if not seek.message_visible(new.source_message_id) then
        raise exception 'you can’t see that message';
      end if;
      new.workspace_id := (select m.workspace_id from seek.messages m where m.id = new.source_message_id);
    end if;
  else
    new.workspace_id := old.workspace_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if not exists (select 1 from seek.workspace_members w where w.workspace_id = new.workspace_id and w.user_id = new.owner_id) then
    raise exception 'the owner must be on the team';
  end if;
  new.done_at := case when new.status = 'done' then coalesce(new.done_at, now()) end;
  return new;
end;
$$;
create trigger seek_tasks_before_write before insert or update on seek.tasks for each row execute function seek.tasks_before_write();

create policy "tasks: the team reads them" on seek.tasks for select to authenticated using (seek.is_team(workspace_id));
create policy "tasks: the team adds them" on seek.tasks for insert to authenticated with check (seek.is_team(workspace_id));
create policy "tasks: the team updates them" on seek.tasks for update to authenticated using (seek.is_team(workspace_id)) with check (seek.is_team(workspace_id));
create policy "tasks: the creator or owner deletes" on seek.tasks for delete to authenticated using (created_by = auth.uid() or owner_id = auth.uid());

-- ---------------------------------------------------------------- reminders
create table seek.reminders (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_id  bigint references seek.messages (id) on delete cascade,
  task_id     bigint references seek.tasks (id) on delete cascade,
  remind_at   timestamptz not null,
  fired_at    timestamptz,
  created_at  timestamptz not null default now()
);
create index reminders_due_idx on seek.reminders (user_id, remind_at) where fired_at is null;
alter table seek.reminders enable row level security;
create policy "reminders: your own" on seek.reminders for select to authenticated using (user_id = auth.uid());
create policy "reminders: about what you can see" on seek.reminders for insert to authenticated
  with check (user_id = auth.uid() and (message_id is null or seek.message_visible(message_id))
              and (task_id is null or exists (select 1 from seek.tasks t where t.id = task_id)));
create policy "reminders: cancel your own" on seek.reminders for delete to authenticated using (user_id = auth.uid());

-- notifications can be tasks and reminders now
alter table seek.notifications drop constraint notifications_kind_check;
alter table seek.notifications add constraint notifications_kind_check check (kind in ('dm', 'mention', 'reply', 'client', 'team', 'approval', 'task', 'reminder'));

-- tell a task's new owner
create or replace function seek.notify_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv text;
begin
  if new.owner_id = auth.uid() or (tg_op = 'UPDATE' and new.owner_id = old.owner_id) then
    return new;
  end if;
  select case when m.channel_id is not null then 'ch:' || m.channel_id when m.dm_id is not null then 'dm:' || m.dm_id else 'sp:' || m.space_id || ':' || m.lane end
    into conv from seek.messages m where m.id = new.source_message_id;
  insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
  values (new.owner_id, new.workspace_id, 'task', auth.uid(), seek.display_name(auth.uid()) || ' gave you a task',
          new.title || case when new.due_on is not null then ' · due ' || to_char(new.due_on, 'Dy DD Mon') else '' end,
          coalesce(conv, 'tasks'), new.source_message_id);
  return new;
end;
$$;
create trigger seek_notify_on_task after insert or update of owner_id on seek.tasks for each row execute function seek.notify_on_task();

-- Turns your due reminders into notifications (the app calls this every minute while it's open, and on start).
create or replace function seek.fire_my_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  with due as (
    update seek.reminders set fired_at = now()
     where user_id = auth.uid() and fired_at is null and remind_at <= now()
    returning *
  )
  insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
  select d.user_id,
         coalesce(m.workspace_id, t.workspace_id),
         'reminder', m.user_id,
         case when t.id is not null then 'Reminder: ' || t.title else 'Reminder: a message from ' || seek.display_name(m.user_id) end,
         left(coalesce(m.body, ''), 140),
         coalesce(case when m.channel_id is not null then 'ch:' || m.channel_id when m.dm_id is not null then 'dm:' || m.dm_id when m.space_id is not null then 'sp:' || m.space_id || ':' || m.lane end, 'tasks'),
         m.id
    from due d
    left join seek.messages m on m.id = coalesce(d.message_id, (select tt.source_message_id from seek.tasks tt where tt.id = d.task_id))
    left join seek.tasks t on t.id = d.task_id
   where m.id is null or seek.message_visible(m.id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function seek.fire_my_reminders() from public, anon;
grant execute on function seek.fire_my_reminders() to authenticated;

-- ---------------------------------------------------------------- channel canvas
create table seek.canvases (
  channel_id  uuid primary key references seek.channels (id) on delete cascade,
  body        text not null default '' check (char_length(body) <= 20000),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table seek.canvases enable row level security;
create policy "canvas: the channel reads it" on seek.canvases for select to authenticated using (seek.can_see_channel(channel_id));
create policy "canvas: the channel writes it" on seek.canvases for insert to authenticated with check (seek.can_see_channel(channel_id) and updated_by = auth.uid());
create policy "canvas: the channel edits it" on seek.canvases for update to authenticated using (seek.can_see_channel(channel_id)) with check (seek.can_see_channel(channel_id) and updated_by = auth.uid());

alter publication supabase_realtime add table seek.tasks, seek.canvases;
