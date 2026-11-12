-- Seek · formal approvals and files
-- Approvals: the team asks a client approver to sign off something exact ("Hero B · desktop v4 + mobile v1") by a
-- date. Only that approver can answer: Approve (logged as an approval decision, visible to the client) or Request
-- changes (with a note). The team can nudge once a day. Everyone involved is notified in Seek.
-- Files: attached to messages and stored in the private "seek-files" bucket under the conversation they belong to
-- (ch/<channel>/…, dm/<thread>/…, sp/<space>/<lane>/…). Storage only serves a file to people who can see that
-- conversation, so a client can never open a Team notes file.

-- ---------------------------------------------------------------- notifications can be about approvals
alter table seek.notifications drop constraint notifications_kind_check;
alter table seek.notifications add constraint notifications_kind_check check (kind in ('dm', 'mention', 'reply', 'client', 'team', 'approval'));

-- ---------------------------------------------------------------- approvals
create table seek.approvals (
  id              bigint generated always as identity primary key,
  space_id        uuid not null references seek.client_spaces (id) on delete cascade,
  workspace_id    uuid not null references seek.workspaces (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  items           text not null default '' check (char_length(items) <= 500),
  decision_id     bigint references seek.decisions (id) on delete set null,
  approver_id     uuid not null references auth.users (id) on delete cascade,
  due_on          date,
  status          text not null default 'requested' check (status in ('requested', 'approved', 'changes')),
  note            text not null default '' check (char_length(note) <= 1000),
  requested_by    uuid not null references auth.users (id),
  requested_at    timestamptz not null default now(),
  responded_at    timestamptz,
  last_nudged_at  timestamptz,
  created_at      timestamptz not null default now()
);
create index approvals_space_idx on seek.approvals (space_id, created_at desc);
alter table seek.approvals enable row level security;

-- the team and the client people of the space see its approvals; all changes go through the functions below
create policy "approvals: the space reads them" on seek.approvals
  for select to authenticated using (seek.space_side(space_id) is not null);
create policy "approvals: the team withdraws open ones" on seek.approvals
  for delete to authenticated using (seek.space_side(space_id) = 'team' and status <> 'approved');

create or replace function seek.display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select coalesce(nullif(p.name, ''), split_part(p.email, '@', 1)) from seek.profiles p where p.id = uid), 'Someone');
$$;

-- an approval decision is the client's sign-off: nobody undoes or rewrites it
drop policy "decisions: undo your own" on seek.decisions;
create policy "decisions: undo your own" on seek.decisions
  for delete to authenticated using (logged_by = auth.uid() and replaced_at is null and kind = 'decision');

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
  if prev.kind = 'approval' then
    raise exception 'a client approval can’t be edited';
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
revoke all on function seek.display_name(uuid) from public, anon;
grant execute on function seek.display_name(uuid) to authenticated;

-- The team asks a client approver for sign-off (optionally on a decision logged in Client chat).
create or replace function seek.request_approval(p_space uuid, p_title text, p_items text, p_approver uuid, p_due date, p_decision bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp seek.client_spaces;
  new_id bigint;
begin
  select * into sp from seek.client_spaces where id = p_space;
  if not found or seek.space_side(p_space) is distinct from 'team' then
    raise exception 'only the team on this client can request approvals';
  end if;
  if not exists (select 1 from seek.client_people p where p.space_id = p_space and p.user_id = p_approver and p.role = 'approver' and p.removed_at is null) then
    raise exception 'pick an approver who has joined this space';
  end if;
  if p_decision is not null and not exists (select 1 from seek.decisions d where d.id = p_decision and d.space_id = p_space and d.lane = 'client') then
    raise exception 'that decision isn’t from this Client chat';
  end if;
  insert into seek.approvals (space_id, workspace_id, title, items, decision_id, approver_id, due_on, requested_by)
  values (p_space, sp.workspace_id, trim(p_title), trim(coalesce(p_items, '')), p_decision, p_approver, p_due, auth.uid())
  returning id into new_id;
  insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv)
  values (p_approver, sp.workspace_id, 'approval', auth.uid(), seek.display_name(auth.uid()) || ' asked you to approve: ' || trim(p_title),
          concat_ws(' · ', nullif(trim(coalesce(p_items, '')), ''), case when p_due is not null then 'due ' || to_char(p_due, 'Dy DD Mon') end),
          'sp:' || p_space || ':approvals');
  return new_id;
end;
$$;

-- Only the named approver answers. Approving logs an approval decision in the client's log.
create or replace function seek.respond_approval(p_id bigint, p_approve boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a seek.approvals;
  who text;
begin
  select * into a from seek.approvals where id = p_id;
  if not found or a.approver_id <> auth.uid()
     or not exists (select 1 from seek.client_people p where p.space_id = a.space_id and p.user_id = auth.uid() and p.role = 'approver' and p.removed_at is null) then
    raise exception 'only the approver can answer this';
  end if;
  if a.status <> 'requested' then
    raise exception 'this approval was already answered';
  end if;
  if not p_approve and char_length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'say what should change';
  end if;
  who := seek.display_name(auth.uid());
  update seek.approvals
     set status = case when p_approve then 'approved' else 'changes' end,
         note = trim(coalesce(p_note, '')),
         responded_at = now()
   where id = p_id;
  if p_approve then
    insert into seek.decisions (text, kind, space_id, lane, replaces_id)
    values (left(a.title || case when a.items <> '' then ' (' || a.items || ')' else '' end || ' approved', 300), 'approval', a.space_id, 'client', null);
  end if;
  insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv)
  select t.user_id, a.workspace_id, 'approval', auth.uid(),
         who || case when p_approve then ' approved: ' else ' asked for changes: ' end || a.title,
         case when p_approve then 'Logged as a decision' else trim(p_note) end,
         'sp:' || a.space_id || ':approvals'
    from seek.client_team t where t.space_id = a.space_id
  union
  select a.requested_by, a.workspace_id, 'approval', auth.uid(),
         who || case when p_approve then ' approved: ' else ' asked for changes: ' end || a.title,
         case when p_approve then 'Logged as a decision' else trim(p_note) end,
         'sp:' || a.space_id || ':approvals';
end;
$$;

-- After changes were made, the team asks again (same approval, fresh due date).
create or replace function seek.rerequest_approval(p_id bigint, p_items text, p_due date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a seek.approvals;
begin
  select * into a from seek.approvals where id = p_id;
  if not found or seek.space_side(a.space_id) is distinct from 'team' then
    raise exception 'only the team on this client can do this';
  end if;
  if a.status <> 'changes' then
    raise exception 'only approvals with requested changes can be sent again';
  end if;
  update seek.approvals
     set status = 'requested', items = trim(coalesce(p_items, a.items)), due_on = p_due, note = '', requested_at = now(), responded_at = null, last_nudged_at = null
   where id = p_id;
  insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv)
  values (a.approver_id, a.workspace_id, 'approval', auth.uid(), seek.display_name(auth.uid()) || ' updated it and asked again: ' || a.title,
          concat_ws(' · ', nullif(trim(coalesce(p_items, a.items)), ''), case when p_due is not null then 'due ' || to_char(p_due, 'Dy DD Mon') end),
          'sp:' || a.space_id || ':approvals');
end;
$$;

-- A reminder to the approver, at most once a day.
create or replace function seek.nudge_approval(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a seek.approvals;
begin
  select * into a from seek.approvals where id = p_id;
  if not found or seek.space_side(a.space_id) is distinct from 'team' then
    raise exception 'only the team on this client can nudge';
  end if;
  if a.status <> 'requested' then
    raise exception 'this approval isn’t waiting';
  end if;
  if a.last_nudged_at is not null and a.last_nudged_at > now() - interval '24 hours' then
    raise exception 'already nudged in the last 24 hours';
  end if;
  update seek.approvals set last_nudged_at = now() where id = p_id;
  insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv)
  values (a.approver_id, a.workspace_id, 'approval', auth.uid(), 'Reminder: please approve ' || a.title,
          case when a.due_on is not null then 'Due ' || to_char(a.due_on, 'Dy DD Mon') else 'Waiting for your answer' end,
          'sp:' || a.space_id || ':approvals');
end;
$$;

revoke all on function seek.request_approval(uuid, text, text, uuid, date, bigint) from public, anon;
revoke all on function seek.respond_approval(bigint, boolean, text) from public, anon;
revoke all on function seek.rerequest_approval(bigint, text, date) from public, anon;
revoke all on function seek.nudge_approval(bigint) from public, anon;
grant execute on function seek.request_approval(uuid, text, text, uuid, date, bigint) to authenticated;
grant execute on function seek.respond_approval(bigint, boolean, text) to authenticated;
grant execute on function seek.rerequest_approval(bigint, text, date) to authenticated;
grant execute on function seek.nudge_approval(bigint) to authenticated;

alter publication supabase_realtime add table seek.approvals;

-- ---------------------------------------------------------------- files
alter table seek.messages add column files jsonb not null default '[]' check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 10);

insert into storage.buckets (id, name, public, file_size_limit)
values ('seek-files', 'seek-files', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = 104857600;

-- can the caller open (p_write: add) a file at this path?
create or replace function seek.file_access(p_path text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  part text[] := string_to_array(p_path, '/');
  id uuid;
begin
  begin
    id := part[2]::uuid;
  exception when others then
    return false;
  end;
  return case part[1]
    when 'ch' then coalesce(seek.can_see_channel(id), false)
    when 'dm' then coalesce(seek.is_dm_member(id), false)
    when 'sp' then case
      when seek.space_side(id) = 'team' then part[3] in ('client', 'team')
      when part[3] = 'client' and seek.space_side(id) = 'client' then (not p_write or seek.client_can_write(id))
      else false
    end
    else false
  end;
end;
$$;
revoke all on function seek.file_access(text, boolean) from public, anon;
grant execute on function seek.file_access(text, boolean) to authenticated;

create policy "seek files: open where you can see the conversation" on storage.objects
  for select to authenticated using (bucket_id = 'seek-files' and seek.file_access(name, false));
create policy "seek files: add where you can write" on storage.objects
  for insert to authenticated with check (bucket_id = 'seek-files' and seek.file_access(name, true));
create policy "seek files: remove your own" on storage.objects
  for delete to authenticated using (bucket_id = 'seek-files' and owner_id = auth.uid()::text);
