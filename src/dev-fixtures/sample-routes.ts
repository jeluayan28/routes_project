import type { Route, RouteStop } from "@/lib/validation/route";

/**
 * DEVELOPMENT FIXTURES ONLY.
 *
 * These are NOT real Butuan routes, stops, or fares. Names are generic and the
 * coordinates are invented points near the city centre so the map can be
 * exercised. Every record is marked `sample`. Nothing outside the data layer
 * imports this file, and it is loaded only when NEXT_PUBLIC_ENABLE_SAMPLE_DATA=true
 * (see lib/data/config.ts) or from tests.
 *
 * The set deliberately covers the awkward cases:
 *  - A: two directions with different return geometry and different stops.
 *  - B: one-way, overlapping A's outbound line and sharing two of its stops.
 *  - C: multicab, one-way, with a MultiLineString (two separate lines).
 *  - D: multicab with stops but NO recorded geometry (must draw no line).
 */
const stop = (
  id: string,
  name: string,
  lat: number,
  lng: number,
  flags: Partial<Pick<RouteStop, "canBoard" | "canAlight" | "status">> = {},
): RouteStop => ({
  id,
  name,
  position: { lat, lng },
  status: "sample",
  canBoard: true,
  canAlight: true,
  ...flags,
});

const A1 = stop("sa-1", "Sample Stop A1", 8.9475, 125.52);
const A2 = stop("sa-2", "Sample Stop A2", 8.9475, 125.53);
const A3 = stop("sa-3", "Sample Stop A3", 8.9475, 125.545);
const A4 = stop("sa-4", "Sample Stop A4", 8.9475, 125.56);

const sampleFare = (id: string) => ({
  id,
  category: "regular" as const,
  amount: 1,
  status: "sample" as const,
  verifiedOn: null,
  note: "Placeholder amount.",
});

export const SAMPLE_ROUTES: Route[] = [
  {
    id: "sample-a",
    code: "SAMPLE-A",
    name: "Sample Route A",
    vehicleType: "minibus",
    status: "sample",
    direction: "both",
    directionNote: "Sample: the return trip uses a different street.",
    directions: [
      {
        kind: "outbound",
        stops: [A1, A2, A3, A4],
        paths: [
          [
            { lat: 8.9475, lng: 125.52 },
            { lat: 8.9475, lng: 125.53 },
            { lat: 8.9475, lng: 125.545 },
            { lat: 8.9475, lng: 125.56 },
          ],
        ],
      },
      {
        kind: "inbound",
        stops: [
          stop("sa-4", "Sample Stop A4", 8.9475, 125.56),
          stop("sa-5", "Sample Stop A5 (inbound only)", 8.9462, 125.54, { canBoard: false }),
          stop("sa-1", "Sample Stop A1", 8.9475, 125.52),
        ],
        paths: [
          [
            { lat: 8.9475, lng: 125.56 },
            { lat: 8.9462, lng: 125.54 },
            { lat: 8.9475, lng: 125.52 },
          ],
        ],
      },
    ],
    fares: [sampleFare("sa-f1")],
  },
  {
    id: "sample-b",
    code: "SAMPLE-B",
    name: "Sample Route B",
    vehicleType: "minibus",
    status: "sample",
    direction: "one-way",
    directionNote: "Sample: one-way, runs only from the first stop to the last.",
    directions: [
      {
        kind: "outbound",
        stops: [stop("sb-1", "Sample Stop B1", 8.9505, 125.53), A2, A3, stop("sb-4", "Sample Stop B4", 8.9445, 125.5575)],
        paths: [
          [
            { lat: 8.9505, lng: 125.53 },
            { lat: 8.9475, lng: 125.53 },
            { lat: 8.9475, lng: 125.545 },
            { lat: 8.9445, lng: 125.5575 },
          ],
        ],
      },
    ],
    fares: [sampleFare("sb-f1")],
  },
  {
    id: "sample-c",
    code: "SAMPLE-C",
    name: "Sample Route C",
    vehicleType: "multicab",
    status: "sample",
    direction: "one-way",
    directions: [
      {
        kind: "outbound",
        stops: [
          stop("sc-1", "Sample Stop C1", 8.953, 125.5),
          stop("sc-2", "Sample Stop C2", 8.953, 125.51, { status: "unverified" }),
          stop("sc-3", "Sample Stop C3", 8.96, 125.52),
        ],
        // Two separate lines: the gap between them is NOT drawn.
        paths: [
          [
            { lat: 8.953, lng: 125.5 },
            { lat: 8.953, lng: 125.51 },
          ],
          [
            { lat: 8.957, lng: 125.515 },
            { lat: 8.96, lng: 125.52 },
          ],
        ],
      },
    ],
    fares: [sampleFare("sc-f1")],
  },
  {
    id: "sample-d",
    code: "SAMPLE-D",
    name: "Sample Route D (no geometry)",
    vehicleType: "multicab",
    status: "sample",
    direction: "one-way",
    directionNote: "Sample: stops are known but no route line has been recorded.",
    directions: [
      {
        kind: "outbound",
        stops: [stop("sd-1", "Sample Stop D1", 8.94, 125.51), stop("sd-2", "Sample Stop D2", 8.935, 125.525)],
        paths: [],
      },
    ],
    fares: [],
  },
];
