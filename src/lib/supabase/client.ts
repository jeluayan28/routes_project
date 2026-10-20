import { createBrowserClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";

/** Browser Supabase client. Uses only the public anon key; RLS enforces access. */
export function createClient() {
  const result = readPublicEnv();
  if (!result.configured) {
    throw new Error(
      `Supabase is not configured. Missing or invalid: ${result.problems.join(", ")}`,
    );
  }
  return createBrowserClient(
    result.env.NEXT_PUBLIC_SUPABASE_URL,
    result.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
