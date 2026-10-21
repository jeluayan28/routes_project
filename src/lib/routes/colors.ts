/** Distinguishable on the OSM base map; paired with labels so colour is never the only cue. */
const PALETTE = [
  "#1d4ed8", "#c2410c", "#15803d", "#7e22ce", "#be123c",
  "#0e7490", "#a16207", "#be185d", "#4d7c0f", "#4338ca",
] as const;

/** Stable colour per route id, so list, map and details always agree. */
export function routeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
