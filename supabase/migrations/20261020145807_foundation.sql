-- Foundation: extensions, enums, the private schema, and administrator identity.
--
-- Administrators are identified by a row in private.admin_users. That table is
-- not in an API-exposed schema and no API role has any privilege on it, so the
-- only way to become an administrator is to be inserted by someone with direct
-- database access (SQL editor / migration / service role). Nothing derived
-- from user-editable metadata (raw_user_meta_data / user_metadata) is trusted.

create extension if not exists postgis with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.transport_type as enum ('jeepney', 'multicab');

-- Lifecycle of a route. Only 'active' routes can ever be public.
create type public.route_status as enum ('draft', 'active', 'inactive');

-- Whether a record has been checked against a trustworthy source.
-- Only 'verified' records can ever be public. There is deliberately no
-- 'sample' value: development fixtures never live in this database.
create type public.verification_status as enum ('unverified', 'verified', 'outdated');

-- Reverse directions are separate, explicit directions of the same route
-- (see the comment on public.route_stops).
create type public.route_direction as enum ('outbound', 'inbound');

create type public.passenger_type as enum ('regular', 'student', 'senior', 'pwd');

create type public.report_type as enum (
  'incorrect_route',
  'incorrect_stop',
  'incorrect_fare',
  'missing_route',
  'missing_stop',
  'other'
);

create type public.report_status as enum ('new', 'reviewing', 'resolved', 'rejected');

create type public.audit_action as enum ('insert', 'update', 'delete');

-- ---------------------------------------------------------------------------
-- Private schema (never added to the API's exposed schemas)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
-- anon/authenticated need USAGE so RLS policies can call private.is_admin().
-- That grants no access to any table in the schema.
grant usage on schema private to anon, authenticated;

create table private.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);
comment on table private.admin_users is
  'Allow-list of administrator accounts. Managed only with direct database access.';

alter table private.admin_users enable row level security;
revoke all on private.admin_users from public, anon, authenticated;

-- True only for a signed-in, non-anonymous user that is on the allow-list.
-- SECURITY DEFINER so it can read the locked-down table; it takes no input and
-- only ever answers about the caller (auth.uid()).
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (
      select 1
      from private.admin_users a
      where a.user_id = (select auth.uid())
    );
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest regardless of what the client sends.
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
