/** Validation gate tests (Claude Code). */
import { describe, it, expect } from "vitest";
import { runValidationGate, LIMITATIONS_DISCLAIMER, outOfRangeLike } from "../validation-gate.js";
import { computeRuleHash } from "../rule-hash.js";
import type { ExtractionRule, LineClassification } from "../types.js";
import { CBC_LINES, cbcRule } from "./fixtures.js";

const BMP = ["BASIC METABOLIC PANEL  *** SYNTHETIC ***", "NA   140  mmol/L", "END OF REPORT"];
const ranAt = "2026-11-28T12:00:00.000Z";

function gate(rule: ExtractionRule) {
  return runValidationGate({ rule, sampleLines: CBC_LINES, otherLayoutSamples: [{ layoutId: "bmp", lines: BMP }], ranAt });
}
function mapClass(rule: ExtractionRule, f: (c: LineClassification) => LineClassification): ExtractionRule {
  return { ...rule, lineClassifications: rule.lineClassifications.map(f) };
}

describe("validation gate", () => {
  it("passes a strict, correct rule with full evidence", () => {
    const r = gate(cbcRule());
    const failed = r.cases.filter((c) => !c.passed);
    expect(failed).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.ruleContentHash).toBe(computeRuleHash(cbcRule())); // P8
    expect(r.limitations).toBe(LIMITATIONS_DISCLAIMER);
    const ids = r.cases.map((c) => c.caseId);
    for (const id of ["BL-01", "BL-02", "BL-03", "BL-04", "BL-05", "BL-06-bmp", "BL-07", "BL-08", "LS-00",
      "LS-hgb-removed", "LS-hgb-nonnumeric", "LS-hgb-appended", "LS-hgb-duplicated", "LS-hgb-implausible", "LS-hgb-unit"]) {
      expect(ids).toContain(id);
    }
    expect(r.cases.length).toBeGreaterThan(25);
  });

  it("is deterministic for the same input", () => {
    expect(JSON.stringify(gate(cbcRule()))).toBe(JSON.stringify(gate(cbcRule())));
  });

  it("fails a rule with a catch-all ignore line (would hide injected content)", () => {
    const base = cbcRule();
    const loose = { ...base, lineClassifications: [...base.lineClassifications, { kind: "ignore" as const, reason: "anything else", lineMatchExpression: ".*" }] };
    const r = gate(loose);
    expect(r.passed).toBe(false);
    expect(r.cases.find((c) => c.caseId === "BL-02")).toMatchObject({ passed: false, observedState: "accepted" });
  });

  it("fails a rule whose measurement pattern tolerates trailing text", () => {
    const loose = mapClass(cbcRule(), (c) =>
      c.kind === "extract" && c.measurementId === "hgb" ? { ...c, lineMatchExpression: "HGB +(?P<value>\\S+) +(?P<unit>\\S+) +12\\.0-17\\.5.*" } : c);
    const r = gate(loose);
    expect(r.passed).toBe(false);
    expect(r.cases.find((c) => c.caseId === "LS-hgb-appended")?.passed).toBe(false);
  });

  it("fails a rule whose header pattern is over-broad", () => {
    const loose = mapClass(cbcRule(), (c) => (c.kind === "footer" ? { ...c, lineMatchExpression: "END OF REPORT.*" } : c));
    const r = gate(loose);
    expect(r.passed).toBe(false);
    expect(r.cases.find((c) => c.caseId === "LS-line10-appended")?.passed).toBe(false);
  });

  it("fails a rule whose layout matcher claims every report", () => {
    const r = gate({ ...cbcRule(), layoutMatchExpression: "" });
    expect(r.cases.find((c) => c.caseId === "BL-01")?.passed).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("fails (does not throw) on a rule with an invalid pattern", () => {
    const bad = mapClass(cbcRule(), (c) => (c.kind === "footer" ? { ...c, lineMatchExpression: "(END)\\1" } : c));
    const r = gate(bad);
    expect(r.passed).toBe(false);
    expect(r.cases.find((c) => c.caseId === "LS-00")?.failureDetail).toMatch(/Gate error/);
  });

  it("has no unit case when the rule declares no expected unit (documented limitation)", () => {
    const noUnit = mapClass(cbcRule(), (c) =>
      c.kind === "extract" ? { kind: "extract", measurementId: c.measurementId, measurementName: c.measurementName, lineMatchExpression: c.lineMatchExpression } : c);
    const r = gate(noUnit);
    // Without expectedUnit there is no unit-change case; the gate cannot catch
    // what the rule does not declare. This is a documented limitation.
    expect(r.cases.some((c) => c.caseId.endsWith("-unit"))).toBe(false);
  });

  it("builds out-of-range values with the printed precision", () => {
    expect(outOfRangeLike("13.5", 25)).toBe("259.0");
    expect(outOfRangeLike("245", 2000)).toBe("20009");
  });
});
