import { createFareResolver, type FareResolver } from "@/lib/search/fares";
import type {
  AcceptedStatus,
  BuildDiagnostics,
  GraphEdge,
  GraphNode,
  Line,
  RawNetwork,
  RawStop,
  SearchOptions,
  TransitNetwork,
} from "@/lib/search/types";
import { distanceMeters } from "@/lib/routes/geometry";
import type { Coordinate } from "@/lib/validation/transport";

export type BuildOptions = Pick<SearchOptions, "passengerCategory" | "date" | "acceptStatuses" | "transportTypes">;

export type BuiltNetwork = TransitNetwork & { fares: FareResolver };

const accepted = (status: string, accept: readonly AcceptedStatus[]) => (accept as readonly string[]).includes(status);

/** A stop is usable only if it is in an accepted status and has a real position. */
export function isUsableStop(stop: RawStop, accept: readonly AcceptedStatus[]): boolean {
  const { lat, lng } = stop.position;
  return (
    accepted(stop.status, accept) &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Builds the transit graph: every usable stop is a node, and each route direction
 * contributes a directed edge between each pair of consecutive stops. Direction
 * is respected (an inbound line is its own chain, never the outbound one reversed)
 * and boarding/drop-off restrictions are recorded on the edges.
 *
 * Whole route directions are left out, and counted in the diagnostics, when their
 * data cannot be trusted: a route not in an accepted status, a stop that is
 * missing or unusable, positions with gaps, or fewer than two stops.
 *
 * Route directions that are identical in every way that matters to a traveller
 * (same transport type, same stops and permissions, same applicable fares) are
 * folded into one so results do not repeat.
 */
export function buildNetwork(raw: RawNetwork, options: BuildOptions): BuiltNetwork {
  const fares = createFareResolver(raw.fares, {
    category: options.passengerCategory,
    date: options.date,
    acceptStatuses: options.acceptStatuses,
  });
  const diagnostics: BuildDiagnostics = {
    excludedUnverifiedRoutes: 0,
    excludedLines: [],
    excludedByTransportFilter: 0,
    duplicateLinesFolded: 0,
    unusableStops: 0,
  };

  const stopsById = new Map(raw.stops.map((s) => [s.id, s]));
  const usable = new Set<string>();
  for (const s of raw.stops) {
    if (isUsableStop(s, options.acceptStatuses)) usable.add(s.id);
    else diagnostics.unusableStops++;
  }

  const types = options.transportTypes && options.transportTypes.length > 0 ? new Set(options.transportTypes) : null;
  const candidates: Line[] = [];

  for (const route of [...raw.routes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!accepted(route.status, options.acceptStatuses)) {
      diagnostics.excludedUnverifiedRoutes++;
      continue;
    }
    if (types && !types.has(route.transportType)) {
      diagnostics.excludedByTransportFilter++;
      continue;
    }
    for (const direction of route.directions) {
      const lineId = `${route.id}:${direction.kind}`;
      const stops = [...direction.stops].sort((a, b) => a.order - b.order);
      const exclude = (reason: BuildDiagnostics["excludedLines"][number]["reason"]) =>
        diagnostics.excludedLines.push({ lineId, reason });

      if (direction.stops.length === 0) continue; // direction not recorded: nothing to exclude
      if (stops.length < 2) {
        exclude("too-short");
        continue;
      }
      if (stops.some((s, i) => s.order !== i + 1)) {
        exclude("sequence-gap");
        continue;
      }
      if (stops.some((s) => !stopsById.has(s.stopId))) {
        exclude("unknown-stop");
        continue;
      }
      if (stops.some((s) => !usable.has(s.stopId))) {
        exclude("unusable-stop");
        continue;
      }
      candidates.push({
        id: lineId,
        routeId: route.id,
        code: route.code,
        name: route.name,
        transportType: route.transportType,
        direction: direction.kind,
        verification: route.status,
        lastVerifiedAt: route.lastVerifiedAt,
        stopIds: stops.map((s) => s.stopId),
        canBoard: stops.map((s) => s.canBoard),
        canAlight: stops.map((s) => s.canAlight),
        geometry: direction.geometry,
        towardName: stopsById.get(stops[stops.length - 1].stopId)!.name,
        equivalentLineIds: [],
        equivalentRoutes: [],
      });
    }
  }

  // Fold identical lines. The first line (by route id) is kept.
  const bySignature = new Map<string, Line>();
  const lines: Line[] = [];
  for (const line of candidates) {
    const signature = [
      line.transportType,
      line.stopIds.join(","),
      line.canBoard.map(Number).join(""),
      line.canAlight.map(Number).join(""),
      fares.fingerprint(line.routeId),
    ].join("|");
    const kept = bySignature.get(signature);
    if (kept) {
      kept.equivalentLineIds.push(line.id);
      kept.equivalentRoutes.push({ routeId: line.routeId, code: line.code, name: line.name });
      diagnostics.duplicateLinesFolded++;
    } else {
      bySignature.set(signature, line);
      lines.push(line);
    }
  }

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const node = (id: string) => {
    let n = nodes.get(id);
    if (!n) {
      const s = stopsById.get(id)!;
      n = { stopId: id, name: s.name, position: s.position, outgoing: [], incoming: [] };
      nodes.set(id, n);
    }
    return n;
  };
  for (const line of lines) {
    const availability = fares.availability(line.routeId);
    for (let i = 0; i < line.stopIds.length - 1; i++) {
      const edge: GraphEdge = {
        routeId: line.routeId,
        lineId: line.id,
        transportType: line.transportType,
        direction: line.direction,
        boardingStopId: line.stopIds[i],
        dropoffStopId: line.stopIds[i + 1],
        fromSequence: i + 1,
        toSequence: i + 2,
        boardingAllowed: line.canBoard[i],
        dropoffAllowed: line.canAlight[i + 1],
        fareAvailability: availability,
        verification: line.verification,
      };
      edges.push(edge);
      node(edge.boardingStopId).outgoing.push(edge);
      node(edge.dropoffStopId).incoming.push(edge);
    }
  }

  // Only verified links count, and only between stops that are in the graph.
  const transferLinks = new Map<string, { meters: number; verified: boolean }>();
  for (const link of raw.transferLinks ?? []) {
    if (!link.verified || !nodes.has(link.fromStopId) || !nodes.has(link.toStopId)) continue;
    if (!Number.isFinite(link.meters) || link.meters < 0) continue;
    transferLinks.set(`${link.fromStopId}|${link.toStopId}`, { meters: link.meters, verified: true });
    transferLinks.set(`${link.toStopId}|${link.fromStopId}`, { meters: link.meters, verified: true });
  }

  return { nodes, edges, lines, diagnostics, transferLinks, fares };
}

/** Estimated walking distance: straight line scaled for the fact that roads are not straight. */
export function walkMeters(a: Coordinate, b: Coordinate, circuity: number): number {
  return Math.round(distanceMeters(a, b) * circuity);
}

export type StopCandidate = { stopId: string; name: string; position: Coordinate; walkMeters: number };

/**
 * Usable stops within walking range of a point, nearest first, where the traveller
 * could actually board (or get off) something. Distance is an estimate; whether a
 * walkable path exists is not known, and callers must say so.
 *
 * `mode: "board"` keeps stops where some route lets passengers board and later
 * stops exist; `"alight"` keeps stops where some route lets passengers get off
 * after an earlier stop.
 */
export function findCandidateStops(
  network: TransitNetwork,
  position: Coordinate,
  opts: { maxMeters: number; circuity: number; limit: number; mode: "board" | "alight"; includeStopId?: string },
): StopCandidate[] {
  const servable = new Set<string>();
  for (const line of network.lines) {
    for (let i = 0; i < line.stopIds.length; i++) {
      if (opts.mode === "board" ? line.canBoard[i] && i < line.stopIds.length - 1 : line.canAlight[i] && i > 0) {
        servable.add(line.stopIds[i]);
      }
    }
  }
  const found: StopCandidate[] = [];
  for (const n of network.nodes.values()) {
    if (!servable.has(n.stopId)) continue;
    const meters = n.stopId === opts.includeStopId ? 0 : walkMeters(position, n.position, opts.circuity);
    if (meters <= opts.maxMeters) found.push({ stopId: n.stopId, name: n.name, position: n.position, walkMeters: meters });
  }
  found.sort((a, b) => a.walkMeters - b.walkMeters || a.stopId.localeCompare(b.stopId));
  return found.slice(0, opts.limit);
}

/** Nearest servable stop regardless of range, used to explain "no stop nearby". */
export function nearestServableStop(
  network: TransitNetwork,
  position: Coordinate,
  mode: "board" | "alight",
  circuity: number,
): { name: string; meters: number } | null {
  const [nearest] = findCandidateStops(network, position, { maxMeters: Infinity, circuity, limit: 1, mode });
  return nearest ? { name: nearest.name, meters: nearest.walkMeters } : null;
}
