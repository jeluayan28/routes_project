// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripSearchForm } from "@/components/search/trip-search-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const from = () => screen.getByLabelText("Starting point") as HTMLInputElement;
const to = () => screen.getByLabelText("Destination") as HTMLInputElement;
/** Opens a shadcn Select by its label and picks an option by its visible name. */
const choose = async (label: string, option: string) => {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole("option", { name: option }));
};
const submit = () => userEvent.click(screen.getByRole("button", { name: "Search Routes" }));
const params = () => new URL(push.mock.calls[0][0], "http://x").searchParams;

beforeEach(() => push.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("TripSearchForm", () => {
  it("opens the search page with every option in the URL", async () => {
    render(<TripSearchForm />);
    await userEvent.type(from(), "Place One");
    await userEvent.type(to(), "Place Two");
    await choose("Passenger", "Student");
    await choose("Prefer", "Lowest fare");
    await choose("Up to", "1 transfer");
    await userEvent.click(screen.getByRole("button", { name: "Multicab" })); // turn multicab off
    await submit();

    expect(new URL(push.mock.calls[0][0], "http://x").pathname).toBe("/search");
    expect(Object.fromEntries(params())).toEqual({
      from: "Place One", to: "Place Two", types: "minibus", category: "student", transfers: "1", pref: "lowest-fare",
    });
  }, 20_000);

  it("starts with sensible defaults", async () => {
    render(<TripSearchForm />);
    await userEvent.type(from(), "A");
    await userEvent.type(to(), "B");
    await submit();
    expect(Object.fromEntries(params())).toMatchObject({ types: "minibus,multicab", category: "regular", transfers: "2", pref: "fewest-transfers" });
  });

  it("offers up to four transfers and no more", async () => {
    render(<TripSearchForm />);
    await userEvent.click(screen.getByLabelText("Up to"));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["No transfers", "1 transfer", "2 transfers", "3 transfers", "4 transfers"]);
  });

  it("validates before searching", async () => {
    render(<TripSearchForm />);
    await submit();
    expect(await screen.findByText("Enter a starting point.")).toBeInTheDocument();
    expect(screen.getByText("Enter a destination.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(from()).toHaveFocus();
  });

  it("refuses the same place twice, and no transport type", async () => {
    render(<TripSearchForm />);
    await userEvent.type(from(), "Same");
    await userEvent.type(to(), "same");
    await submit();
    expect(await screen.findByText(/different/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Minibus" }));
    await userEvent.click(screen.getByRole("button", { name: "Multicab" }));
    await submit();
    expect(await screen.findByText("Choose at least one transport type.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("swaps the two places", async () => {
    render(<TripSearchForm />);
    await userEvent.type(from(), "One");
    await userEvent.type(to(), "Two");
    await userEvent.click(screen.getByRole("button", { name: "Swap starting point and destination" }));
    expect([from().value, to().value]).toEqual(["Two", "One"]);
  });

  it("shows the values of a previous search", () => {
    render(<TripSearchForm initial={{ from: "Alpha", to: "Beta", category: "pwd", preference: "shortest-walking", maxTransfers: 3, types: ["multicab"] }} />);
    expect([from().value, to().value]).toEqual(["Alpha", "Beta"]);
    expect(screen.getByLabelText("Passenger")).toHaveTextContent("PWD");
    expect(screen.getByLabelText("Prefer")).toHaveTextContent("Shortest walking");
    expect(screen.getByLabelText("Up to")).toHaveTextContent("3 transfers");
    expect(screen.getByRole("button", { name: "Multicab" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Minibus" })).toHaveAttribute("aria-pressed", "false");
  });

  it("hands validated input to onSearch instead of navigating", async () => {
    const onSearch = vi.fn();
    render(<TripSearchForm onSearch={onSearch} />);
    await userEvent.type(from(), "A");
    await userEvent.type(to(), "B");
    await submit();
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ from: "A", to: "B", category: "regular", maxTransfers: 2, preference: "fewest-transfers" }));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Use my location", () => {
  it("fills the starting point with coordinates, only when asked", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 8.95, longitude: 125.54 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    render(<TripSearchForm />);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    await waitFor(() => expect(from().value).toBe("@8.950000,125.540000"));
  });

  it("says so, and keeps the field editable, when location is denied", async () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError) } });
    render(<TripSearchForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(await screen.findByText(/couldn't get your location/)).toBeInTheDocument();
    fireEvent.change(from(), { target: { value: "Typed place" } });
    expect(from().value).toBe("Typed place");
  });

  it("copes with a browser that has no geolocation", async () => {
    vi.stubGlobal("navigator", {});
    render(<TripSearchForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(await screen.findByText(/couldn't get your location/)).toBeInTheDocument();
  });
});
