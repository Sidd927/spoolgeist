import { DEMO_REPORTS } from "../demo/samples.js";
import { href } from "../router.js";
import { StateBadge } from "../components/bits.js";

export function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <h1 className="sr-only">Spoolgeist</h1>
          <p className="thesis">
            <span className="ai">AI may propose.</span>
            <span className="det">Deterministic systems verify.</span>
            <span className="hum">Humans approve.</span>
            <span className="ghost">Unexplained data remains visible.</span>
          </p>
          <p className="lede">
            Old hospital systems can often only <em>print</em> their results. Spoolgeist reads those printouts. An AI drafts a
            parsing rule for a new layout once. The rule must survive an adversarial gate and a named human&apos;s approval. After
            that, every report is parsed with <strong>no AI at all</strong>, and any line the rule cannot fully explain stops the
            report instead of slipping through.
          </p>
          <div className="row" style={{ marginTop: 24 }}>
            <a className="btn primary" href={href("process?r=cbc-whisper")}>See a refusal first</a>
            <a className="btn" href={href("process?r=lipid-unknown")}>Onboard a new layout</a>
            <a className="btn" href={href("about")}>What this is not</a>
          </div>
        </div>
        <div className="tile stack" aria-label="Why it matters">
          <h2>The failure it prevents</h2>
          <p>
            A printed line reads <code className="mono">HEMOGLOBIN (HGB) 13.5 g/dL 12.0 - 17.5&nbsp;&nbsp;HIV REACTIVE</code>. A parser that
            searches for the number still finds <code className="mono">13.5</code> and reports success. The extra words vanish.
          </p>
          <p>
            Spoolgeist demands that every character of every line be explained by an approved rule. This line is not, so the
            whole report is refused and the line is shown, marked with the only ghost in the interface.
          </p>
          <p className="caption">All data in this demo is synthetic. Nothing here is a medical device or clinical advice.</p>
        </div>
      </section>

      <ol className="steps" aria-label="How it works">
        <li className="step"><div className="n">01 · AI PROPOSES</div><h3>Draft a rule once</h3><p className="muted">For an unknown layout only. The output is untrusted text.</p></li>
        <li className="step"><div className="n">02 · PROOF CHECKS</div><h3>Adversarial gate</h3><p className="muted">40+ mutations: appended text, foreign lines, unit swaps, truncation.</p></li>
        <li className="step"><div className="n">03 · HUMAN APPROVES</div><h3>Typed name, hash-bound</h3><p className="muted">Approval binds the exact rule content. Any edit voids it.</p></li>
        <li className="step"><div className="n">04 · DETERMINISTIC</div><h3>Zero AI, every report</h3><p className="muted">Same bytes, same rule, same result. Every line accounted for.</p></li>
      </ol>

      <section className="stack" aria-labelledby="try">
        <h2 id="try">Try a printout</h2>
        <div className="picker">
          {DEMO_REPORTS.map((d) => (
            <a key={d.id} className="pick" href={href("process?r=" + d.id)} style={{ textDecoration: "none" }}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="t">{d.title}</span>
                {d.id === "lipid-repeat" ? <span className="badge unknown">after onboarding</span> : <StateBadge state={d.expect} />}
              </span>
              <span className="muted" style={{ fontSize: 14 }}>{d.blurb}</span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
