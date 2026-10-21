export type TileConfig = {
  url: string;
  /** HTML shown in the map's attribution control. */
  attribution: string;
  maxZoom: number;
};

export const OSM_TILES: TileConfig = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

/**
 * Raster tile source. Defaults to OpenStreetMap's public tile server, which is
 * run by volunteers: fine for development and light use, but its usage policy
 * (https://operations.osmfoundation.org/policies/tiles/) does not allow heavy
 * production traffic. Set NEXT_PUBLIC_MAP_TILE_URL and
 * NEXT_PUBLIC_MAP_TILE_ATTRIBUTION to use a provider whose terms fit your load.
 * A custom URL without attribution is ignored, because attribution is required.
 */
export function resolveTileConfig(
  url: string | undefined = process.env.NEXT_PUBLIC_MAP_TILE_URL,
  attribution: string | undefined = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION,
): TileConfig {
  const customUrl = url?.trim();
  const customAttribution = attribution?.trim();
  if (!customUrl) return OSM_TILES;

  const valid =
    /^https:\/\//.test(customUrl) &&
    ["{z}", "{x}", "{y}"].every((token) => customUrl.includes(token));
  if (!valid || !customAttribution) {
    console.warn(
      "Ignoring NEXT_PUBLIC_MAP_TILE_URL: it must be an https URL containing {z}, {x} and {y}, and NEXT_PUBLIC_MAP_TILE_ATTRIBUTION must be set.",
    );
    return OSM_TILES;
  }
  return { url: customUrl, attribution: customAttribution, maxZoom: 19 };
}
