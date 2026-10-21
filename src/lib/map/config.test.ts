import { afterEach, describe, expect, it, vi } from "vitest";
import { OSM_TILES, resolveTileConfig } from "./config";

afterEach(() => vi.restoreAllMocks());

describe("resolveTileConfig", () => {
  it("defaults to OpenStreetMap with its attribution", () => {
    const cfg = resolveTileConfig(undefined, undefined);
    expect(cfg).toEqual(OSM_TILES);
    expect(cfg.attribution).toContain("OpenStreetMap");
    expect(cfg.attribution).toContain("openstreetmap.org/copyright");
  });

  it("accepts a custom https provider that supplies attribution", () => {
    const cfg = resolveTileConfig("https://tiles.example.com/{z}/{x}/{y}.png", "© Example");
    expect(cfg).toMatchObject({ url: "https://tiles.example.com/{z}/{x}/{y}.png", attribution: "© Example" });
  });

  it.each([
    ["no attribution", "https://tiles.example.com/{z}/{x}/{y}.png", undefined],
    ["a blank attribution", "https://tiles.example.com/{z}/{x}/{y}.png", "  "],
    ["plain http", "http://tiles.example.com/{z}/{x}/{y}.png", "© Example"],
    ["missing placeholders", "https://tiles.example.com/tile.png", "© Example"],
  ])("falls back to OSM (with its attribution) for %s", (_n, url, attribution) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveTileConfig(url, attribution)).toEqual(OSM_TILES);
  });
});
