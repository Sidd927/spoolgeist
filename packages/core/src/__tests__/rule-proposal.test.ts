/** Untrusted proposal parsing tests (Claude Code). */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseRuleProposal } from "../rule-proposal.js";
import { cbcRule } from "./fixtures.js";

describe("parseRuleProposal", () => {
  it("round-trips a well-formed rule, including inside a ```json fence", () => {
    const rule = cbcRule();
    const r = parseRuleProposal("Here is the rule:\n```json\n" + JSON.stringify(rule, null, 2) + "\n```");
    expect(r.errors).toEqual([]);
    expect(r.rule).toEqual(rule);
  });

  it("rejects backreferences and lookarounds (Property 11)", () => {
    for (const p of ["(a)\\1", "HGB(?=x)", "(?<=x)HGB", "(?!x)"]) {
      const rule = { ...cbcRule(), layoutMatchExpression: p };
      const r = parseRuleProposal(JSON.stringify(rule));
      expect(r.ok).toBe(false);
      expect(r.errors.join(" ")).toMatch(/not valid RE2/);
    }
  });

  it("rejects missing extracts, duplicate ids, bad ranges, unknown kinds", () => {
    const base = cbcRule();
    const bad = {
      ...base,
      lineClassifications: [
        { kind: "extract", measurementId: "a", measurementName: "A", lineMatchExpression: "A (?P<value>\\S+)", plausibleRange: { min: 5, max: 1 } },
        { kind: "extract", measurementId: "a", measurementName: "A2", lineMatchExpression: "B (?P<value>\\S+)" },
        { kind: "approve-yourself", lineMatchExpression: "x" },
      ],
    };
    const r = parseRuleProposal(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/plausibleRange/);
    expect(r.errors.join("\n")).toMatch(/duplicated/);
    expect(r.errors.join("\n")).toMatch(/kind must be/);
    expect(parseRuleProposal(JSON.stringify({ ...base, lineClassifications: [{ kind: "footer", lineMatchExpression: "x" }] })).errors).toContain("a rule must extract at least one measurement");
  });

  it("allows an empty line pattern (blank lines) but not an empty layout pattern", () => {
    const base = cbcRule();
    const withBlank = { ...base, lineClassifications: [...base.lineClassifications, { kind: "ignore", reason: "blank", lineMatchExpression: "" }] };
    expect(parseRuleProposal(JSON.stringify(withBlank)).ok).toBe(true);
    expect(parseRuleProposal(JSON.stringify({ ...base, layoutMatchExpression: "" })).ok).toBe(false);
  });

  it("ignores any status/approval fields an AI might include", () => {
    const r = parseRuleProposal(JSON.stringify({ ...cbcRule(), status: "active", approvalRecord: { approvedBy: "AI" } }));
    expect(r.ok).toBe(true);
    expect(r.rule).not.toHaveProperty("status");
    expect(r.rule).not.toHaveProperty("approvalRecord");
  });

  it("handles adversarial fence-heavy output in linear time", () => {
    const evil = "```" + " ".repeat(49_000);
    const evil2 = "```json\n".repeat(5_000);
    const t0 = performance.now();
    expect(parseRuleProposal(evil).ok).toBe(false);
    expect(parseRuleProposal(evil2).ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("never throws on arbitrary input", () => {
    fc.assert(fc.property(fc.string({ maxLength: 500 }), (s) => {
      const r = parseRuleProposal(s);
      expect(typeof r.ok).toBe("boolean");
    }), { numRuns: 500 });
    fc.assert(fc.property(fc.json(), (s) => {
      expect(typeof parseRuleProposal(s).ok).toBe("boolean");
    }), { numRuns: 500 });
  });
});
