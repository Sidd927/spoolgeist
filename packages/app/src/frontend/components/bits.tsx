import type { ProcessingState, RuleStatus } from "@spoolgeist/core";

export function GhostGlyph({ title }: { title?: string }) {
  return (
    <svg className="ghost-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d="M3 14V7a5 5 0 0 1 10 0v7l-1.7-1.2L9.6 14 8 12.8 6.4 14l-1.7-1.2z" strokeLinejoin="round" />
      <path d="M6.6 6.4a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.8.6-.8 1.1" strokeLinecap="round" />
      <circle cx="8" cy="10.3" r=".5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 28V14a10 10 0 0 1 20 0v14l-3.3-2.5L19.3 28 16 25.5 12.7 28l-3.4-2.5z" fill="var(--primary)" />
      <circle cx="12" cy="14" r="2" fill="var(--canvas)" />
      <circle cx="20" cy="14" r="2" fill="var(--canvas)" />
      <rect x="9" y="19" width="14" height="1.6" fill="var(--canvas)" opacity=".5" />
    </svg>
  );
}

const STATE_LABEL: Record<ProcessingState, [string, string]> = {
  accepted: ["✓", "accepted"],
  refusal: ["✕", "refused"],
  review: ["◐", "needs review"],
  "layout-mismatch": ["?", "unknown layout"],
};

export function StateBadge({ state }: { state: ProcessingState }) {
  const [icon, word] = STATE_LABEL[state];
  return (
    <span className={"badge " + state}>
      <span aria-hidden="true">{icon}</span>
      {word}
    </span>
  );
}

const STATUS_ICON: Record<RuleStatus, string> = {
  draft: "◌", "validation-failed": "✕", validated: "✓", approved: "✓", active: "●", invalidated: "✕", revoked: "⊘",
};

export function StatusBadge({ status }: { status: RuleStatus }) {
  return (
    <span className={"badge " + status}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span>
      {status}
    </span>
  );
}

export function Hash({ value, n = 12 }: { value: string; n?: number }) {
  return (
    <span className="hash" title={value}>
      sha256:{value.slice(0, n)}…
    </span>
  );
}

export function ZeroAi() {
  return (
    <span className="badge zero-ai" title="The deterministic engine made no AI or network calls for this result">
      <span aria-hidden="true">∅</span> 0 AI calls
    </span>
  );
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${iso.slice(0, 16).replace("T", " ")}Z`;
}
