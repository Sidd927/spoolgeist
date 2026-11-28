/**
 * rule-lifecycle.ts — pure state transitions for rule records. Written by
 * Claude Code from the design's "Approval Lifecycle" section.
 *
 *   draft ─gate fail→ validation-failed ─modify→ draft
 *   draft ─gate pass→ validated ─approve (typed name)→ active
 *   active ─revoke→ revoked (no fallback: the layout has no rule until a new one is approved)
 *   any ─modify→ draft (new hash, evidence and approval cleared)
 *   active ─integrity check fails→ invalidated
 *
 * Every function returns a NEW record; nothing is mutated. Time is passed in
 * by the caller. AI output can only ever enter as a draft (Property 10).
 */
import { computeRuleHash } from "./rule-hash.js";
import type {
  ExtractionRule,
  ProposalSource,
  RuleEvent,
  RuleEventType,
  RuleRecord,
  RuleStatus,
  ValidationResult,
} from "./types.js";

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

function event(record: { history: readonly RuleEvent[] }, eventType: RuleEventType, timestamp: string, detail: string): RuleEvent {
  return { eventId: `${eventType}-${record.history.length + 1}`, eventType, timestamp, detail };
}

/** Creates a draft from a parsed proposal. The status is ALWAYS "draft". */
export function createDraft(rule: ExtractionRule, source: ProposalSource, now: string): RuleRecord {
  const base = { history: [] as RuleEvent[] };
  return {
    rule,
    proposalSource: source,
    contentHash: computeRuleHash(rule),
    status: "draft",
    history: [event(base, "created", now, `Draft created from ${source.kind} proposal`)],
  };
}

/** Records a gate run. The evidence must be for exactly this rule content. */
export function recordValidation(record: RuleRecord, result: ValidationResult, now: string): RuleRecord {
  if (record.status !== "draft" && record.status !== "validation-failed") {
    throw new LifecycleError(`cannot validate a rule in status "${record.status}"`);
  }
  const fresh = computeRuleHash(record.rule);
  if (fresh !== record.contentHash || result.ruleContentHash !== fresh) {
    throw new LifecycleError("validation evidence does not belong to this exact rule content");
  }
  const status: RuleStatus = result.passed ? "validated" : "validation-failed";
  const failed = result.cases.filter((c) => !c.passed).map((c) => c.caseId);
  return {
    ...record,
    status,
    validationRunId: result.runId,
    history: [
      ...record.history,
      event(record, result.passed ? "validation-passed" : "validation-failed", now,
        result.passed ? `All ${result.cases.length} gate cases passed (run ${result.runId})` : `Failed cases: ${failed.join(", ")}`),
    ],
  };
}

export interface ApprovalCheck {
  ok: boolean;
  reasons: string[];
}

/** Both gates required: passed validation for this exact content AND a named human. */
export function canApprove(record: RuleRecord, validation: ValidationResult | undefined): ApprovalCheck {
  const reasons: string[] = [];
  if (record.status !== "validated") reasons.push(`status is "${record.status}", not "validated"`);
  const fresh = computeRuleHash(record.rule);
  if (fresh !== record.contentHash) reasons.push("rule content changed since it was hashed");
  if (!validation) reasons.push("no validation evidence");
  else {
    if (validation.runId !== record.validationRunId) reasons.push("validation evidence is not the record's latest run");
    if (!validation.passed) reasons.push("validation did not pass");
    if (validation.ruleContentHash !== record.contentHash) reasons.push("validation evidence is for different rule content");
  }
  return { ok: reasons.length === 0, reasons };
}

export function approve(
  record: RuleRecord,
  validation: ValidationResult | undefined,
  approvedBy: string,
  scopeStatement: string,
  now: string,
): RuleRecord {
  const name = approvedBy.trim();
  const check = canApprove(record, validation);
  if (!name) check.reasons.push("approver name is required");
  if (check.reasons.length) throw new LifecycleError("approval refused: " + check.reasons.join("; "));
  const approved: RuleRecord = {
    ...record,
    status: "active",
    approvalRecord: {
      approvedAt: now,
      approvedBy: name,
      ruleContentHash: record.contentHash,
      validationRunId: record.validationRunId!,
      scopeStatement,
    },
    history: [...record.history, event(record, "approved", now, `Approved by ${name}`)],
  };
  return { ...approved, history: [...approved.history, event(approved, "activated", now, "Activated in the same step as approval")] };
}

export function revoke(record: RuleRecord, by: string, reason: string, now: string): RuleRecord {
  if (record.status !== "active") throw new LifecycleError(`only active rules can be revoked (status "${record.status}")`);
  const name = by.trim();
  if (!name) throw new LifecycleError("revoker name is required");
  return {
    ...record,
    status: "revoked",
    invalidationReason: reason,
    history: [...record.history, event(record, "revoked", now, `Revoked by ${name}: ${reason}. No fallback rule is activated.`)],
  };
}

/** Any edit produces a new draft: new hash, evidence and approval cleared. */
export function modify(record: RuleRecord, rule: ExtractionRule, now: string, why: string): RuleRecord {
  if (record.status === "revoked") throw new LifecycleError("a revoked rule cannot be modified; draft a new one");
  const { validationRunId: _v, approvalRecord: _a, invalidationReason: _i, ...rest } = record;
  void _v; void _a; void _i;
  return {
    ...rest,
    rule,
    contentHash: computeRuleHash(rule),
    status: "draft",
    history: [...record.history, event(record, "modified", now, `Modified (${why}); previous evidence and approval no longer apply`)],
  };
}

/** Re-hashes on load; a mismatch invalidates the record (storage tampering). */
export function verifyIntegrity(record: RuleRecord, now: string): RuleRecord {
  const fresh = computeRuleHash(record.rule);
  const approvalOk = record.status !== "active" || record.approvalRecord?.ruleContentHash === record.contentHash;
  if (fresh === record.contentHash && approvalOk) return record;
  if (record.status === "invalidated" || record.status === "revoked") return record;
  return {
    ...record,
    status: "invalidated",
    invalidationReason: "storage-integrity-error",
    history: [...record.history, event(record, "invalidated", now, "Stored rule no longer matches its hash or approval; invalidated")],
  };
}
