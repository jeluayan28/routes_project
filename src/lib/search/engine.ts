import { VEHICLE_LABEL } from "@/lib/format";
import { VERIFICATION_STALE_AFTER_DAYS } from "@/lib/constants";
import { toCentavos, fromCentavos } from "@/lib/search/fares";
import { sliceGeometry } from "@/lib/search/geometry";
import {
  findCandidateStops,
  nearestServableStop,
  walkMeters,
  type BuiltNetwork,
  type StopCandidate,
} from "@/lib/search/network";
import { compareJourneys, dominates } from "@/lib/search/rank";
import {
  DEFAULT_SEARCH_OPTIONS,
  HARD_MAX_TRANSFERS,
  type FareSummary,
  type Journey,
  type JourneyStep,
  type NoJourney,
  type NoJourneyReason,
  type RideStep,
  type SearchOptions,
  type SearchOutcome,
  type SearchPoint,
  type WalkBasis,
  type WalkStep,
} from "@/lib/search/types";

/**
 * Journey search over a built transit network. See docs/SEARCH.md for the
 * assumptions and limits. In short:
 *
 *  1. Find usable stops near the origin and destination (estimated walking range).
 *  2. Enumerate sequences of route directions ("patterns") that can connect them
 *     within the transfer limit, never using a route twice.
 *  3. For each pattern, a dynamic program picks the best boarding, transfer and
 *     alighting stops (respecting order, direction and boarding/drop-off rules)
 *     for the chosen preference.
 *  4. Drop redundant and duplicate results, rank, and describe each journey.
 *
 * It is a pure function: no I/O, no clock, no randomness.
 */

/** Cost components, added up along a journey. Integers only, so sums are exact. */
type Cost = [walkMeters: number, fareMissingLegs: number, fareCentavos: number, stopsTravelled: number];

/** Component order for the comparison inside one pattern (transfers are constant there). */
const COMPONENT_ORDER: Record<SearchOptions["preference"], number[]> = {
  "fewest-transfers": [0, 1, 2, 3],
  "shortest-walking": [0, 1, 2, 3],
  "lowest-fare": [1, 2, 0, 3],
};

const ZERO: Cost = [0, 0, 0, 0];
const plus = (a: Cost, b: Cost): Cost => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];

type Transfer = { stopId: string; meters: number; basis: WalkBasis };

type BoardState = { cost: Cost; prevAlightPos: number | null; transfer: Transfer | null; accessMeters: number };
type AlightState = { cost: Cost; boardPos: number };

type Candidate = {
  lineIdx: number[];
  legs: { boardPos: number; alightPos: number; transferFrom: Transfer | null }[];
  access: StopCandidate;
  egress: StopCandidate;
};

export function searchJourneys(
  network: BuiltNetwork,
  origin: SearchPoint,
  destination: SearchPoint,
  input: Partial<SearchOptions> & Pick<SearchOptions, "date">,
): SearchOutcome {
  const opts: SearchOptions = {
    ...DEFAULT_SEARCH_OPTIONS,
    ...input,
    maxTransfers: Math.max(0, Math.min(HARD_MAX_TRANSFERS, Math.floor(input.maxTransfers ?? DEFAULT_SEARCH_OPTIONS.maxTransfers))),
  };
  const { lines } = network;
  const fail = (reason: NoJourneyReason, message: string, details: NoJourney["details"] = {}): NoJourney => ({
    status: "no-journey",
    reason,
    message,
    details,
  });

  if (lines.length === 0) {
    const d = network.diagnostics;
    if (d.excludedByTransportFilter > 0) return fail("no-routes-for-filters", "No routes of the selected transport types are available.");
    if (d.excludedUnverifiedRoutes > 0) return fail("only-unverified-routes", "Routes exist, but none has been verified yet, so none can be offered.");
    return fail("no-usable-routes", "No approved routes are available to search right now.");
  }

  if (
    (origin.stopId && origin.stopId === destination.stopId) ||
    walkMeters(origin.position, destination.position, 1) <= 50
  ) {
    return fail("origin-equals-destination", "The starting point and destination are the same place, or close enough to walk.");
  }

  const accessCandidates = findCandidateStops(network, origin.position, {
    maxMeters: opts.maxAccessWalkMeters, circuity: opts.walkCircuity, limit: opts.maxCandidateStops, mode: "board", includeStopId: origin.stopId,
  });
  if (accessCandidates.length === 0) {
    const nearest = nearestServableStop(network, origin.position, "board", opts.walkCircuity) ?? undefined;
    return fail(
      "no-boarding-stop-near-origin",
      `No stop where passengers can board is within about ${opts.maxAccessWalkMeters} m of the starting point.` +
        (nearest ? ` The nearest is ${nearest.name}, about ${nearest.meters} m away.` : ""),
      { nearestStop: nearest },
    );
  }
  const egressCandidates = findCandidateStops(network, destination.position, {
    maxMeters: opts.maxAccessWalkMeters, circuity: opts.walkCircuity, limit: opts.maxCandidateStops, mode: "alight", includeStopId: destination.stopId,
  });
  if (egressCandidates.length === 0) {
    const nearest = nearestServableStop(network, destination.position, "alight", opts.walkCircuity) ?? undefined;
    return fail(
      "no-alighting-stop-near-destination",
      `No stop where passengers can get off is within about ${opts.maxAccessWalkMeters} m of the destination.` +
        (nearest ? ` The nearest is ${nearest.name}, about ${nearest.meters} m away.` : ""),
      { nearestStop: nearest },
    );
  }

  const search = new Search(network, opts, accessCandidates, egressCandidates);
  const found = search.run(opts.maxTransfers);

  if (found.candidates.length === 0) {
    // Is there a journey with more transfers than the limit allows?
    for (let more = opts.maxTransfers + 1; more <= HARD_MAX_TRANSFERS; more++) {
      const extra = new Search(network, opts, accessCandidates, egressCandidates).run(more);
      if (extra.candidates.length > 0) {
        const needed = Math.min(...extra.candidates.map((c) => c.lineIdx.length - 1));
        return fail(
          "transfer-limit",
          `A journey exists only with ${needed} transfer${needed === 1 ? "" : "s"}, and the limit is ${opts.maxTransfers}.`,
          { transfersNeeded: needed },
        );
      }
    }
    return fail("no-route", "No verified route connects these places, even with transfers.");
  }

  let journeys = found.candidates.map((c) => search.describe(c, origin, destination));
  journeys = keepBestPerRoutes(journeys, opts);
  const before = journeys.length;
  journeys = journeys.filter((j) => !journeys.some((other) => other !== j && dominates(other, j)));
  const redundantDropped = before - journeys.length;
  journeys.sort((a, b) => compareJourneys(a, b, opts.preference));

  const notes: string[] = [
    "Walking distances are straight-line estimates. Whether a safe walking path exists has not been checked.",
    "Travel times are not shown: there is no timing data, and no real-time arrivals are available.",
  ];
  if (found.truncated) notes.push("The search was cut short because there were very many route combinations; better journeys may exist.");
  return {
    status: "ok",
    journeys: journeys.slice(0, opts.maxResults),
    notes,
    diagnostics: { patternsEvaluated: found.evaluated, truncated: found.truncated, redundantDropped },
  };
}

/** One result per set of routes, the best by the preference. */
function keepBestPerRoutes(journeys: Journey[], opts: SearchOptions): Journey[] {
  const best = new Map<string, Journey>();
  for (const j of journeys) {
    const key = j.summary.routeIds.join(">");
    const current = best.get(key);
    if (!current || compareJourneys(j, current, opts.preference) < 0) best.set(key, j);
  }
  return [...best.values()];
}

class Search {
  private readonly lineIndexByRoute = new Map<string, number[]>();
  private readonly positions: Map<string, number[]>[];
  private readonly boardLinesAt = new Map<string, number[]>();
  private readonly neighborMemo = new Map<string, Transfer[]>();
  private readonly successorMemo = new Map<number, number[]>();
  private readonly order: number[];
  private readonly accessByStop: Map<string, StopCandidate>;
  private readonly egressByStop: Map<string, StopCandidate>;

  constructor(
    private readonly net: BuiltNetwork,
    private readonly opts: SearchOptions,
    access: StopCandidate[],
    egress: StopCandidate[],
  ) {
    this.order = COMPONENT_ORDER[opts.preference];
    this.accessByStop = new Map(access.map((c) => [c.stopId, c]));
    this.egressByStop = new Map(egress.map((c) => [c.stopId, c]));
    this.positions = net.lines.map((line) => {
      const map = new Map<string, number[]>();
      line.stopIds.forEach((id, pos) => {
        const list = map.get(id);
        if (list) list.push(pos);
        else map.set(id, [pos]);
      });
      return map;
    });
    net.lines.forEach((line, li) => {
      line.stopIds.forEach((id, pos) => {
        if (line.canBoard[pos] && pos < line.stopIds.length - 1) {
          const list = this.boardLinesAt.get(id);
          if (list) {
            if (!list.includes(li)) list.push(li);
          } else this.boardLinesAt.set(id, [li]);
        }
      });
    });
  }

  private cmp(a: Cost, b: Cost): number {
    for (const k of this.order) if (a[k] !== b[k]) return a[k] - b[k];
    return 0;
  }

  /** Stops a passenger can walk to from `stopId` to transfer: the same stop, a verified link, or a near stop (estimate). */
  private neighbors(stopId: string): Transfer[] {
    const hit = this.neighborMemo.get(stopId);
    if (hit) return hit;
    const here = this.net.nodes.get(stopId)!;
    const out: Transfer[] = [{ stopId, meters: 0, basis: "same-stop" }];
    for (const other of this.net.nodes.values()) {
      if (other.stopId === stopId) continue;
      const link = this.net.transferLinks.get(`${stopId}|${other.stopId}`);
      if (link) {
        if (link.meters <= this.opts.maxTransferWalkMeters) out.push({ stopId: other.stopId, meters: Math.round(link.meters), basis: "verified-link" });
        continue;
      }
      const meters = walkMeters(here.position, other.position, this.opts.walkCircuity);
      if (meters <= this.opts.maxTransferWalkMeters) out.push({ stopId: other.stopId, meters, basis: "straight-line-estimate" });
    }
    this.neighborMemo.set(stopId, out);
    return out;
  }

  /** Lines that can be boarded after getting off `line` (ignoring stop order; the DP checks order). */
  private successors(li: number): number[] {
    const hit = this.successorMemo.get(li);
    if (hit) return hit;
    const line = this.net.lines[li];
    const next = new Set<number>();
    line.stopIds.forEach((id, pos) => {
      if (!line.canAlight[pos] || pos === 0) return;
      for (const n of this.neighbors(id)) for (const other of this.boardLinesAt.get(n.stopId) ?? []) if (other !== li) next.add(other);
    });
    const out = [...next].sort((a, b) => a - b);
    this.successorMemo.set(li, out);
    return out;
  }

  private legCost(li: number, i: number, j: number): Cost {
    const line = this.net.lines[li];
    const fare = this.net.fares.resolve(line.routeId, line.stopIds[i], line.stopIds[j]);
    return [0, fare.status === "known" ? 0 : 1, fare.status === "known" ? toCentavos(fare.amount) : 0, j - i];
  }

  run(maxTransfers: number): { candidates: Candidate[]; evaluated: number; truncated: boolean } {
    const { lines } = this.net;
    const maxLegs = maxTransfers + 1;

    // Lines that reach the destination side, and how many lines are needed from each.
    const endsAtEgress = lines.map((line) => line.stopIds.some((id, pos) => line.canAlight[pos] && pos > 0 && this.egressByStop.has(id)));
    const need = new Array<number>(lines.length).fill(Infinity);
    const reverse = lines.map(() => [] as number[]);
    lines.forEach((_, li) => this.successors(li).forEach((next) => reverse[next].push(li)));
    const queue: number[] = [];
    endsAtEgress.forEach((yes, li) => {
      if (yes) {
        need[li] = 1;
        queue.push(li);
      }
    });
    for (let q = 0; q < queue.length; q++) {
      for (const prev of reverse[queue[q]]) {
        if (need[prev] === Infinity) {
          need[prev] = need[queue[q]] + 1;
          queue.push(prev);
        }
      }
    }

    const starts = new Set<number>();
    for (const id of this.accessByStop.keys()) for (const li of this.boardLinesAt.get(id) ?? []) starts.add(li);

    const candidates: Candidate[] = [];
    let evaluated = 0;
    let truncated = false;
    const usedRoutes = new Set<string>();

    const visit = (pattern: number[]) => {
      if (truncated) return;
      const last = pattern[pattern.length - 1];
      if (endsAtEgress[last]) {
        if (++evaluated > this.opts.maxPatterns) {
          truncated = true;
          return;
        }
        const c = this.evaluate(pattern);
        if (c) candidates.push(c);
      }
      if (pattern.length >= maxLegs) return;
      for (const next of this.successors(last)) {
        const route = lines[next].routeId;
        if (usedRoutes.has(route) || pattern.length + need[next] > maxLegs) continue;
        usedRoutes.add(route);
        pattern.push(next);
        visit(pattern);
        pattern.pop();
        usedRoutes.delete(route);
      }
    };

    for (const start of [...starts].sort((a, b) => a - b)) {
      if (need[start] > maxLegs) continue;
      usedRoutes.add(lines[start].routeId);
      visit([start]);
      usedRoutes.delete(lines[start].routeId);
    }
    return { candidates, evaluated, truncated };
  }

  /** Best stops for one sequence of lines, or null if the order, direction or permissions make it impossible. */
  private evaluate(pattern: number[]): Candidate | null {
    const { lines } = this.net;
    const boardStates: Map<number, BoardState>[] = [];
    const alightStates: Map<number, AlightState>[] = [];

    for (let t = 0; t < pattern.length; t++) {
      const li = pattern[t];
      const line = lines[li];
      const last = line.stopIds.length - 1;
      const board = new Map<number, BoardState>();

      if (t === 0) {
        for (const [stopId, cand] of this.accessByStop) {
          for (const pos of this.positions[li].get(stopId) ?? []) {
            if (line.canBoard[pos] && pos < last) {
              board.set(pos, { cost: [cand.walkMeters, 0, 0, 0], prevAlightPos: null, transfer: null, accessMeters: cand.walkMeters });
            }
          }
        }
      } else {
        const prevLine = lines[pattern[t - 1]];
        for (const [j, st] of alightStates[t - 1]) {
          for (const n of this.neighbors(prevLine.stopIds[j])) {
            for (const pos of this.positions[li].get(n.stopId) ?? []) {
              if (!line.canBoard[pos] || pos >= last) continue;
              const cost = plus(st.cost, [n.meters, 0, 0, 0]);
              const cur = board.get(pos);
              if (!cur || this.cmp(cost, cur.cost) < 0) board.set(pos, { cost, prevAlightPos: j, transfer: n, accessMeters: 0 });
            }
          }
        }
      }
      if (board.size === 0) return null;

      const alight = new Map<number, AlightState>();
      for (const [i, bs] of [...board].sort((a, b) => a[0] - b[0])) {
        for (let j = i + 1; j <= last; j++) {
          if (!line.canAlight[j] || line.stopIds[j] === line.stopIds[i]) continue;
          const cost = plus(bs.cost, this.legCost(li, i, j));
          const cur = alight.get(j);
          if (!cur || this.cmp(cost, cur.cost) < 0) alight.set(j, { cost, boardPos: i });
        }
      }
      if (alight.size === 0) return null;
      boardStates.push(board);
      alightStates.push(alight);
    }

    // Finish at the destination side.
    const lastT = pattern.length - 1;
    const lastLine = lines[pattern[lastT]];
    let bestJ = -1;
    let bestCost: Cost = ZERO;
    for (const [j, st] of [...alightStates[lastT]].sort((a, b) => a[0] - b[0])) {
      const egress = this.egressByStop.get(lastLine.stopIds[j]);
      if (!egress) continue;
      const cost = plus(st.cost, [egress.walkMeters, 0, 0, 0]);
      if (bestJ === -1 || this.cmp(cost, bestCost) < 0) {
        bestJ = j;
        bestCost = cost;
      }
    }
    if (bestJ === -1) return null;

    // Walk back through the choices.
    const legs: Candidate["legs"] = [];
    let alightPos = bestJ;
    for (let t = lastT; t >= 0; t--) {
      const as = alightStates[t].get(alightPos)!;
      const bs = boardStates[t].get(as.boardPos)!;
      legs.unshift({ boardPos: as.boardPos, alightPos, transferFrom: bs.transfer });
      if (bs.prevAlightPos !== null) alightPos = bs.prevAlightPos;
    }

    // No cycles: a stop may not be visited twice (a same-stop transfer is one visit).
    const visited = new Set<string>();
    let previousAlight: string | null = null;
    for (let t = 0; t < legs.length; t++) {
      const line = lines[pattern[t]];
      const boardStop = line.stopIds[legs[t].boardPos];
      const alightStop = line.stopIds[legs[t].alightPos];
      if (boardStop !== previousAlight) {
        if (visited.has(boardStop)) return null;
        visited.add(boardStop);
      }
      if (visited.has(alightStop)) return null;
      visited.add(alightStop);
      previousAlight = alightStop;
    }

    const firstLine = lines[pattern[0]];
    const access = this.accessByStop.get(firstLine.stopIds[legs[0].boardPos])!;
    const egress = this.egressByStop.get(lastLine.stopIds[bestJ])!;
    return { lineIdx: [...pattern], legs, access, egress };
  }

  /** Turns a chosen sequence of stops into a described journey. */
  describe(c: Candidate, origin: SearchPoint, destination: SearchPoint): Journey {
    const { lines, nodes } = this.net;
    const steps: JourneyStep[] = [];
    const notes: string[] = [];
    const stopRef = (id: string) => {
      const n = nodes.get(id)!;
      return { stopId: id, name: n.name, position: n.position };
    };
    let walking = 0;
    let anyEstimate = false;
    let anyVerifiedLink = false;

    const pushWalk = (step: WalkStep) => {
      steps.push(step);
      walking += step.meters;
      if (step.basis === "straight-line-estimate") anyEstimate = true;
      if (step.basis === "verified-link") anyVerifiedLink = true;
    };

    const firstBoard = lines[c.lineIdx[0]].stopIds[c.legs[0].boardPos];
    if (origin.stopId !== firstBoard) {
      const n = nodes.get(firstBoard)!;
      pushWalk({
        type: "walk", purpose: "access",
        from: { label: origin.label, position: origin.position, stopId: origin.stopId },
        to: { label: n.name, position: n.position, stopId: firstBoard },
        meters: c.access.walkMeters, basis: "straight-line-estimate",
        instruction: `Walk about ${c.access.walkMeters} m to ${n.name}.`,
      });
    }

    const rides: RideStep[] = [];
    c.lineIdx.forEach((li, t) => {
      const line = lines[li];
      const leg = c.legs[t];
      const boardId = line.stopIds[leg.boardPos];
      const alightId = line.stopIds[leg.alightPos];

      if (t > 0 && leg.transferFrom) {
        const prev = lines[c.lineIdx[t - 1]];
        const fromId = prev.stopIds[c.legs[t - 1].alightPos];
        const from = nodes.get(fromId)!;
        const to = nodes.get(boardId)!;
        const tr = leg.transferFrom;
        pushWalk({
          type: "walk", purpose: "transfer",
          from: { label: from.name, position: from.position, stopId: fromId },
          to: { label: to.name, position: to.position, stopId: boardId },
          meters: tr.meters, basis: tr.basis,
          instruction:
            tr.basis === "same-stop"
              ? `Transfer at ${from.name}.`
              : `Transfer: walk about ${tr.meters} m from ${from.name} to ${to.name}.`,
        });
      }

      const fare = this.net.fares.resolve(line.routeId, boardId, alightId);
      const intermediate = line.stopIds.slice(leg.boardPos + 1, leg.alightPos).map((id) => nodes.get(id)!.name);
      const board = stopRef(boardId);
      const alight = stopRef(alightId);
      const ride: RideStep = {
        type: "ride",
        routeId: line.routeId, routeCode: line.code, routeName: line.name, transportType: line.transportType,
        direction: line.direction, towardName: line.towardName,
        board, alight,
        stopsTravelled: leg.alightPos - leg.boardPos,
        intermediateStops: intermediate,
        fare,
        geometry: sliceGeometry(line.geometry, board.position, alight.position),
        alsoServedBy: line.equivalentRoutes.map((r) => ({ routeId: r.routeId, routeCode: r.code, routeName: r.name })),
        instruction:
          `Board ${VEHICLE_LABEL[line.transportType]} ${line.code} (${line.name}) at ${board.name}, toward ${line.towardName}. ` +
          `Get off at ${alight.name} after ${leg.alightPos - leg.boardPos} ${leg.alightPos - leg.boardPos === 1 ? "stop" : "stops"}.`,
      };
      rides.push(ride);
      steps.push(ride);
    });

    const lastAlight = lines[c.lineIdx[c.lineIdx.length - 1]].stopIds[c.legs[c.legs.length - 1].alightPos];
    if (destination.stopId !== lastAlight) {
      const n = nodes.get(lastAlight)!;
      pushWalk({
        type: "walk", purpose: "egress",
        from: { label: n.name, position: n.position, stopId: lastAlight },
        to: { label: destination.label, position: destination.position, stopId: destination.stopId },
        meters: c.egress.walkMeters, basis: "straight-line-estimate",
        instruction: `Walk about ${c.egress.walkMeters} m to ${destination.label}.`,
      });
    }

    // Fares: a total only when every ridden segment has a known fare.
    const missing = rides.flatMap((r) =>
      r.fare.status === "unavailable" ? [{ routeId: r.routeId, routeName: r.routeName, reason: r.fare.reason }] : [],
    );
    const knownCentavos = rides.reduce((sum, r) => sum + (r.fare.status === "known" ? toCentavos(r.fare.amount) : 0), 0);
    const fare: FareSummary =
      missing.length === 0
        ? {
            status: "complete", currency: "PHP", total: fromCentavos(knownCentavos),
            breakdown: rides.map((r) => ({ routeId: r.routeId, routeName: r.routeName, amount: r.fare.status === "known" ? r.fare.amount : 0 })),
          }
        : { status: "incomplete", currency: "PHP", knownSubtotal: fromCentavos(knownCentavos), missing };
    if (missing.length > 0) notes.push(`No fare is available for: ${missing.map((m) => m.routeName).join(", ")}. A total cannot be given.`);

    if (anyEstimate) notes.push("Walking distances are estimates; the walking path itself is not verified.");

    const usedLines = c.lineIdx.map((li) => lines[li]);
    const sample = usedLines.some((l) => l.verification === "sample") || rides.some((r) => r.fare.status === "known" && r.fare.dataStatus === "sample");
    if (sample) notes.push("Sample data. These are not real Butuan routes or fares.");

    const verifiedDates = usedLines.map((l) => l.lastVerifiedAt);
    const oldest = verifiedDates.some((d) => d === null) ? null : verifiedDates.reduce((a, b) => (a! < b! ? a : b), verifiedDates[0]);
    if (oldest && (Date.parse(`${this.opts.date}T00:00:00Z`) - Date.parse(oldest)) / 86_400_000 > VERIFICATION_STALE_AFTER_DAYS) {
      notes.push(`The oldest verification used here is more than ${VERIFICATION_STALE_AFTER_DAYS} days old.`);
    }

    const okGeometry = rides.filter((r) => r.geometry.status === "ok").length;
    const geometry = okGeometry === rides.length ? "complete" : okGeometry === 0 ? "none" : "partial";
    if (geometry !== "complete") notes.push("The map line is not available for every ride because the route's path has not been recorded or does not match its stops.");

    return {
      id: usedLines.map((l, t) => `${l.id}@${l.stopIds[c.legs[t].boardPos]}>${l.stopIds[c.legs[t].alightPos]}`).join("|"),
      steps,
      summary: {
        transfers: rides.length - 1,
        walkingMeters: walking,
        stopsTravelled: rides.reduce((n, r) => n + r.stopsTravelled, 0),
        routeIds: rides.map((r) => r.routeId),
      },
      fare,
      verification: {
        dataStatus: sample ? "sample" : "verified",
        walking: anyEstimate ? "estimated" : anyVerifiedLink ? "verified" : "none",
        geometry,
        oldestVerifiedAt: oldest,
      },
      travelTime: { available: false, reason: "no-timing-data" },
      notes,
    };
  }
}

