/**
 * Runs a recorded AI draft through parseRuleProposal and the validation gate
 * and prints the outcome (Claude Code). Optionally writes failed-case feedback
 * for a re-draft: node scripts/gate-recording.ts <file> [--feedback-out f.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseRuleProposal, runValidationGate } from "../packages/core/dist/index.js";
import { LAYOUT_SAMPLES } from "../packages/app/src/frontend/demo/samples.ts";

const rec = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const parsed = parseRuleProposal(rec.responseText);
if (!parsed.ok || !parsed.rule) {
  console.log("PARSE FAILED:", parsed.errors);
  process.exit(1);
}
const sample = LAYOUT_SAMPLES[rec.layoutId as keyof typeof LAYOUT_SAMPLES];
const others = Object.values(LAYOUT_SAMPLES).filter((s) => s.layoutId !== rec.layoutId);
const result = runValidationGate({ rule: parsed.rule, sampleLines: sample.lines, otherLayoutSamples: others, ranAt: "2026-11-28T00:00:00.000Z" });
console.log(`gate passed=${result.passed} cases=${result.cases.length} failed=${result.cases.filter((c) => !c.passed).length}`);
const failed = result.cases.filter((c) => !c.passed).map((c) => `${c.caseId}: ${c.caseLabel} — ${c.failureDetail}`);
for (const f of failed) console.log("  FAIL", f);
const fo = process.argv.indexOf("--feedback-out");
if (fo > 0) writeFileSync(process.argv[fo + 1]!, JSON.stringify(failed, null, 2));
