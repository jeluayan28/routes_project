/**
 * Money is handled as integer centavos. The database stores numeric(8,2), which
 * the API returns as a JSON number, so every amount is checked to be a real
 * two-decimal peso value before it is converted, and sums are done on integers.
 */

/** numeric(8,2) holds at most 999999.99. */
export const MAX_CENTAVOS = 99_999_999;

/**
 * Pesos to centavos, or null if the value is not a finite, non-negative amount
 * with at most two decimals within the column's range.
 */
export function pesosToCentavos(pesos: unknown): number | null {
  if (typeof pesos !== "number" || !Number.isFinite(pesos) || pesos < 0) return null;
  const centavos = Math.round(pesos * 100);
  if (Math.abs(pesos * 100 - centavos) > 1e-6) return null;
  return centavos > MAX_CENTAVOS ? null : centavos;
}

/** Integer centavos for a value already known to be valid. */
export const toCentavos = (pesos: number) => Math.round(pesos * 100);
export const fromCentavos = (centavos: number) => centavos / 100;
