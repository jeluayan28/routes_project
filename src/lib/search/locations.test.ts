import { describe, expect, it, vi } from "vitest";
import { GeocoderError, type Geocoder } from "@/lib/search/geocoder";
import {
  normalizeName, resolveLocation, type KnownLandmark, type KnownStop, type ResolveContext, type Resolution,
} from "@/lib/search/locations";

/** Fictional places on an abstract grid near 0.1°, 0.1° (see __fixtures__/fictional.ts). */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pos = (x: number, y = 0) => ({ lat: 0.1 + y * 0.01, lng: 0.1 + x * 0.01 });
const stop = (n: number, name: string, p = pos(n), status: KnownStop["status"] = "verified"): KnownStop => ({ id: ID(n), name, position: p, status });
const landmark = (n: number, name: string, p = pos(n, 3), status: KnownLandmark["status"] = "verified"): KnownLandmark => ({ id: ID(100 + n), name, category: "fixture", position: p, status });

const AREA = { south: 0, north: 1, west: 0, east: 1 };
const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  stops: [stop(1, "Alpha Stop"), stop(2, "Bravo Stop"), stop(3, "Town Plaza"), stop(4, "Café Señor")],
  landmarks: [landmark(1, "Fixture Hall"), landmark(2, "Plaza Market")],
  serviceArea: AREA,
  ...over,
});

const resolved = (r: Resolution) => {
  if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
  return r.location;
};

describe("known places", () => {
  it("resolves an exact stop name to that stop", async () => {
    const loc = resolved(await resolveLocation("Alpha Stop", ctx()));
    expect(loc).toMatchObject({ label: "Alpha Stop", stopId: ID(1), source: "stop", fromVerifiedData: true, approximate: false });
  });

  it("ignores case, accents, punctuation and spacing", async () => {
    expect(resolved(await resolveLocation("  alpha   STOP! ", ctx())).stopId).toBe(ID(1));
    expect(resolved(await resolveLocation("cafe senor", ctx())).stopId).toBe(ID(4));
    expect(normalizeName("Café-Señor,  No.1")).toBe("cafe senor no 1");
  });

  it("resolves a landmark, which has no stop of its own", async () => {
    const loc = resolved(await resolveLocation("Fixture Hall", ctx()));
    expect(loc).toMatchObject({ label: "Fixture Hall", source: "landmark", fromVerifiedData: true });
    expect(loc.stopId).toBeUndefined();
  });

  it("matches a partial name when it is the only match, and says it was approximate", async () => {
    const loc = resolved(await resolveLocation("brav", ctx()));
    expect(loc).toMatchObject({ label: "Bravo Stop", approximate: true });
  });

  it("matches every typed word against the start of a word", async () => {
    expect(resolved(await resolveLocation("town pla", ctx())).label).toBe("Town Plaza");
  });

  it("asks which one when several places match, instead of choosing", async () => {
    const r = await resolveLocation("plaza", ctx());
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.candidates.map((c) => c.label)).toEqual(["Town Plaza", "Plaza Market"]);
      expect(r.candidates.map((c) => c.ref)).toEqual([`stop:${ID(3)}`, `landmark:${ID(102)}`]);
    }
  });

  it("asks which one when two stops share a name in different places", async () => {
    const r = await resolveLocation("Alpha Stop", ctx({ stops: [stop(1, "Alpha Stop"), stop(9, "Alpha Stop", pos(9, 9))] }));
    expect(r.status).toBe("ambiguous");
  });

  it("treats a stop and a landmark with the same name in the same spot as one place (the stop)", async () => {
    const r = await resolveLocation("Twin", ctx({ stops: [stop(1, "Twin")], landmarks: [landmark(1, "Twin", pos(1))] }));
    expect(resolved(r)).toMatchObject({ source: "stop", stopId: ID(1) });
  });

  it("does not match stops that are not verified", async () => {
    const c = ctx({ stops: [stop(1, "Alpha Stop", pos(1), "unverified"), stop(2, "Bravo", pos(2), "outdated")] });
    expect((await resolveLocation("Alpha Stop", c)).status).toBe("not-found");
    expect((await resolveLocation("Bravo", c)).status).toBe("not-found");
  });

  it("matches sample data only when explicitly accepted", async () => {
    const c = ctx({ stops: [stop(1, "Sample Alpha", pos(1), "sample")] });
    expect((await resolveLocation("Sample Alpha", c)).status).toBe("not-found");
    expect(resolved(await resolveLocation("Sample Alpha", { ...c, acceptStatuses: ["verified", "sample"] })).stopId).toBe(ID(1));
  });

  it("does not match unverified landmarks", async () => {
    expect((await resolveLocation("Fixture Hall", ctx({ landmarks: [landmark(1, "Fixture Hall", pos(1), "unverified")] }))).status).toBe("not-found");
  });
});

describe("links to a specific place", () => {
  it("resolves stop:<id> and landmark:<id>", async () => {
    expect(resolved(await resolveLocation(`stop:${ID(2)}`, ctx())).label).toBe("Bravo Stop");
    expect(resolved(await resolveLocation(`landmark:${ID(101)}`, ctx())).label).toBe("Fixture Hall");
  });

  it("is not found for an unknown id, and invalid for a malformed one", async () => {
    expect((await resolveLocation(`stop:${ID(77)}`, ctx())).status).toBe("not-found");
    expect(await resolveLocation("stop:not-a-uuid", ctx())).toMatchObject({ status: "invalid" });
  });

  it("does not resolve an unverified stop by id either", async () => {
    expect((await resolveLocation(`stop:${ID(1)}`, ctx({ stops: [stop(1, "Alpha", pos(1), "unverified")] }))).status).toBe("not-found");
  });
});

describe("coordinates (a point chosen on the map)", () => {
  it.each(["@0.10, 0.10", "0.10,0.10", "0.1 0.1", " @0.100000,0.100000 "])("accepts %j", async (text) => {
    const loc = resolved(await resolveLocation(text, ctx()));
    expect(loc).toMatchObject({ source: "coordinates", fromVerifiedData: false, position: { lat: 0.1, lng: 0.1 } });
    expect(loc.stopId).toBeUndefined();
  });

  it("rejects values outside the valid ranges", async () => {
    expect(await resolveLocation("95, 10", ctx({ serviceArea: null }))).toMatchObject({ status: "invalid", message: expect.stringMatching(/valid range/) });
    expect(await resolveLocation("10, 190", ctx({ serviceArea: null }))).toMatchObject({ status: "invalid" });
  });

  it("rejects 0,0", async () => {
    expect(await resolveLocation("0, 0", ctx({ serviceArea: null }))).toMatchObject({ status: "invalid" });
  });

  it("flags a point outside the service area, unless the check is off", async () => {
    expect(await resolveLocation("14.6, 121.0", ctx({ serviceArea: AREA }))).toEqual({ status: "outside-service-area", position: { lat: 14.6, lng: 121 } });
    expect(resolved(await resolveLocation("14.6, 121.0", ctx({ serviceArea: null }))).source).toBe("coordinates");
  });

  it("uses the Butuan area by default", async () => {
    const r = await resolveLocation("0.1, 0.1", { stops: [], landmarks: [] });
    expect(r.status).toBe("outside-service-area");
  });
});

describe("geocoder", () => {
  const geocoder = (impl: Geocoder["search"]): Geocoder & { search: ReturnType<typeof vi.fn> } => ({ search: vi.fn(impl) });

  it("is not asked when a known place matches", async () => {
    const g = geocoder(async () => []);
    await resolveLocation("Alpha Stop", ctx({ geocoder: g }));
    expect(g.search).not.toHaveBeenCalled();
  });

  it("is the last resort, and a single hit is marked approximate and not verified", async () => {
    const g = geocoder(async () => [{ label: "Some Place", position: pos(5, 5) }]);
    const loc = resolved(await resolveLocation("Some Place", ctx({ geocoder: g })));
    expect(loc).toMatchObject({ source: "geocoder", fromVerifiedData: false, approximate: true, label: "Some Place" });
    expect(loc.stopId).toBeUndefined();
  });

  it("offers several hits as a choice, as coordinate links", async () => {
    const g = geocoder(async () => [{ label: "One", position: pos(5, 5) }, { label: "Two", position: pos(6, 6) }]);
    const r = await resolveLocation("somewhere", ctx({ geocoder: g }));
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates.map((c) => c.ref)).toEqual(["@0.150000,0.150000", "@0.160000,0.160000"]);
  });

  it("drops hits outside the service area", async () => {
    const g = geocoder(async () => [{ label: "Far", position: { lat: 14, lng: 121 } }]);
    expect((await resolveLocation("far away", ctx({ geocoder: g }))).status).toBe("not-found");
  });

  it("is not found when there is no geocoder and no match", async () => {
    expect((await resolveLocation("nowhere", ctx())).status).toBe("not-found");
  });

  it("reports an unavailable geocoder instead of failing the search", async () => {
    const g = geocoder(async () => {
      throw new GeocoderError("down");
    });
    expect(await resolveLocation("somewhere", ctx({ geocoder: g }))).toEqual({ status: "geocoder-unavailable" });
  });
});

describe("bad input", () => {
  it("rejects empty, blank and overlong text", async () => {
    expect((await resolveLocation("", ctx())).status).toBe("invalid");
    expect((await resolveLocation("   ", ctx())).status).toBe("invalid");
    expect((await resolveLocation("x".repeat(121), ctx())).status).toBe("invalid");
  });

  it("rejects text with nothing searchable in it", async () => {
    expect((await resolveLocation("!!!", ctx())).status).toBe("invalid");
  });
});
