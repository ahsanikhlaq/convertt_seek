-- Seek · client invites show who invited them, and the agency's brand
--   1. client_invite_info: what the client's welcome screen shows before they are signed in (the agency's name,
--      logo and brand colour, the space, who invited them and the name the team typed for them). Only answers for
--      an email that is invited to that space, and returns display fields only.
--   2. my_client_spaces also returns the agency's brand colour (agency_accent), for the client portal.

-- ---------------------------------------------------------------- 1. the welcome screen, before sign-in
create or replace function seek.client_invite_info(p_space uuid, p_email text)
returns table (space text, project text, agency text, agency_logo text, agency_accent text, invited_by text, person_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name, s.project, w.name, w.logo_url, w.brand_accent,
         coalesce(nullif(trim(ip.name), ''), nullif(split_part(coalesce(ip.email, ''), '@', 1), ''), ''),
         p.name
  from seek.client_people p
  join seek.client_spaces s on s.id = p.space_id
  join seek.workspaces w on w.id = s.workspace_id
  left join seek.profiles ip on ip.id = p.invited_by
  where p.space_id = p_space
    and lower(p.email) = lower(trim(coalesce(p_email, '')))
    and p.removed_at is null
    and s.status <> 'closed'
  limit 1;
$$;
revoke all on function seek.client_invite_info(uuid, text) from public;
grant execute on function seek.client_invite_info(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------- 2. the client portal's accent colour
-- the return type changes, so the function is dropped and made again (same rows, one more column at the end)
drop function if exists seek.my_client_spaces();
create function seek.my_client_spaces()
returns table (space_id uuid, name text, project text, code text, color text, agency text, agency_logo text, role text, invited_by text, agency_accent text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name, s.project, s.code, s.color, w.name, w.logo_url, p.role,
         coalesce(nullif(trim(ip.name), ''), split_part(ip.email, '@', 1)),
         w.brand_accent
  from seek.client_people p
  join seek.client_spaces s on s.id = p.space_id
  join seek.workspaces w on w.id = s.workspace_id
  left join seek.profiles ip on ip.id = p.invited_by
  where p.user_id = auth.uid() and p.removed_at is null and s.status <> 'closed'
  order by p.invited_at;
$$;
revoke all on function seek.my_client_spaces() from public, anon;
grant execute on function seek.my_client_spaces() to authenticated;
