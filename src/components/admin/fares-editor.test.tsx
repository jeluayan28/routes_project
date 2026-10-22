// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FaresEditor } from "@/components/admin/fares-editor";
import type { EditorStop, FareRow } from "@/lib/admin/data";

const saveFareAction = vi.fn();
const deleteFareAction = vi.fn();
const changeFareAction = vi.fn();
const endFareAction = vi.fn();
vi.mock("@/lib/admin/actions/fares", () => ({
  saveFareAction: (...a: unknown[]) => saveFareAction(...a),
  deleteFareAction: (...a: unknown[]) => deleteFareAction(...a),
  changeFareAction: (...a: unknown[]) => changeFareAction(...a),
  endFareAction: (...a: unknown[]) => endFareAction(...a),
}));

const R = "00000000-0000-4000-8000-0000000000aa";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const S1 = "00000000-0000-4000-8000-000000000001";
const S2 = "00000000-0000-4000-8000-000000000002";
const stops: EditorStop[] = [
  { id: S1, name: "First Stop", latitude: 8.95, longitude: 125.54, status: "unverified", barangay: null },
  { id: S2, name: "Second Stop", latitude: 8.96, longitude: 125.55, status: "unverified", barangay: null },
];
const fare = (over: Partial<FareRow> = {}): FareRow => ({
  id: F1, route_id: R, from_stop_id: S1, to_stop_id: S2, passenger_type: "student", amount: 8.5, currency: "PHP",
  effective_from: "2026-01-01", effective_until: null, verification_status: "unverified", source_description: "fictional", verified_at: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", import_batch_id: null, ...over,
});

function setup(fares: FareRow[] = [], dirty = false) {
  const onChange = vi.fn();
  render(<FaresEditor routeId={R} fares={fares} stops={stops} dirty={dirty} onChange={onChange} />);
  return { onChange };
}

const fillBasics = async (amount = "10") => {
  await userEvent.type(screen.getByLabelText("Amount (₱)"), amount);
  fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-02-01" } });
};

beforeEach(() => {
  saveFareAction.mockReset();
  deleteFareAction.mockReset();
  changeFareAction.mockReset();
  endFareAction.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("fare list", () => {
  it("warns when there are no fares and does not invent any", () => {
    setup();
    expect(screen.getByText(/No fare has been recorded/)).toBeTruthy();
  });

  it("lists origin to destination, category, dates and verification", () => {
    setup([fare(), fare({ id: "00000000-0000-4000-8000-0000000000f3", from_stop_id: null, to_stop_id: null, passenger_type: "regular", amount: 10, effective_until: "2026-12-31", verification_status: "verified" })]);
    expect(screen.getByText("First Stop to Second Stop")).toBeTruthy();
    expect(screen.getByText("Whole route (flat fare)")).toBeTruthy();
    expect(screen.getByText(/₱8.50 · Student/)).toBeTruthy();
    expect(screen.getByText(/until .*2026/)).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Unverified")).toBeTruthy();
  });
});

describe("adding a fare", () => {
  it("saves a flat regular fare with the entered dates", async () => {
    saveFareAction.mockResolvedValue({ ok: true, data: fare({ id: "00000000-0000-4000-8000-0000000000f2", from_stop_id: null, to_stop_id: null, passenger_type: "regular", amount: 10 }) });
    const { onChange } = setup();
    await fillBasics("10");
    await userEvent.click(screen.getByRole("button", { name: "Add fare" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(saveFareAction).toHaveBeenCalledWith({
      id: null, routeId: R, fromStopId: null, toStopId: null, passengerType: "regular", amount: "10",
      effectiveFrom: "2026-02-01", effectiveUntil: "", source: "",
    });
    expect(await screen.findByText(/stays unverified/)).toBeTruthy();
  });

  it("saves a student fare between two stops", async () => {
    saveFareAction.mockResolvedValue({ ok: true, data: fare() });
    setup();
    await userEvent.selectOptions(screen.getByLabelText("Origin stop"), S1);
    await userEvent.selectOptions(screen.getByLabelText("Destination stop"), S2);
    await userEvent.selectOptions(screen.getByLabelText("Passenger category"), "student");
    await fillBasics("8.50");
    fireEvent.change(screen.getByLabelText("Effective until (optional)"), { target: { value: "2026-12-31" } });
    await userEvent.click(screen.getByRole("button", { name: "Add fare" }));
    await waitFor(() => expect(saveFareAction).toHaveBeenCalled());
    expect(saveFareAction.mock.calls[0][0]).toMatchObject({ fromStopId: S1, toStopId: S2, passengerType: "student", amount: "8.50", effectiveUntil: "2026-12-31" });
  });

  it.each([["-5", /negative/], ["12,50", /plain amount/], ["abc", /plain amount/], ["1e3", /plain amount/], ["12.345", /plain amount/]])(
    "rejects amount %s without calling the server",
    async (amount, message) => {
      setup();
      await fillBasics(amount);
      await userEvent.click(screen.getByRole("button", { name: "Add fare" }));
      expect(await screen.findByText(message)).toBeTruthy();
      expect(saveFareAction).not.toHaveBeenCalled();
    },
  );

  it("requires both stops or neither", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText("Origin stop"), S1);
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Add fare" }));
    expect(await screen.findByText(/both an origin and a destination/)).toBeTruthy();
    expect(saveFareAction).not.toHaveBeenCalled();
  });

  it("requires a start date and a sensible end date", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Amount (₱)"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Add fare" }));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("Effective until (optional)"), { target: { value: "2026-05-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Add fare" }));
    expect(await screen.findByText(/end date is before/)).toBeTruthy();
    expect(saveFareAction).not.toHaveBeenCalled();
  });

  it("shows a server rejection such as an overlapping period", async () => {
    saveFareAction.mockResolvedValue({ ok: false, error: "That fare overlaps another fare for the same route, stops and passenger type." });
    const { onChange } = setup();
    await fillBasics();
    await userEvent.click(screen.getByRole("button", { name: "Add fare" }));
    expect(await screen.findByText(/overlaps another fare/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("warns that unsaved stop changes are not available for fares", () => {
    setup([], true);
    expect(screen.getByText(/unsaved changes to the stops/)).toBeTruthy();
  });
});

describe("editing and deleting", () => {
  it("loads a fare into the form and saves it by id", async () => {
    saveFareAction.mockResolvedValue({ ok: true, data: fare({ amount: 9 }) });
    const { onChange } = setup([fare()]);
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect((screen.getByLabelText("Amount (₱)") as HTMLInputElement).value).toBe("8.5");
    await userEvent.clear(screen.getByLabelText("Amount (₱)"));
    await userEvent.type(screen.getByLabelText("Amount (₱)"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Save fare" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(saveFareAction.mock.calls[0][0]).toMatchObject({ id: F1, amount: "9", passengerType: "student" });
    expect(onChange.mock.calls[0][0][0].amount).toBe(9);
  });

  it("asks before deleting", async () => {
    deleteFareAction.mockResolvedValue({ ok: true, data: undefined });
    const { onChange } = setup([fare()]);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(deleteFareAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    expect(deleteFareAction).toHaveBeenCalledWith(F1);
  });
});

describe("verified fares are history", () => {
  const verified = () => fare({ verification_status: "verified", verified_at: "2026-02-01T00:00:00Z" });

  it("offers a price change and an end date instead of edit and delete", () => {
    setup([verified()]);
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Change price/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /End fare/ })).toBeTruthy();
  });

  it("changes the price from a date, keeping the old rule in the list", async () => {
    const created = fare({ id: "00000000-0000-4000-8000-0000000000f9", amount: 9, effective_from: "2026-07-01" });
    const ended = { ...verified(), effective_until: "2026-06-30" };
    changeFareAction.mockResolvedValue({ ok: true, data: [created, ended] });
    const { onChange } = setup([verified()]);
    await userEvent.click(screen.getByRole("button", { name: /Change price/ }));
    await userEvent.type(screen.getByLabelText("New amount (₱)"), "9");
    fireEvent.change(screen.getByLabelText("New price starts on"), { target: { value: "2026-07-01" } });
    await userEvent.type(screen.getByLabelText("Source of the new fare"), "Fictional table");
    await userEvent.click(screen.getByRole("button", { name: "Save new price" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([created, ended]));
    expect(changeFareAction).toHaveBeenCalledWith({ fareId: F1, amount: "9", effectiveFrom: "2026-07-01", source: "Fictional table" });
  });

  it("does not call the server for an invalid new amount", async () => {
    setup([verified()]);
    await userEvent.click(screen.getByRole("button", { name: /Change price/ }));
    await userEvent.type(screen.getByLabelText("New amount (₱)"), "-4");
    fireEvent.change(screen.getByLabelText("New price starts on"), { target: { value: "2026-07-01" } });
    await userEvent.type(screen.getByLabelText("Source of the new fare"), "Fictional table");
    await userEvent.click(screen.getByRole("button", { name: "Save new price" }));
    expect(await screen.findByText(/negative/i)).toBeTruthy();
    expect(changeFareAction).not.toHaveBeenCalled();
  });
});
