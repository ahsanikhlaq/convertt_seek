-- Seek · team fixes
-- 1. Approvals can point at what is being approved: a file or a message from the space's Client chat, or a link.
--    The reference is checked and rebuilt on the server (so the client can always open what they are asked to
--    approve, and a Team notes file can never be attached). Nobody edits it afterwards (approvals have no update policy).
-- 2. Unread messages per client space (Client chat and Team notes) for the agency's team, from the same read
--    positions as channels and DMs (seek.reads, conv 'sp:<space>:<lane>').
-- 3. Meeting messages no longer print the time in UTC: the card under them shows each viewer's own time.

-- ---------------------------------------------------------------- 1. approvals: what is being approved
alter table seek.approvals add column if not exists ref jsonb;
alter table seek.approvals drop constraint if exists approvals_ref_shape;
alter table seek.approvals add constraint approvals_ref_shape check (
  ref is null or (jsonb_typeof(ref) = 'object' and ref ->> 'kind' in ('file', 'message', 'link'))
);

-- the same checks as before, plus the optional reference
drop function if exists seek.request_approval(uuid, text, text, uuid, date, bigint);
create or replace function seek.request_approval(
  p_space uuid, p_title text, p_items text, p_approver uuid, p_due date, p_decision bigint default null, p_ref jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp seek.client_spaces;
  new_id bigint;
  v_kind text := p_ref ->> 'kind';
  clean jsonb;
  msg seek.messages;
  f jsonb;
  mid bigint;
  url text;
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

  if p_ref is not null and jsonb_typeof(p_ref) <> 'null' then
    if v_kind = 'file' then
      -- a file shared in this space's Client chat (the client can open those; Team notes files are never offered)
      select m.id, x.value into mid, f
        from seek.messages m, jsonb_array_elements(m.files) x
       where m.space_id = p_space and m.lane = 'client' and x.value ->> 'path' = p_ref ->> 'path'
       limit 1;
      if f is null then
        raise exception 'attach a file from this Client chat';
      end if;
      clean := jsonb_build_object('kind', 'file', 'path', f ->> 'path', 'name', left(coalesce(f ->> 'name', 'file'), 200),
                                  'size', case when coalesce(f ->> 'size', '') ~ '^[0-9]{1,15}$' then (f ->> 'size')::bigint else 0 end,
                                  'type', left(coalesce(f ->> 'type', ''), 100), 'message_id', mid);
    elsif v_kind = 'message' then
      if coalesce(p_ref ->> 'id', '') !~ '^[0-9]{1,18}$' then
        raise exception 'attach a message from this Client chat';
      end if;
      select * into msg from seek.messages m where m.id = (p_ref ->> 'id')::bigint and m.space_id = p_space and m.lane = 'client';
      if not found then
        raise exception 'attach a message from this Client chat';
      end if;
      clean := jsonb_build_object('kind', 'message', 'id', msg.id, 'text', left(msg.body, 200), 'at', msg.created_at);
    elsif v_kind = 'link' then
      url := trim(coalesce(p_ref ->> 'url', ''));
      if url !~* '^https://[^[:space:]]+$' or char_length(url) > 500 then
        raise exception 'links must start with https://';
      end if;
      clean := jsonb_build_object('kind', 'link', 'url', url, 'label', left(trim(coalesce(p_ref ->> 'label', '')), 120));
    else
      raise exception 'attach a file, a message or a link';
    end if;
  end if;

  insert into seek.approvals (space_id, workspace_id, title, items, decision_id, approver_id, due_on, requested_by, ref)
  values (p_space, sp.workspace_id, trim(p_title), trim(coalesce(p_items, '')), p_decision, p_approver, p_due, auth.uid(), clean)
  returning id into new_id;
  insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv)
  values (p_approver, sp.workspace_id, 'approval', auth.uid(), seek.display_name(auth.uid()) || ' asked you to approve: ' || trim(p_title),
          concat_ws(' · ', nullif(trim(coalesce(p_items, '')), ''), case when p_due is not null then 'due ' || to_char(p_due, 'Dy DD Mon') end),
          'sp:' || p_space || ':approvals');
  return new_id;
end;
$$;
revoke all on function seek.request_approval(uuid, text, text, uuid, date, bigint, jsonb) from public, anon;
grant execute on function seek.request_approval(uuid, text, text, uuid, date, bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------- 2. unread messages in client spaces (team)
-- Messages (not yours, not thread replies) in each open client space's Client chat and Team notes since you last
-- read that conversation; one you never opened counts from when you joined the workspace. Team members only.
create or replace function seek.space_unread_counts(p_ws uuid)
returns table (space_id uuid, lane text, n int)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  joined as (
    select m.joined_at from seek.workspace_members m, me
     where m.workspace_id = p_ws and m.user_id = me.id and m.role <> 'guest'
  )
  select s.id, x.lane, count(x.id)::int
  from seek.client_spaces s
  cross join me
  join seek.messages x on x.space_id = s.id and x.parent_id is null and x.user_id is distinct from me.id
  left join seek.reads r on r.user_id = me.id and r.conv = 'sp:' || s.id || ':' || x.lane
  where s.workspace_id = p_ws
    and s.status <> 'closed'
    and exists (select 1 from joined)
    and x.created_at > coalesce(r.last_read_at, (select joined_at from joined), now())
  group by s.id, x.lane;
$$;
-- Client spaces had no read positions until now: everything already in them counts as read for the team, so the
-- first day doesn't light up every client with its whole history.
insert into seek.reads (user_id, conv, last_read_at)
select m.user_id, 'sp:' || s.id || ':' || l.lane, now()
  from seek.workspace_members m
  join seek.client_spaces s on s.workspace_id = m.workspace_id
  cross join (values ('client'), ('team')) as l (lane)
 where m.role <> 'guest'
on conflict (user_id, conv) do nothing;

revoke all on function seek.space_unread_counts(uuid) from public, anon;
grant execute on function seek.space_unread_counts(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. meeting messages without a UTC time
-- Same as 20261112000012, except the plain-text line: the card shows the time in each viewer's own zone.
create or replace function seek.schedule_meeting(
  p_space uuid, p_title text, p_starts_at timestamptz, p_duration int, p_tool text, p_link text, p_agenda text,
  p_send_to_client boolean, p_record boolean, p_attendees uuid[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp seek.client_spaces;
  m seek.meetings;
  msg bigint;
  who uuid[];
begin
  select * into sp from seek.client_spaces where id = p_space;
  if not found or seek.space_side(p_space) is distinct from 'team' then
    raise exception 'only the team on this client can schedule meetings';
  end if;
  if p_starts_at < now() - interval '5 minutes' then
    raise exception 'pick a time in the future';
  end if;
  if p_link <> '' and p_link !~* '^https://' and p_tool <> 'person' then
    raise exception 'the video link must start with https://';
  end if;
  -- attendees: only this space's team and (when it is sent to them) its client people; always the organiser
  select coalesce(array_agg(distinct u), '{}') into who
    from unnest(coalesce(p_attendees, '{}') || auth.uid()) u
   where u = auth.uid()
      or exists (select 1 from seek.client_team t where t.space_id = p_space and t.user_id = u)
      or exists (select 1 from seek.workspace_members w where w.workspace_id = sp.workspace_id and w.user_id = u)
      or (p_send_to_client and exists (select 1 from seek.client_people p where p.space_id = p_space and p.user_id = u and p.removed_at is null));

  insert into seek.meetings (space_id, workspace_id, title, starts_at, duration_min, tool, link, agenda, send_to_client, record, attendees, created_by)
  values (p_space, sp.workspace_id, trim(p_title), p_starts_at, coalesce(p_duration, 30), p_tool, trim(coalesce(p_link, '')), trim(coalesce(p_agenda, '')),
          coalesce(p_send_to_client, true), coalesce(p_record, false), who, auth.uid())
  returning * into m;

  -- the MEETING card, posted as the organiser (the message trigger notifies the client people for Client chat)
  insert into seek.messages (workspace_id, space_id, lane, user_id, body, card)
  values (sp.workspace_id, p_space, case when m.send_to_client then 'client' else 'team' end, auth.uid(),
          'Meeting: ' || m.title,
          seek.meeting_card(m))
  returning id into msg;
  update seek.meetings set message_id = msg where id = m.id;
  return m.id;
end;
$$;

create or replace function seek.cancel_meeting(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m seek.meetings;
begin
  select * into m from seek.meetings where id = p_id;
  if not found or seek.space_side(m.space_id) is distinct from 'team' then
    raise exception 'only the team on this client can cancel it';
  end if;
  if m.cancelled_at is not null then
    return;
  end if;
  update seek.meetings set cancelled_at = now() where id = p_id returning * into m;
  update seek.messages set card = seek.meeting_card(m) where id = m.message_id;
  insert into seek.messages (workspace_id, space_id, lane, user_id, body)
  values (m.workspace_id, m.space_id, case when m.send_to_client then 'client' else 'team' end, auth.uid(),
          'Cancelled: ' || m.title);
end;
$$;
