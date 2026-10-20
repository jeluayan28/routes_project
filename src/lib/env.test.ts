import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicEnv } from "./env";

describe("readPublicEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports missing variables instead of throwing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const result = readPublicEnv();
    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.problems).toEqual([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ]);
    }
  });

  it("accepts valid values", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    expect(readPublicEnv().configured).toBe(true);
  });
});
