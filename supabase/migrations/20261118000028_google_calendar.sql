-- Seek · Google Calendar and Google Meet (used by the seek-google function)
--   · google_accounts: whose Google Calendar is connected, and the token to act on it. Server only: nobody can read
--     tokens through the API; the app asks seek-google whether you're connected.
--   · google_events: the Calendar event behind a scheduled meeting, so cancelling the meeting cancels the event
--     (and its invitations). Server only.

create table if not exists seek.google_accounts (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         text not null default '',
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  connected_at  timestamptz not null default now()
);
alter table seek.google_accounts enable row level security;

create table if not exists seek.google_events (
  meeting_id bigint primary key references seek.meetings (id) on delete cascade,
  event_id   text not null,
  user_id    uuid not null references auth.users (id) on delete cascade
);
alter table seek.google_events enable row level security;
