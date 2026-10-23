-- Public feedback and the report resolution workflow.
--
--   * Visitors (no account) can report a route, stop, direction or fare problem.
--     A report is only a claim: nothing in this file lets a report change a route,
--     stop, fare or verification status. Only an administrator edits data.
--   * Inputs are checked in the database, which is the only server-side check a
--     direct API call cannot skip: length limits, no control characters, a cap on
--     links, and the right references for each kind of report.
--   * Resolving or rejecting a report records who, when and why.
--   * A route can be deactivated with a recorded reason.

-- ---------------------------------------------------------------------------
-- route_reports: direction, resolution record, stricter input rules
-- ---------------------------------------------------------------------------
alter table public.route_reports
  add column direction public.route_direction,
  add column resolution_note text,
  add column resolved_by uuid,
  add column resolved_at timestamptz;

alter table public.route_reports
  add constraint route_reports_note_length check (resolution_note is null or char_length(resolution_note) <= 1000),
  add constraint route_reports_closed_has_note check (
    status not in ('resolved', 'rejected') or (resolution_note is not null and resolved_at is not null)
  ) not valid,
  -- Each kind of report must say what it is about, so an administrator can inspect it.
  add constraint route_reports_type_has_subject check (
    case report_type
      when 'incorrect_route' then route_id is not null
      when 'incorrect_direction' then route_id is not null and direction is not null
      when 'incorrect_fare' then route_id is not null
      when 'incorrect_stop' then stop_id is not null
      else true
    end
  ),
  add constraint route_reports_no_control_chars check (
    description !~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]'
    and (reporter_contact is null or reporter_contact !~ '[\x00-\x1f\x7f]')
  );

comment on column public.route_reports.reporter_contact is
  'Optional, private, administrators only. Never shown publicly and never written to the audit log.';
comment on column public.route_reports.status is
  'new = pending, reviewing, resolved, rejected. A report is a claim, never verified information.';

-- Visitors may set only the content columns. Direction is new.
revoke insert on public.route_reports from anon, authenticated;
grant insert (route_id, stop_id, report_type, direction, description, reporter_contact)
  on public.route_reports to anon, authenticated;

-- Administrators change a report's status only through set_report_status(), so
-- the resolution (who, when, why) is always recorded.
revoke update on public.route_reports from authenticated;

-- Input rules for anonymous submissions. Runs before the throttle (triggers fire
-- in name order) so a rejected report does not use up the sender's quota.
create function private.validate_public_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_admin() then
    return new;
  end if;

  new.description := btrim(regexp_replace(new.description, '[ \t]+', ' ', 'g'));
  new.reporter_contact := nullif(btrim(new.reporter_contact), '');

  -- Link-stuffed text is spam, not a correction.
  if (select count(*) from regexp_matches(new.description, '(https?://|www\.)', 'gi')) > 2 then
    raise exception 'Reports can include at most two links.' using errcode = 'check_violation';
  end if;
  -- A direction only makes sense for a route.
  if new.direction is not null and new.route_id is null then
    raise exception 'A direction needs a route.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_public_report() from public;

create trigger route_reports_a_validate
  before insert on public.route_reports
  for each row execute function private.validate_public_report();

-- ---------------------------------------------------------------------------
-- public.set_report_status(): the only way an administrator moves a report.
-- ---------------------------------------------------------------------------
create function public.set_report_status(p_report_id uuid, p_status public.report_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.route_reports%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if not private.is_admin() then
    raise exception 'Administrators only' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.route_reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found' using errcode = 'no_data_found';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note is too long (1000 characters at most)' using errcode = 'check_violation';
  end if;
  if p_status in ('resolved', 'rejected') and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Say how this report was resolved or why it was rejected' using errcode = 'check_violation';
  end if;

  update public.route_reports
  set status = p_status,
      resolution_note = case when p_status in ('resolved', 'rejected') then v_note else coalesce(v_note, resolution_note) end,
      resolved_by = case when p_status in ('resolved', 'rejected') then (select auth.uid()) else null end,
      resolved_at = case when p_status in ('resolved', 'rejected') then now() else null end
  where id = p_report_id;
end;
$$;
revoke all on function public.set_report_status(uuid, public.report_status, text) from public, anon;
grant execute on function public.set_report_status(uuid, public.report_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Temporary deactivation of a route known to be inaccurate
-- ---------------------------------------------------------------------------
alter table public.routes
  add column deactivation_reason text,
  add column deactivated_at timestamptz,
  add constraint routes_deactivation_reason_length check (deactivation_reason is null or char_length(deactivation_reason) <= 500);

comment on column public.routes.deactivation_reason is
  'Why an inactive route was taken down (for example a report that it is inaccurate). Administrators only.';

-- Keep the reason and time in step with the status, whoever changes it.
create function private.track_route_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'inactive' and old.status is distinct from 'inactive' then
    new.deactivated_at := now();
  elsif new.status <> 'inactive' then
    new.deactivation_reason := null;
    new.deactivated_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.track_route_deactivation() from public;

create trigger routes_track_deactivation
  before update of status on public.routes
  for each row execute function private.track_route_deactivation();
