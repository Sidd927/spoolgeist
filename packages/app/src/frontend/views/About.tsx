import { LIMITS, LIMITATIONS_DISCLAIMER } from "@spoolgeist/core";

export function About() {
  return (
    <div className="stack" style={{ maxWidth: 880 }}>
      <h1>What this is, and what it is not</h1>
      <div className="callout danger">
        <p><strong>Synthetic data only.</strong> Every printout, identifier and value in this demo is invented. Spoolgeist is a hackathon prototype. It is not a medical device, has no clinical validation or certification, and must not be used with real patient data.</p>
      </div>

      <section className="tile stack">
        <h2>The idea</h2>
        <p>Legacy systems that can only print still hold critical data. Spoolgeist lets an AI draft a parsing rule for a new printout layout once. The rule then has to pass an adversarial validation gate and a named human&apos;s approval. After that, every report is parsed deterministically, with no AI, and any line the rule cannot explain stops the report.</p>
      </section>

      <section className="tile stack">
        <h2>Guarantees the engine enforces (and tests)</h2>
        <ul>
          <li>Every line must <strong>fully</strong> match an approved classification. Partial matches do not count.</li>
          <li>Any unexplained line, tampered value, unit change or missing required measurement refuses the whole report.</li>
          <li>Duplicate or implausible values go to human review, never straight to acceptance.</li>
          <li>Values stay the exact printed decimal strings. Range checks are exact, with no floating point.</li>
          <li>The rule is re-hashed on every run. If it differs from the approved hash, processing stops.</li>
          <li>Rule patterns run on RE2 (re2js), which matches in linear time and rejects backreferences and lookarounds.</li>
          <li>Input limits: at most {LIMITS.maxLines} lines, {LIMITS.maxLineLength} characters per line and {LIMITS.maxChars} characters in total. A per-report time budget is checked <em>between lines</em>, not as a hard pre-emptive timeout.</li>
          <li>Processing makes zero AI calls. The result type cannot even express a non-zero count.</li>
        </ul>
      </section>

      <section className="tile stack">
        <h2>Known limitations</h2>
        <ul>
          <li>{LIMITATIONS_DISCLAIMER}</li>
          <li>Fields a rule declares as variable (identifiers, dates, reference ranges) are accepted with any value of the declared shape. The gate does not mutate them.</li>
          <li>The gate can only test units and ranges that the rule declares.</li>
          <li>The hosted demo replays <strong>recorded</strong> real model responses. It makes no live AI calls. Live drafting needs the local server and your own API key.</li>
          <li>State is kept in your browser&apos;s localStorage. It has no accounts and no shared server, and approvals here are demonstrations, not an audit trail.</li>
          <li>The demo seed pre-approves the CBC and BMP rules, and is labelled as such everywhere it appears.</li>
          <li>Only plain-text printouts are handled. Real print streams (PCL/PostScript, code pages) are out of scope here.</li>
        </ul>
      </section>

      <section className="tile stack">
        <h2>How it was built</h2>
        <p>The specification (requirements, design, task plan) and the first implementation tasks were produced with <strong>Kiro</strong>, and they are kept in <code>/.kiro</code>. When the Kiro credits ran out, development continued with <strong>Claude Code</strong>. Every commit says which tool produced it, and <code>PRIOR_WORK.md</code> has the full development log.</p>
      </section>
    </div>
  );
}
