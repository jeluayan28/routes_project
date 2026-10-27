"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpDown, ChevronDown, LocateFixed, Search } from "lucide-react";
import { PlaceInput } from "@/components/search/place-input";
import { TransportFilter } from "@/components/search/transport-filter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FARE_CATEGORY_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  /**
   * "hero" is the "Where to go?" card on the home page; "panel" is the same stacked form
   * with no card chrome, for the search sidebar. Both tuck the options away.
   */
  layout?: "default" | "hero" | "panel";
};

const PREFERENCE_LABEL: Record<Preference, string> = {
  "fewest-transfers": "Fewest transfers",
  "lowest-fare": "Lowest fare",
  "shortest-walking": "Shortest walking",
};

type Option = { value: string; label: string };

/** A labelled shadcn Select. Values are strings; callers convert. */
function OptionSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Select value={value} items={options} onValueChange={(next) => next !== null && onChange(next)}>
        <SelectTrigger id={id} className="h-10 w-full bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const CATEGORY_OPTIONS: Option[] = fareCategorySchema.options.map((c) => ({ value: c, label: FARE_CATEGORY_LABEL[c] }));
const PREFERENCE_OPTIONS: Option[] = (Object.keys(PREFERENCE_LABEL) as Preference[]).map((p) => ({ value: p, label: PREFERENCE_LABEL[p] }));
const TRANSFER_OPTIONS: Option[] = Array.from({ length: HARD_MAX_TRANSFERS + 1 }, (_, n) => ({
  value: String(n),
  label: n === 0 ? "No transfers" : `${n} transfer${n === 1 ? "" : "s"}`,
}));

export function TripSearchForm({ onSearch, initial, layout = "default" }: TripSearchFormProps) {
  const hero = layout === "hero";
  const panel = layout === "panel";
  const stacked = hero || panel;
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState(initial?.from ?? "");
  const [to, setTo] = useState(initial?.to ?? "");
  const [types, setTypes] = useState<VehicleType[]>(initial?.types ?? ["minibus", "multicab"]);
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

  const transportFilter = (
    <div className="space-y-1.5">
      <TransportFilter
        compact={hero}
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
  );

  const options = (
    <div className={cn("grid gap-3", !stacked && "sm:grid-cols-3")}>
      <OptionSelect id={`${uid}-category`} label="Passenger" value={category} options={CATEGORY_OPTIONS} onChange={(v) => setCategory(fareCategorySchema.parse(v))} />
      <OptionSelect id={`${uid}-pref`} label="Prefer" value={preference} options={PREFERENCE_OPTIONS} onChange={(v) => setPreference(v as Preference)} />
      <OptionSelect id={`${uid}-transfers`} label="Up to" value={String(maxTransfers)} options={TRANSFER_OPTIONS} onChange={(v) => setMaxTransfers(Number(v))} />
    </div>
  );

  const locate = (
    <button
      type="button"
      onClick={useMyLocation}
      disabled={locating === "busy"}
      aria-label={locating === "busy" ? "Finding your location" : "Use my location"}
      className="-my-2 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      <LocateFixed aria-hidden="true" className="size-4" />
      <span className="whitespace-nowrap">{locating === "busy" ? "Finding you…" : "My location"}</span>
    </button>
  );

  const swapLink = (
    <button
      type="button"
      onClick={swap}
      aria-label="Swap starting point and destination"
      className="-my-2 inline-flex min-h-10 items-center gap-1.5 rounded px-1 text-sm font-medium text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowUpDown aria-hidden="true" className="size-4" />
      <span>Swap</span>
    </button>
  );

  const swapButton = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={swap}
      aria-label="Swap starting point and destination"
      className="size-11 rounded-full bg-card shadow-sm active:translate-y-0! md:size-9"
    >
      <ArrowUpDown aria-hidden="true" className="md:-rotate-90" />
    </Button>
  );

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label="Search routes"
      className={cn(
        "space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5",
        hero && "on-light max-sm:space-y-3 border-transparent p-3 shadow-xl sm:p-6",
        panel && "rounded-none border-0 bg-transparent p-0 shadow-none sm:p-0",
      )}
    >
      {hero && <h2 className="text-lg font-semibold tracking-tight sm:text-2xl">Where to go?</h2>}
      <div className={cn(stacked ? "space-y-3" : "grid items-center gap-x-2 gap-y-3 md:grid-cols-[1fr_auto_1fr] md:items-start")}>
        <PlaceInput
          id={`${uid}-from`}
          kind="origin"
          label="Starting point"
          placeholder="Stop or landmark"
          value={from}
          onChange={setFrom}
          error={errors.from}
          labelAction={locate}
          inputClassName={stacked ? cn(hero && "max-sm:h-10") : undefined}
        />
        {!stacked && <div className="flex justify-center md:pt-[1.625rem]">{swapButton}</div>}
        <PlaceInput
          id={`${uid}-to`}
          kind="destination"
          label="Destination"
          placeholder="Stop or landmark"
          value={to}
          onChange={setTo}
          error={errors.to}
          labelAction={stacked ? swapLink : undefined}
          inputClassName={stacked ? cn(hero && "max-sm:h-10") : undefined}
        />
      </div>
      {locating === "failed" && (
        <p role="status" className="text-sm text-muted-foreground">
          We couldn&apos;t get your location. Type a place instead.
        </p>
      )}

      {hero && transportFilter}

      {stacked ? (
        <details open={errors.types ? true : undefined} className="group rounded-lg border border-dashed px-3">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between max-sm:min-h-10 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Passenger, preference &amp; transfers
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="pt-1 pb-3">{options}</div>
        </details>
      ) : (
        options
      )}

      <div className={cn("flex flex-col gap-3", !hero && "sm:flex-row sm:items-center sm:justify-between")}>
        {!hero && transportFilter}
        <Button
          type="submit"
          size="lg"
          className={cn("h-12 text-base max-sm:h-11 sm:min-w-40", hero && "w-full", panel && "w-full sm:w-auto", hero && "bg-gold font-semibold text-gold-foreground hover:bg-gold/90")}
        >
          <Search aria-hidden="true" />
          Search Routes
        </Button>
      </div>
    </form>
  );
}
