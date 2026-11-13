-- Seek · the AI assistant as a channel member
--   · Admins (and a channel's creator) add the assistant to a channel. When someone posts there and nobody else in
--     the channel is around (Away, notifications paused, or not active in the last few minutes), or they @mention
--     the assistant, it replies: answers from what it was taught, or says the team will get back to them.
--   · The assistant's messages have no person as author: messages.agent says which agent wrote them. Only the server
--     (the seek-ai function) can write them.
--   · Admins teach it in Apps → AI agents: instructions (tone, what to say) and knowledge (facts, FAQs).

-- ---------------------------------------------------------------- messages written by an agent
alter table seek.messages add column agent text check (agent is null or agent in ('away_assistant'));
alter table seek.messages alter column user_id drop not null;
alter table seek.messages add constraint messages_have_an_author check (user_id is not null or agent is not null);

-- people can't post as an agent: messages_before_insert sets user_id from the caller; only the server, which has no
-- caller, writes agent messages
create or replace function seek.messages_agent_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agent is not null and auth.uid() is not null then
    raise exception 'only Seek can post as an agent';
  end if;
  return new;
end;
$$;
drop trigger if exists seek_messages_agent_guard on seek.messages;
create trigger seek_messages_agent_guard before insert on seek.messages for each row execute function seek.messages_agent_guard();

-- ---------------------------------------------------------------- which channels the assistant is in
create table seek.channel_agents (
  channel_id uuid not null references seek.channels (id) on delete cascade,
  agent      text not null default 'away_assistant' check (agent in ('away_assistant')),
  added_by   uuid default auth.uid() references auth.users (id) on delete set null,
  added_at   timestamptz not null default now(),
  primary key (channel_id, agent)
);
alter table seek.channel_agents enable row level security;
create policy "channel agents: read where you can see the channel" on seek.channel_agents
  for select to authenticated using (seek.can_see_channel(channel_id));
create policy "channel agents: admins and the creator add" on seek.channel_agents
  for insert to authenticated with check (
    added_by = auth.uid()
    and exists (select 1 from seek.channels c where c.id = channel_id and (seek.is_admin(c.workspace_id) or c.created_by = auth.uid()))
  );
create policy "channel agents: admins and the creator remove" on seek.channel_agents
  for delete to authenticated using (
    exists (select 1 from seek.channels c where c.id = channel_id and (seek.is_admin(c.workspace_id) or c.created_by = auth.uid()))
  );
alter publication supabase_realtime add table seek.channel_agents;

-- ---------------------------------------------------------------- teaching the assistant
alter table seek.agent_settings
  add column instructions text not null default '' check (char_length(instructions) <= 4000),
  add column knowledge    text not null default '' check (char_length(knowledge) <= 20000);

-- admins only; keeps the agent's on/off and level as they are (on, "asks before acting", if it was never set)
create or replace function seek.set_agent_training(p_ws uuid, p_agent text, p_instructions text, p_knowledge text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not seek.is_admin(p_ws) then
    raise exception 'only admins can teach agents';
  end if;
  insert into seek.agent_settings (workspace_id, agent, enabled, level, instructions, knowledge, updated_by, updated_at)
  values (p_ws, p_agent, true, 'ask', left(coalesce(p_instructions, ''), 4000), left(coalesce(p_knowledge, ''), 20000), auth.uid(), now())
  on conflict (workspace_id, agent) do update
    set instructions = excluded.instructions, knowledge = excluded.knowledge, updated_by = excluded.updated_by, updated_at = now();
  insert into seek.agent_log (workspace_id, agent, action, actor_id)
  values (p_ws, p_agent, seek.display_name(auth.uid()) || ' updated what it knows', auth.uid());
end;
$$;
revoke all on function seek.set_agent_training(uuid, text, text, text) from public, anon;
grant execute on function seek.set_agent_training(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------- the assistant's replies don't notify anyone
drop trigger seek_notify_on_message on seek.messages;
create trigger seek_notify_on_message after insert on seek.messages
  for each row when (new.agent is null) execute function seek.notify_on_message();
