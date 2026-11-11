-- Seek · organization logo and shareable invite links
-- Each workspace (organization) can have a logo, and has a secret join code. Anyone with the link
-- /join?c=<code> can sign in and join as a member. Admins can reset the code to turn the old link off.

alter table seek.workspaces
  add column logo_url  text,
  add column join_code text unique default left(replace(gen_random_uuid()::text, '-', ''), 20);

update seek.workspaces set join_code = left(replace(gen_random_uuid()::text, '-', ''), 20) where join_code is null;
alter table seek.workspaces alter column join_code set not null;

-- What the join page shows before you sign in: the organization's name, logo and size. Only for a valid code.
create or replace function seek.join_info(p_code text)
returns table (name text, logo_url text, members int)
language sql
stable
security definer
set search_path = ''
as $$
  select w.name, w.logo_url,
         (select count(*)::int from seek.workspace_members m where m.workspace_id = w.id and m.role <> 'guest')
  from seek.workspaces w
  where w.join_code = p_code;
$$;

-- Joins the organization behind a link, as a member. Returns its id.
create or replace function seek.join_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select w.id into ws from seek.workspaces w where w.join_code = p_code;
  if ws is null then
    raise exception 'invite link not valid';
  end if;
  insert into seek.workspace_members (workspace_id, user_id, role)
  values (ws, auth.uid(), 'member')
  on conflict do nothing;
  return ws;
end;
$$;

-- Admins: a new link, so the old one stops working.
create or replace function seek.reset_join_code(p_ws uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text := left(replace(gen_random_uuid()::text, '-', ''), 20);
begin
  if not seek.is_admin(p_ws) then
    raise exception 'only admins can reset the invite link';
  end if;
  update seek.workspaces set join_code = code where id = p_ws;
  return code;
end;
$$;

revoke all on function seek.join_info(text) from public;
revoke all on function seek.join_by_code(text) from public, anon;
revoke all on function seek.reset_join_code(uuid) from public, anon;
grant execute on function seek.join_info(text) to anon, authenticated;
grant execute on function seek.join_by_code(text) to authenticated;
grant execute on function seek.reset_join_code(uuid) to authenticated;

-- ---------------------------------------------------------------- logos
-- Public bucket (logos show in emails and on the join page); only an organization's admins can upload,
-- replace or remove files in its folder: seek-logos/<workspace id>/…
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seek-logos', 'seek-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create or replace function seek.can_manage_logo(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folder text := split_part(object_name, '/', 1);
begin
  if folder !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return seek.is_admin(folder::uuid);
end;
$$;
grant execute on function seek.can_manage_logo(text) to authenticated;

-- logos are public anyway; uploads report back the stored file, which needs read access
create policy "seek-logos: signed-in read" on storage.objects
  for select to authenticated
  using (bucket_id = 'seek-logos');
create policy "seek-logos: admins upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'seek-logos' and seek.can_manage_logo(name));
create policy "seek-logos: admins replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'seek-logos' and seek.can_manage_logo(name))
  with check (bucket_id = 'seek-logos' and seek.can_manage_logo(name));
create policy "seek-logos: admins remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'seek-logos' and seek.can_manage_logo(name));
