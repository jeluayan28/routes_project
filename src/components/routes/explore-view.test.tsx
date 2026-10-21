// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Map as LeafletMap } from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExploreView } from "@/components/routes/explore-view";
import { SAMPLE_ROUTES } from "@/dev-fixtures/sample-routes";

// next/dynamic is bypassed: the real map is loaded directly in jsdom.
vi.mock("@/components/map/route-map-lazy", async () => {
  const { default: RouteMap } = await import("@/components/map/route-map");
  return { RouteMapLazy: RouteMap };
});

beforeEach(() => {
  vi.spyOn(LeafletMap.prototype, "fitBounds");
});
afterEach(() => vi.restoreAllMocks());

const view = (props: Partial<React.ComponentProps<typeof ExploreView>> = {}) =>
  render(<ExploreView routes={SAMPLE_ROUTES} source="sample" {...props} />);

const list = () => screen.getByRole("list", { name: "Routes" });
const listButtons = () => within(list()).getAllByRole("button");
const routeSelect = () => screen.getByRole("combobox", { name: "Select a route" }) as HTMLSelectElement;
const marker = (c: HTMLElement, name: string) =>
  c.querySelector<HTMLElement>(`.leaflet-marker-icon[title="${name}"]`)!;

describe("filtering by transport type", () => {
  it("lists every route by default and says how many", () => {
    view();
    expect(listButtons()).toHaveLength(4);
    expect(screen.getByText("4 routes")).toBeTruthy();
  });

  it("filters list, dropdown and map together", () => {
    const { container } = view();
    fireEvent.click(screen.getByRole("button", { name: "Jeepney" })); // turn jeepney off

    expect(screen.getByRole("button", { name: "Jeepney" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Multicab" })).toHaveAttribute("aria-pressed", "true");
    expect(listButtons()).toHaveLength(2);
    expect(within(list()).queryByText("Sample Route A")).toBeNull();
    expect([...routeSelect().options].map((o) => o.text)).toEqual([
      "All routes",
      "SAMPLE-C · Sample Route C",
      "SAMPLE-D · Sample Route D (no geometry)",
    ]);
    // Jeepney-only stops are gone from the map.
    expect(marker(container, "Sample Stop A1")).toBeNull();
    expect(marker(container, "Sample Stop C1")).not.toBeNull();
  });

  it("shows an explanation when no type is chosen", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Jeepney" }));
    fireEvent.click(screen.getByRole("button", { name: "Multicab" }));
    expect(screen.getByText("No transport type selected")).toBeTruthy();
    expect(screen.getByText("No routes match the current filters.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all types" }));
    expect(listButtons()).toHaveLength(4);
  });

  it("filters by search text", () => {
    view();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "stop c2" } });
    expect(listButtons()).toHaveLength(1);
  });
});

describe("route selection", () => {
  it("selecting from the list highlights it, shows details and ordered stops, and fits the map", () => {
    const { container } = view();
    fireEvent.click(within(list()).getByRole("button", { name: /SAMPLE-A/ }));

    expect(screen.getByRole("heading", { name: "Sample Route A" })).toBeTruthy();
    expect(screen.getAllByText(/^Stop \d+:$/)).toHaveLength(4); // ordered stop list, outbound
    expect(routeSelect().value).toBe("sample-a");
    expect(LeafletMap.prototype.fitBounds).toHaveBeenCalledOnce();
    expect(container.querySelector("path[stroke-width='7']")).not.toBeNull();
    expect(screen.getByText("Showing route SAMPLE-A, Sample Route A")).toBeTruthy();
  });

  it("lists the selected route's stops in recorded order", () => {
    view();
    fireEvent.click(within(list()).getByRole("button", { name: /SAMPLE-B/ }));
    const ordered = [...document.querySelectorAll("ol li p.text-sm")].map((p) => p.textContent?.replace(/^Stop \d+: /, ""));
    expect(ordered).toEqual(["Sample Stop B1", "Sample Stop A2", "Sample Stop A3", "Sample Stop B4"]);
  });

  it("selecting from the dropdown selects the same route everywhere", () => {
    const { container } = view();
    fireEvent.change(routeSelect(), { target: { value: "sample-c" } });
    expect(screen.getByRole("heading", { name: "Sample Route C" })).toBeTruthy();
    expect(LeafletMap.prototype.fitBounds).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".leaflet-marker-icon")).toHaveLength(3);
  });

  it("selecting from a map popup selects the same route everywhere", () => {
    const { container } = view();
    fireEvent.click(marker(container, "Sample Stop A2"));
    fireEvent.click(within(container.querySelector<HTMLElement>(".leaflet-popup")!).getByRole("button", { name: /SAMPLE-B/ }));
    expect(screen.getByRole("heading", { name: "Sample Route B" })).toBeTruthy();
    expect(routeSelect().value).toBe("sample-b");
  });

  it("clearing from the map button returns to the list and the city view", () => {
    const { container } = view({ initialSelectedId: "sample-a" });
    expect(screen.getByRole("heading", { name: "Sample Route A" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear route selection" }));
    expect(screen.queryByText("Starting point")).toBeNull(); // details panel is gone
    expect(routeSelect().value).toBe("");
    expect(listButtons()).toHaveLength(4);
    expect(container.querySelectorAll(".leaflet-marker-icon").length).toBeGreaterThan(3);
  });

  it("clearing from the sidebar clears the map too", () => {
    const { container } = view({ initialSelectedId: "sample-a" });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear selection" })[0]);
    expect(container.querySelector("path[stroke-width='7']")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear route selection" })).toBeNull();
  });

  it("keeps the selected route visible when its type is filtered out", () => {
    view({ initialSelectedId: "sample-a" });
    fireEvent.click(screen.getByRole("button", { name: "Jeepney" }));
    expect(routeSelect().value).toBe("sample-a");
    expect(screen.getByRole("heading", { name: "Sample Route A" })).toBeTruthy();
  });

  it("ignores an unknown initial route id", () => {
    view({ initialSelectedId: "does-not-exist" });
    expect(routeSelect().value).toBe("");
  });
});

describe("directions", () => {
  it("offers both directions, each with its own stops, for a two-way route", () => {
    view({ initialSelectedId: "sample-a" });
    const group = screen.getByRole("group", { name: "Direction" });
    const outbound = within(group).getByRole("button", { name: /Outbound/ });
    const inbound = within(group).getByRole("button", { name: /Inbound/ });
    expect(outbound).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Sample Stop A5 (inbound only)")).toBeNull();

    fireEvent.click(inbound);
    expect(inbound).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Sample Stop A5 (inbound only)")).toBeTruthy();
  });

  it("switching direction restyles the map without re-fitting", () => {
    const { container } = view({ initialSelectedId: "sample-a" });
    const fitCalls = vi.mocked(LeafletMap.prototype.fitBounds).mock.calls.length;
    const solid = () => [...container.querySelectorAll("path[stroke-width='7']")].map((p) => p.getAttribute("d"));
    const before = solid();
    fireEvent.click(screen.getByRole("button", { name: /Inbound/ }));
    expect(solid()).not.toEqual(before);
    expect(vi.mocked(LeafletMap.prototype.fitBounds).mock.calls.length).toBe(fitCalls);
  });

  it("does not claim a one-way route runs both ways", () => {
    view({ initialSelectedId: "sample-b" });
    expect(screen.queryByRole("group", { name: "Direction" })).toBeNull();
    expect(screen.getByText(/One-way: no return direction is recorded/)).toBeTruthy();
    expect(screen.getByText("One-way (start to end)")).toBeTruthy();
  });

  it("resets to the first direction when another route is chosen", () => {
    view({ initialSelectedId: "sample-a" });
    fireEvent.click(screen.getByRole("button", { name: /Inbound/ }));
    fireEvent.change(routeSelect(), { target: { value: "" } });
    fireEvent.change(routeSelect(), { target: { value: "sample-a" } });
    expect(screen.getByRole("button", { name: /Outbound/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("says plainly when a route has no recorded line", () => {
    const { container } = view({ initialSelectedId: "sample-d" });
    expect(screen.getByText(/No route line has been recorded for this direction/)).toBeTruthy();
    expect(container.querySelector("path[stroke-width='7']")).toBeNull();
  });
});

describe("empty data", () => {
  it("shows an empty state in the list and on the map", () => {
    const { container } = view({ routes: [], source: "database" });
    expect(screen.getByText("No routes published yet")).toBeTruthy();
    expect(screen.getByText("No routes have been published yet.")).toBeTruthy();
    expect(container.querySelectorAll(".leaflet-marker-icon")).toHaveLength(0);
    expect(routeSelect().options).toHaveLength(1);
  });

  it("does not show the development banner for database data", () => {
    view({ routes: [], source: "database" });
    expect(screen.queryByText("Development data.")).toBeNull();
  });

  it("labels fixtures as development data", () => {
    view();
    expect(screen.getByText("Development data.")).toBeTruthy();
  });
});

describe("mobile layout and accessibility", () => {
  it("lets the route panel be collapsed so the map can grow", () => {
    view();
    const toggle = screen.getByRole("button", { name: /Collapse route list/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel.className).not.toContain("max-lg:hidden");

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Expand route list/ })).toHaveAttribute("aria-expanded", "false");
    expect(panel.className).toContain("max-lg:hidden");
  });

  it("re-expands the panel when a route is picked on the map", () => {
    const { container } = view();
    fireEvent.click(screen.getByRole("button", { name: /Collapse route list/ }));
    fireEvent.click(marker(container, "Sample Stop A2"));
    fireEvent.click(within(container.querySelector<HTMLElement>(".leaflet-popup")!).getByRole("button", { name: /SAMPLE-A/ }));
    expect(screen.getByRole("button", { name: /Collapse route list/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("gives every map control an accessible name and a touch-sized target", () => {
    view({ initialSelectedId: "sample-a" });
    for (const name of ["Zoom in", "Zoom out", "Return to Butuan City view", "Fit map to selected route", "Clear route selection"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("size-11"); // 44px on touch screens
    }
  });

  it("re-fits the selected route when the map area changes size", async () => {
    view({ initialSelectedId: "sample-a" });
    const calls = vi.mocked(LeafletMap.prototype.fitBounds).mock.calls.length;
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 280 });
    const { FakeResizeObserver } = await import("@/test/resize-observer");
    await act(async () => {
      FakeResizeObserver.triggerAll();
      await new Promise((r) => setTimeout(r, 10));
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
    expect(vi.mocked(LeafletMap.prototype.fitBounds).mock.calls.length).toBeGreaterThan(calls);
  });
});
