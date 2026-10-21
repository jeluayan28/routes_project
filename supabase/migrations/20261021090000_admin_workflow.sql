-- Administrator workflow: verification records, CSV import batches, sample-data
-- guards, and atomic save/verify/import functions.
--
-- Principles
--   * Nothing becomes public by accident. A route is public only when it is
--     active AND verified (see the RLS migration). This migration adds the rule
--     that, for API callers, "verified" can only be reached through
--     public.verify_route(), which demands a source, a date, a complete
--     checklist and complete content. Direct SQL as the postgres role (the
--     Supabase SQL editor) is the root of trust and is not restricted.
--   * Editing something that was verified drops it back to unverified, so a
--     change is never published without being re-checked.
--   * Sample/fixture records (is_sample) can never be verified.
--   * Related changes (save a route, verify a route, commit an import) run in a
--     single function call, i.e. a single transaction.

-- ---------------------------------------------------------------------------
-- Sample markers
-- ---------------------------------------------------------------------------
alter table public.routes add column is_sample boolean not null default false;
alter table public.stops add column is_sample boolean not null default false;

alter table public.routes add constraint routes_sample_never_verified
  check (not is_sample or verification_status <> 'verified');
alter table public.stops add constraint stops_sample_never_verified
  check (not is_sample or verification_status <> 'verified');

comment on column public.routes.is_sample is
  'Development/sample record. Can never be verified, so can never be public.';

-- ---------------------------------------------------------------------------
-- Import batches (who imported what, from which source)
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid default auth.uid(),
  source_description text not null,
  files jsonb not null default '[]'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  constraint import_batches_source_not_blank check (char_length(btrim(source_description)) >= 3)
);
comment on table public.import_batches is
  'One row per committed CSV import: the administrator, the declared source, file names/hashes and row counts.';

alter table public.routes add column import_batch_id uuid references public.import_batches (id) on delete restrict;
alter table public.stops add column import_batch_id uuid references public.import_batches (id) on delete restrict;
alter table public.fare_rules add column import_batch_id uuid references public.import_batches (id) on delete restrict;
create index routes_import_batch_idx on public.routes (import_batch_id) where import_batch_id is not null;
create index stops_import_batch_idx on public.stops (import_batch_id) where import_batch_id is not null;
create index fare_rules_import_batch_idx on public.fare_rules (import_batch_id) where import_batch_id is not null;

-- ---------------------------------------------------------------------------
-- Verification records (history; one row per verification)
-- ---------------------------------------------------------------------------
create table public.route_verifications (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  verified_by uuid default auth.uid(),
  -- The calendar date (Asia/Manila) on which the source was checked.
  verified_on date not null,
  source_description text not null,
  transport_type_ok boolean not null,
  name_direction_ok boolean not null,
  endpoints_ok boolean not null,
  stops_ok boolean not null,
  geometry_ok boolean not null,
  boarding_dropoff_ok boolean not null,
  fares_ok boolean not null,
  passenger_categories_ok boolean not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint route_verifications_source_not_blank check (char_length(btrim(source_description)) >= 3),
  constraint route_verifications_all_checked check (
    transport_type_ok and name_direction_ok and endpoints_ok and stops_ok
    and geometry_ok and boarding_dropoff_ok and fares_ok and passenger_categories_ok
  )
);
create index route_verifications_route_idx on public.route_verifications (route_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- True when the statement runs as a Data API role. The postgres role (SQL
-- editor, migrations) is not an API role and is not restricted by the guards.
create function private.is_api_role()
returns boolean
language sql
stable
set search_path = ''
as $$ select current_user in ('anon', 'authenticated'); $$;

-- The route currently being verified by public.verify_route() in this
-- transaction, if any.
create function private.verifying_route()
returns uuid
language sql
stable
set search_path = ''
as $$ select nullif(current_setting('app.verifying_route', true), '')::uuid; $$;

revoke all on function private.is_api_role() from public;
revoke all on function private.verifying_route() from public;
grant execute on function private.is_api_role() to anon, authenticated;
grant execute on function private.verifying_route() to anon, authenticated;

-- Drops a verified route back to unverified (it must be re-verified).
create function private.unverify_route(p_route_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.routes
  set verification_status = 'unverified'
  where id = p_route_id and verification_status = 'verified';
$$;
revoke all on function private.unverify_route(uuid) from public;
grant execute on function private.unverify_route(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guards: routes
-- ---------------------------------------------------------------------------
create function private.guard_route_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_role() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verification_status = 'verified' then
      raise exception 'A route can only be verified with verify_route()'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if private.verifying_route() is not distinct from new.id then
    return new;
  end if;

  if new.verification_status = 'verified' and old.verification_status <> 'verified' then
    raise exception 'A route can only be verified with verify_route()'
      using errcode = 'check_violation';
  end if;

  -- Changing what was verified means it has to be verified again.
  if old.verification_status = 'verified' and new.verification_status = 'verified'
     and (new.code, new.name, new.transport_type, new.origin_label, new.destination_label)
         is distinct from
         (old.code, old.name, old.transport_type, old.origin_label, old.destination_label) then
    new.verification_status := 'unverified';
  end if;
  return new;
end;
$$;

create trigger routes_guard_verification
  before insert or update on public.routes
  for each row execute function private.guard_route_verification();

-- ---------------------------------------------------------------------------
-- Guards: stops
-- ---------------------------------------------------------------------------
create function private.guard_stop_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_role() or private.verifying_route() is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verification_status = 'verified' then
      raise exception 'A stop is verified together with its route, using verify_route()'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.verification_status = 'verified' and old.verification_status <> 'verified' then
    raise exception 'A stop is verified together with its route, using verify_route()'
      using errcode = 'check_violation';
  end if;

  if old.verification_status = 'verified' and new.verification_status = 'verified'
     and (new.name, new.latitude, new.longitude, new.pickup_allowed, new.dropoff_allowed)
         is distinct from
         (old.name, old.latitude, old.longitude, old.pickup_allowed, old.dropoff_allowed) then
    new.verification_status := 'unverified';
  end if;
  return new;
end;
$$;

create trigger stops_guard_verification
  before insert or update on public.stops
  for each row execute function private.guard_stop_verification();

-- A changed stop invalidates every verified route that uses it.
create function private.unverify_routes_of_stop()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_role() or private.verifying_route() is not null then
    return null;
  end if;
  if (new.name, new.latitude, new.longitude, new.pickup_allowed, new.dropoff_allowed)
     is not distinct from
     (old.name, old.latitude, old.longitude, old.pickup_allowed, old.dropoff_allowed) then
    return null;
  end if;
  perform private.unverify_route(rs.route_id)
  from public.route_stops rs
  where rs.stop_id = new.id;
  return null;
end;
$$;

create trigger stops_unverify_routes
  after update of name, latitude, longitude, pickup_allowed, dropoff_allowed on public.stops
  for each row execute function private.unverify_routes_of_stop();

-- ---------------------------------------------------------------------------
-- Guards: route_stops, route_shapes, fare_rules
-- ---------------------------------------------------------------------------
create function private.unverify_route_on_stop_list_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_role() then
    perform private.unverify_route(case tg_op when 'DELETE' then old.route_id else new.route_id end);
  end if;
  return null;
end;
$$;

create trigger route_stops_unverify_route
  after insert or update or delete on public.route_stops
  for each row execute function private.unverify_route_on_stop_list_change();

create function private.guard_shape_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_role() or private.verifying_route() is not distinct from new.route_id then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'unverified';
    new.last_verified_at := null;
    perform private.unverify_route(new.route_id);
    return new;
  end if;

  if new.verification_status = 'verified' and old.verification_status <> 'verified' then
    raise exception 'A shape is verified together with its route, using verify_route()'
      using errcode = 'check_violation';
  end if;

  if new.geometry is distinct from old.geometry then
    new.verification_status := 'unverified';
    new.last_verified_at := null;
    perform private.unverify_route(new.route_id);
  end if;
  return new;
end;
$$;

create trigger route_shapes_guard_verification
  before insert or update on public.route_shapes
  for each row execute function private.guard_shape_verification();

create function private.unverify_route_on_shape_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_api_role() then
    perform private.unverify_route(old.route_id);
  end if;
  return null;
end;
$$;

create trigger route_shapes_unverify_on_delete
  after delete on public.route_shapes
  for each row execute function private.unverify_route_on_shape_delete();

create function private.guard_fare_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_api_role() or private.verifying_route() is not distinct from new.route_id then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'unverified';
    new.verified_at := null;
    return new;
  end if;

  if new.verification_status = 'verified' and old.verification_status <> 'verified' then
    raise exception 'A fare is verified together with its route, using verify_route()'
      using errcode = 'check_violation';
  end if;

  if (new.route_id, new.from_stop_id, new.to_stop_id, new.passenger_type, new.amount,
      new.effective_from, new.effective_until)
     is distinct from
     (old.route_id, old.from_stop_id, old.to_stop_id, old.passenger_type, old.amount,
      old.effective_from, old.effective_until) then
    new.verification_status := 'unverified';
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger fare_rules_guard_verification
  before insert or update on public.fare_rules
  for each row execute function private.guard_fare_verification();

-- Trigger functions run as the caller; they only call the helpers above.
revoke all on function private.guard_route_verification() from public;
revoke all on function private.guard_stop_verification() from public;
revoke all on function private.unverify_routes_of_stop() from public;
revoke all on function private.unverify_route_on_stop_list_change() from public;
revoke all on function private.guard_shape_verification() from public;
revoke all on function private.unverify_route_on_shape_delete() from public;
revoke all on function private.guard_fare_verification() from public;

-- ---------------------------------------------------------------------------
-- RLS, grants, audit
-- ---------------------------------------------------------------------------
alter table public.import_batches enable row level security;
alter table public.route_verifications enable row level security;

-- History tables: administrators may read and add, never edit or delete.
grant select, insert on public.import_batches, public.route_verifications to authenticated;

create policy "Admins read import batches" on public.import_batches
  for select to authenticated using ((select private.is_admin()));
create policy "Admins add import batches" on public.import_batches
  for insert to authenticated with check ((select private.is_admin()));

create policy "Admins read verifications" on public.route_verifications
  for select to authenticated using ((select private.is_admin()));
create policy "Admins add verifications" on public.route_verifications
  for insert to authenticated with check ((select private.is_admin()));

create trigger import_batches_audit
  after insert on public.import_batches
  for each row execute function private.audit_row();
create trigger route_verifications_audit
  after insert on public.route_verifications
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- public.is_current_user_admin(): lets the app gate its admin pages.
-- Answers only about the caller. Real protection is still RLS.
-- ---------------------------------------------------------------------------
create function public.is_current_user_admin()
returns boolean
language sql
stable
set search_path = ''
as $$ select private.is_admin(); $$;
revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- public.verify_route(): the only way for an API caller to mark a route verified.
-- ---------------------------------------------------------------------------
create function public.verify_route(
  p_route_id uuid,
  p_verified_on date,
  p_source text,
  p_checks jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  r public.routes%rowtype;
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_when timestamptz;
  k text;
  required_checks constant text[] := array[
    'transport_type', 'name_direction', 'endpoints', 'stops',
    'geometry', 'boarding_dropoff', 'fares', 'passenger_categories'
  ];
begin
  if not private.is_admin() then
    raise exception 'Administrators only' using errcode = 'insufficient_privilege';
  end if;

  select * into r from public.routes where id = p_route_id for update;
  if not found then
    raise exception 'Route not found' using errcode = 'no_data_found';
  end if;
  if r.is_sample then
    raise exception 'Sample routes cannot be verified' using errcode = 'check_violation';
  end if;
  if p_verified_on is null or p_verified_on > v_today then
    raise exception 'The verification date must be today or earlier' using errcode = 'check_violation';
  end if;
  if p_source is null or char_length(btrim(p_source)) < 3 then
    raise exception 'A verification source is required' using errcode = 'check_violation';
  end if;
  foreach k in array required_checks loop
    if coalesce((p_checks ->> k)::boolean, false) is not true then
      raise exception 'Verification check "%" is not confirmed', k using errcode = 'check_violation';
    end if;
  end loop;

  -- Content must be complete before it can be called verified.
  if nullif(btrim(r.origin_label), '') is null or nullif(btrim(r.destination_label), '') is null then
    raise exception 'Starting and ending points must be recorded' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.route_stops
      where route_id = p_route_id and direction = 'outbound') < 2 then
    raise exception 'The outbound direction needs at least two stops' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.route_shapes where route_id = p_route_id and direction = 'outbound') then
    raise exception 'The outbound direction needs recorded route geometry' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.route_stops where route_id = p_route_id and direction = 'inbound')
     and not exists (select 1 from public.route_shapes where route_id = p_route_id and direction = 'inbound') then
    raise exception 'The inbound direction has stops but no recorded geometry' using errcode = 'check_violation';
  end if;
  if exists (
    select 1
    from public.route_stops rs
    join public.stops s on s.id = rs.stop_id
    where rs.route_id = p_route_id
      and (s.is_sample or (s.latitude = 0 and s.longitude = 0))
  ) then
    raise exception 'A sample or placeholder stop is on this route' using errcode = 'check_violation';
  end if;

  v_when := p_verified_on::timestamp at time zone 'Asia/Manila';
  perform set_config('app.verifying_route', p_route_id::text, true);

  insert into public.route_verifications (
    route_id, verified_on, source_description,
    transport_type_ok, name_direction_ok, endpoints_ok, stops_ok,
    geometry_ok, boarding_dropoff_ok, fares_ok, passenger_categories_ok, notes
  ) values (
    p_route_id, p_verified_on, btrim(p_source),
    true, true, true, true, true, true, true, true, nullif(btrim(p_notes), '')
  ) returning id into v_id;

  update public.stops
  set verification_status = 'verified', last_verified_at = v_when
  where id in (select stop_id from public.route_stops where route_id = p_route_id);

  update public.route_shapes
  set verification_status = 'verified', last_verified_at = v_when,
      source = coalesce(source, btrim(p_source))
  where route_id = p_route_id;

  update public.fare_rules
  set verification_status = 'verified', verified_at = v_when,
      source_description = coalesce(source_description, btrim(p_source))
  where route_id = p_route_id;

  update public.routes
  set verification_status = 'verified', last_verified_at = v_when
  where id = p_route_id;

  perform set_config('app.verifying_route', '', true);
  return v_id;
end;
$$;
revoke all on function public.verify_route(uuid, date, text, jsonb, text) from public, anon;
grant execute on function public.verify_route(uuid, date, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.save_route(): create/update a route, its ordered stops and its
-- geometry per direction, atomically. New routes are always draft/unverified.
--
-- p_data = {
--   code, name, transport_type, description, origin_label, destination_label,
--   directions: [ { direction: 'outbound'|'inbound',
--                   stops: [ { stop_id, boarding_allowed, dropoff_allowed } ],  -- array order = stop order
--                   geometry: GeoJSON LineString/MultiLineString | null,
--                   geometry_source: text } ]
-- }
-- If "directions" is absent, only the route's details are saved. A direction
-- that is not listed is removed (that is how a route becomes one-way).
-- Rows are rewritten only when they actually changed, so saving without
-- changes does not discard a verification.
-- ---------------------------------------------------------------------------
create function public.save_route(p_route_id uuid, p_data jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := p_route_id;
  d jsonb;
  dir public.route_direction;
  seen text[] := '{}';
  v_old jsonb;
  v_new jsonb;
  g jsonb;
  v_geom extensions.geometry;
  v_same boolean;
  v_bad uuid;
begin
  if not private.is_admin() then
    raise exception 'Administrators only' using errcode = 'insufficient_privilege';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Route data must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  if v_id is null then
    insert into public.routes (code, name, transport_type, description, origin_label, destination_label, status, verification_status)
    values (
      nullif(btrim(p_data ->> 'code'), ''),
      p_data ->> 'name',
      (p_data ->> 'transport_type')::public.transport_type,
      nullif(btrim(p_data ->> 'description'), ''),
      nullif(btrim(p_data ->> 'origin_label'), ''),
      nullif(btrim(p_data ->> 'destination_label'), ''),
      'draft', 'unverified'
    ) returning id into v_id;
  else
    update public.routes set
      code = nullif(btrim(p_data ->> 'code'), ''),
      name = p_data ->> 'name',
      transport_type = (p_data ->> 'transport_type')::public.transport_type,
      description = nullif(btrim(p_data ->> 'description'), ''),
      origin_label = nullif(btrim(p_data ->> 'origin_label'), ''),
      destination_label = nullif(btrim(p_data ->> 'destination_label'), '')
    where id = v_id;
    if not found then
      raise exception 'Route not found' using errcode = 'no_data_found';
    end if;
  end if;

  if p_data ? 'directions' then
    for d in select e from jsonb_array_elements(p_data -> 'directions') as t(e) loop
      dir := (d ->> 'direction')::public.route_direction;
      if dir::text = any (seen) then
        raise exception 'Direction % was given twice', dir using errcode = 'invalid_parameter_value';
      end if;
      seen := seen || dir::text;

      -- Ordered stops
      select coalesce(jsonb_agg(jsonb_build_object(
               'stop_id', (e ->> 'stop_id')::uuid::text,
               'boarding', coalesce(e -> 'boarding_allowed', 'null'::jsonb),
               'dropoff', coalesce(e -> 'dropoff_allowed', 'null'::jsonb)
             ) order by ord), '[]'::jsonb)
        into v_new
        from jsonb_array_elements(coalesce(d -> 'stops', '[]'::jsonb)) with ordinality as t(e, ord);

      select coalesce(jsonb_agg(jsonb_build_object(
               'stop_id', stop_id::text,
               'boarding', coalesce(to_jsonb(boarding_allowed), 'null'::jsonb),
               'dropoff', coalesce(to_jsonb(dropoff_allowed), 'null'::jsonb)
             ) order by stop_order), '[]'::jsonb)
        into v_old
        from public.route_stops where route_id = v_id and direction = dir;

      if v_new <> v_old then
        delete from public.route_stops where route_id = v_id and direction = dir;
        insert into public.route_stops (route_id, stop_id, direction, stop_order, boarding_allowed, dropoff_allowed)
        select v_id, (e ->> 'stop_id')::uuid, dir, ord::integer,
               (e ->> 'boarding_allowed')::boolean, (e ->> 'dropoff_allowed')::boolean
          from jsonb_array_elements(coalesce(d -> 'stops', '[]'::jsonb)) with ordinality as t(e, ord);
      end if;

      -- Geometry
      g := d -> 'geometry';
      if g is null or jsonb_typeof(g) = 'null' then
        delete from public.route_shapes where route_id = v_id and direction = dir;
      else
        if g ->> 'type' not in ('LineString', 'MultiLineString') then
          raise exception 'Geometry must be a LineString or MultiLineString' using errcode = 'invalid_parameter_value';
        end if;
        if jsonb_typeof(g -> 'coordinates') <> 'array' then
          raise exception 'Geometry has no coordinates' using errcode = 'invalid_parameter_value';
        end if;
        if g ->> 'type' = 'LineString' and jsonb_array_length(g -> 'coordinates') < 2 then
          raise exception 'A line needs at least two points' using errcode = 'invalid_parameter_value';
        end if;
        if g ->> 'type' = 'MultiLineString' and (
             jsonb_array_length(g -> 'coordinates') < 1
             or jsonb_path_exists(g, 'strict $.coordinates[*] ? (@.size() < 2)')
           ) then
          raise exception 'Every line needs at least two points' using errcode = 'invalid_parameter_value';
        end if;
        if jsonb_path_exists(g, 'lax $.coordinates.** ? (@.type() == "array" && @[0].type() == "number" && (@[0] < -180 || @[0] > 180 || @[1] < -90 || @[1] > 90))') then
          raise exception 'Geometry has coordinates outside the valid range' using errcode = 'invalid_parameter_value';
        end if;

        v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson(g::text), 4326);

        select extensions.st_asgeojson(geometry)::jsonb = extensions.st_asgeojson(v_geom)::jsonb
          into v_same
          from public.route_shapes where route_id = v_id and direction = dir;

        if v_same is null then
          insert into public.route_shapes (route_id, direction, geometry, source)
          values (v_id, dir, v_geom, nullif(btrim(d ->> 'geometry_source'), ''));
        elsif not v_same then
          update public.route_shapes
          set geometry = v_geom, source = nullif(btrim(d ->> 'geometry_source'), '')
          where route_id = v_id and direction = dir;
        else
          update public.route_shapes
          set source = nullif(btrim(d ->> 'geometry_source'), '')
          where route_id = v_id and direction = dir
            and source is distinct from nullif(btrim(d ->> 'geometry_source'), '');
        end if;
      end if;
    end loop;

    -- Directions not listed are removed.
    delete from public.route_stops
      where route_id = v_id and direction::text <> all (seen);
    delete from public.route_shapes
      where route_id = v_id and direction::text <> all (seen);

    -- Fares must keep pointing at stops that are still on the route.
    select s into v_bad
      from (
        select from_stop_id as s from public.fare_rules where route_id = v_id and from_stop_id is not null
        union
        select to_stop_id from public.fare_rules where route_id = v_id and to_stop_id is not null
      ) f
      where not exists (select 1 from public.route_stops rs where rs.route_id = v_id and rs.stop_id = f.s)
      limit 1;
    if v_bad is not null then
      raise exception 'A fare rule refers to stop % which is no longer on the route. Change or remove that fare first.', v_bad
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  return v_id;
end;
$$;
revoke all on function public.save_route(uuid, jsonb) from public, anon;
grant execute on function public.save_route(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- public.commit_import(): inserts a validated CSV bundle atomically.
--
-- Insert-only: nothing existing is updated. Everything created is draft /
-- unverified and tagged with the batch. Rows refer to each other with
-- "ref" keys inside the bundle, or to existing records by UUID. Existing routes
-- may only be referenced if they are not verified (changing a verified route
-- would silently un-publish it).
-- ---------------------------------------------------------------------------
create function public.commit_import(p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b jsonb := p_payload -> 'batch';
  v_batch uuid;
  stop_map jsonb := '{}'::jsonb;
  route_map jsonb := '{}'::jsonb;
  e jsonb;
  new_id uuid;
  v_route uuid;
  v_stop uuid;
  v_from uuid;
  v_to uuid;
  v_counts jsonb;
begin
  if not private.is_admin() then
    raise exception 'Administrators only' using errcode = 'insufficient_privilege';
  end if;
  if p_payload is null or b is null then
    raise exception 'Import payload is missing its batch details' using errcode = 'invalid_parameter_value';
  end if;

  v_counts := jsonb_build_object(
    'stops', jsonb_array_length(coalesce(p_payload -> 'stops', '[]'::jsonb)),
    'routes', jsonb_array_length(coalesce(p_payload -> 'routes', '[]'::jsonb)),
    'route_stops', jsonb_array_length(coalesce(p_payload -> 'route_stops', '[]'::jsonb)),
    'fares', jsonb_array_length(coalesce(p_payload -> 'fares', '[]'::jsonb))
  );

  insert into public.import_batches (id, source_description, files, counts, notes)
  values (
    (b ->> 'id')::uuid,
    b ->> 'source_description',
    coalesce(b -> 'files', '[]'::jsonb),
    v_counts,
    nullif(btrim(b ->> 'notes'), '')
  ) returning id into v_batch;

  for e in select x from jsonb_array_elements(coalesce(p_payload -> 'stops', '[]'::jsonb)) as t(x) loop
    insert into public.stops (name, latitude, longitude, barangay, landmark_description,
                              pickup_allowed, dropoff_allowed, is_sample, import_batch_id)
    values (
      e ->> 'name', (e ->> 'latitude')::double precision, (e ->> 'longitude')::double precision,
      nullif(btrim(e ->> 'barangay'), ''), nullif(btrim(e ->> 'landmark_description'), ''),
      coalesce((e ->> 'pickup_allowed')::boolean, true), coalesce((e ->> 'dropoff_allowed')::boolean, true),
      coalesce((e ->> 'is_sample')::boolean, false), v_batch
    ) returning id into new_id;
    stop_map := stop_map || jsonb_build_object(e ->> 'ref', new_id);
  end loop;

  for e in select x from jsonb_array_elements(coalesce(p_payload -> 'routes', '[]'::jsonb)) as t(x) loop
    insert into public.routes (code, name, transport_type, description, origin_label, destination_label,
                               status, verification_status, is_sample, import_batch_id)
    values (
      nullif(btrim(e ->> 'code'), ''), e ->> 'name', (e ->> 'transport_type')::public.transport_type,
      nullif(btrim(e ->> 'description'), ''), nullif(btrim(e ->> 'origin_label'), ''),
      nullif(btrim(e ->> 'destination_label'), ''),
      'draft', 'unverified', coalesce((e ->> 'is_sample')::boolean, false), v_batch
    ) returning id into new_id;
    route_map := route_map || jsonb_build_object(e ->> 'ref', new_id);
  end loop;

  for e in select x from jsonb_array_elements(coalesce(p_payload -> 'route_stops', '[]'::jsonb)) as t(x) loop
    v_route := coalesce((route_map ->> (e ->> 'route_ref'))::uuid, (e ->> 'route_id')::uuid);
    v_stop := coalesce((stop_map ->> (e ->> 'stop_ref'))::uuid, (e ->> 'stop_id')::uuid);
    if v_route is null or v_stop is null then
      raise exception 'A route-stop row does not resolve to a route and a stop' using errcode = 'foreign_key_violation';
    end if;
    if e ->> 'route_ref' is null and exists (
      select 1 from public.routes where id = v_route and verification_status = 'verified'
    ) then
      raise exception 'Route % is verified; edit it in the route editor instead of importing', v_route
        using errcode = 'check_violation';
    end if;
    insert into public.route_stops (route_id, stop_id, direction, stop_order, boarding_allowed, dropoff_allowed)
    values (
      v_route, v_stop, (e ->> 'direction')::public.route_direction, (e ->> 'stop_order')::integer,
      (e ->> 'boarding_allowed')::boolean, (e ->> 'dropoff_allowed')::boolean
    );
  end loop;

  for e in select x from jsonb_array_elements(coalesce(p_payload -> 'fares', '[]'::jsonb)) as t(x) loop
    v_route := coalesce((route_map ->> (e ->> 'route_ref'))::uuid, (e ->> 'route_id')::uuid);
    v_from := coalesce((stop_map ->> (e ->> 'from_stop_ref'))::uuid, (e ->> 'from_stop_id')::uuid);
    v_to := coalesce((stop_map ->> (e ->> 'to_stop_ref'))::uuid, (e ->> 'to_stop_id')::uuid);
    if v_route is null then
      raise exception 'A fare row does not resolve to a route' using errcode = 'foreign_key_violation';
    end if;
    if e ->> 'route_ref' is null and exists (
      select 1 from public.routes where id = v_route and verification_status = 'verified'
    ) then
      raise exception 'Route % is verified; edit it in the route editor instead of importing', v_route
        using errcode = 'check_violation';
    end if;
    insert into public.fare_rules (route_id, from_stop_id, to_stop_id, passenger_type, amount,
                                   effective_from, effective_until, source_description, import_batch_id)
    values (
      v_route, v_from, v_to, (e ->> 'passenger_type')::public.passenger_type, (e ->> 'amount')::numeric,
      (e ->> 'effective_from')::date, nullif(e ->> 'effective_until', '')::date,
      nullif(btrim(e ->> 'source_description'), ''), v_batch
    );
  end loop;

  return jsonb_build_object('batch_id', v_batch, 'counts', v_counts);
end;
$$;
revoke all on function public.commit_import(jsonb) from public, anon;
grant execute on function public.commit_import(jsonb) to authenticated;
