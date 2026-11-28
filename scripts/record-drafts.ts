/**
 * Records REAL AI rule drafts for the demo (Claude Code, 28 Nov 2026).
 *
 * For each layout it builds the exact onboarding prompt, sends it to a real
 * model through the locally installed `claude` CLI (print mode), and saves the
 * raw response with honest metadata: model, recordedAt, promptHash, prompt
 * version. The hosted demo replays these files and labels them "recorded".
 * Responses are saved unedited, whether or not they pass the gate.
 *
 * Usage: npm run build -w packages/core && node scripts/record-drafts.ts <layout> [attempt] [--feedback-from <file>]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { buildDraftPrompt, promptHash, DRAFT_PROMPT_VERSION } from "../packages/core/dist/index.js";
import { LAYOUT_SAMPLES } from "../packages/app/src/frontend/demo/samples.ts";

const MODEL = process.env.DRAFT_MODEL ?? "claude-sonnet-5-5";
const layout = process.argv[2] as keyof typeof LAYOUT_SAMPLES;
const attempt = Number(process.argv[3] ?? "1");
const fbIdx = process.argv.indexOf("--feedback-from");
const feedback: string[] = fbIdx > 0 ? JSON.parse(readFileSync(process.argv[fbIdx + 1]!, "utf8")) : [];
const sample = LAYOUT_SAMPLES[layout];
if (!sample) throw new Error("usage: record-drafts.ts cbc|bmp|lipid [attempt]");

const createdAt = "2026-11-28T00:00:00.000Z";
const prompt = buildDraftPrompt({
  lines: sample.lines,
  layoutId: sample.layoutId,
  layoutName: sample.layoutName,
  createdAt,
  ...(feedback.length ? { gateFeedback: feedback } : {}),
});
const recordedAt = new Date().toISOString();
const out = execFileSync("claude", ["-p", "--model", MODEL, "--output-format", "json", "--tools", ""], {
  input: prompt,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
const parsed = JSON.parse(out) as { result?: string; is_error?: boolean };
if (parsed.is_error || typeof parsed.result !== "string") throw new Error("CLI call failed: " + out.slice(0, 500));

const file = `packages/app/src/frontend/demo/recordings/${layout}-attempt${attempt}.json`;
writeFileSync(
  file,
  JSON.stringify(
    {
      layoutId: sample.layoutId,
      attempt,
      capturedAt: recordedAt,
      aiModel: MODEL,
      via: "claude CLI print mode (claude -p), no tools",
      promptVersion: DRAFT_PROMPT_VERSION,
      promptHash: promptHash(prompt),
      prompt,
      responseText: parsed.result,
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote", file);
