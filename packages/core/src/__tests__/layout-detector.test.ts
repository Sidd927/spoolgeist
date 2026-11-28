/**
 * Tests for layout-detector.ts — pure-function layout identification.
 *
 * Requirement 9.2: a Report may only be accepted as supported when its Layout
 * matches an *active approved* Extraction Rule's layout condition.
 */

import { describe, it, expect } from "vitest";

import { detectLayout } from "../layout-detector.js";
import type { Report, RuleRecord, ExtractionRule } from "../types.js";

// ---------------------------------------------------------------------------
// Test fixtures — minimal valid objects for building rules and reports
// ---------------------------------------------------------------------------

/** Minimal ExtractionRule factory. layoutMatchExpression is the key field. */
function makeRule(
  overrides: Partial<ExtractionRule> = {},
): ExtractionRule {
  return {
    ruleId: "rule-000",
    layoutId: "layout-x",
    layoutName: "Layout X",
    layoutVersion: 1,
    layoutMatchExpression: "PATIENT REPORT",
    lineClassifications: [],
    plausibilityChecks: [],
    metadata: {
      createdAt: "2026-11-27T00:00:00.000Z",
      draftedBy: "operator",
    },
    ...overrides,
  };
}

/** Minimal RuleRecord factory. status is the key field. */
function makeRecord(
  rule: ExtractionRule,
  status: RuleRecord["status"] = "active",
): RuleRecord {
  return {
    rule,
    contentHash: `hash-for-${rule.ruleId}`,
    status,
    history: [],
  };
}

/** Minimal Report factory. */
function makeReport(content: string, lines?: string[]): Report {
  return {
    id: "report-000",
    submittedAt: "2026-11-27T12:00:00.000Z",
    content,
    lines: lines ?? content.split("\n"),
    sourceLabel: "Test report",
  };
}

// A report whose text contains the CBC marker.
const CBC_TEXT = [
  "SYNTHETIC LAB — DEMO",
  "PATIENT REPORT: CBC PANEL",
  "WBC    5.2 10^3/uL",
  "RBC    4.7 10^6/uL",
].join("\n");

// A report whose text contains the BMP marker.
const BMP_TEXT = [
  "SYNTHETIC LAB — DEMO",
  "PATIENT REPORT: METABOLIC PANEL",
  "Glucose   92 mg/dL",
].join("\n");

// A report that matches neither marker.
const UNRELATED_TEXT = ["Random document", "with no lab markers"].join("\n");

// A minimal report (edge case: single line).
const SINGLE_LINE_TEXT = "PATIENT REPORT: CBC PANEL";

// ---------------------------------------------------------------------------
// Section 1: Required task 4.2 unit tests
// ---------------------------------------------------------------------------

describe("detectLayout — required unit tests", () => {
  it("returns the matching rule when the report matches the first rule", () => {
    const cbcRule = makeRule({ ruleId: "rule-cbc", layoutId: "cbc-panel-v1" });
    const record = makeRecord(cbcRule);
    const report = makeReport(CBC_TEXT);

    const result = detectLayout(report, [record]);
    expect(result).toBe(record);
  });

  it("returns null when no rule matches", () => {
    const cbcRule = makeRule({ ruleId: "rule-cbc", layoutId: "cbc-panel-v1" });
    const record = makeRecord(cbcRule);
    const report = makeReport(UNRELATED_TEXT);

    const result = detectLayout(report, [record]);
    expect(result).toBeNull();
  });

  it("returns the first matching rule when multiple rules match (order matters)", () => {
    const first = makeRecord(
      makeRule({ ruleId: "rule-first", layoutId: "layout-first" }),
    );
    const second = makeRecord(
      makeRule({ ruleId: "rule-second", layoutId: "layout-second" }),
    );
    // Both expressions match CBC_TEXT, so the array order determines the winner.
    const report = makeReport(CBC_TEXT);

    const result = detectLayout(report, [first, second]);
    expect(result).toBe(first);

    // Reversed order: second now comes first, so it wins.
    const resultReversed = detectLayout(report, [second, first]);
    expect(resultReversed).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Status filtering — only "active" rules may match
// ---------------------------------------------------------------------------

describe("detectLayout — status filtering (Requirement 9.2)", () => {
  const nonActiveStatuses: Array<Exclude<RuleRecord["status"], "active">> = [
    "draft",
    "validation-failed",
    "validated",
    "approved",
    "invalidated",
    "revoked",
  ];

  for (const status of nonActiveStatuses) {
    it(`ignores a rule with status "${status}" even when its expression matches`, () => {
      const rule = makeRule({ ruleId: `rule-${status}` });
      const record = makeRecord(rule, status);
      const report = makeReport(CBC_TEXT);

      const result = detectLayout(report, [record]);
      expect(result).toBeNull();
    });
  }

  it("matches an active rule even when earlier non-active rules would also match", () => {
    const draftRecord = makeRecord(
      makeRule({ ruleId: "rule-draft" }),
      "draft",
    );
    const activeRecord = makeRecord(
      makeRule({ ruleId: "rule-active" }),
      "active",
    );
    const report = makeReport(CBC_TEXT);

    const result = detectLayout(report, [draftRecord, activeRecord]);
    expect(result).toBe(activeRecord);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Matching semantics
// ---------------------------------------------------------------------------

describe("detectLayout — matching semantics", () => {
  it("matches on an unanchored partial match (expression matches mid-text)", () => {
    // The expression matches text appearing on line 2, not the whole report.
    const rule = makeRule({
      ruleId: "rule-partial",
      layoutMatchExpression: "CBC PANEL",
    });
    const record = makeRecord(rule);
    const report = makeReport(CBC_TEXT);

    const result = detectLayout(report, [record]);
    expect(result).toBe(record);
  });

  it("matches a single-line report", () => {
    const record = makeRecord(makeRule({ ruleId: "rule-single" }));
    const report = makeReport(SINGLE_LINE_TEXT);

    const result = detectLayout(report, [record]);
    expect(result).toBe(record);
  });

  it("does not match when the expression requires text absent from the report", () => {
    const rule = makeRule({
      ruleId: "rule-bmp",
      layoutMatchExpression: "METABOLIC PANEL",
    });
    const record = makeRecord(rule);
    const report = makeReport(CBC_TEXT);

    const result = detectLayout(report, [record]);
    expect(result).toBeNull();
  });

  it("distinguishes between layouts in a mixed rule set", () => {
    const cbcRecord = makeRecord(
      makeRule({
        ruleId: "rule-cbc",
        layoutMatchExpression: "CBC PANEL",
      }),
    );
    const bmpRecord = makeRecord(
      makeRule({
        ruleId: "rule-bmp",
        layoutMatchExpression: "METABOLIC PANEL",
      }),
    );

    expect(detectLayout(makeReport(CBC_TEXT), [cbcRecord, bmpRecord])).toBe(
      cbcRecord,
    );
    expect(detectLayout(makeReport(BMP_TEXT), [cbcRecord, bmpRecord])).toBe(
      bmpRecord,
    );
  });

  it("matches distinct reports against the correct rule in a multi-rule set", () => {
    const cbcRecord = makeRecord(
      makeRule({ ruleId: "rule-cbc", layoutMatchExpression: "CBC PANEL" }),
    );
    const bmpRecord = makeRecord(
      makeRule({ ruleId: "rule-bmp", layoutMatchExpression: "METABOLIC PANEL" }),
    );
    const lipidRecord = makeRecord(
      makeRule({ ruleId: "rule-lipid", layoutMatchExpression: "LIPID PANEL" }),
    );

    const rules = [cbcRecord, bmpRecord, lipidRecord];
    const cbcReport = makeReport(CBC_TEXT);
    const bmpReport = makeReport(BMP_TEXT);
    const unknownReport = makeReport(UNRELATED_TEXT);

    expect(detectLayout(cbcReport, rules)).toBe(cbcRecord);
    expect(detectLayout(bmpReport, rules)).toBe(bmpRecord);
    expect(detectLayout(unknownReport, rules)).toBeNull();
  });

  it("treats regex metacharacters in the expression as RE2 syntax, not literals", () => {
    // An expression using alternation to match either marker.
    const rule = makeRule({
      ruleId: "rule-alt",
      layoutMatchExpression: "(CBC|METABOLIC) PANEL",
    });
    const record = makeRecord(rule);

    expect(detectLayout(makeReport(CBC_TEXT), [record])).toBe(record);
    expect(detectLayout(makeReport(BMP_TEXT), [record])).toBe(record);
    expect(detectLayout(makeReport(UNRELATED_TEXT), [record])).toBeNull();
  });

  it("returns null for an empty rules list", () => {
    const report = makeReport(CBC_TEXT);
    expect(detectLayout(report, [])).toBeNull();
  });

  it("returns null for an empty report (no lines)", () => {
    const record = makeRecord(makeRule({ ruleId: "rule-any" }));
    const report = makeReport("", [""]);
    const result = detectLayout(report, [record]);
    expect(result).toBeNull();
  });

  it("returns null for an empty report against a rules list that is also empty", () => {
    const report = makeReport("", [""]);
    expect(detectLayout(report, [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 4: Determinism and purity
// ---------------------------------------------------------------------------

describe("detectLayout — determinism and purity", () => {
  it("returns identical results across repeated invocations (determinism)", () => {
    const cbcRecord = makeRecord(
      makeRule({ ruleId: "rule-cbc", layoutMatchExpression: "CBC PANEL" }),
    );
    const bmpRecord = makeRecord(
      makeRule({ ruleId: "rule-bmp", layoutMatchExpression: "METABOLIC PANEL" }),
    );
    const report = makeReport(CBC_TEXT);
    const rules = [cbcRecord, bmpRecord];

    const r1 = detectLayout(report, rules);
    const r2 = detectLayout(report, rules);
    const r3 = detectLayout(report, rules);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(r1).toBe(cbcRecord);
  });

  it("does not mutate the input report or rules (purity)", () => {
    const rule = makeRule({ ruleId: "rule-cbc" });
    const record = makeRecord(rule);
    const report = makeReport(CBC_TEXT);

    const reportBefore = JSON.stringify(report);
    const rulesBefore = JSON.stringify([record]);

    detectLayout(report, [record]);

    expect(JSON.stringify(report)).toBe(reportBefore);
    expect(JSON.stringify([record])).toBe(rulesBefore);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Error propagation — corrupted rule expressions
// ---------------------------------------------------------------------------

describe("detectLayout — error propagation", () => {
  it("propagates RE2JSSyntaxException for an active rule with an invalid expression", () => {
    // A backreference in an active rule's expression is rule-store corruption:
    // the validation gate should have rejected it before activation.
    const rule = makeRule({
      ruleId: "rule-corrupt",
      layoutMatchExpression: "(\\w+)\\1", // backreference — invalid RE2
    });
    const record = makeRecord(rule, "active");
    const report = makeReport(CBC_TEXT);

    expect(() => detectLayout(report, [record])).toThrow();
  });

  it("does not throw when a *non-active* rule has an invalid expression (filtered before compile)", () => {
    const draftRecord = makeRecord(
      makeRule({
        ruleId: "rule-draft-bad",
        layoutMatchExpression: "(?=bad)", // lookahead — invalid RE2
      }),
      "draft",
    );
    const activeRecord = makeRecord(
      makeRule({ ruleId: "rule-good", layoutMatchExpression: "CBC PANEL" }),
      "active",
    );
    const report = makeReport(CBC_TEXT);

    const result = detectLayout(report, [draftRecord, activeRecord]);
    expect(result).toBe(activeRecord);
  });
});
