import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { FNode } from "./model.ts";

// Plain code-unit comparison: fractional-indexing keys are ASCII and must not go through localeCompare.
export const byRank = (a: FNode, b: FNode) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function rankBetween(a: string | null | undefined, b: string | null | undefined): string {
  // Two devices can hand out the same rank concurrently; byRank breaks the tie by id.
  // If a >= b (that tie), anchor on a alone instead of throwing.
  try {
    if (a && b && a >= b) return generateKeyBetween(a, null);
    return generateKeyBetween(a ?? null, b ?? null);
  } catch {
    return (a ?? "a0") + "V";   // a malformed key from outside must not block editing; sorts right after a
  }
}

export const ranks = (n: number) => generateNKeysBetween(null, null, n);
