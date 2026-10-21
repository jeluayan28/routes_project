"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpDown, LocateFixed, Search } from "lucide-react";
import { PlaceInput } from "@/components/search/place-input";
import { TransportFilter } from "@/components/search/transport-filter";
import { Button } from "@/components/ui/button";
import { FARE_CATEGORY_LABEL } from "@/lib/format";
import { tripQuery } from "@/lib/search/params";
import { HARD_MAX_TRANSFERS, type Preference } from "@/lib/search/types";
import { validateTripSearch, type TripSearchErrors, type TripSearchInput } from "@/lib/validation/trip-search";
import { fareCategorySchema, type FareCategory } from "@/lib/validation/route";
import type { VehicleType } from "@/lib/validation/transport";

export type TripSearchFormProps = {
  /** Called with validated input. Defaults to opening /search with the query. */
  onSearch?: (input: TripSearchInput) => void;
  /** Values to start with, e.g. from the URL of a previous search. */
  initial?: Partial<TripSearchInput>;
};

const PREFERENCE_LABEL: Record<Preference, string> = {
  "fewest-transfers": "Fewest transfers",
  "lowest-fare": "Lowest fare",
  "shortest-walking": "Shortest walking",
};

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function TripSearchForm({ onSearch, initial }: TripSearchFormProps) {
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState(initial?.from ?? "");
  const [to, setTo] = useState(initial?.to ?? "");
  const [types, setTypes] = useState<VehicleType[]>(initial?.types ?? ["jeepney", "multicab"]);
  const [category, setCategory] = useState<FareCategory>(initial?.category ?? "regular");
  const [maxTransfers, setMaxTransfers] = useState(initial?.maxTransfers ?? 2);
  const [preference, setPreference] = useState<Preference>(initial?.preference ?? "fewest-transfers");
  const [errors, setErrors] = useState<TripSearchErrors>({});
  const [locating, setLocating] = useState<"idle" | "busy" | "failed">("idle");

  const typesErrorId = `${uid}-types-error`;

  const swap = () => {
    setFrom(to);
    setTo(from);
    setErrors({});
  };

  /** Fills the starting point with the device's position as coordinates. Only on request. */
  const useMyLocation = () => {
    if (!navigator.geolocation) return setLocating("failed");
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFrom(`@${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
        setLocating("idle");
      },
      () => setLocating("failed"),
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateTripSearch({ from, to, types, category, maxTransfers, preference });
    if (!result.ok) {
      setErrors(result.errors);
      const first = result.errors.from ? `${uid}-from` : result.errors.to ? `${uid}-to` : null;
      if (first) formRef.current?.querySelector<HTMLElement>(`[id="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    if (onSearch) return onSearch(result.value);
    router.push(`/search?${tripQuery(result.value)}`);
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label="Search routes"
      className="space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="grid items-start gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-1.5">
          <PlaceInput
            id={`${uid}-from`}
            kind="origin"
            label="Starting point"
            placeholder="A stop, a landmark, or coordinates"
            value={from}
            onChange={setFrom}
            error={errors.from}
          />
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating === "busy"}
            className="inline-flex min-h-8 items-center gap-1.5 rounded text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <LocateFixed aria-hidden="true" className="size-4" />
            {locating === "busy" ? "Finding you…" : "Use my location"}
          </button>
          {locating === "failed" && (
            <p role="status" className="text-sm text-muted-foreground">
              We couldn&apos;t get your location. Type a place instead.
            </p>
          )}
        </div>
        <div className="flex justify-center md:pt-[1.625rem]">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={swap}
            aria-label="Swap starting point and destination"
            className="size-11 rounded-full md:size-9"
          >
            <ArrowUpDown aria-hidden="true" className="md:-rotate-90" />
          </Button>
        </div>
        <PlaceInput
          id={`${uid}-to`}
          kind="destination"
          label="Destination"
          placeholder="A stop, a landmark, or coordinates"
          value={to}
          onChange={setTo}
          error={errors.to}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-category`} className="text-sm font-medium">Passenger</label>
          <select id={`${uid}-category`} className={selectClass} value={category} onChange={(e) => setCategory(fareCategorySchema.parse(e.target.value))}>
            {fareCategorySchema.options.map((c) => (
              <option key={c} value={c}>{FARE_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-pref`} className="text-sm font-medium">Prefer</label>
          <select id={`${uid}-pref`} className={selectClass} value={preference} onChange={(e) => setPreference(e.target.value as Preference)}>
            {(Object.keys(PREFERENCE_LABEL) as Preference[]).map((p) => (
              <option key={p} value={p}>{PREFERENCE_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-transfers`} className="text-sm font-medium">Up to</label>
          <select id={`${uid}-transfers`} className={selectClass} value={maxTransfers} onChange={(e) => setMaxTransfers(Number(e.target.value))}>
            {Array.from({ length: HARD_MAX_TRANSFERS + 1 }, (_, n) => (
              <option key={n} value={n}>{n === 0 ? "No transfers" : `${n} transfer${n === 1 ? "" : "s"}`}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <TransportFilter
            value={types}
            onChange={(next) => {
              setTypes(next);
              setErrors((prev) => ({ ...prev, types: undefined }));
            }}
            describedBy={errors.types ? typesErrorId : undefined}
          />
          {errors.types && (
            <p id={typesErrorId} role="alert" className="text-sm text-red-700">
              {errors.types}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="h-11 sm:min-w-40">
          <Search aria-hidden="true" />
          Search Routes
        </Button>
      </div>
    </form>
  );
}
