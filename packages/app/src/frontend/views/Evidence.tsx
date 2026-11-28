import { useApp } from "../context.js";
import { href } from "../router.js";
import { GateResults } from "../components/GateResults.js";

export function Evidence({ runId }: { runId: string }) {
  const app = useApp();
  const v = app.state.validations[runId];
  const rec = app.state.records.find((r) => r.contentHash === v?.ruleContentHash);
  if (!v) return <div className="stack"><h1>Gate run not found</h1><a href={href("rules")}>Back to rules</a></div>;
  return (
    <div className="stack">
      <div>
        <a href={href("rules")} className="caption">← rule registry</a>
        <h1>Gate evidence{rec ? `: ${rec.rule.layoutName}` : ""}</h1>
        <p className="muted">The complete record of what the validation gate tried against this exact rule content.</p>
      </div>
      <div className="tile"><GateResults result={v} /></div>
    </div>
  );
}
