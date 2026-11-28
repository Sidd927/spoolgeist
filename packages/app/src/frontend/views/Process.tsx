import { useEffect, useMemo, useState } from "react";
import type { ProcessingResult } from "@spoolgeist/core";
import { DEMO_REPORTS } from "../demo/samples.js";
import { useApp } from "../context.js";
import { go, href, type Route } from "../router.js";
import { makeReport, process, splitLines } from "../state.js";
import { Printout, Legend } from "../components/Printout.js";
import { GhostGlyph, Hash, StateBadge, ZeroAi } from "../components/bits.js";

declare const performance: { now(): number };

const VERDICT: Record<ProcessingResult["state"], { icon: string; title: string; text: string }> = {
  accepted: { icon: "✓", title: "Accepted", text: "Every line was explained by an approved rule and every value is plausible." },
  refusal: { icon: "✕", title: "Refused", text: "Something on this printout is not explained by the approved rule. Nothing from it is treated as verified." },
  review: { icon: "◐", title: "Needs human review", text: "Every line was explained, but a value is ambiguous or implausible. A person must decide; nothing is auto-accepted." },
  "layout-mismatch": { icon: "?", title: "Unknown layout", text: "No approved rule recognises this printout, so nothing was extracted. It can be onboarded." },
};

export function Process({ route }: { route: Route }) {
  const app = useApp();
  const demoId = route.query.get("r");
  const demo = DEMO_REPORTS.find((d) => d.id === demoId);
  const [text, setText] = useState(() => (demo ?? DEMO_REPORTS[0]!).lines.join("\n"));
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [ms, setMs] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [runCount, setRunCount] = useState(0);
  const lines = useMemo(() => splitLines(text), [text]);

  const run = (ls: readonly string[]) => {
    const t0 = performance.now();
    const r = process(app.state, makeReport(ls, "rpt-" + (runCount + 1), app.now(), demo ? "demo: " + demo.title : "pasted text"));
    setMs(performance.now() - t0);
    setResult(r);
    setSelected(null);
    setRunCount((n) => n + 1);
  };

  useEffect(() => {
    const d = DEMO_REPORTS.find((x) => x.id === demoId);
    if (d) {
      setText(d.lines.join("\n"));
      setEditing(false);
      run(d.lines);
    } else run(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoId, app.state]);

  const sel = result?.extractedValues.find((v) => v.provenance.lineNumber === selected);
  const rule = result?.ruleId ? app.state.records.find((r) => r.contentHash === result.ruleContentHash) : undefined;
  const s = result?.lineAccountingSummary;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Process a printout</h1>
          <p className="muted">Runs in your browser on the deterministic engine. Pick a scenario, or edit the printout and try to sneak something past it.</p>
        </div>
      </div>
      <nav aria-label="Demo printouts" className="row" style={{ gap: 6 }}>
        {DEMO_REPORTS.map((d) => (
          <a key={d.id} className="btn small" href={href("process?r=" + d.id)} aria-current={d.id === demoId ? "true" : undefined}
            style={d.id === demoId ? { borderColor: "var(--primary)", color: "var(--ink)" } : undefined}>
            {d.title}
          </a>
        ))}
      </nav>

      <div className="workbench">
        <section className="stack" aria-label="Printout">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Legend />
            <div className="row">
              {editing ? (
                <>
                  <button className="btn small" onClick={() => setEditing(false)}>Show sheet</button>
                  <button className="btn small primary" onClick={() => { setEditing(false); run(lines); }}>Process edited text</button>
                </>
              ) : (
                <button className="btn small" onClick={() => setEditing(true)}>Edit the printout</button>
              )}
            </div>
          </div>
          {editing ? (
            <label>
              <span className="sr-only">Printout text</span>
              <textarea rows={Math.max(16, lines.length + 2)} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            </label>
          ) : (
            <Printout key={runCount} lines={lines} result={result ?? undefined} selected={selected} span={sel ? { start: sel.provenance.startOffset, end: sel.provenance.endOffset } : null}
              onSelect={setSelected} animate label="Captured printout with line-accounting gutter" />
          )}
        </section>

        {result && s && (
          <aside className="stack" aria-live="polite" aria-label="Result">
            <div className={"verdict " + result.state}>
              <div className="icon" aria-hidden="true">{VERDICT[result.state].icon}</div>
              <div>
                <h2>{VERDICT[result.state].title}</h2>
                <p>{VERDICT[result.state].text}</p>
              </div>
            </div>
            <div className="stats">
              <div className="stat"><div className="caption">LINES</div><div className="v">{s.totalLines}</div></div>
              <div className="stat"><div className="caption">EXPLAINED</div><div className="v">{s.extractedLines + s.ignoredLines}</div></div>
              <div className={"stat" + (s.unexplainedLines ? " bad" : "")}><div className="caption">UNEXPLAINED</div><div className="v">{s.unexplainedLines}</div></div>
              <div className="stat ai"><div className="caption">AI CALLS</div><div className="v">{result.aiCallCount}</div></div>
            </div>
            <div className="row caption">
              <ZeroAi />
              <span>{ms.toFixed(1)} ms in your browser</span>
              {rule && <span>rule {rule.rule.ruleId} · v{rule.rule.layoutVersion} · <Hash value={rule.contentHash} n={8} /></span>}
            </div>
            {rule?.approvalRecord && (
              <p className="caption">approved by {rule.approvalRecord.approvedBy}</p>
            )}

            {(result.state === "accepted" || result.state === "review") && (
              <div className="tile">
                <h3 style={{ marginBottom: 8 }}>{result.state === "accepted" ? "Extracted values" : "Values awaiting a human decision"}</h3>
                <table>
                  <thead><tr><th>Measurement</th><th>Value</th><th>Unit</th><th>Line</th></tr></thead>
                  <tbody>
                    {result.extractedValues.map((v) => (
                      <tr key={v.measurementId + v.provenance.lineNumber} className={"clickable" + (selected === v.provenance.lineNumber ? " selected" : "")}
                        onClick={() => setSelected(v.provenance.lineNumber)} tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setSelected(v.provenance.lineNumber)}
                        aria-label={`${v.measurementName} ${v.rawValue} ${v.unit ?? ""}, from line ${v.provenance.lineNumber + 1}. Press Enter to highlight the source.`}>
                        <td>{v.measurementName}{v.plausibilityStatus === "out-of-range" && <span className="badge review" style={{ marginLeft: 8 }}>implausible</span>}</td>
                        <td className="num">{v.rawValue}</td>
                        <td className="num">{v.unit ?? "—"}</td>
                        <td className="num">{v.provenance.lineNumber + 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="caption" style={{ marginTop: 8 }}>Click a value to see the exact printed characters it came from.</p>
              </div>
            )}

            {result.state === "review" && (
              <div className="tile stack">
                <h3>Why a human is needed</h3>
                <ul className="reasons">{result.suspiciousContent?.map((x, i) => <li key={i}><span className="label">Line {x.lineNumber + 1}</span> · {x.detail}</li>)}</ul>
              </div>
            )}

            {result.state === "refusal" && (
              <div className="tile stack">
                <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}><GhostGlyph title="unexplained" /> What could not be explained</h3>
                <ul className="reasons">
                  {result.offendingLines?.map((o, i) => (
                    <li key={i}>
                      <span className="why">{o.lineNumber >= 0 ? `Line ${o.lineNumber + 1}` : "Required measurement"} · {o.reason.replace(/-/g, " ")}</span>
                      <br />{o.detail}
                      {o.lineNumber >= 0 && <><br /><code className="mono" style={{ fontSize: 12 }}>{JSON.stringify(o.content)}</code></>}
                    </li>
                  ))}
                </ul>
                <p className="muted">{result.resolutionHint}</p>
                <p className="caption">No values from this report are shown as results: a refused report has no verified data.</p>
              </div>
            )}

            {result.state === "layout-mismatch" && (
              <div className="tile stack">
                <p>{result.resolutionHint ?? "No active rule matches this layout."}</p>
                <div className="row">
                  <button className="btn primary" onClick={() => { app.setOnboardLines(lines); go("onboard"); }}>Onboard this layout</button>
                  <a className="btn" href={href("rules")}>See active rules</a>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
