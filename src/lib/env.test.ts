import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicEnv } from "./env";

describe("readPublicEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports missing variables instead of throwing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const result = readPublicEnv();
    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.problems).toEqual([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ]);
    }
  });

  it("accepts a publishable key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");
    expect(readPublicEnv().configured).toBe(true);
  });

  it("falls back to the legacy anon key name", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy-anon-key");
    const result = readPublicEnv();
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("legacy-anon-key");
    }
  });
});
