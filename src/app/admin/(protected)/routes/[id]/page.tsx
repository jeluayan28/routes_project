import { notFound } from "next/navigation";
import { z } from "zod";
import { ErrorMessage } from "@/components/common/error-message";
import { RouteEditor, type EditorTab } from "@/components/admin/route-editor";
import { loadEditorData } from "@/lib/admin/data";
import { requireAdminPage } from "@/lib/admin/session";
import { firstParam } from "@/lib/search-params";

export const metadata = { title: "Edit route" };

const TABS: EditorTab[] = ["details", "stops", "geometry", "fares", "verify"];

export default async function EditRoutePage({ params, searchParams }: PageProps<"/admin/routes/[id]">) {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  let data;
  try {
    data = await loadEditorData(ctx.supabase, id);
  } catch (error) {
    console.error("Route editor failed", error);
    return <ErrorMessage title="Couldn't load this route" message="The route could not be loaded. Nothing has been changed." />;
  }
  if (!data) notFound();

  const tab = firstParam((await searchParams).tab);
  const initialTab = TABS.find((t) => t === tab) ?? "details";
  // The editor owns its draft state; remount when the stored route changes (e.g. after verifying).
  return <RouteEditor key={`${data.route.updated_at}:${data.verifications.length}`} data={data} initialTab={initialTab} />;
}
