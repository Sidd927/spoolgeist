/**
 * End-to-end demo flow tests on the real recorded AI drafts (Claude Code).
 * These run the exact code path the hosted demo uses, without a browser.
 */
import { describe, it, expect } from "vitest";
import { computeRuleHash, parseRuleProposal } from "@spoolgeist/core";
import { DEMO_REPORTS, LIPID_ONBOARD, LIPID_REPEAT } from "../demo/samples.js";
import { RECORDINGS } from "../demo/recordings.js";
import {
  approveRecord, draftFromRecording, loadState, makeReport, modifyRecord, process, revokeRecord, runGate, seedState, splitLines,
} from "../state.js";

const NOW = "2026-11-28T12:00:00.000Z";

describe("demo scenarios", () => {
  const state = seedState();

  it.each(DEMO_REPORTS.filter((d) => d.id !== "lipid-repeat"))("$id → $expect", (d) => {
    const r = process(state, makeReport(d.lines, d.id, NOW, "demo"));
    expect(r.state).toBe(d.expect);
    expect(r.aiCallCount).toBe(0);
  });

  it("seeds exactly two active rules, approved by the labelled demo seed", () => {
    expect(state.records.map((r) => [r.rule.layoutId, r.status])).toEqual([["cbc", "active"], ["bmp", "active"]]);
    for (const r of state.records) {
      expect(r.approvalRecord?.approvedBy).toMatch(/^Demo seed/);
      expect(r.proposalSource?.kind).toBe("recorded-ai");
      expect(state.validations[r.validationRunId!]?.passed).toBe(true);
    }
  });

  it("recordings carry honest metadata and the hash of the exact prompt", async () => {
    const { promptHash } = await import("@spoolgeist/core");
    for (const rec of Object.values(RECORDINGS)) {
      expect(promptHash(rec.prompt)).toBe(rec.promptHash);
      expect(rec.aiModel).toMatch(/^claude-/);
      expect(Date.parse(rec.capturedAt)).not.toBeNaN();
    }
  });
});

describe("golden path: unknown layout → recorded AI draft → gate → approval → zero-AI repeat", () => {
  it("runs end to end", () => {
    let s = seedState();
    expect(process(s, makeReport(LIPID_ONBOARD, "l1", NOW, "demo")).state).toBe("layout-mismatch");

    const d = draftFromRecording(s, RECORDINGS.lipid, NOW);
    expect(d.errors).toEqual([]);
    s = d.state;
    expect(d.draft!.status).toBe("draft");
    expect(process(s, makeReport(LIPID_ONBOARD, "l1", NOW, "demo")).state).toBe("layout-mismatch"); // draft cannot process

    const g = runGate(s, d.draft!, LIPID_ONBOARD, NOW);
    s = g.state;
    expect(g.result.passed).toBe(true);
    expect(g.record.status).toBe("validated");
    expect(() => approveRecord(s, g.record, "", "scope", NOW)).toThrow();

    const a = approveRecord(s, g.record, "A. Reviewer", "Synthetic lipid reports only", NOW);
    s = a.state;
    expect(a.record.status).toBe("active");

    const repeat = process(s, makeReport(LIPID_REPEAT, "l2", NOW, "demo"));
    expect(repeat.state).toBe("accepted");
    expect(repeat.aiCallCount).toBe(0);
    expect(repeat.extractedValues.map((v) => v.rawValue)).toEqual(["187", "102", "58", "95"]);

    // Possess the rule: loosen the comment pattern. Approval is lost and the gate fails.
    const loosened = structuredClone(a.record.rule);
    const idx = loosened.lineClassifications.findIndex((c) => c.lineMatchExpression.startsWith("COMMENT"));
    expect(idx).toBeGreaterThan(-1);
    (loosened.lineClassifications[idx] as { lineMatchExpression: string }).lineMatchExpression = "COMMENT: .*";
    const m = modifyRecord(s, a.record, loosened, NOW, "loosened comment pattern");
    s = m.state;
    expect(m.record.status).toBe("draft");
    expect(process(s, makeReport(LIPID_REPEAT, "l3", NOW, "demo")).state).toBe("layout-mismatch");
    const g2 = runGate(s, m.record, LIPID_ONBOARD, "2026-11-28T12:05:00.000Z");
    expect(g2.result.passed).toBe(false);
    expect(g2.record.status).toBe("validation-failed");
  });

  it("revoking a layout's rule leaves it unrecognised (no fallback)", () => {
    let s = seedState();
    s = revokeRecord(s, s.records[0]!, "A. Reviewer", "test", NOW);
    expect(process(s, makeReport(DEMO_REPORTS[0]!.lines, "x", NOW, "demo")).state).toBe("layout-mismatch");
  });

  it("detects a rule edited in browser storage and invalidates it", () => {
    const s = seedState();
    const tampered = structuredClone(s);
    (tampered.records[0]!.rule.lineClassifications[0] as { lineMatchExpression: string }).lineMatchExpression = ".*";
    const store = { getItem: () => JSON.stringify(tampered) };
    const loaded = loadState(store, NOW);
    expect(loaded.records[0]!.status).toBe("invalidated");
    expect(computeRuleHash(loaded.records[0]!.rule)).not.toBe(loaded.records[0]!.contentHash);
  });

  it("splitLines normalises CRLF and a single trailing newline", () => {
    expect(splitLines("A\r\nB\n")).toEqual(["A", "B"]);
    expect(splitLines("A\n\n")).toEqual(["A", ""]);
  });

  it("every recording parses", () => {
    for (const rec of Object.values(RECORDINGS)) expect(parseRuleProposal(rec.responseText).ok).toBe(true);
  });
});
