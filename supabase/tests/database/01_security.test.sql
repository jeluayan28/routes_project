-- Security tests: RLS, grants, administrator identity, report abuse limits.
-- Run with:  npx supabase test db
--
-- All fixtures below are FICTIONAL and exist only inside this transaction,
-- which is rolled back at the end. Nothing here is real Butuan data.

begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the postgres owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@test.invalid', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'visitor@test.invalid',
     '{"role":"admin","is_admin":true}');   -- user-editable metadata must NOT confer admin

insert into private.admin_users (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001');

insert into public.routes (id, code, name, transport_type, status, verification_status, last_verified_at) values
  ('11111111-0000-0000-0000-000000000001', 'T-PUB',   'Test public',     'jeepney',  'active',   'verified',   now()),
  ('11111111-0000-0000-0000-000000000002', 'T-DRAFT', 'Test draft',      'jeepney',  'draft',    'verified',   now()),
  ('11111111-0000-0000-0000-000000000003', 'T-INACT', 'Test inactive',   'multicab', 'inactive', 'verified',   now()),
  ('11111111-0000-0000-0000-000000000004', 'T-UNVER', 'Test unverified', 'multicab', 'active',   'unverified', null);

insert into public.stops (id, name, latitude, longitude, verification_status, last_verified_at) values
  ('22222222-0000-0000-0000-000000000001', 'Test stop 1', 8.95, 125.54, 'verified',   now()),
  ('22222222-0000-0000-0000-000000000002', 'Test stop 2', 8.96, 125.55, 'verified',   now()),
  ('22222222-0000-0000-0000-000000000003', 'Test stop 3', 8.97, 125.56, 'unverified', null);

insert into public.route_stops (route_id, stop_id, direction, stop_order) values
  ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'outbound', 1),
  ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'outbound', 2),
  ('11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'outbound', 3),
  ('11111111-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'outbound', 1);

insert into public.route_shapes (route_id, direction, geometry, verification_status, last_verified_at) values
  ('11111111-0000-0000-0000-000000000001', 'outbound',
     extensions.st_geomfromtext('LINESTRING(125.54 8.95, 125.55 8.96)', 4326), 'verified', now()),
  ('11111111-0000-0000-0000-000000000002', 'outbound',
     extensions.st_geomfromtext('LINESTRING(125.54 8.95, 125.55 8.96)', 4326), 'verified', now());

insert into public.fare_rules
  (route_id, passenger_type, amount, effective_from, verification_status, verified_at) values
  ('11111111-0000-0000-0000-000000000001', 'regular', 10.00, '2026-01-01', 'verified',   now()),
  ('11111111-0000-0000-0000-000000000001', 'student',  8.00, '2026-01-01', 'unverified', null),
  ('11111111-0000-0000-0000-000000000002', 'regular', 10.00, '2026-01-01', 'verified',   now());

insert into public.landmarks (name, category, latitude, longitude, verification_status) values
  ('Test landmark verified',   'test', 8.95, 125.54, 'verified'),
  ('Test landmark unverified', 'test', 8.95, 125.54, 'unverified');

-- ---------------------------------------------------------------------------
-- Anonymous visitors: read only approved, active data
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is((select count(*)::int from public.routes), 1,
  'anon sees only the active+verified route');
select is((select code from public.routes), 'T-PUB', 'anon sees the right route');
select is((select count(*)::int from public.stops), 2, 'anon sees only verified stops');
select is((select count(*)::int from public.route_stops), 2,
  'anon sees route_stops only for public routes and verified stops');
select is((select count(*)::int from public.route_shapes), 1,
  'anon sees shapes only for public routes');
select is((select count(*)::int from public.route_shapes_geojson), 1,
  'geojson view obeys RLS');
select is((select count(*)::int from public.fare_rules), 1,
  'anon sees only verified fares of public routes');
select is((select count(*)::int from public.landmarks), 1, 'anon sees only verified landmarks');

select throws_ok($$ insert into public.routes (name, transport_type) values ('x', 'jeepney') $$,
  '42501', null, 'anon cannot insert routes');
select throws_ok($$ update public.routes set name = 'hacked' $$,
  '42501', null, 'anon cannot update routes');
select throws_ok($$ delete from public.routes $$,
  '42501', null, 'anon cannot delete routes');
select throws_ok($$ insert into public.fare_rules (route_id, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', 1, '2030-01-01') $$,
  '42501', null, 'anon cannot insert fare rules');
select throws_ok($$ update public.fare_rules set amount = 0 $$,
  '42501', null, 'anon cannot update fare rules');
select throws_ok($$ select * from public.route_reports $$,
  '42501', null, 'anon cannot read reports');
select throws_ok($$ select * from public.audit_logs $$,
  '42501', null, 'anon cannot read audit logs');
select throws_ok($$ select * from private.admin_users $$,
  '42501', null, 'anon cannot read the admin allow-list');
select throws_ok($$ insert into private.admin_users (user_id)
  values ('bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501', null, 'anon cannot make anyone an admin');
select is(private.is_admin(), false, 'anon is not an admin');

-- ---------------------------------------------------------------------------
-- Anonymous reports: validated, constrained, rate limited
-- ---------------------------------------------------------------------------
set local request.headers = '{"cf-connecting-ip":"203.0.113.7"}';

select lives_ok($$ insert into public.route_reports (route_id, report_type, description)
  values ('11111111-0000-0000-0000-000000000001', 'incorrect_fare', 'The fare listed is outdated.') $$,
  'anon can report a public route');
select lives_ok($$ insert into public.route_reports (report_type, description, reporter_contact)
  values ('missing_route', 'There is a route near the market that is missing.', 'me@example.test') $$,
  'anon can submit a general report with optional contact');
select throws_ok($$ insert into public.route_reports (report_type, description)
  values ('other', 'short') $$,
  '23514', null, 'too-short description is rejected');
select throws_ok($$ insert into public.route_reports (report_type, description)
  values ('other', repeat('x', 2001)) $$,
  '23514', null, 'too-long description is rejected');
select throws_ok($$ insert into public.route_reports (route_id, report_type, description)
  values ('11111111-0000-0000-0000-000000000002', 'other', 'Probing for a draft route id.') $$,
  '42501', null, 'report cannot reference an unpublished route');
select throws_ok($$ insert into public.route_reports (report_type, description, status)
  values ('other', 'Trying to set my own status.', 'resolved') $$,
  '42501', null, 'anon cannot set report status');

select lives_ok($$ insert into public.route_reports (report_type, description)
  values ('other', 'Report number three from this client.') $$, 'report 3 ok');
select lives_ok($$ insert into public.route_reports (report_type, description)
  values ('other', 'Report number four from this client.') $$, 'report 4 ok');
select lives_ok($$ insert into public.route_reports (report_type, description)
  values ('other', 'Report number five from this client.') $$, 'report 5 ok');
select throws_ok($$ insert into public.route_reports (report_type, description)
  values ('other', 'Report number six from this client.') $$,
  'P0001', 'Too many reports. Please try again later.', 'sixth report within the hour is throttled');

set local request.headers = '{"cf-connecting-ip":"203.0.113.99"}';
select lives_ok($$ insert into public.route_reports (report_type, description)
  values ('other', 'A different client is not throttled.') $$,
  'throttle is per client');

-- ---------------------------------------------------------------------------
-- Signed-in non-admin (with admin-looking user metadata): still just public
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated","user_metadata":{"role":"admin","is_admin":true},"app_metadata":{}}';

select is(private.is_admin(), false, 'user_metadata cannot confer admin');
select is((select count(*)::int from public.routes), 1, 'non-admin sees only public routes');
select throws_ok($$ insert into public.routes (name, transport_type) values ('x', 'jeepney') $$,
  '42501', null, 'non-admin cannot insert routes (RLS)');
select throws_ok($$ insert into public.fare_rules (route_id, amount, effective_from)
  values ('11111111-0000-0000-0000-000000000001', 1, '2030-01-01') $$,
  '42501', null, 'non-admin cannot insert fare rules (RLS)');
select throws_ok($$ insert into private.admin_users (user_id)
  values ('bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501', null, 'signed-in user cannot self-promote');
select is((select count(*)::int from public.route_reports), 0, 'non-admin cannot read reports');
select is((select count(*)::int from public.audit_logs), 0, 'non-admin cannot read audit logs');

-- UPDATE/DELETE on a row the user can see but may not change affect 0 rows.
update public.routes set name = 'hacked' where id = '11111111-0000-0000-0000-000000000001';
delete from public.routes where id = '11111111-0000-0000-0000-000000000001';
reset role;
select is((select name from public.routes where id = '11111111-0000-0000-0000-000000000001'),
  'Test public', 'non-admin update/delete changed nothing');

-- ---------------------------------------------------------------------------
-- Administrator
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(private.is_admin(), true, 'allow-listed account is an admin');
select is((select count(*)::int from public.routes), 4, 'admin sees every route incl. drafts');
select lives_ok($$ insert into public.routes (id, name, transport_type)
  values ('11111111-0000-0000-0000-0000000000aa', 'Admin created', 'jeepney') $$,
  'admin can insert routes');
select lives_ok($$ update public.routes set description = 'edited'
  where id = '11111111-0000-0000-0000-0000000000aa' $$, 'admin can update routes');
select is((select count(*)::int from public.audit_logs
  where admin_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and entity_id = '11111111-0000-0000-0000-0000000000aa'), 2,
  'admin changes are audited with the admin id');
select is((select count(*)::int from public.route_reports) > 0, true, 'admin can read reports');
select is((select reporter_contact from public.route_reports
  where reporter_contact is not null limit 1), 'me@example.test', 'admin can read reporter contact');
select lives_ok($$ update public.route_reports set status = 'reviewing' $$, 'admin can triage reports');
select is((select count(*)::int from public.audit_logs
  where entity_type = 'route_reports' and changes ? 'reporter_contact'), 0,
  'audit log never stores reporter contact');
select throws_ok($$ update public.audit_logs set action = 'delete' $$,
  '42501', null, 'audit log cannot be updated through the API');
select throws_ok($$ delete from public.audit_logs $$,
  '42501', null, 'audit log cannot be deleted through the API');
select throws_ok($$ select * from private.admin_users $$,
  '42501', null, 'even admins cannot read the allow-list through the API');

reset role;

-- The append-only trigger also stops privileged roles.
select throws_ok($$ delete from public.audit_logs $$,
  '42501', 'audit_logs is append-only', 'audit log is append-only for everyone');

select * from finish();
rollback;
