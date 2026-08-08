/**
 * range.ts — THE report range. Every screen reads it from the same two search
 * params, with the same fallback, so the header picker drives all four tabs.
 */
import { isMonth } from "./month";

/** Matches scripts/seed.ts and design/prototype.html. */
export const DEFAULT_RANGE = { from: "2026-01", to: "2026-03" } as const;

export type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function resolveRange(sp: SearchParams = {}): { from: string; to: string } {
  const from = one(sp.from);
  const to = one(sp.to);
  if (!isMonth(from) || !isMonth(to) || from > to) return { ...DEFAULT_RANGE };
  return { from, to };
}
