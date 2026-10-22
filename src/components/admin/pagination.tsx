import Link from "next/link";
import type { Page } from "@/lib/admin/pagination";
import { cn } from "@/lib/utils";

/** Previous / next links that keep the other query parameters. */
export function Pagination({ page, href }: { page: Pick<Page<unknown>, "page" | "pageCount" | "from" | "to" | "total">; href: (page: number) => string }) {
  if (page.total === 0) return null;
  const link = "inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p aria-live="polite" className="text-muted-foreground">
        Showing {page.from}–{page.to} of {page.total}
      </p>
      <div className="flex items-center gap-2">
        {page.page > 1 ? (
          <Link href={href(page.page - 1)} rel="prev" className={cn(link, "bg-card hover:bg-accent")}>
            Previous<span className="sr-only"> page</span>
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(link, "text-muted-foreground opacity-50")}>Previous</span>
        )}
        <span className="text-muted-foreground">Page {page.page} of {page.pageCount}</span>
        {page.page < page.pageCount ? (
          <Link href={href(page.page + 1)} rel="next" className={cn(link, "bg-card hover:bg-accent")}>
            Next<span className="sr-only"> page</span>
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(link, "text-muted-foreground opacity-50")}>Next</span>
        )}
      </div>
    </nav>
  );
}
