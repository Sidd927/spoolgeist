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
      lineMatchExpression: string;
      valueExpression: string;
      unitExpression?: string;
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
  ruleContentHash: string;
  validationRunId: string;
  scopeStatement: string;
}

// ---------------------------------------------------------------------------
// RuleRecord
// ---------------------------------------------------------------------------

export interface RuleRecord {
  rule: ExtractionRule;
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
  rawValue: string;
  unit?: string;
  numericValue?: number;
  plausibilityStatus: "ok" | "out-of-range" | "ambiguous";
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

export interface OffendingLine {
  lineNumber: number;
  content: string;
  reason:
    | "unexplained"
    | "tampered-value"
    | "out-of-range"
    | "layout-mismatch"
    | "ambiguous";
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

// ---------------------------------------------------------------------------
// computeRuleHash stub
// (Implementation lives in packages/core/src/rule-store.ts — Task 8)
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 content hash for an ExtractionRule.
 * Used to bind an ApprovalRecord to the exact rule version it covers.
 * Implementation is in packages/core/src/rule-store.ts (Task 8).
 * This stub is re-exported from types.ts for type-checking purposes during Tasks 3–7.
 *
 * @throws {Error} Always — do not call this stub.
 */
export function computeRuleHash(_rule: ExtractionRule): string {
  throw new Error("computeRuleHash: implementation not yet available (Task 8)");
}
