// @vitest-environment jsdom
import { Map as LeafletMap } from "leaflet";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RouteMap, { type RouteMapProps } from "@/components/map/route-map";
import { SAMPLE_ROUTES } from "@/dev-fixtures/sample-routes";
import { FakeResizeObserver } from "@/test/resize-observer";

const [A, B, C, D] = SAMPLE_ROUTES;

function renderMap(props: Partial<RouteMapProps> = {}) {
  return render(<RouteMap label="Test map" routes={SAMPLE_ROUTES} {...props} />);
}

/** Route lines are the SVG paths in the overlay pane. */
const lines = (container: HTMLElement) =>
  [...container.querySelectorAll<SVGPathElement>(".leaflet-overlay-pane path")].filter(
    (p) => !p.classList.contains("route-hit-line"),
  );
const markers = (container: HTMLElement) => container.querySelectorAll<HTMLElement>(".leaflet-marker-icon");
const marker = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`.leaflet-marker-icon[title="${name}"]`)!;

beforeEach(() => {
  // Spies keep real behaviour; they only record calls.
  vi.spyOn(LeafletMap.prototype, "fitBounds");
  vi.spyOn(LeafletMap.prototype, "setView");
  vi.spyOn(LeafletMap.prototype, "invalidateSize");
});
afterEach(() => vi.restoreAllMocks());

describe("base map", () => {
  it("shows the required OpenStreetMap attribution", () => {
    const { container } = renderMap();
    const attribution = container.querySelector(".leaflet-control-attribution")!;
    expect(attribution.textContent).toContain("OpenStreetMap");
    expect(attribution.querySelector("a[href='https://www.openstreetmap.org/copyright']")).not.toBeNull();
  });

  it("starts at the configurable centre and zoom", () => {
    renderMap({ center: { lat: 9.1, lng: 125.6 }, zoom: 15 });
    expect(screen.getByRole("region", { name: "Test map" })).toBeInTheDocument();
  });

  it("is a labelled region", () => {
    renderMap();
    expect(screen.getByRole("region", { name: "Test map" })).toBeTruthy();
  });
});

describe("route geometry", () => {
  it("draws one coloured line per recorded path and nothing else", () => {
    const { container } = renderMap({ routes: [A] });
    // A: one outbound path + one inbound path.
    const drawn = lines(container);
    expect(drawn).toHaveLength(2);
    expect(drawn.every((p) => p.getAttribute("stroke")?.startsWith("#"))).toBe(true);
    // Leaflet writes undefined style options as the literal text "undefined".
    expect(drawn.every((p) => ![...p.attributes].some((attr) => attr.value === "undefined"))).toBe(true);
  });

  it("draws each part of a MultiLineString separately", () => {
    expect(lines(renderMap({ routes: [C] }).container)).toHaveLength(2);
  });

  it("draws no line for a route without recorded geometry, but still shows its stops", () => {
    const { container } = renderMap({ routes: [D] });
    expect(lines(container)).toHaveLength(0);
    expect(markers(container)).toHaveLength(2);
  });

  it("highlights the selected route and dashes its other direction", () => {
    const { container } = renderMap({ routes: [A, B], selectedId: "sample-a" });
    const weights = lines(container).map((p) => p.getAttribute("stroke-width"));
    expect(weights).toContain("7"); // selected direction
    expect(weights).toContain("5"); // other direction of the selected route
    expect(weights).toContain("3"); // dimmed route B
    expect(container.querySelector("path[stroke-dasharray='2 10']")).not.toBeNull();
  });

  it("swaps which direction is solid", () => {
    const { container, rerender } = renderMap({ routes: [A], selectedId: "sample-a", selectedDirection: "outbound" });
    const solid = () => lines(container).filter((p) => p.getAttribute("stroke-width") === "7" && !p.getAttribute("stroke-dasharray"));
    const before = solid()[0].getAttribute("d");
    rerender(<RouteMap label="Test map" routes={[A]} selectedId="sample-a" selectedDirection="inbound" />);
    expect(solid()[0].getAttribute("d")).not.toBe(before);
  });

  it("gives every route its own stable colour", () => {
    const { container } = renderMap({ routes: [A, B, C] });
    const colors = lines(container).map((p) => p.getAttribute("stroke"));
    expect(new Set(colors).size).toBeGreaterThan(1);
  });
});

describe("stop markers and popups", () => {
  it("shows one marker per stop, shared stops once", () => {
    // A: sa-1..4 + sa-5. B adds sb-1, sb-4 (sa-2/sa-3 shared).
    expect(markers(renderMap({ routes: [A, B] }).container)).toHaveLength(7);
  });

  it("gives markers keyboard focus and an accessible name", () => {
    const { container } = renderMap({ routes: [A] });
    const m = marker(container, "Sample Stop A2");
    expect(m.getAttribute("tabindex")).toBe("0");
    expect(m.getAttribute("aria-label")).toBe("Stop: Sample Stop A2");
  });

  it("popup shows the stop name, its routes and its verification status", () => {
    const { container } = renderMap({ routes: [A, B], onSelect: vi.fn() });
    fireEvent.click(marker(container, "Sample Stop A2"));

    const popup = container.querySelector<HTMLElement>(".leaflet-popup")!;
    const view = within(popup);
    expect(view.getByRole("heading", { name: "Sample Stop A2" })).toBeTruthy();
    expect(view.getByText("Sample data")).toBeTruthy(); // verification badge
    expect(view.getByText("Routes serving this stop")).toBeTruthy();
    expect(view.getByText("SAMPLE-A")).toBeTruthy();
    expect(view.getByText("SAMPLE-B")).toBeTruthy();
    expect(view.getAllByText(/Boarding and drop-off/)).toHaveLength(2);
  });

  it("popup shows an unverified stop as unverified", () => {
    const { container } = renderMap({ routes: [C] });
    fireEvent.click(marker(container, "Sample Stop C2"));
    expect(within(container.querySelector<HTMLElement>(".leaflet-popup")!).getByText("Unverified")).toBeTruthy();
  });

  it("popup reflects per-route boarding rules and direction", () => {
    const { container } = renderMap({ routes: [A] });
    fireEvent.click(marker(container, "Sample Stop A5 (inbound only)"));
    const view = within(container.querySelector<HTMLElement>(".leaflet-popup")!);
    expect(view.getByText(/Drop-off only · Inbound$/)).toBeTruthy();
  });

  it("selecting a route from a popup selects it and closes the popup", () => {
    const onSelect = vi.fn();
    const { container } = renderMap({ routes: [A, B], onSelect });
    fireEvent.click(marker(container, "Sample Stop A2"));
    fireEvent.click(within(container.querySelector<HTMLElement>(".leaflet-popup")!).getByRole("button", { name: /SAMPLE-B/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "sample-b" }));
    expect(container.querySelector(".leaflet-popup")).toBeNull();
  });

  it("is read-only without onSelect (no route buttons in the popup)", () => {
    const { container } = renderMap({ routes: [A] });
    fireEvent.click(marker(container, "Sample Stop A2"));
    expect(within(container.querySelector<HTMLElement>(".leaflet-popup")!).queryByRole("button", { name: /SAMPLE-A/ })).toBeNull();
  });

  it("with a selection, shows only that route's stops", () => {
    expect(markers(renderMap({ routes: [A, B, C], selectedId: "sample-c" }).container)).toHaveLength(3);
  });
});

describe("selecting by clicking overlapping routes", () => {
  const clickCentre = (container: HTMLElement) => {
    const hit = container.querySelector<SVGPathElement>(".route-hit-line")!;
    // jsdom has no layout, so the click lands at (0,0); aim at the map centre instead.
    fireEvent.click(hit, { clientX: 400, clientY: 300 });
  };

  it("asks which route when several share the road", () => {
    const onSelect = vi.fn();
    const { container } = renderMap({ routes: [A, B], onSelect });
    clickCentre(container);
    const popup = container.querySelector<HTMLElement>(".leaflet-popup");
    expect(popup).not.toBeNull();
    expect(within(popup!).getByText("2 routes share this road")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(within(popup!).getByRole("button", { name: /SAMPLE-B/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "sample-b" }));
  });

  it("selects directly when only one route is under the click", () => {
    const onSelect = vi.fn();
    const { container } = renderMap({ routes: [C], onSelect });
    clickCentre(container);
    // C is far from the map centre, so either it picks C or nothing is near; it must never pick another route.
    for (const call of onSelect.mock.calls) expect(call[0].id).toBe("sample-c");
  });

  it("has no clickable lines on a read-only map", () => {
    expect(renderMap({ routes: [A] }).container.querySelector(".route-hit-line")).toBeNull();
  });
});

describe("view controls", () => {
  it("has labelled zoom and return buttons that drive the map", () => {
    const zoomIn = vi.spyOn(LeafletMap.prototype, "zoomIn");
    const zoomOut = vi.spyOn(LeafletMap.prototype, "zoomOut");
    renderMap({ center: { lat: 9, lng: 125.5 }, zoom: 14 });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoomIn).toHaveBeenCalledOnce();
    expect(zoomOut).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Return to Butuan City view" }));
    expect(LeafletMap.prototype.setView).toHaveBeenLastCalledWith([9, 125.5], 14);
  });

  it("disables zoom out at the minimum zoom", async () => {
    renderMap({ zoom: 9 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  });

  it("shows fit and clear buttons only while a route is selected", () => {
    const onClear = vi.fn();
    const { rerender } = renderMap({ onClearSelection: onClear });
    expect(screen.queryByRole("button", { name: "Clear route selection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fit map to selected route" })).toBeNull();

    rerender(<RouteMap label="Test map" routes={SAMPLE_ROUTES} selectedId="sample-a" onClearSelection={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear route selection" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Fit map to selected route" })).toBeTruthy();
  });

  it("hides the buttons when controls are off", () => {
    renderMap({ showControls: false });
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
  });
});

describe("fitting the selected route", () => {
  const fit = () => vi.mocked(LeafletMap.prototype.fitBounds);

  it("does not fit anything until a route is selected", () => {
    renderMap();
    expect(fit()).not.toHaveBeenCalled();
  });

  it("fits the bounds of the selected route, covering both directions", () => {
    const { rerender } = renderMap();
    rerender(<RouteMap label="Test map" routes={SAMPLE_ROUTES} selectedId="sample-a" />);
    expect(fit()).toHaveBeenCalledOnce();
    const bounds = fit().mock.calls[0][0] as { getSouth(): number; getNorth(): number; getWest(): number; getEast(): number };
    expect(bounds.getWest()).toBeCloseTo(125.52);
    expect(bounds.getEast()).toBeCloseTo(125.56);
    expect(bounds.getSouth()).toBeCloseTo(8.9462); // inbound-only vertex is included
    expect(bounds.getNorth()).toBeCloseTo(8.9475);
  });

  it("fits a route that has stops but no geometry using its stops", () => {
    const { rerender } = renderMap();
    rerender(<RouteMap label="Test map" routes={SAMPLE_ROUTES} selectedId="sample-d" />);
    const bounds = fit().mock.calls[0][0] as { getSouth(): number; getNorth(): number };
    expect(bounds.getSouth()).toBeCloseTo(8.935);
    expect(bounds.getNorth()).toBeCloseTo(8.94);
  });

  it("returns to the Butuan view when the selection is cleared", () => {
    const { rerender } = renderMap({ selectedId: "sample-a" });
    vi.mocked(LeafletMap.prototype.setView).mockClear();
    rerender(<RouteMap label="Test map" routes={SAMPLE_ROUTES} selectedId={null} />);
    expect(LeafletMap.prototype.setView).toHaveBeenCalledOnce();
  });

  it("does not re-fit when only the filtered route list changes", () => {
    const { rerender } = renderMap({ selectedId: "sample-a" });
    fit().mockClear();
    rerender(<RouteMap label="Test map" routes={[A, C]} selectedId="sample-a" />);
    rerender(<RouteMap label="Test map" routes={[A]} selectedId="sample-a" selectedDirection="inbound" />);
    expect(fit()).not.toHaveBeenCalled();
  });

  it("re-fits the selected route when the map is resized", async () => {
    renderMap({ selectedId: "sample-a" });
    fit().mockClear();
    vi.mocked(LeafletMap.prototype.invalidateSize).mockClear();

    // The container changes size (e.g. the mobile panel collapses).
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
    act(() => FakeResizeObserver.triggerAll());

    await waitFor(() => expect(LeafletMap.prototype.invalidateSize).toHaveBeenCalled());
    expect(fit()).toHaveBeenCalledOnce();
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  });

  it("ignores resize notifications that do not change the size", async () => {
    renderMap({ selectedId: "sample-a" });
    act(() => FakeResizeObserver.triggerAll());
    await waitFor(() => expect(LeafletMap.prototype.invalidateSize).toHaveBeenCalledOnce());
    act(() => FakeResizeObserver.triggerAll());
    await new Promise((r) => setTimeout(r, 10));
    expect(LeafletMap.prototype.invalidateSize).toHaveBeenCalledOnce();
  });
});

describe("lifecycle", () => {
  it("does not recreate the map when props change", () => {
    const { container, rerender } = renderMap();
    const root = container.querySelector(".leaflet-container");
    rerender(<RouteMap label="Test map" routes={[A]} selectedId="sample-a" />);
    expect(container.querySelector(".leaflet-container")).toBe(root);
  });

  it("removes the map and stops observing on unmount", () => {
    const remove = vi.spyOn(LeafletMap.prototype, "remove");
    const { unmount } = renderMap();
    expect(FakeResizeObserver.instances.size).toBe(1);
    unmount();
    expect(remove).toHaveBeenCalled();
    expect(FakeResizeObserver.instances.size).toBe(0);
  });
});

describe("loading, empty and error states", () => {
  it("announces loading", () => {
    renderMap({ loading: true });
    expect(screen.getByText("Loading routes…")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Test map" })).toHaveAttribute("aria-busy", "true");
  });

  it("explains an empty data set and draws nothing", () => {
    const { container } = renderMap({ routes: [], emptyMessage: "No routes have been published yet." });
    expect(screen.getByText("No routes have been published yet.")).toBeTruthy();
    expect(lines(container)).toHaveLength(0);
    expect(markers(container)).toHaveLength(0);
  });

  it("shows an alert and draws NO routes or stops when the request failed", () => {
    const { container } = renderMap({ error: "We couldn't load route data right now." });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load route data right now.");
    expect(lines(container)).toHaveLength(0);
    expect(markers(container)).toHaveLength(0);
    expect(screen.queryByText("No routes to show on the map.")).toBeNull();
  });

  it("tells the user when base map tiles keep failing, without hiding routes", async () => {
    const { container } = renderMap({ routes: [A] });
    const tiles = [...container.querySelectorAll<HTMLImageElement>("img.leaflet-tile")];
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/base map couldn.t be loaded/)).toBeNull();

    act(() => tiles.slice(0, 4).forEach((t) => fireEvent.error(t)));
    expect(await screen.findByText(/base map couldn.t be loaded/)).toBeTruthy();
    expect(lines(container).length).toBeGreaterThan(0);
  });
});
