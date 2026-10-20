"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpDown, Search } from "lucide-react";
import { PlaceInput } from "@/components/search/place-input";
import { TransportFilter } from "@/components/search/transport-filter";
import { Button } from "@/components/ui/button";
import { validateTripSearch, type TripSearchErrors, type TripSearchInput } from "@/lib/validation/trip-search";
import type { VehicleType } from "@/lib/validation/transport";

export type TripSearchFormProps = {
  /**
   * Called with validated input. Defaults to opening /explore with the query.
   * The route-search service will plug in here later.
   */
  onSearch?: (input: TripSearchInput) => void;
};

export function TripSearchForm({ onSearch }: TripSearchFormProps) {
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [types, setTypes] = useState<VehicleType[]>(["jeepney", "multicab"]);
  const [errors, setErrors] = useState<TripSearchErrors>({});

  const typesErrorId = `${uid}-types-error`;

  const swap = () => {
    setFrom(to);
    setTo(from);
    setErrors({});
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateTripSearch({ from, to, types });
    if (!result.ok) {
      setErrors(result.errors);
      const first = result.errors.from ? `${uid}-from` : result.errors.to ? `${uid}-to` : null;
      if (first) formRef.current?.querySelector<HTMLElement>(`[id="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    if (onSearch) return onSearch(result.value);
    const params = new URLSearchParams({
      from: result.value.from,
      to: result.value.to,
      types: result.value.types.join(","),
    });
    router.push(`/explore?${params.toString()}`);
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
        <PlaceInput
          id={`${uid}-from`}
          kind="origin"
          label="Starting point"
          placeholder="Where are you starting?"
          value={from}
          onChange={setFrom}
          error={errors.from}
        />
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
          placeholder="Where are you going?"
          value={to}
          onChange={setTo}
          error={errors.to}
        />
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
