import Link from "next/link";
import { NAV_ITEMS } from "@/lib/navigation";
import { SITE_NAME } from "@/lib/constants";

export function SiteFooter() {
  return (
    <footer className="on-navy">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 text-sm text-muted-foreground sm:grid-cols-2">
        <div className="space-y-2">
          <p className="font-semibold">{SITE_NAME}</p>
          <p>Free community guide to minibus and multicab routes in Butuan City.</p>
          <p>
            Map data &copy;{" "}
            <a className="underline underline-offset-2" href="https://www.openstreetmap.org/copyright">
              OpenStreetMap
            </a>{" "}
            contributors.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 sm:justify-end">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="underline-offset-2 hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
