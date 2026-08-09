import { describe, it, expect } from "vitest";
import { variance, variancePct, buildRow, rangeTotals, byCategory, byMonth } from "../src/lib/variance";
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

const row = (categoryId: string, month: string, plan: number, actual: number, hasActuals = true) =>
  buildRow({
    categoryId,
    categoryName: categoryId.toUpperCase(),
    month,
    plan: toMinor(plan),
    actual: toMinor(actual),
    hasActuals,
    hasPlan: plan !== 0,
  });

describe("chart grouping (the report's two pictures)", () => {
  it("does NOT net a month: an overspend and an equal underspend both stay visible", () => {
    // Netted, these two cancel to zero and draw like a month that landed on plan.
    const [jan] = byMonth([row("a", "2026-01", 100, 600), row("b", "2026-01", 600, 100)], ["2026-01"]);
    expect(jan.net).toBe(0);
    expect(jan.over).toBe(toMinor(500));
    expect(jan.under).toBe(toMinor(-500));
    expect(jan.hasData).toBe(true);
  });

  it("a month with no rows is hasData:false, not a zero that reads as on plan", () => {
    const [jan, feb] = byMonth([row("a", "2026-01", 100, 100)], ["2026-01", "2026-02"]);
    expect(jan).toMatchObject({ hasData: true, net: 0 }); // landed exactly on plan
    expect(feb).toMatchObject({ hasData: false, net: 0 }); // nothing was ever entered
  });

  it("every category gets a key in every month, so a stack never skips a segment", () => {
    const [jan, feb] = byMonth(
      [row("a", "2026-01", 100, 150), row("b", "2026-02", 100, 50)],
      ["2026-01", "2026-02"]
    );
    expect(jan.byCategory).toEqual({ a: toMinor(50), b: 0 });
    expect(feb.byCategory).toEqual({ a: 0, b: toMinor(-50) });
  });

  it("rolls a category up across the range and ranks by |variance|, not by sign", () => {
    const ranked = byCategory([
      row("small", "2026-01", 100, 110),
      row("big", "2026-01", 100, 20),
      row("big", "2026-02", 100, 90),
    ]);
    expect(ranked.map(c => c.categoryId)).toEqual(["big", "small"]);
    expect(ranked[0].variance).toBe(toMinor(-90)); // -80 + -10, summed exactly
  });

  it("a category with actuals in ANY month is not provisional for the range", () => {
    const [only] = byCategory([row("a", "2026-01", 100, 0, false), row("a", "2026-02", 100, 120, true)]);
    expect(only.hasActuals).toBe(true);
  });
});

describe("accounting display", () => {
  it("negatives in parentheses AROUND the symbol, comma grouping", () => {
    expect(formatMoney(toMinor(-200))).toBe("($200.00)");
    expect(formatMoney(toMinor(20500))).toBe("$20,500.00");
  });

  it("prints the selected currency, and groups INR the way its readers read it", () => {
    expect(formatMoney(toMinor(20500), "EUR")).toBe("\u20ac20,500.00");
    expect(formatMoney(toMinor(20500), "GBP")).toBe("\u00a320,500.00");
    expect(formatMoney(toMinor(20500), "AED")).toBe("AED\u00a020,500.00");
    // Lakh grouping: 20,50,000 in en-IN, not the 2,050,000 en-US would give.
    expect(formatMoney(toMinor(2050000), "INR")).toBe("\u20b920,50,000.00");
  });
  it("pct display: sign or em dash", () => {
    expect(formatPct(2.5)).toBe("+2.50%");
    expect(formatPct(-4)).toBe("(4.00%)");
    expect(formatPct(null)).toBe("\u2014");
  });
});
