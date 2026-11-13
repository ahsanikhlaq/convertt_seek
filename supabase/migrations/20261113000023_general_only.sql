-- Seek · new workspaces start with #general only (no #announcements or #random); teams add their own channels.
create or replace function seek.add_default_channels(ws uuid, who uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into seek.channels (workspace_id, name, description, created_by) values
    (ws, 'general', 'Everyone in the workspace', who)
  on conflict (workspace_id, name) do nothing;
$$;
revoke all on function seek.add_default_channels(uuid, uuid) from public, anon, authenticated;
