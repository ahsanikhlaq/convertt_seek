-- Seek · reply timer
-- For each client space: since when the client has been waiting (their first Client chat message after the team's
-- last reply there), and when the team last replied. The app turns this into working hours against the space's
-- reply target. Runs as the caller, so only the team gets rows for its spaces.

create or replace function seek.space_waits(p_ws uuid)
returns table (space_id uuid, waiting_since timestamptz, last_team_reply timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with team_last as (
    select s.id as sid,
           (select max(t.created_at) from seek.messages t
             where t.space_id = s.id and t.lane = 'client'
               and not exists (select 1 from seek.client_people p where p.space_id = s.id and p.user_id = t.user_id)) as last_reply
      from seek.client_spaces s
     where s.workspace_id = p_ws and seek.space_side(s.id) = 'team'
  )
  select tl.sid,
         (select min(m.created_at) from seek.messages m
           where m.space_id = tl.sid and m.lane = 'client'
             and exists (select 1 from seek.client_people p where p.space_id = tl.sid and p.user_id = m.user_id)
             and m.created_at > coalesce(tl.last_reply, '-infinity'::timestamptz)),
         tl.last_reply
    from team_last tl;
$$;
revoke all on function seek.space_waits(uuid) from public, anon;
grant execute on function seek.space_waits(uuid) to authenticated;
