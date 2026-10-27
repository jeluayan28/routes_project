"use client";

import type { ReactNode } from "react";
import { Circle, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type PlaceInputProps = {
  id: string;
  kind: "origin" | "destination";
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** Small action shown beside the label, e.g. "Use my location". */
  labelAction?: ReactNode;
};

/** Text field for a trip end point. Green marks the start, red the destination. */
export function PlaceInput({ id, kind, label, value, onChange, error, placeholder, className, inputClassName, labelAction }: PlaceInputProps) {
  const errorId = `${id}-error`;
  const Icon = kind === "origin" ? Circle : MapPin;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      <div className="relative">
        <Icon
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2",
            kind === "origin" ? "fill-teal-600 text-teal-600" : "text-gold-foreground fill-gold",
          )}
        />
        <Input
          id={id}
          name={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={120}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn("h-11 bg-card pl-9", inputClassName)}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
