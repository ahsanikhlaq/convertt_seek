-- Seek · AI agents in client spaces
--   · The Away assistant can be turned on per client space (off by default). When a client writes in Client chat and
--     nobody on that client's team is available, it replies there: what it was taught, the space's reply target, and
--     that the team will follow up. It never promises dates, prices or scope. The seek-ai function does the checks and
--     posts the reply (messages.agent = 'away_assistant', already allowed).
--   · Only the agency's team on the space can see whether it is on. Workspace admins/owners and the space's lead can
--     turn it on or off. Clients can never read or change it.
--   · The reply timer keeps counting after the assistant replies (only a person on the team stops it).

create table seek.space_agents (
  space_id  uuid not null references seek.client_spaces (id) on delete cascade,
  agent     text not null default 'away_assistant' check (agent in ('away_assistant')),
  added_by  uuid default auth.uid() references auth.users (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (space_id, agent)
);

-- workspace admins/owners, or the lead on this client (the caller only)
create or replace function seek.can_manage_space_agents(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from seek.client_spaces s
     where s.id = p_space
       and (
         seek.is_admin(s.workspace_id)
         or exists (
           select 1 from seek.client_team t
             join seek.workspace_members m on m.workspace_id = s.workspace_id and m.user_id = t.user_id and m.role <> 'guest'
            where t.space_id = s.id and t.user_id = auth.uid() and t.is_lead
         )
       )
  );
$$;
revoke all on function seek.can_manage_space_agents(uuid) from public, anon;
grant execute on function seek.can_manage_space_agents(uuid) to authenticated;

alter table seek.space_agents enable row level security;
-- clients get space_side = 'client' (or null), so none of these policies ever match for them
create policy "space agents: the team reads" on seek.space_agents
  for select to authenticated using (seek.space_side(space_id) = 'team');
create policy "space agents: admins and the lead add" on seek.space_agents
  for insert to authenticated with check (
    added_by = auth.uid() and seek.space_side(space_id) = 'team' and seek.can_manage_space_agents(space_id)
  );
create policy "space agents: admins and the lead remove" on seek.space_agents
  for delete to authenticated using (
    seek.space_side(space_id) = 'team' and seek.can_manage_space_agents(space_id)
  );
-- no update policy (and no update grant): an agent is either on (a row) or off (no row)
revoke update on seek.space_agents from authenticated;

-- the header dot and the settings switch follow changes live
alter publication supabase_realtime add table seek.space_agents;

-- ---------------------------------------------------------------- the reply timer ignores the assistant
-- An assistant's reply in Client chat is not the team replying: the client is still waiting. (Same function as in
-- 20261112000015_reply_timer.sql; only agent messages no longer count as the team's last reply.)
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
             where t.space_id = s.id and t.lane = 'client' and t.agent is null and t.user_id is not null
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
