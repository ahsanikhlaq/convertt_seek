-- Seek · notification sounds
-- Your notification sound (one of six), its volume, what plays it, and how long desktop alerts stay on screen.

alter table seek.profiles
  add column notify_sound text not null default 'chime' check (notify_sound in ('chime', 'ding', 'pop', 'bell', 'knock', 'soft')),
  add column notify_volume int not null default 70 check (notify_volume between 0 and 100),
  add column notify_play text not null default 'all' check (notify_play in ('all', 'important', 'off')),
  add column notify_alert_secs int not null default 8 check (notify_alert_secs in (0, 4, 8, 15));
