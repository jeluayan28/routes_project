"use client";

import { useId, useState, useTransition } from "react";
import { Field, Notice, RouteBadges, formatDate, textareaClass } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteRouteAction, markRouteOutdatedAction, setRouteStatusAction, verifyRouteAction } from "@/lib/admin/actions/routes";
import type { RouteRow, VerificationRow } from "@/lib/admin/data";
import { publicStatus } from "@/lib/admin/dashboard";
import { VERIFICATION_CHECKS, todayInManila, type VerificationCheckKey } from "@/lib/admin/verification";

type Props = {
  route: RouteRow;
  verifications: VerificationRow[];
  dirty: boolean;
  onChanged: () => void;
  onDeleted: () => void;
};

export function VerificationPanel({ route, verifications, dirty, onChanged, onDeleted }: Props) {
  const uid = useId();
  const today = todayInManila();
  const [checks, setChecks] = useState<Record<VerificationCheckKey, boolean>>(
    () => Object.fromEntries(VERIFICATION_CHECKS.map((c) => [c.key, false])) as Record<VerificationCheckKey, boolean>,
  );
  const [verifiedOn, setVerifiedOn] = useState(today);
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const status = publicStatus(route);
  const allChecked = VERIFICATION_CHECKS.every((c) => checks[c.key]);
  const canVerify = !route.is_sample && !dirty && allChecked && source.trim().length >= 3 && verifiedOn !== "" && verifiedOn <= today;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      setMessage(null);
      const res = await fn();
      if (res.ok) {
        setMessage({ tone: "success", text: success });
        onChanged();
      } else setMessage({ tone: "error", text: res.error ?? "That didn't work." });
    });

  const verify = () =>
    run(
      () => verifyRouteAction({ routeId: route.id, verifiedOn, source, notes, checks }),
      "Route verified. It is public only while it is also active.",
    );

  const setStatus = (next: "draft" | "active" | "inactive") =>
    run(async () => {
      const res = await setRouteStatusAction(route.id, next);
      return res.ok ? { ok: true } : res;
    }, `Status set to ${next}.`);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby={`${uid}-status`} className="space-y-3">
        <h3 id={`${uid}-status`} className="text-base font-semibold">Status and visibility</h3>
        <RouteBadges route={route} />
        <Notice tone={status.public ? "success" : "info"}>
          {status.reason}
          {!status.public && !route.is_sample && " A route is public only when it is both active and verified."}
        </Notice>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <div className="flex flex-wrap gap-2">
          {(["active", "inactive", "draft"] as const).map((s) => (
            <Button key={s} type="button" variant={route.status === s ? "default" : "outline"} disabled={pending || route.status === s} onClick={() => setStatus(s)}>
              {route.status === s ? `Currently ${s}` : `Set ${s}`}
            </Button>
          ))}
        </div>
        {route.verification_status === "verified" && (
          <Button type="button" variant="outline" disabled={pending} onClick={() => {
            if (window.confirm("Mark this route's verification as outdated? It will be hidden from the public until verified again.")) {
              run(markRouteOutdatedAction.bind(null, route.id), "Marked outdated. It is no longer public.");
            }
          }}>
            Mark verification outdated
          </Button>
        )}
        {route.status !== "active" && route.verification_status !== "verified" && (
          <Button type="button" variant="destructive" disabled={pending} onClick={() => {
            if (window.confirm("Delete this route permanently, with its stop list, geometry and fares?")) {
              startTransition(async () => {
                const res = await deleteRouteAction(route.id);
                if (res.ok) onDeleted();
                else setMessage({ tone: "error", text: res.error });
              });
            }
          }}>
            Delete this route
          </Button>
        )}

        <h3 className="pt-4 text-base font-semibold">Verification history</h3>
        {verifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">This route has never been verified.</p>
        ) : (
          <ul className="space-y-2">
            {verifications.map((v) => (
              <li key={v.id} className="rounded-lg border bg-card p-3 text-sm">
                <p className="font-medium">Verified on {formatDate(v.verified_on)}</p>
                <p>Source: {v.source_description}</p>
                {v.notes && <p className="text-muted-foreground">{v.notes}</p>}
                <p className="text-xs text-muted-foreground">Recorded {formatDate(v.created_at)} by <code>{v.verified_by ?? "unknown"}</code></p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-verify`} className="space-y-3">
        <h3 id={`${uid}-verify`} className="text-base font-semibold">Verify this route</h3>
        {route.is_sample ? (
          <Notice tone="info">This is sample data. It can never be verified or published.</Notice>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Verify only against a trustworthy source (a survey, an official document, a ride-along). Any later edit to the route sends it back to unverified.
            </p>
            {dirty && <Notice tone="warning">Save your changes first. Verification applies to what is saved.</Notice>}
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (canVerify) verify();
              }}
            >
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">I confirm that, against the source below:</legend>
                {VERIFICATION_CHECKS.map((c) => (
                  <label key={c.key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4" checked={checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </fieldset>
              <Field id={`${uid}-date`} label="Date the source was checked" hint="Today or earlier (Philippine date).">
                <Input id={`${uid}-date`} type="date" value={verifiedOn} max={today} onChange={(e) => setVerifiedOn(e.target.value)} />
              </Field>
              <Field id={`${uid}-source`} label="Source" hint="What was checked and where, e.g. a document title, survey name or who rode the route.">
                <Input id={`${uid}-source`} value={source} maxLength={500} onChange={(e) => setSource(e.target.value)} />
              </Field>
              <Field id={`${uid}-notes`} label="Notes (optional)">
                <textarea id={`${uid}-notes`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={textareaClass} />
              </Field>
              <Button type="submit" disabled={!canVerify || pending}>{pending ? "Verifying…" : "Mark route verified"}</Button>
              {!canVerify && !dirty && <p className="text-xs text-muted-foreground">Tick every box and give a source and date to enable this.</p>}
            </form>
          </>
        )}
      </section>
    </div>
  );
}
