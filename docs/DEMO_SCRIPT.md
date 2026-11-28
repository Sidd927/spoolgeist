# Demo video script (target 2:45, hard limit 3:00)

Record at 1440×900 in the dark theme. Reset the demo first (Rules → Reset demo). Narration is in quotes.

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:15 | Home, thesis visible | "Hospitals still run systems that can only print. AI can read those printouts, but an AI that is wrong one time in a thousand is not acceptable for lab results. Spoolgeist lets the AI propose once, then takes it out of the loop." |
| 0:15–0:40 | Process → **CBC · a whisper on the hemoglobin line**. Hover the ghost on line 9. | "This printout has two words added to the hemoglobin line. A normal parser still finds 13.5 and reports success. Spoolgeist requires every character of every line to be explained by an approved rule. This line isn't, so the whole report is refused. The ghost marks the line; nothing is silently dropped." |
| 0:40–1:00 | **CBC · clean**. Click hemoglobin in the table: the exact characters highlight. Point at "0 AI calls". | "A clean report is accepted. Every value traces to the exact characters it came from. And this ran with zero AI calls, in the browser, in about a millisecond." |
| 1:00–1:15 | Quick clicks: **unit changed** (refused), **truncated** (refused), **implausible** (review) | "A unit swap, a missing line: refused. An implausible value: sent to a human. Never guessed." |
| 1:15–1:30 | **Lipid · unknown layout** → Onboard this layout | "A printout from a different lab system. No rule knows it, so nothing is extracted. Now, and only now, AI is involved." |
| 1:30–1:50 | Draft a rule with AI. Open the prompt and the raw response briefly. | "The model drafts a rule. This is a real response, recorded and replayed here, with its prompt hash. It arrives as a draft. A draft can't touch a single report." |
| 1:50–2:10 | Run the gate: 41/41. Scroll the mutation table; point at the limitations box. | "The gate tries to break it: appended text on every line, injected lines, swapped units, truncation, other layouts. Forty-one cases. And it says plainly what it does not prove." |
| 2:10–2:25 | Type a name, tick the box, Approve → "Process the next patient's printout": accepted, 0 AI calls | "A human signs it, bound to this exact content. The next patient's report: parsed deterministically. The AI is never asked again." |
| 2:25–2:45 | Rules → **Possess this rule 👻** → Run the gate → fails | "Now a little mischief. Loosen one pattern. The hash changes, so the approval is void instantly, and the gate catches the loosened line. AI may propose. Deterministic systems verify. Humans approve. Unexplained data remains visible." |
| 2:45–2:55 | About page (Kiro + Claude Code), repo URL | "Specified in Kiro, built with Kiro and Claude Code. Synthetic data only." |

**Do not claim:** clinical safety, real-world accuracy, certification, or that the hosted demo calls an AI live.
