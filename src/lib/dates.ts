/** Today's calendar date in Asia/Manila (YYYY-MM-DD), matching how the database reads dates. */
export function todayInManila(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
