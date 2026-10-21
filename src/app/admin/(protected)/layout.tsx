import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ErrorMessage } from "@/components/common/error-message";
import { AdminNav } from "@/components/admin/admin-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminContext } from "@/lib/admin/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: { default: "Administration", template: "%s · Administration" },
  robots: { index: false, follow: false },
};

async function AdminGate({ children }: { children: ReactNode }) {
  const ctx = await getAdminContext();
  if (ctx.status === "signed-out") redirect("/admin/login");
  if (ctx.status === "unconfigured") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorMessage title="Administration is unavailable" message="The database connection is not configured, so there is nothing to administer." />
      </div>
    );
  }
  if (ctx.status === "not-admin") {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10">
        <ErrorMessage
          title="This account is not an administrator"
          message={`${ctx.email ?? "This account"} is signed in but is not on the administrator list. Ask the project owner to add it.`}
        />
        <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back to the site
        </Link>
      </div>
    );
  }
  return (
    <>
      <AdminNav email={ctx.email} />
      <div className="mx-auto w-full max-w-6xl px-4 py-6">{children}</div>
    </>
  );
}

export default function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
