-- Seek · search
-- One query for ⌘K: messages, files, decisions, people and client spaces. It runs as the caller, so row-level
-- security decides what comes back (a client never finds Team notes, team channels or other clients). Pass the
-- organisation, or null for everything you can see (a client's view). Kinds: 'all' or one of message, file,
-- decision, person, space.

create index if not exists messages_body_fts on seek.messages using gin (to_tsvector('simple', body));
create index if not exists decisions_text_fts on seek.decisions using gin (to_tsvector('simple', text));

create or replace function seek.search_seek(p_q text, p_ws uuid default null, p_kind text default 'all', p_limit int default 30)
returns table (kind text, ref text, title text, snippet text, conv text, at timestamptz, user_id uuid, message_id bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  q text := trim(coalesce(p_q, ''));
  like_q text;
  ts tsquery;
  lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if char_length(q) < 2 then
    return;
  end if;
  like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  ts := websearch_to_tsquery('simple', q);

  if p_kind in ('all', 'message') then
    return query
      select 'message'::text, m.id::text, coalesce(c.name, s.name, 'Direct message'),
             left(m.body, 220),
             case when m.channel_id is not null then 'ch:' || m.channel_id when m.dm_id is not null then 'dm:' || m.dm_id else 'sp:' || m.space_id || ':' || m.lane end,
             m.created_at, m.user_id, m.id
        from seek.messages m
        left join seek.channels c on c.id = m.channel_id
        left join seek.client_spaces s on s.id = m.space_id
       where (p_ws is null or m.workspace_id = p_ws)
         and (to_tsvector('simple', m.body) @@ ts or m.body ilike like_q)
       order by m.created_at desc
       limit lim;
  end if;

  if p_kind in ('all', 'file') then
    return query
      select 'file'::text, f->>'path', f->>'name', coalesce(c.name, s.name, 'Direct message'),
             case when m.channel_id is not null then 'ch:' || m.channel_id when m.dm_id is not null then 'dm:' || m.dm_id else 'sp:' || m.space_id || ':' || m.lane end,
             m.created_at, m.user_id, m.id
        from seek.messages m
        cross join lateral jsonb_array_elements(m.files) f
        left join seek.channels c on c.id = m.channel_id
        left join seek.client_spaces s on s.id = m.space_id
       where (p_ws is null or m.workspace_id = p_ws)
         and m.files <> '[]'::jsonb
         and (f->>'name') ilike like_q
       order by m.created_at desc
       limit lim;
  end if;

  if p_kind in ('all', 'decision') then
    return query
      select 'decision'::text, d.id::text, d.text, coalesce(c.name, s.name, 'Direct message'),
             case when d.channel_id is not null then 'ch:' || d.channel_id when d.dm_id is not null then 'dm:' || d.dm_id else 'sp:' || d.space_id || ':' || d.lane end,
             d.created_at, d.logged_by, d.source_message_id
        from seek.decisions d
        left join seek.channels c on c.id = d.channel_id
        left join seek.client_spaces s on s.id = d.space_id
       where (p_ws is null or d.workspace_id = p_ws)
         and d.replaced_at is null
         and (to_tsvector('simple', d.text) @@ ts or d.text ilike like_q)
       order by d.created_at desc
       limit lim;
  end if;

  if p_kind in ('all', 'person') then
    return query
      select 'person'::text, p.id::text, coalesce(nullif(p.name, ''), split_part(p.email, '@', 1)),
             concat_ws(' · ', nullif(p.title, ''), p.email), null::text, null::timestamptz, p.id, null::bigint
        from seek.profiles p
       where p.id <> auth.uid()
         and (p.name ilike like_q or p.email ilike like_q or p.title ilike like_q)
         and (p_ws is null or exists (select 1 from seek.workspace_members w where w.workspace_id = p_ws and w.user_id = p.id)
              or exists (select 1 from seek.client_people cp join seek.client_spaces cs on cs.id = cp.space_id
                         where cs.workspace_id = p_ws and cp.user_id = p.id and cp.removed_at is null))
       order by p.name
       limit lim;
  end if;

  if p_kind in ('all', 'space') then
    return query
      select 'space'::text, s.id::text, s.name, nullif(s.project, ''), 'sp:' || s.id || ':client', s.created_at, null::uuid, null::bigint
        from seek.client_spaces s
       where (p_ws is null or s.workspace_id = p_ws)
         and (s.name ilike like_q or s.project ilike like_q or s.code ilike like_q)
       order by s.name
       limit lim;
  end if;
end;
$$;
revoke all on function seek.search_seek(text, uuid, text, int) from public, anon;
grant execute on function seek.search_seek(text, uuid, text, int) to authenticated;
