-- Seek · who's active, and Slack-style notification preferences
--   profiles.last_seen_at: set by the app every minute while you have Seek open (seen_now()); teammates see
--                 "Active" or "Last seen 5 min ago".
--   notify_prefs (only you can read yours; your keywords stay private):
--   level: what notifies you · 'all' every new message in your channels · 'mentions' DMs, @mentions and
--                 keywords (default) · 'nothing'. Notifications still land in 🔔 for 'nothing'; the app stays quiet.
--   threads / huddles: also notify about replies in threads you're in, and huddles in your channels.
--   keywords: words that notify you like a mention when someone uses them in a channel you can see.
--   desktop / preview / schedule: banners on or off, show the message text in them, and the
--                 days and hours you want to be notified (outside them the app stays quiet). Used by the app.
--   channel_prefs.level 'all': this channel notifies you about every new message, whatever your default.

alter table seek.profiles add column last_seen_at timestamptz;

create table seek.notify_prefs (
  user_id   uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  level     text not null default 'mentions' check (level in ('all', 'mentions', 'nothing')),
  threads   boolean not null default true,
  huddles   boolean not null default true,
  desktop   boolean not null default true,
  preview   boolean not null default true,
  keywords  text[] not null default '{}'
    check (cardinality(keywords) <= 25 and char_length(array_to_string(keywords, ',')) <= 1000),
  schedule  jsonb
    check (schedule is null or (jsonb_typeof(schedule) = 'object' and pg_column_size(schedule) < 500)),
  updated_at timestamptz not null default now()
);
alter table seek.notify_prefs enable row level security;
create policy "notify prefs: your own" on seek.notify_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table seek.channel_prefs drop constraint channel_prefs_level_check;
alter table seek.channel_prefs add constraint channel_prefs_level_check check (level in ('normal', 'all', 'digest', 'mute'));

alter table seek.notifications drop constraint notifications_kind_check;
alter table seek.notifications add constraint notifications_kind_check
  check (kind in ('dm', 'mention', 'reply', 'client', 'team', 'approval', 'task', 'reminder', 'channel', 'keyword', 'huddle'));

-- ---------------------------------------------------------------- "I'm here"
create or replace function seek.seen_now()
returns void
language sql
security definer
set search_path = ''
as $$
  update seek.profiles set last_seen_at = now() where id = auth.uid();
$$;
revoke all on function seek.seen_now() from public, anon;
grant execute on function seek.seen_now() to authenticated;

-- ---------------------------------------------------------------- your level in a channel right now
create or replace function seek.channel_level(ch uuid, uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case when p.level = 'mute' and p.muted_until is not null and p.muted_until <= now() then 'normal' else p.level end
    from seek.channel_prefs p where p.user_id = uid and p.channel_id = ch
  ), 'normal');
$$;
revoke all on function seek.channel_level(uuid, uuid) from public, anon, authenticated;

-- a keyword as a case-insensitive whole-word pattern (punctuation in it matches literally)
create or replace function seek.keyword_hit(body text, kw text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select char_length(trim(kw)) > 0
     and body ~* ('(^|[^[:alnum:]_])' || regexp_replace(trim(kw), '([^[:alnum:][:space:]])', '\\\1', 'g') || '($|[^[:alnum:]_])');
$$;
revoke all on function seek.keyword_hit(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- notifications for a new message
create or replace function seek.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who     text := (select coalesce(nullif(trim(p.name), ''), split_part(p.email, '@', 1)) from seek.profiles p where p.id = new.user_id);
  snippet text := left(regexp_replace(new.body, '\s+', ' ', 'g'), 160);
  chname  text;
  everyone boolean := new.body ~* '(^|\s)@(everyone|here)\M';
  huddle  boolean := coalesce(new.card->>'type', '') = 'huddle';
  sp      record;
begin
  -- direct messages: everyone else in the conversation
  if new.dm_id is not null then
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select m.user_id, new.workspace_id, 'dm', new.user_id, who, snippet, 'dm:' || new.dm_id, new.id
    from seek.dm_members m where m.thread_id = new.dm_id and m.user_id <> new.user_id;
    return new;
  end if;

  -- channels: each person gets at most one notification per message, the most specific one
  if new.channel_id is not null then
    chname := (select c.name from seek.channels c where c.id = new.channel_id);

    -- 1. @mentions and @everyone/@here
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select distinct u, new.workspace_id, 'mention', new.user_id, who || ' mentioned you in #' || chname, snippet, 'ch:' || new.channel_id, new.id
    from (
      select unnest(new.mentions) as u
      union
      select w.user_id from seek.workspace_members w where everyone and w.workspace_id = new.workspace_id and w.role <> 'guest'
    ) t
    where u <> new.user_id and seek.user_sees_channel(new.channel_id, u);

    -- 2. replies in threads you're in (unless you turned those off, or muted the channel)
    if new.parent_id is not null then
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select distinct x.user_id, new.workspace_id, 'reply', new.user_id, who || ' replied in a thread in #' || chname, snippet, 'ch:' || new.channel_id, new.id
      from seek.messages x
      left join seek.notify_prefs pr on pr.user_id = x.user_id
      where (x.id = new.parent_id or x.parent_id = new.parent_id)
        and x.user_id <> new.user_id
        and coalesce(pr.threads, true)
        and seek.user_sees_channel(new.channel_id, x.user_id)
        and seek.channel_level(new.channel_id, x.user_id) <> 'mute'
        and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = x.user_id);
    end if;

    -- 3. huddles that start in the channel
    if huddle then
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select w.user_id, new.workspace_id, 'huddle', new.user_id, who || ' started a huddle in #' || chname, 'Join from the channel', 'ch:' || new.channel_id, new.id
      from seek.workspace_members w
      left join seek.notify_prefs pr on pr.user_id = w.user_id
      where w.workspace_id = new.workspace_id and w.role <> 'guest' and w.user_id <> new.user_id
        and coalesce(pr.huddles, true)
        and seek.user_sees_channel(new.channel_id, w.user_id)
        and seek.channel_level(new.channel_id, w.user_id) <> 'mute'
        and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = w.user_id);
      return new;
    end if;

    -- 4. your keywords (in new posts, and in threads you're in)
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select w.user_id, new.workspace_id, 'keyword', new.user_id, who || ' used one of your keywords in #' || chname, snippet, 'ch:' || new.channel_id, new.id
    from seek.workspace_members w
    join seek.notify_prefs pr on pr.user_id = w.user_id and cardinality(pr.keywords) > 0
    where w.workspace_id = new.workspace_id and w.role <> 'guest' and w.user_id <> new.user_id
      and exists (select 1 from unnest(pr.keywords) k where seek.keyword_hit(new.body, k))
      and seek.user_sees_channel(new.channel_id, w.user_id)
      and seek.channel_level(new.channel_id, w.user_id) <> 'mute'
      and (new.parent_id is null or exists (select 1 from seek.messages x where (x.id = new.parent_id or x.parent_id = new.parent_id) and x.user_id = w.user_id))
      and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = w.user_id);

    -- 5. every new post, for people who want everything (by default, or in this channel)
    if new.parent_id is null then
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select w.user_id, new.workspace_id, 'channel', new.user_id, who || ' in #' || chname, snippet, 'ch:' || new.channel_id, new.id
      from seek.workspace_members w
      left join seek.notify_prefs pr on pr.user_id = w.user_id
      where w.workspace_id = new.workspace_id and w.role <> 'guest' and w.user_id <> new.user_id
        and (seek.channel_level(new.channel_id, w.user_id) = 'all'
             or (pr.level = 'all' and seek.channel_level(new.channel_id, w.user_id) = 'normal'))
        and seek.user_sees_channel(new.channel_id, w.user_id)
        and not exists (select 1 from seek.notifications n where n.message_id = new.id and n.user_id = w.user_id);
    end if;
    return new;
  end if;

  -- client spaces
  if new.space_id is not null then
    select s.name into sp from seek.client_spaces s where s.id = new.space_id;
    if new.lane = 'client' and exists (select 1 from seek.client_people p where p.space_id = new.space_id and p.user_id = new.user_id and p.removed_at is null) then
      -- a client wrote: the team on this client hears about it
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select t.user_id, new.workspace_id, 'client', new.user_id, who || ' (' || sp.name || ')', snippet, 'sp:' || new.space_id || ':client', new.id
      from seek.client_team t where t.space_id = new.space_id and t.user_id <> new.user_id;
    elsif new.lane = 'client' then
      -- the team replied in Client chat: the client people hear about it
      insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
      select p.user_id, new.workspace_id, 'team', new.user_id, who || ' replied in ' || sp.name, snippet, 'sp:' || new.space_id || ':client', new.id
      from seek.client_people p where p.space_id = new.space_id and p.user_id is not null and p.removed_at is null and p.user_id <> new.user_id;
    end if;
    -- mentions in either lane (Team notes mentions only ever reach the team)
    insert into seek.notifications (user_id, workspace_id, kind, actor_id, title, body, conv, message_id)
    select distinct u, new.workspace_id, 'mention', new.user_id, who || ' mentioned you in ' || sp.name, snippet, 'sp:' || new.space_id || ':' || new.lane, new.id
    from unnest(new.mentions) u
    where u <> new.user_id
      and (exists (select 1 from seek.workspace_members w where w.workspace_id = new.workspace_id and w.user_id = u and w.role <> 'guest')
           or (new.lane = 'client' and exists (select 1 from seek.client_people p where p.space_id = new.space_id and p.user_id = u and p.removed_at is null)));
  end if;
  return new;
end;
$$;
