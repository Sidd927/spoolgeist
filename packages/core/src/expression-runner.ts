/**
 * expression-runner.ts
 *
 * Security-critical RE2 expression execution wrapper.
 * This is the ONLY place in the codebase that calls re2js.
 * It is the safety boundary between AI-drafted regex patterns and the rest of the system.
 *
 * Key invariants:
 *   - RE2JS.compile() is always called WITHOUT flags (especially no LOOKBEHINDS).
 *   - Backreferences, lookaheads, and lookbehinds are rejected at compile time.
 *   - Each match execution is guarded by a wall-clock timeout.
 */

import { RE2JS, RE2JSSyntaxException, RE2JSGroupException } from "re2js";
import type { Matcher } from "re2js";

// performance is a global in Node 16+. We use `globalThis.performance` with
// a minimal ambient declaration to avoid adding @types/node to the type roots
// (the tsconfig intentionally sets types: [] to prevent automatic type injection).
declare const performance: { now(): number };

export { RE2JSSyntaxException, RE2JSGroupException } from "re2js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * An opaque handle to a compiled RE2 expression.
 * Never construct directly — use compileExpression().
 */
export interface CompiledExpression {
  readonly pattern: string;
  /** Internal: the compiled RE2JS object. Not part of the public contract. */
  readonly _compiled: RE2JS;
}

/**
 * The result of a successful match produced by runExpression().
 * Uses a purpose-built type rather than RegExpMatchArray, which is tied to
 * the native JavaScript regex engine.
 */
export interface MatchResult {
  /** The full matched string (group 0). */
  fullMatch: string;
  /** All named capture groups and their values. Absent groups have value null. */
  namedGroups: Record<string, string | null>;
  /** Start offset of the full match in the input (0-indexed). */
  matchStart: number;
  /** End offset of the full match in the input (exclusive). */
  matchEnd: number;
  /** Start/end offsets for each named group. Absent groups have -1. */
  groupOffsets: Record<string, { start: number; end: number }>;
}

/**
 * Thrown when an expression exceeds the execution time budget.
 * For re2js (pure JS, linear-time), this is a belt-and-suspenders measure
 * against unexpectedly large inputs, not against pathological backtracking.
 * The primary safety mechanism is compile-time rejection of backtracking
 * constructs (Property 11).
 */
export class ExpressionTimeoutError extends Error {
  readonly pattern: string;
  readonly timeoutMs: number;

  constructor(pattern: string, timeoutMs: number) {
    super(
      `Expression execution exceeded ${timeoutMs}ms time limit: ${pattern.slice(0, 80)}`,
    );
    this.name = "ExpressionTimeoutError";
    this.pattern = pattern;
    this.timeoutMs = timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// compileExpression
// ---------------------------------------------------------------------------

/**
 * Compiles an RE2 pattern into a reusable CompiledExpression handle.
 *
 * Throws RE2JSSyntaxException (natively, without catching or rethrowing) on
 * any syntax that RE2 rejects, including:
 *   - Backreferences: \1 through \9
 *   - Lookaheads: (?=  (?!
 *   - Lookbehinds: (?<=  (?<!   (even without the LOOKBEHINDS flag)
 *
 * CRITICAL: No flags are passed to RE2JS.compile(). Specifically,
 * RE2JS.LOOKBEHINDS MUST NOT be enabled — the design requires that lookbehinds
 * are rejected at compile time as an unsafe construct.
 *
 * @throws {RE2JSSyntaxException} when the pattern contains unsupported syntax.
 */
export function compileExpression(pattern: string): CompiledExpression {
  // RE2JS.compile() throws RE2JSSyntaxException for any unsupported syntax:
  // backreferences (\1-\9), lookaheads (?=, ?!), lookbehinds (?<=, ?<!).
  // No flags are passed — RE2JS.LOOKBEHINDS must NOT be enabled.
  const compiled = RE2JS.compile(pattern);
  return { pattern, _compiled: compiled };
}

// ---------------------------------------------------------------------------
// runExpression
// ---------------------------------------------------------------------------

/**
 * Runs a compiled expression against an input string.
 *
 * Returns a MatchResult on match, or null if the pattern does not match.
 * Throws ExpressionTimeoutError if the wall-clock time for the match
 * operation exceeds timeoutMs (default: 500ms).
 *
 * Note: re2js's linear-time guarantee means the timeout fires only on
 * unexpectedly large inputs, not due to catastrophic backtracking.
 */
export function runExpression(
  expr: CompiledExpression,
  input: string,
  timeoutMs = 500,
): MatchResult | null {
  const start = performance.now();
  const matcher = expr._compiled.matcher(input);
  const found = matcher.find();
  const elapsed = performance.now() - start;

  if (elapsed > timeoutMs) {
    throw new ExpressionTimeoutError(expr.pattern, timeoutMs);
  }

  if (!found) {
    return null;
  }

  return extractMatchResult(expr, matcher);
}

// ---------------------------------------------------------------------------
// runFullMatch (added by Claude Code)
// ---------------------------------------------------------------------------

/**
 * Like runExpression, but succeeds only if the expression matches the ENTIRE
 * input (RE2 `matches()`), never a substring. Line classification uses this so
 * that no trailing or leading text on a classified line can go unexplained:
 * "HGB 13.5 g/dL" may match, "HGB 13.5 g/dL  HIV REACTIVE" must not.
 *
 * The time check is a post-hoc budget check (re2js is synchronous and cannot be
 * interrupted); the hard bound comes from RE2's linear-time matching combined
 * with the engine's input-size limits.
 */
export function runFullMatch(
  expr: CompiledExpression,
  input: string,
  timeoutMs = 500,
): MatchResult | null {
  const start = performance.now();
  const matcher = expr._compiled.matcher(input);
  const found = matcher.matches();
  const elapsed = performance.now() - start;
  if (elapsed > timeoutMs) {
    throw new ExpressionTimeoutError(expr.pattern, timeoutMs);
  }
  if (!found) {
    return null;
  }
  return extractMatchResult(expr, matcher);
}

// ---------------------------------------------------------------------------
// extractMatchResult (internal)
// ---------------------------------------------------------------------------

/**
 * Extracts group values and offsets from a Matcher that has already called
 * .find() successfully.
 *
 * Handles RE2JSGroupException gracefully: optional groups that did not
 * participate in the match return null from .group() and -1 from .start()/.end().
 * This is normal RE2 behaviour for unmatched optional groups.
 */
function extractMatchResult(
  expr: CompiledExpression,
  matcher: Matcher,
): MatchResult {
  const fullMatch = matcher.group(0) ?? "";
  const matchStart = matcher.start(0);
  const matchEnd = matcher.end(0);

  // getNamedGroups() on the matcher gives name → matched_value mapping.
  const namedGroupValues = matcher.getNamedGroups() as Record<
    string,
    string | null
  >;

  // namedGroups() on the compiled pattern gives name → group_index mapping.
  // Use it to enumerate all declared groups so absent groups get -1 offsets.
  const compiledNamedGroups = expr._compiled.namedGroups();
  const groupOffsets: Record<string, { start: number; end: number }> = {};

  for (const name of Object.keys(compiledNamedGroups)) {
    const s = matcher.start(name);
    const e = matcher.end(name);
    groupOffsets[name] = { start: s, end: e };
  }

  return {
    fullMatch,
    namedGroups: namedGroupValues,
    matchStart,
    matchEnd,
    groupOffsets,
  };
}
