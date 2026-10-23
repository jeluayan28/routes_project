"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/lib/admin/actions/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ITEMS = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/routes", label: "Routes" },
  { href: "/admin/stops", label: "Stops" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/quality", label: "Data quality" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/import", label: "CSV import" },
] as const;

export function AdminNav({ email }: { email: string | null }) {
  const pathname = usePathname();
  return (
    <div className="border-b bg-muted/40">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <nav aria-label="Administration">
          <ul className="flex flex-wrap items-center gap-1">
            {ITEMS.map((item) => {
              const active = "exact" in item ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-background text-link shadow-xs" : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <form action={signOutAction} className="flex items-center gap-2 text-sm text-muted-foreground">
          {email && <span className="hidden sm:inline">{email}</span>}
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
