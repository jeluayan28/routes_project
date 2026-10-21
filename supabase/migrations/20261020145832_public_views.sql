-- Read-only helper view so clients get shapes as GeoJSON instead of raw PostGIS
-- hex. security_invoker makes the view obey the caller's RLS on route_shapes,
-- so it exposes exactly what the table already exposes.

create view public.route_shapes_geojson
with (security_invoker = true) as
select
  id,
  route_id,
  direction,
  extensions.st_asgeojson(geometry)::jsonb as geojson,
  source,
  verification_status,
  last_verified_at
from public.route_shapes;

revoke all on public.route_shapes_geojson from public, anon, authenticated;
grant select on public.route_shapes_geojson to anon, authenticated;
