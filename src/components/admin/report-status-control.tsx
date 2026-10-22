"use client";

import { useState, useTransition } from "react";
import { Notice } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { setReportStatusAction } from "@/lib/admin/actions/reports";
import { REPORT_STATUSES, REPORT_STATUS_LABEL, type ReportStatus } from "@/lib/admin/reports";

const CONFIRM: Partial<Record<ReportStatus, string>> = {
  resolved: "Mark this report as resolved? It will count as closed.",
  rejected: "Reject this report? It will count as closed.",
};

/** Moves one report between pending, reviewed, resolved and rejected. */
export function ReportStatusControl({ reportId, status }: { reportId: string; status: ReportStatus }) {
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (next: ReportStatus) => {
    if (next === current) return;
    const question = CONFIRM[next];
    if (question && !window.confirm(question)) return;
    startTransition(async () => {
      setError(null);
      const res = await setReportStatusAction({ reportId, status: next });
      if (!res.ok) return setError(res.error);
      setCurrent(res.data.status);
    });
  };

  return (
    <div className="space-y-1">
      <div role="group" aria-label="Report status" className="flex flex-wrap gap-1">
        {REPORT_STATUSES.map((s) => (
          <Button key={s} type="button" size="sm" variant={s === current ? "default" : "outline"} aria-pressed={s === current} disabled={pending} onClick={() => change(s)}>
            {REPORT_STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      {pending && <p role="status" className="text-xs text-muted-foreground">Saving…</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
