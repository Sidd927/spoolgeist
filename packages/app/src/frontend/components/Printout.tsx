import type { LineEntry, OffendingLine, ProcessingResult } from "@spoolgeist/core";
import { GhostGlyph } from "./bits.js";

interface Props {
  lines: readonly string[];
  result?: ProcessingResult | undefined;
  selected?: number | null;
  /** Character span to highlight on the selected line (provenance). */
  span?: { start: number; end: number } | null;
  onSelect?: (lineNumber: number) => void;
  animate?: boolean;
  label: string;
}

function describe(entry: LineEntry | undefined, offending: OffendingLine | undefined, measurement?: string): string {
  if (!entry) return "not processed";
  if (entry.classification === "extracted") return `result row${measurement ? ", " + measurement : ""}`;
  if (entry.classification === "ignored") {
    const k = entry.matchedKind;
    return k === "header" ? "approved header" : k === "footer" ? "approved footer" : "approved static line";
  }
  return "UNEXPLAINED" + (offending ? `: ${offending.reason.replace(/-/g, " ")}` : "");
}

export function Printout({ lines, result, selected = null, span = null, onSelect, animate, label }: Props) {
  const breakdown = result?.lineAccountingSummary.lineBreakdown;
  const offending = new Map((result?.offendingLines ?? []).map((o) => [o.lineNumber, o]));
  const names = new Map((result?.extractedValues ?? []).map((v) => [v.provenance.lineNumber, v.measurementName]));
  const absent = (result?.offendingLines ?? []).filter((o) => o.lineNumber === -1 && o.reason === "missing-measurement");

  return (
    <div className="sheet" role="region" aria-label={label}>
      <ol className={animate ? "sweep" : undefined}>
        {lines.map((text, i) => {
          const entry = breakdown?.[i];
          const cls = entry?.classification ?? "";
          const desc = describe(entry, offending.get(i), names.get(i));
          const isSel = selected === i;
          const clickable = cls === "extracted" && onSelect;
          let body: React.ReactNode = text === "" ? " " : text;
          if (isSel && span && span.start >= 0 && span.end <= text.length) {
            body = (
              <>
                {text.slice(0, span.start)}
                <mark>{text.slice(span.start, span.end)}</mark>
                {text.slice(span.end)}
              </>
            );
          }
          return (
            <li
              key={i}
              className={`pline ${cls}${isSel ? " selected" : ""}`}
              title={`Line ${i + 1}: ${desc}`}
              onClick={clickable ? () => onSelect(i) : undefined}
              onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(i)) : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={`Line ${i + 1}: ${desc}. ${text}`}
            >
              <span className="ln" aria-hidden="true">{i + 1}</span>
              <span className="g" aria-hidden="true">
                {cls === "unexplained" ? <GhostGlyph /> : cls ? <span className="bar" /> : null}
              </span>
              <span className="txt">{body}</span>
            </li>
          );
        })}
        {absent.map((o, k) => (
          <li key={"absent" + k} className="pline absent" aria-label={`Missing line: ${o.detail}`} title={o.detail}>
            <span className="ln" aria-hidden="true">–</span>
            <span className="g" aria-hidden="true"><GhostGlyph /></span>
            <span className="txt">⌀ no fully explained line for {o.detail.match(/"([^"]+)"/)?.[1] ?? "a required measurement"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend" aria-label="Gutter legend">
      <span><i style={{ background: "var(--paper-accepted)" }} />result row (extracted)</span>
      <span><i style={{ background: "#b9b2a5" }} />approved static line</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><GhostGlyph />unexplained: blocks acceptance</span>
    </div>
  );
}
