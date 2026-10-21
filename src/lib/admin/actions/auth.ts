"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { readPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });

/** Email + password sign-in. Accounts are created by the project owner; there is no sign-up. */
export async function signInAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (!readPublicEnv().configured) return { error: "Sign-in is not available: the database connection is not configured." };
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email address and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for every failure so the form does not reveal which emails exist.
  if (error) return { error: "That email and password don't match an account." };
  redirect("/admin");
}

export async function signOutAction(): Promise<void> {
  if (readPublicEnv().configured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/admin/login");
}
