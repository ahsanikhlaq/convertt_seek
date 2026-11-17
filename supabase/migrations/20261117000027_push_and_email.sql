-- Seek · notifications that reach people outside the app (sent by the seek-notify function)
--   · Each notification remembers whether it was pushed to their devices and whether it was emailed, so nothing
--     is sent twice.
--   · push_subscriptions: the browsers / phones where someone turned on notifications. Saved through
--     save_push_subscription (a device moves to whoever signs in on it), readable and removable by its owner.
--   · notify_state: when someone was last emailed (at most one email every 10 minutes) and their last daily
--     summary. Server only.
--   · server_keys: the server's own push keys, created on first use. Server only (no policies).

alter table seek.notifications
  add column pushed_at  timestamptz,
  add column emailed_at timestamptz;
-- nothing older than this is sent: notifications from before today aren't pushed or emailed now
update seek.notifications set pushed_at = coalesce(pushed_at, now()), emailed_at = coalesce(emailed_at, now());
create index notifications_to_push_idx on seek.notifications (created_at) where pushed_at is null;
create index notifications_to_email_idx on seek.notifications (created_at) where emailed_at is null and read_at is null;

create table seek.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and char_length(endpoint) < 1000),
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null check (char_length(p256dh) < 200),
  auth       text not null check (char_length(auth) < 100),
  ua         text not null default '' check (char_length(ua) < 300),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on seek.push_subscriptions (user_id);
alter table seek.push_subscriptions enable row level security;
create policy "push subscriptions: see your own" on seek.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "push subscriptions: remove your own" on seek.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- this browser now notifies whoever is signed in on it
create or replace function seek.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  insert into seek.push_subscriptions (endpoint, user_id, p256dh, auth, ua)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_ua, ''), 299))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, created_at = now();
end;
$$;
revoke all on function seek.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function seek.save_push_subscription(text, text, text, text) to authenticated;

create table seek.notify_state (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  last_email_at  timestamptz,
  last_digest_on date
);
alter table seek.notify_state enable row level security;

create table seek.server_keys (
  name  text primary key,
  value jsonb not null
);
alter table seek.server_keys enable row level security;
