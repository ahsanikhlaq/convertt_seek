-- Seek · organisation identity, channel access, reactions and read state
-- 1. Organisations get a brand colour, website and "anyone at @domain can join"; the address is checked on the
--    server and created exactly as chosen (create_organisation).
-- 2. Channels can be private: only their members see them (owners and admins see every channel). Invites carry the
--    channels the new person should see.
-- 3. Reactions are saved, and each person's read position is saved so unread counts survive a reload.

-- ---------------------------------------------------------------- 1. organisation identity
alter table seek.workspaces
  add column brand_accent   text check (brand_accent ~ '^#[0-9a-fA-F]{6}$'),
  add column website        text not null default '' check (char_length(website) <= 200),
  add column allow_domain   boolean not null default false,
  add column allowed_domain text;

-- the address is free and allowed (lowercase letters and numbers, 2–40, not reserved)
create or replace function seek.slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_slug ~ '^[a-z0-9]{2,40}$'
     and p_slug not in ('www', 'app', 'admin', 'api', 'help', 'seek', 'mail', 'support', 'login', 'signup', 'join', 'status')
     and not exists (select 1 from seek.workspaces w where w.slug = p_slug);
$$;
revoke all on function seek.slug_available(text) from public;
grant execute on function seek.slug_available(text) to anon, authenticated;

-- personal email providers never get "anyone at @domain can join"
create or replace function seek.is_free_mail(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p_domain) in ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
    'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com',
    'zoho.com', 'yandex.com');
$$;

-- Creates the organisation with the exact address chosen (fails if it is taken), makes the caller its owner and
-- creates the default channels (through the existing workspace trigger).
create or replace function seek.create_organisation(
  p_name         text,
  p_slug         text,
  p_time_zone    text,
  p_team_size    text,
  p_uses         text[],
  p_accent       text,
  p_website      text,
  p_allow_domain boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id  uuid;
  domain text := (select split_part(lower(u.email), '@', 2) from auth.users u where u.id = auth.uid());
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if char_length(trim(p_name)) not between 2 and 50 then
    raise exception 'organisation name must be 2 to 50 characters';
  end if;
  if not seek.slug_available(p_slug) then
    raise exception 'address taken';
  end if;
  insert into seek.workspaces (name, slug, time_zone, team_size, uses, created_by, brand_accent, website, allow_domain, allowed_domain)
  values (trim(p_name), p_slug, coalesce(p_time_zone, 'Lahore (GMT+5)'), coalesce(p_team_size, '1–10'), coalesce(p_uses, '{}'), auth.uid(),
          p_accent, coalesce(trim(p_website), ''),
          coalesce(p_allow_domain, false) and domain <> '' and not seek.is_free_mail(domain),
          case when coalesce(p_allow_domain, false) and domain <> '' and not seek.is_free_mail(domain) then domain end)
  returning id into ws_id;
  insert into seek.workspace_members (workspace_id, user_id, role) values (ws_id, auth.uid(), 'owner');
  return ws_id;
end;
$$;
revoke all on function seek.create_organisation(text, text, text, text, text[], text, text, boolean) from public, anon;
grant execute on function seek.create_organisation(text, text, text, text, text[], text, text, boolean) to authenticated;

-- Organisations you could join: those that let anyone with your email's domain in.
create or replace function seek.joinable_orgs()
returns table (id uuid, name text, slug text, logo_url text, members int)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.slug, w.logo_url,
         (select count(*)::int from seek.workspace_members m where m.workspace_id = w.id and m.role <> 'guest')
  from seek.workspaces w
  where w.allow_domain
    and w.allowed_domain = (select split_part(lower(u.email), '@', 2) from auth.users u where u.id = auth.uid())
    and not exists (select 1 from seek.workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid());
$$;

create or replace function seek.join_by_domain(p_ws uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from seek.joinable_orgs() j where j.id = p_ws) then
    raise exception 'you can’t join this organisation with your email';
  end if;
  insert into seek.workspace_members (workspace_id, user_id, role) values (p_ws, auth.uid(), 'member') on conflict do nothing;
  return p_ws;
end;
$$;
revoke all on function seek.joinable_orgs() from public, anon;
revoke all on function seek.join_by_domain(uuid) from public, anon;
grant execute on function seek.joinable_orgs() to authenticated;
grant execute on function seek.join_by_domain(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. channel access
alter table seek.channels add column private boolean not null default false;

create table seek.channel_members (
  channel_id  uuid not null references seek.channels (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  added_by    uuid references auth.users (id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on seek.channel_members (user_id);

-- Can you see this channel? Open channels: anyone on the team. Private channels: their members, plus owners and admins.
create or replace function seek.can_see_channel(ch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from seek.channels c
    where c.id = ch
      and seek.is_team(c.workspace_id)
      and (not c.private or seek.is_admin(c.workspace_id)
           or exists (select 1 from seek.channel_members m where m.channel_id = c.id and m.user_id = auth.uid()))
  );
$$;
revoke all on function seek.can_see_channel(uuid) from public, anon;
grant execute on function seek.can_see_channel(uuid) to authenticated;

-- whoever creates a private channel is its first member
create or replace function seek.channels_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.private and new.created_by is not null then
    insert into seek.channel_members (channel_id, user_id, added_by) values (new.id, new.created_by, new.created_by) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger seek_channels_after_insert after insert on seek.channels for each row execute function seek.channels_after_insert();

-- checked on the row itself (not through can_see_channel), so a channel you just created can be returned to you
drop policy "channels: team reads" on seek.channels;
create policy "channels: read the ones you can see" on seek.channels
  for select to authenticated using (
    seek.is_team(workspace_id)
    and (not private or created_by = auth.uid() or seek.is_admin(workspace_id)
         or exists (select 1 from seek.channel_members m where m.channel_id = id and m.user_id = auth.uid()))
  );

alter table seek.channel_members enable row level security;
create policy "channel members: read where you can see the channel" on seek.channel_members
  for select to authenticated using (seek.can_see_channel(channel_id));
-- admins, the channel's creator and its members can add or remove people (only teammates of that workspace)
create policy "channel members: add" on seek.channel_members
  for insert to authenticated with check (
    added_by = auth.uid()
    and exists (
      select 1 from seek.channels c
      where c.id = channel_id
        and (seek.is_admin(c.workspace_id) or c.created_by = auth.uid()
             or exists (select 1 from seek.channel_members x where x.channel_id = c.id and x.user_id = auth.uid()))
        and exists (select 1 from seek.workspace_members w where w.workspace_id = c.workspace_id and w.user_id = channel_members.user_id and w.role <> 'guest')
    )
  );
create policy "channel members: remove" on seek.channel_members
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from seek.channels c where c.id = channel_id and (seek.is_admin(c.workspace_id) or c.created_by = auth.uid()))
  );

drop policy "messages: read where you belong" on seek.messages;
create policy "messages: read where you belong" on seek.messages
  for select to authenticated using (
    (channel_id is not null and seek.can_see_channel(channel_id))
    or (dm_id is not null and seek.is_dm_member(dm_id))
    or (space_id is not null and (seek.space_side(space_id) = 'team' or (lane = 'client' and seek.space_side(space_id) = 'client')))
  );

drop policy "messages: write as yourself where you belong" on seek.messages;
create policy "messages: write as yourself where you belong" on seek.messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and (
      (channel_id is not null and seek.can_see_channel(channel_id))
      or (dm_id is not null and seek.is_dm_member(dm_id))
      or (space_id is not null and (seek.space_side(space_id) = 'team' or (lane = 'client' and seek.client_can_write(space_id))))
    )
  );

-- invites carry the channels the new person should see; only admins may invite admins
alter table seek.workspace_invites add column channels uuid[] not null default '{}';
drop policy if exists "invites: team adds" on seek.workspace_invites;
create policy "invites: team adds" on seek.workspace_invites
  for insert to authenticated with check (
    seek.is_team(workspace_id) and invited_by = auth.uid()
    and (role = 'member' or seek.is_admin(workspace_id))
    and not exists (select 1 from unnest(channels) c where not seek.can_see_channel(c))
  );
create policy "invites: team updates its invites" on seek.workspace_invites
  for update to authenticated using (seek.is_team(workspace_id)) with check (
    seek.is_team(workspace_id) and (role = 'member' or seek.is_admin(workspace_id))
    and not exists (select 1 from unnest(channels) c where not seek.can_see_channel(c))
  );

-- When someone signs in with an invited email: join the workspace (and its chosen private channels) and their
-- client spaces.
create or replace function seek.accept_my_invites()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_email text := (select lower(u.email) from auth.users u where u.id = auth.uid());
  joined int := 0;
  inv record;
  n int;
begin
  if auth.uid() is null or my_email is null then
    return 0;
  end if;
  for inv in
    select * from seek.workspace_invites i where lower(i.email) = my_email and i.accepted_at is null
  loop
    insert into seek.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, auth.uid(), inv.role)
    on conflict do nothing;
    insert into seek.channel_members (channel_id, user_id, added_by)
    select c.id, auth.uid(), inv.invited_by from seek.channels c
    where c.id = any (inv.channels) and c.workspace_id = inv.workspace_id
    on conflict do nothing;
    update seek.workspace_invites set accepted_at = now() where id = inv.id;
    joined := joined + 1;
  end loop;
  update seek.client_people
     set user_id = auth.uid(), joined_at = coalesce(joined_at, now())
   where lower(email) = my_email and user_id is null and removed_at is null;
  get diagnostics n = row_count;
  return joined + n;
end;
$$;

-- ---------------------------------------------------------------- 3. reactions and read state
create table seek.reactions (
  message_id  bigint not null references seek.messages (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 64),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table seek.reactions enable row level security;
-- you see reactions on messages you can see (the messages policy applies inside the subquery)
create policy "reactions: read on visible messages" on seek.reactions
  for select to authenticated using (exists (select 1 from seek.messages m where m.id = message_id));
create policy "reactions: add your own" on seek.reactions
  for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from seek.messages m where m.id = message_id));
create policy "reactions: remove your own" on seek.reactions
  for delete to authenticated using (user_id = auth.uid());

-- each person's read position per conversation: 'ch:<channel>', 'dm:<thread>' or 'sp:<space>:<lane>'
create table seek.reads (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conv          text not null check (conv ~ '^(ch|dm|sp):'),
  last_read_at  timestamptz not null default now(),
  primary key (user_id, conv)
);
alter table seek.reads enable row level security;
create policy "reads: your own" on seek.reads
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Unread messages (not yours, not thread replies) in every channel and DM you can see, since you last read it.
-- A channel you never opened counts from when you joined the workspace.
create or replace function seek.unread_counts(p_ws uuid)
returns table (conv text, n int)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  joined as (select m.joined_at from seek.workspace_members m, me where m.workspace_id = p_ws and m.user_id = me.id)
  select 'ch:' || c.id, count(x.id)::int
  from seek.channels c
  cross join me
  left join seek.reads r on r.user_id = me.id and r.conv = 'ch:' || c.id
  join seek.messages x on x.channel_id = c.id and x.parent_id is null and x.user_id <> me.id
       and x.created_at > coalesce(r.last_read_at, (select joined_at from joined), now())
  where c.workspace_id = p_ws and seek.can_see_channel(c.id)
  group by c.id
  union all
  select 'dm:' || d.thread_id, count(x.id)::int
  from seek.dm_members d
  cross join me
  join seek.dm_threads t on t.id = d.thread_id and t.workspace_id = p_ws
  left join seek.reads r on r.user_id = me.id and r.conv = 'dm:' || d.thread_id
  join seek.messages x on x.dm_id = d.thread_id and x.parent_id is null and x.user_id <> me.id
       and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where d.user_id = me.id
  group by d.thread_id;
$$;
revoke all on function seek.unread_counts(uuid) from public, anon;
grant execute on function seek.unread_counts(uuid) to authenticated;

-- ---------------------------------------------------------------- live updates
alter publication supabase_realtime add table seek.reactions, seek.channel_members;

-- ---------------------------------------------------------------- domain joining and protected columns
-- "Anyone with an @company email can join": only ever the caller's own company domain, set by an admin.
create or replace function seek.set_domain_join(p_ws uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain text := (select split_part(lower(u.email), '@', 2) from auth.users u where u.id = auth.uid());
begin
  if not seek.is_admin(p_ws) then
    raise exception 'only admins can change this';
  end if;
  if p_on and (domain = '' or seek.is_free_mail(domain)) then
    raise exception 'personal email domains can’t be used';
  end if;
  update seek.workspaces set allow_domain = p_on, allowed_domain = case when p_on then domain end where id = p_ws;
  return p_on;
end;
$$;
revoke all on function seek.set_domain_join(uuid, boolean) from public, anon;
grant execute on function seek.set_domain_join(uuid, boolean) to authenticated;

-- admins edit the organisation's profile directly; the address, join code and domain go through functions
revoke update on seek.workspaces from authenticated;
grant update (name, logo_url, time_zone, team_size, uses, brand_accent, website) on seek.workspaces to authenticated;
