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
 * Provenance: drafted by Kiro (task 5.1); safety fixes by Claude Code — full-line
 * matching for every classification, value/unit captured inside the full-line
 * match, tampered values and unit mismatches refuse, required measurements,
 * rule-hash recomputation, input-size limits, exact-decimal plausibility.
 *
 * Determinism note on timestamps: ProcessingResult.processedAt is derived
 * from report.submittedAt (an input), NOT wall-clock time. This is what
 * makes repeat-processing byte-identical. The timestamp answers "when was
 * this report submitted", which is the only time the engine can speak to
 * without becoming non-deterministic.
 */

import {
  compileExpression,
  runFullMatch,
  ExpressionTimeoutError,
  RE2JSSyntaxException,
  type CompiledExpression,
  type MatchResult,
} from "./expression-runner.js";
import { detectLayout } from "./layout-detector.js";
import { compareDecimal, isPlainDecimal, numberToDecimal } from "./decimal.js";
import { computeRuleHash } from "./rule-hash.js";
// Global in Node 16+ and browsers; declared locally because core uses `types: []`.
declare const performance: { now(): number };

import type {
  ExtractedValue,
  LineAccountingSummary,
  LineClassification,
  LineEntry,
  OffendingLine,
  OffendingReason,
  PlausibilityCheck,
  ProcessingResult,
  Provenance,
  Report,
  RuleRecord,
  SuspiciousItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Input limits (bound total work together with RE2's linear-time matching)
// ---------------------------------------------------------------------------

export const LIMITS = {
  maxLines: 300,
  maxLineLength: 400,
  maxChars: 40_000,
  /** Cumulative matching budget per report (post-hoc check between lines). */
  reportBudgetMs: 1_000,
} as const;

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

  // --- Guard 2b: the rule object itself must still hash to contentHash ------
  // (catches a rule edited in memory/storage after approval)
  const recomputed = computeRuleHash(ruleRecord.rule);
  if (recomputed !== ruleRecord.contentHash) {
    throw new IntegrityError(recomputed, ruleRecord.contentHash);
  }

  // --- Guard 2c: input size limits -> Refusal (never partial processing) ---
  const tooLarge = inputTooLarge(report);
  if (tooLarge !== null) {
    return tooLargeRefusal(report, ruleRecord, tooLarge);
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
      const groups = lineCompiled._compiled.namedGroups();
      if (!("value" in groups) || (cls.expectedUnit !== undefined && !("unit" in groups))) {
        throw new RuleExpressionError(
          "lineClassifications[" + index + "].lineMatchExpression",
          cls.lineMatchExpression,
          new Error(
            cls.expectedUnit !== undefined
              ? 'extract pattern must contain named groups "value" and "unit"'
              : 'extract pattern must contain a named group "value"',
          ),
        );
      }
      compiledExtracts.push({ cls, lineCompiled, index });
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

  const budgetStart = performance.now();
  for (let lineNumber = 0; lineNumber < report.lines.length; lineNumber++) {
    const lineContent = report.lines[lineNumber] ?? "";
    if (performance.now() - budgetStart > LIMITS.reportBudgetMs) {
      return timeoutRefusal(
        report,
        ruleRecord,
        lineNumber,
        new ExpressionTimeoutError("<report budget>", LIMITS.reportBudgetMs),
      );
    }

    // First matching classification wins for this line.
    let winner:
      | { kind: "extract"; ce: CompiledExtract }
      | { kind: "other"; co: CompiledOther }
      | undefined;
    let winnerMatch: MatchResult | null = null;

    for (const candidate of allCompiled) {
      let lineMatch: MatchResult | null;
      try {
        // FULL match: the classification must explain the entire line.
        lineMatch = runFullMatch(
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
        winnerMatch = lineMatch;
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
          reason: "unexplained",
        },
      });
      continue;
    }

    if (winner.kind === "extract") {
      const ce = winner.ce;
      const outcome = applyExtract(
        ce,
        winnerMatch!,
        lineNumber,
        lineContent,
        extractedValues,
        seenMeasurementLines,
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
          matchedKind: co.cls.kind,
        },
      });
    }
  }

  // --- Required measurements: an absent required line refuses the report ---
  for (const ce of compiledExtracts) {
    if (ce.cls.required !== false && !seenMeasurementLines.has(ce.cls.measurementId)) {
      offendingLines.push({
        lineNumber: -1,
        content: "",
        reason: "missing-measurement",
        detail:
          'Required measurement "' +
          ce.cls.measurementName +
          '" does not appear in the report. A truncated or altered report ' +
          "cannot be accepted.",
      });
    }
  }

  // --- Line accounting invariant (Property 3) -------------------------------
  const summary = buildSummary(outcomes, report.lines.length);

  // --- Unexplained content or any offending line blocks acceptance ---------
  if (summary.unexplainedLines > 0 || offendingLines.length > 0) {
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
        "The report contains content the approved rule cannot fully explain " +
        "(unexplained lines, tampered values, unit mismatches or missing " +
        "measurements). Nothing from it is treated as verified. Check the " +
        "highlighted lines: either the report was altered, or it comes from a " +
        "different source or layout version that needs its own rule.",
    };
  }

  // --- Plausibility phase ----------------------------------------------------
  for (const v of extractedValues) {
    if (v.plausibilityStatus === "out-of-range") {
      suspiciousItems.push({
        lineNumber: v.provenance.lineNumber,
        content: v.provenance.lineContent,
        suspicionKind: "out-of-range",
        detail:
          v.measurementName + " = " + v.rawValue +
          " is outside the plausible range in the approved rule. It may be a real " +
          "extreme value or a corrupted one; a human must decide.",
      });
    }
  }
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
 * Applies an extract classification to a line that FULLY matched its
 * lineMatchExpression. The value (and unit) come from named groups of that
 * same full match, so the number that was captured is exactly the number the
 * pattern positioned — no second, independent search of the line.
 *
 * Fail-closed outcomes (the line becomes UNEXPLAINED and the report refuses):
 *   - the captured value is not a plain decimal ("tampered-value");
 *   - the captured unit differs from expectedUnit ("unit-mismatch").
 */
function applyExtract(
  ce: CompiledExtract,
  match: MatchResult,
  lineNumber: number,
  lineContent: string,
  extractedValues: ExtractedValue[],
  seenMeasurementLines: Map<string, number[]>,
  offendingLines: OffendingLine[],
): LineEntry {
  const cls = ce.cls;
  const classificationId = "extract[" + ce.index + "]";

  // Track the line for duplicate/required detection regardless of outcome.
  const seen = seenMeasurementLines.get(cls.measurementId) ?? [];
  seen.push(lineNumber);
  seenMeasurementLines.set(cls.measurementId, seen);

  const unexplained = (reason: OffendingReason, detail: string): LineEntry => {
    offendingLines.push({ lineNumber, content: lineContent, reason, detail });
    return {
      lineNumber,
      content: lineContent,
      classification: "unexplained",
      classificationId,
      reason,
    };
  };

  const rawValue = match.namedGroups.value ?? null;
  if (rawValue === null || !isPlainDecimal(rawValue)) {
    return unexplained(
      "tampered-value",
      'Line has the shape of measurement "' +
        cls.measurementName +
        '" but its value ' +
        (rawValue === null ? "is missing" : JSON.stringify(rawValue) + " is not a plain decimal number") +
        ". The value may be tampered or malformed; it is never guessed.",
    );
  }

  let unit: string | undefined;
  if (cls.expectedUnit !== undefined) {
    const printed = match.namedGroups.unit ?? null;
    if (printed !== cls.expectedUnit) {
      return unexplained(
        "unit-mismatch",
        'Measurement "' +
          cls.measurementName +
          '" was printed with unit ' +
          JSON.stringify(printed ?? "") +
          " but the approved rule expects " +
          JSON.stringify(cls.expectedUnit) +
          ". A unit change can silently change the meaning of a value.",
      );
    }
    unit = printed;
  }

  let plausibilityStatus: ExtractedValue["plausibilityStatus"] = "not-checked";
  if (cls.plausibleRange) {
    const lo = numberToDecimal(cls.plausibleRange.min);
    const hi = numberToDecimal(cls.plausibleRange.max);
    plausibilityStatus =
      compareDecimal(rawValue, lo) < 0 || compareDecimal(rawValue, hi) > 0
        ? "out-of-range"
        : "ok";
  }

  const vo = match.groupOffsets.value;
  const provenance: Provenance = {
    lineNumber,
    lineContent,
    matchedExpression: cls.lineMatchExpression,
    captureGroup: "value",
    startOffset: vo ? vo.start : -1,
    endOffset: vo ? vo.end : -1,
  };

  const extracted: ExtractedValue = {
    measurementId: cls.measurementId,
    measurementName: cls.measurementName,
    rawValue,
    ...(unit !== undefined ? { unit } : {}),
    plausibilityStatus,
    provenance,
  };
  extractedValues.push(extracted);

  return {
    lineNumber,
    content: lineContent,
    classification: "extracted",
    classificationId,
    matchedKind: "extract",
  };
}

/** Returns a description of the violated input limit, or null if within limits. */
export function inputTooLarge(report: Report): string | null {
  if (report.lines.length > LIMITS.maxLines) {
    return "report has " + report.lines.length + " lines (limit " + LIMITS.maxLines + ")";
  }
  let chars = 0;
  for (let i = 0; i < report.lines.length; i++) {
    const len = (report.lines[i] ?? "").length;
    if (len > LIMITS.maxLineLength) {
      return "line " + (i + 1) + " has " + len + " characters (limit " + LIMITS.maxLineLength + ")";
    }
    chars += len;
  }
  if (chars > LIMITS.maxChars) {
    return "report has " + chars + " characters (limit " + LIMITS.maxChars + ")";
  }
  return null;
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

/**
 * Cross-value checks from the rule. These can only ADD review flags; they can
 * never make a report acceptable. Range checks are exact (decimal strings).
 * Ratio and mutual-consistency checks are tolerance heuristics and use
 * floating point on the printed decimals; any rounding error is ~1e-15
 * relative, far below the tolerances involved, and it can at worst move a
 * borderline report between "accepted" and "review" — never hide a line.
 */
function runPlausibilityChecks(
  extractedValues: readonly ExtractedValue[],
  checks: readonly PlausibilityCheck[],
  suspiciousItems: SuspiciousItem[],
): void {
  const byId = new Map<string, ExtractedValue>();
  for (const v of extractedValues) {
    if (!byId.has(v.measurementId)) byId.set(v.measurementId, v);
  }
  const num = (v: ExtractedValue) => Number(v.rawValue);

  for (const check of checks) {
    switch (check.kind) {
      case "range": {
        const p = check.parameters as { measurementId?: string; min?: number; max?: number };
        const v = p.measurementId ? byId.get(p.measurementId) : undefined;
        if (!v) continue;
        const below = p.min !== undefined && compareDecimal(v.rawValue, numberToDecimal(p.min)) < 0;
        const above = p.max !== undefined && compareDecimal(v.rawValue, numberToDecimal(p.max)) > 0;
        if (below || above) {
          suspiciousItems.push({
            lineNumber: v.provenance.lineNumber,
            content: v.provenance.lineContent,
            suspicionKind: "out-of-range",
            detail:
              v.measurementName + " = " + v.rawValue + " is outside [" +
              String(p.min ?? "-inf") + ", " + String(p.max ?? "inf") +
              "] (" + check.description + ").",
          });
        }
        break;
      }

      case "ratio": {
        const p = check.parameters as {
          numeratorId?: string; denominatorId?: string; expectedRatio?: number; tolerance?: number;
        };
        const n = p.numeratorId ? byId.get(p.numeratorId) : undefined;
        const d = p.denominatorId ? byId.get(p.denominatorId) : undefined;
        if (!n || !d || num(d) === 0) continue;
        const actual = num(n) / num(d);
        const expected = p.expectedRatio ?? 1;
        const tol = p.tolerance ?? 0.1;
        if (Math.abs(actual - expected) > tol * Math.abs(expected)) {
          suspiciousItems.push({
            lineNumber: n.provenance.lineNumber,
            content: n.provenance.lineContent,
            suspicionKind: "ratio-violation",
            detail:
              n.measurementName + " / " + d.measurementName + " = " + actual.toFixed(3) +
              ", expected about " + expected + " (±" + (tol * 100).toFixed(0) + "%). " +
              check.description,
          });
        }
        break;
      }

      case "mutual-consistency": {
        const p = check.parameters as { aId?: string; bId?: string; maxFactor?: number; relation?: "a<=b" };
        const a = p.aId ? byId.get(p.aId) : undefined;
        const b = p.bId ? byId.get(p.bId) : undefined;
        if (!a || !b) continue;
        let violated: boolean;
        let why: string;
        if (p.relation === "a<=b") {
          violated = compareDecimal(a.rawValue, b.rawValue) > 0;
          why = a.measurementName + " (" + a.rawValue + ") must not exceed " + b.measurementName + " (" + b.rawValue + ").";
        } else {
          const factor = p.maxFactor ?? 2;
          const x = Math.abs(num(a));
          const y = Math.abs(num(b));
          const ratio = x > y ? x / y : y / x;
          violated = !Number.isFinite(ratio) || ratio > factor;
          why = a.measurementName + " (" + a.rawValue + ") and " + b.measurementName + " (" + b.rawValue +
            ") differ by more than a factor of " + factor + ".";
        }
        if (violated) {
          suspiciousItems.push({
            lineNumber: a.provenance.lineNumber,
            content: a.provenance.lineContent,
            suspicionKind: "mutual-inconsistency",
            detail: why + " " + check.description,
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
        reason: "timeout",
        detail:
          "Processing exceeded the time limit while matching line " +
          (lineNumber + 1) +
          ": " +
          err.message,
      },
    ],
    resolutionHint:
      "Matching exceeded the per-report time budget (checked between lines; " +
      "RE2 matching itself is linear-time). Nothing from this report is treated as verified.",
    timeoutOccurred: true,
  };
}

function tooLargeRefusal(
  report: Report,
  ruleRecord: RuleRecord,
  detail: string,
): ProcessingResult {
  const lineBreakdown: LineEntry[] = report.lines.map((content, i) => ({
    lineNumber: i,
    content,
    classification: "unexplained" as const,
    reason: "input-too-large" as const,
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
        lineNumber: -1,
        content: "",
        reason: "input-too-large",
        detail: "Input exceeds processing limits: " + detail + ".",
      },
    ],
    resolutionHint:
      "The report is larger than any supported layout. It was not processed.",
  };
}
