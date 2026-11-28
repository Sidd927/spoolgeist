/**
 * Shared SYNTHETIC test fixtures (Claude Code). No real patient data.
 */
import { computeRuleHash } from "../rule-hash.js";
import type { ExtractionRule, Report, RuleRecord } from "../types.js";

export const CBC_LINES: readonly string[] = [
  "ST. ELSEWHERE GENERAL - CLINICAL LABORATORY",
  "COMPLETE BLOOD COUNT                 *** SYNTHETIC ***",
  "PATIENT ID: SYN-00417       COLLECTED: 2026-11-02 08:14",
  "------------------------------------------------------",
  "TEST       RESULT    UNIT       REF RANGE",
  "HGB        13.5      g/dL       12.0-17.5",
  "WBC        7.2       10^3/uL    4.0-11.0",
  "PLT        245       10^3/uL    150-450",
  "------------------------------------------------------",
  "END OF REPORT",
];

export function cbcRule(overrides: Partial<ExtractionRule> = {}): ExtractionRule {
  return {
    ruleId: "rule-cbc-v1",
    layoutId: "cbc",
    layoutName: "Complete Blood Count",
    layoutVersion: 1,
    layoutMatchExpression: "COMPLETE BLOOD COUNT",
    lineClassifications: [
      { kind: "header", lineMatchExpression: "ST\\. ELSEWHERE GENERAL - CLINICAL LABORATORY" },
      { kind: "header", lineMatchExpression: "COMPLETE BLOOD COUNT +\\*\\*\\* SYNTHETIC \\*\\*\\*" },
      {
        kind: "ignore",
        reason: "patient identifier and collection time (not extracted in this demo)",
        lineMatchExpression: "PATIENT ID: SYN-\\d{5} +COLLECTED: \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}",
      },
      { kind: "ignore", reason: "rule line", lineMatchExpression: "-{20,}" },
      { kind: "header", lineMatchExpression: "TEST +RESULT +UNIT +REF RANGE" },
      {
        kind: "extract",
        measurementId: "hgb",
        measurementName: "Hemoglobin",
        lineMatchExpression: "HGB +(?P<value>\\S+) +(?P<unit>\\S+) +12\\.0-17\\.5",
        expectedUnit: "g/dL",
        plausibleRange: { min: 3, max: 25 },
      },
      {
        kind: "extract",
        measurementId: "wbc",
        measurementName: "White blood cells",
        lineMatchExpression: "WBC +(?P<value>\\S+) +(?P<unit>\\S+) +4\\.0-11\\.0",
        expectedUnit: "10^3/uL",
        plausibleRange: { min: 0.1, max: 200 },
      },
      {
        kind: "extract",
        measurementId: "plt",
        measurementName: "Platelets",
        lineMatchExpression: "PLT +(?P<value>\\S+) +(?P<unit>\\S+) +150-450",
        expectedUnit: "10^3/uL",
        plausibleRange: { min: 1, max: 2000 },
      },
      { kind: "footer", lineMatchExpression: "END OF REPORT" },
    ],
    plausibilityChecks: [],
    metadata: { createdAt: "2026-11-28T00:00:00.000Z", draftedBy: "operator" },
    ...overrides,
  };
}

/** An ACTIVE record whose content hash and approval are consistent. */
export function activeRecord(rule: ExtractionRule = cbcRule()): RuleRecord {
  const contentHash = computeRuleHash(rule);
  return {
    rule,
    contentHash,
    status: "active",
    validationRunId: "run-test",
    approvalRecord: {
      approvedAt: "2026-11-28T00:00:00.000Z",
      approvedBy: "Test Reviewer",
      ruleContentHash: contentHash,
      validationRunId: "run-test",
      scopeStatement: "test",
    },
    history: [],
  };
}

export function report(lines: readonly string[], id = "rep-1"): Report {
  return {
    id,
    submittedAt: "2026-11-28T10:00:00.000Z",
    content: lines.join("\n"),
    lines,
    sourceLabel: "synthetic test",
  };
}

export function withLine(lines: readonly string[], index: number, value: string): string[] {
  const out = [...lines];
  out[index] = value;
  return out;
}
