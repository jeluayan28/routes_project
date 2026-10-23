import Link from "next/link";
import { Suspense } from "react";
import { Menu, Route } from "lucide-react";
import { MainNav, MainNavView } from "@/components/layout/main-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Button } from "@/components/ui/button";
import { SITE_NAME } from "@/lib/constants";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent on-navy">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Route aria-hidden="true" className="size-4" />
          </span>
          {SITE_NAME}
        </Link>
        <Suspense fallback={<MainNavView pathname="" className="hidden md:block" />}>
          <MainNav className="hidden md:block" />
        </Suspense>
        <Suspense
          fallback={
            <Button variant="ghost" size="icon" disabled className="md:hidden">
              <Menu aria-hidden="true" />
              <span className="sr-only">Menu loading</span>
            </Button>
          }
        >
          <MobileNav className="md:hidden" />
        </Suspense>
      </div>
    </header>
  );
}
