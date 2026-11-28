# Decisions and deviations from the Kiro design

The Kiro spec in `.kiro/specs/golden-path-application/` is preserved unchanged. Where the implementation departs from it, the reason is recorded here. Entries D1–D10 were made by Claude Code (28 Nov 2026) while taking over from Kiro.

| # | Design said | Implemented | Why |
|---|---|---|---|
| D1 | Line classification by `runExpression` (a search, `find()`), with separate `valueExpression` / `unitExpression` searches | Every classification must **fully** match its line (`runFullMatch`, `matches()`). Value and unit come from named groups `value` / `unit` of that same match. | A search accepts `HEMOGLOBIN … 13.5 g/dL … HIV REACTIVE`: the extra text vanishes and the report is accepted. This was verified against Kiro's draft. Separate value searches can also pick the wrong number. |
| D2 | `computeRuleHash = sha256(JSON.stringify(rule, Object.keys(rule).sort()))` | Recursive canonical JSON (keys sorted at every depth) plus a pure-TS SHA-256 | A replacer **array** is an allow-list applied at every depth, so nested fields (every pattern) are dropped from the hash and editing a pattern would not void approval. Requirement 6.4 would fail. Pure TS gives the same hash synchronously in Node and in the browser. It is tested against NIST vectors and `node:crypto`. |
| D3 | A tampered value means review; the line counts as "extracted" | A tampered value or unit mismatch makes the line **unexplained** and refuses the report | A value that is not a plain decimal is not explained by the rule. Counting it as extracted contradicted the line-accounting meaning. |
| D4 | No notion of required measurements | `required` (default true). A missing required measurement refuses the report (`lineNumber: -1`). | Without this, a truncated report is accepted with fewer results. |
| D5 | `numericValue: number` and float range checks; exponents accepted | Values stay printed strings (`^-?\d{1,9}(\.\d{1,6})?$`); exact decimal comparison | No floating point for clinical values (steering input). `1.35e1` is not a printed lab value. |
| D6 | A per-match timeout | Input limits (300 lines, 400 characters per line, 40,000 characters), plus a per-report budget checked **between lines** | JS cannot pre-empt a synchronous match. The hard bound is RE2's linear time plus the input limits. The budget is a post-hoc check, and the code and the UI say so. |
| D7 | BL-07 "timeout recovery" | BL-07 is "oversized input is refused before any matching" | It tests the mechanism that actually bounds work (D6). |
| D8 | Railway deployment: a Hono server with a JSON rule store, `AI_DEMO_MODE` env var | Static SPA on GitHub Pages. The engine, gate and lifecycle run in the visitor's browser, with state in `localStorage`. | No shared mutable state between judges, no server to keep warm, no credentials in the hosted demo, and nothing to attack server-side. Demo mode is the only mode of the hosted build. |
| D9 | Demo recordings described as JSON files with metadata | The recordings are **real** responses from `claude-sonnet-5-5`, obtained by sending the exact prompt (`onboarding-prompt.ts`) through `claude -p` with tools disabled (`scripts/record-drafts.ts`). They are stored unedited, with capture time and prompt hash. | Honesty: what the demo replays is what a real model produced for that exact prompt. |
| D10 | Separate `/validate` and `/approve` views | Gate and approval are steps of `/onboard`; past runs are at `/evidence/:runId` | Fewer screens for judges; same information. |

## Findings recorded during the work
- **Parser vs prompt mismatch.** The prompt allows `""` for blank lines, but the first parser version rejected empty patterns, so the CBC recording failed to parse. The parser was fixed to allow empty **line** patterns (an empty pattern fully matches only an empty line). Empty **layout** patterns are still rejected. The recording was not edited.
- **All three real AI drafts passed the gate** at the first attempt (41–45 cases each). The demo therefore shows the gate *catching* a bad rule through an explicit operator edit ("possess this rule"), clearly labelled as such, rather than through a fabricated bad AI response.
- **What the gate does not test:**
  - Fields that a rule declares variable (IDs, dates, reference ranges) accept any value of their declared shape.
  - The unit case is generated only when the rule declares `expectedUnit`.
