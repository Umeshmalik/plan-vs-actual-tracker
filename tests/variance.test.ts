import { describe, it, expect } from "vitest";
import { variance, variancePct, buildRow, rangeTotals } from "../src/lib/variance";
import { formatMoney, formatPct, toMinor } from "../src/lib/money";

describe("variance math (all edge cases owned here)", () => {
  it("computes actual - plan (negative = under plan = favorable)", () => {
    expect(variance(500000, 480000)).toBe(-20000);
    expect(variance(2000000, 2050000)).toBe(50000);
  });

  it("plan = 0 -> variancePct null, never NaN/Infinity", () => {
    expect(variancePct(0, 123400)).toBeNull();
    expect(variancePct(0, 0)).toBeNull();
  });

  it("missing actual treated as 0 (Marketing Feb: -5,000 / -100%)", () => {
    const row = buildRow({
      categoryId: "c",
      categoryName: "Marketing",
      month: "2026-02",
      plan: toMinor(5000),
      actual: 0,
      hasActuals: false,
      hasPlan: true,
    });
    expect(row.variance).toBe(toMinor(-5000));
    expect(row.variancePct).toBe(-100);
  });

  it("unbudgeted spend is representable (hasPlan false, pct null)", () => {
    const row = buildRow({
      categoryId: "c",
      categoryName: "Travel",
      month: "2026-01",
      plan: 0,
      actual: toMinor(900),
      hasActuals: true,
      hasPlan: false,
    });
    expect(row.variance).toBe(toMinor(900));
    expect(row.variancePct).toBeNull();
  });

  it("range totals sum minor units exactly (no float drift)", () => {
    const rows = [
      buildRow({
        categoryId: "a",
        categoryName: "A",
        month: "2026-01",
        plan: 1,
        actual: 2,
        hasActuals: true,
        hasPlan: true,
      }),
      buildRow({
        categoryId: "b",
        categoryName: "B",
        month: "2026-01",
        plan: 3,
        actual: 4,
        hasActuals: true,
        hasPlan: true,
      }),
    ];
    expect(rangeTotals(rows)).toMatchObject({ plan: 4, actual: 6, variance: 2 });
  });
});

describe("accounting display", () => {
  it("negatives in parentheses, thin-space grouping", () => {
    expect(formatMoney(toMinor(-200))).toBe("(200.00)");
    expect(formatMoney(toMinor(20500))).toBe("20\u2009500.00");
  });
  it("pct display: sign or em dash", () => {
    expect(formatPct(2.5)).toBe("+2.50%");
    expect(formatPct(-4)).toBe("(4.00%)");
    expect(formatPct(null)).toBe("\u2014");
  });
});
