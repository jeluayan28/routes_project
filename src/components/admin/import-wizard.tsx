"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Field, Notice, textareaClass } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  commitImportAction,
  previewImportAction,
  type ImportCommitted,
  type ImportPreview,
} from "@/lib/admin/actions/import";
import { COLUMNS, IMPORT_KINDS, type ImportKind, type ImportReport } from "@/lib/import/validate";
import { cn } from "@/lib/utils";

const FILE_LABEL: Record<ImportKind, { label: string; help: string }> = {
  stops: { label: "Stops", help: "stops.csv" },
  routes: { label: "Routes", help: "routes.csv" },
  route_stops: { label: "Route stops (ordered sequences)", help: "route_stops.csv" },
  fare_rules: { label: "Fare rules", help: "fare_rules.csv" },
};

type Stage = "choose" | "preview" | "done";

export function ImportWizard() {
  const uid = useId();
  const [files, setFiles] = useState<Partial<Record<ImportKind, File>>>({});
  const [stage, setStage] = useState<Stage>("choose");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportCommitted | null>(null);
  // Which step is running. (useTransition's flag outlives the step, so the wrong label could flash.)
  const [busy, setBusy] = useState<"checking" | "importing" | null>(null);
  const inputs = useRef<Partial<Record<ImportKind, HTMLInputElement | null>>>({});

  const selected = IMPORT_KINDS.filter((k) => files[k]);

  const buildForm = () => {
    const form = new FormData();
    for (const k of selected) form.set(k, files[k]!);
    return form;
  };

  const check = async () => {
    setError(null);
    setBusy("checking");
    try {
      const res = await previewImportAction(buildForm());
      if (!res.ok) return setError(res.error);
      setPreview(res.data);
      setReport(res.data.report);
      setReviewed(false);
      setStage("preview");
    } finally {
      setBusy(null);
    }
  };

  /** Nothing has been written at this point, so cancelling only clears the form. */
  const cancel = () => {
    setFiles({});
    for (const input of Object.values(inputs.current)) if (input) input.value = "";
    setPreview(null);
    setReport(null);
    setSource("");
    setNotes("");
    setReviewed(false);
    setError(null);
    setStage("choose");
  };

  const commit = async () => {
    if (!preview) return;
    setError(null);
    setBusy("importing");
    try {
      const form = buildForm();
      form.set("batchId", preview.batchId);
      form.set("source", source);
      form.set("notes", notes);
      const res = await commitImportAction(form);
      if (res.ok) {
        setResult(res.data);
        setStage("done");
      } else {
        setError(res.error);
        if (res.report) setReport(res.report);
      }
    } finally {
      setBusy(null);
    }
  };

  if (stage === "done" && result) {
    return (
      <div className="space-y-4">
        <Notice tone="success">
          <p className="font-medium">Import committed.</p>
          <p>
            Created {result.counts.stops} stops, {result.counts.routes} routes, {result.counts.route_stops} route-stop rows and {result.counts.fares} fares.
            Everything is a draft and unverified, so none of it is public.
          </p>
        </Notice>
        <p className="text-sm">
          Next: <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/admin/routes?batch=${result.batchId}`}>review the imported routes</Link>,
          fix anything wrong, then verify each one against its source. See the review procedure in <code className="rounded bg-muted px-1">docs/ADMIN.md</code>.
        </p>
        <Button type="button" variant="outline" onClick={cancel}>Import more</Button>
      </div>
    );
  }

  const errors = report?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = report?.issues.filter((i) => i.severity === "warning") ?? [];
  const canCommit = Boolean(report?.ok) && reviewed && source.trim().length >= 3 && busy === null;
  const total = report ? report.counts.stops + report.counts.routes + report.counts.route_stops + report.counts.fare_rules : 0;

  return (
    <div className="space-y-6">
      {error && <Notice tone="error">{error}</Notice>}

      <section aria-labelledby={`${uid}-files`} className="space-y-3">
        <h2 id={`${uid}-files`} className="text-lg font-semibold">1. Choose files</h2>
        <p className="text-sm text-muted-foreground">
          Choose any of the four files. Rows may refer to each other with <code>ref</code> keys, or to records already in the database by UUID.
          Nothing is saved until you confirm in step 3.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {IMPORT_KINDS.map((kind) => (
            <Field key={kind} id={`${uid}-${kind}`} label={FILE_LABEL[kind].label} hint={`Columns: ${[...COLUMNS[kind].required, ...COLUMNS[kind].optional].join(", ")}`}>
              <Input
                id={`${uid}-${kind}`}
                ref={(el) => {
                  inputs.current[kind] = el;
                }}
                type="file"
                accept=".csv,text/csv"
                disabled={stage !== "choose" || busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setFiles((prev) => {
                    const next = { ...prev };
                    if (file) next[kind] = file;
                    else delete next[kind];
                    return next;
                  });
                }}
                className="h-auto py-1.5"
              />
            </Field>
          ))}
        </div>
        {stage === "choose" && (
          <Button type="button" onClick={check} disabled={selected.length === 0 || busy !== null}>
            {busy === "checking" ? "Checking…" : "Check files"}
          </Button>
        )}
      </section>

      {stage === "preview" && report && (
        <>
          <section aria-labelledby={`${uid}-preview`} className="space-y-4">
            <h2 id={`${uid}-preview`} className="text-lg font-semibold">2. Review the preview</h2>
            <p aria-live="polite" className="text-sm">
              {report.ok ? (
                <>This would create <strong>{report.counts.stops}</strong> stops, <strong>{report.counts.routes}</strong> routes, <strong>{report.counts.route_stops}</strong> route-stop rows and <strong>{report.counts.fare_rules}</strong> fares, all as unverified drafts.</>
              ) : (
                <strong className="text-destructive">{errors.length} {errors.length === 1 ? "error" : "errors"} must be fixed before anything can be imported.</strong>
              )}{" "}
              {warnings.length > 0 && <span>{warnings.length} {warnings.length === 1 ? "warning" : "warnings"} to look at.</span>}
            </p>

            <IssueList issues={report.issues} />

            {IMPORT_KINDS.map((kind) => {
              const p = report.preview[kind];
              if (!p) return null;
              return (
                <div key={kind} className="space-y-1">
                  <h3 className="text-sm font-semibold">{FILE_LABEL[kind].label}: first {p.rows.length} {p.rows.length === 1 ? "row" : "rows"}{p.truncated && " (more not shown)"}</h3>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">{FILE_LABEL[kind].label} preview</caption>
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th scope="col" className="px-2 py-1.5">Line</th>
                          <th scope="col" className="px-2 py-1.5">Result</th>
                          {p.headers.map((h) => <th key={h} scope="col" className="px-2 py-1.5">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {p.rows.map((row) => (
                          <tr key={row.line} className={cn(row.level === "error" && "bg-red-50 text-red-950", row.level === "warning" && "bg-amber-50 text-amber-950")}>
                            <td className="px-2 py-1.5 tabular-nums">{row.line}</td>
                            <td className="px-2 py-1.5 font-medium">{row.level === "ok" ? "OK" : row.level === "warning" ? "Warning" : "Error"}</td>
                            {row.cells.map((c, i) => <td key={i} className="px-2 py-1.5">{c}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>

          <section aria-labelledby={`${uid}-confirm`} className="space-y-3">
            <h2 id={`${uid}-confirm`} className="text-lg font-semibold">3. Confirm</h2>
            <Field id={`${uid}-source`} label="Source of this data" hint="Where the information came from, e.g. a document title or survey and its date. Recorded with your account on the import batch.">
              <Input id={`${uid}-source`} value={source} maxLength={500} onChange={(e) => setSource(e.target.value)} disabled={!report.ok} />
            </Field>
            <Field id={`${uid}-notes`} label="Notes (optional)">
              <textarea id={`${uid}-notes`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClass} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={reviewed} disabled={!report.ok} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 size-4" />
              <span>I have reviewed the preview. I understand the records are imported as unverified drafts and nothing existing is overwritten.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={commit} disabled={!canCommit}>
                {busy === "importing" ? "Importing…" : `Import ${total} ${total === 1 ? "record" : "records"}`}
              </Button>
              <Button type="button" variant="outline" onClick={cancel} disabled={busy !== null}>Cancel (nothing is saved)</Button>
              <Button type="button" variant="ghost" onClick={() => setStage("choose")} disabled={busy !== null}>Change files</Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function IssueList({ issues }: { issues: ImportReport["issues"] }) {
  if (issues.length === 0) return <Notice tone="success">No problems found.</Notice>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Validation results</caption>
        <thead className="border-b bg-muted/50 text-xs">
          <tr>
            <th scope="col" className="px-3 py-2">Level</th>
            <th scope="col" className="px-3 py-2">File</th>
            <th scope="col" className="px-3 py-2">Line</th>
            <th scope="col" className="px-3 py-2">Column</th>
            <th scope="col" className="px-3 py-2">Problem</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {issues.slice(0, 300).map((issue, i) => (
            <tr key={i} className={issue.severity === "error" ? "bg-red-50 text-red-950" : "bg-amber-50 text-amber-950"}>
              <td className="px-3 py-2 font-medium">{issue.severity === "error" ? "Error" : "Warning"}</td>
              <td className="px-3 py-2">{issue.file}</td>
              <td className="px-3 py-2 tabular-nums">{issue.line ?? "-"}</td>
              <td className="px-3 py-2">{issue.column ?? "-"}</td>
              <td className="px-3 py-2">{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {issues.length > 300 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 300 of {issues.length}.</p>}
    </div>
  );
}
