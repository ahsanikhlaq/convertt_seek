-- Seek · admins can delete #general too
--   · Until now nobody could delete #general. Admins (and owners) now can, like any other channel; members still
--     can't leave it while it exists. If an admin later creates a new #general, the whole team is put in it again.
create or replace function seek.protect_general_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- the server (no caller) and admins may delete it; deleting the whole workspace still works
  if old.name = 'general'
     and auth.uid() is not null
     and exists (select 1 from seek.workspaces w where w.id = old.workspace_id)
     and not seek.is_admin(old.workspace_id) then
    raise exception 'Only admins can delete #general';
  end if;
  return old;
end;
$$;
