import { afterEach, describe, expect, it, vi } from "vitest";
import { GeocoderError, createNominatimGeocoder, geocoderFromEnv } from "@/lib/search/geocoder";

const AREA = { south: 0, north: 1, west: 0, east: 1 };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const hit = (lat: string, lon: string, name = "Fixture Place, Fixture Street, Fixture City, Fixture Country") => ({ lat, lon, display_name: name });

const make = (fetchImpl: typeof fetch, over: Partial<Parameters<typeof createNominatimGeocoder>[0]> = {}) =>
  createNominatimGeocoder({ contact: "ops@example.invalid", fetchImpl, area: AREA, minIntervalMs: 0, ...over });

afterEach(() => vi.restoreAllMocks());

describe("Nominatim geocoder", () => {
  it("identifies the app, asks for a bounded Philippine search, and returns validated hits", async () => {
    const fetchImpl = vi.fn(async () => reply([hit("0.5", "0.5")]));
    const hits = await make(fetchImpl as unknown as typeof fetch).search("Fixture Place");
    expect(hits).toEqual([{ label: "Fixture Place, Fixture Street, Fixture City", position: { lat: 0.5, lng: 0.5 } }]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://nominatim.openstreetmap.org");
    expect(url.searchParams.get("q")).toBe("Fixture Place");
    expect(url.searchParams.get("countrycodes")).toBe("ph");
    expect(url.searchParams.get("bounded")).toBe("1");
    expect(url.searchParams.get("viewbox")).toBe("0,1,1,0");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("ButuanRouteFinder/1.0 (ops@example.invalid)");
  });

  it("drops results outside the area and malformed coordinates", async () => {
    const fetchImpl = vi.fn(async () => reply([hit("0.5", "0.5"), hit("14.6", "121"), hit("abc", "0.5"), hit("95", "0.5"), { lat: "0.5" }]));
    expect(await make(fetchImpl as unknown as typeof fetch).search("x")).toHaveLength(1);
  });

  it("caches repeated searches (case and spacing do not matter)", async () => {
    const fetchImpl = vi.fn(async () => reply([hit("0.5", "0.5")]));
    const g = make(fetchImpl as unknown as typeof fetch);
    await g.search("Some Place");
    await g.search("  some   place ");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks again after the cache entry expires", async () => {
    let time = 0;
    const fetchImpl = vi.fn(async () => reply([]));
    const g = make(fetchImpl as unknown as typeof fetch, { cacheTtlMs: 1000, now: () => time });
    await g.search("a");
    time = 999;
    await g.search("a");
    time = 1001;
    await g.search("a");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("limits its own cache size", async () => {
    const fetchImpl = vi.fn(async () => reply([]));
    const g = make(fetchImpl as unknown as typeof fetch, { cacheSize: 2 });
    for (const q of ["a", "b", "c"]) await g.search(q);
    await g.search("a"); // evicted
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("spaces requests out so the public server's one-per-second rule is respected", async () => {
    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      return reply([]);
    });
    const g = make(fetchImpl as unknown as typeof fetch, { minIntervalMs: 60 });
    await Promise.all([g.search("a"), g.search("b"), g.search("c")]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(55);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(55);
  });

  it("does nothing for a blank query", async () => {
    const fetchImpl = vi.fn();
    expect(await make(fetchImpl as unknown as typeof fetch).search("   ")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("raises GeocoderError for a failing, malformed or unreachable service", async () => {
    await expect(make((async () => reply({}, 503)) as unknown as typeof fetch).search("a")).rejects.toBeInstanceOf(GeocoderError);
    await expect(make((async () => reply({ not: "an array" })) as unknown as typeof fetch).search("a")).rejects.toBeInstanceOf(GeocoderError);
    await expect(make((async () => { throw new TypeError("network"); }) as unknown as typeof fetch).search("a")).rejects.toBeInstanceOf(GeocoderError);
  });

  it("gives up after the timeout instead of hanging", async () => {
    const hang = ((_: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    await expect(make(hang, { timeoutMs: 20 }).search("a")).rejects.toBeInstanceOf(GeocoderError);
  });

  it("does not cache failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply({}, 500)).mockResolvedValueOnce(reply([hit("0.5", "0.5")]));
    const g = make(fetchImpl as unknown as typeof fetch);
    await expect(g.search("a")).rejects.toBeInstanceOf(GeocoderError);
    expect(await g.search("a")).toHaveLength(1);
  });
});

describe("geocoderFromEnv", () => {
  it("is off unless configured", () => {
    expect(geocoderFromEnv({})).toBeNull();
    expect(geocoderFromEnv({ GEOCODER_PROVIDER: "other" })).toBeNull();
  });

  it("refuses to run without a contact, as the usage policy requires", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(geocoderFromEnv({ GEOCODER_PROVIDER: "nominatim" })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("is on with a provider and a contact", () => {
    expect(geocoderFromEnv({ GEOCODER_PROVIDER: "Nominatim", GEOCODER_CONTACT: "ops@example.invalid" })).not.toBeNull();
  });
});
