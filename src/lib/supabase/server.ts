import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readPublicEnv } from "@/lib/env";

/**
 * Server Supabase client bound to the request's cookies (admin sessions).
 * Still uses the anon key: privileges come from the signed-in user + RLS.
 * The service-role key is intentionally not used anywhere.
 */
export async function createClient() {
  const result = readPublicEnv();
  if (!result.configured) {
    throw new Error(
      `Supabase is not configured. Missing or invalid: ${result.problems.join(", ")}`,
    );
  }
  const cookieStore = await cookies();
  return createServerClient(
    result.env.NEXT_PUBLIC_SUPABASE_URL,
    result.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh will be handled in proxy.ts in the auth phase.
          }
        },
      },
    },
  );
}
