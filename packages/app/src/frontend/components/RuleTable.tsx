import type { ExtractionRule } from "@spoolgeist/core";

export function RuleTable({ rule }: { rule: ExtractionRule }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <p className="caption" style={{ marginBottom: 6 }}>layout match: <code>{rule.layoutMatchExpression}</code></p>
      <table>
        <thead><tr><th scope="col">#</th><th scope="col">Kind</th><th scope="col">Full-line pattern (RE2)</th><th scope="col">Checks</th></tr></thead>
        <tbody>
          {rule.lineClassifications.map((c, i) => (
            <tr key={i}>
              <td className="mono caption">{i}</td>
              <td>{c.kind === "extract" ? <strong>{c.measurementName}</strong> : c.kind}{c.kind === "ignore" && <div className="caption">{c.reason}</div>}</td>
              <td><code className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{c.lineMatchExpression === "" ? "(empty line)" : c.lineMatchExpression}</code></td>
              <td className="caption">
                {c.kind === "extract" ? (
                  <>
                    unit = {c.expectedUnit ?? "—"}
                    {c.plausibleRange && <><br />plausible {c.plausibleRange.min}–{c.plausibleRange.max}</>}
                    <br />{c.required === false ? "optional" : "required"}
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
