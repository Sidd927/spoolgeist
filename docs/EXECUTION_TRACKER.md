# Execution tracker

Spec: `.kiro/specs/golden-path-application/tasks.md` (Kiro; checkboxes are left as Kiro set them). This tracker shows who produced each part.

**Legend:**
- **K** — produced in Kiro.
- **K→C** — Kiro draft, fixed by Claude Code.
- **C** — Claude Code (Kiro credits exhausted, 28 Nov 2026).

| Kiro task | Status | By | Where / commit |
|---|---|---|---|
| Spec (requirements, design, tasks) | done | K | `e60ca3d` |
| 1 Scaffold monorepo | done | K | `9a3a3b4` |
| 2 Shared types | done; extended (D1, D3, D5) | K→C | `51c4b99`, `63d11f0` |
| 3 ExpressionRunner | done; `runFullMatch` added | K→C | `965f6b9`, `63d11f0` |
| 4 LayoutDetector | done | K | `10ce40a` |
| 5 ExtractionEngine | Kiro draft committed unmodified, then fixed | K→C | `5021208`, `63d11f0`, `3747b42` |
| 6 Engine property tests (P1–P4, P9) | done (+P5, adversarial) | C | `63d11f0` |
| 8 RuleStore | replaced by browser state + integrity re-check on load (D8) | C | `21a4b1c` |
| 9 RuleLifecycle | done | C | `3747b42` |
| 10 Lifecycle properties (P6–P8, P10) | done | C | `3747b42` |
| 11–12 Baseline suite and ValidationGate | done (BL-01…08 + mutations) | C | `3747b42` |
| 14, 17 Hono API | not needed for the hosted demo (D8); optional local server pending | — | — |
| 15 AiProviderClient | recorded via `scripts/record-drafts.ts`; live client pending | C | `21a4b1c` |
| 16, 30 Demo recordings, seed, synthetic data | done | C | `21a4b1c` |
| 18 Onboarding flow integration tests | done (`demo.test.ts`) | C | `21a4b1c` |
| 20–29 Frontend views, provenance, demo banner | done | C | `fa076b2` |
| 31 Deployment | GitHub Pages via Actions (D8): https://sidd927.github.io/spoolgeist/ | C | `ab11bb3`, run 46139125182 |
| 33–34 Optional FHIR / patient view | not started | — | — |

## Verification log
| Date | Check | Result |
|---|---|---|
| 28 Nov | `npm run typecheck`, client `tsc` | clean |
| 28 Nov | `npx vitest run` | 141 tests passed |
| 28 Nov | Browser check of the local build: golden path, refusal, review, provenance highlight, possession → gate failure, light theme | works; no console errors |
| 28 Nov | CI run 46139125182 on Node 22: typecheck, tests, build, deploy | passed |
| 28 Nov | **Live site** checks:<br>- refusal: line 9 ghost, 1 unexplained, 0 AI calls<br>- lipid onboarding: recorded draft → gate 41/41 → typed-name approval → next patient accepted, 0 AI calls<br>- possession: gate fails `LS-line11-appended`<br>- state persists across a reload<br>- self-hosted fonts load<br>- no console errors | works |
