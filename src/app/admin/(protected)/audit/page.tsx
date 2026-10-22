import Link from "next/link";
import { ErrorMessage } from "@/components/common/error-message";
import { formatDate } from "@/components/admin/admin-ui";
import { Pagination } from "@/components/admin/pagination";
import { AUDIT_ENTITIES, describeAudit } from "@/lib/admin/audit";
import { listAudit } from "@/lib/admin/data";
import { PAGE_SIZE, paginate, parsePage } from "@/lib/admin/pagination";
import { requireAdminPage } from "@/lib/admin/session";
import { firstParam } from "@/lib/search-params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Audit log" };

/** How far back the page reaches. The log itself is never trimmed. */
const WINDOW = 500;

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  const params = await searchParams;
  const entity = AUDIT_ENTITIES.find(([key]) => key === firstParam(params.entity))?.[0];
  const significantOnly = firstParam(params.significant) === "1";

  let entries;
  try {
    entries = await listAudit(ctx.supabase, { entity, limit: WINDOW });
  } catch (error) {
    console.error("Audit log failed", error);
    return <ErrorMessage title="Couldn't load the audit log" message="The audit log could not be loaded." />;
  }
  const rows = entries.map((e) => ({ e, d: describeAudit(e) })).filter((r) => !significantOnly || r.d.significant);
  const page = paginate(rows, parsePage(firstParam(params.page)), PAGE_SIZE);

  const url = (opts: { entity?: string; significant?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    if (opts.entity) q.set("entity", opts.entity);
    if (opts.significant) q.set("significant", "1");
    if (opts.page && opts.page > 1) q.set("page", String(opts.page));
    const text = q.toString();
    return `/admin/audit${text ? `?${text}` : ""}`;
  };
  const pill = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
    );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every change to routes, stops, fares, geometry and reports, with who made it. Entries cannot be edited or deleted. Showing the latest {WINDOW}.
        </p>
      </div>
      <nav aria-label="Filter the audit log">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href={url({ significant: significantOnly })} aria-current={!entity ? "page" : undefined} className={pill(!entity)}>All</Link>
          </li>
          {AUDIT_ENTITIES.map(([key, label]) => (
            <li key={key}>
              <Link href={url({ entity: key, significant: significantOnly })} aria-current={entity === key ? "page" : undefined} className={pill(entity === key)}>
                {label}
              </Link>
            </li>
          ))}
          <li>
            <Link href={url({ entity, significant: !significantOnly })} aria-current={significantOnly ? "true" : undefined} className={pill(significantOnly)}>
              Significant only
            </Link>
          </li>
        </ul>
      </nav>

      {page.total === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">No entries match.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Administrative actions, newest first</caption>
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">When</th>
                <th scope="col" className="px-4 py-2 font-medium">What</th>
                <th scope="col" className="px-4 py-2 font-medium">Record</th>
                <th scope="col" className="px-4 py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map(({ e, d }) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(e.created_at)}</td>
                  <td className="px-4 py-3 font-medium">{d.label}</td>
                  <td className="px-4 py-3 text-muted-foreground">{d.subject ?? e.entity_id ?? "-"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{e.admin_id ? `${e.admin_id.slice(0, 8)}…` : "outside the app"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} href={(p) => url({ entity, significant: significantOnly, page: p })} />
    </div>
  );
}
