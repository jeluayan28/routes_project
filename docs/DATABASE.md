# Database (Supabase / PostgreSQL)

The schema lives in `supabase/migrations/` and is applied in filename order. It
creates **structure only**. No routes, stops, fares or landmarks are inserted
anywhere in the repo; `supabase/seed.sql` is intentionally empty. Test fixtures
exist only inside `supabase/tests/`, in transactions that roll back.

## Tables

| Table | Purpose |
|---|---|
| `routes` | A jeepney/multicab line. `code` is unique when present. `status` (`draft/active/inactive`) and `verification_status` (`unverified/verified/outdated`). |
| `stops` | A physical stop (lat/lng validated). `pickup_allowed` / `dropoff_allowed` are the defaults for the stop. |
| `route_stops` | Ordered stops per route **and direction**. Optional per-route `boarding_allowed` / `dropoff_allowed` override (NULL = follow the stop). |
| `route_shapes` | PostGIS `LineString`/`MultiLineString` (SRID 4326), one per route direction. |
| `fare_rules` | `numeric(8,2)` PHP amounts per passenger type (`regular/student/senior/pwd`) with effective dates. Flat route fare (stops NULL) or stop-to-stop. |
| `landmarks` | Named places for the origin/destination pickers. |
| `route_reports` | Public correction reports. Write-only for the public. |
| `audit_logs` | Append-only log of administrator changes. |
| `private.admin_users` | Administrator allow-list (not exposed through the API). |

`public.route_shapes_geojson` is a `security_invoker` view returning shapes as GeoJSON.

### Reverse directions

A route has up to two directions, `outbound` (`origin_label` → `destination_label`)
and `inbound` (the return trip). Each direction has its **own** ordered stop list
and its **own** shape, because return trips on jeepney/multicab lines often use
different streets. A one-way route simply has no `inbound` rows. The same stop can
appear in both directions. Within one direction, `stop_order` is unique (the
constraint is deferrable so a reorder can happen in one transaction) and a stop
cannot appear twice (loop routes that revisit a stop are not supported yet).

### Integrity rules (enforced by the database)

latitude ∈ [-90, 90], longitude ∈ [-180, 180]; fares `>= 0`, PHP only;
`effective_until >= effective_from`; overlapping fare periods for the same
route/stops/passenger type are rejected (exclusion constraint); a stop-to-stop
fare must use stops that are on that route; `verified` records require a
verification timestamp; geometries must be line types. Timestamps are
`timestamptz` (UTC) set by the database; `updated_at` is maintained by trigger.
Fare effective dates are calendar `date`s read as Asia/Manila dates.

## Security model

**Who is an administrator.** Only accounts listed in `private.admin_users`.
That table is outside the API-exposed schemas and no API role has any privilege
on it, so the only way to be added is direct database access (SQL editor,
migration). `private.is_admin()` checks the signed-in user's id against it and
never reads `user_metadata`, so users cannot promote themselves by editing their
profile. Anonymous sign-ins are not treated as admins.

**Public access (anon and signed-in non-admins).**

| Data | Visible when |
|---|---|
| routes | `status = 'active'` and `verification_status = 'verified'` |
| route_stops, route_shapes, fare_rules | the route is public, and the row/stop is `verified` |
| stops, landmarks | `verification_status = 'verified'` |
| route_reports | insert only (see below); never readable |
| audit_logs, admin_users | never |

There are no insert/update/delete grants for the public on any transport table.
Grants are explicit and minimal on top of RLS (defense in depth), and default
privileges for new `public` tables are revoked.

**Administrators** sign in through Supabase Auth and use the normal browser/server
client; RLS lets them read and write everything. **No service-role/secret key is
used by the app or needed for admin work.** Never place one in client code or a
`NEXT_PUBLIC_` variable.

**Anonymous reports.** `description` must be 10–2000 characters, `reporter_contact`
(optional, private) at most 200. Only `route_id, stop_id, report_type, description,
reporter_contact` can be supplied; `status` is forced to `new`. A report may only
reference a public route/stop (so it can't probe for drafts). A trigger limits each
client to 5 reports/hour and everyone to 300/hour, keyed by a salted hash of the
client IP (the IP itself is not stored). Only administrators can read reports.
Limits of this approach: it is a safety net. For a hostile spammer, add CAPTCHA or
an edge rate limit in front of a server-side submission route.

**Audit log.** Triggers record inserts/updates/deletes on managed tables with the
acting `auth.uid()` (NULL for changes made in the SQL editor). It is append-only,
readable only by admins, and omits reporter contact details.

## Local development

Requires Docker Desktop. The CLI is a pinned dev dependency.

```bash
npm install
npm run db:start      # starts local Postgres/Auth/REST and applies migrations
npx supabase status   # prints the local URL and publishable key
npm run db:test       # security + integrity tests (pgTAP)
npm run db:reset      # rebuild from migrations (empty database)
npm run db:types      # regenerate src/types/database.ts
npm run db:stop
```

Put the local URL and publishable key from `supabase status` in `.env.local`
(see `.env.example`). Sample queries: `supabase/queries/sample-queries.sql`.

## Creating the hosted project and applying migrations

1. Create a project at <https://supabase.com/dashboard> (choose a region near
   the Philippines, e.g. Singapore). Save the database password.
2. `npx supabase login` (use a scoped access token in CI), then
   `npx supabase link --project-ref <ref>`.
3. `npx supabase db push` to apply the migrations in order. Check with
   `npx supabase migration list`.
4. `npx supabase db advisors --linked` and review the output.
5. Copy `.env.example` to `.env.local`, fill in the project URL and publishable
   key (Project Settings → API Keys). Add the same variables in Vercel.
6. Create your admin (below), then regenerate types if the schema changed.

Migrations are forward-only and additive. To change the schema later, add a new
migration with `npx supabase migration new <name>`; never edit an applied one.

## Manual dashboard steps

These cannot be done by migration:

1. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign
   up" (administrators are created by you), keep anonymous sign-ins **off**, keep
   Email on, and keep email confirmation on. (`config.toml` only controls the
   local stack.) Consider requiring MFA for admin accounts.
2. **Authentication → Users → Add user:** create each administrator account.
3. **SQL editor:** promote them:
   ```sql
   insert into private.admin_users (user_id, note)
   select id, 'initial admin' from auth.users where email = '<admin email>';
   ```
4. **Authentication → URL Configuration:** set the Site URL and redirect URLs
   for your deployed domain and `http://localhost:3000`.
5. **Project Settings → API / Data API:** confirm only `public` (and
   `graphql_public`) are exposed. **`private` must not be exposed.**
6. **Project Settings → API Keys:** use the publishable key in the app. Keep the
   secret key out of the repo and out of Vercel unless a server-only job needs it.
7. Optional: enable backups/PITR on a paid plan before holding real data.

## Known trade-offs

- The advisor reports "multiple permissive policies" (performance, not security)
  on SELECT for signed-in users, because public-read and admin policies are kept
  separate for readability. These tables are small.
- The map and route pages read approved routes through `src/lib/data/routes.ts`
  (see `docs/MAP.md`). Fares are not mapped yet; `Route.fares` is empty for
  database routes. The DB has no `sample` verification status, only fixtures do.
