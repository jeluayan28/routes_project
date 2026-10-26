"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV_ITEMS, SEARCH_ITEM, isActivePath } from "@/lib/navigation";
import { SITE_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function MobileNav({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className={className} />}>
        <Menu aria-hidden="true" />
        <span className="sr-only">Open menu</span>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{SITE_NAME}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-2">
          <Link
            href={SEARCH_ITEM.href}
            onClick={() => setOpen(false)}
            className={cn(buttonVariants({ size: "lg" }), "h-12 w-full text-base")}
          >
            <Search aria-hidden="true" />
            {SEARCH_ITEM.label}
          </Link>
        </div>
        <nav aria-label="Mobile" className="px-2">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center rounded-md px-3 text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-accent text-link" : "hover:bg-accent",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
