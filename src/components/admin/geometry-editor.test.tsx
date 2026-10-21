// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GeometryEditor } from "@/components/admin/geometry-editor";
import type { DirectionDraft } from "@/lib/admin/route-form";

vi.mock("@/components/admin/editor-map-lazy", () => ({
  EditorMapLazy: ({ onPick, drawing, picking }: { onPick: (p: { lat: number; lng: number }) => void; drawing?: unknown[]; picking: boolean }) => (
    <div>
      <button type="button" onClick={() => onPick({ lat: 8 + (drawing?.length ?? 0), lng: 125 })}>simulate map click</button>
      <span data-testid="picking">{String(picking)}</span>
      <span data-testid="drawing">{drawing?.length ?? 0}</span>
    </div>
  ),
}));

const empty: DirectionDraft = { kind: "outbound", stops: [], lines: [], geometrySource: "" };
const withLine: DirectionDraft = {
  ...empty,
  lines: [[{ lat: 8.95, lng: 125.54 }, { lat: 8.96, lng: 125.55 }]],
  geometrySource: "field trace",
};

function setup(direction = empty) {
  const onChange = vi.fn();
  render(<GeometryEditor routeKey="r" direction={direction} otherDirection={null} stops={{}} onChange={onChange} />);
  return { onChange, text: () => screen.getByLabelText(/Points, one/) as HTMLTextAreaElement };
}

const type = (el: HTMLTextAreaElement, value: string) => fireEvent.change(el, { target: { value } });

describe("typed geometry", () => {
  it("states that nothing is recorded and warns against joining stops with straight lines", () => {
    setup();
    expect(screen.getByText("none recorded")).toBeTruthy();
    expect(screen.getByText(/Do not join the stops with straight lines/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /connect/i })).toBeNull();
  });

  it("applies valid points", async () => {
    const { onChange, text } = setup();
    type(text(), "8.95, 125.54\n8.96, 125.55");
    await userEvent.click(screen.getByRole("button", { name: "Apply text to route" }));
    expect(onChange).toHaveBeenCalledWith({ lines: [[{ lat: 8.95, lng: 125.54 }, { lat: 8.96, lng: 125.55 }]] });
  });

  it("lists each bad line and applies nothing", async () => {
    const { onChange, text } = setup();
    type(text(), "8.95, 125.54\nnorth, east\n95, 125.5\n8.97, 125.56");
    await userEvent.click(screen.getByRole("button", { name: "Apply text to route" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Line 2:/);
    expect(alert.textContent).toMatch(/Line 3:.*outside -90 to 90/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a single point", async () => {
    const { onChange, text } = setup();
    type(text(), "8.95, 125.54");
    await userEvent.click(screen.getByRole("button", { name: "Apply text to route" }));
    expect(screen.getByRole("alert").textContent).toMatch(/at least two/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts pasted GeoJSON (longitude first)", async () => {
    const { onChange, text } = setup();
    type(text(), '{"type":"LineString","coordinates":[[125.54,8.95],[125.55,8.96]]}');
    await userEvent.click(screen.getByRole("button", { name: "Apply text to route" }));
    expect(onChange).toHaveBeenCalledWith({ lines: [[{ lat: 8.95, lng: 125.54 }, { lat: 8.96, lng: 125.55 }]] });
  });

  it("warns, but still applies, points outside Butuan", async () => {
    const { onChange, text } = setup();
    type(text(), "14.6, 121\n14.7, 121.1");
    await userEvent.click(screen.getByRole("button", { name: "Apply text to route" }));
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByText(/outside the Butuan City area/)).toBeTruthy();
  });

  it("shows what is recorded, clears it, and records the source", async () => {
    const { onChange, text } = setup(withLine);
    expect(screen.getByText("1 line, 2 points")).toBeTruthy();
    expect(text().value).toBe("8.95, 125.54\n8.96, 125.55");
    await userEvent.click(screen.getByRole("button", { name: "Clear geometry" }));
    expect(onChange).toHaveBeenLastCalledWith({ lines: [] });

    fireEvent.change(screen.getByLabelText("Where did this geometry come from?"), { target: { value: "survey 2026" } });
    expect(onChange).toHaveBeenLastCalledWith({ geometrySource: "survey 2026" });
  });
});

describe("drawing on the map", () => {
  it("collects clicked points and only commits a line of two or more", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Draw a line by clicking the map" }));
    expect(screen.getByTestId("picking").textContent).toBe("true");

    const finish = () => screen.getByRole("button", { name: /Finish line/ });
    expect(finish()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "simulate map click" }));
    expect(finish()).toBeDisabled(); // one point is not a line
    fireEvent.click(screen.getByRole("button", { name: "simulate map click" }));
    expect(screen.getByTestId("drawing").textContent).toBe("2");
    expect(finish()).toBeEnabled();

    await userEvent.click(finish());
    expect(onChange).toHaveBeenCalledWith({ lines: [[{ lat: 8, lng: 125 }, { lat: 9, lng: 125 }]] });
    expect(screen.getByTestId("drawing").textContent).toBe("0");
  });

  it("undoes and discards drawn points", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "simulate map click" }));
    fireEvent.click(screen.getByRole("button", { name: "simulate map click" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo last point" }));
    expect(screen.getByTestId("drawing").textContent).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: "Discard drawing" }));
    expect(screen.getByTestId("drawing").textContent).toBe("0");
  });

  it("undo removes the last point of a recorded line, dropping lines that become too short", async () => {
    const { onChange } = setup(withLine);
    await userEvent.click(screen.getByRole("button", { name: "Undo last point" }));
    expect(onChange).toHaveBeenLastCalledWith({ lines: [] });
  });
});
