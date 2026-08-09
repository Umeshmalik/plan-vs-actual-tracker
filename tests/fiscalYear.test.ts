/**
 * Pure arithmetic, so every off-by-one is a report covering the wrong twelve
 * months. April is the interesting start, December carries across the year
 * boundary, January must stay indistinguishable from a calendar year.
 */
import { describe, it, expect } from "vitest";
import {
  CALENDAR_YEAR_START,
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearRange,
  isFiscalStartMonth,
  labelIfFiscalYear,
  recentFiscalYears,
} from "../src/lib/fiscalYear";

describe("a January start is exactly the calendar year", () => {
  it("spans Jan..Dec of its own year and is labelled without a slash", () => {
    expect(fiscalYearRange(2026, CALENDAR_YEAR_START)).toEqual({ from: "2026-01", to: "2026-12" });
    expect(fiscalYearLabel(2026, CALENDAR_YEAR_START)).toBe("FY 2026");
    expect(fiscalYearOf("2026-01", CALENDAR_YEAR_START)).toBe(2026);
    expect(fiscalYearOf("2026-12", CALENDAR_YEAR_START)).toBe(2026);
  });
});

describe("a non-January start carries into the next calendar year", () => {
  it("April 2026 runs to March 2027 and says so in the label", () => {
    expect(fiscalYearRange(2026, 4)).toEqual({ from: "2026-04", to: "2027-03" });
    expect(fiscalYearLabel(2026, 4)).toBe("FY 2026/27");
  });

  it("December 2026 runs to November 2027", () => {
    expect(fiscalYearRange(2026, 12)).toEqual({ from: "2026-12", to: "2027-11" });
  });

  it("a month before the start belongs to the PREVIOUS fiscal year", () => {
    expect(fiscalYearOf("2026-03", 4)).toBe(2025); // last month of FY 2025/26
    expect(fiscalYearOf("2026-04", 4)).toBe(2026); // first month of FY 2026/27
  });

  it("the century rolls over without printing FY 2099/00 wrong", () => {
    expect(fiscalYearLabel(2099, 4)).toBe("FY 2099/00");
  });
});

describe("a range is only labelled when it IS a fiscal year", () => {
  it("names an exact match", () => {
    expect(labelIfFiscalYear("2026-04", "2027-03", 4)).toBe("FY 2026/27");
    expect(labelIfFiscalYear("2026-01", "2026-12", 1)).toBe("FY 2026");
  });

  it("refuses an arbitrary twelve months, a partial year, and junk", () => {
    expect(labelIfFiscalYear("2026-02", "2027-01", 4)).toBeNull(); // 12 months, wrong ones
    expect(labelIfFiscalYear("2026-04", "2026-09", 4)).toBeNull(); // half a year
    expect(labelIfFiscalYear("2026-1", "2027-03", 4)).toBeNull(); // not YYYY-MM
  });
});

describe("the selector's options", () => {
  it("offers the fiscal year in view first, then the ones before it", () => {
    expect(recentFiscalYears("2026-02", 4)).toEqual([2025, 2024, 2023, 2022]);
    expect(recentFiscalYears("2026-02", CALENDAR_YEAR_START)).toEqual([2026, 2025, 2024, 2023]);
  });

  it("only accepts 1-12 as a start month", () => {
    expect([1, 4, 12].every(isFiscalStartMonth)).toBe(true);
    expect([0, 13, 1.5, -1, "4", null, undefined].some(isFiscalStartMonth)).toBe(false);
  });
});
