# Requirements Document

## Introduction

Spoolgeist is a focused, polished demonstration application for Kiroween 2026 (Resurrection category). It captures print jobs from a fictional legacy laboratory system, uses an AI provider **once** to draft an extraction rule for an unknown layout, forces that rule through an adversarial validation gate and explicit human approval, and then processes all subsequent reports deterministically with zero AI calls. Content that cannot be fully accounted for is refused or routed for human confirmation — never half-extracted.

This document specifies the golden-path application only: one fictional legacy lab system, synthetic data, at most 3 report layouts, at most 12 supported laboratory measurements. It is the first substantive Kiro-generated spec for this project; all code is designed and implemented fresh in this repository, with prior work (see PRIOR_WORK.md) used only as disclosed reference material.

**What we are building:** the golden-path judge experience — landing page, known-report processing, refusal of suspicious content, unknown-layout onboarding, adversarial validation gate, human approval, zero-AI repeat processing, and (as a stretch goal) structured/patient-friendly output.

**What we are NOT building:** authentication, enterprise dashboards, OCR, chatbots, Windows installers, physical printer integration, ABDM/gateway integrations, real patient data, real hospital integrations, or support for more than 3 layouts / 12 measurements.

## Glossary

- **Spoolgeist**: The application specified by this document.
- **Legacy Lab System**: A fictional synthetic laboratory reporting system that can only print; its reports are the only source of data.
- **Report**: A synthetic print job (text) produced by the Legacy Lab System, submitted to Spoolgeist for processing.
- **Layout**: A structural template describing how a family of reports arranges measurements, patient metadata, headers and footers.
- **Extraction Rule**: A deterministic specification (layout match condition plus per-value extraction definitions) that maps Report lines to structured measurements and accounts for every line.
- **Rule Proposal**: An Extraction Rule drafted by the AI Provider, held as untrusted until validated and approved.
- **AI Provider**: An external LLM service called only during unknown-layout onboarding, never during report processing.
- **Validation Gate**: The adversarial testing stage that a Rule Proposal must pass before it can be approved.
- **Approval**: An explicit, recorded human action that activates a validated Extraction Rule.
- **Deterministic Engine**: The offline component that executes approved Extraction Rules on Reports; its behavior is a pure function of (Report, Rule).
- **Line Accounting**: The process of classifying every line of a Report as extracted, explicitly matched-and-ignored (e.g., known boilerplate), or unexplained.
- **Unexplained Content**: Any Report line not covered by the active Extraction Rule's classification; its presence blocks acceptance.
- **Suspicious Content**: Lines or values that are altered, ambiguous, out-of-range, mutually inconsistent, or otherwise flagged by validation logic.
- **Accepted State**: The terminal state of a Report processed fully and successfully under an approved rule, with zero Unexplained Content.
- **Refusal State**: The terminal state in which Spoolgeist declines to extract values, preserving and displaying the problematic content and reason.
- **Review State**: The state in which ambiguous or borderline content is routed for human confirmation before acceptance.
- **Demonstration Mode**: A hosted replay mode in which a pre-recorded AI Provider response is used, so the demo does not depend on live AI availability.
- **FHIR Export**: An optional stretch output producing a FHIR DiagnosticReport resource from Accepted State data.

## Requirements

### Requirement 1: Landing Experience

**User Story:** As a judge, I want a no-login landing experience, so that I can understand within ~30 seconds what Spoolgeist does, why print-only legacy systems are a problem, what the AI does and does not do, and why validation and approval matter.

#### Acceptance Criteria

1. THE Landing Page SHALL explain, without requiring login, the problem (legacy print-only systems holding critical data), the AI's limited role (drafting rules once), and the validation-plus-approval safety model.
2. THE Landing Page SHALL provide a small selection of clearly synthetic demo Reports that can be submitted with one click.
3. THE Landing Page SHALL label all demo data as synthetic and SHALL NOT imply clinical or real-world validation.
4. WHEN a judge views the Landing Page, THE Landing Page SHALL present the core concept (printout → structured data, every line accounted for, safe acceptance visually distinct from refusal/review) in a form understandable within approximately 30 seconds.

### Requirement 2: Known Report Processing

**User Story:** As a judge, I want to submit a supported synthetic Report and see it extracted deterministically with full provenance, so that I can trust the zero-AI processing model.

#### Acceptance Criteria

1. WHEN a Report matching a supported Layout is submitted, THE Deterministic Engine SHALL extract all measurements defined by the approved Extraction Rule for that Layout without any AI Provider call.
2. WHEN a Report is processed, THE Deterministic Engine SHALL perform Line Accounting such that every line is classified as extracted, matched-and-ignored, or Unexplained Content.
3. WHEN a Report is processed with zero Unexplained Content and zero Suspicious Content, THE Spoolgeist SHALL display an Accepted State including extracted values, per-value provenance (source line/position), and the Line Accounting summary.
4. WHILE a Report is processed under an approved rule, THE Spoolgeist SHALL display an honest, visible indicator that zero AI Provider calls were made for this processing.
5. THE Deterministic Engine SHALL produce identical outputs for identical (Report, Extraction Rule) inputs across repeated executions (determinism).
6. WHEN a Report is processed regardless of its acceptance state, THE Spoolgeist SHALL display the extracted values, per-value provenance (source line/position), and the Line Accounting summary alongside any Refusal State or Review State indicators.

### Requirement 3: Suspicious or Tampered Report Handling

**User Story:** As a judge, I want to submit a tampered, ambiguous, or unsupported Report and see Spoolgeist refuse or route it for review, so that I can see that unexplained content is never silently accepted.

#### Acceptance Criteria

1. IF a submitted Report contains Unexplained Content, THEN THE Spoolgeist SHALL NOT enter Accepted State and SHALL enter Refusal State or Review State.
2. WHEN Spoolgeist enters Refusal or Review State, THE Spoolgeist SHALL display the offending line(s), the reason (unexplained, altered, ambiguous, out-of-range, or layout mismatch), and what the operator must resolve.
3. IF a Report does not match any supported Layout, THEN THE Spoolgeist SHALL NOT process it as if supported and SHALL identify the layout mismatch.
4. IF a value within a Report is ambiguous or fails plausibility checks, THEN THE Spoolgeist SHALL route the Report to Review State rather than silently resolving the ambiguity into a verified result.
5. WHEN a Report enters Refusal or Review State, THE Spoolgeist SHALL preserve and display all Suspicious Content and Suspicious values (no silent discarding of problematic information).
6. IF a Report contains Suspicious Content, THEN THE Spoolgeist SHALL NOT represent any of its data as verified/accepted output.

### Requirement 4: Unknown Layout Onboarding

**User Story:** As a lab operator, I want to submit a Report in an unknown Layout and have the AI Provider draft an Extraction Rule for it, so that the layout can be supported without manual rule authoring.

#### Acceptance Criteria

1. WHEN a Report with an unknown Layout is submitted and the operator chooses to onboard it, THE Spoolgeist MAY invoke the AI Provider to produce a Rule Proposal.
2. WHEN the AI Provider is invoked for onboarding, THE Spoolgeist SHALL treat the returned Rule Proposal as untrusted input, subject to validation and approval before any activation.
3. WHILE a Rule Proposal exists without a passed validation and an explicit Approval, THE Deterministic Engine SHALL NOT use the Rule Proposal to process any Report.
4. WHEN the AI Provider is unavailable or operating in Demonstration Mode, THE Spoolgeist SHALL use a pre-recorded draft response and SHALL indicate this honestly in the UI.
5. THE AI Provider SHALL be invoked only during onboarding (rule drafting), and SHALL NOT be invoked during processing of any Report.
6. WHEN a Rule Proposal produced during onboarding has not yet passed the Validation Gate, THE Spoolgeist SHALL NOT permit an Approval action on that proposal and SHALL indicate that validation must be completed first.

### Requirement 5: Adversarial Validation Gate

**User Story:** As a safety-conscious judge, I want every Rule Proposal to be challenged by an independently designed validation suite before it can be activated, so that no unvalidated rule ever processes real submissions.

#### Acceptance Criteria

1. WHEN a Rule Proposal is submitted for validation, THE Validation Gate SHALL execute a test suite consisting of (a) a fixed, hand-authored baseline suite of adversarial Reports defined at build time, and (b) additional layout-specific test cases derived from the Layout being onboarded.
2. THE Validation Gate SHALL test, at minimum, these properties: correct extraction on valid Reports; refusal of Reports with Unexplained Content; refusal of tampered values; refusal of layout mismatches; deterministic behavior across repeats; and Line Accounting completeness (every line of every test Report classified).
3. WHEN the Validation Gate runs, THE Spoolgeist SHALL display the test cases used, the property each tests, per-case pass/fail, and the observed Rule Proposal behavior, in human-readable form (explainable evidence, not just a counter or animation).
4. IF any test case in the suite fails, THEN THE Rule Proposal SHALL NOT be eligible for Approval and THE Spoolgeist SHALL display the failing case, expected vs. actual behavior, and the reason for failure.
5. WHEN a failed Rule Proposal is repaired (by re-drafting via the AI Provider or operator editing), THE Validation Gate SHALL re-run the complete suite from scratch against the modified proposal.
6. THE Spoolgeist SHALL NOT permit activation of any Rule Proposal that has not passed the full current Validation Gate run in its current form, and SHALL permit activation only when both conditions are met: the full current Validation Gate run has passed and an explicit Approval of the exact current rule version has been recorded (per Requirement 6); passing the Validation Gate alone is necessary but not sufficient for activation.
7. WHEN a Validation Gate result is presented, THE Spoolgeist SHALL state the gate's known limitations honestly (what it does and does not prove) and SHALL NOT claim proof of safety or zero errors.
8. WHEN a Rule Proposal's validation evidence is displayed, THE Spoolgeist SHALL identify the rule version to which the evidence applies.

### Requirement 6: Human Rule Approval

**User Story:** As a responsible operator, I want to explicitly approve a validated Rule Proposal and be able to revoke or re-validate it later, so that only human-vouched rules ever process Reports.

#### Acceptance Criteria

1. WHEN an operator approves a rule, THE Spoolgeist SHALL present, before approval: the rule definition, the complete current validation evidence (per Requirement 5), any remaining warnings, and the synthetic-data scope statement.
2. THE Approval SHALL be recorded as a traceable event capturing the rule version (content hash), the validation run it applies to, and a timestamp, in a form inspectable in the UI.
3. WHEN a rule is approved, THE Spoolgeist SHALL activate it for the corresponding Layout, and only then SHALL the Deterministic Engine process Reports of that Layout.
4. IF an approved rule is modified in any way, THEN the prior Approval SHALL become invalid and the rule SHALL be deactivated pending re-validation and re-approval.
5. WHEN a rule's Approval becomes invalid, THE Spoolgeist SHALL display the invalidation (changed content, failed re-validation, or revocation) and SHALL prevent processing under the invalidated rule.
6. THE operator SHALL be able to revoke an approved rule at any time, upon which the rule is deactivated and subsequent Reports of that Layout enter the unknown-Layout path.
7. IF a rule has not passed the current Validation Gate, THEN THE Spoolgeist SHALL NOT permit its Approval.

### Requirement 7: Repeat Processing (Zero-AI Demonstration)

**User Story:** As a judge, I want to resubmit a previously onboarded Report type and see it processed with the approved rule and zero AI calls, so that I can see the deterministic promise holds.

#### Acceptance Criteria

1. WHEN a previously onboarded Layout's Report is resubmitted, THE Spoolgeist SHALL process it via the Deterministic Engine under the approved rule with no AI Provider invocation.
2. THE Spoolgeist SHALL visibly and honestly display, for each processed Report, the count of AI Provider calls made (expected: zero) for that processing.
3. WHEN the same Report is resubmitted multiple times, THE Spoolgeist SHALL produce identical extraction results (idempotent, deterministic repeat processing).

### Requirement 8: Output

**User Story:** As a judge, I want the Accepted State data to be presented in valuable output forms, so that I can see the end value of the extraction.

#### Acceptance Criteria

1. WHEN a Report reaches Accepted State, THE Spoolgeist SHALL display a clear extraction results view with per-value provenance and the Line Accounting summary (the primary output).
2. THE patient-friendly verified report view and FHIR DiagnosticReport export are stretch goals: IF implemented, they SHALL represent only Accepted State data and SHALL NOT include ambiguous, refused, or unreviewed content as verified information.
3. IF FHIR Export is implemented, THE FHIR Export SHALL produce a valid FHIR DiagnosticReport resource for the extracted measurements, marked with synthetic-data provenance.
4. IF continuing implementation of the FHIR Export or patient-friendly view would compromise delivery of any core-workflow requirement (Requirements 1–7), THEN THE Spoolgeist SHALL cut those stretch goals and prioritize core-workflow completion; stretch goals SHALL NOT be cut solely due to time pressure if core-workflow delivery is not at risk.

### Requirement 9: Safety and Correctness Properties

**User Story:** As the spec author, I want the core safety properties made precise and testable, so that implementation can be verified against them.

#### Acceptance Criteria

1. THE Deterministic Engine SHALL NOT produce an Accepted State for any Report unless both conditions hold: the Report contains zero Unexplained Content and the Extraction Rule used to process it is in an approved state (has passed the Validation Gate and received an explicit Approval); absence of Unexplained Content alone is insufficient for Accepted State.
2. THE Spoolgeist SHALL NOT accept a Report as supported unless its Layout matches an active approved Extraction Rule's layout condition.
3. THE Spoolgeist SHALL NOT resolve an ambiguous value into a verified result without explicit human confirmation (Review State).
4. THE Spoolgeist SHALL NOT activate a Rule Proposal with a failed or absent Validation Gate result.
5. THE Spoolgeist SHALL activate an Extraction Rule only after an explicit recorded Approval of the exact current rule version.
6. IF an approved rule's content changes, THEN THE Spoolgeist SHALL invalidate its Approval (no stale approvals).
7. THE Deterministic Engine's output SHALL be a pure function of (Report, active Extraction Rule) with no dependence on AI Provider, network, or non-deterministic state.
8. THE report-processing path (after Approval) SHALL make zero AI Provider calls.
9. THE Spoolgeist SHALL treat all AI-generated content as untrusted proposals until validated and approved; WHEN a Rule Proposal has passed the Validation Gate and received an explicit Approval, THE Spoolgeist SHALL treat that approved rule as trusted for deterministic processing.
10. WHEN any value is displayed as extracted, THE Spoolgeist SHALL provide an explainable path from the value back to its source line in the Report.
11. WHILE a Report is in Refusal or Review State, THE Spoolgeist SHALL preserve all Suspicious and Unexplained Content for operator inspection.
12. THE Spoolgeist SHALL NOT display claims of clinical safety, clinical validation, or real-world validation; all UI copy SHALL reflect synthetic-data demonstration scope.

### Requirement 10: Scope and Integrity Constraints

**User Story:** As the competition entrant, I want the application's scope and prior-work boundaries explicit, so that competition integrity is maintained.

#### Acceptance Criteria

1. THE Spoolgeist SHALL use only synthetic data, SHALL NOT accept or solicit real patient data, and SHALL label this clearly.
2. THE Spoolgeist SHALL support at most 3 Layouts and at most 12 laboratory measurements in this golden-path version.
3. THE application source SHALL be designed and implemented in this repository without copying or transplanting the prior research prototype's code or architecture (per PRIOR_WORK.md).
4. WHEN prior-work-derived test oracles are used, THE Spoolgeist's documentation SHALL disclose that usage accurately in PRIOR_WORK.md.

### Requirement 11: Safe Execution of Extraction Rules

**User Story:** As the developer, I want extraction expressions/patterns (AI-drafted or operator-edited) to execute safely within bounded resources, so that no rule can hang or compromise the system.

#### Acceptance Criteria

1. WHEN an Extraction Rule's match or extraction expressions are executed, THE Deterministic Engine SHALL execute them with linear-time-bounded matching (no catastrophic backtracking), enforced via the chosen safe-matching approach (e.g., RE2-style engine or equivalent bound).
2. THE Deterministic Engine SHALL enforce an execution time bound per Report and SHALL enter Refusal State with a timeout reason if the bound is exceeded.
3. WHEN a Rule Proposal contains an expression violating the safe-matching constraints, THE Validation Gate SHALL reject the proposal with a descriptive error.

---

## Notes for Design (non-binding context)

- Technology direction: TypeScript full-stack (frontend + backend) for a cohesive, deployable demo; safe matching via RE2-style engine if feasible. Final architecture choice to be made in the Design phase with a documented trade-off analysis.
- Cut-line order (tightest deadline first): FHIR Export → patient-friendly view → polish on secondary screens; Requirements 1–7 are the inviolable core.
- Demonstration Mode (recorded AI responses) is required as a fallback for hosted demo reliability.
