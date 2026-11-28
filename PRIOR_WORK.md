# Prior work disclosure

This application was started with **Kiro** during the Kiroween 2026 Submission Period. It builds on earlier work by the same entrant, also created during the Submission Period (21–22 Nov 2026), **with a different AI coding assistant (Claude Code)**.

**Research and validation repository:** https://github.com/Sidd927/kiroween-2026, branch `poc/spoolgeist-validation`. Contents:
- idea research;
- a technical proof of concept;
- a hardened reference engine (v4);
- synthetic generators;
- a sealed evaluation, adversarial test sets, mutation testing and FHIR validation reports.

**How it is used here:** as **reference material only**. No code from the research repository has been copied into this application (see the list below). Its sealed test split was **not** used as an oracle for this application; the tests here are the application's own.

**This repository's initial files** (LICENSE via GitHub; the README stub, this file and `.gitignore`) were created with Claude Code on 22 Nov 2026.

**Copied verbatim from the research repository** (kept exact as work proceeds):
- _none yet_

## Development log: which tool produced what

The commit history is the authoritative record. It has not been rewritten, and every commit message names the tool.

| Dates | Tool | Work |
|---|---|---|
| 22 Nov 2026 | Claude Code | Repository stub files (README, this file, `.gitignore`). |
| 27–28 Nov 2026 | **Kiro** | Spec `golden-path-application`: requirements, design and a 34-task plan (`/.kiro`). Tasks 1 (scaffold), 2 (types), 3.1 (RE2 expression runner) and 4.1 (layout detector). A draft of task 5.1 (extraction engine), committed **unmodified** as `5021208`. |
| 28 Nov 2026 onwards | **Claude Code** | Kiro's monthly credits were exhausted (50/50) and an extra-credit request was pending, so development continued in Claude Code. Its work: safety fixes to the Kiro engine draft, the rule lifecycle, the validation gate, the proposal parser, the onboarding prompt, the synthetic demo data, recorded AI drafts, the frontend, tests, docs and deployment. Each decision that departs from the Kiro design is in [docs/DECISIONS.md](docs/DECISIONS.md); task-by-task status is in [docs/EXECUTION_TRACKER.md](docs/EXECUTION_TRACKER.md). |

No Kiro activity, artefacts or logs have been fabricated. Kiro's spec files and task checkboxes are left exactly as Kiro produced them.

**AI used inside the product:** the demo's rule drafts are real responses from `claude-sonnet-5-5`, captured through the Claude Code CLI (`claude -p`, no tools) on 28 Nov 2026 with `scripts/record-drafts.ts`. They are stored unedited, together with the prompt and its SHA-256.
