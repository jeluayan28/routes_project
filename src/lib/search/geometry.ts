import type { RideGeometry } from "@/lib/search/types";
import type { Coordinate } from "@/lib/validation/transport";

const METERS_PER_DEGREE = 111_320;

type Projection = { part: number; position: number; point: Coordinate; meters: number };

/** Nearest point on a line to `p` (planar approximation, fine at city scale). */
function project(part: number, line: readonly Coordinate[], p: Coordinate): Projection {
  const kx = Math.cos((p.lat * Math.PI) / 180) * METERS_PER_DEGREE;
  const ky = METERS_PER_DEGREE;
  let best: Projection = { part, position: 0, point: line[0], meters: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
    const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const meters = Math.hypot(ax + t * dx, ay + t * dy);
    if (meters < best.meters) {
      best = {
        part,
        position: i + t,
        point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
        meters,
      };
    }
  }
  return best;
}

const nearest = (lines: readonly (readonly Coordinate[])[], p: Coordinate) =>
  lines.map((l, i) => project(i, l, p)).reduce((a, b) => (b.meters < a.meters ? b : a));

/** Vertices of `line` strictly between two positions, as coordinates. */
function between(line: readonly Coordinate[], from: number, to: number): Coordinate[] {
  const out: Coordinate[] = [];
  for (let i = Math.floor(from) + 1; i <= Math.ceil(to) - 1; i++) if (i > from && i < to) out.push(line[i]);
  return out;
}

const sameSpot = (a: Coordinate, b: Coordinate) => a.lat === b.lat && a.lng === b.lng;

/** Removes consecutive repeated points (a stop that sits exactly on a vertex). */
const tidy = (line: Coordinate[]): Coordinate[] => line.filter((p, i) => i === 0 || !sameSpot(p, line[i - 1]));

/**
 * The part of a route's recorded geometry travelled between two stops.
 *
 * Only recorded geometry is ever returned. If the route has none, if either
 * stop is further than `toleranceMeters` from the line, or if the stops do not
 * fall in travel order along it, the result says so and nothing is drawn. Stops
 * are never joined with straight lines.
 */
export function sliceGeometry(
  lines: readonly (readonly Coordinate[])[],
  board: Coordinate,
  alight: Coordinate,
  toleranceMeters = 75,
): RideGeometry {
  const usable = lines.filter((l) => l.length >= 2);
  if (usable.length === 0) return { status: "unavailable", reason: "not-recorded" };

  const b = nearest(usable, board);
  const a = nearest(usable, alight);
  if (b.meters > toleranceMeters || a.meters > toleranceMeters) {
    return { status: "unavailable", reason: "stops-not-on-geometry" };
  }

  if (b.part === a.part) {
    if (a.position <= b.position) return { status: "unavailable", reason: "order-mismatch" };
    const line = usable[b.part];
    return { status: "ok", lines: [tidy([b.point, ...between(line, b.position, a.position), a.point])] };
  }
  if (b.part > a.part) return { status: "unavailable", reason: "order-mismatch" };

  // The route is recorded in several pieces: return each piece travelled, with gaps left empty.
  const out: Coordinate[][] = [[b.point, ...usable[b.part].slice(Math.floor(b.position) + 1)]];
  for (let p = b.part + 1; p < a.part; p++) out.push([...usable[p]]);
  out.push([...usable[a.part].slice(0, Math.floor(a.position) + 1), a.point]);
  return { status: "ok", lines: out.map(tidy).filter((l) => l.length >= 2) };
}
