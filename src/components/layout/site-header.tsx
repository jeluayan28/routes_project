import Link from "next/link";
import { Suspense } from "react";
import { Menu, Route, Search } from "lucide-react";
import { MainNav, MainNavView } from "@/components/layout/main-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { SEARCH_ITEM } from "@/lib/navigation";
import { SITE_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 on-navy">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Route aria-hidden="true" className="size-4" />
          </span>
          <span className="truncate">{SITE_NAME}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Suspense fallback={<MainNavView pathname="" className="hidden lg:block" />}>
            <MainNav className="hidden lg:block" />
          </Suspense>
          <Link href={SEARCH_ITEM.href} className={cn(buttonVariants(), "hidden h-10 px-4 lg:inline-flex")}>
            <Search aria-hidden="true" />
            {SEARCH_ITEM.label}
          </Link>
          <Suspense
            fallback={
              <Button variant="ghost" size="icon" disabled className="size-11 lg:hidden">
                <Menu aria-hidden="true" />
                <span className="sr-only">Menu loading</span>
              </Button>
            }
          >
            <MobileNav className="size-11 lg:hidden" />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
