// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TripResults } from "@/components/search/trip-results";
import { flatFare, GRID_STOPS, network, route, at } from "@/lib/search/__fixtures__/fictional";
import type { TripParams } from "@/lib/search/params";
import { runTripSearch, type TripSearchResponse } from "@/lib/search/service";
import type { RawNetwork } from "@/lib/search/types";

const mapProps = vi.fn();
vi.mock("@/components/search/trip-map-lazy", () => ({
  TripMapLazy: (props: { journey: { id: string } | null }) => {
    mapProps(props);
    return <div data-testid="map">{props.journey?.id ?? "no journey"}</div>;
  },
}));

const PARAMS: TripParams = { from: "Fixture stop A", to: "Fixture stop E", types: ["jeepney", "multicab"], category: "regular", maxTransfers: 2, preference: "fewest-transfers" };

const search = (raw: RawNetwork, over: Partial<TripParams> = {}, source: "database" | "sample" = "database") =>
  runTripSearch({ ...PARAMS, ...over }, {
    loadData: async () => ({
      status: "ok", source,
      data: { network: raw, stops: raw.stops.map((s) => ({ id: s.id, name: s.name, position: s.position, status: s.status })), landmarks: [] },
    }),
    serviceArea: null,
    now: new Date("2026-06-01T04:00:00Z"),
  });

const show = async (raw: RawNetwork, over: Partial<TripParams> = {}, source: "database" | "sample" = "database") => {
  const response = await search(raw, over, source);
  render(<TripResults response={response} params={{ ...PARAMS, ...over }} />);
  return response;
};

describe("journeys", () => {
  const raw = network(
    [route("R1", ["A", "B", "C"], { geometry: [[at(0), at(1), at(2)]] }), route("R2", ["C", "D", "E"])],
    [flatFare("R1", 8), flatFare("R2", 7.5)],
  );

  it("shows steps, route names, boarding and drop-off, and the fare breakdown", async () => {
    await show(raw);
    expect(screen.getByRole("heading", { name: "1 option" })).toBeInTheDocument();
    const card = screen.getByRole("article");
    expect(within(card).getByText("₱15.50")).toBeInTheDocument();
    expect(within(card).getByText("Fixture route R1")).toBeInTheDocument();
    expect(within(card).getByText("₱8.00")).toBeInTheDocument();
    expect(within(card).getByText("₱7.50")).toBeInTheDocument();
    expect(within(card).getByText(/Board Jeepney R1 \(Fixture route R1\) at Fixture stop A, toward Fixture stop C\. Get off at Fixture stop C after 2 stops\./)).toBeInTheDocument();
    expect(within(card).getByText("Transfer at Fixture stop C.")).toBeInTheDocument();
    expect(within(card).getByText(/Board Jeepney R2/)).toBeInTheDocument();
    expect(within(card).getByText("1 transfer", { exact: false })).toBeInTheDocument();
  });

  it("states what is verified, and that there is no travel time", async () => {
    await show(raw);
    const card = screen.getByRole("article");
    expect(within(card).getByText("Verified routes")).toBeInTheDocument();
    expect(within(card).getByText(/^Verified .*2026/)).toBeInTheDocument();
    expect(within(card).getByText("No travel time available")).toBeInTheDocument();
    expect(screen.getByText(/no timing data/i)).toBeInTheDocument();
  });

  it("lists the stops along the way", async () => {
    await show(raw);
    const [first, second] = screen.getAllByText("Stops along the way (1)");
    await userEvent.click(first);
    expect(screen.getByText("Fixture stop B")).toBeVisible();
    await userEvent.click(second);
    expect(screen.getByText("Fixture stop D")).toBeVisible();
  });

  it("says when a ride's path is not on the map", async () => {
    await show(raw);
    expect(screen.getByText("The path for this ride is not shown on the map.")).toBeInTheDocument();
  });

  it("gives no total when a segment's fare is missing, and says which and why", async () => {
    await show(network(raw.routes, [flatFare("R1", 8)]));
    expect(screen.getByText("Total fare not available")).toBeInTheDocument();
    expect(screen.getByText(/verified regular fare for Fixture route R2/)).toBeInTheDocument();
    expect(screen.getByText(/The other segments cost ₱8\.00/)).toBeInTheDocument();
    expect(screen.queryByText("₱15.50")).toBeNull();
    expect(screen.getByText("No fare has been recorded for this ride.")).toBeInTheDocument();
  });

  it("explains a missing fare for the chosen passenger category", async () => {
    await show(network([route("R1", ["A", "B"])], [flatFare("R1", 8)]), { to: "Fixture stop B", category: "student" });
    expect(screen.getByText("No student fare has been recorded for this ride.")).toBeInTheDocument();
    expect(screen.getByText(/Student fare/)).toBeInTheDocument();
  });

  it("explains an unverified fare is not shown", async () => {
    await show(network([route("R1", ["A", "B"])], [flatFare("R1", 8, { status: "unverified" })]), { to: "Fixture stop B" });
    expect(screen.getByText(/has not been verified, so it is not shown/)).toBeInTheDocument();
  });

  it("labels sample data and shows the banner", async () => {
    const sample: RawNetwork = {
      stops: GRID_STOPS.map((s) => ({ ...s, status: "sample" as const })),
      routes: [route("R1", ["A", "B"], { status: "sample" })],
      fares: [flatFare("R1", 1, { status: "sample" })],
    };
    await show(sample, { to: "Fixture stop B" }, "sample");
    expect(screen.getByText("Development data.")).toBeInTheDocument();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.queryByText("Verified routes")).toBeNull();
  });

  it("shows several options and lets one be chosen for the map", async () => {
    const two = network(
      [route("R1", ["A", "B", "C", "D", "E"]), route("R2", ["A", "C"]), route("R3", ["C", "E"])],
      [flatFare("R1", 30), flatFare("R2", 5), flatFare("R3", 5)],
    );
    await show(two, { preference: "lowest-fare" });
    expect(screen.getByRole("heading", { name: "2 options" })).toBeInTheDocument();
    const [first, second] = screen.getAllByRole("article");
    expect(within(first).getByText("₱10.00")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: /Shown on map/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("map").textContent).toContain("R2:outbound@A>C|R3:outbound@C>E");

    await userEvent.click(within(second).getByRole("button", { name: /Show on map/ }));
    expect(screen.getByTestId("map").textContent).toBe("R1:outbound@A>E");
    expect(within(second).getByRole("button", { name: /Shown on map/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(first).getByRole("button", { name: /Show on map/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("explains how the options are ranked", async () => {
    await show(raw, { preference: "shortest-walking" });
    expect(screen.getByText(/About 0 m of walking/)).toBeInTheDocument();
  });

  it("tells the user walking is an estimate", async () => {
    await show(network([route("R1", ["A", "B"])]), { from: "@0.100000,0.100900", to: "Fixture stop B" });
    expect(screen.getByText("Walking is an estimate")).toBeInTheDocument();
    expect(screen.getByText(/Walk about \d+ m to Fixture stop A/)).toBeInTheDocument();
  });
});

describe("failure states", () => {
  it("no journey: gives the reason and a reminder that this only means nothing verified was found", async () => {
    await show(network([route("R1", ["A", "B"]), route("R2", ["D", "E"])]));
    expect(screen.getByText("No journey found")).toBeInTheDocument();
    expect(screen.getByText(/No verified route connects these places/)).toBeInTheDocument();
    expect(screen.getByText(/only means no/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all routes" })).toHaveAttribute("href", "/explore");
  });

  it("transfer limit: offers to allow the needed number of transfers", async () => {
    const chain = network([route("R1", ["A", "B"]), route("R2", ["B", "C"]), route("R3", ["C", "D"]), route("R4", ["D", "E"])]);
    await show(chain, { maxTransfers: 1 });
    const link = screen.getByRole("link", { name: "Allow 3 transfers" });
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.get("transfers")).toBe("3");
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.get("from")).toBe("Fixture stop A");
  });

  it("no nearby stop: says how far the nearest one is", async () => {
    await show(network([route("R1", ["A", "B"])]), { from: "@0.300000,0.300000" });
    expect(screen.getByText(/nearest is Fixture stop A, about \d+ m away/)).toBeInTheDocument();
  });

  it("unverified routes: says none has been verified", async () => {
    await show(network([route("R1", ["A", "B"], { status: "unverified" })]));
    expect(screen.getByText(/none has been verified yet/)).toBeInTheDocument();
  });

  it("failed database request: shows an error and no results", async () => {
    render(<TripResults response={{ status: "error", message: "We couldn't load route data right now." }} params={PARAMS} />);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load route data right now.");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("invalid or unknown location: shows a clear message with a hint", async () => {
    const response: TripSearchResponse = { status: "location-problem", end: "destination", typed: "Nowhere", problem: "not-found", message: "We couldn't find “Nowhere”." };
    render(<TripResults response={response} params={PARAMS} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Destination: We couldn't find “Nowhere”.");
    expect(screen.getByText("8.95, 125.54")).toBeInTheDocument();
  });

  it("ambiguous place: lists the candidates as links that replace only that end of the search", async () => {
    const response: TripSearchResponse = {
      status: "needs-choice", end: "origin", typed: "Plaza",
      candidates: [
        { ref: "stop:00000000-0000-4000-8000-000000000001", source: "stop", label: "Town Plaza", detail: "Stop", position: at(0) },
        { ref: "@0.150000,0.150000", source: "geocoder", label: "Plaza Place", detail: "Place search result", position: at(5) },
      ],
    };
    render(<TripResults response={response} params={PARAMS} />);
    expect(screen.getByRole("heading", { name: "Which “Plaza” do you mean?" })).toBeInTheDocument();
    const href = new URL(screen.getByRole("link", { name: /Town Plaza/ }).getAttribute("href")!, "http://x");
    expect(href.searchParams.get("from")).toBe("stop:00000000-0000-4000-8000-000000000001");
    expect(href.searchParams.get("to")).toBe("Fixture stop E");
    expect(screen.getByText(/from OpenStreetMap contributors/)).toBeInTheDocument();
  });
});
