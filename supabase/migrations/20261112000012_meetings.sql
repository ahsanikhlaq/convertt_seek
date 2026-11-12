-- Seek · meetings with clients
-- The team schedules a call in a client space: title, time, length, video tool and link, agenda, attendees (the
-- space's teammates and client people). Scheduling posts a MEETING card: in Client chat when the invite goes to the
-- client (who is then notified like any team reply), otherwise in Team notes. Clients only ever see meetings that
-- were sent to them. Cancelling posts a short note in the same place.

-- a message can carry a card (meeting cards today); the feed renders it
alter table seek.messages add column card jsonb;

create table seek.meetings (
  id              bigint generated always as identity primary key,
  space_id        uuid not null references seek.client_spaces (id) on delete cascade,
  workspace_id    uuid not null references seek.workspaces (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  starts_at       timestamptz not null,
  duration_min    int not null default 30 check (duration_min between 10 and 480),
  tool            text not null check (tool in ('meet', 'zoom', 'seek', 'person')),
  link            text not null default '' check (char_length(link) <= 500),
  agenda          text not null default '' check (char_length(agenda) <= 2000),
  send_to_client  boolean not null default true,
  record          boolean not null default false,
  attendees       uuid[] not null default '{}',
  created_by      uuid not null references auth.users (id),
  message_id      bigint references seek.messages (id) on delete set null,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index meetings_space_idx on seek.meetings (space_id, starts_at);
alter table seek.meetings enable row level security;

create policy "meetings: the team, and clients for the ones sent to them" on seek.meetings
  for select to authenticated using (
    seek.space_side(space_id) = 'team' or (send_to_client and seek.space_side(space_id) = 'client')
  );

create or replace function seek.meeting_card(m seek.meetings)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('type', 'meeting', 'id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'duration', m.duration_min,
                            'tool', m.tool, 'link', m.link, 'agenda', m.agenda, 'record', m.record, 'cancelled', m.cancelled_at is not null);
$$;

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
          'Meeting: ' || m.title || ' · ' || to_char(m.starts_at at time zone 'UTC', 'Dy DD Mon HH24:MI') || ' UTC',
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
          'Cancelled: ' || m.title || ' (' || to_char(m.starts_at at time zone 'UTC', 'Dy DD Mon HH24:MI') || ' UTC)');
end;
$$;

revoke all on function seek.schedule_meeting(uuid, text, timestamptz, int, text, text, text, boolean, boolean, uuid[]) from public, anon;
revoke all on function seek.cancel_meeting(bigint) from public, anon;
grant execute on function seek.schedule_meeting(uuid, text, timestamptz, int, text, text, text, boolean, boolean, uuid[]) to authenticated;
grant execute on function seek.cancel_meeting(bigint) to authenticated;

alter publication supabase_realtime add table seek.meetings;
