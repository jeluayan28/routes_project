"use client";

import { useActionState } from "react";
import { Field, Notice } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInAction, type LoginState } from "@/lib/admin/actions/auth";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signInAction, { error: null });
  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Field id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="username" required className="h-10" />
      </Field>
      <Field id="password" label="Password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-10" />
      </Field>
      <Button type="submit" disabled={pending} className="h-10 w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
