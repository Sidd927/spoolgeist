/**
 * validation-gate.ts — runs a proposed rule against a fixed baseline suite and
 * mutations of the onboarded (synthetic) report. Written by Claude Code from
 * the design's "Validation Architecture" section.
 *
 * The gate never writes to a rule store and never activates anything. It uses
 * evaluateProposal(), which runs the same matching logic as production
 * processing but without lifecycle guards.
 *
 * What the gate shows: the rule refuses or escalates every mutation in this
 * suite, accepts the clean sample, and behaves deterministically.
 * What it does NOT show: see LIMITATIONS_DISCLAIMER (verbatim from the design).
 */
import { evaluateProposal } from "./engine.js";
import { compileExpression, runFullMatch } from "./expression-runner.js";
import { computeRuleHash, sha256Hex } from "./rule-hash.js";
import type {
  ExtractionRule,
  LineClassification,
  ProcessingResult,
  ProcessingState,
  Report,
  ValidationCase,
  ValidationResult,
} from "./types.js";

export const LIMITATIONS_DISCLAIMER =
  "This gate checks the rule against a fixed suite of synthetic test cases. " +
  "It does not prove the rule is correct for all possible reports. " +
  "It does not test against real patient data. " +
  "It does not detect all possible rule authoring errors. " +
  "A passed gate is a necessary condition for activation, not a proof of safety.";

export interface GateInput {
  rule: ExtractionRule;
  /** The synthetic report being onboarded; must be accepted by a correct rule. */
  sampleLines: readonly string[];
  /** Samples of OTHER known layouts; each must be a layout-mismatch (BL-06). */
  otherLayoutSamples?: readonly { layoutId: string; lines: readonly string[] }[];
  /** Supplied by the caller so the gate itself stays deterministic. */
  ranAt: string;
}

export const INJECTED_LINE = "HIV SCREEN           REACTIVE";
export const APPENDED_TEXT = "  HIV REACTIVE";

type Extract = Extract_<LineClassification>;
type Extract_<T> = T extends { kind: "extract" } ? T : never;

export function runValidationGate(input: GateInput): ValidationResult {
  const { rule, sampleLines } = input;
  const contentHash = computeRuleHash(rule);
  const cases: ValidationCase[] = [];
  const results: ProcessingResult[] = [];

  const evaluate = (lines: readonly string[]): ProcessingResult => {
    const r = safeEvaluate(rule, lines);
    results.push(r);
    return r;
  };

  const add = (
    caseId: string,
    caseLabel: string,
    property: string,
    kind: ValidationCase["kind"],
    lines: readonly string[],
    expectedState: ProcessingState,
    extra?: (r: ProcessingResult) => string | null,
  ): ProcessingResult => {
    const r = evaluate(lines);
    let failureDetail: string | null = null;
    if (r.state !== expectedState) {
      failureDetail = `expected ${expectedState}, observed ${r.state}` + (r.resolutionHint?.startsWith("Gate error") ? ` (${r.resolutionHint})` : "");
    } else if (extra) {
      failureDetail = extra(r);
    }
    cases.push({
      caseId,
      caseLabel,
      property,
      kind,
      reportContent: lines.join("\n"),
      passed: failureDetail === null,
      expectedState,
      observedState: r.state,
      observedResult: r,
      ...(failureDetail !== null ? { failureDetail } : {}),
    });
    return r;
  };

  // ---------------- Baseline (layout-agnostic) ----------------
  add("BL-01", "Pure unexplained content is not recognised", "P1", "baseline",
    ["THIS IS NOT A LABORATORY REPORT", "lorem ipsum dolor sit amet", "0000 1111 2222 3333"],
    "layout-mismatch");

  const mid = Math.max(1, Math.floor(sampleLines.length / 2));
  add("BL-02", "One injected foreign line refuses the whole report", "P1", "baseline",
    [...sampleLines.slice(0, mid), INJECTED_LINE, ...sampleLines.slice(mid)], "refusal");

  const clean = safeEvaluate(rule, sampleLines);
  const firstValue = clean.extractedValues[0];
  if (firstValue) {
    add("BL-03", "A value replaced by @@@@ refuses the report", "P1", "baseline",
      replaceSpan(sampleLines, firstValue.provenance.lineNumber, firstValue.provenance.startOffset, firstValue.provenance.endOffset, "@@@@"),
      "refusal");
  }

  add("BL-04", "Processing the same report twice is byte-identical", "P2", "baseline", sampleLines, "accepted",
    (r) => (JSON.stringify(r) === JSON.stringify(safeEvaluate(rule, sampleLines)) ? null : "results differ between runs"));

  add("BL-05", "Every line is accounted for exactly once", "P3", "baseline", sampleLines, "accepted", (r) => {
    const s = r.lineAccountingSummary;
    if (s.totalLines !== sampleLines.length) return "totalLines does not equal the number of lines";
    if (s.extractedLines + s.ignoredLines + s.unexplainedLines !== s.totalLines) return "counts do not sum to total";
    if (s.lineBreakdown.some((e, i) => e.lineNumber !== i)) return "line breakdown is not one entry per line";
    return null;
  });

  for (const other of input.otherLayoutSamples ?? []) {
    if (other.layoutId === rule.layoutId) continue;
    add(`BL-06-${other.layoutId}`, `A ${other.layoutId} report is not mistaken for this layout`, "P1", "baseline",
      other.lines, "layout-mismatch");
  }

  add("BL-07", "Oversized input is refused before any matching", "P12", "baseline",
    [...sampleLines, "X".repeat(5000)], "refusal");

  // ---------------- Layout-specific mutations ----------------
  add("LS-00", "The clean onboarding sample is accepted", "P1", "layout-specific", sampleLines, "accepted", (r) => {
    for (const v of r.extractedValues) {
      const p = v.provenance;
      if (p.lineContent.slice(p.startOffset, p.endOffset) !== v.rawValue) return `provenance mismatch for ${v.measurementId}`;
    }
    return null;
  });

  const extracts = rule.lineClassifications.filter((c): c is Extract => c.kind === "extract");
  for (const ex of extracts) {
    const v = clean.extractedValues.find((x) => x.measurementId === ex.measurementId);
    if (!v) continue; // LS-00 already fails if a required measurement is missing
    const ln = v.provenance.lineNumber;
    const line = sampleLines[ln] ?? "";
    const id = ex.measurementId;

    if (ex.required !== false) {
      add(`LS-${id}-removed`, `${ex.measurementName} line removed (truncation)`, "P1", "layout-specific",
        sampleLines.filter((_, i) => i !== ln), "refusal");
    }
    add(`LS-${id}-nonnumeric`, `${ex.measurementName} value replaced by N/A`, "P1", "layout-specific",
      replaceSpan(sampleLines, ln, v.provenance.startOffset, v.provenance.endOffset, "N/A"), "refusal");
    add(`LS-${id}-appended`, `Text appended to the ${ex.measurementName} line`, "P1", "layout-specific",
      replaceLine(sampleLines, ln, line + APPENDED_TEXT), "refusal");
    add(`LS-${id}-duplicated`, `${ex.measurementName} line printed twice with another value`, "P1", "layout-specific",
      insertAfter(sampleLines, ln, line), "review");
    if (ex.plausibleRange) {
      const big = outOfRangeLike(v.rawValue, ex.plausibleRange.max);
      add(`LS-${id}-implausible`, `${ex.measurementName} = ${big} (above plausible maximum)`, "P5", "layout-specific",
        replaceSpan(sampleLines, ln, v.provenance.startOffset, v.provenance.endOffset, big), "review");
    }
    if (ex.expectedUnit !== undefined) {
      const span = unitSpan(ex, line);
      if (span) {
        add(`LS-${id}-unit`, `${ex.measurementName} unit changed from ${ex.expectedUnit} to XX`, "P1", "layout-specific",
          replaceSpan(sampleLines, ln, span.start, span.end, "XX"), "refusal");
      }
    }
  }

  // Text appended to every NON-measurement line: catches over-broad patterns
  // such as ".*" on headers, which would let arbitrary content ride along.
  sampleLines.forEach((line, i) => {
    if (clean.lineAccountingSummary.lineBreakdown[i]?.classification === "extracted") return;
    add(`LS-line${i + 1}-appended`, `Text appended to line ${i + 1} (${describeLine(line)})`, "P1", "layout-specific",
      replaceLine(sampleLines, i, line + APPENDED_TEXT), "refusal");
  });

  // BL-08 last: no evaluation in this run made an AI call.
  const aiCalls = results.reduce((n, r) => n + r.aiCallCount, 0);
  cases.push({
    caseId: "BL-08",
    caseLabel: "No AI calls during any deterministic processing in this run",
    property: "P9",
    kind: "baseline",
    reportContent: sampleLines.join("\n"),
    passed: aiCalls === 0,
    expectedState: "accepted",
    observedState: clean.state,
    observedResult: clean,
    ...(aiCalls === 0 ? {} : { failureDetail: `aiCallCount total ${aiCalls}` }),
  });

  return {
    runId: "run-" + sha256Hex(contentHash + "|" + input.ranAt).slice(0, 12),
    ruleContentHash: contentHash,
    ranAt: input.ranAt,
    passed: cases.every((c) => c.passed),
    cases,
    limitations: LIMITATIONS_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------

function toReport(lines: readonly string[]): Report {
  return {
    id: "gate-case",
    submittedAt: "1970-01-01T00:00:00.000Z",
    content: lines.join("\n"),
    lines,
    sourceLabel: "validation gate (synthetic mutation)",
  };
}

/** Runs the proposal; a rule error becomes a failed (refusal-shaped) result, never an exception. */
function safeEvaluate(rule: ExtractionRule, lines: readonly string[]): ProcessingResult {
  try {
    return evaluateProposal(toReport(lines), rule);
  } catch (e) {
    return {
      reportId: "gate-case",
      processedAt: "1970-01-01T00:00:00.000Z",
      state: "refusal",
      aiCallCount: 0,
      extractedValues: [],
      lineAccountingSummary: {
        totalLines: lines.length,
        extractedLines: 0,
        ignoredLines: 0,
        unexplainedLines: lines.length,
        lineBreakdown: lines.map((content, i) => ({ lineNumber: i, content, classification: "unexplained" as const })),
      },
      offendingLines: [{ lineNumber: -1, content: "", reason: "unexplained", detail: (e as Error).message }],
      resolutionHint: "Gate error: " + (e as Error).message,
    };
  }
}

function replaceLine(lines: readonly string[], i: number, value: string): string[] {
  const out = [...lines];
  out[i] = value;
  return out;
}
function insertAfter(lines: readonly string[], i: number, value: string): string[] {
  const out = [...lines];
  out.splice(i + 1, 0, value);
  return out;
}
function replaceSpan(lines: readonly string[], i: number, start: number, end: number, value: string): string[] {
  const line = lines[i] ?? "";
  // Keep column alignment where possible by absorbing/adding spaces after the value.
  const after = line.slice(end);
  const gap = /^ */.exec(after)![0].length;
  const delta = value.length - (end - start);
  let rest = after;
  if (delta > 0 && gap > 1) rest = after.slice(Math.min(delta, gap - 1));
  else if (delta < 0 && gap > 0) rest = " ".repeat(-delta) + after;
  return replaceLine(lines, i, line.slice(0, start) + value + rest);
}

/** A value above `max` with the same number of fractional digits as `printed`. */
export function outOfRangeLike(printed: string, max: number): string {
  const frac = printed.includes(".") ? printed.split(".")[1]!.length : 0;
  const int = String(Math.floor(Math.abs(max)) * 10 + 9);
  return frac > 0 ? int + "." + "0".repeat(frac) : int;
}

function unitSpan(ex: Extract, line: string): { start: number; end: number } | null {
  try {
    const m = runFullMatch(compileExpression(ex.lineMatchExpression), line);
    const u = m?.groupOffsets.unit;
    return u && u.start >= 0 ? u : null;
  } catch {
    return null;
  }
}

function describeLine(line: string): string {
  const t = line.trim();
  if (t === "") return "blank line";
  return JSON.stringify(t.length > 28 ? t.slice(0, 28) + "…" : t);
}
