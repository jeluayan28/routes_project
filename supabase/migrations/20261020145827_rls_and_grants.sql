-- Row Level Security and explicit grants for every table exposed through the
-- Data API.
--
-- Model
--   anon / authenticated (public):  read ONLY approved data
--       routes: status = 'active' AND verification_status = 'verified'
--       children (stops, route_stops, route_shapes, fare_rules, landmarks):
--       verified AND, where they hang off a route, that route is public too.
--   public:  may INSERT into route_reports (limited columns), nothing else.
--   administrators (private.is_admin()):  read/write everything via RLS.
--
-- Grants are deliberately explicit and minimal: even if a policy were wrong,
-- the role would still lack the table privilege.

-- Start from nothing, and make future tables in `public` default to nothing.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter table public.routes enable row level security;
alter table public.stops enable row level security;
alter table public.route_stops enable row level security;
alter table public.route_shapes enable row level security;
alter table public.fare_rules enable row level security;
alter table public.landmarks enable row level security;
alter table public.route_reports enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on
  public.routes, public.stops, public.route_stops,
  public.route_shapes, public.fare_rules, public.landmarks
  to anon;

grant select, insert, update, delete on
  public.routes, public.stops, public.route_stops,
  public.route_shapes, public.fare_rules, public.landmarks
  to authenticated;

-- Reports: submit-only for the public, with no way to set status/ids/timestamps.
grant insert (route_id, stop_id, report_type, description, reporter_contact)
  on public.route_reports to anon, authenticated;
-- Administrators (authenticated + policy) triage reports.
grant select, delete on public.route_reports to authenticated;
grant update (status) on public.route_reports to authenticated;

grant select on public.audit_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Public read policies (approved, active data only)
-- ---------------------------------------------------------------------------
create policy "Public can read published routes"
  on public.routes for select
  to anon, authenticated
  using (status = 'active' and verification_status = 'verified');

create policy "Public can read verified stops"
  on public.stops for select
  to anon, authenticated
  using (verification_status = 'verified');

create policy "Public can read stops of published routes"
  on public.route_stops for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.routes r
      where r.id = route_stops.route_id
        and r.status = 'active' and r.verification_status = 'verified'
    )
    and exists (
      select 1 from public.stops s
      where s.id = route_stops.stop_id and s.verification_status = 'verified'
    )
  );

create policy "Public can read verified shapes of published routes"
  on public.route_shapes for select
  to anon, authenticated
  using (
    verification_status = 'verified'
    and exists (
      select 1 from public.routes r
      where r.id = route_shapes.route_id
        and r.status = 'active' and r.verification_status = 'verified'
    )
  );

create policy "Public can read verified fares of published routes"
  on public.fare_rules for select
  to anon, authenticated
  using (
    verification_status = 'verified'
    and exists (
      select 1 from public.routes r
      where r.id = fare_rules.route_id
        and r.status = 'active' and r.verification_status = 'verified'
    )
  );

create policy "Public can read verified landmarks"
  on public.landmarks for select
  to anon, authenticated
  using (verification_status = 'verified');

-- ---------------------------------------------------------------------------
-- Administrator policies (full access, gated by the allow-list)
-- ---------------------------------------------------------------------------
create policy "Admins manage routes" on public.routes
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage stops" on public.stops
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage route stops" on public.route_stops
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage route shapes" on public.route_shapes
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage fare rules" on public.fare_rules
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins manage landmarks" on public.landmarks
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
-- Anyone may submit. The referenced route/stop must be public (or absent), so
-- the endpoint cannot be used to probe for unpublished records. Volume limits
-- live in the throttle trigger; status is forced to 'new' by a trigger.
create policy "Anyone can submit a report"
  on public.route_reports for insert
  to anon, authenticated
  with check (
    status = 'new'
    and (
      route_id is null
      or exists (
        select 1 from public.routes r
        where r.id = route_id and r.status = 'active' and r.verification_status = 'verified'
      )
    )
    and (
      stop_id is null
      or exists (
        select 1 from public.stops s
        where s.id = stop_id and s.verification_status = 'verified'
      )
    )
  );

create policy "Admins read reports" on public.route_reports
  for select to authenticated
  using ((select private.is_admin()));

create policy "Admins triage reports" on public.route_reports
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins delete reports" on public.route_reports
  for delete to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Audit log: administrators may read; nobody writes through the API.
-- ---------------------------------------------------------------------------
create policy "Admins read audit logs" on public.audit_logs
  for select to authenticated
  using ((select private.is_admin()));
