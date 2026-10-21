import type { Metadata } from "next";
import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = { title: "Administrator sign-in", robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-sm space-y-6 px-4 py-16">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Administrator sign-in</h1>
        <p className="text-sm text-muted-foreground">
          For people who maintain route data. Accounts are created by the project owner; there is no sign-up.
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
