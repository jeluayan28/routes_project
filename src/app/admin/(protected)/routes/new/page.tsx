import { RouteEditor } from "@/components/admin/route-editor";
import { requireAdminPage } from "@/lib/admin/session";

export const metadata = { title: "New route" };

export default async function NewRoutePage() {
  const ctx = await requireAdminPage();
  if (ctx.status !== "admin") return null;
  return <RouteEditor data={null} />;
}
