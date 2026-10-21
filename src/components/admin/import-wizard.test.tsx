// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportWizard } from "@/components/admin/import-wizard";
import type { ImportReport } from "@/lib/import/validate";

const previewImportAction = vi.fn();
const commitImportAction = vi.fn();
vi.mock("@/lib/admin/actions/import", () => ({
  previewImportAction: (...a: unknown[]) => previewImportAction(...a),
  commitImportAction: (...a: unknown[]) => commitImportAction(...a),
}));

const BATCH = "00000000-0000-4000-8000-00000000b001";

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  ok: true,
  issues: [],
  counts: { stops: 2, routes: 1, route_stops: 3, fare_rules: 1 },
  preview: {
    stops: {
      headers: ["ref", "name"],
      truncated: false,
      rows: [{ line: 2, cells: ["S1", "Fictional One"], level: "ok" }, { line: 3, cells: ["S2", "Fictional Two"], level: "warning" }],
    },
  },
  payload: null,
  ...over,
});

const bad = report({
  ok: false,
  issues: [{ file: "stops", line: 3, column: "latitude", severity: "error", message: "latitude 95 is outside -90 to 90." }],
  preview: { stops: { headers: ["ref", "name"], truncated: false, rows: [{ line: 3, cells: ["S2", "Bad"], level: "error" }] } },
});

const file = (name: string) => new File(["ref,name\nS1,x\n"], name, { type: "text/csv" });

async function chooseAndCheck(r: ImportReport = report()) {
  previewImportAction.mockResolvedValue({ ok: true, data: { batchId: BATCH, report: r } });
  await userEvent.upload(screen.getByLabelText(/^Stops/), file("stops.csv"));
  await userEvent.click(screen.getByRole("button", { name: "Check files" }));
  await screen.findByRole("heading", { name: /2\. Review the preview/ });
}

beforeEach(() => {
  previewImportAction.mockReset();
  commitImportAction.mockReset();
});

describe("choosing files", () => {
  it("lists the accepted columns and cannot check until a file is chosen", async () => {
    render(<ImportWizard />);
    expect(screen.getByRole("button", { name: "Check files" })).toBeDisabled();
    expect(screen.getByText(/Columns: ref, name, latitude, longitude/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText(/^Routes/), file("routes.csv"));
    expect(screen.getByRole("button", { name: "Check files" })).toBeEnabled();
  });

  it("sends only the chosen files to the preview, with nothing committed", async () => {
    render(<ImportWizard />);
    await chooseAndCheck();
    const form = previewImportAction.mock.calls[0][0] as FormData;
    expect([...form.keys()]).toEqual(["stops"]);
    expect((form.get("stops") as File).name).toBe("stops.csv");
    expect(commitImportAction).not.toHaveBeenCalled();
  });

  it("shows a server failure without moving on", async () => {
    previewImportAction.mockResolvedValue({ ok: false, error: "stops.csv is larger than 2 MB." });
    render(<ImportWizard />);
    await userEvent.upload(screen.getByLabelText(/^Stops/), file("stops.csv"));
    await userEvent.click(screen.getByRole("button", { name: "Check files" }));
    expect(await screen.findByText(/larger than 2 MB/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Review the preview/ })).toBeNull();
  });
});

describe("the preview", () => {
  it("summarises what would be created and marks every row", async () => {
    render(<ImportWizard />);
    await chooseAndCheck();
    expect(screen.getByText(/would create/)).toHaveTextContent("2 stops, 1 routes, 3 route-stop rows and 1 fares, all as unverified drafts");
    const table = screen.getByRole("table", { name: "Stops preview" });
    expect(within(table).getByText("Fictional One")).toBeInTheDocument();
    expect(within(table).getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("No problems found.")).toBeInTheDocument();
  });

  it("reports row-level errors with file, line, column and message, and blocks the import", async () => {
    render(<ImportWizard />);
    await chooseAndCheck(bad);
    expect(screen.getByText(/1 error must be fixed/)).toBeInTheDocument();
    const issues = screen.getByRole("table", { name: "Validation results" });
    const row = within(issues).getByText("latitude 95 is outside -90 to 90.").closest("tr")!;
    expect(row).toHaveTextContent("Error");
    expect(row).toHaveTextContent("stops");
    expect(row).toHaveTextContent("3");
    expect(row).toHaveTextContent("latitude");
    expect(screen.getByRole("button", { name: /^Import / })).toBeDisabled();
    expect(screen.getByLabelText("Source of this data")).toBeDisabled();
  });

  it("lists warnings without blocking", async () => {
    render(<ImportWizard />);
    await chooseAndCheck(report({ issues: [{ file: "stops", line: 3, severity: "warning", message: "Possible duplicate of existing stop." }] }));
    expect(screen.getByText(/1 warning to look at/)).toBeInTheDocument();
    expect(screen.getByText("Possible duplicate of existing stop.")).toBeInTheDocument();
  });
});

describe("confirming", () => {
  const importButton = () => screen.getByRole("button", { name: /^Import 7 records/ });

  it("needs a source and an explicit acknowledgement", async () => {
    render(<ImportWizard />);
    await chooseAndCheck();
    expect(importButton()).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Source of this data"), "Fictional source");
    expect(importButton()).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I have reviewed the preview/));
    expect(importButton()).toBeEnabled();
    await userEvent.clear(screen.getByLabelText("Source of this data"));
    expect(importButton()).toBeDisabled();
  });

  it("commits with the batch id, source, notes and the same files", async () => {
    commitImportAction.mockResolvedValue({ ok: true, data: { batchId: BATCH, counts: { stops: 2, routes: 1, route_stops: 3, fares: 1 } } });
    render(<ImportWizard />);
    await chooseAndCheck();
    await userEvent.type(screen.getByLabelText("Source of this data"), "Fictional source");
    await userEvent.type(screen.getByLabelText("Notes (optional)"), "a note");
    await userEvent.click(screen.getByLabelText(/I have reviewed the preview/));
    await userEvent.click(importButton());

    const form = (await waitFor(() => {
      expect(commitImportAction).toHaveBeenCalledOnce();
      return commitImportAction.mock.calls[0][0];
    })) as FormData;
    expect(form.get("batchId")).toBe(BATCH);
    expect(form.get("source")).toBe("Fictional source");
    expect(form.get("notes")).toBe("a note");
    expect((form.get("stops") as File).name).toBe("stops.csv");

    expect(await screen.findByText("Import committed.")).toBeInTheDocument();
    expect(screen.getByText(/none of it is public/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "review the imported routes" })).toHaveAttribute("href", `/admin/routes?batch=${BATCH}`);
  });

  it("shows the refreshed report when the commit-time re-check fails", async () => {
    commitImportAction.mockResolvedValue({ ok: false, error: "The files no longer pass validation, so nothing was imported.", report: bad });
    render(<ImportWizard />);
    await chooseAndCheck();
    await userEvent.type(screen.getByLabelText("Source of this data"), "Fictional source");
    await userEvent.click(screen.getByLabelText(/I have reviewed the preview/));
    await userEvent.click(importButton());
    expect(await screen.findByText(/nothing was imported/)).toBeInTheDocument();
    expect(screen.getByText("latitude 95 is outside -90 to 90.")).toBeInTheDocument();
    expect(screen.queryByText("Import committed.")).toBeNull();
  });

  it("shows a database failure and stays on the preview", async () => {
    commitImportAction.mockResolvedValue({ ok: false, error: "This import was already committed." });
    render(<ImportWizard />);
    await chooseAndCheck();
    await userEvent.type(screen.getByLabelText("Source of this data"), "Fictional source");
    await userEvent.click(screen.getByLabelText(/I have reviewed the preview/));
    await userEvent.click(importButton());
    expect(await screen.findByText("This import was already committed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Review the preview/ })).toBeInTheDocument();
  });
});

describe("cancelling", () => {
  it("returns to the start without writing anything and clears the chosen files", async () => {
    render(<ImportWizard />);
    await chooseAndCheck();
    await userEvent.type(screen.getByLabelText("Source of this data"), "Fictional source");
    await userEvent.click(screen.getByRole("button", { name: "Cancel (nothing is saved)" }));

    expect(commitImportAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /Review the preview/ })).toBeNull();
    expect((screen.getByLabelText(/^Stops/) as HTMLInputElement).files).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Check files" })).toBeDisabled();
  });

  it("lets the files be changed and re-checked", async () => {
    render(<ImportWizard />);
    await chooseAndCheck(bad);
    await userEvent.click(screen.getByRole("button", { name: "Change files" }));
    expect(screen.getByRole("button", { name: "Check files" })).toBeEnabled();
    expect(commitImportAction).not.toHaveBeenCalled();
  });
});
