import { useMemo, useState } from "react";
import { compileExpression, runExpression, parseRuleProposal, type RuleRecord, type ValidationResult } from "@spoolgeist/core";
import { useApp } from "../context.js";
import { RECORDINGS, type DraftRecording } from "../demo/recordings.js";
import { LIPID_ONBOARD } from "../demo/samples.js";
import { approveRecord, draftFromRecording, runGate } from "../state.js";
import { go, href } from "../router.js";
import { Printout } from "../components/Printout.js";
import { GateResults } from "../components/GateResults.js";
import { RuleTable } from "../components/RuleTable.js";
import { Hash, StatusBadge, fmtTime } from "../components/bits.js";

const STEPS = ["Unknown printout", "AI proposes", "Gate verifies", "Human approves", "Deterministic"];

/** A recording is offered only if its drafted rule actually recognises this printout. */
function findRecording(lines: readonly string[]): DraftRecording | undefined {
  const text = lines.join("\n");
  return Object.values(RECORDINGS).find((rec) => {
    const p = parseRuleProposal(rec.responseText);
    if (!p.rule) return false;
    try {
      return runExpression(compileExpression(p.rule.layoutMatchExpression), text) !== null;
    } catch {
      return false;
    }
  });
}

export function Onboard() {
  const app = useApp();
  const lines = app.onboardLines ?? LIPID_ONBOARD;
  const recording = useMemo(() => findRecording(lines), [lines]);
  const [draft, setDraft] = useState<RuleRecord | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [gate, setGate] = useState<ValidationResult | null>(null);
  const [active, setActive] = useState<RuleRecord | null>(null);
  const [name, setName] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = active ? 4 : gate?.passed ? 3 : draft ? 2 : 1;

  const alreadyActive = recording && app.state.records.some((r) => r.status === "active" && r.rule.layoutId === recording.layoutId);

  const doDraft = () => {
    if (!recording) return;
    setDrafting(true);
    // A short pause so the step is perceptible. No network call is made.
    window.setTimeout(() => {
      const d = draftFromRecording(app.state, recording, app.now());
      if (d.draft) {
        app.setState(d.state);
        setDraft(d.draft);
        setGate(null);
      } else setError("The recorded proposal did not parse: " + d.errors.join("; "));
      setDrafting(false);
    }, 700);
  };

  const doGate = () => {
    if (!draft) return;
    const g = runGate(app.state, draft, lines, app.now());
    app.setState(g.state);
    setDraft(g.record);
    setGate(g.result);
  };

  const doApprove = () => {
    if (!draft) return;
    try {
      const a = approveRecord(app.state, draft, name, `Synthetic ${draft.rule.layoutName} printouts only. Not for clinical use.`, app.now());
      app.setState(a.state);
      setActive(a.record);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <div>
        <h1>Onboard a new layout</h1>
        <p className="muted">The only place AI is involved. Its output is a draft that cannot touch a single report until it passes the gate and you sign it.</p>
      </div>
      <nav aria-label="Onboarding progress">
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>
              {i < step ? "✓ " : `${i + 1}. `}{s}
            </li>
          ))}
        </ol>
      </nav>
      {error && <div className="callout danger" role="alert">{error}</div>}

      <div className="two">
        <section className="stack" aria-label="Onboarding sample">
          <h2>The unknown printout</h2>
          <Printout lines={lines} label="Unknown printout to onboard" />
          {!app.onboardLines && <p className="caption">Using the synthetic lipid sample. Start from an unknown printout on the Process page to onboard something else.</p>}
        </section>

        <section className="stack" aria-label="Onboarding steps">
          {/* Step 2: AI proposal */}
          <div className="tile stack">
            <h2>AI proposes a rule</h2>
            {alreadyActive && !draft && <div className="callout ok">This layout already has an active rule. Drafting again creates a new draft beside it; the active rule keeps working until a new version is approved.</div>}
            {!recording ? (
              <div className="callout">
                <p>No recorded AI draft exists for this printout. The hosted demo never calls an AI model live, so it can only replay recordings made with the real model.</p>
                <p style={{ marginTop: 8 }}>Live drafting with your own API key is available in the local server (see the README).</p>
              </div>
            ) : !draft ? (
              <>
                <p>
                  Sends the exact prompt below to <span className="mono">{recording.aiModel}</span>. In this hosted demo the response is a{" "}
                  <span className="badge recorded">recorded</span> real model response, captured {fmtTime(recording.capturedAt)}, replayed without any network call.
                </p>
                <details><summary>Prompt sent to the model (<Hash value={recording.promptHash} n={10} />)</summary><pre className="json">{recording.prompt}</pre></details>
                <div><button className="btn primary" onClick={doDraft} disabled={drafting}>{drafting ? "Replaying recorded response…" : "Draft a rule with AI"}</button></div>
              </>
            ) : (
              <>
                <div className="row"><StatusBadge status={draft.status} /><span className="caption">{draft.rule.ruleId} · <Hash value={draft.contentHash} n={10} /></span></div>
                <p className="muted">Parsed from untrusted model output. As a <strong>draft</strong> it cannot process any report.</p>
                <RuleTable rule={draft.rule} />
                <details><summary>Raw model response (unedited)</summary><pre className="json">{recording?.responseText}</pre></details>
              </>
            )}
          </div>

          {/* Step 3: gate */}
          {draft && (
            <div className="tile stack">
              <h2>The gate tries to break it</h2>
              {!gate ? (
                <>
                  <p>Runs the draft against fixed baseline cases and mutations of this printout. Each mutation must be refused or escalated; the clean printout must be accepted.</p>
                  <div><button className="btn primary" onClick={doGate}>Run the validation gate</button></div>
                </>
              ) : (
                <GateResults result={gate} />
              )}
            </div>
          )}

          {/* Step 4: human approval */}
          {gate?.passed && !active && (
            <div className="tile stack">
              <h2>You approve, by name</h2>
              <p>Approval binds this exact content hash and gate run. Any later edit to the rule voids it automatically.</p>
              <dl className="kv">
                <dt>rule</dt><dd className="mono">{draft!.rule.ruleId} v{draft!.rule.layoutVersion}</dd>
                <dt>content hash</dt><dd className="mono" style={{ fontSize: 12 }}>{draft!.contentHash}</dd>
                <dt>evidence</dt><dd className="mono">{gate.runId} ({gate.cases.length} cases passed)</dd>
                <dt>scope</dt><dd>Synthetic {draft!.rule.layoutName} printouts only. Not for clinical use.</dd>
              </dl>
              <label>
                <span className="label">Your name (recorded with the approval)</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} placeholder="e.g. A. Reviewer" />
              </label>
              <label className="row" style={{ alignItems: "flex-start", gap: 8 }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 4 }} />
                <span>I have read what the gate does <em>not</em> prove, and I approve this rule for the stated scope.</span>
              </label>
              <div><button className="btn primary" disabled={!name.trim() || !ack} onClick={doApprove}>Approve and activate</button></div>
            </div>
          )}

          {/* Step 5 */}
          {active && (
            <div className="tile stack">
              <div className="row"><StatusBadge status="active" /><span className="caption">approved by {active.approvalRecord?.approvedBy}</span></div>
              <h2>From here on: zero AI</h2>
              <p>Every future printout of this layout is parsed by the approved rule alone. The AI is not consulted again.</p>
              <div className="row">
                <button className="btn primary" onClick={() => go("process?r=lipid-repeat")}>Process the next patient&apos;s printout</button>
                <a className="btn" href={href("rules")}>See the rule registry</a>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
