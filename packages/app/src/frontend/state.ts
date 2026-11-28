/**
 * Application state for the hosted demo (Claude Code). All business logic is
 * delegated to @spoolgeist/core; this module only stores records and
 * evidence. The whole thing runs in the browser: there is no server state,
 * no account, and nothing a visitor does affects anyone else.
 */
import {
  approve,
  createDraft,
  modify,
  parseRuleProposal,
  processWithRegistry,
  recordValidation,
  revoke,
  runValidationGate,
  verifyIntegrity,
  type ExtractionRule,
  type ProcessingResult,
  type Report,
  type RuleRecord,
  type ValidationResult,
} from "@spoolgeist/core";
import { LAYOUT_SAMPLES } from "./demo/samples.js";
import { RECORDINGS, type DraftRecording } from "./demo/recordings.js";

export interface AppState {
  version: 1;
  records: RuleRecord[];
  validations: Record<string, ValidationResult>;
}

export const SEED_APPROVER = "Demo seed (pre-approved so the hosted demo starts with two layouts)";
const SEED_TIME = "2026-11-28T00:00:00.000Z";

export function sourceFromRecording(rec: DraftRecording) {
  return { kind: "recorded-ai" as const, model: rec.aiModel, recordedAt: rec.capturedAt, promptHash: rec.promptHash };
}

/** Samples of every known layout except `layoutId` (gate case BL-06). */
export function otherSamples(layoutId: string) {
  return Object.values(LAYOUT_SAMPLES).filter((s) => s.layoutId !== layoutId);
}

/** The starting state: CBC and BMP drafted by recorded AI, gated, approved by a labelled seed. */
export function seedState(): AppState {
  const state: AppState = { version: 1, records: [], validations: {} };
  for (const id of ["cbc", "bmp"] as const) {
    const rec = RECORDINGS[id];
    const parsed = parseRuleProposal(rec.responseText);
    if (!parsed.rule) throw new Error(`seed recording ${id} does not parse: ${parsed.errors.join("; ")}`);
    const draft = createDraft(parsed.rule, sourceFromRecording(rec), SEED_TIME);
    const v = runValidationGate({ rule: parsed.rule, sampleLines: LAYOUT_SAMPLES[id].lines, otherLayoutSamples: otherSamples(id), ranAt: SEED_TIME });
    const validated = recordValidation(draft, v, SEED_TIME);
    const active = approve(validated, v, SEED_APPROVER, `Synthetic ${LAYOUT_SAMPLES[id].layoutName} reports only. Demo seed.`, SEED_TIME);
    state.records.push(active);
    state.validations[v.runId] = v;
  }
  return state;
}

export function makeReport(lines: readonly string[], id: string, now: string, sourceLabel: string): Report {
  return { id, submittedAt: now, content: lines.join("\n"), lines, sourceLabel };
}

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // A single trailing newline is a line terminator, not an extra blank line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function process(state: AppState, report: Report): ProcessingResult {
  return processWithRegistry(report, state.records);
}

export function activeRecords(state: AppState) {
  return state.records.filter((r) => r.status === "active");
}

export function findRecord(state: AppState, ruleId: string, contentHash?: string) {
  return state.records.find((r) => r.rule.ruleId === ruleId && (contentHash === undefined || r.contentHash === contentHash));
}

function replace(state: AppState, before: RuleRecord, after: RuleRecord): AppState {
  return { ...state, records: state.records.map((r) => (r === before ? after : r)) };
}

/** Draft from a recording; returns new state and the draft. Never active. */
export function draftFromRecording(state: AppState, rec: DraftRecording, now: string): { state: AppState; draft?: RuleRecord; errors: string[] } {
  const parsed = parseRuleProposal(rec.responseText);
  if (!parsed.rule) return { state, errors: parsed.errors };
  const draft = createDraft(parsed.rule, sourceFromRecording(rec), now);
  const records = state.records.filter((r) => !(r.rule.ruleId === draft.rule.ruleId && r.status !== "active" && r.status !== "revoked"));
  return { state: { ...state, records: [...records, draft] }, draft, errors: [] };
}

export function runGate(state: AppState, record: RuleRecord, sampleLines: readonly string[], now: string): { state: AppState; record: RuleRecord; result: ValidationResult } {
  const result = runValidationGate({ rule: record.rule, sampleLines, otherLayoutSamples: otherSamples(record.rule.layoutId), ranAt: now });
  const updated = recordValidation(record, result, now);
  return { state: { ...replace(state, record, updated), validations: { ...state.validations, [result.runId]: result } }, record: updated, result };
}

export function approveRecord(state: AppState, record: RuleRecord, name: string, scope: string, now: string): { state: AppState; record: RuleRecord } {
  const v = record.validationRunId ? state.validations[record.validationRunId] : undefined;
  const active = approve(record, v, name, scope, now);
  // One active rule per layout: a newly approved version supersedes the old one.
  let next = replace(state, record, active);
  next = {
    ...next,
    records: next.records.map((r) =>
      r !== active && r.status === "active" && r.rule.layoutId === active.rule.layoutId ? revoke(r, name, `superseded by ${active.rule.ruleId} (${active.contentHash.slice(0, 8)})`, now) : r,
    ),
  };
  return { state: next, record: active };
}

export function revokeRecord(state: AppState, record: RuleRecord, name: string, reason: string, now: string): AppState {
  return replace(state, record, revoke(record, name, reason, now));
}

export function modifyRecord(state: AppState, record: RuleRecord, rule: ExtractionRule, now: string, why: string): { state: AppState; record: RuleRecord } {
  const updated = modify(record, rule, now, why);
  return { state: replace(state, record, updated), record: updated };
}

/** Re-hash everything on load; tampered stored records become "invalidated". */
export function verifyAll(state: AppState, now: string): AppState {
  return { ...state, records: state.records.map((r) => verifyIntegrity(r, now)) };
}

// ---------------- persistence (browser only) ----------------
const KEY = "spoolgeist.state.v1";

export function loadState(storage: Pick<Storage, "getItem"> | undefined, now: string): AppState {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.version === 1 && Array.isArray(s.records)) return verifyAll(s, now);
    }
  } catch {
    /* corrupted storage: fall through to a fresh seed */
  }
  return seedState();
}

export function saveState(storage: Pick<Storage, "setItem"> | undefined, state: AppState) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or disabled: state lives for this tab only */
  }
}
