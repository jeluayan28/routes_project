/**
 * Sample (development) data must be switched on explicitly. It is never used
 * as a silent fallback for missing real data.
 */
export function isSampleDataEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SAMPLE_DATA === "true";
}

/** Optional public contact address for corrections. Null when not configured. */
export function getContactEmail(): string | null {
  const value = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return value ? value : null;
}
