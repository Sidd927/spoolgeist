/**
 * engine.ts — The Deterministic Extraction Engine.
 *
 * The most safety-critical module in Spoolgeist. Executes an *active, approved*
 * ExtractionRule against a Report and produces a ProcessingResult.
 *
 * Core thesis enforced here:
 *   - Pure function of (Report, RuleRecord) — no AI, no network, no clock
 *     dependence, no randomness. Identical inputs produce byte-identical
 *     results (Property 2).
 *   - Every line is accounted for: extracted, ignored, or unexplained
 *     (Property 3). Unexplained content blocks acceptance (Property 1).
 *   - No partial extraction is ever presented as complete: unexplained
 *     lines -> Refusal; ambiguous/suspicious values -> Review; only fully
 *     explained, plausible content -> Accepted.
 *   - aiCallCount is the literal 0 on every return path (Property 9).
 *
 * Determinism note on timestamps: ProcessingResult.processedAt is derived
 * from report.submittedAt (an input), NOT wall-clock time. This is what
 * makes repeat-processing byte-identical. The timestamp answers "when was
 * this report submitted", which is the only time the engine can speak to
 * without becoming non-deterministic.
 */

import {
  compileExpression,
  runExpression,
  ExpressionTimeoutError,
  RE2JSSyntaxException,
  type CompiledExpression,
  type MatchResult,
} from "./expression-runner.js";
import { detectLayout } from "./layout-detector.js";
import type {
  ExtractedValue,
  LineAccountingSummary,
  LineClassification,
  LineEntry,
  OffendingLine,
  PlausibilityCheck,
  ProcessingResult,
  Provenance,
  Report,
  RuleRecord,
  SuspiciousItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when processReport is called with a non-active rule. */
export class RuleNotActiveError extends Error {
  constructor(status: string) {
    super(
      "Cannot process a report under a rule that is not active (status: " +
        JSON.stringify(status) +
        "). Only active, approved rules may process reports.",
    );
    this.name = "RuleNotActiveError";
  }
}

/** Thrown when the rule's content hash does not match its approval record. */
export class IntegrityError extends Error {
  constructor(storedHash: string, approvalHash: string) {
    super(
      "Rule integrity failure: contentHash (" +
        storedHash.slice(0, 12) +
        "...) does not match approvalRecord.ruleContentHash (" +
        approvalHash.slice(0, 12) +
        "...). The rule was modified after approval or the store is corrupted.",
    );
    this.name = "IntegrityError";
  }
}

/** Thrown when an extraction expression in an active rule is invalid RE2. */
export class RuleExpressionError extends Error {
  constructor(field: string, pattern: string, cause: unknown) {
    super(
      'Active rule contains invalid expression in "' +
        field +
        '": "' +
        pattern.slice(0, 60) +
        '" (' +
        (cause instanceof Error ? cause.message : String(cause)) +
        ")",
    );
    this.name = "RuleExpressionError";
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Result of classifying one report line. */
interface LineOutcome {
  entry: LineEntry;
}

/** A compiled extract classification with its compiled expressions. */
interface CompiledExtract {
  cls: Extract<LineClassification, { kind: "extract" }>;
  lineCompiled: CompiledExpression;
  valueCompiled: CompiledExpression;
  unitCompiled: CompiledExpression | undefined;
  index: number;
}

/** A compiled non-extract classification. */
interface CompiledOther {
  cls: Exclude<LineClassification, { kind: "extract" }>;
  lineCompiled: CompiledExpression;
  classificationId: string;
  index: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Processes a Report under the given active approved rule.
 *
 * @param report The submitted report.
 * @param ruleRecord The rule record to process under. MUST be status "active"
 *                   with a matching approval hash — enforced inside.
 * @returns A complete ProcessingResult in one of four states:
 *          accepted, refusal, review, or layout-mismatch.
 *
 * @throws {RuleNotActiveError} if ruleRecord.status !== "active".
 * @throws {IntegrityError} if the rule's hash doesn't match its approval.
 * @throws {RuleExpressionError} if the rule contains invalid RE2 expressions.
 */
export function processReport(
  report: Report,
  ruleRecord: RuleRecord,
): ProcessingResult {
  // --- Guard 1: only active rules may process ------------------------------
  if (ruleRecord.status !== "active") {
    throw new RuleNotActiveError(ruleRecord.status);
  }

  // --- Guard 2: approval hash must bind to the exact current rule ----------
  const approval = ruleRecord.approvalRecord;
  if (!approval || approval.ruleContentHash !== ruleRecord.contentHash) {
    // A missing approvalRecord on an "active" rule is an integrity failure:
    // the lifecycle contract requires an approval for activation.
    throw new IntegrityError(
      ruleRecord.contentHash,
      approval?.ruleContentHash ?? "<missing approval record>",
    );
  }

  // --- Guard 3: the report must match this rule's layout -------------------
  let matched: RuleRecord | null;
  try {
    matched = detectLayout(report, [ruleRecord]);
  } catch (e) {
    if (e instanceof RE2JSSyntaxException) {
      throw new RuleExpressionError(
        "layoutMatchExpression",
        ruleRecord.rule.layoutMatchExpression,
        e,
      );
    }
    throw e;
  }

  if (matched === null) {
    return mismatchResult(report, ruleRecord);
  }

  // --- Compile all classification expressions up front ---------------------
  // Any invalid expression is a rule-integrity error, surfaced BEFORE any
  // partial processing occurs.
  const compiledExtracts: CompiledExtract[] = [];
  const compiledOthers: CompiledOther[] = [];

  ruleRecord.rule.lineClassifications.forEach((cls, index) => {
    if (cls.kind === "extract") {
      const lineCompiled = mustCompile(
        "lineMatchExpression",
        cls.lineMatchExpression,
        index,
      );
      const valueCompiled = mustCompile(
        "valueExpression",
        cls.valueExpression,
        index,
      );
      let unitCompiled: CompiledExpression | undefined;
      if (cls.unitExpression) {
        unitCompiled = mustCompile(
          "unitExpression",
          cls.unitExpression,
          index,
        );
      }
      compiledExtracts.push({
        cls,
        lineCompiled,
        valueCompiled,
        unitCompiled,
        index,
      });
    } else {
      const lineCompiled = mustCompile(
        "lineMatchExpression",
        cls.lineMatchExpression,
        index,
      );
      compiledOthers.push({
        cls,
        lineCompiled,
        classificationId: cls.kind + "[" + index + "]",
        index,
      });
    }
  });

  // Unified ordered list of compiled classifications (preserves rule order).
  const allCompiled: Array<
    | { kind: "extract"; ce: CompiledExtract }
    | { kind: "other"; co: CompiledOther }
  > = [];
  const mergeExtracts = [...compiledExtracts];
  const mergeOthers = [...compiledOthers];
  // Rebuild original order: iterate the rule's classifications and pull
  // from the right compiled list.
  {
    let ei = 0;
    let oi = 0;
    for (const cls of ruleRecord.rule.lineClassifications) {
      if (cls.kind === "extract") {
        allCompiled.push({ kind: "extract", ce: mergeExtracts[ei]! });
        ei++;
      } else {
        allCompiled.push({ kind: "other", co: mergeOthers[oi]! });
        oi++;
      }
    }
  }

  // --- Classification phase: every line must be accounted for -------------
  const outcomes: LineOutcome[] = [];
  const extractedValues: ExtractedValue[] = [];
  const offendingLines: OffendingLine[] = [];
  const suspiciousItems: SuspiciousItem[] = [];
  const seenMeasurementLines = new Map<string, number[]>();

  for (let lineNumber = 0; lineNumber < report.lines.length; lineNumber++) {
    const lineContent = report.lines[lineNumber] ?? "";

    // First matching classification wins for this line.
    let winner:
      | { kind: "extract"; ce: CompiledExtract }
      | { kind: "other"; co: CompiledOther }
      | undefined;

    for (const candidate of allCompiled) {
      let lineMatch: MatchResult | null;
      try {
        lineMatch = runExpression(
          candidate.kind === "extract"
            ? candidate.ce.lineCompiled
            : candidate.co.lineCompiled,
          lineContent,
        );
      } catch (e) {
        if (e instanceof ExpressionTimeoutError) {
          return timeoutRefusal(
            report,
            ruleRecord,
            lineNumber,
            e as ExpressionTimeoutError,
          );
        }
        throw e;
      }
      if (lineMatch !== null) {
        winner = candidate;
        break;
      }
    }

    if (winner === undefined) {
      // Unexplained content: record it; the report cannot be accepted.
      offendingLines.push({
        lineNumber,
        content: lineContent,
        reason: "unexplained",
        detail:
          "This line is not covered by any classification in the active rule. " +
          "It cannot be accounted for, so the report cannot be accepted.",
      });
      outcomes.push({
        entry: {
          lineNumber,
          content: lineContent,
          classification: "unexplained",
        },
      });
      continue;
    }

    if (winner.kind === "extract") {
      const ce = winner.ce;
      const outcome = applyExtract(
        ce,
        report,
        lineNumber,
        lineContent,
        extractedValues,
        seenMeasurementLines,
        suspiciousItems,
        offendingLines,
      );
      outcomes.push({ entry: outcome });
    } else {
      const co = winner.co;
      // header / footer / ignore all count as "ignored" in accounting.
      outcomes.push({
        entry: {
          lineNumber,
          content: lineContent,
          classification: "ignored",
          classificationId: co.classificationId,
        },
      });
    }
  }

  // --- Line accounting invariant (Property 3) -------------------------------
  const summary = buildSummary(outcomes, report.lines.length);

  // --- Unexplained content blocks acceptance (Property 1) -------------------
  if (summary.unexplainedLines > 0) {
    return {
      reportId: report.id,
      processedAt: report.submittedAt,
      state: "refusal",
      ruleId: ruleRecord.rule.ruleId,
      ruleContentHash: ruleRecord.contentHash,
      aiCallCount: 0,
      extractedValues,
      lineAccountingSummary: summary,
      offendingLines,
      resolutionHint:
        "The report contains line(s) not covered by the active rule. " +
        "Review the highlighted lines: either the rule needs to classify " +
        "them, or this report is from a different or tampered source.",
    };
  }

  // --- Plausibility phase ----------------------------------------------------
  runPlausibilityChecks(
    extractedValues,
    ruleRecord.rule.plausibilityChecks,
    suspiciousItems,
  );

  // --- Duplicate measurement check (ambiguous -> Review) --------------------
  for (const [measurementId, lineNumbers] of seenMeasurementLines) {
    if (lineNumbers.length > 1) {
      const dupLine = lineNumbers[1] ?? lineNumbers[0] ?? 0;
      suspiciousItems.push({
        lineNumber: dupLine,
        content: report.lines[dupLine] ?? "",
        suspicionKind: "duplicate-measurement",
        detail:
          'Measurement "' +
          measurementId +
          '" appears on lines ' +
          lineNumbers.map((n) => n + 1).join(", ") +
          " (1-indexed). Which value is authoritative is ambiguous and " +
          "requires human review.",
      });
    }
  }

  // --- Suspicious content routes to Review, never Accepted ------------------
  if (suspiciousItems.length > 0) {
    return {
      reportId: report.id,
      processedAt: report.submittedAt,
      state: "review",
      ruleId: ruleRecord.rule.ruleId,
      ruleContentHash: ruleRecord.contentHash,
      aiCallCount: 0,
      extractedValues,
      lineAccountingSummary: summary,
      suspiciousContent: suspiciousItems,
      resolutionHint:
        "One or more values are ambiguous, out of range, or mutually " +
        "inconsistent. A human must confirm them before they can be " +
        "treated as verified results.",
    };
  }

  // --- Accepted -------------------------------------------------------------
  return {
    reportId: report.id,
    processedAt: report.submittedAt,
    state: "accepted",
    ruleId: ruleRecord.rule.ruleId,
    ruleContentHash: ruleRecord.contentHash,
    aiCallCount: 0,
    extractedValues,
    lineAccountingSummary: summary,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mustCompile(
  field: string,
  pattern: string,
  index: number,
): CompiledExpression {
  try {
    return compileExpression(pattern);
  } catch (e) {
    throw new RuleExpressionError(
      "lineClassifications[" + index + "]." + field,
      pattern,
      e,
    );
  }
}

/**
 * Applies an extract classification to a line that already matched its
 * lineMatchExpression. Runs valueExpression (and optional unitExpression),
 * builds the ExtractedValue with full provenance, and records tampered-value
 * offenders when no value can be extracted.
 */
function applyExtract(
  ce: CompiledExtract,
  report: Report,
  lineNumber: number,
  lineContent: string,
  extractedValues: ExtractedValue[],
  seenMeasurementLines: Map<string, number[]>,
  suspiciousItems: SuspiciousItem[],
  offendingLines: OffendingLine[],
): LineEntry {
  const cls = ce.cls;
  const classificationId = "extract[" + ce.index + "]";
  void report;

  let valueMatch: MatchResult | null;
  try {
    valueMatch = runExpression(ce.valueCompiled, lineContent);
  } catch (e) {
    if (e instanceof ExpressionTimeoutError) {
      throw e; // converted by the caller into a timeout refusal
    }
    throw e;
  }

  // Track the line for duplicate detection regardless of value outcome.
  const lines = seenMeasurementLines.get(cls.measurementId) ?? [];
  lines.push(lineNumber);
  seenMeasurementLines.set(cls.measurementId, lines);

  if (valueMatch === null || valueMatch.namedGroups.value == null) {
    // Line matched lineMatchExpression but valueExpression found no value.
    // This is tampered/invalid content: flag it, never guess.
    offendingLines.push({
      lineNumber,
      content: lineContent,
      reason: "tampered-value",
      detail:
        'Line matched measurement "' +
        cls.measurementName +
        '" but no value could be extracted (valueExpression: "' +
        cls.valueExpression +
        '"). The value may be tampered, missing, or malformed.',
    });
    suspiciousItems.push({
      lineNumber,
      content: lineContent,
      suspicionKind: "tampered-value",
      detail:
        'Measurement "' +
        cls.measurementName +
        '" matched its line pattern but the value pattern found nothing.',
    });
    return {
      lineNumber,
      content: lineContent,
      classification: "extracted",
      classificationId,
    };
  }

  const rawValue = valueMatch.namedGroups.value;

  // Optional unit extraction.
  let unit: string | undefined;
  if (ce.unitCompiled) {
    try {
      const unitMatch = runExpression(ce.unitCompiled, lineContent);
      if (unitMatch !== null && unitMatch.namedGroups.unit != null) {
        unit = unitMatch.namedGroups.unit;
      }
    } catch {
      // Unit extraction failure is not fatal: the value is still valid.
      // The unit simply remains undefined.
    }
  }

  const numericValue = parseNumeric(rawValue);

  let plausibilityStatus: ExtractedValue["plausibilityStatus"] = "ok";
  if (cls.plausibleRange) {
    if (numericValue === undefined) {
      plausibilityStatus = "ambiguous";
    } else if (
      numericValue < cls.plausibleRange.min ||
      numericValue > cls.plausibleRange.max
    ) {
      plausibilityStatus = "out-of-range";
    }
  }

  const vo = valueMatch.groupOffsets.value;
  const provenance: Provenance = {
    lineNumber,
    lineContent,
    matchedExpression: cls.valueExpression,
    captureGroup: "value",
    startOffset: vo ? vo.start : -1,
    endOffset: vo ? vo.end : -1,
  };

  const extracted: ExtractedValue = {
    measurementId: cls.measurementId,
    measurementName: cls.measurementName,
    rawValue,
    unit,
    numericValue,
    plausibilityStatus,
    provenance,
  };

  extractedValues.push(extracted);

  return {
    lineNumber,
    content: lineContent,
    classification: "extracted",
    classificationId,
  };
}

/**
 * Parses a raw value string into a number using strict rules:
 * optional sign, digits with optional single decimal point, optional
 * exponent. No separators, units, or whitespace tolerated.
 */
export function parseNumeric(raw: string): number | undefined {
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(raw)) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Builds the accounting summary from per-line outcomes, checking invariants. */
function buildSummary(
  outcomes: readonly LineOutcome[],
  totalLines: number,
): LineAccountingSummary {
  let extracted = 0;
  let ignored = 0;
  let unexplained = 0;
  const lineBreakdown: LineEntry[] = outcomes.map((o) => {
    if (o.entry.classification === "extracted") extracted++;
    else if (o.entry.classification === "ignored") ignored++;
    else unexplained++;
    return o.entry;
  });

  if (totalLines !== outcomes.length) {
    throw new Error(
      "Line accounting internal error: totalLines (" +
        totalLines +
        ") != outcomes (" +
        outcomes.length +
        ")",
    );
  }

  const summary: LineAccountingSummary = {
    totalLines,
    extractedLines: extracted,
    ignoredLines: ignored,
    unexplainedLines: unexplained,
    lineBreakdown,
  };

  if (
    summary.totalLines !==
    summary.extractedLines + summary.ignoredLines + summary.unexplainedLines
  ) {
    throw new Error(
      "Line accounting invariant violated: " +
        summary.totalLines +
        " != " +
        summary.extractedLines +
        "+" +
        summary.ignoredLines +
        "+" +
        summary.unexplainedLines,
    );
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Plausibility checks (cross-value, from the rule's plausibilityChecks)
// ---------------------------------------------------------------------------

function runPlausibilityChecks(
  extractedValues: readonly ExtractedValue[],
  checks: readonly PlausibilityCheck[],
  suspiciousItems: SuspiciousItem[],
): void {
  const byId = new Map<string, ExtractedValue>();
  for (const v of extractedValues) {
    byId.set(v.measurementId, v);
  }

  for (const check of checks) {
    switch (check.kind) {
      case "range": {
        const p = check.parameters as {
          measurementId?: string;
          min?: number;
          max?: number;
        };
        const v = p.measurementId ? byId.get(p.measurementId) : undefined;
        if (!v || v.numericValue === undefined) continue;
        if (
          (p.min !== undefined && v.numericValue < p.min) ||
          (p.max !== undefined && v.numericValue > p.max)
        ) {
          suspiciousItems.push({
            lineNumber: v.provenance.lineNumber,
            content: v.provenance.lineContent,
            suspicionKind: "out-of-range",
            detail:
              v.measurementName +
              " = " +
              v.numericValue +
              " is outside the plausible range [" +
              String(p.min ?? "-inf") +
              ", " +
              String(p.max ?? "inf") +
              '] defined by check "' +
              check.description +
              '".',
          });
        }
        break;
      }

      case "ratio": {
        const p = check.parameters as {
          numeratorId?: string;
          denominatorId?: string;
          expectedRatio?: number;
          tolerance?: number;
        };
        const num = p.numeratorId ? byId.get(p.numeratorId) : undefined;
        const den = p.denominatorId ? byId.get(p.denominatorId) : undefined;
        if (
          !num ||
          !den ||
          num.numericValue === undefined ||
          den.numericValue === undefined ||
          den.numericValue === 0
        ) {
          continue;
        }
        const actual = num.numericValue / den.numericValue;
        const expected = p.expectedRatio ?? 1;
        const tol = p.tolerance ?? 0.1;
        if (Math.abs(actual - expected) > tol * Math.abs(expected)) {
          suspiciousItems.push({
            lineNumber: num.provenance.lineNumber,
            content: num.provenance.lineContent,
            suspicionKind: "ratio-violation",
            detail:
              num.measurementName +
              " / " +
              den.measurementName +
              " = " +
              actual.toFixed(3) +
              ", expected ~ " +
              expected +
              " (tolerance +/-" +
              (tol * 100).toFixed(0) +
              "%). " +
              check.description,
          });
        }
        break;
      }

      case "mutual-consistency": {
        const p = check.parameters as {
          aId?: string;
          bId?: string;
          maxFactor?: number;
        };
        const a = p.aId ? byId.get(p.aId) : undefined;
        const b = p.bId ? byId.get(p.bId) : undefined;
        if (
          !a ||
          !b ||
          a.numericValue === undefined ||
          b.numericValue === undefined
        ) {
          continue;
        }
        const factor = p.maxFactor ?? 2;
        const ratio =
          Math.abs(a.numericValue) > Math.abs(b.numericValue)
            ? Math.abs(a.numericValue / b.numericValue)
            : Math.abs(b.numericValue / a.numericValue);
        if (!Number.isFinite(ratio) || ratio > factor) {
          suspiciousItems.push({
            lineNumber: a.provenance.lineNumber,
            content: a.provenance.lineContent,
            suspicionKind: "mutual-inconsistency",
            detail:
              a.measurementName +
              " (" +
              a.numericValue +
              ") and " +
              b.measurementName +
              " (" +
              b.numericValue +
              ") differ by more than the allowed factor " +
              factor +
              ". " +
              check.description,
          });
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// State constructors for non-classified outcomes
// ---------------------------------------------------------------------------

function mismatchResult(
  report: Report,
  ruleRecord: RuleRecord,
): ProcessingResult {
  const lineBreakdown: LineEntry[] = report.lines.map((content, i) => ({
    lineNumber: i,
    content,
    classification: "unexplained" as const,
  }));
  return {
    reportId: report.id,
    processedAt: report.submittedAt,
    state: "layout-mismatch",
    ruleId: ruleRecord.rule.ruleId,
    ruleContentHash: ruleRecord.contentHash,
    aiCallCount: 0,
    extractedValues: [],
    lineAccountingSummary: {
      totalLines: report.lines.length,
      extractedLines: 0,
      ignoredLines: 0,
      unexplainedLines: report.lines.length,
      lineBreakdown,
    },
    offendingLines: [
      {
        lineNumber: 0,
        content: report.lines[0] ?? "",
        reason: "layout-mismatch",
        detail:
          "No supported layout matched this report. The report's structure " +
          "does not satisfy the active rule's layout condition.",
      },
    ],
    resolutionHint:
      "This report does not match the active rule's layout. " +
      "If this is a new layout, use onboarding to draft a rule for it.",
  };
}

function timeoutRefusal(
  report: Report,
  ruleRecord: RuleRecord,
  lineNumber: number,
  err: ExpressionTimeoutError,
): ProcessingResult {
  const lineBreakdown: LineEntry[] = report.lines.map((content, i) => ({
    lineNumber: i,
    content,
    classification: "unexplained" as const,
  }));
  return {
    reportId: report.id,
    processedAt: report.submittedAt,
    state: "refusal",
    ruleId: ruleRecord.rule.ruleId,
    ruleContentHash: ruleRecord.contentHash,
    aiCallCount: 0,
    extractedValues: [],
    lineAccountingSummary: {
      totalLines: report.lines.length,
      extractedLines: 0,
      ignoredLines: 0,
      unexplainedLines: report.lines.length,
      lineBreakdown,
    },
    offendingLines: [
      {
        lineNumber,
        content: report.lines[lineNumber] ?? "",
        reason: "unexplained",
        detail:
          "Processing exceeded the time limit while matching line " +
          (lineNumber + 1) +
          ": " +
          err.message,
      },
    ],
    resolutionHint:
      "The rule's expressions took too long to match. The rule may be too " +
      "complex for this report; it should be re-validated or simplified.",
    timeoutOccurred: true,
  };
}
