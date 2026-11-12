-- Seek · profile photos, workspace custom emoji, and your theme saved to your account
-- Photos live in the public "seek-avatars" bucket under your own user id (only you can write there). Custom emoji
-- belong to the workspace: anyone on the team adds them (64×64 PNG, up to 512 KB) and everyone in the workspace,
-- clients included, sees them. Your theme (accent, colours, light/dark) follows you to every device.

alter table seek.profiles add column avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
                          add column theme jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seek-avatars', 'seek-avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
       ('seek-emoji', 'seek-emoji', true, 524288, array['image/png', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy "seek avatars: add your own" on storage.objects
  for insert to authenticated with check (bucket_id = 'seek-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "seek avatars: remove your own" on storage.objects
  for delete to authenticated using (bucket_id = 'seek-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function seek.team_of_folder(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  begin
    ws := (string_to_array(p_path, '/'))[1]::uuid;
  exception when others then
    return false;
  end;
  return coalesce(seek.is_team(ws), false);
end;
$$;
revoke all on function seek.team_of_folder(text) from public, anon;
grant execute on function seek.team_of_folder(text) to authenticated;

create policy "seek emoji: the team adds them" on storage.objects
  for insert to authenticated with check (bucket_id = 'seek-emoji' and seek.team_of_folder(name));
create policy "seek emoji: the team removes them" on storage.objects
  for delete to authenticated using (bucket_id = 'seek-emoji' and seek.team_of_folder(name));

create table seek.custom_emoji (
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  name          text not null check (name ~ '^[a-z0-9_-]{1,32}$'),
  image_url     text not null check (image_url ~ '^https://'),
  added_by      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, name)
);
alter table seek.custom_emoji enable row level security;

create policy "custom emoji: the workspace and its clients see them" on seek.custom_emoji
  for select to authenticated using (
    seek.is_member(workspace_id)
    or exists (select 1 from seek.client_spaces s join seek.client_people p on p.space_id = s.id
               where s.workspace_id = custom_emoji.workspace_id and p.user_id = auth.uid() and p.removed_at is null)
  );
create policy "custom emoji: the team adds them" on seek.custom_emoji
  for insert to authenticated with check (seek.is_team(workspace_id) and added_by = auth.uid());
create policy "custom emoji: whoever added it, or an admin, removes it" on seek.custom_emoji
  for delete to authenticated using (added_by = auth.uid() or seek.is_admin(workspace_id));
