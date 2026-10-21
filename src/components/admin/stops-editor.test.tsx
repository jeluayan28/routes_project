// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StopsEditor } from "@/components/admin/stops-editor";
import type { EditorStop } from "@/lib/admin/data";
import type { DirectionDraft } from "@/lib/admin/route-form";

const searchStopsAction = vi.fn();
const createStopAction = vi.fn();
vi.mock("@/lib/admin/actions/routes", () => ({
  searchStopsAction: (...a: unknown[]) => searchStopsAction(...a),
  createStopAction: (...a: unknown[]) => createStopAction(...a),
}));

// The real map needs Leaflet; this stand-in lets a test "click" a chosen point.
vi.mock("@/components/admin/editor-map-lazy", () => ({
  EditorMapLazy: ({ onPick, pending }: { onPick: (p: { lat: number; lng: number }) => void; pending: unknown }) => (
    <div>
      <button type="button" onClick={() => onPick({ lat: 8.95, lng: 125.54 })}>simulate map click</button>
      <span data-testid="pending">{pending ? "has point" : "no point"}</span>
    </div>
  ),
}));

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const stop = (n: number, name = `Stop ${n}`): EditorStop => ({ id: U(n), name, latitude: 8.9 + n / 100, longitude: 125.5, status: "unverified", barangay: null });
const known: Record<string, EditorStop> = Object.fromEntries([1, 2, 3].map((n) => [U(n), stop(n)]));

const direction = (ids: number[] = [1, 2, 3]): DirectionDraft => ({
  kind: "outbound",
  stops: ids.map((n) => ({ stopId: U(n), boarding: null, dropoff: null })),
  lines: [],
  geometrySource: "",
});

function setup(dir = direction(), extra: Partial<Parameters<typeof StopsEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onStopKnown = vi.fn();
  render(<StopsEditor routeKey="r" direction={dir} otherDirection={null} stops={known} onChange={onChange} onStopKnown={onStopKnown} {...extra} />);
  return { onChange, onStopKnown };
}

beforeEach(() => {
  searchStopsAction.mockReset();
  createStopAction.mockReset();
});

describe("ordered stop list", () => {
  it("shows stops in order with positions", () => {
    setup();
    const items = within(document.querySelector("ol") as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Stop 1: Stop 1"), expect.stringContaining("Stop 2: Stop 2"), expect.stringContaining("Stop 3: Stop 3"),
    ]);
  });

  it("moves a stop down and up", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Move Stop 1 down" }));
    expect(onChange.mock.calls[0][0].map((s: { stopId: string }) => s.stopId)).toEqual([U(2), U(1), U(3)]);
    await userEvent.click(screen.getByRole("button", { name: "Move Stop 3 up" }));
    expect(onChange.mock.calls[1][0].map((s: { stopId: string }) => s.stopId)).toEqual([U(1), U(3), U(2)]);
  });

  it("disables moving past either end", () => {
    setup();
    expect(screen.getByRole("button", { name: "Move Stop 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Stop 3 down" })).toBeDisabled();
  });

  it("removes a stop", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Remove Stop 2" }));
    expect(onChange.mock.calls[0][0].map((s: { stopId: string }) => s.stopId)).toEqual([U(1), U(3)]);
  });

  it("sets per-route boarding and drop-off permissions", async () => {
    const { onChange } = setup();
    const boarding = screen.getAllByLabelText("Boarding")[0];
    await userEvent.selectOptions(boarding, "no");
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ stopId: U(1), boarding: false, dropoff: null });
    await userEvent.selectOptions(screen.getAllByLabelText("Drop-off")[1], "yes");
    expect(onChange.mock.calls[1][0][1]).toMatchObject({ stopId: U(2), boarding: null, dropoff: true });
  });

  it("explains an empty direction", () => {
    setup(direction([]));
    expect(screen.getByText(/No stops yet/)).toBeTruthy();
  });

  it("labels the direction", () => {
    setup(direction(), {});
    expect(screen.getByRole("heading", { name: /Outbound stops, in order/ })).toBeTruthy();
  });
});

describe("adding by search", () => {
  it("finds existing stops and adds one at the end", async () => {
    searchStopsAction.mockResolvedValue({ ok: true, data: [stop(4, "Plaza Stop")] });
    const { onChange, onStopKnown } = setup();
    await userEvent.type(screen.getByLabelText("Search by stop name"), "plaza");
    expect(await screen.findByText("Plaza Stop", { selector: "p" })).toBeTruthy();
    expect(searchStopsAction).toHaveBeenLastCalledWith("plaza");

    await userEvent.click(screen.getByRole("button", { name: /Add Plaza Stop/ }));
    expect(onStopKnown).toHaveBeenCalledWith(expect.objectContaining({ id: U(4) }));
    expect(onChange.mock.calls[0][0].map((s: { stopId: string }) => s.stopId)).toEqual([U(1), U(2), U(3), U(4)]);
  });

  it("does not add a stop that is already in this direction", async () => {
    searchStopsAction.mockResolvedValue({ ok: true, data: [stop(2)] });
    const { onChange } = setup();
    await userEvent.type(screen.getByLabelText("Search by stop name"), "stop");
    const button = await screen.findByRole("button", { name: /Added|Add Stop 2/ });
    expect(button).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the number of matches and a search failure", async () => {
    searchStopsAction.mockResolvedValue({ ok: false, error: "Search is down." });
    setup();
    await userEvent.type(screen.getByLabelText("Search by stop name"), "x");
    expect(await screen.findByText("Search is down.")).toBeTruthy();
  });

  it("does not search for blank input", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Search by stop name"), "   ");
    await new Promise((r) => setTimeout(r, 350));
    expect(searchStopsAction).not.toHaveBeenCalled();
  });
});

describe("adding by coordinates", () => {
  const open = async () => userEvent.click(screen.getByRole("button", { name: "Enter coordinates" }));
  const fill = async (lat: string, lng: string, name = "New Stop") => {
    await userEvent.type(screen.getByLabelText("Latitude"), lat);
    await userEvent.type(screen.getByLabelText("Longitude"), lng);
    await userEvent.type(screen.getByLabelText("Stop name"), name);
  };

  it("creates the stop from valid coordinates and adds it", async () => {
    createStopAction.mockResolvedValue({ ok: true, data: stop(5, "New Stop") });
    const { onChange } = setup();
    await open();
    await fill("8.95", "125.54");
    await userEvent.click(screen.getByRole("button", { name: "Create stop and add it" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(createStopAction).toHaveBeenCalledWith(expect.objectContaining({ name: "New Stop", latitude: 8.95, longitude: 125.54 }));
    expect(onChange.mock.calls[0][0].at(-1).stopId).toBe(U(5));
  });

  it("validates before calling the server and says what is wrong", async () => {
    setup();
    await open();
    await fill("95", "abc");
    await userEvent.click(screen.getByRole("button", { name: "Create stop and add it" }));
    expect(await screen.findByText(/outside -90 to 90/)).toBeTruthy();
    expect(screen.getByText(/longitude "abc" is not a decimal number/)).toBeTruthy();
    expect(createStopAction).not.toHaveBeenCalled();
  });

  it("rejects 0,0 and warns about a location outside Butuan", async () => {
    setup();
    await open();
    await fill("0", "0");
    await userEvent.click(screen.getByRole("button", { name: "Create stop and add it" }));
    expect(await screen.findByText(/placeholder/)).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Latitude"));
    await userEvent.clear(screen.getByLabelText("Longitude"));
    await userEvent.type(screen.getByLabelText("Latitude"), "14.6");
    await userEvent.type(screen.getByLabelText("Longitude"), "121");
    expect(screen.getByText(/outside the Butuan City area/)).toBeTruthy();
  });

  it("requires a name", async () => {
    setup();
    await open();
    await userEvent.type(screen.getByLabelText("Latitude"), "8.95");
    await userEvent.type(screen.getByLabelText("Longitude"), "125.54");
    await userEvent.click(screen.getByRole("button", { name: "Create stop and add it" }));
    expect(createStopAction).not.toHaveBeenCalled();
  });

  it("shows a duplicate-stop error from the server instead of adding", async () => {
    createStopAction.mockResolvedValue({ ok: false, error: "A stop called “New Stop” already exists at this spot." });
    const { onChange } = setup();
    await open();
    await fill("8.95", "125.54");
    await userEvent.click(screen.getByRole("button", { name: "Create stop and add it" }));
    expect(await screen.findByText(/already exists at this spot/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("adding by picking on the map", () => {
  it("needs a clicked location and a name, then creates the stop there", async () => {
    createStopAction.mockResolvedValue({ ok: true, data: stop(6, "Picked") });
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Pick on the map" }));

    const create = screen.getByRole("button", { name: "Create stop here and add it" });
    expect(create).toBeDisabled();
    expect(screen.getByText("No location chosen yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "simulate map click" }));
    expect(screen.getByText("8.95, 125.54")).toBeTruthy();
    expect(screen.getByTestId("pending").textContent).toBe("has point");
    expect(create).toBeDisabled(); // still no name

    await userEvent.type(screen.getByLabelText("Stop name"), "Picked");
    expect(create).toBeEnabled();
    await userEvent.click(create);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(createStopAction).toHaveBeenCalledWith(expect.objectContaining({ name: "Picked", latitude: 8.95, longitude: 125.54 }));
  });
});
