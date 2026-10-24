-- Administrator workflow tests: save_route, verify_route, commit_import and the
-- verification guards, against real PostGIS.
-- Run with:  npx supabase test db
--
-- NOTE: these mirror the PGlite tests in src/test/db/admin-workflow.test.ts, which
-- run in `npm test` without Docker but with a stand-in for PostGIS. This file was
-- written without a Docker environment and has NOT been run yet; run it, and fix
-- any difference, before relying on the workflow in production.
--
-- All fixtures are FICTIONAL, exist only inside this transaction, and are rolled back.

begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'wf-admin@test.invalid', '{}'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'wf-user@test.invalid', '{}');
insert into private.admin_users (user_id) values ('aaaaaaaa-0000-0000-0000-0000000000a1');

insert into public.stops (id, name, latitude, longitude) values
  ('22222222-0000-0000-0000-0000000000a1', 'WF stop 1', 0.001, 0.001),
  ('22222222-0000-0000-0000-0000000000a2', 'WF stop 2', 0.002, 0.002),
  ('22222222-0000-0000-0000-0000000000a3', 'WF stop 3', 0.003, 0.003);

-- ---------------------------------------------------------------------------
-- Not an administrator
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(public.is_current_user_admin(), false, 'a signed-in non-admin is not an admin');
select throws_ok($$ select public.save_route(null, '{"name":"x","transport_type":"minibus"}'::jsonb) $$,
  '42501', 'Administrators only', 'non-admin cannot save routes');
select throws_ok($$ select public.commit_import('{"batch":{}}'::jsonb) $$,
  '42501', 'Administrators only', 'non-admin cannot import');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select public.save_route(null, '{}'::jsonb) $$, '42501', null, 'anon cannot call save_route');
reset role;

-- ---------------------------------------------------------------------------
-- Administrator: save, verify, edit
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(public.is_current_user_admin(), true, 'an allow-listed account is an admin');

create temp table wf as
select public.save_route(null, jsonb_build_object(
  'code', 'WF-1', 'name', 'WF route', 'transport_type', 'minibus',
  'origin_label', 'WF origin', 'destination_label', 'WF destination',
  'directions', jsonb_build_array(
    jsonb_build_object('direction', 'outbound',
      'stops', jsonb_build_array(
        jsonb_build_object('stop_id', '22222222-0000-0000-0000-0000000000a1'),
        jsonb_build_object('stop_id', '22222222-0000-0000-0000-0000000000a2'),
        jsonb_build_object('stop_id', '22222222-0000-0000-0000-0000000000a3')),
      'geometry', '{"type":"LineString","coordinates":[[0.001,0.001],[0.003,0.003]]}'::jsonb,
      'geometry_source', 'fictional')
  )
)) as id;

select is((select status::text || '/' || verification_status::text from public.routes where id = (select id from wf)),
  'draft/unverified', 'new routes are draft and unverified');
select is((select count(*)::int from public.route_stops where route_id = (select id from wf)), 3, 'stops were saved');
select is((select count(*)::int from public.route_shapes where route_id = (select id from wf)), 1, 'geometry was saved');
select is((select extensions.geometrytype(geometry) from public.route_shapes where route_id = (select id from wf)),
  'LINESTRING', 'geometry is stored as a PostGIS line');

select throws_ok($$ select public.save_route((select id from wf), jsonb_build_object(
    'name', 'WF route', 'transport_type', 'minibus',
    'directions', jsonb_build_array(jsonb_build_object('direction', 'outbound', 'stops', '[]'::jsonb,
      'geometry', '{"type":"LineString","coordinates":[[200,0],[1,1]]}'::jsonb)))) $$,
  '22023', null, 'out-of-range geometry is rejected');

select throws_ok($$ update public.routes set verification_status = 'verified', last_verified_at = now()
  where id = (select id from wf) $$, '23514', null, 'verified cannot be set directly through the API');

select throws_ok($$ select public.verify_route((select id from wf), '2026-01-15', 'fictional source',
  '{"transport_type":true}'::jsonb) $$, '23514', null, 'verification needs every check');

select lives_ok($$ select public.verify_route((select id from wf), '2026-01-15', 'fictional source',
  '{"transport_type":true,"name_direction":true,"endpoints":true,"stops":true,
    "geometry":true,"boarding_dropoff":true,"fares":true,"passenger_categories":true}'::jsonb) $$,
  'a complete verification succeeds');
select is((select verification_status::text from public.routes where id = (select id from wf)), 'verified', 'route is verified');
select is((select count(*)::int from public.route_verifications where route_id = (select id from wf)
  and verified_by = 'aaaaaaaa-0000-0000-0000-0000000000a1'), 1, 'the verification records the administrator');
select is((select count(distinct verification_status)::int from public.route_shapes where route_id = (select id from wf)), 1,
  'shapes were verified with the route');

-- Saving without changes keeps the verification; a change drops it.
select lives_ok($$ select public.save_route((select id from wf), jsonb_build_object(
    'code', 'WF-1', 'name', 'WF route', 'transport_type', 'minibus',
    'origin_label', 'WF origin', 'destination_label', 'WF destination',
    'directions', jsonb_build_array(jsonb_build_object('direction', 'outbound',
      'stops', jsonb_build_array(
        jsonb_build_object('stop_id', '22222222-0000-0000-0000-0000000000a1'),
        jsonb_build_object('stop_id', '22222222-0000-0000-0000-0000000000a2'),
        jsonb_build_object('stop_id', '22222222-0000-0000-0000-0000000000a3')),
      'geometry', '{"type":"LineString","coordinates":[[0.001,0.001],[0.003,0.003]]}'::jsonb,
      'geometry_source', 'fictional')))) $$, 'saving unchanged data works');
select is((select verification_status::text from public.routes where id = (select id from wf)), 'verified',
  'an unchanged save keeps the route verified');

select lives_ok($$ update public.routes set name = 'WF route renamed' where id = (select id from wf) $$, 'a route can be renamed');
select is((select verification_status::text from public.routes where id = (select id from wf)), 'unverified',
  'editing a verified route returns it to unverified');

-- ---------------------------------------------------------------------------
-- Import
-- ---------------------------------------------------------------------------
select lives_ok($$ select public.commit_import(jsonb_build_object(
    'batch', jsonb_build_object('id', 'cccccccc-0000-0000-0000-0000000000c1', 'source_description', 'fictional import'),
    'stops', jsonb_build_array(
      jsonb_build_object('ref', 's1', 'name', 'WF import stop 1', 'latitude', 0.011, 'longitude', 0.011, 'is_sample', true),
      jsonb_build_object('ref', 's2', 'name', 'WF import stop 2', 'latitude', 0.012, 'longitude', 0.012, 'is_sample', true)),
    'routes', jsonb_build_array(jsonb_build_object('ref', 'r1', 'name', 'WF import route', 'transport_type', 'multicab', 'is_sample', true)),
    'route_stops', jsonb_build_array(
      jsonb_build_object('route_ref', 'r1', 'stop_ref', 's1', 'direction', 'outbound', 'stop_order', 1),
      jsonb_build_object('route_ref', 'r1', 'stop_ref', 's2', 'direction', 'outbound', 'stop_order', 2)),
    'fares', jsonb_build_array(jsonb_build_object('route_ref', 'r1', 'from_stop_ref', 's1', 'to_stop_ref', 's2',
      'passenger_type', 'regular', 'amount', 0.01, 'effective_from', '2026-01-01')))) $$, 'a valid import commits');
select is((select count(*)::int from public.routes where import_batch_id = 'cccccccc-0000-0000-0000-0000000000c1'), 1, 'imported route is tagged with the batch');
select is((select imported_by from public.import_batches where id = 'cccccccc-0000-0000-0000-0000000000c1'),
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'the batch records the administrator');
select is((select status::text || '/' || verification_status::text from public.routes where import_batch_id = 'cccccccc-0000-0000-0000-0000000000c1'),
  'draft/unverified', 'imported routes are draft and unverified');
select throws_ok($$ select public.verify_route(
    (select id from public.routes where import_batch_id = 'cccccccc-0000-0000-0000-0000000000c1'), '2026-01-15', 'fictional',
    '{"transport_type":true,"name_direction":true,"endpoints":true,"stops":true,"geometry":true,
      "boarding_dropoff":true,"fares":true,"passenger_categories":true}'::jsonb) $$,
  '23514', 'Sample routes cannot be verified', 'imported sample routes cannot be verified');

select throws_ok($$ select public.commit_import(jsonb_build_object(
    'batch', jsonb_build_object('id', 'cccccccc-0000-0000-0000-0000000000c2', 'source_description', 'fictional import'),
    'stops', jsonb_build_array(jsonb_build_object('ref', 's1', 'name', 'WF rollback stop', 'latitude', 0.021, 'longitude', 0.021)),
    'routes', jsonb_build_array(jsonb_build_object('ref', 'r1', 'name', 'WF rollback route', 'transport_type', 'minibus')),
    'route_stops', jsonb_build_array(
      jsonb_build_object('route_ref', 'r1', 'stop_ref', 's1', 'direction', 'outbound', 'stop_order', 1),
      jsonb_build_object('route_ref', 'r1', 'stop_ref', 's1', 'direction', 'outbound', 'stop_order', 2)))) $$,
  '23505', null, 'an invalid import fails');
select is((select count(*)::int from public.stops where name = 'WF rollback stop'), 0, 'a failed import leaves nothing behind');
select is((select count(*)::int from public.import_batches where id = 'cccccccc-0000-0000-0000-0000000000c2'), 0, 'a failed import records no batch');

select throws_ok($$ update public.import_batches set notes = 'x' $$, '42501', null, 'import batches cannot be edited');

reset role;
select * from finish();
rollback;
