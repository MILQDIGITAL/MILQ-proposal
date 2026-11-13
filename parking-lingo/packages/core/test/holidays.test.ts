import { describe, expect, it } from "vitest";
import {
  australianPublicHolidays,
  AUSTRALIAN_JURISDICTIONS,
  easterSunday,
  isPublicHolidayOn,
  jurisdictionFromTimeZone,
  normaliseJurisdiction,
  publicHolidaysOn,
} from "../src/index";

const dates = (year: number, j: string) => australianPublicHolidays(year, j).map((h) => h.date);

describe("easterSunday", () => {
  it.each([
    [2019, "2019-04-21"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"],
  ])("%i -> %s", (year, expected) => {
    const e = easterSunday(year);
    expect(`${e.year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`).toBe(expected);
  });
});

describe("australianPublicHolidays", () => {
  it("Easter 2026: Good Friday 3 Apr, Easter Monday 6 Apr everywhere", () => {
    for (const j of AUSTRALIAN_JURISDICTIONS) {
      expect(dates(2026, j)).toEqual(expect.arrayContaining(["2026-04-03", "2026-04-06"]));
    }
  });

  it("Easter Saturday is not a holiday in WA or TAS", () => {
    expect(dates(2026, "AU-NSW")).toContain("2026-04-04");
    expect(dates(2026, "AU-WA")).not.toContain("2026-04-04");
    expect(dates(2026, "AU-TAS")).not.toContain("2026-04-04");
  });

  it("Australia Day 2026 is Monday 26 Jan; 2025 (Sunday) moves to Monday 27 Jan", () => {
    expect(dates(2026, "AU-NSW")).toContain("2026-01-26");
    expect(dates(2025, "AU-VIC")).toEqual(expect.arrayContaining(["2025-01-26", "2025-01-27"]));
  });

  it("New Year's Day on a Saturday adds Monday", () => {
    expect(dates(2022, "AU-QLD")).toEqual(expect.arrayContaining(["2022-01-01", "2022-01-03"]));
  });

  it("Anzac Day 2026 falls on Saturday: no Monday in NSW, Monday in WA", () => {
    expect(dates(2026, "AU-NSW")).toContain("2026-04-25");
    expect(dates(2026, "AU-NSW")).not.toContain("2026-04-27");
    expect(dates(2026, "AU-WA")).toContain("2026-04-27");
  });

  it("Christmas 2026 Friday, Boxing Day Saturday -> substitute Monday 28 Dec", () => {
    const d = dates(2026, "AU-NSW");
    expect(d).toEqual(expect.arrayContaining(["2026-12-25", "2026-12-26", "2026-12-28"]));
    expect(d).not.toContain("2026-12-27");
  });

  it("Christmas on Saturday (2027) -> Mon 27 and Tue 28", () => {
    expect(dates(2027, "AU-VIC")).toEqual(expect.arrayContaining(["2027-12-27", "2027-12-28"]));
  });

  it("Christmas on Sunday (2022) -> Boxing Day Mon 26, Christmas substitute Tue 27", () => {
    expect(dates(2022, "AU-NSW")).toEqual(expect.arrayContaining(["2022-12-26", "2022-12-27"]));
  });

  it("King's Birthday: 2nd Monday in June, QLD 1st Monday in October, WA not listed", () => {
    expect(dates(2026, "AU-NSW")).toContain("2026-06-08");
    expect(dates(2026, "AU-QLD")).toContain("2026-10-05");
    expect(dates(2026, "AU-QLD")).not.toContain("2026-06-08");
    expect(australianPublicHolidays(2026, "AU-WA").some((h) => h.name.startsWith("King"))).toBe(false);
  });

  it("Labour Day differs by state", () => {
    expect(dates(2026, "AU-NSW")).toContain("2026-10-05");
    expect(dates(2026, "AU-VIC")).toContain("2026-03-09");
    expect(dates(2026, "AU-QLD")).toContain("2026-05-04");
    expect(dates(2026, "AU-WA")).toContain("2026-03-02");
    expect(dates(2026, "AU-TAS")).toContain("2026-03-09");
    expect(dates(2026, "AU-NT")).toContain("2026-05-04");
  });

  it("state-specific days", () => {
    expect(dates(2026, "AU-SA")).toContain("2026-03-09"); // Adelaide Cup
    expect(dates(2026, "AU-WA")).toContain("2026-06-01"); // WA Day
    expect(dates(2026, "AU-NT")).toContain("2026-08-03"); // Picnic Day
    expect(dates(2026, "AU-ACT")).toEqual(expect.arrayContaining(["2026-03-09", "2026-06-01"])); // Canberra, Reconciliation
    expect(dates(2025, "AU-ACT")).toContain("2025-06-02");
  });

  it("Melbourne Cup Day is listed as partial (metro only)", () => {
    const cup = australianPublicHolidays(2025, "AU-VIC").find((h) => h.name === "Melbourne Cup Day");
    expect(cup).toMatchObject({ date: "2025-11-04", scope: "partial" });
    expect(isPublicHolidayOn("2026-11-03", "AU-VIC")).toBe("unknown");
  });

  it("is sorted and unknown jurisdictions give nothing", () => {
    const d = dates(2026, "AU-SA");
    expect([...d].sort()).toEqual(d);
    expect(australianPublicHolidays(2026, "XX")).toEqual([]);
  });
});

describe("lookups", () => {
  it("isPublicHolidayOn", () => {
    expect(isPublicHolidayOn("2026-01-26", "AU-NSW")).toBe(true);
    expect(isPublicHolidayOn({ year: 2026, month: 11, day: 12 }, "NSW")).toBe(false);
    expect(isPublicHolidayOn("2026-01-26", null)).toBe("unknown");
    expect(isPublicHolidayOn("2026-01-26", "Narnia")).toBe("unknown");
  });

  it("publicHolidaysOn returns names", () => {
    expect(publicHolidaysOn("2026-12-28", "AU-QLD")[0]?.substitute).toBe(true);
    expect(publicHolidaysOn("2026-04-03", "AU-TAS")[0]?.name).toBe("Good Friday");
  });

  it("normaliseJurisdiction accepts common spellings", () => {
    expect(normaliseJurisdiction("AU-NSW")).toBe("AU-NSW");
    expect(normaliseJurisdiction("nsw")).toBe("AU-NSW");
    expect(normaliseJurisdiction("Victoria")).toBe("AU-VIC");
    expect(normaliseJurisdiction("au_qld")).toBe("AU-QLD");
    expect(normaliseJurisdiction("US-CA")).toBeNull();
    expect(normaliseJurisdiction(null)).toBeNull();
  });

  it("jurisdictionFromTimeZone only maps unambiguous zones", () => {
    expect(jurisdictionFromTimeZone("Australia/Melbourne")).toBe("AU-VIC");
    expect(jurisdictionFromTimeZone("Australia/Sydney")).toBe("AU-NSW");
    expect(jurisdictionFromTimeZone("Australia/Broken_Hill")).toBeNull();
    expect(jurisdictionFromTimeZone("UTC")).toBeNull();
  });
});
