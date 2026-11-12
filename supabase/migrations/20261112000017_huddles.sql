-- Seek · huddles and calls
-- Starting a huddle (channel) or a call (DM) posts a HUDDLE card with a link to a private Seek video room (a free
-- Jitsi Meet room with a random name; no account needed). People can only post huddle cards, and only with such a
-- link: meeting cards come from schedule_meeting alone, so nobody can forge a meeting (or a link) in Client chat.

create or replace function seek.messages_card_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.card is not null and current_user in ('authenticated', 'anon') then
    if new.card->>'type' is distinct from 'huddle'
       or coalesce(new.card->>'link', '') !~ '^https://meet\.jit\.si/Seek-[A-Za-z0-9]{12,40}$' then
      raise exception 'not allowed';
    end if;
    new.card := jsonb_build_object('type', 'huddle', 'link', new.card->>'link', 'started_at', now());
  end if;
  return new;
end;
$$;
create trigger seek_messages_card_guard before insert on seek.messages for each row execute function seek.messages_card_guard();
