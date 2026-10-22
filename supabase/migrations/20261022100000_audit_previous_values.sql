-- Audit log: record what a changed row used to say.
--
-- audit_logs.changes holds the row after the change. For an UPDATE, `previous`
-- now holds only the columns that changed, with their old values, so a reader can
-- tell "route deactivated" (status active -> inactive) or "fare price changed"
-- from the log alone. It is NULL for inserts and deletes.

alter table public.audit_logs add column previous jsonb;

create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb;
  prev jsonb;
begin
  rec := case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Reporter contact details are private; keep them out of the log.
  rec := rec - 'reporter_contact';

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
      into prev
      from jsonb_each(to_jsonb(old)) as o
      where to_jsonb(new) -> o.key is distinct from o.value
        and o.key not in ('updated_at', 'reporter_contact');
  end if;

  insert into public.audit_logs (admin_id, entity_type, entity_id, action, changes, previous)
  values (
    (select auth.uid()),
    tg_table_name,
    nullif(rec ->> 'id', '')::uuid,
    lower(tg_op)::public.audit_action,
    rec,
    prev
  );
  return null;
end;
$$;
