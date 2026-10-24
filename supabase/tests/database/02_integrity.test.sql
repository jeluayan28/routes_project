-- Data integrity tests: ranges, fares, ordering, geometry, directions.
-- Run with:  npx supabase test db
-- Fixtures are fictional and rolled back at the end.

begin;
select no_plan();

insert into public.routes (id, code, name, transport_type, status, verification_status, last_verified_at) values
  ('11111111-0000-0000-0000-000000000001', 'T-1', 'Test route', 'minibus', 'active', 'verified', now());
insert into public.stops (id, name, latitude, longitude) values
  ('22222222-0000-0000-0000-000000000001', 'Test stop 1', 8.95, 125.54),
  ('22222222-0000-0000-0000-000000000002', 'Test stop 2', 8.96, 125.55),
  ('22222222-0000-0000-0000-000000000003', 'Off-route stop', 8.97, 125.56);

-- Coordinates
select throws_ok($$ insert into public.stops (name, latitude, longitude) values ('x', 91, 0) $$,
  '23514', null, 'latitude above 90 rejected');
select throws_ok($$ insert into public.stops (name, latitude, longitude) values ('x', -91, 0) $$,
  '23514', null, 'latitude below -90 rejected');
select throws_ok($$ insert into public.stops (name, latitude, longitude) values ('x', 0, 181) $$,
  '23514', null, 'longitude above 180 rejected');
select throws_ok($$ insert into public.landmarks (name, category, latitude, longitude)
  values ('x', 'test', 0, -181) $$, '23514', null, 'landmark longitude range enforced');

-- Routes
select throws_ok($$ insert into public.routes (code, name, transport_type) values ('T-1', 'dup', 'minibus') $$,
  '23505', null, 'route code is unique');
select lives_ok($$ insert into public.routes (name, transport_type) values ('no code a', 'minibus'),
  ('no code b', 'minibus') $$, 'route code is optional (multiple NULLs ok)');
select throws_ok($$ insert into public.routes (name, transport_type) values ('x', 'tricycle') $$,
  '22P02', null, 'unknown transport type rejected');
select throws_ok($$ insert into public.routes (name, transport_type, verification_status)
  values ('x', 'minibus', 'verified') $$,
  '23514', null, 'verified record requires a verification date');

-- Route stops and direction
insert into public.route_stops (route_id, stop_id, direction, stop_order) values
  ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'outbound', 1),
  ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'outbound', 2);

set constraints route_stops_unique_order immediate;
select throws_ok($$ insert into public.route_stops (route_id, stop_id, direction, stop_order)
  values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'outbound', 2) $$,
  '23505', null, 'duplicate stop_order within a route direction rejected');
select throws_ok($$ insert into public.route_stops (route_id, stop_id, direction, stop_order)
  values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'outbound', 3) $$,
  '23505', null, 'same stop twice in one direction rejected');
select throws_ok($$ insert into public.route_stops (route_id, stop_id, direction, stop_order)
  values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'outbound', 0) $$,
  '23514', null, 'stop_order must be >= 1');
select lives_ok($$ insert into public.route_stops (route_id, stop_id, direction, stop_order)
  values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'inbound', 1),
         ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'inbound', 2) $$,
  'the reverse direction has its own independent ordering');
set constraints route_stops_unique_order deferred;
select lives_ok($$ update public.route_stops set stop_order = 3 - stop_order
  where route_id = '11111111-0000-0000-0000-000000000001' and direction = 'outbound' $$,
  'two stops can swap order inside one statement (deferrable constraint)');
select throws_ok($$ delete from public.stops where id = '22222222-0000-0000-0000-000000000001' $$,
  '23503', null, 'a stop used by a route cannot be deleted');

-- Shapes
select lives_ok($$ insert into public.route_shapes (route_id, direction, geometry)
  values ('11111111-0000-0000-0000-000000000001', 'outbound',
    extensions.st_geomfromtext('LINESTRING(125.54 8.95, 125.55 8.96)', 4326)) $$,
  'LineString accepted');
select lives_ok($$ insert into public.route_shapes (route_id, direction, geometry)
  values ('11111111-0000-0000-0000-000000000001', 'inbound',
    extensions.st_geomfromtext('MULTILINESTRING((125.54 8.95, 125.55 8.96),(125.56 8.97, 125.57 8.98))', 4326)) $$,
  'MultiLineString accepted');
select throws_ok($$ insert into public.route_shapes (route_id, direction, geometry)
  values ('11111111-0000-0000-0000-000000000001', 'outbound',
    extensions.st_geomfromtext('LINESTRING(0 0, 1 1)', 4326)) $$,
  '23505', null, 'one shape per route direction');

-- Fares
select throws_ok($$ insert into public.fare_rules (route_id, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', -1, '2026-01-01') $$,
  '23514', null, 'negative fare rejected');
select throws_ok($$ insert into public.fare_rules (route_id, amount, effective_from, currency)
  values ('11111111-0000-0000-0000-000000000001', 10, '2026-01-01', 'USD') $$,
  '23514', null, 'only PHP currency allowed');
select throws_ok($$ insert into public.fare_rules (route_id, amount, effective_from, effective_until)
  values ('11111111-0000-0000-0000-000000000001', 10, '2026-02-01', '2026-01-01') $$,
  '23514', null, 'effective_until before effective_from rejected');
select throws_ok($$ insert into public.fare_rules (route_id, amount, effective_from, verification_status)
  values ('11111111-0000-0000-0000-000000000001', 10, '2026-01-01', 'verified') $$,
  '23514', null, 'verified fare requires verified_at');
select throws_ok($$ insert into public.fare_rules (route_id, from_stop_id, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 10, '2026-01-01') $$,
  '23514', null, 'from_stop without to_stop rejected');
select throws_ok($$ insert into public.fare_rules (route_id, from_stop_id, to_stop_id, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
          '22222222-0000-0000-0000-000000000003', 10, '2026-01-01') $$,
  '23514', null, 'fare stop that is not on the route rejected');
select throws_ok($$ select 9999999.999::numeric(8,2) $$,
  '22003', null, 'numeric(8,2) bounds amounts');

select lives_ok($$ insert into public.fare_rules (route_id, passenger_type, amount, effective_from, effective_until)
  values ('11111111-0000-0000-0000-000000000001', 'regular', 12.50, '2026-01-01', '2026-06-30') $$,
  'valid flat fare accepted');
select throws_ok($$ insert into public.fare_rules (route_id, passenger_type, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', 'regular', 13.00, '2026-06-30') $$,
  '23P01', null, 'overlapping effective periods rejected');
select lives_ok($$ insert into public.fare_rules (route_id, passenger_type, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', 'regular', 13.00, '2026-07-01') $$,
  'a following period is accepted');
select lives_ok($$ insert into public.fare_rules (route_id, passenger_type, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', 'student', 10.00, '2026-01-01') $$,
  'another passenger type may share the period');
select lives_ok($$ insert into public.fare_rules (route_id, from_stop_id, to_stop_id, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
          '22222222-0000-0000-0000-000000000002', 9.00, '2026-01-01') $$,
  'stop-to-stop fare on route stops accepted');

-- Timestamps
select is((select data_type from information_schema.columns
  where table_schema = 'public' and table_name = 'routes' and column_name = 'created_at'),
  'timestamp with time zone', 'timestamps are timestamptz');

select * from finish();
rollback;
