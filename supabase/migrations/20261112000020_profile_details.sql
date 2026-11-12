-- Seek · profile details and notification preferences
-- Pronouns and working hours show on your profile (DMs and the people lists). How often you want email
-- notifications is saved now and used once Seek sends email notifications (that needs the sending domain).

alter table seek.profiles
  add column pronouns text not null default '' check (char_length(pronouns) <= 30),
  add column work_hours text not null default '09:00–18:00' check (char_length(work_hours) <= 40),
  add column notify_email text not null default 'instant' check (notify_email in ('instant', 'daily', 'off'));
