import { describe, expect, it } from "vitest";
import {
  SignReadingSchema,
  parseSignReading,
  safeParseSignReading,
  signReadingJsonSchema,
  signReadingStructuredOutputSchema,
} from "../src/index";
import { fixtures, fixturesById, getFixture } from "../src/fixtures";
import { panel, reading, schedule, WEEKDAYS } from "./helpers";

const valid = () => reading([panel({ kind: "timed_parking", timeLimitMinutes: 60, schedules: [schedule(WEEKDAYS, "08:00", "18:00")] })]);

describe("SignReading schema", () => {
  it("accepts a valid reading", () => {
    expect(() => parseSignReading(valid())).not.toThrow();
  });

  it("rejects bad times", () => {
    const r = valid();
    r.panels[0]!.schedules[0]!.start = "25:00";
    expect(safeParseSignReading(r).success).toBe(false);
    r.panels[0]!.schedules[0]!.start = "8am";
    expect(safeParseSignReading(r).success).toBe(false);
  });

  it("accepts 24:00 as an end of day", () => {
    const r = valid();
    r.panels[0]!.schedules[0]!.end = "24:00";
    expect(safeParseSignReading(r).success).toBe(true);
  });

  it("rejects out-of-range confidence and empty day lists", () => {
    const r = valid();
    r.overallConfidence = 1.2;
    expect(safeParseSignReading(r).success).toBe(false);
    const r2 = valid();
    r2.panels[0]!.schedules[0]!.days = [];
    expect(safeParseSignReading(r2).success).toBe(false);
  });

  it("validates effective date formats", () => {
    const r = valid();
    r.panels[0]!.effectiveDates = { start: "2026-11-16T07:00", end: "2026-11-16" };
    expect(safeParseSignReading(r).success).toBe(true);
    r.panels[0]!.effectiveDates = { start: "16/11/2026", end: null };
    expect(safeParseSignReading(r).success).toBe(false);
  });

  it("requires every field (no silent defaults)", () => {
    const r = valid() as unknown as Record<string, unknown>;
    delete r.legibilityIssues;
    expect(SignReadingSchema.safeParse(r).success).toBe(false);
  });
});

function walk(node: unknown, fn: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, fn));
  else if (node && typeof node === "object") {
    fn(node as Record<string, unknown>);
    Object.values(node).forEach((v) => walk(v, fn));
  }
}

describe("JSON Schema exports", () => {
  it("full schema describes the top-level fields", () => {
    const props = signReadingJsonSchema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(
      ["isParkingSign", "jurisdictionHint", "legibilityIssues", "overallConfidence", "panels"].sort(),
    );
    expect(signReadingJsonSchema.required).toEqual(expect.arrayContaining(["panels", "overallConfidence"]));
  });

  it("structured-output schema has no unsupported keywords and closed objects", () => {
    walk(signReadingStructuredOutputSchema, (o) => {
      for (const k of ["minimum", "maximum", "minItems", "pattern", "minLength", "$schema", "exclusiveMinimum"]) {
        expect(o).not.toHaveProperty(k);
      }
      if (o.type === "object") {
        expect(o.additionalProperties).toBe(false);
        expect(((o.required as string[]) ?? []).sort()).toEqual(Object.keys(o.properties as object).sort());
      }
    });
  });

  it("keeps field descriptions to guide the vision model", () => {
    expect(JSON.stringify(signReadingStructuredOutputSchema)).toContain("Permit holders excepted");
  });
});

describe("fixtures", () => {
  it("has at least 12 fixtures with unique ids", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
    expect(Object.keys(fixturesById).length).toBe(fixtures.length);
  });

  it.each(fixtures.map((f) => [f.id, f] as const))("%s validates against the schema", (_id, f) => {
    expect(SignReadingSchema.safeParse(f.reading).success).toBe(true);
  });

  it("includes temporary roadworks and temporary clearway setups", () => {
    expect(getFixture("temporary-roadworks-no-stopping").reading.panels.some((p) => p.temporary)).toBe(true);
    expect(
      getFixture("temporary-event-clearway").reading.panels.some((p) => p.temporary && p.kind === "clearway"),
    ).toBe(true);
    expect(() => getFixture("nope")).toThrow();
  });
});
