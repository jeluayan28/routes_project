"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { Field, Notice, selectClass, textareaClass } from "@/components/admin/admin-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  CONTACT_MAX, DESCRIPTION_MAX, DESCRIPTION_MIN, PUBLIC_REPORT_LABEL, PUBLIC_REPORT_TYPES, reportInputSchema,
  type PublicReportType,
} from "@/lib/reports/schema";
import { submitReport, type SubmitResult } from "@/lib/reports/submit";

export type ReportRoute = { id: string; code: string; name: string; stops: { id: string; name: string }[] };

type Props = {
  routes: ReportRoute[];
  initial?: { type?: PublicReportType; routeId?: string; stopId?: string; direction?: "outbound" | "inbound" };
  /** Replaceable in tests. The default sends the report with the browser's publishable key. */
  send?: (input: unknown) => Promise<SubmitResult>;
};

const defaultSend = (input: unknown) => submitReport(createClient(), input as Parameters<typeof submitReport>[1]);

/**
 * "Report incorrect information". No account is needed. A report is only a
 * message for an administrator: it never changes the data shown to anyone.
 */
export function ReportForm({ routes, initial, send = defaultSend }: Props) {
  const uid = useId();
  const [type, setType] = useState<PublicReportType | "">(initial?.type ?? "");
  const [routeId, setRouteId] = useState(initial?.routeId ?? "");
  const [stopId, setStopId] = useState(initial?.stopId ?? "");
  const [direction, setDirection] = useState<"" | "outbound" | "inbound">(initial?.direction ?? "");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const route = routes.find((r) => r.id === routeId);
  const stopChoices = route?.stops ?? [];
  const showRoute = type !== "" && type !== "missing_route" && type !== "missing_stop" && type !== "other";
  const showStop = type === "incorrect_stop" || type === "missing_stop";
  const needsRoute = type === "incorrect_route" || type === "incorrect_direction" || type === "incorrect_fare";

  const submit = () =>
    startTransition(async () => {
      setFailure(null);
      const input = {
        type: type || undefined,
        routeId: showRoute || (showStop && routeId) ? routeId || null : null,
        stopId: showStop ? stopId || null : null,
        direction: type === "incorrect_direction" ? direction || null : null,
        description,
        contact,
        website,
      };
      const checked = reportInputSchema.safeParse(input);
      if (!checked.success) {
        const next: Record<string, string> = {};
        for (const issue of checked.error.issues) next[String(issue.path[0])] ??= issue.message;
        setErrors(next);
        return;
      }
      setErrors({});
      const result = await send(input);
      if (result.ok) return setDone(true);
      if (result.kind === "invalid") return setErrors(result.fieldErrors);
      setFailure(result.message);
    });

  if (done) {
    return (
      <div role="status" className="space-y-4 rounded-2xl border border-emerald-600/30 bg-emerald-50 p-5 text-emerald-950">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <CircleCheck aria-hidden="true" className="size-5" />
          Thank you. We received your report.
        </p>
        <p className="text-sm">
          An administrator will check it against our records. Nothing on the site changes until it has been checked and confirmed, so you may
          not see a difference straight away. {contact.trim() ? "We may use your contact details to ask a question." : "You didn't leave contact details, so we won't be able to reply."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/search" className={buttonVariants()}>Back to search</Link>
          <Button type="button" variant="outline" onClick={() => { setDone(false); setDescription(""); setContact(""); setType(""); }}>
            Send another report
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Field id={`${uid}-type`} label="What is wrong?" error={errors.type}>
        <select id={`${uid}-type`} className={selectClass} value={type} aria-invalid={Boolean(errors.type)} onChange={(e) => setType(e.target.value as PublicReportType | "")}>
          <option value="">Choose…</option>
          {PUBLIC_REPORT_TYPES.map((t) => <option key={t} value={t}>{PUBLIC_REPORT_LABEL[t]}</option>)}
        </select>
      </Field>

      {(showRoute || showStop) && (
        <Field id={`${uid}-route`} label={needsRoute ? "Route" : "Route (optional)"} error={errors.routeId}>
          <select id={`${uid}-route`} className={selectClass} value={routeId} aria-invalid={Boolean(errors.routeId)} onChange={(e) => { setRouteId(e.target.value); setStopId(""); }}>
            <option value="">{needsRoute ? "Choose a route…" : "Not sure / not applicable"}</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
          </select>
        </Field>
      )}

      {type === "incorrect_direction" && (
        <Field id={`${uid}-dir`} label="Which direction?" error={errors.direction}>
          <select id={`${uid}-dir`} className={selectClass} value={direction} aria-invalid={Boolean(errors.direction)} onChange={(e) => setDirection(e.target.value as "" | "outbound" | "inbound")}>
            <option value="">Choose…</option>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound (return)</option>
          </select>
        </Field>
      )}

      {type === "incorrect_stop" && (
        <Field id={`${uid}-stop`} label="Stop" error={errors.stopId} hint={route ? undefined : "Choose the route first to pick one of its stops."}>
          <select id={`${uid}-stop`} className={selectClass} value={stopId} disabled={stopChoices.length === 0 && !stopId} aria-invalid={Boolean(errors.stopId)} onChange={(e) => setStopId(e.target.value)}>
            <option value="">Choose a stop…</option>
            {stopChoices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}

      <Field id={`${uid}-desc`} label="What should it say?" error={errors.description} hint={`What is wrong, and what you think is correct. ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} characters.`}>
        <textarea
          id={`${uid}-desc`} className={textareaClass} rows={5} maxLength={DESCRIPTION_MAX + 200} value={description}
          aria-invalid={Boolean(errors.description)} aria-describedby={`${uid}-count`} onChange={(e) => setDescription(e.target.value)}
        />
        <p id={`${uid}-count`} className="text-right text-xs text-muted-foreground">{description.trim().length} / {DESCRIPTION_MAX}</p>
      </Field>

      <Field id={`${uid}-contact`} label="Email or phone (optional)" error={errors.contact} hint="Only if you'd like us to ask a question. It is private: only administrators can see it, and it is never shown on the site.">
        <Input id={`${uid}-contact`} value={contact} maxLength={CONTACT_MAX + 50} autoComplete="off" aria-invalid={Boolean(errors.contact)} onChange={(e) => setContact(e.target.value)} />
      </Field>

      {/* Honeypot: invisible and skipped by keyboard and screen readers. People never fill it in; bots often do. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave this empty<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>

      {failure && <Notice tone="error">{failure}</Notice>}
      <p className="text-xs text-muted-foreground">We don&apos;t ask for your name or an account, and we don&apos;t keep your address.</p>
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send report"}</Button>
    </form>
  );
}
