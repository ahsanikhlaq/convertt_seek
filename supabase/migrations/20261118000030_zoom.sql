-- Seek · Zoom meetings (used by the seek-zoom function)
--   · zoom_accounts: whose Zoom account is connected, and the tokens to act on it. Server only: nobody can read
--     tokens through the API; the app asks seek-zoom whether you're connected.
--   · zoom_meetings: the Zoom meeting behind a scheduled Seek meeting, so cancelling it in Seek deletes it in Zoom.

create table if not exists seek.zoom_accounts (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         text not null default '',
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  connected_at  timestamptz not null default now()
);
alter table seek.zoom_accounts enable row level security;
revoke all on seek.zoom_accounts from anon, authenticated;

create table if not exists seek.zoom_meetings (
  meeting_id bigint primary key references seek.meetings (id) on delete cascade,
  zoom_id    text not null,
  user_id    uuid not null references auth.users (id) on delete cascade
);
alter table seek.zoom_meetings enable row level security;
revoke all on seek.zoom_meetings from anon, authenticated;
