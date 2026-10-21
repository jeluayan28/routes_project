import { BUTUAN_SERVICE_AREA } from "@/lib/constants";
import type { Coordinate } from "@/lib/validation/transport";

export type GeocodeHit = { label: string; position: Coordinate };

/** Looks up a place name. Implementations must be polite: bounded, cached and rate-limited. */
export interface Geocoder {
  search(query: string): Promise<GeocodeHit[]>;
}

export class GeocoderError extends Error {}

type NominatimOptions = {
  /** Required by the Nominatim usage policy: an email address or URL that identifies the app. */
  contact: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Only results inside this box are asked for and accepted. */
  area?: { south: number; north: number; west: number; east: number };
  /** The public server allows at most one request per second. */
  minIntervalMs?: number;
  cacheTtlMs?: number;
  cacheSize?: number;
  timeoutMs?: number;
  now?: () => number;
};

/**
 * Place search through OpenStreetMap's Nominatim.
 *
 * The public server (https://operations.osmfoundation.org/policies/nominatim/)
 * allows light use only: identify the app with a User-Agent, at most one request
 * per second, cache results, no autocomplete and no bulk lookups. This client does
 * the first three; it is only called when a person submits a search. For anything
 * heavier, point `baseUrl` at a provider or your own instance. Results are OSM data
 * under the ODbL and need the same attribution as the map.
 *
 * A geocoder result is a guess about where a name is. It is never treated as a
 * transport record and says nothing about whether a road route exists.
 */
export function createNominatimGeocoder(options: NominatimOptions): Geocoder {
  const {
    contact,
    baseUrl = "https://nominatim.openstreetmap.org",
    fetchImpl = fetch,
    area = BUTUAN_SERVICE_AREA,
    minIntervalMs = 1100,
    cacheTtlMs = 24 * 60 * 60 * 1000,
    cacheSize = 200,
    timeoutMs = 4000,
    now = Date.now,
  } = options;

  const cache = new Map<string, { at: number; hits: GeocodeHit[] }>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequestAt = 0;

  /** Runs `task` after the previous request and at least `minIntervalMs` after it started. */
  const throttled = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = now();
      return task();
    });
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    async search(query) {
      const key = query.trim().toLowerCase().replace(/\s+/g, " ");
      if (key === "") return [];
      const cached = cache.get(key);
      if (cached && now() - cached.at < cacheTtlMs) return cached.hits;

      const url = new URL("/search", baseUrl);
      url.search = new URLSearchParams({
        q: query.trim(),
        format: "jsonv2",
        limit: "5",
        countrycodes: "ph",
        viewbox: `${area.west},${area.north},${area.east},${area.south}`,
        bounded: "1",
      }).toString();

      const hits = await throttled(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(url, {
            signal: controller.signal,
            headers: { "User-Agent": `ButuanRouteFinder/1.0 (${contact})`, "Accept-Language": "en" },
          });
          if (!res.ok) throw new GeocoderError(`Geocoder responded ${res.status}`);
          const body: unknown = await res.json();
          if (!Array.isArray(body)) throw new GeocoderError("Unexpected geocoder response");
          return body.flatMap((item): GeocodeHit[] => {
            const r = item as { lat?: string; lon?: string; display_name?: string };
            const lat = Number(r.lat);
            const lng = Number(r.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
            if (lat < area.south || lat > area.north || lng < area.west || lng > area.east) return [];
            return [{ label: (r.display_name ?? "").split(",").slice(0, 3).join(",").trim() || "Unnamed place", position: { lat, lng } }];
          });
        } catch (error) {
          throw error instanceof GeocoderError ? error : new GeocoderError("Geocoder unavailable");
        } finally {
          clearTimeout(timer);
        }
      });

      if (cache.size >= cacheSize) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: now(), hits });
      return hits;
    },
  };
}

/**
 * Enabled only by configuration: GEOCODER_PROVIDER=nominatim and GEOCODER_CONTACT
 * (an email or URL). Otherwise place names are matched only against verified stops
 * and landmarks, and typed or selected coordinates still work.
 */
export function geocoderFromEnv(env: Record<string, string | undefined> = process.env): Geocoder | null {
  if (env.GEOCODER_PROVIDER?.trim().toLowerCase() !== "nominatim") return null;
  const contact = env.GEOCODER_CONTACT?.trim();
  if (!contact) {
    console.warn("GEOCODER_PROVIDER=nominatim needs GEOCODER_CONTACT (an email or URL); geocoding is off.");
    return null;
  }
  return createNominatimGeocoder({ contact, baseUrl: env.GEOCODER_BASE_URL?.trim() || undefined });
}
