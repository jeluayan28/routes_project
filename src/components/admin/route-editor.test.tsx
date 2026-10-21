// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteEditor } from "@/components/admin/route-editor";
import type { EditorData } from "@/lib/admin/data";

const saveRouteAction = vi.fn();
vi.mock("@/lib/admin/actions/routes", () => ({
  saveRouteAction: (...a: unknown[]) => saveRouteAction(...a),
  searchStopsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createStopAction: vi.fn(),
  setRouteStatusAction: vi.fn(),
  markRouteOutdatedAction: vi.fn(),
  verifyRouteAction: vi.fn(),
  deleteRouteAction: vi.fn(),
}));
vi.mock("@/lib/admin/actions/fares", () => ({ saveFareAction: vi.fn(), deleteFareAction: vi.fn() }));
vi.mock("@/components/admin/editor-map-lazy", () => ({ EditorMapLazy: () => <div>map</div> }));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

const ID = "00000000-0000-4000-8000-0000000000aa";
const S1 = "00000000-0000-4000-8000-000000000001";
const S2 = "00000000-0000-4000-8000-000000000002";

const data = (over: Partial<EditorData> = {}): EditorData => ({
  routeId: ID,
  route: {
    id: ID, code: "T-1", name: "Existing Route", transport_type: "jeepney", description: null, origin_label: "A", destination_label: "B",
    status: "draft", verification_status: "unverified", last_verified_at: null, is_sample: false, import_batch_id: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  },
  draft: {
    code: "T-1", name: "Existing Route", transportType: "jeepney", description: "", originLabel: "A", destinationLabel: "B",
    directions: [{ kind: "outbound", stops: [{ stopId: S1, boarding: null, dropoff: null }, { stopId: S2, boarding: null, dropoff: null }], lines: [], geometrySource: "" }],
  },
  stops: {
    [S1]: { id: S1, name: "First", latitude: 8.95, longitude: 125.54, status: "unverified", barangay: null },
    [S2]: { id: S2, name: "Second", latitude: 8.96, longitude: 125.55, status: "unverified", barangay: null },
  },
  fares: [],
  verifications: [],
  batch: null,
  ...over,
});

const name = () => screen.getByLabelText("Route name") as HTMLInputElement;
const save = () => screen.getByRole("button", { name: /Create draft route|Save changes/ });

beforeEach(() => {
  saveRouteAction.mockReset();
  push.mockReset();
  refresh.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("a new route", () => {
  it("is explicitly a draft, and fares and verification wait until it is saved", () => {
    render(<RouteEditor data={null} />);
    expect(screen.getByText(/saved as drafts. A draft is never public/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Fares" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Verification & status" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  });

  it("will not save without a name", async () => {
    render(<RouteEditor data={null} />);
    await userEvent.click(save());
    expect(await screen.findAllByText("Give the route a name.")).not.toHaveLength(0);
    expect(saveRouteAction).not.toHaveBeenCalled();
  });

  it("saves the draft and opens it for further editing", async () => {
    saveRouteAction.mockResolvedValue({ ok: true, data: { id: ID } });
    render(<RouteEditor data={null} />);
    await userEvent.type(name(), "Fictional Route");
    await userEvent.selectOptions(screen.getByLabelText("Transport type"), "multicab");
    await userEvent.type(screen.getByLabelText("Starting point"), "Here");
    await userEvent.type(screen.getByLabelText("Ending point"), "There");
    await userEvent.click(save());

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/admin/routes/${ID}`));
    expect(saveRouteAction).toHaveBeenCalledWith(null, expect.objectContaining({
      name: "Fictional Route", transportType: "multicab", originLabel: "Here", destinationLabel: "There",
      directions: [{ kind: "outbound", stops: [], lines: [], geometrySource: "" }],
    }));
  });

  it("shows a server error and stays put", async () => {
    saveRouteAction.mockResolvedValue({ ok: false, error: "Another route already uses that code." });
    render(<RouteEditor data={null} />);
    await userEvent.type(name(), "Fictional Route");
    await userEvent.click(save());
    expect(await screen.findByText("Another route already uses that code.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("an existing route", () => {
  it("shows that it is not public, and starts clean", () => {
    render(<RouteEditor data={data()} />);
    expect(screen.getAllByText("Not public").length).toBeGreaterThan(0);
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Fares" })).toBeEnabled();
  });

  it("tracks unsaved changes, warns on leaving, and saves them", async () => {
    saveRouteAction.mockResolvedValue({ ok: true, data: { id: ID } });
    render(<RouteEditor data={data()} />);
    await userEvent.type(name(), " renamed");
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    expect(save()).toBeEnabled();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await userEvent.click(save());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(saveRouteAction).toHaveBeenCalledWith(ID, expect.objectContaining({ name: "Existing Route renamed" }));
    expect(screen.getByText("All changes saved.")).toBeInTheDocument();

    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("keeps edits when saving fails", async () => {
    saveRouteAction.mockResolvedValue({ ok: false, error: "The database rejected that change." });
    render(<RouteEditor data={data()} />);
    await userEvent.type(name(), "!");
    await userEvent.click(save());
    expect(await screen.findByText("The database rejected that change.")).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    expect(name().value).toBe("Existing Route!");
  });

  it("lists what is still missing before verification", () => {
    render(<RouteEditor data={data()} />);
    expect(screen.getByText(/No geometry is recorded for the outbound direction/)).toBeInTheDocument();
  });

  it("opens on the requested tab", () => {
    render(<RouteEditor data={data()} initialTab="verify" />);
    expect(screen.getByRole("tab", { name: "Verification & status" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Verify this route" })).toBeInTheDocument();
  });
});

describe("directions", () => {
  const goToStops = () => userEvent.click(screen.getByRole("tab", { name: "Directions & stops" }));

  it("treats a route as one-way until an inbound direction is added, with separate stop lists", async () => {
    render(<RouteEditor data={data()} />);
    await goToStops();
    expect(screen.getByText(/This route is one-way/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outbound" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Add an inbound direction" }));
    expect(screen.getByRole("button", { name: "Inbound" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/No stops yet/)).toBeInTheDocument(); // not a copy of outbound
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Outbound" }));
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("saves both directions separately", async () => {
    saveRouteAction.mockResolvedValue({ ok: true, data: { id: ID } });
    render(<RouteEditor data={data()} />);
    await goToStops();
    await userEvent.click(screen.getByRole("button", { name: "Add an inbound direction" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saveRouteAction).toHaveBeenCalled());
    const draft = saveRouteAction.mock.calls[0][1];
    expect(draft.directions.map((d: { kind: string }) => d.kind)).toEqual(["outbound", "inbound"]);
    expect(draft.directions[0].stops).toHaveLength(2);
    expect(draft.directions[1].stops).toHaveLength(0);
  });

  it("turns a two-way route one-way after confirmation", async () => {
    const two = data();
    two.draft.directions.push({ kind: "inbound", stops: [{ stopId: S2, boarding: null, dropoff: null }], lines: [], geometrySource: "" });
    render(<RouteEditor data={two} />);
    await goToStops();
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Make the route one-way" }));
    expect(screen.queryByText(/This route is one-way/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Make the route one-way" }));
    expect(screen.getByText(/This route is one-way/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inbound" })).toBeNull();
  });

  it("reorders stops and marks the route as changed", async () => {
    render(<RouteEditor data={data()} />);
    await goToStops();
    await userEvent.click(screen.getByRole("button", { name: "Move First down" }));
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    const items = document.querySelectorAll("ol li");
    expect(items[0].textContent).toContain("Second");
    expect(items[1].textContent).toContain("First");
  });
});

describe("geometry and fares need the saved route", () => {
  it("applies geometry into the draft", async () => {
    render(<RouteEditor data={data()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Geometry" }));
    fireEvent.change(screen.getByLabelText(/Points, one/), { target: { value: "8.95, 125.54\n8.96, 125.55" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply text to route" }));
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    expect(screen.getByText("1 line, 2 points")).toBeInTheDocument();
  });

  it("only offers stops from the saved route when adding a fare", async () => {
    render(<RouteEditor data={data()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Fares" }));
    const options = [...(screen.getByLabelText("Origin stop") as HTMLSelectElement).options].map((o) => o.text);
    expect(options).toEqual(["Whole route", "First", "Second"]);
  });
});
