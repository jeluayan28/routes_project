import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { VerificationBadge } from "@/components/common/verification-badge";
import { Badge } from "@/components/ui/badge";
import { publicStatus } from "@/lib/admin/dashboard";
import { cn } from "@/lib/utils";

export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export const textareaClass =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/** A label tied to its control, with optional hint and error text. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const TONES = {
  success: { icon: CircleCheck, className: "border-emerald-600/30 bg-emerald-50 text-emerald-900" },
  error: { icon: CircleAlert, className: "border-destructive/40 bg-red-50 text-red-900" },
  info: { icon: Info, className: "border-sky-600/30 bg-sky-50 text-sky-900" },
  warning: { icon: CircleAlert, className: "border-amber-600/40 bg-amber-50 text-amber-900" },
} as const;

/** Inline message. Errors are announced immediately; others politely. */
export function Notice({ tone, children, className }: { tone: keyof typeof TONES; children: ReactNode; className?: string }) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", toneClass, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  draft: "border-slate-400/50 bg-slate-100 text-slate-800",
  active: "border-emerald-600/40 bg-emerald-50 text-emerald-900",
  inactive: "border-amber-600/40 bg-amber-50 text-amber-900",
};

export function RouteStatusBadge({ status }: { status: "draft" | "active" | "inactive" }) {
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  );
}

type RouteLike = {
  status: "draft" | "active" | "inactive";
  verification_status: "unverified" | "verified" | "outdated";
  last_verified_at: string | null;
  is_sample: boolean;
};

/** Says in words whether a route is visible to the public, so a draft is never mistaken for a confirmed service. */
export function PublicIndicator({ route, className }: { route: RouteLike; className?: string }) {
  const s = publicStatus(route);
  return (
    <Badge
      variant="outline"
      title={s.reason}
      className={cn(s.public ? "border-emerald-700/40 bg-emerald-50 text-emerald-900" : "border-slate-400/50 bg-slate-100 text-slate-800", className)}
    >
      {s.public ? "Public" : "Not public"}
    </Badge>
  );
}

export function SampleBadge() {
  return (
    <Badge variant="outline" className="border-sky-600/40 bg-sky-50 text-sky-900">
      Sample data
    </Badge>
  );
}

export function RouteBadges({ route }: { route: RouteLike }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <RouteStatusBadge status={route.status} />
      <VerificationBadge status={route.verification_status} />
      <PublicIndicator route={route} />
      {route.is_sample && <SampleBadge />}
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(new Date(iso));
}
