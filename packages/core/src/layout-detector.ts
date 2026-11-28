/**
 * layout-detector.ts
 *
 * Pure function that determines which active approved Extraction Rule, if any,
 * matches a submitted Report based on the rule's layoutMatchExpression.
 *
 * Responsibility:
 *   - Accept a Report and an ordered list of active RuleRecords.
 *   - For each rule (in order), test whether its layoutMatchExpression matches
 *     anywhere in the report text.
 *   - Return the first matching rule, or null if no rule matches.
 *
 * Boundaries:
 *   - Pure function: no I/O, no mutations, no AI calls, no side effects.
 *   - Only considers rules with status === "active". Rules in any other state
 *     are skipped regardless of their layoutMatchExpression content.
 *     This enforces Requirement 9.2: a Report can only be accepted as supported
 *     when its Layout matches an *active approved* Extraction Rule.
 *   - If a rule's layoutMatchExpression is not a valid RE2 pattern, the function
 *     throws rather than silently skipping the rule. An invalid expression in an
 *     active rule record indicates rule-store corruption or a validation failure —
 *     silent recovery would hide a real integrity problem.
 *   - The layout match is performed against the full report text, reconstructed
 *     by joining report.lines with "\n". This preserves line structure and matches
 *     the design's intent ("tested against the full report text (joined)").
 *   - First-match semantics: the caller is responsible for passing rules in a
 *     stable, deterministic order. detectLayout respects input order exactly.
 *
 * Requirements: 9.2
 * Design: LayoutDetector component, Processing Lifecycle — step 2
 */

import {
  compileExpression,
  runExpression,
  type CompiledExpression,
} from "./expression-runner.js";
import type { Report, RuleRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Finds the first active RuleRecord whose layoutMatchExpression matches
 * anywhere in the report text.
 *
 * @param report      The submitted Report to identify.
 * @param activeRules Ordered list of RuleRecords to check. Caller should supply
 *                    only active rules, but non-active rules are filtered out
 *                    defensively inside this function.
 * @returns           The first matching active RuleRecord, or null if none match.
 *
 * @throws {RE2JSSyntaxException} if an active rule's layoutMatchExpression is
 *         not a valid RE2 pattern. This indicates rule-store corruption.
 * @throws {ExpressionTimeoutError} if matching an expression exceeds the
 *         per-expression time budget (500ms default from runExpression).
 */
export function detectLayout(
  report: Report,
  activeRules: readonly RuleRecord[],
): RuleRecord | null {
  // Reconstruct the full report text from individual lines.
  // Joining with "\n" preserves line boundaries as the original content would.
  const reportText = report.lines.join("\n");

  for (const record of activeRules) {
    // Safety filter: only consider truly active approved rules.
    // Any other status (draft, validated, invalidated, revoked, etc.) is excluded.
    if (record.status !== "active") {
      continue;
    }

    // Compile the layout match expression. For a healthy rule store, all stored
    // expressions should be valid RE2 (the validation gate checks them before
    // activation). If compile throws RE2JSSyntaxException, it propagates — this
    // is a rule integrity error, not a report layout mismatch.
    //
    // Expressions are compiled on each call. For the demo scope (≤3 layouts),
    // this is negligible. If a cache is ever needed, it belongs in a wrapper
    // at the call site (e.g., the engine), not here — this function is pure.
    const compiled: CompiledExpression = compileExpression(
      record.rule.layoutMatchExpression,
    );

    // runExpression performs an unanchored search (matcher.find()), so a
    // partial match anywhere in reportText is sufficient to identify the layout.
    const match = runExpression(compiled, reportText);

    if (match !== null) {
      return record;
    }
  }

  return null;
}
