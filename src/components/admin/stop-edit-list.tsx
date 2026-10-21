"use client";

import { useId, useState, useTransition } from "react";
import { Field, Notice } from "@/components/admin/admin-ui";
import { VerificationBadge } from "@/components/common/verification-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateStopAction } from "@/lib/admin/actions/routes";
import { parseCoordinatePair } from "@/lib/admin/route-form";

export type StopListItem = {
  id: string; name: string; latitude: number; longitude: number; barangay: string; landmark: string;
  pickup: boolean; dropoff: boolean; status: "unverified" | "verified" | "outdated"; isSample: boolean; problem: string | null;
};

export function StopEditList({ stops }: { stops: StopListItem[] }) {
  if (stops.length === 0) {
    return <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">No stops match.</p>;
  }
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {stops.map((s) => (
        <StopRow key={`${s.id}:${s.latitude}:${s.longitude}:${s.name}`} stop={s} />
      ))}
    </ul>
  );
}

function StopRow({ stop }: { stop: StopListItem }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: stop.name, lat: String(stop.latitude), lng: String(stop.longitude), barangay: stop.barangay, landmark: stop.landmark, pickup: stop.pickup, dropoff: stop.dropoff });
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const pair = parseCoordinatePair(form.lat, form.lng);

  const save = () =>
    startTransition(async () => {
      if (!pair.ok) return setMessage({ tone: "error", text: Object.values(pair.errors).filter(Boolean).join(" ") });
      const result = await updateStopAction(stop.id, {
        name: form.name, latitude: pair.coordinate.lat, longitude: pair.coordinate.lng,
        barangay: form.barangay, landmark: form.landmark, pickup: form.pickup, dropoff: form.dropoff,
      });
      setMessage(result.ok ? { tone: "success", text: "Saved. Refresh to see the updated list." } : { tone: "error", text: result.error });
      if (result.ok) setOpen(false);
    });

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{stop.name}</p>
          <p className="text-xs text-muted-foreground">
            {stop.latitude}, {stop.longitude}
            {stop.problem && <span className="ml-2 font-medium text-amber-800">{stop.problem}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stop.isSample ? <span className="text-xs text-sky-800">Sample</span> : <VerificationBadge status={stop.status} />}
          <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Edit"}
            <span className="sr-only"> {stop.name}</span>
          </Button>
        </div>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {open && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field id={`${uid}-name`} label="Name" className="sm:col-span-2">
            <Input id={`${uid}-name`} value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field id={`${uid}-lat`} label="Latitude" error={!pair.ok ? pair.errors.latitude ?? pair.errors.both : null}>
            <Input id={`${uid}-lat`} inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
          </Field>
          <Field id={`${uid}-lng`} label="Longitude" error={!pair.ok ? pair.errors.longitude : null}>
            <Input id={`${uid}-lng`} inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
          </Field>
          {pair.ok && pair.warning && <Notice tone="warning" className="sm:col-span-2">{pair.warning}</Notice>}
          <Field id={`${uid}-brgy`} label="Barangay">
            <Input id={`${uid}-brgy`} value={form.barangay} maxLength={100} onChange={(e) => setForm({ ...form, barangay: e.target.value })} />
          </Field>
          <Field id={`${uid}-lm`} label="Landmark description">
            <Input id={`${uid}-lm`} value={form.landmark} maxLength={300} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.pickup} onChange={(e) => setForm({ ...form, pickup: e.target.checked })} className="size-4" />
            Passengers may board here
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.dropoff} onChange={(e) => setForm({ ...form, dropoff: e.target.checked })} className="size-4" />
            Passengers may get off here
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending || !pair.ok}>{pending ? "Saving…" : "Save stop"}</Button>
          </div>
        </form>
      )}
    </li>
  );
}
