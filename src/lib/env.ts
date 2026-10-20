import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export type PublicEnvResult =
  | { configured: true; env: PublicEnv }
  | { configured: false; problems: string[] };

/**
 * Validates the public Supabase variables without throwing, so pages can
 * render an explicit "not configured" state instead of crashing or silently
 * falling back to mock data.
 *
 * Variables are read by literal name so Next.js can inline them in the browser.
 */
export function readPublicEnv(): PublicEnvResult {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (parsed.success) return { configured: true, env: parsed.data };
  return {
    configured: false,
    problems: parsed.error.issues.map((i) => i.path.join(".")),
  };
}
