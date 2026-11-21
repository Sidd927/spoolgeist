# Spoolgeist

**Resurrect the printer port.** Legacy systems that can only *print* still hold critical data. Spoolgeist captures their print jobs, lets an AI draft a parsing rule for an unfamiliar layout **once**, and then makes that rule **prove itself** before it may run: an adversarial gate plus a named human approval. After approval, every report is processed **deterministically, offline, with no AI**. Anything it cannot fully account for is refused, with the offending line shown, or sent to a person for confirmation. It is never half-extracted.

> **Status (22 Nov 2026):** repository initialised. The application is being built **with Kiro** for Kiroween 2026 (Resurrection category). Specs, steering and hooks will appear in `/.kiro` as development proceeds.
> All data is synthetic. Nothing here is clinically validated.

- **Prior work:** research, a proof of concept and a validation harness built before this repository, with a different AI assistant. See [PRIOR_WORK.md](PRIOR_WORK.md).
- **Licence:** MIT.
