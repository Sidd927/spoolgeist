/**
 * Honesty checks on user-facing copy (Claude Code, release audit 28 Nov 2026).
 * The build has no server and no live AI client (packages/app/src/server.ts is
 * a stub), so no screen may tell a judge that live drafting is available.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ctx, type AppCtx } from "../context.js";
import { About } from "../views/About.js";
import { Onboard } from "../views/Onboard.js";
import { seedState } from "../state.js";

const NOW = "2026-11-28T12:00:00.000Z";

/** `null` means "no printout carried over", so Onboard uses the synthetic lipid sample. */
function renderOnboard(onboardLines: readonly string[] | null) {
  const ctx: AppCtx = { state: seedState(), setState: () => {}, onboardLines, setOnboardLines: () => {}, now: () => NOW };
  return renderToStaticMarkup(createElement(Ctx.Provider, { value: ctx }, createElement(Onboard)));
}

describe("no claim of a live AI path that does not exist", () => {
  const promise = /local server|your own api key|own key/i;

  it("About says the demo replays recordings and does not promise live drafting", () => {
    const html = renderToStaticMarkup(createElement(About));
    expect(html).toMatch(/recorded/);
    expect(html).not.toMatch(promise);
  });

  it("Onboard, for a printout with no recording, says live drafting is not in this build", () => {
    const html = renderOnboard(["SOME OTHER LAB SYSTEM   PANEL X", "FOO 1.0 mg/dL"]);
    expect(html).toMatch(/No recorded AI draft exists for this printout/);
    expect(html).toMatch(/Live AI drafting is not part of this build/);
    expect(html).not.toMatch(promise);
  });

  it("Onboard, for the lipid sample, describes the draft as a past, recorded call", () => {
    const lipid = renderOnboard(null);
    expect(lipid).toMatch(/was sent once to/);
    expect(lipid).toMatch(/replayed without any network call/);
    expect(lipid).not.toMatch(/Sends the exact prompt/);
  });
});
