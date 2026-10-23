"use client";

import { useState, useTransition } from "react";
import { Field, Notice, textareaClass } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { setReportStatusAction } from "@/lib/admin/actions/reports";
import { REPORT_STATUSES, REPORT_STATUS_LABEL, type ReportStatus } from "@/lib/admin/reports";

const CLOSING: ReadonlySet<ReportStatus> = new Set(["resolved", "rejected"]);

/**
 * Moves one report between pending, reviewing, resolved and rejected. Closing a
 * report needs a note, which is kept with who closed it and when. This only
 * records the outcome; it does not edit any route, stop or fare.
 */
export function ReportStatusControl({ reportId, status, note: initialNote = "" }: { reportId: string; status: ReportStatus; note?: string }) {
  const [current, setCurrent] = useState(status);
  const [choice, setChoice] = useState<ReportStatus>(status);
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const closing = CLOSING.has(choice);

  const save = () =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      if (closing && note.trim().length < 3) return setError("Say how this report was resolved, or why it was rejected.");
      if (closing && !window.confirm(`Mark this report as ${REPORT_STATUS_LABEL[choice].toLowerCase()}? It will count as closed.`)) return;
      const res = await setReportStatusAction({ reportId, status: choice, note });
      if (!res.ok) return setError(res.error);
      setCurrent(res.data.status);
      setSaved(true);
    });

  return (
    <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div role="group" aria-label="Report status" className="flex flex-wrap gap-1">
        {REPORT_STATUSES.map((s) => (
          <Button key={s} type="button" size="sm" variant={s === choice ? "default" : "outline"} aria-pressed={s === choice} disabled={pending} onClick={() => setChoice(s)}>
            {REPORT_STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      <Field id={`${reportId}-note`} label={closing ? "Resolution note (required)" : "Note (optional)"} hint="What you checked and what you did. Visible to administrators only.">
        <textarea id={`${reportId}-note`} className={textareaClass} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || (choice === current && note === initialNote)}>{pending ? "Saving…" : "Save status"}</Button>
        <span className="text-sm text-muted-foreground">Currently: {REPORT_STATUS_LABEL[current]}</span>
      </div>
      {saved && <Notice tone="success">Saved. This is recorded in the audit log. No route, stop or fare was changed.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}
