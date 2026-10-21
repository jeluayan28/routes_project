-- Public correction reports (with abuse limiting) and the administrator audit log.

-- ---------------------------------------------------------------------------
-- route_reports
--
-- Anyone (including anonymous visitors) may submit a report. Nobody but an
-- administrator can read one. reporter_contact is optional and private.
-- ---------------------------------------------------------------------------
create table public.route_reports (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references public.routes (id) on delete set null,
  stop_id uuid references public.stops (id) on delete set null,
  report_type public.report_type not null,
  description text not null,
  reporter_contact text,
  status public.report_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_reports_description_length check (
    char_length(btrim(description)) between 10 and 2000
  ),
  constraint route_reports_contact_length check (
    reporter_contact is null or char_length(reporter_contact) <= 200
  )
);
create index route_reports_route_id_idx on public.route_reports (route_id) where route_id is not null;
create index route_reports_stop_id_idx on public.route_reports (stop_id) where stop_id is not null;
create index route_reports_status_created_idx on public.route_reports (status, created_at desc);

create trigger route_reports_set_updated_at
  before update on public.route_reports
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Abuse limiting for anonymous reports.
--
-- The database only sees what PostgREST passes along. We derive a salted hash
-- of the client IP (cf-connecting-ip, set by the Cloudflare edge in front of
-- Supabase and not client-controllable; falling back to the first
-- x-forwarded-for entry) and keep only the hash, never the IP, in a private
-- table. Two limits apply: per client and global. This is a safety net, not a
-- replacement for a CAPTCHA / edge rate limit if abuse becomes real.
-- ---------------------------------------------------------------------------
create table private.app_secrets (
  name text primary key,
  value text not null
);
revoke all on private.app_secrets from public, anon, authenticated;
alter table private.app_secrets enable row level security;
insert into private.app_secrets (name, value)
values ('report_throttle_salt', gen_random_uuid()::text || gen_random_uuid()::text)
on conflict (name) do nothing;

create table private.report_throttle (
  id bigint generated always as identity primary key,
  client_hash text not null,
  created_at timestamptz not null default now()
);
create index report_throttle_client_idx on private.report_throttle (client_hash, created_at);
create index report_throttle_created_idx on private.report_throttle (created_at);
revoke all on private.report_throttle from public, anon, authenticated;
alter table private.report_throttle enable row level security;

create function private.throttle_route_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  per_client_limit constant integer := 5;     -- per hour
  global_limit constant integer := 300;       -- per hour
  headers json;
  ip text;
  salt text;
  h text;
begin
  -- Administrators are never throttled.
  if private.is_admin() then
    return new;
  end if;

  headers := nullif(current_setting('request.headers', true), '')::json;
  ip := coalesce(
    nullif(btrim(headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'unknown'
  );
  select value into salt from private.app_secrets where name = 'report_throttle_salt';
  h := encode(extensions.digest(salt || ip, 'sha256'), 'hex');

  -- Opportunistic cleanup keeps the table small without a scheduled job.
  delete from private.report_throttle where created_at < now() - interval '1 day';

  if (select count(*) from private.report_throttle
      where client_hash = h and created_at > now() - interval '1 hour') >= per_client_limit
     or (select count(*) from private.report_throttle
      where created_at > now() - interval '1 hour') >= global_limit then
    raise exception 'Too many reports. Please try again later.'
      using errcode = 'P0001';
  end if;

  insert into private.report_throttle (client_hash) values (h);
  return new;
end;
$$;
revoke all on function private.throttle_route_reports() from public;

create trigger route_reports_throttle
  before insert on public.route_reports
  for each row execute function private.throttle_route_reports();

-- Anonymous callers cannot choose the workflow state.
create function private.force_new_report_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_admin() then
    new.status := 'new';
  end if;
  return new;
end;
$$;

create trigger route_reports_force_defaults
  before insert on public.route_reports
  for each row execute function private.force_new_report_defaults();

-- ---------------------------------------------------------------------------
-- audit_logs
--
-- Append-only record of changes to managed tables. admin_id is the auth user
-- that made the change (NULL for changes made outside the API, e.g. from the
-- SQL editor). It is intentionally not a foreign key, so the history survives
-- deletion of the account.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  admin_id uuid,
  entity_type text not null,
  entity_id uuid,
  action public.audit_action not null,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_admin_idx on public.audit_logs (admin_id, created_at desc) where admin_id is not null;
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb;
begin
  rec := case tg_op when 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Reporter contact details are private; keep them out of the log.
  rec := rec - 'reporter_contact';

  insert into public.audit_logs (admin_id, entity_type, entity_id, action, changes)
  values (
    (select auth.uid()),
    tg_table_name,
    nullif(rec ->> 'id', '')::uuid,
    lower(tg_op)::public.audit_action,
    rec
  );
  return null;
end;
$$;
revoke all on function private.audit_row() from public;

create function private.forbid_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function private.forbid_audit_mutation();

create trigger routes_audit
  after insert or update or delete on public.routes
  for each row execute function private.audit_row();
create trigger stops_audit
  after insert or update or delete on public.stops
  for each row execute function private.audit_row();
create trigger route_stops_audit
  after insert or update or delete on public.route_stops
  for each row execute function private.audit_row();
create trigger route_shapes_audit
  after insert or update or delete on public.route_shapes
  for each row execute function private.audit_row();
create trigger fare_rules_audit
  after insert or update or delete on public.fare_rules
  for each row execute function private.audit_row();
create trigger landmarks_audit
  after insert or update or delete on public.landmarks
  for each row execute function private.audit_row();
-- Reports: anonymous inserts are not audited (they would only be noise);
-- administrator triage is.
create trigger route_reports_audit
  after update or delete on public.route_reports
  for each row execute function private.audit_row();
