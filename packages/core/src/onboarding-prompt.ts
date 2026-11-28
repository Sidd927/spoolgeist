/**
 * onboarding-prompt.ts — the exact prompt sent to an AI model to DRAFT a rule
 * for an unknown layout. Written by Claude Code.
 *
 * The prompt is pure data so the UI can show it verbatim and its SHA-256 can
 * be recorded with every AI response (recorded or live). The model's answer
 * is untrusted text: it goes through parseRuleProposal → validation gate →
 * named human approval before it can ever process a report.
 */
import { sha256Hex } from "./rule-hash.js";

export const DRAFT_PROMPT_VERSION = "draft-prompt/v1";

export interface DraftPromptInput {
  lines: readonly string[];
  layoutId: string;
  layoutName: string;
  createdAt: string;
  /** Failed gate cases from a previous attempt, for a re-draft. */
  gateFeedback?: readonly string[];
}

export function buildDraftPrompt(input: DraftPromptInput): string {
  const numbered = input.lines.map((l, i) => `${String(i + 1).padStart(3, " ")}|${l}`).join("\n");
  const feedback = input.gateFeedback?.length
    ? `\nA previous draft of this rule FAILED the validation gate. Failed cases:\n${input.gateFeedback.map((f) => "- " + f).join("\n")}\nFix the rule so these mutations are refused or escalated, without making it accept anything new.\n`
    : "";
  return `You are drafting a declarative parsing rule for a legacy laboratory report layout.
The rule will be checked by an adversarial validation gate and must be approved by a named human before use.
After approval it runs WITHOUT any AI, on every future report of this layout.
All data below is SYNTHETIC test data.

How the engine uses the rule:
- layoutMatchExpression is searched for anywhere in the report text; it must identify THIS layout and no other (pick a distinctive literal such as a report code).
- Every report line must FULLY match exactly one lineClassifications entry (first match wins). The whole line must match, not a substring.
- Any line that matches nothing makes the whole report a refusal. That is intended: unexplained content must never pass.
- "extract" entries must capture the printed value in a named group (?P<value>...) and the printed unit in (?P<unit>...); set expectedUnit to the unit exactly as printed.
- Values must be plain decimals as printed; the engine rejects anything else.

Pattern rules (RE2 syntax):
- No backreferences, no lookahead or lookbehind.
- Be strict: write literal text literally and escape regex metacharacters ( . ( ) [ ] * + ? ^ $ | \\ { } ).
- Never use .* or other catch-alls to absorb text; a pattern that tolerates extra text lets tampered content through, and the gate tests for exactly that.
- Use " +" between columns (column widths vary with value length); use [0-9.]+ or \\S+ for the value group.
- Identifiers, dates and times that vary per report may use precise classes like SYN-[0-9]{5} or [0-9]{4}-[0-9]{2}-[0-9]{2}.
- Blank lines need their own classification (lineMatchExpression "" or " *").

Output ONLY one JSON object, no prose, with this TypeScript shape:
{
  "ruleId": "rule-${input.layoutId}-v1",
  "layoutId": "${input.layoutId}",
  "layoutName": "${input.layoutName}",
  "layoutVersion": 1,
  "layoutMatchExpression": string,
  "lineClassifications": Array<
    | { "kind": "header" | "footer"; "lineMatchExpression": string }
    | { "kind": "ignore"; "reason": string; "lineMatchExpression": string }
    | { "kind": "extract"; "measurementId": string /* short lowercase id */; "measurementName": string;
        "lineMatchExpression": string; "expectedUnit": string; "required": true;
        "plausibleRange": { "min": number; "max": number } /* wide physiological limits, NOT the reference range */ }
  >,
  "plausibilityChecks": [],
  "metadata": { "createdAt": "${input.createdAt}", "draftedBy": "ai" }
}
${feedback}
The report (line numbers and "|" are NOT part of the text):
${numbered}
`;
}

export function promptHash(prompt: string): string {
  return sha256Hex(prompt);
}
