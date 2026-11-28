/**
 * Spoolgeist domain types and interfaces.
 * Pure TypeScript — no runtime dependencies.
 */

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface Report {
  id: string;
  submittedAt: string; // ISO 8601
  content: string;
  lines: readonly string[]; // immutable
  sourceLabel: string;
}

// ---------------------------------------------------------------------------
// LineClassification — discriminated union
// ---------------------------------------------------------------------------

export type LineClassification =
  | {
      kind: "extract";
      measurementId: string;
      measurementName: string;
      /**
       * RE2 pattern that must match the ENTIRE line (full match, not a search).
       * It must contain a named group `value` and, when `expectedUnit` is set,
       * a named group `unit`. (Claude Code change: the draft's separate
       * valueExpression/unitExpression searched the line independently and
       * could pick the wrong number or ignore trailing text.)
       */
      lineMatchExpression: string;
      /** If set, the captured `unit` must equal this string exactly. */
      expectedUnit?: string;
      /** Defaults to true: a required measurement missing from the report refuses it. */
      required?: boolean;
      plausibleRange?: { readonly min: number; readonly max: number };
    }
  | { kind: "ignore"; reason: string; lineMatchExpression: string }
  | { kind: "header"; lineMatchExpression: string }
  | { kind: "footer"; lineMatchExpression: string };

// ---------------------------------------------------------------------------
// PlausibilityCheck
// ---------------------------------------------------------------------------

export interface PlausibilityCheck {
  checkId: string;
  description: string;
  kind: "ratio" | "range" | "mutual-consistency";
  parameters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ExtractionRule
// ---------------------------------------------------------------------------

export interface ExtractionRule {
  ruleId: string;
  layoutId: string;
  layoutName: string;
  layoutVersion: number;
  layoutMatchExpression: string;
  lineClassifications: readonly LineClassification[];
  plausibilityChecks: readonly PlausibilityCheck[];
  metadata: {
    readonly createdAt: string;
    readonly draftedBy: "ai" | "operator";
    readonly aiModel?: string;
  };
}

// ---------------------------------------------------------------------------
// RuleStatus
// ---------------------------------------------------------------------------

export type RuleStatus =
  | "draft"
  | "validation-failed"
  | "validated"
  | "approved"
  | "active"
  | "invalidated"
  | "revoked";

// ---------------------------------------------------------------------------
// RuleEvent
// ---------------------------------------------------------------------------

export type RuleEventType =
  | "created"
  | "submitted-for-validation"
  | "validation-passed"
  | "validation-failed"
  | "approved"
  | "activated"
  | "invalidated"
  | "revoked"
  | "modified";

export interface RuleEvent {
  eventId: string;
  eventType: RuleEventType;
  timestamp: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// ApprovalRecord
// ---------------------------------------------------------------------------

export interface ApprovalRecord {
  approvedAt: string;
  /** Name typed by the human who approved (required; never empty). */
  approvedBy: string;
  ruleContentHash: string;
  validationRunId: string;
  scopeStatement: string;
}

// ---------------------------------------------------------------------------
// RuleRecord
// ---------------------------------------------------------------------------

/** Where a rule proposal came from (outside the hashed rule content). */
export interface ProposalSource {
  kind: "live-ai" | "recorded-ai" | "operator";
  model?: string;
  recordedAt?: string;
  promptHash?: string;
}

export interface RuleRecord {
  rule: ExtractionRule;
  proposalSource?: ProposalSource;
  contentHash: string;
  status: RuleStatus;
  validationRunId?: string;
  approvalRecord?: ApprovalRecord;
  invalidationReason?: string;
  history: readonly RuleEvent[];
}

// ---------------------------------------------------------------------------
// ProcessingState
// ---------------------------------------------------------------------------

export type ProcessingState = "accepted" | "refusal" | "review" | "layout-mismatch";

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface Provenance {
  lineNumber: number; // 0-indexed
  lineContent: string;
  matchedExpression: string;
  captureGroup: string; // The named capture group name used (e.g. "value")
  startOffset: number;
  endOffset: number;
}

// ---------------------------------------------------------------------------
// ExtractedValue
// ---------------------------------------------------------------------------

export interface ExtractedValue {
  measurementId: string;
  measurementName: string;
  /** The value exactly as printed (a plain decimal). Never converted to float. */
  rawValue: string;
  unit?: string;
  plausibilityStatus: "ok" | "out-of-range" | "not-checked";
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// LineEntry
// ---------------------------------------------------------------------------

export interface LineEntry {
  lineNumber: number;
  content: string;
  classification: "extracted" | "ignored" | "unexplained";
  classificationId?: string;
  /** For ignored lines: header | footer | ignore. */
  matchedKind?: "extract" | "ignore" | "header" | "footer";
  /** Why a line is unexplained (e.g. no classification, tampered value, unit mismatch). */
  reason?: OffendingReason;
}

// ---------------------------------------------------------------------------
// LineAccountingSummary
// ---------------------------------------------------------------------------

export interface LineAccountingSummary {
  totalLines: number;
  extractedLines: number;
  ignoredLines: number;
  unexplainedLines: number;
  lineBreakdown: readonly LineEntry[];
}

// ---------------------------------------------------------------------------
// OffendingLine
// ---------------------------------------------------------------------------

export type OffendingReason =
  | "unexplained"
  | "tampered-value"
  | "unit-mismatch"
  | "missing-measurement"
  | "layout-mismatch"
  | "input-too-large"
  | "timeout";

export interface OffendingLine {
  /** 0-indexed line number, or -1 when the problem is an ABSENT line (missing measurement). */
  lineNumber: number;
  content: string;
  reason: OffendingReason;
  detail: string;
}

// ---------------------------------------------------------------------------
// SuspiciousItem
// ---------------------------------------------------------------------------

export interface SuspiciousItem {
  lineNumber: number;
  content: string;
  suspicionKind: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// ProcessingResult
// ---------------------------------------------------------------------------

export interface ProcessingResult {
  reportId: string;
  processedAt: string; // ISO 8601
  state: ProcessingState;
  ruleId?: string;
  ruleContentHash?: string;
  aiCallCount: 0; // Literal type — NEVER `number`. Enforces zero-AI invariant at compile time.
  extractedValues: readonly ExtractedValue[];
  lineAccountingSummary: LineAccountingSummary;
  offendingLines?: readonly OffendingLine[];
  suspiciousContent?: readonly SuspiciousItem[];
  resolutionHint?: string;
  timeoutOccurred?: boolean;
}

// ---------------------------------------------------------------------------
// ValidationCase
// ---------------------------------------------------------------------------

export interface ValidationCase {
  caseId: string;
  caseLabel: string;
  property: string;
  kind: "baseline" | "layout-specific";
  reportContent: string;
  passed: boolean;
  expectedState: ProcessingState;
  observedState: ProcessingState;
  observedResult: ProcessingResult;
  failureDetail?: string;
}

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------

export interface ValidationResult {
  runId: string;
  ruleContentHash: string;
  ranAt: string; // ISO 8601
  passed: boolean;
  cases: readonly ValidationCase[];
  limitations: string;
}

// computeRuleHash lives in rule-hash.ts (re-exported from index.ts).
