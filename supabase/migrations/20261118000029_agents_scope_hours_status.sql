-- Seek · three more agents: Scope guard, Retainer watch, Status drafter
--   · Scope guard: each client space has an agreed scope (the SOW), edited by the team. When a client posts in
--     Client chat, the seek-ai function compares the request with it and, if it's clearly outside, posts ONE note in
--     Team notes (what was asked, why it looks out of scope, a draft change request). Never anything to the client.
--     scope_checks remembers which messages were checked (server only).
--   · Retainer watch: a space can have retainer hours per calendar month, and the team logs time against it
--     (time_entries; clients never see it). When this month's time first reaches 80% and then 100% of the retainer,
--     a note is posted in Team notes (once each per month, remembered in retainer_alerts, server only).
--   · Status drafter: runs in seek-ai on request and posts nothing itself (no database change needed).
--   · Agent-written messages can now come from the database too (the retainer trigger), not only from the server.
-- Safe to run more than once.

-- ---------------------------------------------------------------- the agreed scope and the retainer
alter table seek.client_spaces add column if not exists scope text not null default '';
alter table seek.client_spaces add column if not exists retainer_hours numeric;
alter table seek.client_spaces drop constraint if exists client_spaces_scope_len;
alter table seek.client_spaces add constraint client_spaces_scope_len check (char_length(scope) <= 8000);
alter table seek.client_spaces drop constraint if exists client_spaces_retainer_hours_range;
alter table seek.client_spaces add constraint client_spaces_retainer_hours_range check (retainer_hours is null or (retainer_hours > 0 and retainer_hours <= 1000));

-- ---------------------------------------------------------------- which agents may author messages
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'seek.messages'::regclass and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%away_assistant%'
  loop
    execute format('alter table seek.messages drop constraint %I', c.conname);
  end loop;
end $$;
alter table seek.messages drop constraint if exists messages_agent_check;
alter table seek.messages add constraint messages_agent_check
  check (agent is null or agent in ('away_assistant', 'scope_guard', 'retainer_watch'));

-- People can't post as an agent. Agent messages come from the server (service role) or from Seek's own database
-- functions (which run as their owner), never from a signed-in person directly. Runs as the caller (no security
-- definer) so current_user tells them apart, like messages_card_guard. Fires after messages_before_insert (trigger
-- names run in alphabetical order), which sets user_id from the caller: an agent message has no person as author.
create or replace function seek.messages_agent_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.agent is not null then
    if current_user in ('authenticated', 'anon') then
      raise exception 'only Seek can post as an agent';
    end if;
    new.user_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists seek_messages_agent_guard on seek.messages;
create trigger seek_messages_agent_guard before insert on seek.messages for each row execute function seek.messages_agent_guard();

-- ---------------------------------------------------------------- Scope guard: messages already checked (server only)
create table if not exists seek.scope_checks (
  message_id  bigint primary key references seek.messages (id) on delete cascade,
  space_id    uuid not null references seek.client_spaces (id) on delete cascade,
  checked_at  timestamptz not null default now(),
  verdict     text not null default 'pending' check (verdict in ('pending', 'in', 'out', 'unsure', 'error')),
  note_id     bigint references seek.messages (id) on delete set null
);
create index if not exists scope_checks_space_idx on seek.scope_checks (space_id, checked_at desc);
alter table seek.scope_checks enable row level security;
revoke all on seek.scope_checks from anon, authenticated;

-- ---------------------------------------------------------------- Retainer watch: time logged against a client
create table if not exists seek.time_entries (
  id            bigint generated always as identity primary key,
  space_id      uuid not null references seek.client_spaces (id) on delete cascade,
  workspace_id  uuid not null references seek.workspaces (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  minutes       int not null check (minutes between 1 and 1440),
  note          text not null default '' check (char_length(note) <= 300),
  worked_on     date not null default current_date,
  created_at    timestamptz not null default now()
);
create index if not exists time_entries_space_day_idx on seek.time_entries (space_id, worked_on);
alter table seek.time_entries enable row level security;
revoke update on seek.time_entries from authenticated;

-- an entry always belongs to its space's workspace and to whoever logs it; no far-off dates
create or replace function seek.time_entries_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.workspace_id := (select s.workspace_id from seek.client_spaces s where s.id = new.space_id);
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  if new.worked_on > current_date + 1 or new.worked_on < current_date - 400 then
    raise exception 'pick a date in the last year';
  end if;
  return new;
end;
$$;
drop trigger if exists time_entries_before_insert on seek.time_entries;
create trigger time_entries_before_insert before insert on seek.time_entries for each row execute function seek.time_entries_before_insert();

drop policy if exists "time entries: the space's team reads them" on seek.time_entries;
create policy "time entries: the space's team reads them" on seek.time_entries
  for select to authenticated using (seek.space_side(space_id) = 'team');
drop policy if exists "time entries: team members log their own" on seek.time_entries;
create policy "time entries: team members log their own" on seek.time_entries
  for insert to authenticated with check (user_id = auth.uid() and seek.space_side(space_id) = 'team');
drop policy if exists "time entries: delete your own" on seek.time_entries;
create policy "time entries: delete your own" on seek.time_entries
  for delete to authenticated using (user_id = auth.uid() and seek.space_side(space_id) = 'team');

-- which warnings went out (80 and 100, once each per space per month); server only
create table if not exists seek.retainer_alerts (
  space_id    uuid not null references seek.client_spaces (id) on delete cascade,
  month       date not null,
  level       int not null check (level in (80, 100)),
  message_id  bigint references seek.messages (id) on delete set null,
  at          timestamptz not null default now(),
  primary key (space_id, month, level)
);
alter table seek.retainer_alerts enable row level security;
revoke all on seek.retainer_alerts from anon, authenticated;

-- After time is logged: this month's total for the space (the month of the entry's date). The first time it reaches
-- 80% and the first time it reaches 100% of the retainer, Retainer watch posts in Team notes and logs it (a jump
-- straight past 100% posts once). Nothing when the agent is off or AI is paused (then nothing is remembered either,
-- so the warning comes with the next entry once it's back on).
create or replace function seek.time_entries_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp        record;
  mon       date := date_trunc('month', new.worked_on)::date;
  total_min bigint;
  pct       numeric;
  lvl       int;
  n         int;
  hit       int;
  used_h    numeric;
  left_h    numeric;
  label     text;
  txt       text;
  mid       bigint;
begin
  select s.id, s.name, s.workspace_id, s.retainer_hours into sp from seek.client_spaces s where s.id = new.space_id;
  if sp.id is null or sp.retainer_hours is null or sp.retainer_hours <= 0 then
    return null;
  end if;
  if coalesce((select w.ai_paused from seek.workspaces w where w.id = sp.workspace_id), false) then
    return null;
  end if;
  if not coalesce((select a.enabled from seek.agent_settings a where a.workspace_id = sp.workspace_id and a.agent = 'retainer_watch'), true) then
    return null;
  end if;

  select coalesce(sum(t.minutes), 0) into total_min
    from seek.time_entries t
   where t.space_id = sp.id and t.worked_on >= mon and t.worked_on < (mon + interval '1 month')::date;
  pct := total_min / 60.0 / sp.retainer_hours * 100;

  foreach lvl in array array[100, 80] loop
    if pct >= lvl then
      insert into seek.retainer_alerts (space_id, month, level) values (sp.id, mon, lvl) on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 and hit is null then
        hit := lvl;
      end if;
    end if;
  end loop;
  if hit is null then
    return null;
  end if;

  used_h := trim_scale(round(total_min / 60.0, 1));
  left_h := trim_scale(round(greatest(sp.retainer_hours - total_min / 60.0, 0), 1));
  label := to_char(mon, 'FMMonth YYYY');
  txt := sp.name || ' has used ' || used_h::text || ' of ' || trim_scale(sp.retainer_hours)::text || ' retainer hours in ' || label
         || ' (' || floor(pct)::text || '%).'
         || case when hit = 100
              then ' The retainer for the month is used up: agree any further work with the client before going ahead.'
              else ' ' || left_h::text || case when left_h = 1 then ' hour' else ' hours' end || ' left.'
            end;
  insert into seek.messages (space_id, lane, body, agent) values (sp.id, 'team', txt, 'retainer_watch') returning id into mid;
  update seek.retainer_alerts set message_id = mid where space_id = sp.id and month = mon and level = hit;
  insert into seek.agent_log (workspace_id, agent, action, conv, sources, actor_id)
  values (sp.workspace_id, 'retainer_watch',
          'Warned in ' || sp.name || ' Team notes: ' || floor(pct)::text || '% of the ' || label || ' retainer used',
          'sp:' || sp.id || ':team', jsonb_build_array(mid), auth.uid());
  return null;
end;
$$;
drop trigger if exists time_entries_after_insert on seek.time_entries;
create trigger time_entries_after_insert after insert on seek.time_entries for each row execute function seek.time_entries_after_insert();
