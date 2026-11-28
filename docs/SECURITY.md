# Security review (Claude Code, 28 Nov 2026)

This covers the hosted static demo and the core library. It is a prototype review, not an audit.

## Trust boundaries
| Input | Trust | Handling |
|---|---|---|
| Printout text (demo picker or pasted) | untrusted | Input limits (300 lines, 400 characters per line, 40,000 characters). RE2 linear-time matching only. Any unexplained character refuses the report. Rendered by React as text, never as HTML. |
| AI model output (rule proposals) | untrusted | `parseRuleProposal`: 50 KB cap, shape checks, every pattern must compile in RE2 (no backreferences or lookarounds) and be at most 300 characters. Status or approval fields in the output are ignored. The result is a **draft** that cannot process reports. |
| Rule drafts | untrusted until approved | Validation gate, then a typed-name approval bound to the content hash. The hash is recomputed before every run. |
| `localStorage` state | the visitor's own | Re-hashed on load; tampered records become `invalidated`. Malformed state falls back to the seed. This is **not** an audit trail: a visitor can rewrite their own browser state. The demo says so. |

## Threats considered
- **Hidden content beside a value** (the motivating attack). Every classification must match the whole line, and the gate appends text to every line of the sample. Tests: `engine.test.ts` P1/P1b, `validation-gate.test.ts`.
- **Prompt injection through the printout.** A printout given to the AI could ask for a permissive rule. Mitigations:
  - the gate rejects catch-all and trailing-`.*` patterns, a match-everything layout and cross-layout matches;
  - a human must approve.
  - **Residual risk:** a rule can be strict on the sample yet permissive on fields it declares variable. The gate does not mutate those fields (see Limitations).
- **ReDoS.** Rule patterns run only on re2js. Native `RegExp` is used only on fixed, non-rule patterns. **Finding fixed:** `extractJsonObject` used a backtracking native regex over model output, which was quadratic: about 113 ms on a 49 KB input, capped by the 50 KB limit. It now uses string scanning, and a timing test covers it.
- **Time.** JavaScript cannot pre-empt a synchronous match. The per-report budget is checked between lines. The real bound is linear-time RE2 plus the input limits. The docs do not claim a hard timeout.
- **XSS.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` (checked by grep). The CSP meta tag allows only `'self'` for scripts, fonts and connections, and `object-src 'none'`. (`frame-ancestors` cannot be set from a meta tag, and GitHub Pages does not allow custom headers.)
- **Third-party requests.** None. Fonts are self-hosted (OFL), with no analytics or CDNs. `referrer` is `no-referrer`.
- **Secrets.** The hosted build contains no API keys and makes no AI calls. The recording script uses the developer's local `claude` CLI login; no key is stored in the repo. `.env` files are git-ignored.
- **Dependencies.** `npm audit` on 28 Nov 2026 reported 0 vulnerabilities, both production-only and in full.
- **Floating point.** Values are compared as exact decimal strings. Ratio heuristics use floats but can only *add* review flags.

## Not covered
- Real print streams (PCL, PostScript, code pages) and RAW port 9100 capture.
- Multi-user deployment, authentication and tamper-evident audit logs.
- Real patient data. Use synthetic data only.
