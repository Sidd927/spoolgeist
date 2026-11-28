# Kiroween 2026 submission draft — Spoolgeist (Resurrection)

> Draft for the entrant to edit and submit. Check every claim against the repo before submitting.

**Tagline:** AI may propose. Deterministic systems verify. Humans approve. Unexplained data remains visible.

**What it does.** Legacy lab systems that can only print are brought back to life as structured data, without trusting an AI on every report:
1. An AI drafts a parsing rule for a new printout layout once.
2. The rule must pass an adversarial validation gate (40+ mutations) and a named human's approval, bound to its SHA-256 content hash.
3. After that, reports are parsed by a deterministic RE2 engine with zero AI calls.
4. Any line it cannot fully explain refuses the report and is shown to the operator.

**Why Resurrection.** The "dead technology" is the printer port: decades-old systems whose only output is a printout. Spoolgeist gives them a safe, auditable path to modern data, and the ghost marks what the machine refuses to pretend it understood.

**How Kiro was used** (edit to match reality before submitting):
- **Spec-driven development.** The `golden-path-application` spec (requirements, design, 34-task plan) defined the architecture, the 12 correctness properties and the lifecycle. All of these are implemented and tested.
- **Kiro implemented** the scaffold, the domain types, the RE2 expression runner, the layout detector and a draft of the extraction engine.
- **Honest note:** the Kiro credits ran out on 28 Nov. The remaining tasks were implemented with Claude Code, against Kiro's spec, with every deviation documented in `docs/DECISIONS.md` and attribution in every commit. *(If Kiro credits return before the deadline, add the steering and hooks work here.)*

**Tech:** TypeScript, re2js, React 19 and Vite, vitest with fast-check (142 tests, including property and adversarial tests). It is a static deployment on GitHub Pages, and the engine runs in the browser.

**Links:**
- Repo: https://github.com/Sidd927/spoolgeist (MIT)
- Demo: https://sidd927.github.io/spoolgeist/
- Video: _(YouTube link)_

**Limitations:**
- Synthetic data only; not a medical device.
- The demo replays recorded real model responses.
- The gate is evidence, not proof.
