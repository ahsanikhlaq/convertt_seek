-- Seek · AI agent settings, Pause all AI, and the agent log
-- Admins switch each agent on or off and set its permission level; Pause all AI stops every agent for everyone.
-- Every change (and, once agents run, every action) is written to the agent log with who, what, where and sources.
-- Agents that can reach clients (Away assistant, Status drafter) can never be set to "Acts": a person always
-- approves what reaches a client. The agents themselves run later on the server (they need the AI connection).

alter table seek.workspaces
  add column ai_paused boolean not null default false,
  add column ai_paused_by uuid references auth.users (id) on delete set null,
  add column ai_paused_at timestamptz;

create table seek.agent_settings (
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  agent         text not null check (agent in ('summariser', 'task_suggester', 'away_assistant', 'scope_guard', 'retainer_watch', 'status_drafter')),
  enabled       boolean not null,
  level         text not null check (level in ('suggest', 'ask', 'act')),
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, agent),
  constraint client_agents_never_act check (agent not in ('away_assistant', 'status_drafter') or level <> 'act')
);
alter table seek.agent_settings enable row level security;
create policy "agent settings: the team reads them" on seek.agent_settings for select to authenticated using (seek.is_team(workspace_id));

create table seek.agent_log (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  agent         text not null,
  at            timestamptz not null default now(),
  action        text not null,
  conv          text,
  sources       jsonb not null default '[]',
  actor_id      uuid references auth.users (id) on delete set null
);
create index agent_log_ws_idx on seek.agent_log (workspace_id, at desc);
alter table seek.agent_log enable row level security;
create policy "agent log: the team reads it" on seek.agent_log for select to authenticated using (seek.is_team(workspace_id));

-- admins only: switch an agent and set its level
create or replace function seek.set_agent(p_ws uuid, p_agent text, p_enabled boolean, p_level text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not seek.is_admin(p_ws) then
    raise exception 'only admins can change agents';
  end if;
  insert into seek.agent_settings (workspace_id, agent, enabled, level, updated_by, updated_at)
  values (p_ws, p_agent, p_enabled, p_level, auth.uid(), now())
  on conflict (workspace_id, agent) do update set enabled = excluded.enabled, level = excluded.level, updated_by = excluded.updated_by, updated_at = now();
  insert into seek.agent_log (workspace_id, agent, action, actor_id)
  values (p_ws, p_agent, seek.display_name(auth.uid()) || case when p_enabled then ' turned it on' else ' turned it off' end
          || ' · ' || case p_level when 'suggest' then 'Suggest only' when 'ask' then 'Asks before acting' else 'Acts' end, auth.uid());
end;
$$;

-- admins only: pause (or resume) every agent at once, for everyone
create or replace function seek.set_ai_paused(p_ws uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not seek.is_admin(p_ws) then
    raise exception 'only admins can pause AI';
  end if;
  update seek.workspaces
     set ai_paused = p_paused, ai_paused_by = case when p_paused then auth.uid() end, ai_paused_at = case when p_paused then now() end
   where id = p_ws;
  insert into seek.agent_log (workspace_id, agent, action, actor_id)
  values (p_ws, 'all', seek.display_name(auth.uid()) || case when p_paused then ' paused all AI' else ' resumed AI' end, auth.uid());
end;
$$;

revoke all on function seek.set_agent(uuid, text, boolean, text) from public, anon;
revoke all on function seek.set_ai_paused(uuid, boolean) from public, anon;
grant execute on function seek.set_agent(uuid, text, boolean, text) to authenticated;
grant execute on function seek.set_ai_paused(uuid, boolean) to authenticated;

alter publication supabase_realtime add table seek.agent_settings, seek.agent_log;
