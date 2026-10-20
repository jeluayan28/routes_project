import type { Route } from "@/lib/validation/route";

/**
 * DEVELOPMENT DATA ONLY.
 *
 * These are NOT real Butuan routes, stops, or fares. Names are deliberately
 * generic and the geometry is a few straight lines near the city centre so the
 * UI can be exercised. Everything is marked `sample`, and this file is only
 * used when NEXT_PUBLIC_ENABLE_SAMPLE_DATA=true (see lib/data/config.ts).
 */
export const SAMPLE_ROUTES: Route[] = [
  {
    id: "sample-a",
    code: "SAMPLE-A",
    name: "Sample Route A",
    vehicleType: "jeepney",
    status: "sample",
    direction: "both",
    directionNote: "Sample: runs both ways between the two end points.",
    stops: [
      { id: "sa-1", name: "Sample Stop A1", position: { lat: 8.9475, lng: 125.52 } },
      { id: "sa-2", name: "Sample Stop A2", position: { lat: 8.9475, lng: 125.53 } },
      { id: "sa-3", name: "Sample Stop A3", position: { lat: 8.9475, lng: 125.545 } },
      { id: "sa-4", name: "Sample Stop A4", position: { lat: 8.9475, lng: 125.56 } },
    ],
    path: [
      { lat: 8.9475, lng: 125.52 },
      { lat: 8.9475, lng: 125.56 },
    ],
    fares: [
      { id: "sa-f1", category: "regular", amount: 1, status: "sample", verifiedOn: null, note: "Placeholder amount." },
      { id: "sa-f2", category: "student", amount: 1, status: "sample", verifiedOn: null, note: "Placeholder amount." },
    ],
  },
  {
    id: "sample-b",
    code: "SAMPLE-B",
    name: "Sample Route B",
    vehicleType: "jeepney",
    status: "sample",
    direction: "one-way",
    directionNote: "Sample: one-way from the first stop to the last stop.",
    stops: [
      { id: "sb-1", name: "Sample Stop B1", position: { lat: 8.925, lng: 125.5406 } },
      { id: "sb-2", name: "Sample Stop B2", position: { lat: 8.94, lng: 125.5406 } },
      { id: "sb-3", name: "Sample Stop B3", position: { lat: 8.97, lng: 125.5406 } },
    ],
    path: [
      { lat: 8.925, lng: 125.5406 },
      { lat: 8.97, lng: 125.5406 },
    ],
    fares: [
      { id: "sb-f1", category: "regular", amount: 1, status: "sample", verifiedOn: null, note: "Placeholder amount." },
    ],
  },
  {
    id: "sample-c",
    code: "SAMPLE-C",
    name: "Sample Route C",
    vehicleType: "multicab",
    status: "sample",
    direction: "both",
    stops: [
      { id: "sc-1", name: "Sample Stop C1", position: { lat: 8.93, lng: 125.52 } },
      { id: "sc-2", name: "Sample Stop C2", position: { lat: 8.945, lng: 125.535 } },
      { id: "sc-3", name: "Sample Stop C3", position: { lat: 8.96, lng: 125.55 } },
    ],
    path: [
      { lat: 8.93, lng: 125.52 },
      { lat: 8.96, lng: 125.55 },
    ],
    fares: [],
  },
];
