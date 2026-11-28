import type { ValidationResult } from "@spoolgeist/core";
import { Hash, StateBadge, fmtTime } from "./bits.js";

export function GateResults({ result }: { result: ValidationResult }) {
  const passed = result.cases.filter((c) => c.passed).length;
  const groups = [
    ["Baseline cases (fixed, layout-agnostic)", result.cases.filter((c) => c.kind === "baseline")],
    ["Layout-specific mutations of the onboarding sample", result.cases.filter((c) => c.kind === "layout-specific")],
  ] as const;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className={"badge " + (result.passed ? "pass" : "fail")}>{result.passed ? "✓ gate passed" : "✕ gate failed"}</span>
        <span className="caption">run {result.runId} · {fmtTime(result.ranAt)} · rule <Hash value={result.ruleContentHash} n={8} /></span>
      </div>
      <div>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <span className="label">{passed} / {result.cases.length} cases behaved as required</span>
          {!result.passed && <span className="caption" style={{ color: "var(--refused)" }}>{result.cases.length - passed} failed</span>}
        </div>
        <div className="gatebar" role="img" aria-label={`${passed} of ${result.cases.length} cases passed`}>
          <span style={{ width: `${(100 * passed) / result.cases.length}%` }} />
        </div>
      </div>
      {groups.map(([title, cases]) => (
        <div key={title} className="table-scroll">
          <h3 style={{ margin: "8px 0" }}>{title}</h3>
          <table>
            <thead><tr><th scope="col">Case</th><th scope="col">What the gate tried</th><th scope="col">Required</th><th scope="col">Observed</th><th scope="col"><span className="sr-only">Pass</span></th></tr></thead>
            <tbody>
              {[...cases].sort((a, b) => Number(a.passed) - Number(b.passed)).map((c) => (
                <tr key={c.caseId} style={c.passed ? undefined : { background: "var(--refused-tint)" }}>
                  <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{c.caseId}</td>
                  <td>
                    {c.caseLabel}
                    {c.failureDetail && <div className="caption" style={{ color: "var(--refused)" }}>{c.failureDetail}</div>}
                    <details>
                      <summary className="caption" style={{ fontWeight: 500 }}>printout used</summary>
                      <pre className="json">{c.reportContent}</pre>
                    </details>
                  </td>
                  <td><StateBadge state={c.expectedState} /></td>
                  <td><StateBadge state={c.observedState} /></td>
                  <td aria-label={c.passed ? "passed" : "failed"} style={{ color: c.passed ? "var(--accepted)" : "var(--refused)", fontWeight: 600 }}>{c.passed ? "✓" : "✕"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="callout">
        <div className="label" style={{ marginBottom: 4 }}>What this gate does not prove</div>
        <p>{result.limitations}</p>
      </div>
    </div>
  );
}
