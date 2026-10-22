"use client";

import { useId, useState, useTransition } from "react";
import { Field, Notice, formatDate, selectClass } from "@/components/admin/admin-ui";
import { VerificationBadge } from "@/components/common/verification-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeFareAction, deleteFareAction, endFareAction, saveFareAction } from "@/lib/admin/actions/fares";
import type { EditorStop, FareRow } from "@/lib/admin/data";
import { changeFareSchema, endFareSchema, fareInputSchema, findOverlap } from "@/lib/admin/fare-form";
import { FARE_CATEGORY_LABEL, formatPeso } from "@/lib/format";
import { fareCategorySchema, type FareCategory } from "@/lib/validation/route";

type Props = {
  routeId: string;
  fares: FareRow[];
  /** Stops on the saved route (both directions). Fares can only use these. */
  stops: EditorStop[];
  /** Unsaved edits: the stop list shown here is the saved one. */
  dirty: boolean;
  onChange: (fares: FareRow[]) => void;
};

type Form = {
  id: string | null;
  from: string;
  to: string;
  passengerType: FareCategory;
  amount: string;
  effectiveFrom: string;
  effectiveUntil: string;
  source: string;
};

/** A verified fare is history: it is changed by a new rule from a date, or ended, never edited. */
type HistoryAction = { fareId: string; kind: "change" | "end"; amount: string; date: string; source: string };

const BLANK: Form = { id: null, from: "", to: "", passengerType: "regular", amount: "", effectiveFrom: "", effectiveUntil: "", source: "" };

export function FaresEditor({ routeId, fares, stops, dirty, onChange }: Props) {
  const uid = useId();
  const [form, setForm] = useState<Form>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [history, setHistory] = useState<HistoryAction | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const names = new Map(stops.map((s) => [s.id, s.name]));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const input = {
        id: form.id, routeId, fromStopId: form.from || null, toStopId: form.to || null,
        passengerType: form.passengerType, amount: form.amount, effectiveFrom: form.effectiveFrom,
        effectiveUntil: form.effectiveUntil, source: form.source,
      };
      const parsed = fareInputSchema.safeParse(input);
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
        setErrors(next);
        return;
      }
      setErrors({});
      const clash = findOverlap(fares, parsed.data);
      if (clash) {
        setErrors({ effectiveFrom: `This overlaps an existing ${FARE_CATEGORY_LABEL[clash.passenger_type].toLowerCase()} fare (${formatDate(clash.effective_from)}${clash.effective_until ? ` to ${formatDate(clash.effective_until)}` : " onward"}). End that fare first, or use Change price.` });
        return;
      }
      const res = await saveFareAction(input);
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      onChange(form.id ? fares.map((f) => (f.id === res.data.id ? res.data : f)) : [res.data, ...fares]);
      setForm(BLANK);
      setMessage({ tone: "success", text: "Fare saved. It stays unverified until the route is verified." });
    });

  const submitHistory = () =>
    startTransition(async () => {
      if (!history) return;
      setHistoryError(null);
      const isChange = history.kind === "change";
      const input = isChange
        ? { fareId: history.fareId, amount: history.amount, effectiveFrom: history.date, source: history.source }
        : { fareId: history.fareId, effectiveUntil: history.date };
      const parsed = (isChange ? changeFareSchema : endFareSchema).safeParse(input);
      if (!parsed.success) return setHistoryError(parsed.error.issues[0]?.message ?? "Some values are not valid.");
      const res = isChange ? await changeFareAction(input) : await endFareAction(input);
      if (!res.ok) return setHistoryError(res.error);
      const rows = isChange ? (res.data as FareRow[]) : (res.data ? [res.data as FareRow] : []);
      const byId = new Map(rows.map((r) => [r.id, r]));
      onChange([...rows.filter((r) => !fares.some((f) => f.id === r.id)), ...fares.map((f) => byId.get(f.id) ?? f)]);
      setHistory(null);
      setMessage({
        tone: "success",
        text: isChange
          ? "New price saved from that date. The old fare was kept and ended the day before. The new price stays unverified until the route is verified."
          : "Fare ended. It stays in the history.",
      });
    });

  const remove = (fare: FareRow) =>
    startTransition(async () => {
      if (!window.confirm("Delete this fare rule?")) return;
      const res = await deleteFareAction(fare.id);
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      onChange(fares.filter((f) => f.id !== fare.id));
      setMessage({ tone: "success", text: "Fare deleted." });
    });

  const label = (fare: FareRow) =>
    fare.from_stop_id && fare.to_stop_id
      ? `${names.get(fare.from_stop_id) ?? "Unknown stop"} to ${names.get(fare.to_stop_id) ?? "Unknown stop"}`
      : "Whole route (flat fare)";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby={`${uid}-list`} className="space-y-3">
        <h3 id={`${uid}-list`} className="text-base font-semibold">Fare rules <span className="font-normal text-muted-foreground">({fares.length})</span></h3>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {fares.length === 0 ? (
          <Notice tone="warning">No fare has been recorded for this route. Record fares only from a real source; none are assumed.</Notice>
        ) : (
          <ul className="space-y-2">
            {fares.map((fare) => (
              <li key={fare.id} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{formatPeso(fare.amount)} · {FARE_CATEGORY_LABEL[fare.passenger_type]}</p>
                    <p className="text-sm">{label(fare)}</p>
                    <p className="text-xs text-muted-foreground">
                      From {formatDate(fare.effective_from)}{fare.effective_until ? ` until ${formatDate(fare.effective_until)}` : ", no end date"}
                      {fare.source_description ? ` · Source: ${fare.source_description}` : " · No source recorded"}
                      {fare.verified_at ? ` · Verified ${formatDate(fare.verified_at)}` : " · Not verified"}
                    </p>
                  </div>
                  <VerificationBadge status={fare.verification_status} />
                </div>
                {fare.verified_at ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-muted-foreground">Verified fares are kept as history and cannot be edited.</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => { setHistory({ fareId: fare.id, kind: "change", amount: "", date: "", source: "" }); setHistoryError(null); }}>Change price<span className="sr-only"> of this fare</span></Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => { setHistory({ fareId: fare.id, kind: "end", amount: "", date: "", source: "" }); setHistoryError(null); }}>End fare<span className="sr-only"> on a date</span></Button>
                    </div>
                    {history?.fareId === fare.id && (
                      <form noValidate className="grid gap-2 rounded-md border bg-muted/40 p-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submitHistory(); }}>
                        {history.kind === "change" && (
                          <>
                            <Field id={uid + "-h-amount"} label="New amount (₱)">
                              <Input id={uid + "-h-amount"} inputMode="decimal" value={history.amount} onChange={(e) => setHistory({ ...history, amount: e.target.value })} />
                            </Field>
                            <Field id={uid + "-h-date"} label="New price starts on">
                              <Input id={uid + "-h-date"} type="date" value={history.date} onChange={(e) => setHistory({ ...history, date: e.target.value })} />
                            </Field>
                            <Field id={uid + "-h-source"} label="Source of the new fare" className="sm:col-span-2">
                              <Input id={uid + "-h-source"} value={history.source} maxLength={300} onChange={(e) => setHistory({ ...history, source: e.target.value })} />
                            </Field>
                          </>
                        )}
                        {history.kind === "end" && (
                          <Field id={uid + "-h-date"} label="Last day this fare applies">
                            <Input id={uid + "-h-date"} type="date" value={history.date} onChange={(e) => setHistory({ ...history, date: e.target.value })} />
                          </Field>
                        )}
                        {historyError && <div className="sm:col-span-2"><Notice tone="error">{historyError}</Notice></div>}
                        <div className="flex gap-2 sm:col-span-2">
                          <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : history.kind === "change" ? "Save new price" : "End fare"}</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => setHistory(null)}>Cancel</Button>
                        </div>
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => {
                      setForm({
                        id: fare.id, from: fare.from_stop_id ?? "", to: fare.to_stop_id ?? "", passengerType: fare.passenger_type,
                        amount: String(fare.amount), effectiveFrom: fare.effective_from, effectiveUntil: fare.effective_until ?? "", source: fare.source_description ?? "",
                      });
                      setErrors({});
                    }}>Edit<span className="sr-only"> this fare</span></Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => remove(fare)}>Delete<span className="sr-only"> this fare</span></Button>
                  </div>
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-form`} className="space-y-3">
        <h3 id={`${uid}-form`} className="text-base font-semibold">{form.id ? "Edit fare" : "Add a fare"}</h3>
        {dirty && <Notice tone="warning">You have unsaved changes to the stops. Save the route first so new stops can be used here.</Notice>}
        <form
          className="grid gap-3 sm:grid-cols-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field id={`${uid}-from`} label="Origin stop" error={errors.fromStopId} hint="Leave both blank for one fare on the whole route.">
            <select id={`${uid}-from`} className={selectClass} value={form.from} onChange={(e) => set("from", e.target.value)}>
              <option value="">Whole route</option>
              {stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-to`} label="Destination stop" error={errors.toStopId}>
            <select id={`${uid}-to`} className={selectClass} value={form.to} onChange={(e) => set("to", e.target.value)}>
              <option value="">Whole route</option>
              {stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-type`} label="Passenger category" error={errors.passengerType}>
            <select id={`${uid}-type`} className={selectClass} value={form.passengerType} onChange={(e) => set("passengerType", e.target.value as FareCategory)}>
              {fareCategorySchema.options.map((c) => <option key={c} value={c}>{FARE_CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-amount`} label="Amount (₱)" error={errors.amount} hint="Plain number, e.g. 12 or 12.50.">
            <Input id={`${uid}-amount`} inputMode="decimal" value={form.amount} aria-invalid={Boolean(errors.amount)} onChange={(e) => set("amount", e.target.value)} />
          </Field>
          <Field id={`${uid}-from-date`} label="Effective from" error={errors.effectiveFrom}>
            <Input id={`${uid}-from-date`} type="date" value={form.effectiveFrom} aria-invalid={Boolean(errors.effectiveFrom)} onChange={(e) => set("effectiveFrom", e.target.value)} />
          </Field>
          <Field id={`${uid}-until`} label="Effective until (optional)" error={errors.effectiveUntil}>
            <Input id={`${uid}-until`} type="date" value={form.effectiveUntil} onChange={(e) => set("effectiveUntil", e.target.value)} />
          </Field>
          <Field id={`${uid}-source`} label="Source of this fare (optional)" className="sm:col-span-2">
            <Input id={`${uid}-source`} value={form.source} maxLength={300} onChange={(e) => set("source", e.target.value)} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : form.id ? "Save fare" : "Add fare"}</Button>
            {form.id && <Button type="button" variant="outline" onClick={() => { setForm(BLANK); setErrors({}); }}>Cancel edit</Button>}
          </div>
        </form>
      </section>
    </div>
  );
}
