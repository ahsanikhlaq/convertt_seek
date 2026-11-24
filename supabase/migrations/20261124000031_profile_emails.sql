-- Seek · teammates' emails always show on their profiles (People page)
--   Profiles keep a copy of the sign-in email. Some ended up empty (for example an account whose email arrived
--   after its profile was made), and the People page then showed "Hidden". Fill the gaps from the sign-in
--   account, and have org_people fall back to it, so the directory always has the email.

update seek.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and coalesce(trim(p.email), '') = ''
   and coalesce(u.email, '') <> '';

create or replace function seek.org_people(p_ws uuid)
returns table (user_id uuid, name text, email text, title text, role text, joined_at timestamptz, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.name, coalesce(nullif(trim(p.email), ''), u.email, '') as email, p.title, m.role::text, m.joined_at, p.status
  from seek.workspace_members m
  join seek.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.workspace_id = p_ws and m.role <> 'guest' and seek.is_member(p_ws)
  order by m.joined_at;
$$;
revoke all on function seek.org_people(uuid) from public, anon;
grant execute on function seek.org_people(uuid) to authenticated;

-- keep the copy current when someone's sign-in email changes
create or replace function seek.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and coalesce(new.email, '') <> '' then
    update seek.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists seek_sync_profile_email on auth.users;
create trigger seek_sync_profile_email
  after update of email on auth.users
  for each row execute function seek.sync_profile_email();
