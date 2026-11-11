-- Seek · phase 2c: profile set-up and invite emails
-- Everyone sets up their profile (name, title, time zone) once, the first time they sign in. Invites are sent by
-- the seek-invite edge function (supabase/functions/seek-invite), which emails a "join" link; the welcome screen
-- then shows who invited you and to which workspace.

alter table seek.profiles
  add column time_zone    text not null default '',
  add column onboarded_at timestamptz;

-- The newest invite addressed to you: which workspace, and who sent it. Only ever reveals invites to your own email.
create or replace function seek.my_invite()
returns table (workspace text, invited_by text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name,
         coalesce(nullif(trim(p.name), ''), split_part(p.email, '@', 1))
  from seek.workspace_invites i
  join seek.workspaces w on w.id = i.workspace_id
  left join seek.profiles p on p.id = i.invited_by
  where lower(i.email) = (select lower(u.email) from auth.users u where u.id = auth.uid())
  order by i.created_at desc
  limit 1;
$$;
revoke all on function seek.my_invite() from public, anon;
grant execute on function seek.my_invite() to authenticated;
