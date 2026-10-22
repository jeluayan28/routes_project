export const PAGE_SIZE = 25;

export type Page<T> = { items: T[]; page: number; pageCount: number; total: number; from: number; to: number };

/** A 1-based page number from a URL value; anything unusable is page 1. */
export function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
}

/** One page of a list. A page past the end is clamped to the last page. */
export function paginate<T>(all: readonly T[], requested: number, size = PAGE_SIZE): Page<T> {
  const pageCount = Math.max(1, Math.ceil(all.length / size));
  const page = Math.min(Math.max(1, requested), pageCount);
  const start = (page - 1) * size;
  const items = all.slice(start, start + size);
  return { items, page, pageCount, total: all.length, from: all.length === 0 ? 0 : start + 1, to: start + items.length };
}
