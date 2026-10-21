-- Transport data: routes, stops, route_stops, route_shapes, fare_rules, landmarks.
-- No rows are inserted here. This database ships empty of transport data.
--
-- Conventions
--   * Timestamps are timestamptz (stored as UTC). Fare effective dates are
--     plain `date`s, interpreted as calendar dates in Asia/Manila.
--   * A record is only shown to the public when it is verified (and, for
--     routes, active). See the RLS migration.
--   * 'verified' always requires a verification timestamp.

-- ---------------------------------------------------------------------------
-- routes
-- ---------------------------------------------------------------------------
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  transport_type public.transport_type not null,
  description text,
  origin_label text,
  destination_label text,
  status public.route_status not null default 'draft',
  verification_status public.verification_status not null default 'unverified',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routes_code_not_blank check (code is null or length(btrim(code)) > 0),
  constraint routes_name_not_blank check (length(btrim(name)) > 0),
  constraint routes_name_length check (length(name) <= 200),
  constraint routes_verified_has_date check (
    verification_status <> 'verified' or last_verified_at is not null
  )
);
comment on column public.routes.code is 'Public route identifier (e.g. a franchise or LGU code) where one exists.';

create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- stops
-- ---------------------------------------------------------------------------
create table public.stops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  barangay text,
  landmark_description text,
  pickup_allowed boolean not null default true,
  dropoff_allowed boolean not null default true,
  verification_status public.verification_status not null default 'unverified',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stops_name_not_blank check (length(btrim(name)) > 0),
  constraint stops_latitude_range check (latitude between -90 and 90),
  constraint stops_longitude_range check (longitude between -180 and 180),
  constraint stops_verified_has_date check (
    verification_status <> 'verified' or last_verified_at is not null
  )
);

create trigger stops_set_updated_at
  before update on public.stops
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- route_stops
--
-- Reverse directions: a route has up to two directions. 'outbound' runs from
-- routes.origin_label towards routes.destination_label; 'inbound' is the
-- return trip. Each direction has its OWN ordered stop list (and its own
-- shape), because the return trip on a jeepney/multicab line often uses
-- different streets or stops (one-way streets, loops). A one-way route simply
-- has no 'inbound' rows. The same physical stop can appear in both directions.
--
-- Ordering is 1-based and unique per (route, direction). The constraint is
-- deferrable so a reorder can swap positions inside one transaction.
-- A stop may not appear twice in one direction (loop routes that revisit a
-- stop are not supported by this model).
-- ---------------------------------------------------------------------------
create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  stop_id uuid not null references public.stops (id) on delete restrict,
  direction public.route_direction not null default 'outbound',
  stop_order integer not null,
  -- NULL means "follow the stop's own pickup_allowed / dropoff_allowed";
  -- false restricts this stop on this route/direction only.
  boarding_allowed boolean,
  dropoff_allowed boolean,
  created_at timestamptz not null default now(),
  constraint route_stops_order_positive check (stop_order >= 1),
  constraint route_stops_unique_order
    unique (route_id, direction, stop_order) deferrable initially deferred,
  constraint route_stops_unique_stop
    unique (route_id, direction, stop_id)
);
create index route_stops_stop_id_idx on public.route_stops (stop_id);

-- ---------------------------------------------------------------------------
-- route_shapes (PostGIS)
-- ---------------------------------------------------------------------------
create table public.route_shapes (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  direction public.route_direction not null default 'outbound',
  geometry extensions.geometry(Geometry, 4326) not null,
  source text,
  verification_status public.verification_status not null default 'unverified',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_shapes_one_per_direction unique (route_id, direction),
  constraint route_shapes_line_geometry check (
    extensions.geometrytype(geometry) in ('LINESTRING', 'MULTILINESTRING')
  ),
  constraint route_shapes_verified_has_date check (
    verification_status <> 'verified' or last_verified_at is not null
  )
);
create index route_shapes_geometry_idx on public.route_shapes using gist (geometry);

create trigger route_shapes_set_updated_at
  before update on public.route_shapes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- fare_rules
--
-- from_stop_id and to_stop_id are both NULL for a flat fare on the whole
-- route, or both set for a stop-to-stop fare. Amounts are fixed-precision
-- pesos. Rules for the same route/stops/passenger type may not overlap in time.
-- ---------------------------------------------------------------------------
create table public.fare_rules (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  from_stop_id uuid references public.stops (id) on delete restrict,
  to_stop_id uuid references public.stops (id) on delete restrict,
  passenger_type public.passenger_type not null default 'regular',
  amount numeric(8, 2) not null,
  currency char(3) not null default 'PHP',
  effective_from date not null,
  effective_until date,
  verification_status public.verification_status not null default 'unverified',
  source_description text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fare_rules_amount_not_negative check (amount >= 0),
  constraint fare_rules_currency_php check (currency = 'PHP'),
  constraint fare_rules_valid_period check (
    effective_until is null or effective_until >= effective_from
  ),
  constraint fare_rules_stops_paired check (
    (from_stop_id is null) = (to_stop_id is null)
  ),
  constraint fare_rules_distinct_stops check (from_stop_id is distinct from to_stop_id
    or from_stop_id is null),
  constraint fare_rules_verified_has_date check (
    verification_status <> 'verified' or verified_at is not null
  ),
  constraint fare_rules_no_overlap exclude using gist (
    route_id with =,
    (coalesce(from_stop_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(to_stop_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    passenger_type with =,
    daterange(effective_from, effective_until, '[]') with &&
  )
);
create index fare_rules_route_id_idx on public.fare_rules (route_id);
create index fare_rules_from_stop_id_idx on public.fare_rules (from_stop_id) where from_stop_id is not null;
create index fare_rules_to_stop_id_idx on public.fare_rules (to_stop_id) where to_stop_id is not null;

create trigger fare_rules_set_updated_at
  before update on public.fare_rules
  for each row execute function private.set_updated_at();

-- A stop-to-stop fare must refer to stops that are actually on the route.
create function private.check_fare_rule_stops()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stop uuid;
begin
  foreach stop in array array[new.from_stop_id, new.to_stop_id] loop
    if stop is not null and not exists (
      select 1 from public.route_stops rs
      where rs.route_id = new.route_id and rs.stop_id = stop
    ) then
      raise exception 'Stop % is not on route %', stop, new.route_id
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

create trigger fare_rules_check_stops
  before insert or update of route_id, from_stop_id, to_stop_id on public.fare_rules
  for each row execute function private.check_fare_rule_stops();

-- ---------------------------------------------------------------------------
-- landmarks
-- ---------------------------------------------------------------------------
create table public.landmarks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  latitude double precision not null,
  longitude double precision not null,
  barangay text,
  verification_status public.verification_status not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint landmarks_name_not_blank check (length(btrim(name)) > 0),
  constraint landmarks_category_not_blank check (length(btrim(category)) > 0),
  constraint landmarks_latitude_range check (latitude between -90 and 90),
  constraint landmarks_longitude_range check (longitude between -180 and 180)
);
create index landmarks_name_idx on public.landmarks (lower(name));

create trigger landmarks_set_updated_at
  before update on public.landmarks
  for each row execute function private.set_updated_at();
