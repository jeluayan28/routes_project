-- Sample queries for Butuan Route Finder. NOT run automatically and NOT a seed:
-- they contain no data. Part 1 is read-only and safe anywhere. Part 2 shows how
-- an administrator adds REAL, verified data; replace the <placeholders>.
--
-- Run part 1 locally:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/queries/sample-queries.sql

------------------------------------------------------------------------------
-- Part 1: what a public visitor can read (simulates the anon role)
------------------------------------------------------------------------------
begin;
set local role anon;

-- Published routes
select id, code, name, transport_type, origin_label, destination_label, last_verified_at
from public.routes
order by name;

-- Ordered stops for one route direction (replace the id)
select rs.direction, rs.stop_order, s.name, s.latitude, s.longitude,
       coalesce(rs.boarding_allowed, s.pickup_allowed)  as can_board,
       coalesce(rs.dropoff_allowed, s.dropoff_allowed) as can_alight
from public.route_stops rs
join public.stops s on s.id = rs.stop_id
where rs.route_id = '00000000-0000-0000-0000-000000000000'
  and rs.direction = 'outbound'
order by rs.stop_order;

-- Fares currently in effect (Asia/Manila calendar date), newest first
select f.route_id, f.passenger_type, f.amount, f.currency,
       f.from_stop_id, f.to_stop_id, f.effective_from, f.effective_until, f.verified_at
from public.fare_rules f
where f.effective_from <= (now() at time zone 'Asia/Manila')::date
  and (f.effective_until is null or f.effective_until >= (now() at time zone 'Asia/Manila')::date)
order by f.route_id, f.passenger_type;

-- Route lines as GeoJSON (for Leaflet)
select route_id, direction, geojson from public.route_shapes_geojson;

-- Stops near a point (simple bounding box; uses plain lat/lng)
select id, name, latitude, longitude
from public.stops
where latitude  between 8.93 and 8.97
  and longitude between 125.51 and 125.57;

rollback;

------------------------------------------------------------------------------
-- Part 2: administrator operations (reference only; commented out)
------------------------------------------------------------------------------
-- 2a. Make an existing Auth user an administrator. Run in the Supabase SQL
--     editor (or any direct database connection). There is deliberately no
--     API for this.
--
--   insert into private.admin_users (user_id, note)
--   select id, 'initial admin' from auth.users where email = '<admin email>';
--
-- 2b. Remove an administrator:
--
--   delete from private.admin_users
--   where user_id = (select id from auth.users where email = '<admin email>');
--
-- 2c. Publish a route once its data has been checked against a real source.
--     A route is public only when status = 'active' AND verification_status = 'verified'.
--
--   update public.routes
--   set status = 'active', verification_status = 'verified', last_verified_at = now()
--   where code = '<route code>';
--
-- 2d. Record a verified fare (stops are optional; omit both for a flat fare).
--
--   insert into public.fare_rules
--     (route_id, passenger_type, amount, effective_from, verification_status,
--      source_description, verified_at)
--   values
--     ('<route uuid>', 'regular', <amount>, '<yyyy-mm-dd>', 'verified',
--      '<where the fare was confirmed>', now());
--
-- 2e. Triage report inbox (as an admin signed in through the app, or in SQL editor):
--
--   select id, report_type, status, description, reporter_contact, created_at
--   from public.route_reports where status = 'new' order by created_at;
--
--   update public.route_reports set status = 'reviewing' where id = '<report uuid>';
