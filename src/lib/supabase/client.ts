import { createBrowserClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/** Browser Supabase client. Uses only the public publishable key; RLS enforces access. */
export function createClient() {
  const result = readPublicEnv();
  if (!result.configured) {
    throw new Error(
      `Supabase is not configured. Missing or invalid: ${result.problems.join(", ")}`,
    );
  }
  return createBrowserClient<Database>(
    result.env.NEXT_PUBLIC_SUPABASE_URL,
    result.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
