import { useRef, useState } from "react";
import type { ExtractionRule, RuleRecord } from "@spoolgeist/core";
import { useApp } from "../context.js";
import { LAYOUT_SAMPLES } from "../demo/samples.js";
import { approveRecord, modifyRecord, revokeRecord, runGate, seedState } from "../state.js";
import { href } from "../router.js";
import { RuleTable } from "../components/RuleTable.js";
import { Hash, StatusBadge, fmtTime } from "../components/bits.js";

/**
 * "Possess" a rule: loosen one static-line pattern so it tolerates trailing
 * text. Returns null if nothing suitable exists. This is an OPERATOR edit,
 * labelled as such; it demonstrates hash invalidation and the gate.
 */
export function possess(rule: ExtractionRule): { rule: ExtractionRule; index: number } | null {
  const cs = rule.lineClassifications;
  for (let i = cs.length - 1; i >= 0; i--) {
    const c = cs[i]!;
    if ((c.kind === "ignore" || c.kind === "footer") && c.lineMatchExpression !== "" && !c.lineMatchExpression.endsWith(".*")) {
      const next = structuredClone(rule) as ExtractionRule;
      (next.lineClassifications[i] as { lineMatchExpression: string }).lineMatchExpression = c.lineMatchExpression + ".*";
      return { rule: next, index: i };
    }
  }
  return null;
}

function sampleFor(r: RuleRecord): readonly string[] {
  return LAYOUT_SAMPLES[r.rule.layoutId as keyof typeof LAYOUT_SAMPLES]?.lines ?? [];
}

export function Rules() {
  const app = useApp();
  const [note, setNote] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<RuleRecord | null>(null);
  const [approving, setApproving] = useState<RuleRecord | null>(null);
  const [who, setWho] = useState("");
  const dlg = useRef<HTMLDialogElement>(null);
  const open = (fn: () => void) => { setWho(""); fn(); setTimeout(() => dlg.current?.showModal(), 0); };
  const close = () => { dlg.current?.close(); setRevoking(null); setApproving(null); };

  const records = [...app.state.records].reverse();

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Rule registry</h1>
          <p className="muted">Every rule, where it came from, the evidence behind it and who approved it. Stored only in this browser.</p>
        </div>
        <button className="btn danger" onClick={() => { if (window.confirm("Reset the demo to its seeded state? Your approvals in this browser are discarded.")) { app.setState(seedState()); setNote("Demo reset to the seeded state."); } }}>
          Reset demo
        </button>
      </div>
      {note && <div className="callout" role="status">{note}</div>}

      {records.map((r) => {
        const ev = r.validationRunId ? app.state.validations[r.validationRunId] : undefined;
        const key = r.rule.ruleId + r.contentHash;
        return (
          <article key={key + r.status} className="record" aria-label={`${r.rule.layoutName} ${r.status}`}>
            <header>
              <StatusBadge status={r.status} />
              <h2 style={{ fontSize: 17 }}>{r.rule.layoutName}</h2>
              <span className="caption">{r.rule.ruleId} · v{r.rule.layoutVersion} · <Hash value={r.contentHash} n={10} /></span>
            </header>
            <div className="body">
              <div>
                <h3>Proposed by</h3>
                <dl className="kv">
                  <dt>source</dt><dd>{r.proposalSource?.kind ?? "unknown"}{r.proposalSource?.kind === "recorded-ai" && <span className="badge recorded" style={{ marginLeft: 6 }}>recorded</span>}</dd>
                  {r.proposalSource?.model && <><dt>model</dt><dd className="mono">{r.proposalSource.model}</dd></>}
                  {r.proposalSource?.recordedAt && <><dt>captured</dt><dd className="mono">{fmtTime(r.proposalSource.recordedAt)}</dd></>}
                  {r.proposalSource?.promptHash && <><dt>prompt</dt><dd><Hash value={r.proposalSource.promptHash} n={10} /></dd></>}
                </dl>
              </div>
              <div>
                <h3>Evidence and approval</h3>
                <dl className="kv">
                  <dt>gate</dt><dd>{ev ? <a href={href("evidence/" + ev.runId)}>{ev.passed ? "passed" : "failed"} · {ev.cases.length} cases</a> : "not run"}</dd>
                  {r.approvalRecord ? (
                    <><dt>approved by</dt><dd>{r.approvalRecord.approvedBy}</dd><dt>at</dt><dd className="mono">{fmtTime(r.approvalRecord.approvedAt)}</dd><dt>scope</dt><dd>{r.approvalRecord.scopeStatement}</dd></>
                  ) : <><dt>approval</dt><dd>none</dd></>}
                  {r.invalidationReason && <><dt>reason</dt><dd>{r.invalidationReason}</dd></>}
                </dl>
              </div>
              <div>
                <h3>History</h3>
                <ol className="timeline">{r.history.map((e) => <li key={e.eventId}><span className="caption">{fmtTime(e.timestamp)}</span><br />{e.detail}</li>)}</ol>
              </div>
            </div>
            <details style={{ padding: "0 16px 12px" }}><summary>Rule content</summary><RuleTable rule={r.rule} /></details>
            <div className="actions">
              {r.status === "active" && (
                <>
                  <button className="btn danger small" onClick={() => open(() => setRevoking(r))}>Revoke</button>
                  <button className="btn small" title="Operator edit that loosens one pattern" onClick={() => {
                    const p = possess(r.rule);
                    if (!p) return setNote("Nothing to loosen in this rule.");
                    const m = modifyRecord(app.state, r, p.rule, app.now(), `pattern ${p.index} loosened to tolerate trailing text (demo "possession")`);
                    app.setState(m.state);
                    setNote(`👻 Possessed: pattern ${p.index} of ${r.rule.ruleId} now ends in ".*". Its hash changed, so the approval no longer applies and the rule is a draft again. This layout now has no active rule. Re-run the gate on the draft below to see whether the gate notices.`);
                  }}>Possess this rule 👻</button>
                </>
              )}
              {(r.status === "draft" || r.status === "validation-failed") && sampleFor(r).length > 0 && (
                <button className="btn small primary" onClick={() => {
                  const g = runGate(app.state, r, sampleFor(r), app.now());
                  app.setState(g.state);
                  setNote(g.result.passed ? `Gate passed for ${r.rule.ruleId}. It still needs a named approval.` : `Gate FAILED for ${r.rule.ruleId}: ${g.result.cases.filter((c) => !c.passed).map((c) => c.caseId).join(", ")}. It cannot be approved.`);
                }}>Run the gate</button>
              )}
              {r.status === "validated" && <button className="btn small primary" onClick={() => open(() => setApproving(r))}>Approve…</button>}
            </div>
          </article>
        );
      })}

      <dialog ref={dlg} onClose={() => { setRevoking(null); setApproving(null); }} aria-labelledby="dlg-title">
        <form method="dialog" className="stack" onSubmit={(e) => {
          e.preventDefault();
          const name = who.trim();
          if (!name) return;
          try {
            if (revoking) {
              app.setState(revokeRecord(app.state, revoking, name, "revoked from the registry", app.now()));
              setNote(`Revoked ${revoking.rule.ruleId}. No fallback rule was activated: ${revoking.rule.layoutName} printouts are now unrecognised.`);
            } else if (approving) {
              app.setState(approveRecord(app.state, approving, name, `Synthetic ${approving.rule.layoutName} printouts only. Not for clinical use.`, app.now()).state);
              setNote(`Approved ${approving.rule.ruleId} by ${name}.`);
            }
          } catch (err) {
            setNote((err as Error).message);
          }
          close();
        }}>
          <h2 id="dlg-title">{revoking ? `Revoke ${revoking.rule.ruleId}?` : approving ? `Approve ${approving.rule.ruleId}?` : ""}</h2>
          <p>{revoking ? "The layout will have no active rule. Matching printouts become “unknown layout” until a new rule is approved." : "Approval binds this exact content hash and its passing gate run."}</p>
          <label><span className="label">Your name</span><input type="text" value={who} onChange={(e) => setWho(e.target.value)} autoFocus maxLength={80} /></label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="submit" className={revoking ? "btn danger" : "btn primary"} disabled={!who.trim()}>{revoking ? "Revoke" : "Approve"}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
