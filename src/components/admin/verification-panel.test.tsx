// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationPanel } from "@/components/admin/verification-panel";
import type { RouteRow, VerificationRow } from "@/lib/admin/data";
import { VERIFICATION_CHECKS, todayInManila } from "@/lib/admin/verification";

const verifyRouteAction = vi.fn();
const setRouteStatusAction = vi.fn();
const markRouteOutdatedAction = vi.fn();
const deleteRouteAction = vi.fn();
vi.mock("@/lib/admin/actions/routes", () => ({
  verifyRouteAction: (...a: unknown[]) => verifyRouteAction(...a),
  setRouteStatusAction: (...a: unknown[]) => setRouteStatusAction(...a),
  markRouteOutdatedAction: (...a: unknown[]) => markRouteOutdatedAction(...a),
  deleteRouteAction: (...a: unknown[]) => deleteRouteAction(...a),
}));

const ID = "00000000-0000-4000-8000-0000000000aa";
const route = (over: Partial<RouteRow> = {}): RouteRow => ({
  id: ID, code: null, name: "Test Route", transport_type: "minibus", description: null, origin_label: "A", destination_label: "B",
  status: "draft", verification_status: "unverified", last_verified_at: null, is_sample: false, import_batch_id: null, deactivation_reason: null, deactivated_at: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...over,
});

function setup(r = route(), opts: { dirty?: boolean; verifications?: VerificationRow[] } = {}) {
  const onChanged = vi.fn();
  const onDeleted = vi.fn();
  render(<VerificationPanel route={r} verifications={opts.verifications ?? []} dirty={opts.dirty ?? false} onChanged={onChanged} onDeleted={onDeleted} />);
  return { onChanged, onDeleted };
}
const submit = () => screen.getByRole("button", { name: "Mark route verified" });
const tickAll = async () => {
  for (const c of VERIFICATION_CHECKS) await userEvent.click(screen.getByLabelText(c.label));
};

beforeEach(() => {
  for (const m of [verifyRouteAction, setRouteStatusAction, markRouteOutdatedAction, deleteRouteAction]) m.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("verifying", () => {
  it("offers a checkbox for every aspect that must be verified", () => {
    setup();
    for (const label of [/Transport type/, /Route name and each direction/, /Starting and ending points/, /intermediate stop/, /geometry/, /Boarding and drop-off/, /Fare rules/, /Passenger categories/]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Date the source was checked")).toBeInTheDocument();
    expect(screen.getByLabelText("Source")).toBeInTheDocument();
  });

  it("stays disabled until every box is ticked and a source is given", async () => {
    setup();
    expect(submit()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Source"), "Fictional survey");
    expect(submit()).toBeDisabled(); // no boxes
    for (const c of VERIFICATION_CHECKS.slice(0, -1)) await userEvent.click(screen.getByLabelText(c.label));
    expect(submit()).toBeDisabled(); // one box missing
    await userEvent.click(screen.getByLabelText(VERIFICATION_CHECKS.at(-1)!.label));
    expect(submit()).toBeEnabled();
  });

  it("needs a source", async () => {
    setup();
    await tickAll();
    expect(submit()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Source"), "  ");
    expect(submit()).toBeDisabled();
  });

  it("does not allow a future date", async () => {
    setup();
    await tickAll();
    await userEvent.type(screen.getByLabelText("Source"), "Fictional survey");
    expect(screen.getByLabelText("Date the source was checked")).toHaveAttribute("max", todayInManila());
    fireEvent.change(screen.getByLabelText("Date the source was checked"), { target: { value: "2999-01-01" } });
    expect(submit()).toBeDisabled();
  });

  it("sends the full record and refreshes on success", async () => {
    verifyRouteAction.mockResolvedValue({ ok: true, data: undefined });
    const { onChanged } = setup();
    await tickAll();
    await userEvent.type(screen.getByLabelText("Source"), "Fictional survey");
    fireEvent.change(screen.getByLabelText("Date the source was checked"), { target: { value: "2026-01-15" } });
    await userEvent.type(screen.getByLabelText("Notes (optional)"), "ridden twice");
    await userEvent.click(submit());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const input = verifyRouteAction.mock.calls[0][0];
    expect(input).toMatchObject({ routeId: ID, verifiedOn: "2026-01-15", source: "Fictional survey", notes: "ridden twice" });
    expect(Object.values(input.checks)).toEqual(Array(8).fill(true));
  });

  it("shows the database's reason when verification is refused", async () => {
    verifyRouteAction.mockResolvedValue({ ok: false, error: "The outbound direction needs recorded route geometry" });
    const { onChanged } = setup();
    await tickAll();
    await userEvent.type(screen.getByLabelText("Source"), "Fictional survey");
    await userEvent.click(submit());
    expect(await screen.findByText(/needs recorded route geometry/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("blocks verification while there are unsaved edits", async () => {
    setup(route(), { dirty: true });
    await tickAll();
    await userEvent.type(screen.getByLabelText("Source"), "Fictional survey");
    expect(screen.getByText(/Save your changes first/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it("offers no verification for sample data", () => {
    setup(route({ is_sample: true }));
    expect(screen.getByText(/can never be verified or published/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark route verified" })).toBeNull();
  });
});

describe("visibility", () => {
  it("says a draft is not public", () => {
    setup();
    expect(screen.getAllByText("Not public").length).toBeGreaterThan(0);
    expect(screen.getByText(/the route is draft/)).toBeInTheDocument();
  });

  it("explains that active alone does not publish", () => {
    setup(route({ status: "active" }));
    expect(screen.getByText(/both active and verified/)).toBeInTheDocument();
  });

  it("says when a route is public", () => {
    setup(route({ status: "active", verification_status: "verified", last_verified_at: new Date().toISOString() }));
    expect(screen.getByText("Public: active and verified.")).toBeInTheDocument();
  });

  it("sets active/inactive and reports the result", async () => {
    setRouteStatusAction.mockResolvedValue({ ok: true, data: { status: "active", public: false, reason: "x" } });
    const { onChanged } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Set active" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(setRouteStatusAction).toHaveBeenCalledWith(ID, "active", "");
    expect(screen.getByRole("button", { name: "Currently draft" })).toBeDisabled();
  });

  it("will not deactivate a route without a reason, and sends the reason when given", async () => {
    setRouteStatusAction.mockResolvedValue({ ok: true, data: { status: "inactive", public: false, reason: "x" } });
    const { onChanged } = setup(route({ status: "active", verification_status: "verified", last_verified_at: new Date().toISOString() }));
    expect(screen.getByRole("button", { name: "Set inactive" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason for deactivating/i), "Reported as inaccurate");
    await userEvent.click(screen.getByRole("button", { name: "Set inactive" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(setRouteStatusAction).toHaveBeenCalledWith(ID, "inactive", "Reported as inaccurate");
  });

  it("lets a verified route be marked outdated, after confirmation", async () => {
    markRouteOutdatedAction.mockResolvedValue({ ok: true, data: undefined });
    setup(route({ status: "active", verification_status: "verified", last_verified_at: new Date().toISOString() }));
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Mark verification outdated" }));
    expect(markRouteOutdatedAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Mark verification outdated" }));
    await waitFor(() => expect(markRouteOutdatedAction).toHaveBeenCalledWith(ID));
  });

  it("only offers deletion for routes that are not active or verified", () => {
    const { rerender } = render(<VerificationPanel route={route()} verifications={[]} dirty={false} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete this route" })).toBeInTheDocument();
    rerender(<VerificationPanel route={route({ status: "active" })} verifications={[]} dirty={false} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Delete this route" })).toBeNull();
  });
});

describe("history", () => {
  it("lists who verified it, when, and against what", () => {
    setup(route(), {
      verifications: [{
        id: "v1", route_id: ID, verified_by: "user-123", verified_on: "2026-01-15", source_description: "Fictional survey", notes: "ridden twice",
        created_at: "2026-01-16T01:00:00Z", transport_type_ok: true, name_direction_ok: true, endpoints_ok: true, stops_ok: true,
        geometry_ok: true, boarding_dropoff_ok: true, fares_ok: true, passenger_categories_ok: true,
      }],
    });
    expect(screen.getByText(/Source: Fictional survey/)).toBeInTheDocument();
    expect(screen.getByText("user-123")).toBeInTheDocument();
  });

  it("says plainly when never verified", () => {
    setup();
    expect(screen.getByText("This route has never been verified.")).toBeInTheDocument();
  });
});
