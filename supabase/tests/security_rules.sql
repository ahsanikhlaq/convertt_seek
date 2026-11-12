-- Seek · security rule tests (spec section 7 and the rules each feature added)
-- Paste into Supabase → SQL Editor and Run. It creates temporary data, checks every rule as the right kind of
-- person, and always rolls everything back. The result is one line:
--   RESULT: 30 passed, 0 failed
-- or the names of the checks that failed. Needs one workspace with an owner and three other sign-ins in auth.users.

do $$
declare
  ws uuid; ws2 uuid; owner uuid; cli uuid; viewer uuid; outsider uuid;
  sp uuid; sp_other uuid; ch uuid; priv uuid;
  m_team bigint; m_client bigint; m_chan bigint; m_priv bigint;
  d_team bigint; d_client bigint; d_new bigint; ap bigint; mt bigint;
  n int; ok int := 0; bad int := 0; failed text := '';
begin
  -- ------------------------------------------------------------ people and places
  select w.id, m.user_id into ws, owner
    from seek.workspaces w join seek.workspace_members m on m.workspace_id = w.id and m.role = 'owner'
   order by w.created_at limit 1;
  select id into cli from auth.users u where not exists (select 1 from seek.workspace_members x where x.user_id = u.id) order by created_at limit 1;
  select id into viewer from auth.users u where not exists (select 1 from seek.workspace_members x where x.user_id = u.id) and id <> cli order by created_at limit 1;
  select id into outsider from auth.users u where not exists (select 1 from seek.workspace_members x where x.user_id = u.id) and id not in (cli, viewer) order by created_at limit 1;
  if ws is null or cli is null or viewer is null or outsider is null then
    raise exception 'RESULT: cannot run (needs a workspace with an owner and three other sign-ins)';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  insert into seek.client_spaces (workspace_id, name, code, created_by) values (ws, 'Test A', 'TA', owner) returning id into sp;
  insert into seek.client_spaces (workspace_id, name, code, created_by) values (ws, 'Test B', 'TB', owner) returning id into sp_other;
  insert into seek.client_team (space_id, user_id, is_lead) values (sp, owner, true) on conflict do nothing;
  insert into seek.client_people (space_id, email, role, user_id) values (sp, 'approver@test.invalid', 'approver', cli), (sp, 'viewer@test.invalid', 'viewer', viewer);
  insert into seek.channels (workspace_id, name, private, created_by) values (ws, 'zz-test-open', false, owner) returning id into ch;
  insert into seek.channels (workspace_id, name, private, created_by) values (ws, 'zz-test-private', true, owner) returning id into priv;
  insert into seek.messages (space_id, lane, body, user_id) values (sp, 'team', 'team only note', owner) returning id into m_team;
  insert into seek.messages (space_id, lane, body, user_id) values (sp, 'client', 'hello client', owner) returning id into m_client;
  insert into seek.messages (channel_id, body, user_id) values (ch, 'channel talk', owner) returning id into m_chan;
  insert into seek.messages (channel_id, body, user_id) values (priv, 'private talk', owner) returning id into m_priv;

  execute 'set local role authenticated';

  -- ------------------------------------------------------------ as the team (owner)
  insert into seek.decisions (text, source_message_id) values ('Team decision', m_team) returning id into d_team;
  insert into seek.decisions (text, source_message_id) values ('Client decision', m_client) returning id into d_client;
  ap := seek.request_approval(sp, 'Hero B', 'v4', cli, current_date + 3);
  mt := seek.schedule_meeting(sp, 'Internal prep', now() + interval '1 day', 30, 'person', 'Office', '', false, false, '{}');

  -- rule 7: decisions keep history
  d_new := seek.replace_decision(d_client, 'Client decision v2');
  select count(*) into n from seek.decisions where id = d_client and replaced_at is not null;
  if n = 1 then ok := ok + 1; else bad := bad + 1; failed := failed || ' edit-keeps-old-version'; end if;
  select count(*) into n from seek.decisions where id = d_new and replaces_id = d_client;
  if n = 1 then ok := ok + 1; else bad := bad + 1; failed := failed || ' edit-links-to-old'; end if;

  -- messages: authors change only the text; nobody forges a meeting card
  begin update seek.messages set pinned_at = now() where id = m_chan; bad := bad + 1; failed := failed || ' update-other-columns';
  exception when others then ok := ok + 1; end;
  begin insert into seek.messages (channel_id, body, card) values (ch, 'x', '{"type":"meeting","link":"https://evil.example"}');
    bad := bad + 1; failed := failed || ' forge-meeting-card';
  exception when others then ok := ok + 1; end;

  -- ------------------------------------------------------------ as the client approver (rules 1, 2, 8)
  perform set_config('request.jwt.claims', json_build_object('sub', cli, 'role', 'authenticated')::text, true);
  select count(*) into n from seek.client_spaces where id = sp;
  if n = 1 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-sees-own-space'; end if;
  select count(*) into n from seek.client_spaces where id = sp_other;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-sees-other-space'; end if;
  select count(*) into n from seek.messages where id = m_team;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-reads-team-notes'; end if;
  select count(*) into n from seek.messages where id = m_client;
  if n = 1 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-reads-client-chat'; end if;
  select count(*) into n from seek.messages where id in (m_chan, m_priv);
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-reads-channels'; end if;
  select count(*) into n from seek.channels where workspace_id = ws;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-lists-channels'; end if;
  select count(*) into n from seek.decisions where id = d_team;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-sees-team-decision'; end if;
  select count(*) into n from seek.decisions where id = d_new;
  if n = 1 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-sees-client-decision'; end if;
  if not seek.file_access('sp/' || sp || '/team/x/a.pdf', false) then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-opens-team-file'; end if;
  if seek.file_access('sp/' || sp || '/client/x/a.pdf', false) then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-opens-client-file'; end if;
  select count(*) into n from seek.search_seek('team only', null, 'all');
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-searches-team-notes'; end if;
  select count(*) into n from seek.tasks;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-sees-tasks'; end if;
  select count(*) into n from seek.meetings where id = mt;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' client-sees-internal-meeting'; end if;
  begin insert into seek.messages (space_id, lane, body) values (sp, 'team', 'sneaky'); bad := bad + 1; failed := failed || ' client-writes-team-notes';
  exception when others then ok := ok + 1; end;
  begin insert into seek.decisions (text, source_message_id) values ('x', m_client); bad := bad + 1; failed := failed || ' client-logs-decision';
  exception when others then ok := ok + 1; end;

  -- ------------------------------------------------------------ as the viewer (read-only client)
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  begin insert into seek.messages (space_id, lane, body) values (sp, 'client', 'hi'); bad := bad + 1; failed := failed || ' viewer-writes';
  exception when others then ok := ok + 1; end;
  begin perform seek.respond_approval(ap, true); bad := bad + 1; failed := failed || ' non-approver-approves';
  exception when others then ok := ok + 1; end;

  -- rule 8: the team can't approve for the client; the approver can
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  begin perform seek.respond_approval(ap, true); bad := bad + 1; failed := failed || ' team-approves';
  exception when others then ok := ok + 1; end;
  perform set_config('request.jwt.claims', json_build_object('sub', cli, 'role', 'authenticated')::text, true);
  begin perform seek.respond_approval(ap, true); ok := ok + 1;
  exception when others then bad := bad + 1; failed := failed || ' approver-approves'; end;
  delete from seek.decisions where space_id = sp and kind = 'approval'; get diagnostics n = row_count;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' approval-decision-deleted'; end if;

  -- ------------------------------------------------------------ as an outsider
  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  select count(*) into n from seek.messages where id in (m_team, m_client, m_chan, m_priv);
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' outsider-reads-messages'; end if;
  select count(*) into n from seek.client_spaces where workspace_id = ws;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' outsider-sees-spaces'; end if;
  select count(*) into n from seek.decisions where workspace_id = ws;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' outsider-sees-decisions'; end if;
  select count(*) into n from seek.notifications where user_id <> outsider;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' reads-others-notifications'; end if;
  begin perform seek.pin_message(m_chan, true); bad := bad + 1; failed := failed || ' outsider-pins';
  exception when others then ok := ok + 1; end;
  update seek.messages set body = 'hacked' where id = m_chan; get diagnostics n = row_count;
  if n = 0 then ok := ok + 1; else bad := bad + 1; failed := failed || ' outsider-edits'; end if;

  raise exception 'RESULT: % passed, % failed%', ok, bad, case when bad > 0 then ':' || failed else '' end;
end $$;
