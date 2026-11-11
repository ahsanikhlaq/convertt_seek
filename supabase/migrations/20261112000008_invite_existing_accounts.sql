-- Seek · invites to people who already have an account
-- The invite function (service role only) looks up an existing account by email, so it can send that person an
-- invite email (not a bare sign-in code) with a Join link to the organisation.
create or replace function seek.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email) limit 1;
$$;
revoke all on function seek.user_id_by_email(text) from public, anon, authenticated;
grant execute on function seek.user_id_by_email(text) to service_role;
