# Spoolgeist

**AI may propose. Deterministic systems verify. Humans approve. Unexplained data remains visible.**

Old hospital systems can often only *print* their results. Spoolgeist reads those printouts:
1. For an unfamiliar layout, an AI drafts a parsing rule **once**.
2. The rule must survive an adversarial validation gate, then a named human's approval bound to its exact content hash.
3. From then on, every report of that layout is parsed **deterministically, with zero AI calls**.
4. Any line the rule cannot fully explain refuses the whole report, and the line is shown. It is never silently dropped.

> **Synthetic data only.** Spoolgeist is a Kiroween 2026 prototype (Resurrection category). It is not a medical device, is not clinically validated, and must not be used with real patient data.

**Live demo:** https://sidd927.github.io/spoolgeist/ (static, runs entirely in your browser)

## What to try (3 minutes)
1. **Process → "CBC · a whisper on the hemoglobin line".** `HIV REACTIVE` is appended to a result line. A substring parser still reads `13.5` and succeeds. Spoolgeist refuses the report and marks the line with the ghost.
2. **"CBC · clean".** The report is accepted. Click a value to see the exact printed characters it came from.
3. **"Lipid profile · unknown layout" → Onboard.**
   - A recorded real AI draft appears.
   - The gate runs 41 mutations.
   - You approve it with your name.
   - **"Next patient"** is then parsed with 0 AI calls.
4. **Rules → "Possess this rule 👻".** This loosens a pattern of the active rule. The hash changes, the approval is void, and re-running the gate catches it.

## How it works
```
packages/core   pure TypeScript, no I/O
  engine.ts            processReport: full-line RE2 matching, line accounting, fail-closed
  expression-runner.ts re2js wrapper: linear time; no backreferences or lookarounds
  rule-hash.ts         canonical JSON + SHA-256 (same result in Node and the browser)
  decimal.ts           exact decimal handling (no floats)
  validation-gate.ts   baseline BL-01..08 + layout-specific mutations
  rule-lifecycle.ts    draft → validated → active (typed name) → revoked / invalidated
  rule-proposal.ts     parses UNTRUSTED model output
  onboarding-prompt.ts the exact prompt sent to the model (versioned, hashed)
packages/app    React SPA (Greenbar design system); demo data and recordings
scripts/        record-drafts.ts (real model call), gate-recording.ts
.kiro/          Kiro spec: requirements, design, task plan
```
The engine produces exactly one of four states:
- **accepted:** every line is explained and every value is plausible;
- **refusal:** an unexplained line, a tampered value, a unit change or a missing measurement;
- **review:** a duplicate or implausible value, which a human must decide;
- **layout-mismatch:** no active rule recognises the printout.

Every result carries `aiCallCount: 0`, a literal type the code cannot set to anything else.

## Run and test
Requires Node 22 or later.
```bash
npm ci
```
```bash
npm test
```
```bash
npm run typecheck
```
```bash
npm run build && npm run preview -w packages/app
```

## Honest limitations
- **What the gate checks:** a fixed suite of synthetic mutations. It does not prove a rule correct. Fields a rule declares variable (IDs, dates, reference ranges) accept any value of their shape.
- **The hosted demo:** it replays **recorded** real model responses and makes no live AI calls. Two layouts are pre-approved by a clearly labelled demo seed. State lives in your browser's `localStorage`.
- **Time limits:** the per-report time budget is checked between lines, not pre-emptively. The real bound is RE2's linear-time matching plus the input-size limits.
- **Input format:** plain-text printouts only. Real print streams (PCL/PostScript, code pages, RAW port 9100 capture) are out of scope for this build.

More detail: [docs/DECISIONS.md](docs/DECISIONS.md), [docs/EXECUTION_TRACKER.md](docs/EXECUTION_TRACKER.md).

## How it was built
- **Kiro** produced the spec in `/.kiro` and the first implementation tasks.
- When the Kiro credits ran out, development continued with **Claude Code**.
- Claude Code's commits name it in their messages. Kiro's task commits (Tasks 1, 2, 3.1 and 4.1) match the execution history Kiro wrote to `.kiro/specs/golden-path-application/tasks.meta.json`. See [PRIOR_WORK.md](PRIOR_WORK.md).

## Licence
MIT.
