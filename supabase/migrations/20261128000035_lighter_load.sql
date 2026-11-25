-- Seek · less work for the database on every message (it was at 92% CPU on the Nano plan, 25 Nov 2026)
--   1. Indexes the message trigger and the DM list were missing:
--      · notify_on_message checks "not exists (… notifications where message_id = … and user_id = …)" up to 5 times
--        per message, with no index on message_id, so each check read the whole notifications table.
--      · the DM list loads a workspace's latest messages by (workspace_id, created_at).
--      · cascade deletes of a message look up its notifications by message_id.
--   2. Tables nobody listens to live are taken out of the live-update feed (Supabase Realtime), so their changes
--      aren't checked against everyone's permissions: meetings, canvases, agent_settings, agent_log.
--      (The app subscribes only to: approvals, channel_agents, channel_members, channels, client_people,
--      client_spaces, client_steps, decisions, dm_members, messages, notifications, reactions, space_agents,
--      tasks, workspace_members.) Safe to run again.

create index if not exists notifications_message_user_idx on seek.notifications (message_id, user_id) where message_id is not null;
create index if not exists messages_ws_time_idx on seek.messages (workspace_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['meetings', 'canvases', 'agent_settings', 'agent_log'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'seek' and tablename = t) then
      execute format('alter publication supabase_realtime drop table seek.%I', t);
    end if;
  end loop;
end $$;

-- fresh planner statistics for the busiest tables
analyze seek.messages;
analyze seek.notifications;
analyze seek.reads;
