import { useCallback, useEffect, useMemo, useState } from "react";
import { Ctx, type AppCtx } from "./context.js";
import { loadState, saveState, type AppState } from "./state.js";
import { href, useRoute } from "./router.js";
import { Mark } from "./components/bits.js";
import { Home } from "./views/Home.js";
import { Process } from "./views/Process.js";
import { Onboard } from "./views/Onboard.js";
import { Rules } from "./views/Rules.js";
import { Evidence } from "./views/Evidence.js";
import { About } from "./views/About.js";

const now = () => new Date().toISOString();
const storage = typeof window !== "undefined" ? window.localStorage : undefined;

export function App() {
  const route = useRoute();
  const [state, setStateRaw] = useState<AppState>(() => loadState(storage, now()));
  const [onboardLines, setOnboardLines] = useState<readonly string[] | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => (storage?.getItem("spoolgeist.theme") === "light" ? "light" : "dark"));

  const setState = useCallback((s: AppState) => {
    setStateRaw(s);
    saveState(storage, s);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storage?.setItem("spoolgeist.theme", theme);
  }, [theme]);

  const ctx: AppCtx = useMemo(() => ({ state, setState, onboardLines, setOnboardLines, now }), [state, setState, onboardLines]);
  const [page = ""] = route.path;
  const activeCount = state.records.filter((r) => r.status === "active").length;

  const nav: [string, string][] = [["process", "Process"], ["onboard", "Onboard"], ["rules", "Rules"], ["about", "About"]];
  let view: React.ReactNode;
  switch (page) {
    case "process": view = <Process route={route} />; break;
    case "onboard": view = <Onboard />; break;
    case "rules": view = <Rules />; break;
    case "evidence": view = <Evidence runId={route.path[1] ?? ""} />; break;
    case "about": view = <About />; break;
    default: view = <Home />;
  }

  return (
    <Ctx.Provider value={ctx}>
      {/* The app routes on the URL hash, so a plain "#main" link would navigate to an unknown route (Home). Move focus instead. */}
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="topbar">
        <a className="mark" href={href("")}><Mark />Spoolgeist</a>
        <nav className="nav" aria-label="Main">
          {nav.map(([p, label]) => (
            <a key={p} href={href(p)} aria-current={page === p || (p === "rules" && page === "evidence") ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <span className="spacer" />
        <span className="caption" title="Active rules in this browser">{activeCount} active {activeCount === 1 ? "rule" : "rules"}</span>
        <button className="btn small" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? "☀ Light" : "☾ Dark"}
        </button>
      </header>
      <div className="demo-banner" role="note">
        DEMO MODE · synthetic data only · AI drafts are recorded real model responses, replayed with no live AI calls · everything runs in your browser
      </div>
      <main id="main" tabIndex={-1}>{view}</main>
      <footer className="footer">
        Spoolgeist · Kiroween 2026 · MIT licensed · <a href="https://github.com/Sidd927/spoolgeist">source</a> · not a medical device
      </footer>
    </Ctx.Provider>
  );
}
