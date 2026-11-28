# Implementation Plan: Spoolgeist Golden-Path Application

## Overview

The implementation is split into six ordered groups. Groups 1–2 deliver a fully testable engine core. Group 3 adds the API layer, making the golden path exercisable via HTTP. Group 4 builds the React frontend so the judge-facing demo is complete. Group 5 adds demo polish. Group 6 covers optional stretch goals.

Language: **TypeScript** (full-stack, as specified in the design).

---

## Tasks

### Group 1 — Skeleton and Engine Core

- [x] 1. Scaffold monorepo structure and toolchain
  - Create the npm workspace root `package.json` with two workspaces: `packages/core` and `packages/app`
  - Create `packages/core/package.json` (name: `@spoolgeist/core`, private, ESM) with `typescript`, `vitest`, `fast-check`, `@fast-check/vitest`, `re2js` as dependencies
  - Create `packages/app/package.json` (name: `@spoolgeist/app`, private, ESM) with `hono`, `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `zod`, dependency on `@spoolgeist/core`
  - Create root `tsconfig.base.json` (strict, ESM, NodeNext resolution) and per-package `tsconfig.json` files extending it
  - Create `vitest.workspace.ts` at root referencing both packages
  - Create a minimal `Dockerfile` stub (`FROM node:22-alpine`, `WORKDIR /app`, placeholder `CMD`) — will be completed in task 28
  - Create `packages/core/src/index.ts` and `packages/app/src/server.ts` as empty entry points so the workspace resolves
  - _Requirements: 10.3 (original implementation in this repository)_

- [x] 2. Define shared TypeScript types and interfaces
  - Create `packages/core/src/types.ts` containing all interfaces and types from the design document:
    `Report`, `ExtractionRule`, `LineClassification` (union of extract/ignore/header/footer), `PlausibilityCheck`, `ContentHash`, `RuleStatus`, `RuleRecord`, `ApprovalRecord`, `RuleEvent`, `ValidationResult`, `ValidationCase`, `ProcessingState`, `ProcessingResult`, `ExtractedValue`, `Provenance`, `LineAccountingSummary`, `LineEntry`, `OffendingLine`, `SuspiciousItem`
  - Ensure `ProcessingResult.aiCallCount` is typed as the literal `0` (not `number`) to enforce the zero-AI invariant at the type level
  - Export all types from `packages/core/src/index.ts`
  - Add `computeRuleHash(rule: ExtractionRule): string` stub (implementation in task 7)
  - _Requirements: 9.1–9.12 (type-level safety properties), Design: Data Models section_

- [x] 3. Implement ExpressionRunner (re2js wrapper)
  - [x] 3.1 Implement `packages/core/src/expression-runner.ts`
    - Import `RE2JS` from `re2js`
    - Implement `compileExpression(pattern: string): CompiledExpression` — calls `RE2JS.compile(pattern)`, throws `PatternSyntaxException` on invalid syntax (backreferences `\1`, lookaheads `(?=`, `(?!`, `(?<=`, `(?<!`)
    - Implement `runExpression(expr: CompiledExpression, input: string, timeoutMs?: number): RegExpMatchArray | null` — executes `matcher.find()`, measures `performance.now()` delta, throws `ExpressionTimeoutError` if elapsed exceeds `timeoutMs` (default 500 ms), extracts named capture groups
    - Implement `extractNamedGroups(matcher): Record<string, string>` helper
    - Define and export `ExpressionTimeoutError` and `CompiledExpression` types
    - _Requirements: 11.1, 11.2, 11.3; Design: Safe Expression Execution section_
  - [ ]* 3.2 Write property tests for ExpressionRunner (Properties 11 and 12)
    - **Property 11: Compile-time rejection of unsafe syntax**
    - Generate arbitrary strings containing backreference tokens (`\1`–`\9`) and lookahead/lookbehind prefixes; assert `compileExpression()` always throws `PatternSyntaxException`
    - **Property 12: Timeout enforcement**
    - For expressions run against inputs that exceed `timeoutMs`, assert the return is a Refusal-equivalent (ExpressionTimeoutError thrown), never a partial result
    - **Validates: Requirements 11.1, 11.3 (Property 11) and 11.2 (Property 12)**

- [x] 4. Implement LayoutDetector
  - [x] 4.1 Implement `packages/core/src/layout-detector.ts`
    - Implement `detectLayout(report: Report, activeRules: RuleRecord[]): RuleRecord | null`
    - Join `report.lines` and test each active rule's `layoutMatchExpression` via `runExpression` in order; return the first match or `null`
    - Pure function: no I/O, no mutations, no AI calls
    - _Requirements: 9.2; Design: LayoutDetector component_
  - [ ]* 4.2 Write unit tests for LayoutDetector
    - Report matching the first rule returns that rule
    - Report matching no rules returns `null`
    - Multiple matching rules returns the first one (order matters)
    - _Requirements: 9.2_

- [ ] 5. Implement ExtractionEngine core
  - [ ] 5.1 Implement `packages/core/src/engine.ts`
    - Implement `processReport(report: Report, rule: RuleRecord): ProcessingResult`
    - Throw if `rule.status !== "active"` (never process under a non-active rule)
    - Verify `rule.contentHash === rule.approvalRecord!.ruleContentHash`; if mismatch, throw `IntegrityError`
    - Apply `LayoutDetector.detectLayout` to verify the report matches the rule's layout; if not, return `{ state: "layout-mismatch", aiCallCount: 0, ... }`
    - For each line, iterate `rule.rule.lineClassifications` in order (first match wins); unmatched lines are "unexplained"
    - For "extract" classifications, run `valueExpression` and `unitExpression` via `ExpressionRunner`; populate `ExtractedValue` with full `Provenance` (lineNumber, lineContent, matchedExpression, captureGroup, startOffset, endOffset)
    - Collect `LineAccountingSummary`: enforce `totalLines === extractedLines + ignoredLines + unexplainedLines`
    - If `unexplainedLines > 0`: return Refusal state with `offendingLines`
    - Run `PlausibilityCheck`s on extracted values; if any flag suspicious items, return Review state
    - Otherwise return Accepted state with `extractedValues`
    - `aiCallCount` MUST be the literal `0` in all return paths
    - _Requirements: 2.1–2.6, 3.1–3.6, 9.1–9.12; Design: ExtractionEngine component, Processing Lifecycle section_
  - [ ]* 5.2 Write unit tests for ExtractionEngine
    - Clean CBC Panel report → Accepted state with correct extracted values and provenance
    - Same report with one injected line → Refusal state, injected line in `offendingLines`
    - Report with measurement value replaced by `@@@@` → Refusal state, reason `"tampered-value"`
    - Report matching wrong layout → Refusal, reason `"layout-mismatch"`
    - Report with out-of-range measurement → Review state, suspicious item present
    - Non-active rule → throws immediately
    - Hash mismatch → throws `IntegrityError`
    - _Requirements: 2.1–2.6, 3.1–3.6_

- [ ] 6. Write property-based tests for ExtractionEngine (Properties 1–4, 9)
  - [ ]* 6.1 Property 1: Master Safety Invariant
    - Generate arbitrary `(Report, ApprovedRule)` pairs using fast-check arbitraries
    - Assert: if `lineAccounting.unexplainedLines > 0` OR `suspiciousContent.length > 0` OR `rule.contentHash !== rule.approvalRecord.ruleContentHash`, then `result.state !== "accepted"`
    - Contrapositive: `result.state === "accepted"` implies all three conditions hold simultaneously
    - **Validates: Requirements 9.1, 2.3, 3.1, 3.4, 3.6**
  - [ ]* 6.2 Property 2: Determinism / Pure Function
    - Generate arbitrary `(report, approvedRule)` pairs; run `processReport` twice
    - Assert `JSON.stringify(result1) === JSON.stringify(result2)`
    - **Validates: Requirements 2.5, 7.3, 9.7**
  - [ ]* 6.3 Property 3: Line Accounting Completeness
    - Generate arbitrary reports with any rule configuration
    - Assert `summary.extractedLines + summary.ignoredLines + summary.unexplainedLines === report.lines.length`
    - **Validates: Requirement 2.2**
  - [ ]* 6.4 Property 4: Provenance Completeness
    - Generate scenarios that produce at least one extracted value
    - Assert every `extractedValue.provenance.lineNumber` is in `[0, report.lines.length)`
    - Assert `extractedValue.provenance.lineContent === report.lines[provenance.lineNumber]`
    - **Validates: Requirements 2.6, 9.10**
  - [ ]* 6.5 Property 9: AI-Call-Count Invariant
    - Generate arbitrary `(report, approvedRule)` pairs
    - Assert `result.aiCallCount === 0` for every invocation of `processReport`
    - **Validates: Requirements 2.1, 2.4, 4.5, 7.1, 7.2, 9.8**

- [ ] 7. Checkpoint — Group 1 complete
  - Ensure all tests pass, ask the user if questions arise.

---

### Group 2 — Rule Lifecycle and Validation Gate

- [ ] 8. Implement RuleStore
  - Implement `packages/core/src/rule-store.ts`
  - Implement `computeRuleHash(rule: ExtractionRule): string` — SHA-256 of `JSON.stringify(rule, Object.keys(rule).sort())`
  - Implement `RuleStore` class with:
    - `load(): Promise<RuleRecord[]>` — reads JSON file at `RULE_STORE_PATH`, recomputes content hash for every record on load; if stored hash doesn't match freshly computed hash, transitions record to `"invalidated"` with reason `"storage-integrity-error"`
    - `save(records: RuleRecord[]): Promise<void>` — atomic write (write to temp file, rename) with in-memory mutex for concurrency
    - `get(ruleId: string): RuleRecord | null`
    - `upsert(record: RuleRecord): Promise<void>`
  - Export singleton `ruleStore` instance
  - _Requirements: 6.2, 6.4, 6.5, 9.6; Design: RuleStore component, Modification Detection section_

- [ ] 9. Implement RuleLifecycle state machine
  - [ ] 9.1 Implement `packages/core/src/rule-lifecycle.ts`
    - Implement `canApprove(record: RuleRecord, validationStore: Map<string, ValidationResult>): boolean` — checks `status === "validated"`, `validationRunId !== null`, `ValidationResult.passed === true`, `ValidationResult.ruleContentHash === record.contentHash`
    - Implement state transition functions, each returning an updated `RuleRecord` and appending to `record.history`:
      - `createDraft(rule: ExtractionRule, draftedBy: "ai" | "operator"): RuleRecord`
      - `markValidationFailed(record, validationRunId): RuleRecord`
      - `markValidated(record, validationRunId): RuleRecord`
      - `modifyRule(record, patch): RuleRecord` — recomputes hash, clears `validationRunId`, moves to "draft"
      - `approve(record, validationStore, scopeStatement): RuleRecord` — calls `canApprove()`, recomputes hash, records `ApprovalRecord`, transitions to "active"
      - `invalidate(record, reason): RuleRecord`
      - `revoke(record): RuleRecord`
    - Throw descriptive errors when guards fail (e.g., approving without validation)
    - _Requirements: 4.3, 4.6, 5.6, 6.1–6.7, 9.4, 9.5, 9.6; Design: Approval Lifecycle section_
  - [ ]* 9.2 Write unit tests for RuleLifecycle transitions
    - Approve without validation → throws
    - Approve with failed validation → throws
    - Modify an approved rule → reverts to draft, clears approval
    - Hash mismatch at approval → throws
    - Revoke removes active rule; subsequent detection attempts return null
    - _Requirements: 6.1–6.7_

- [ ] 10. Write property-based tests for RuleLifecycle (Properties 6, 7, 8, 10)
  - [ ]* 10.1 Property 6: Approval Guard
    - Generate arbitrary `RuleRecord` and `ValidationResult` pairs
    - Assert `approve()` succeeds if and only if: `status === "validated"`, stored contentHash matches freshly computed hash, `ValidationResult.passed === true`, and `ValidationResult.ruleContentHash === record.contentHash`
    - **Validates: Requirements 5.6, 6.7, 4.6, 9.4, 9.5**
  - [ ]* 10.2 Property 7: Content Hash Invalidation
    - Generate arbitrary `RuleRecord` in "active" state; mutate any field of `rule`
    - Assert the new content hash does not equal `approvalRecord.ruleContentHash`
    - Assert `modifyRule()` transitions the record to "draft" (not "active" or "approved")
    - **Validates: Requirements 6.4, 6.5, 9.6**
  - [ ]* 10.3 Property 8: Validation Evidence Traceability
    - Generate arbitrary `RuleProposal` inputs; run a gate against them
    - Assert `ValidationResult.ruleContentHash === computeRuleHash(proposal)` for every result
    - **Validates: Requirements 5.8, 6.2**
  - [ ]* 10.4 Property 10: Rule Proposal Trust Boundary
    - Generate arbitrary AI provider responses (raw text strings)
    - Assert that after parsing, the resulting `RuleRecord` always has `status === "draft"` and never "active" or "approved"
    - **Validates: Requirements 4.2, 4.3, 9.9**

- [ ] 11. Author baseline validation suite
  - Create `packages/core/src/validation/baseline-suite.ts` with the 8 hand-authored baseline test cases as exported `ValidationCase[]`:
    - `BL-01`: Report with no matching layout → expects `state: "refusal"` (layout-mismatch)
    - `BL-02`: Valid CBC report with one extra injected line → expects `state: "refusal"` (unexplained-content)
    - `BL-03`: Valid CBC report with one value replaced by `@@@@` → expects `state: "refusal"` (tampered-value)
    - `BL-04`: Determinism — same report processed twice; assert results are byte-identical
    - `BL-05`: Line accounting completeness — total equals line count for a report that reaches any state
    - `BL-06`: Refusal of wrong-layout report — submit a Lipid Panel report against a CBC Panel rule → expects `state: "refusal"`
    - `BL-07`: Timeout recovery — report with an injected very long line causing slow match → expects `state: "refusal"` with `timeoutOccurred: true`
    - `BL-08`: AI call count — process any report under approved rule; assert `aiCallCount === 0`
  - Each case includes: `caseId`, `caseLabel`, `property`, `kind: "baseline"`, `reportContent`, `expectedState`
  - Synthetic report content for each case defined as inline string constants in the same file
  - _Requirements: 5.1, 5.2, 5.3; Design: Validation Architecture — Baseline Cases table_

- [ ] 12. Implement ValidationGate
  - [ ] 12.1 Implement `packages/core/src/validation-gate.ts`
    - Implement `generateLayoutSpecificCases(proposal: ExtractionRule, originalReport: string): ValidationCase[]` — produces 4 mutations: clean copy, random line removed, measurement value replaced by non-numeric, measurement value outside plausible range
    - Implement `runGate(proposal: ExtractionRule, originalReport: string, validationStore: Map<string, ValidationResult>): ValidationResult`:
      1. Build suite: `baselineCases` from baseline-suite.ts + `layoutSpecificCases` from generator
      2. For each case: instantiate `ExtractionEngine` in proposal-evaluation mode (not activated in store), run on `case.reportContent`, compare `result.state` to `case.expectedState`
      3. Catch `PatternSyntaxException` from ExpressionRunner — record as a failed case with descriptive error
      4. Compute `passed = all cases passed`
      5. Return `ValidationResult` with `runId` (UUID), `ruleContentHash`, `ranAt`, `passed`, `cases`, and the fixed `LIMITATIONS_DISCLAIMER` string
    - Export the `LIMITATIONS_DISCLAIMER` constant (verbatim text from design)
    - `ValidationGate` MUST NOT write to the rule store
    - _Requirements: 5.1–5.8, 11.3; Design: Validation Architecture, Gate Execution pseudocode_
  - [ ]* 12.2 Write integration tests for ValidationGate
    - Clean CBC Panel proposal against baseline suite → all cases pass
    - Proposal with an expression containing a backreference → expression-compile-error case fails
    - Proposal with missing line classifications → BL-02 fails (unexplained line not caught)
    - `ValidationResult.ruleContentHash` equals `computeRuleHash(proposal)` for every run
    - _Requirements: 5.1–5.8_

- [ ] 13. Checkpoint — Group 2 complete; safety invariants fully testable
  - Ensure all tests pass, ask the user if questions arise.

---

### Group 3 — API Layer

> Tasks 14 and 17 can be started in parallel once Group 2 is complete (no dependency between them). Task 15 must precede 16. Task 18 depends on 14.

- [ ] 14. Scaffold Hono API server
  - Create `packages/app/src/server.ts` as the Hono app entry point
  - Set up Hono app with:
    - Zod-validated request body middleware (use `zod` + manual validation on each route; fail with 400 + descriptive error on schema mismatch)
    - Static file serving for the compiled React SPA from `packages/app/dist/client/` (served at `/`)
    - `GET /api/health` → 200 `{ status: "ok", isDemoMode: boolean }`
    - `GET /api/demo-mode` → 200 `{ isDemoMode: boolean }` (reads `AI_DEMO_MODE` env var)
    - Middleware to attach `isDemoMode` to all API responses
  - `PORT` from env var, default 3000
  - `RULE_STORE_PATH` from env var, default `./data/rules.json`; ensure parent directory is created on startup
  - Load seeded rule store if `AI_DEMO_MODE=true` and store is empty (see task 17)
  - Export `createServer()` factory for integration testing
  - _Requirements: 1.1–1.4, 4.4; Design: ApiServer component, Deployment Strategy_

- [ ] 15. Implement AiProviderClient
  - Create `packages/app/src/ai-provider-client.ts`
  - Define `AiProviderClient` interface: `draftRule(unknownLayoutReport: string): Promise<{ rawText: string; isDemoMode: boolean }>`
  - Implement `DemoModeClient`: reads from `packages/app/src/demo-recordings/{layoutId}.json`, returns `responseText` without network call, `isDemoMode: true`
  - Implement `LiveAiClient`: calls OpenAI (`gpt-4o`) or Anthropic (`claude-3-5-sonnet`) based on `AI_PROVIDER` env var; sends the unknown-layout report + a fixed system prompt that specifies RE2 syntax constraints and the `ExtractionRule` JSON schema as the target format; returns raw response text, `isDemoMode: false`
  - Implement `createAiProviderClient()` factory: returns `DemoModeClient` if `AI_DEMO_MODE=true`, else `LiveAiClient`
  - Parse raw response text against the `ExtractionRule` Zod schema; on parse failure, throw `RuleParseError` with the raw text and parse errors
  - _Requirements: 4.1, 4.2, 4.4, 4.5, 9.9; Design: AiProviderClient component, Demo/Replay Strategy_

- [ ] 16. Create demo recordings and seeded rule store
  - Create `packages/app/src/demo-recordings/` directory
  - Create `packages/app/src/demo-recordings/layout-cbc-panel.json` — `DemoRecording` for CBC Panel (pre-written synthetic rule proposal in `responseText`)
  - Create `packages/app/src/demo-recordings/layout-metabolic-panel.json` — `DemoRecording` for Basic Metabolic Panel
  - Create `packages/app/src/demo-recordings/layout-lipid-panel.json` — `DemoRecording` for Lipid Panel
  - Create `packages/app/src/demo-recordings/seeded-store.json` — a `RuleRecord[]` with:
    - CBC Panel rule: `status: "active"`, valid `approvalRecord`, `validationRunId` pointing to a seeded `ValidationResult`
    - Basic Metabolic Panel rule: same (pre-approved)
    - Lipid Panel rule: absent (triggers onboarding flow in demo)
  - Each recording's `promptHash` is the SHA-256 of the system prompt used to capture the response
  - Synthetic report strings for all three layouts must be coherent with their respective rule proposals
  - _Requirements: 4.4, 7.1; Design: Demo Recordings section, Pre-built Demo Scenarios table_

- [ ] 17. Implement all API routes
  - Extend `packages/app/src/server.ts` (or separate route files in `packages/app/src/routes/`) with:
    - `POST /api/reports` — Zod-validate body `{ content: string, sourceLabel: string }`, construct `Report`, run `LayoutDetector` then `ExtractionEngine` or return layout-mismatch; respond with `ProcessingResult`; include `isDemoMode` in response
    - `GET /api/rules` — return all `RuleRecord[]` from store (with status, contentHash, history)
    - `POST /api/rules/draft` — Zod-validate body `{ unknownLayoutReport: string }`; call `AiProviderClient.draftRule`, parse result, call `RuleLifecycle.createDraft`, persist to store; respond with draft `RuleRecord`
    - `POST /api/rules/:id/validate` — load record, run `ValidationGate.runGate`, persist `ValidationResult`, call `RuleLifecycle.markValidated` or `markValidationFailed`, persist record; respond with `ValidationResult`
    - `POST /api/rules/:id/approve` — load record, call `RuleLifecycle.approve`, persist; respond with updated `RuleRecord` including `ApprovalRecord`
    - `DELETE /api/rules/:id` — call `RuleLifecycle.revoke`, persist; respond 200 with updated record
    - `GET /api/rules/:id/validation` — return the `ValidationResult` for `record.validationRunId`
  - All routes return structured error responses `{ error: string, detail?: string }` on failure
  - _Requirements: 1.2, 4.1–4.6, 5.1–5.8, 6.1–6.7, 7.1–7.3; Design: ApiServer Routes_

- [ ] 18. Write integration tests for the full onboarding flow
  - [ ]* 18.1 Integration tests (8 cases from design)
    - `POST /api/reports` with Lipid Panel report → 200, `state: "layout-mismatch"`, response includes onboarding hint
    - `POST /api/rules/draft` with Lipid Panel report → 200, `status: "draft"`, `draftedBy: "ai"`
    - `POST /api/rules/:id/validate` on draft → 200, `ValidationResult.passed: true` (using demo seeded rule)
    - `POST /api/rules/:id/approve` on validated rule → 200, `status: "active"`, `ApprovalRecord` present
    - `POST /api/reports` with Lipid Panel report after approval → 200, `state: "accepted"`, `aiCallCount: 0`
    - `POST /api/rules/:id/approve` on un-validated rule → 400 with guard-failure error
    - `DELETE /api/rules/:id` on active rule → 200, subsequent `POST /api/reports` returns layout-mismatch
    - `POST /api/reports` with tampered CBC Panel report → 200, `state: "refusal"`, `offendingLines` populated
    - Use `createServer()` factory with an in-memory rule store for isolation
    - _Requirements: 2.1–2.6, 3.1–3.6, 4.1–4.6, 5.1–5.8, 6.1–6.7, 7.1–7.3_

- [ ] 19. Checkpoint — Group 3 complete; full golden path exercisable via API
  - Ensure all tests pass, ask the user if questions arise.

---

### Group 4 — React Frontend (Core Path)

> Tasks 21, 22, 23, 24, 25, and 26 can be started in parallel once tasks 20 is complete (they are independent views). Task 20 (Vite scaffold) must precede all others in this group.

- [ ] 20. Scaffold Vite + React frontend
  - Create `packages/app/vite.config.ts`: build output to `packages/app/dist/client/`, dev proxy for `/api/*` → `localhost:3000`, `@vitejs/plugin-react`
  - Create `packages/app/src/frontend/main.tsx` with React root mounting
  - Create `packages/app/src/frontend/App.tsx` with React Router v6 (`createBrowserRouter`) defining all routes: `/`, `/process`, `/onboard`, `/validate/:ruleId`, `/approve/:ruleId`, `/rules`
  - Create a shared `packages/app/src/frontend/api-client.ts` with typed `fetch` wrappers for all API endpoints (using the shared types from `@spoolgeist/core`)
  - Create a minimal shared `packages/app/src/frontend/components/` directory with `Badge.tsx`, `Button.tsx`, `Card.tsx` primitives
  - Add `npm run build` script to `packages/app/package.json` that runs `vite build` and copies output to where Hono serves it
  - _Requirements: 1.1; Design: UX Structure section_

- [ ] 21. Build Landing page (/)
  - Create `packages/app/src/frontend/pages/Landing.tsx`
  - Layout sections:
    1. Hero: one-sentence problem statement ("Legacy lab systems can only print. Spoolgeist makes them readable — safely.")
    2. Three-step model: step cards for "AI drafts a rule (once)", "Adversarial gate validates it", "All future reports: zero AI"
    3. Demo report selector: 3–4 `<button>` elements, each pre-loading a synthetic report content string; on click, navigate to `/process` with the report content in navigation state
    4. Persistent synthetic-data disclaimer banner: "All data is synthetic. This application has no clinical validation and is not intended for clinical use."
  - Core concept (printout → structured data, every line accounted for, safe acceptance vs. refusal) must be graspable within ~30 seconds
  - No login, no navigation required to reach the demo
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.12_

- [ ] 22. Build Report Submission and Processing Result view (/process)
  - Create `packages/app/src/frontend/pages/Process.tsx`
  - Components:
    - `ReportInput`: textarea pre-filled from navigation state if present; "Submit" button calls `POST /api/reports`
    - `ProcessingResultView`: renders one of three visually distinct panels based on `result.state`:
      - **Accepted** (green): extracted values table (measurementName, rawValue, unit, plausibilityStatus), zero-AI-calls badge, line accounting summary
      - **Refusal** (red): offending lines highlighted, reason, resolution hint, suspicious content if present
      - **Review** (amber): suspicious items list, human confirmation prompt, explicit statement "No values are displayed as verified"
    - `LineAccountingView`: always visible alongside the result; lists every report line colour-coded as extracted (green) / ignored (grey) / unexplained (red)
    - `ProvenanceLink`: clicking an extracted value highlights its source line in the LineAccountingView (implemented as shared state via `useRef` scroll-to — ghost guide interaction is enhanced in task 29 to be bidirectional)
    - `ZeroAiCallsBadge`: displays "0 AI calls made for this processing" — always visible in results
  - _Requirements: 2.1–2.6, 3.1–3.6, 8.1; Design: Process View, Line Accounting Representation_

- [ ] 23. Build Unknown Layout Onboarding view (/onboard)
  - Create `packages/app/src/frontend/pages/Onboard.tsx`
  - Reached by navigation from `/process` when `result.state === "layout-mismatch"`
  - Displays: the unrecognised report text (read-only), a brief explanation of why it was not recognised
  - "Draft extraction rule with AI" button: calls `POST /api/rules/draft`, shows loading spinner during call
  - If `isDemoMode === true`, shows the persistent demo mode banner before the button is clicked: "Demo mode: AI responses are pre-recorded. No live AI calls are made."
  - On successful draft, navigates to `/validate/:ruleId`
  - On error (parse failure, provider error), shows the error and raw response text
  - _Requirements: 4.1, 4.2, 4.4; Design: Onboard view_

- [ ] 24. Build Validation Gate view (/validate/:ruleId)
  - Create `packages/app/src/frontend/pages/Validate.tsx`
  - On load: `GET /api/rules/:id` to get the rule record; if `validationRunId` exists, `GET /api/rules/:id/validation` to load prior result
  - Displays:
    - Rule proposal summary: `layoutName`, `layoutVersion`, list of `lineClassifications` (read-only)
    - "Run Validation" button: calls `POST /api/rules/:id/validate`; shows per-case progress as results arrive
    - Validation results table: per case — `caseLabel`, `property`, `kind`, `passed` (✓/✗), `expectedState`, `observedState`, `failureDetail` if failed
    - If a case fails, the failing case row is highlighted red with the detail text expanded
    - Limitations disclaimer: displayed verbatim below results table
    - Rule version identifier (`contentHash` truncated to 8 chars) always visible
    - "Approve" button: appears only when `passed === true` for the current run; navigates to `/approve/:ruleId`
    - "Approve" button is absent (not disabled — absent) when any case has failed
  - _Requirements: 5.1–5.8, 4.6; Design: Validate view_

- [ ] 25. Build Pre-Approval Review view (/approve/:ruleId)
  - Create `packages/app/src/frontend/pages/Approve.tsx`
  - On load: `GET /api/rules/:id` and `GET /api/rules/:id/validation`
  - Displays (all required, all visible before the approval button):
    1. Full rule definition: `layoutName`, all `lineClassifications` with their expressions
    2. Validation evidence: link to validation run, number of cases, all passed status, `ranAt` timestamp
    3. Any warnings (e.g., expressions that matched the timeout threshold)
    4. Synthetic-data scope statement (verbatim): "This rule applies to synthetic data only. It has not been clinically validated."
    5. Rule version identifier (`contentHash`)
  - "Confirm Approval" button: calls `POST /api/rules/:id/approve`; on success, navigates to `/rules`
  - On approval failure (guard error), shows the guard failure reason
  - _Requirements: 6.1, 6.2, 6.3; Design: Approve view_

- [ ] 26. Build Rule Registry view (/rules)
  - Create `packages/app/src/frontend/pages/Rules.tsx`
  - `GET /api/rules` on load; auto-refresh every 5 seconds
  - Displays each `RuleRecord` as a card with:
    - `layoutName`, `layoutVersion`, current `status` as a colour-coded badge
    - Short `contentHash` (8 chars) for version identification
    - `approvalRecord.approvedAt` if present
    - Link to validation evidence (`/validate/:ruleId`) for validated/approved rules
    - "Revoke" button on `status === "active"` rules; calls `DELETE /api/rules/:id` with confirmation modal
    - If `status === "invalidated"`, shows `invalidationReason`
  - Empty state: "No rules yet. Submit a report to begin onboarding."
  - _Requirements: 6.5, 6.6; Design: Rules view_

- [ ] 27. Checkpoint — Group 4 complete; judge-facing demo exists end-to-end
  - Ensure all tests pass, ask the user if questions arise.

---

### Group 5 — End-to-End Demo Polish

> Tasks 28, 29, and 30 are independent and can be worked in parallel.

- [ ] 28. Ghost guide: bidirectional provenance links
  - Extend `Process.tsx`'s `LineAccountingView` and `ProcessingResultView` with bidirectional interaction:
    - Clicking an `ExtractedValue` row in the values table: scroll the `LineAccountingView` to `provenance.lineNumber`, apply a highlight class (e.g., pulsing yellow border) for 2 seconds
    - Clicking a line in `LineAccountingView` that has `classification === "extracted"`: highlight the corresponding `ExtractedValue` row in the values table
    - Implement via a shared `highlightedLine` state lifted to the parent `ProcessingResultView`
  - No new components required — extend existing ones
  - Smooth scroll (`scrollIntoView({ behavior: "smooth" })`)
  - _Requirements: 2.6, 9.10; Design: Ghost Guide, UX Structure_

- [ ] 29. Demo mode persistent banner
  - Create `packages/app/src/frontend/components/DemoModeBanner.tsx`
  - Text: "Demo mode: AI responses are pre-recorded. No live AI calls are made."
  - Visual: full-width amber bar, fixed to top of viewport (above all content), `z-index` above page content, NOT dismissible (no close button)
  - Rendered unconditionally in `App.tsx` when `isDemoMode === true` (fetched once from `GET /api/demo-mode` on app load, cached in context)
  - Applies on all routes including `/validate`, `/approve`, and `/rules`
  - _Requirements: 4.4, 7.2; Design: Demo Mode UI Signal_

- [ ] 30. Author synthetic lab data: 3 layouts, demo report variants
  - Create `packages/app/src/demo-recordings/synthetic-reports.ts` — exports named constants for all demo reports:
    - **CBC Panel** (`layout-cbc-panel`): 4 variants — `cbcClean` (accepted), `cbcTampered` (refusal, one value replaced by `@@@@`), `cbcExtraLine` (refusal, one injected unexplained line), `cbcBorderline` (review, one value at boundary of plausible range)
    - **Basic Metabolic Panel** (`layout-metabolic-panel`): 2 variants — `bmpClean` (accepted), `bmpMismatch` (submitted against CBC rule, triggers layout-mismatch)
    - **Lipid Panel** (`layout-lipid-panel`): 2 variants — `lipidClean` (accepted after onboarding), `lipidUnknown` (triggers onboarding flow — this is the demo's onboarding entrypoint)
  - Each layout supports ≤4 measurement types (12 total across all layouts, per Requirement 10.2)
  - Confirm that `seeded-store.json` from task 16 is consistent with these report strings and their rules
  - Update `Landing.tsx` demo report buttons to use these named constants
  - _Requirements: 10.1, 10.2; Design: Pre-built Demo Scenarios table_

- [ ] 31. Complete Dockerfile and Railway deployment configuration
  - Finalise `Dockerfile`:
    ```
    FROM node:22-alpine
    WORKDIR /app
    COPY package*.json packages/core/package*.json packages/app/package*.json ./
    RUN npm ci
    COPY . .
    RUN npm run build
    EXPOSE 3000
    CMD ["node", "packages/app/dist/server.js"]
    ```
  - Add `npm run build` to root `package.json` (runs `tsc -b` for core + `vite build` for app)
  - Add `npm start` to root: `node packages/app/dist/server.js`
  - Create `railway.json` (or `.railway.toml`) with service name, build command, start command
  - Document required environment variables in `README.md`: `AI_DEMO_MODE`, `PORT`, `RULE_STORE_PATH`, `AI_PROVIDER`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
  - Verify build produces a runnable server with the React SPA served at `/`
  - _Requirements: 1.1; Design: Deployment Strategy_

- [ ] 32. Checkpoint — Group 5 complete; hosted demo polished and deployable
  - Ensure all tests pass, ask the user if questions arise.

---

### Group 6 — Stretch Goals (Optional)

*Cut these first if core-workflow delivery (Requirements 1–7) is at any risk. Only implement if Requirements 1–7 are demonstrably complete.*

- [ ] 33. [OPTIONAL] FHIR DiagnosticReport export
  - [ ]* 33.1 Implement `GET /api/reports/:id/fhir-export` route
    - Only accepts reports in `state: "accepted"`; returns 400 for any other state
    - Maps `ExtractedValue[]` to a FHIR R4 `DiagnosticReport` resource:
      - `resourceType: "DiagnosticReport"`, `status: "preliminary"` (not "final")
      - `meta.tag: [{ system: "http://spoolgeist.demo/data-quality", code: "synthetic" }]`
      - Each `ExtractedValue` mapped to an inline `Observation` component with `valueQuantity` and `code`
    - Returns the resource as `application/fhir+json`
    - _Requirements: 8.2, 8.3_
  - [ ]* 33.2 Add "Export FHIR" button to accepted ProcessingResultView
    - Only shown when `result.state === "accepted"`
    - Downloads the FHIR JSON as a file: `report-{id}-fhir.json`
    - _Requirements: 8.2, 8.3_

- [ ] 34. [OPTIONAL] Patient-friendly report view
  - Add a "Patient View" tab to `ProcessingResultView` (only when `result.state === "accepted"`)
  - Render a simplified plain-English summary: "Your CBC Panel results from [date]:" followed by each measurement as `{measurementName}: {rawValue} {unit} — {within normal range / outside normal range}`
  - Frontend-only rendering — no new API endpoints
  - Must NOT display any value as "verified" if the state is not Accepted
  - _Requirements: 8.2, 8.4_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP (they are property/unit tests or optional features, not core logic)
- Each task references specific requirements for traceability
- Checkpoints 7, 13, 19, 27, and 32 are synchronisation points where all tests must pass before proceeding to the next group
- Property tests (Properties 1–12) validate universal correctness; unit tests validate specific examples and edge cases
- After Group 1 + 2: all safety invariants are testable via the PBT suite
- After Group 1 + 2 + 3: the full golden path (onboard → validate → approve → process → zero-AI repeat) is exercisable via API and integration tests
- After Group 1 + 2 + 3 + 4: the complete judge-facing demo exists
- Groups 5 and 6 add polish and stretch goals that do not affect core correctness
- Tasks 21–26 (Group 4) are independent views and can be built in parallel after task 20
- Tasks 28–30 (Group 5) are independent and can be worked in parallel
- `re2js` is the chosen safe-matching library (pure JS RE2 port, no native addon)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 7, "tasks": ["7"] },
    { "id": 8, "tasks": ["8", "11"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["9.2", "10.1", "10.2", "10.3", "10.4"] },
    { "id": 11, "tasks": ["12.1"] },
    { "id": 12, "tasks": ["12.2"] },
    { "id": 13, "tasks": ["13"] },
    { "id": 14, "tasks": ["14", "15"] },
    { "id": 15, "tasks": ["16", "17"] },
    { "id": 16, "tasks": ["18.1"] },
    { "id": 17, "tasks": ["19"] },
    { "id": 18, "tasks": ["20"] },
    { "id": 19, "tasks": ["21", "22", "23", "24", "25", "26"] },
    { "id": 20, "tasks": ["27"] },
    { "id": 21, "tasks": ["28", "29", "30"] },
    { "id": 22, "tasks": ["31"] },
    { "id": 23, "tasks": ["32"] },
    { "id": 24, "tasks": ["33.1"] },
    { "id": 25, "tasks": ["33.2", "34"] }
  ]
}
```
