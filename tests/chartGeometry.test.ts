/**
 * Recharts hands a below-axis segment a NEGATIVE height with `y` at its bottom
 * edge; the naive inset collapsed it to the 1px floor, which reads on screen as
 * bad data rather than bad arithmetic.
 */
import { describe, it, expect } from "vitest";
import { segmentRect } from "../src/components/MonthlyVarianceChart";

const GAP = 2;

describe("stacked segment geometry", () => {
  it("insets a normal (above-axis) segment by the gap", () => {
    // 100px tall, top edge at y=40.
    expect(segmentRect(40, 100)).toEqual({ y: 41, height: 98 });
  });

  it("a below-axis segment keeps its full size — the bug that shipped", () => {
    // Recharts: y = bottom edge (140), height = -100 (drawn upward from there).
    // The block runs 40..140, so the inset one must be 41..139.
    const rect = segmentRect(140, -100);
    expect(rect).toEqual({ y: 41, height: 98 });
    // The old `height - GAP` produced 1: a hairline at the bottom of the block.
    expect(rect.height).toBeGreaterThan(GAP);
  });

  it("is symmetric: the same block up or down draws identically", () => {
    expect(segmentRect(140, -100)).toEqual(segmentRect(40, 100));
  });

  it("a segment thinner than the gap stays visible instead of vanishing", () => {
    expect(segmentRect(40, 1).height).toBe(1);
    expect(segmentRect(41, -1).height).toBe(1);
  });
});
