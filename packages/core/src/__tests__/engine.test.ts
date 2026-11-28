/**
 * Engine tests (Claude Code). Unit, adversarial and property-based tests for
 * the deterministic extraction engine. All data is synthetic.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  processReport,
  RuleNotActiveError,
  IntegrityError,
  RuleExpressionError,
  LIMITS,
} from "../engine.js";
import type { ExtractionRule, ProcessingResult } from "../types.js";
import { CBC_LINES, cbcRule, activeRecord, report, withLine } from "./fixtures.js";

const HGB = 5; // index of the HGB line in CBC_LINES

function run(lines: readonly string[], rule: ExtractionRule = cbcRule()): ProcessingResult {
  return processReport(report(lines), activeRecord(rule));
}

describe("golden path", () => {
  it("accepts the clean synthetic CBC report with all values and full accounting", () => {
    const r = run(CBC_LINES);
    expect(r.state).toBe("accepted");
    expect(r.aiCallCount).toBe(0);
    expect(r.extractedValues.map((v) => [v.measurementId, v.rawValue, v.unit])).toEqual([
      ["hgb", "13.5", "g/dL"],
      ["wbc", "7.2", "10^3/uL"],
      ["plt", "245", "10^3/uL"],
    ]);
    expect(r.lineAccountingSummary).toMatchObject({
      totalLines: 10,
      extractedLines: 3,
      ignoredLines: 7,
      unexplainedLines: 0,
    });
    expect(r.offendingLines).toBeUndefined();
    expect(r.processedAt).toBe("2026-11-28T10:00:00.000Z");
  });

  it("records provenance pointing at the exact printed characters", () => {
    const r = run(CBC_LINES);
    for (const v of r.extractedValues) {
      const p = v.provenance;
      expect(p.lineContent).toBe(CBC_LINES[p.lineNumber]);
      expect(p.lineContent.slice(p.startOffset, p.endOffset)).toBe(v.rawValue);
    }
  });
});

describe("adversarial: nothing unexplained may pass", () => {
  it("refuses when text is appended to a measurement line (search-vs-full-match bug)", () => {
    const r = run(withLine(CBC_LINES, HGB, CBC_LINES[HGB] + "  HIV REACTIVE"));
    expect(r.state).toBe("refusal");
    expect(r.offendingLines?.[0]).toMatchObject({ lineNumber: HGB, reason: "unexplained" });
    expect(r.lineAccountingSummary.lineBreakdown[HGB]?.classification).toBe("unexplained");
  });

  it("refuses when text is prepended to a header line", () => {
    const r = run(withLine(CBC_LINES, 0, "HIV REACTIVE " + CBC_LINES[0]));
    expect(r.state).toBe("refusal");
  });

  it("refuses an injected foreign line between results", () => {
    const lines = [...CBC_LINES];
    lines.splice(6, 0, "HIV        REACTIVE");
    const r = run(lines);
    expect(r.state).toBe("refusal");
    expect(r.offendingLines?.map((o) => o.lineNumber)).toEqual([6]);
  });

  it.each([
    ["13,5", "locale comma"],
    ["1.35e1", "exponent"],
    ["13.5.1", "two decimal points"],
    ["+13.5", "leading plus"],
    ["13.5*", "marker glued to value"],
    ["ERR", "non-numeric"],
  ])("refuses a tampered value %s (%s) and marks the line unexplained", (bad) => {
    const r = run(withLine(CBC_LINES, HGB, `HGB        ${bad.padEnd(10)}g/dL       12.0-17.5`));
    expect(r.state).toBe("refusal");
    expect(r.offendingLines?.[0]).toMatchObject({ lineNumber: HGB, reason: "tampered-value" });
    expect(r.lineAccountingSummary.lineBreakdown[HGB]).toMatchObject({
      classification: "unexplained",
      reason: "tampered-value",
    });
    expect(r.lineAccountingSummary.extractedLines).toBe(2);
  });

  it("refuses a changed unit (g/L instead of g/dL)", () => {
    const r = run(withLine(CBC_LINES, HGB, "HGB        135       g/L        12.0-17.5"));
    expect(r.state).toBe("refusal");
    expect(r.offendingLines?.[0]).toMatchObject({ reason: "unit-mismatch" });
  });

  it("refuses when a required measurement line is removed (truncation)", () => {
    const lines = CBC_LINES.filter((_, i) => i !== 7);
    const r = run(lines);
    expect(r.state).toBe("refusal");
    expect(r.offendingLines).toEqual([
      expect.objectContaining({ lineNumber: -1, reason: "missing-measurement" }),
    ]);
  });

  it("does not refuse a missing measurement that the rule marks optional", () => {
    const base = cbcRule();
    const rule: ExtractionRule = {
      ...base,
      lineClassifications: base.lineClassifications.map((c) =>
        c.kind === "extract" && c.measurementId === "plt" ? { ...c, required: false } : c,
      ),
    };
    const r = run(CBC_LINES.filter((_, i) => i !== 7), rule);
    expect(r.state).toBe("accepted");
  });

  it("routes a duplicated measurement line to review, never acceptance", () => {
    const lines = [...CBC_LINES];
    lines.splice(6, 0, "HGB        9.1       g/dL       12.0-17.5");
    const r = run(lines);
    expect(r.state).toBe("review");
    expect(r.suspiciousContent?.[0]?.suspicionKind).toBe("duplicate-measurement");
  });

  it("routes an implausible value to review", () => {
    const r = run(withLine(CBC_LINES, HGB, "HGB        135.0     g/dL       12.0-17.5"));
    expect(r.state).toBe("review");
    expect(r.extractedValues[0]?.plausibilityStatus).toBe("out-of-range");
  });

  it("treats range bounds exactly (25 is in range, 25.000001 is not)", () => {
    expect(run(withLine(CBC_LINES, HGB, "HGB        25        g/dL       12.0-17.5")).state).toBe("accepted");
    expect(run(withLine(CBC_LINES, HGB, "HGB        25.000001 g/dL       12.0-17.5")).state).toBe("review");
  });

  it("returns layout-mismatch for a report of another layout", () => {
    const r = run(["BASIC METABOLIC PANEL", "NA 140 mmol/L"]);
    expect(r.state).toBe("layout-mismatch");
    expect(r.extractedValues).toEqual([]);
  });

  it("refuses oversized input without processing it", () => {
    const tooMany = [...CBC_LINES, ...Array.from({ length: LIMITS.maxLines }, () => "")];
    expect(run(tooMany).offendingLines?.[0]?.reason).toBe("input-too-large");
    const longLine = withLine(CBC_LINES, 9, "END OF REPORT" + " ".repeat(LIMITS.maxLineLength));
    const r = run(longLine);
    expect(r.state).toBe("refusal");
    expect(r.extractedValues).toEqual([]);
  });
});

describe("rule integrity guards", () => {
  it("refuses to run a rule that is not active", () => {
    for (const status of ["draft", "validated", "approved", "revoked", "invalidated"] as const) {
      expect(() => processReport(report(CBC_LINES), { ...activeRecord(), status })).toThrow(
        RuleNotActiveError,
      );
    }
  });

  it("refuses when the rule object was edited after approval (hash recomputed)", () => {
    const rec = activeRecord();
    const edited = structuredClone(rec);
    const ex = edited.rule.lineClassifications[5] as { lineMatchExpression: string };
    ex.lineMatchExpression = "HGB.*(?P<value>\\S+) +(?P<unit>\\S+).*";
    expect(() => processReport(report(CBC_LINES), edited)).toThrow(IntegrityError);
  });

  it("refuses when the approval binds a different hash", () => {
    const rec = activeRecord();
    const bad = { ...rec, approvalRecord: { ...rec.approvalRecord!, ruleContentHash: "0".repeat(64) } };
    expect(() => processReport(report(CBC_LINES), bad)).toThrow(IntegrityError);
    const none = { ...rec };
    delete (none as { approvalRecord?: unknown }).approvalRecord;
    expect(() => processReport(report(CBC_LINES), none)).toThrow(IntegrityError);
  });

  it("rejects an extract pattern without the required named groups", () => {
    const base = cbcRule();
    const rule: ExtractionRule = {
      ...base,
      lineClassifications: base.lineClassifications.map((c) =>
        c.kind === "extract" && c.measurementId === "hgb"
          ? { ...c, lineMatchExpression: "HGB +(?P<value>\\S+) +g/dL +12\\.0-17\\.5" }
          : c,
      ),
    };
    expect(() => run(CBC_LINES, rule)).toThrow(RuleExpressionError);
  });

  it("rejects a backtracking-only construct at compile time", () => {
    const base = cbcRule();
    const rule: ExtractionRule = {
      ...base,
      lineClassifications: [{ kind: "ignore", reason: "x", lineMatchExpression: "(a)\\1" }],
    };
    expect(() => run(CBC_LINES, rule)).toThrow(RuleExpressionError);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

/** Lines that cannot be matched by any classification of the CBC rule. */
const foreignLine = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => !/^-{20,}$/.test(s) && !/^\s*$/.test(s) && !CBC_LINES.includes(s));

describe("properties", () => {
  it("P1: inserting any foreign line anywhere prevents acceptance", () => {
    fc.assert(
      fc.property(foreignLine, fc.integer({ min: 0, max: CBC_LINES.length }), (line, at) => {
        const lines = [...CBC_LINES];
        lines.splice(at, 0, line);
        const r = run(lines);
        // A foreign line may only be explained if it IS a valid duplicate row;
        // then the outcome is review. It is never accepted.
        expect(r.state).not.toBe("accepted");
      }),
      { numRuns: 300 },
    );
  });

  it("P1b: appending any non-empty suffix to any line prevents acceptance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: CBC_LINES.length - 1 }),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /\S/.test(s) && !/^-+$/.test(s)),
        (i, suffix) => {
          const r = run(withLine(CBC_LINES, i, CBC_LINES[i] + " " + suffix));
          expect(r.state).not.toBe("accepted");
        },
      ),
      { numRuns: 300 },
    );
  });

  it("P2: processing is deterministic (byte-identical JSON)", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constantFrom(...CBC_LINES), foreignLine), { maxLength: 15 }), (lines) => {
        const all = ["COMPLETE BLOOD COUNT", ...lines];
        expect(JSON.stringify(run(all))).toBe(JSON.stringify(run(all)));
      }),
      { numRuns: 200 },
    );
  });

  it("P3: every line is accounted for exactly once", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constantFrom(...CBC_LINES), foreignLine), { maxLength: 20 }), (lines) => {
        const r = run(["COMPLETE BLOOD COUNT", ...lines]);
        const s = r.lineAccountingSummary;
        expect(s.totalLines).toBe(lines.length + 1);
        expect(s.extractedLines + s.ignoredLines + s.unexplainedLines).toBe(s.totalLines);
        expect(s.lineBreakdown.map((e) => e.lineNumber)).toEqual([...Array(s.totalLines).keys()]);
        if (r.state === "accepted") expect(s.unexplainedLines).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it("P4: every extracted value traces to its exact source characters", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...CBC_LINES), { maxLength: 20 }), (lines) => {
        const all = ["COMPLETE BLOOD COUNT", ...lines];
        const r = run(all);
        for (const v of r.extractedValues) {
          const p = v.provenance;
          expect(all[p.lineNumber]).toBe(p.lineContent);
          expect(p.lineContent.slice(p.startOffset, p.endOffset)).toBe(v.rawValue);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("P5: any accepted value is a plain decimal equal to the printed text", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 9 }).filter((s) => !/\s/.test(s)), (v) => {
        const r = run(withLine(CBC_LINES, HGB, `HGB        ${v} g/dL 12.0-17.5`));
        if (r.state === "accepted") {
          expect(r.extractedValues[0]?.rawValue).toBe(v);
          expect(v).toMatch(/^-?\d{1,9}(\.\d{1,6})?$/);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("P9: aiCallCount is 0 on every outcome", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constantFrom(...CBC_LINES), foreignLine), { maxLength: 15 }), (lines) => {
        expect(run(lines).aiCallCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
