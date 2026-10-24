# Route data administration

How routes, stops, geometry and fares get into the database, how they are checked, and how they become public.

**Nothing in this repository is real Butuan transport data.** No routes, stops, terminals, fares or operating hours are
supplied. Every record has to be entered by an administrator from a real source, and the app is built so that data
which has not been checked cannot appear as a confirmed service.

## The rule that protects the public

A route is shown to the public only when it is **active and verified**. Drafts, inactive routes, unverified routes,
outdated routes and sample data are never public (enforced by row-level security, not just the UI).

| What you want to do | Result |
|---|---|
| Create a route in the editor | Always saved as a **draft, unverified**. |
| Import a CSV | Always a **draft, unverified**. CSV files cannot set a status or verify anything. |
| Set a route to *active* | Still **not public** until it is verified. |
| Verify a route | Possible only through the verification form (source, date, full checklist). Public once it is also active. |
| Edit anything that was verified | The route goes back to **unverified** (hidden) until it is verified again. |
| Mark a route's verification outdated | Hidden until verified again. |
| Anything marked **sample** | Can never be verified, so can never be public. |

"Anything that was verified" includes the route name, code, transport type and start/end labels, a stop's name, location
or boarding/drop-off setting, the stop list and order, and the geometry. New or edited fares are saved unverified and stay
hidden until the route is verified.

## One-time setup

1. Apply the migrations (`docs/DATABASE.md`).
2. In the Supabase dashboard, create each administrator under **Authentication → Users** (sign-ups should be off).
3. Promote them in the SQL editor (this cannot be done from the app, on purpose):

   ```sql
   insert into private.admin_users (user_id, note)
   select id, 'initial admin' from auth.users where email = '<admin email>';
   ```
4. Sign in at `/admin/login`. Signed-in users who are not on the list see "not an administrator". Every admin page and
   every Server Action re-checks the list, and the database enforces it again.

## Admin area

| Page | Purpose |
|---|---|
| `/admin` | Progress dashboard (below). |
| `/admin/routes` | All routes with their state, whether they are public, stop and fare counts. Filters: draft, verified, needs review, missing fares, outdated, sample, or one import batch. |
| `/admin/routes/new`, `/admin/routes/[id]` | The route editor. |
| `/admin/stops` | Find and fix stops, especially those with incomplete coordinates. |
| `/admin/import` | CSV import with preview, and recent import history. |

### The route editor

* **Details**: name, code, transport type, start and end points, description.
* **Directions & stops**: each direction (outbound, inbound) has its own ordered stop list. A route with no inbound
  direction is one-way; nothing is assumed to be symmetric. Add stops by **searching existing stops** (preferred, avoids
  duplicates), **picking a location on the map**, or **typing coordinates** (validated: decimal degrees, latitude −90…90,
  longitude −180…180, not 0,0, and a warning if the point is outside the Butuan area, which usually means swapped values).
  Reorder with the up/down buttons. Each stop can *follow the stop's own* boarding/drop-off setting or be restricted or
  allowed for this route only.
* **Geometry**: per direction. Paste or type `latitude, longitude` lines (a blank line separates separate lines), paste
  GeoJSON, or click points along the road. There is deliberately no "connect the stops" button: a straight line between
  stops is not a route path. With no geometry recorded, no line is drawn. Record where the geometry came from.
* **Fares** (after the route is saved): flat route fares or origin→destination fares, with passenger category (regular,
  student, senior, PWD), amount, effective-from and optional effective-until dates, and a source. The database rejects
  negative amounts, overlapping periods for the same route/stops/category, and stops that are not on the route.
* **Verification & status**: set active, inactive or draft; mark outdated; the verification form and its history.

Saving writes the route, its stops and its geometry in one database transaction. The editor warns before you leave with
unsaved changes, and verification is only possible for what is saved.

### Verifying a route

Verify only against a trustworthy source (a survey, an official document, riding the route). You confirm eight things:

1. Transport type
2. Route name and each direction
3. Starting and ending points
4. Intermediate stops (and their order)
5. Route geometry
6. Boarding and drop-off permissions
7. Fare rules (or that none are recorded)
8. Passenger categories

and give the **date the source was checked** (today or earlier, Philippine date) and the **source**. The database also
requires: start and end labels, at least two outbound stops, recorded outbound geometry, inbound geometry if the inbound
direction has stops, and no sample stop or stop at 0,0. On success the route, its stops, shapes and fares become verified
together, and a verification record (administrator, date, source, checks, notes) is kept. The public "last verified" date is
the date you entered, not the day you clicked.

## Reports, audit log, preview and stops

* **`/admin/reports`**: public correction reports, filterable (all, open, pending, reviewed, resolved, rejected) and paginated. Set a
  status with the buttons (resolving or rejecting asks first). In the database these are `new`, `reviewing`, `resolved`, `rejected`;
  administrators see Pending, Reviewed, Resolved, Rejected. The reporter contact is shown only here, never publicly, and is kept out
  of the audit log. Only the `status` column can be changed.
* **`/admin/audit`**: the append-only log of changes to routes, route approvals, fares, stops, geometry and reports, newest first,
  with who did it (the account id, not an email) and what changed, filterable by kind and paginated. For updates it stores the
  previous values (`audit_logs.previous`), which is how "route deactivated" and "fare price changed (₱12.00 to ₱13.00)" are known.
* **Route preview**: a tab in the route editor that renders the public route page from the current draft (including unsaved
  changes), and says whether and why the route is public right now.
* **Stops**: after choosing a location the editor lists recorded stops within 150 m. A stop within 15 m is flagged as a possible
  duplicate; creating it needs a confirmation, and the server enforces that too.
* **Fares**: the list shows each fare's source and verification date. Verified fares offer **Change price** and **End fare** instead of
  edit and delete (history is kept, see `docs/FARES.md`). An overlapping period is reported before saving, and refused by the database.

## Progress dashboard

| Card | Definition |
|---|---|
| Active routes | Status is active (sample routes excluded). |
| Draft routes | Status is draft. |
| Verified stops | Verification status is verified (sample stops excluded). |
| Fare rules needing verification | On a real route, and unverified, outdated, or verified more than 180 days ago. |
| Pending public reports | Reports with status new (nobody has looked at them). |
| Recently updated | The ten newest audit-log entries. |
| Verified routes | Verified, and last verified no more than 180 days ago. |
| Routes needing review | Not draft, and: marked outdated, **or** verified more than 180 days ago, **or** active but not verified, **or** has an open correction report (new or reviewing). |
| Routes missing fare records | No fare rule at all. |
| Stops with incomplete coordinates | Placeholder (0, 0), non-numeric, or far outside Butuan City. The database requires coordinates, so a stop cannot have none; these are the ones that cannot be right. |
| Outdated verification records | Routes, stops, shapes and fares marked outdated or verified more than 180 days ago. |

Sample records are counted separately and never appear in these lists. The 180-day limit
(`VERIFICATION_STALE_AFTER_DAYS`) and the Butuan sanity box (`BUTUAN_SERVICE_AREA`) are in `src/lib/constants.ts`.

## CSV import

Four optional files, in any combination: `stops.csv`, `routes.csv`, `route_stops.csv`, `fare_rules.csv`. UTF-8, a header
row, comma separated, `"` quoting. Header names are case-insensitive. Limits: 2 MB and 5,000 rows per file.

Rows link to each other with a **`ref`** you invent for this import (letters, digits, `_`, `.`, `-`, up to 50), or to records
already in the database by **UUID** (`route_id`, `stop_id`, …). A row uses exactly one of the two for each reference.

**Imports only add.** Nothing existing is updated, replaced, reordered or verified. Anything that would clash is reported
instead (see below).

### `stops.csv`

| Column | Required | Notes |
|---|---|---|
| `ref` | yes | Unique in the file. |
| `name` | yes | ≤ 200 characters. |
| `latitude`, `longitude` | yes | Plain decimals (`8.95`, not `8,95` or `1e1`). Ranges −90…90 / −180…180. `0,0` is rejected. |
| `barangay`, `landmark_description` | no | |
| `pickup_allowed`, `dropoff_allowed` | no | `true/false/yes/no/1/0`. Blank means true. |
| `sample` | no | `true` marks a development record that can never be verified. A name starting with `SAMPLE` or `[SAMPLE]` is treated the same way. |

### `routes.csv`

| Column | Required | Notes |
|---|---|---|
| `ref` | yes | Unique in the file. |
| `name` | yes | |
| `transport_type` | yes | `minibus` or `multicab`. |
| `code`, `description`, `origin_label`, `destination_label` | no | `code` must be unique (case-insensitive) in the file and the database. |
| `sample` | no | As above. |

### `route_stops.csv` (ordered sequences)

| Column | Required | Notes |
|---|---|---|
| `route_ref` **or** `route_id` | yes (one) | A route in `routes.csv`, or an existing route's UUID. |
| `direction` | yes | `outbound` or `inbound`. Each direction is its own sequence. |
| `stop_order` | yes | Whole number ≥ 1. Per route and direction the positions must run 1, 2, 3… with no gaps or repeats. |
| `stop_ref` **or** `stop_id` | yes (one) | A stop in `stops.csv`, or an existing stop's UUID. A stop may appear once per direction. |
| `boarding_allowed`, `dropoff_allowed` | no | Blank follows the stop's own setting; `false` restricts this route only. |

An existing route can be extended only if it is not verified, and only in a direction that has no stops yet.

### `fare_rules.csv`

| Column | Required | Notes |
|---|---|---|
| `route_ref` **or** `route_id` | yes (one) | As above. The route must not be verified. |
| `from_stop_ref`/`from_stop_id`, `to_stop_ref`/`to_stop_id` | no | Give both (an origin→destination fare) or neither (a flat route fare). Different stops, both on the route. |
| `passenger_type` | yes | `regular`, `student`, `senior`, `pwd`. |
| `amount` | yes | Pesos: `12` or `12.50`. Rejected: negative, `₱12`, `12,50`, `1,200`, `1e3`, `12.345`, blank. `0` is accepted with a warning. |
| `effective_from` | yes | `YYYY-MM-DD`, a real date. |
| `effective_until` | no | `YYYY-MM-DD`, not before `effective_from`. Blank means no end date. |
| `source_description` | no | Where the fare came from. |

Columns not listed are rejected. In particular there is no way to set `status` or `verification_status`.

### Sample rows

These are obviously fictional: coordinates near 0°, 0° (the open sea) and amounts of 0.01. They are in
`src/dev-fixtures/import/` and are used by the tests; importing them warns that they are outside Butuan and marks them
as sample data.

`stops.csv`

```csv
ref,name,latitude,longitude,barangay,landmark_description,pickup_allowed,dropoff_allowed,sample
S1,[SAMPLE] Stop One,0.0010,0.0010,Placeholder Barangay,Fictional landmark,true,true,true
S2,[SAMPLE] Stop Two,0.0020,0.0030,,,true,false,true
S3,[SAMPLE] Stop Three,0.0030,0.0050,,,false,true,true
```

`routes.csv`

```csv
ref,code,name,transport_type,description,origin_label,destination_label,sample
R1,SAMPLE-001,[SAMPLE] Placeholder Route,minibus,Fictional route for testing only,Placeholder Origin,Placeholder Destination,true
```

`route_stops.csv` (the inbound direction is its own, different sequence)

```csv
route_ref,direction,stop_order,stop_ref,boarding_allowed,dropoff_allowed
R1,outbound,1,S1,,
R1,outbound,2,S2,,
R1,outbound,3,S3,,
R1,inbound,1,S3,,
R1,inbound,2,S1,,
```

`fare_rules.csv`

```csv
route_ref,from_stop_ref,to_stop_ref,passenger_type,amount,effective_from,effective_until,source_description
R1,S1,S3,regular,0.01,2026-01-01,,FICTIONAL placeholder - not a real fare
R1,S1,S3,student,0.01,2026-01-01,,FICTIONAL placeholder - not a real fare
```

Referring to existing records by UUID (placeholder UUIDs shown):

```csv
route_id,direction,stop_order,stop_id
00000000-0000-4000-8000-000000000001,inbound,1,00000000-0000-4000-8000-000000000002
```

Route geometry is not imported by CSV: record it in the editor so it can be checked on the map.

### What the importer checks

* Column names (unknown, duplicate, empty, missing required) and that every row has the right number of values.
* Required fields; value formats; coordinate ranges; fare amounts and dates; transport type, direction, passenger category.
* References: every `ref` resolves; every UUID is well formed and exists; each reference uses one form, not both.
* Stop ordering per route and direction; a stop not repeated within a direction; fare stops belong to the route.
* Duplicates: repeated `ref`s and route codes; a stop with the same name within 10 m of another (file or database) is an
  **error**; within 150 m, or very close under another name, a **warning**; a route with the same name and type as an existing
  one is a **warning**; overlapping fare periods are an **error** (including against existing fares).
* Existing routes referenced by UUID must not be verified, and an occupied direction cannot be re-imported.

Errors are listed by file, line, column and message, with a preview of the first 50 rows of each file marked OK/warning/error.
The import button stays disabled while there are errors.

### How it is kept safe

1. **Check (step 1)** only reads: it parses, validates against the current database and shows the preview. Nothing is written,
   so **Cancel**, closing the tab, or going back leaves the database untouched.
2. **Confirm (step 3)**: you give the source of the data and acknowledge the preview. The files are validated *again* against
   the database as it is at that moment, then written by one database function (`commit_import`) inside a single transaction.
   Either everything is imported or nothing is.
3. A batch id created at preview time makes a double click or retry harmless ("already committed").
4. An **import batch** is recorded: the administrator's id, time, source, file names with SHA-256 hashes and row counts. Every
   imported route, stop and fare carries the batch id, and `/admin/routes?batch=<id>` lists the batch's routes.

## Reviewing and approving imported data

An import creates drafts. Nothing imported is public until a person has checked it against its source and verified it.

1. **Before importing**: confirm the CSV came from a source you can name. Run the check, read every error and warning, and fix
   the files rather than the data afterwards. Resolve "possible duplicate" warnings: reuse the existing stop by UUID instead.
2. **After importing**: open **Routes → (the batch link)**. The routes are drafts and show *Not public*.
3. **For each route**, open its editor and:
   1. Compare name, code, transport type, start and end points with the source.
   2. On **Directions & stops**, check each direction's stop list against the source, in order, and the boarding/drop-off settings.
      Fix a wrong stop's location on the **Stops** page or replace it.
   3. On **Geometry**, record the real road path for each direction and where it came from (imports carry no geometry).
   4. On **Fares**, check every fare, category and effective date; add missing ones only from a source.
   5. Click **Save changes**.
4. **Verify**: on **Verification & status**, confirm the eight checks against the source, enter the date the source was checked
   and the source, and mark the route verified. If the database refuses, it says what is missing.
5. **Publish**: set the route **active**. It is public only now, because it is both active and verified.
6. **Spot-check** on the public map and route page. If anything is wrong, set the route to inactive (or mark it outdated) and fix it;
   editing a verified route automatically hides it until it is verified again.
7. **Retire a bad import**: routes that were never active or verified can be deleted from the editor. Verified or active routes
   are kept for the record: set them inactive.
8. The dashboard's **Needs review**, **Missing fares** and **Outdated** cards show what is left. Re-verify routes when they pass
   180 days.

A second person reviewing is recommended for the first imports. The audit log and verification history show who changed and
verified what.

## Development fixtures

`src/dev-fixtures/sample-routes.ts` (the public map demo, shown only with `NEXT_PUBLIC_ENABLE_SAMPLE_DATA=true`) and
`src/dev-fixtures/import/*.csv` (the CSV sample) are clearly marked sample data. Imported sample rows get `is_sample = true`,
and the database refuses to verify them (a constraint, plus `verify_route` rejects them), so they cannot be published as
verified routes even by mistake.

## Testing

`npm test` covers the CSV parser and validator (including every rejection rule), the dashboard maths, form and geometry
validation, the Server-Action-facing components, the auth proxy, and the SQL itself: the migrations run in PGlite (Postgres in
WebAssembly) with a small stand-in for PostGIS, exercising `save_route`, `verify_route`, `commit_import`, the verification
guards, RLS and an end-to-end import of the sample CSVs (`src/test/db`).

Not covered, and worth doing before relying on this in production:

* PGlite has no PostGIS, so geometry handling is checked only logically. Run `npm run db:reset && npm run db:test` against the
  real local stack (needs Docker), and try one real save and verification in the editor.
* Signing in and the editor have not been driven in a real browser against a real Supabase project: the component tests mock
  the Server Actions.
