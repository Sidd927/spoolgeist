/** Rule lifecycle tests (Claude Code). Properties 6, 7, 10. */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { approve, canApprove, createDraft, LifecycleError, modify, recordValidation, revoke, verifyIntegrity } from "../rule-lifecycle.js";
import { runValidationGate } from "../validation-gate.js";
import { processReport, processWithRegistry, IntegrityError } from "../engine.js";
import type { ExtractionRule, RuleRecord } from "../types.js";
import { CBC_LINES, cbcRule, report } from "./fixtures.js";

const T = "2026-11-28T12:00:00.000Z";
const src = { kind: "recorded-ai" as const, model: "test-model" };

function validated(rule: ExtractionRule = cbcRule()) {
  const draft = createDraft(rule, src, T);
  const v = runValidationGate({ rule, sampleLines: CBC_LINES, ranAt: T });
  return { rec: recordValidation(draft, v, T), v };
}

describe("rule lifecycle", () => {
  it("P10: a proposal always enters as a draft and cannot process reports", () => {
    const d = createDraft(cbcRule(), src, T);
    expect(d.status).toBe("draft");
    expect(d.approvalRecord).toBeUndefined();
    expect(() => processReport(report(CBC_LINES), d)).toThrow();
  });

  it("golden path: draft → validated → active (typed name) → processes with zero AI", () => {
    const { rec, v } = validated();
    expect(rec.status).toBe("validated");
    const active = approve(rec, v, "  Dr. Synthetic Reviewer ", "Synthetic CBC layout v1 only", T);
    expect(active.status).toBe("active");
    expect(active.approvalRecord).toMatchObject({ approvedBy: "Dr. Synthetic Reviewer", ruleContentHash: active.contentHash, validationRunId: v.runId });
    expect(active.history.map((e) => e.eventType)).toEqual(["created", "validation-passed", "approved", "activated"]);
    const r = processWithRegistry(report(CBC_LINES), [active]);
    expect(r.state).toBe("accepted");
    expect(r.aiCallCount).toBe(0);
  });

  it("P6: approval requires a typed name", () => {
    const { rec, v } = validated();
    expect(() => approve(rec, v, "   ", "s", T)).toThrow(/approver name is required/);
  });

  it("P6: approval is refused without passing evidence for this exact content", () => {
    const { rec, v } = validated();
    expect(canApprove(rec, undefined).ok).toBe(false);
    expect(canApprove(rec, { ...v, passed: false }).ok).toBe(false);
    expect(canApprove(rec, { ...v, ruleContentHash: "f".repeat(64) }).ok).toBe(false);
    expect(canApprove({ ...rec, status: "draft" }, v).ok).toBe(false);
    const tampered: RuleRecord = { ...rec, rule: { ...rec.rule, layoutName: "edited" } };
    expect(canApprove(tampered, v).reasons).toContain("rule content changed since it was hashed");
  });

  it("a failing gate records validation-failed and blocks approval", () => {
    const base = cbcRule();
    const loose = { ...base, lineClassifications: [...base.lineClassifications, { kind: "ignore" as const, reason: "x", lineMatchExpression: ".*" }] };
    const draft = createDraft(loose, src, T);
    const v = runValidationGate({ rule: loose, sampleLines: CBC_LINES, ranAt: T });
    const rec = recordValidation(draft, v, T);
    expect(rec.status).toBe("validation-failed");
    expect(() => approve(rec, v, "Someone", "s", T)).toThrow(LifecycleError);
  });

  it("refuses to record evidence produced for different content", () => {
    const draft = createDraft(cbcRule(), src, T);
    const other = runValidationGate({ rule: { ...cbcRule(), layoutName: "Other" }, sampleLines: CBC_LINES, ranAt: T });
    expect(() => recordValidation(draft, other, T)).toThrow(/does not belong/);
  });

  it("P7: modifying a rule returns a draft and clears evidence and approval", () => {
    const { rec, v } = validated();
    const active = approve(rec, v, "R", "s", T);
    const changed = modify(active, { ...active.rule, layoutVersion: 2 }, T, "operator edit");
    expect(changed.status).toBe("draft");
    expect(changed.contentHash).not.toBe(active.contentHash);
    expect(changed.approvalRecord).toBeUndefined();
    expect(changed.validationRunId).toBeUndefined();
  });

  it("P7 (property): any change to any pattern invalidates a stored active record", () => {
    const { rec, v } = validated();
    const active = approve(rec, v, "R", "s", T);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: active.rule.lineClassifications.length - 1 }), fc.string({ minLength: 1, maxLength: 5 }), (i, s) => {
        const rule = structuredClone(active.rule) as ExtractionRule;
        (rule.lineClassifications[i] as { lineMatchExpression: string }).lineMatchExpression += s;
        const tampered: RuleRecord = { ...active, rule };
        expect(verifyIntegrity(tampered, T).status).toBe("invalidated");
        expect(() => processReport(report(CBC_LINES), tampered)).toThrow(IntegrityError);
      }),
      { numRuns: 100 },
    );
    expect(verifyIntegrity(active, T)).toBe(active);
  });

  it("revocation leaves the layout with NO active rule (no fallback)", () => {
    const { rec, v } = validated();
    const active = approve(rec, v, "R", "s", T);
    const revoked = revoke(active, "R", "test", T);
    expect(revoked.status).toBe("revoked");
    expect(processWithRegistry(report(CBC_LINES), [revoked]).state).toBe("layout-mismatch");
    expect(() => revoke(revoked, "R", "again", T)).toThrow(LifecycleError);
    expect(() => revoke(active, " ", "no name", T)).toThrow(/name/);
  });
});
