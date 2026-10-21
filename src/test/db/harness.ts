import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Runs the real migrations in an in-process Postgres (PGlite) so the SQL
 * (triggers, RLS, RPC functions) is exercised by `npm test` without Docker.
 *
 * PGlite has no PostGIS, so geometry is shimmed as jsonb GeoJSON and the few
 * PostGIS calls the schema makes are replaced. Everything else (RLS, roles,
 * constraints, plpgsql) is the real thing. The pgTAP tests in
 * supabase/tests/database remain the check against real PostGIS.
 */

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../supabase/migrations");

const SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create schema extensions;
  create extension btree_gist with schema extensions;
  create extension pgcrypto with schema extensions;
  create domain extensions.geometry as jsonb;
  create function extensions.geometrytype(g jsonb) returns text language sql immutable as
    $$ select upper(g ->> 'type') $$;
  create function extensions.st_geomfromgeojson(t text) returns jsonb language sql immutable as
    $$ select t::jsonb $$;
  create function extensions.st_setsrid(g jsonb, srid integer) returns jsonb language sql immutable as
    $$ select g $$;
  create function extensions.st_asgeojson(g jsonb) returns text language sql immutable as
    $$ select g::text $$;
  grant usage on schema auth, extensions to anon, authenticated;
  grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
  set search_path = public, extensions;
`;

/** Adapts PostGIS-specific statements in a migration for the shim. */
function patch(sql: string): string {
  return sql
    .replace(/create extension if not exists postgis[^;]*;/i, "")
    .replace(/extensions\.geometry\(Geometry,\s*4326\)/g, "extensions.geometry")
    .replace(/create index route_shapes_geometry_idx[^;]*;/i, "");
}

export type Db = Awaited<ReturnType<typeof createDb>>;

export async function createDb() {
  const pg = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await pg.exec(SHIM);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(patch(readFileSync(path.join(MIGRATIONS, file), "utf8")));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  /** Runs `fn` as an API role (RLS applies) with the given user id. */
  async function as<T>(role: "anon" | "authenticated", userId: string | null, fn: () => Promise<T>): Promise<T> {
    const claims = userId ? { sub: userId, role } : { role };
    await pg.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await pg.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claims', '', false)");
    }
  }

  async function createUser(admin: boolean): Promise<string> {
    const { rows } = await pg.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
      `${Math.random().toString(36).slice(2)}@example.test`,
    ]);
    if (admin) await pg.query("insert into private.admin_users (user_id) values ($1)", [rows[0].id]);
    return rows[0].id;
  }

  return { pg, as, createUser };
}

export const line = (...pts: [number, number][]) => ({ type: "LineString", coordinates: pts });
