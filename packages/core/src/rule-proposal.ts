/**
 * rule-proposal.ts — turns UNTRUSTED proposal text (from an AI model, a
 * recording, or an operator) into a typed ExtractionRule, or explains why not.
 *
 * Written by Claude Code. Nothing here executes the rule; it only checks shape
 * and that every pattern compiles under RE2. Passing this check means "well
 * formed", not "safe" — safety is decided by the validation gate and a human.
 */
import { compileExpression } from "./expression-runner.js";
import type { ExtractionRule, LineClassification, PlausibilityCheck } from "./types.js";

export interface ProposalParseResult {
  ok: boolean;
  rule?: ExtractionRule;
  errors: string[];
}

const MAX_PROPOSAL_CHARS = 50_000;
const MAX_CLASSIFICATIONS = 80;
const MAX_PATTERN_CHARS = 300;

/**
 * Extracts the first JSON object from model output (tolerates ```json fences).
 * Plain string scanning only: model output is untrusted, and a backtracking
 * native RegExp over 50 KB of it could take quadratic time (found in review).
 */
export function extractJsonObject(text: string): string | null {
  let body = text;
  const open = text.indexOf("```");
  if (open >= 0) {
    const close = text.indexOf("```", open + 3);
    if (close > open) {
      body = text.slice(open + 3, close);
      if (body.startsWith("json")) body = body.slice(4);
    }
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

export function parseRuleProposal(text: string): ProposalParseResult {
  const errors: string[] = [];
  if (text.length > MAX_PROPOSAL_CHARS) return { ok: false, errors: ["proposal is too large"] };
  const json = extractJsonObject(text);
  if (json === null) return { ok: false, errors: ["no JSON object found in proposal"] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: ["proposal is not valid JSON: " + (e as Error).message] };
  }
  if (!isObj(raw)) return { ok: false, errors: ["proposal must be a JSON object"] };

  const str = (o: Record<string, unknown>, k: string, where: string): string => {
    const v = o[k];
    if (typeof v !== "string" || v.length === 0) {
      errors.push(`${where}.${k} must be a non-empty string`);
      return "";
    }
    return v;
  };
  /** Line patterns may be "" (matches only an empty line); the layout pattern may not. */
  const pattern = (o: Record<string, unknown>, k: string, where: string, allowEmpty = k === "lineMatchExpression"): string => {
    if (allowEmpty && o[k] === "") return "";
    const p = str(o, k, where);
    if (p.length > MAX_PATTERN_CHARS) errors.push(`${where}.${k} is longer than ${MAX_PATTERN_CHARS} characters`);
    else if (p) {
      try {
        compileExpression(p);
      } catch (e) {
        errors.push(`${where}.${k} is not valid RE2 (no backreferences or lookarounds): ${(e as Error).message}`);
      }
    }
    return p;
  };

  const layoutVersion = raw.layoutVersion ?? 1;
  if (typeof layoutVersion !== "number" || !Number.isInteger(layoutVersion) || layoutVersion < 1) {
    errors.push("layoutVersion must be a positive integer");
  }

  const lcs = raw.lineClassifications;
  const lineClassifications: LineClassification[] = [];
  if (!Array.isArray(lcs) || lcs.length === 0) errors.push("lineClassifications must be a non-empty array");
  else if (lcs.length > MAX_CLASSIFICATIONS) errors.push(`at most ${MAX_CLASSIFICATIONS} lineClassifications`);
  else {
    const ids = new Set<string>();
    lcs.forEach((c, i) => {
      const w = `lineClassifications[${i}]`;
      if (!isObj(c)) return void errors.push(`${w} must be an object`);
      switch (c.kind) {
        case "extract": {
          const measurementId = str(c, "measurementId", w);
          if (ids.has(measurementId)) errors.push(`${w}.measurementId "${measurementId}" is duplicated`);
          ids.add(measurementId);
          const lc: LineClassification = {
            kind: "extract",
            measurementId,
            measurementName: str(c, "measurementName", w),
            lineMatchExpression: pattern(c, "lineMatchExpression", w),
          };
          if (c.expectedUnit !== undefined) {
            if (typeof c.expectedUnit !== "string" || !c.expectedUnit) errors.push(`${w}.expectedUnit must be a string`);
            else lc.expectedUnit = c.expectedUnit;
          }
          if (c.required !== undefined) {
            if (typeof c.required !== "boolean") errors.push(`${w}.required must be boolean`);
            else lc.required = c.required;
          }
          if (c.plausibleRange !== undefined) {
            const r = c.plausibleRange;
            if (!isObj(r) || !isNum(r.min) || !isNum(r.max) || r.min > r.max) {
              errors.push(`${w}.plausibleRange must be {min, max} finite numbers with min <= max`);
            } else lc.plausibleRange = { min: r.min, max: r.max };
          }
          lineClassifications.push(lc);
          break;
        }
        case "ignore":
          lineClassifications.push({ kind: "ignore", reason: str(c, "reason", w), lineMatchExpression: pattern(c, "lineMatchExpression", w) });
          break;
        case "header":
        case "footer":
          lineClassifications.push({ kind: c.kind, lineMatchExpression: pattern(c, "lineMatchExpression", w) });
          break;
        default:
          errors.push(`${w}.kind must be one of extract | ignore | header | footer`);
      }
    });
    if (!lineClassifications.some((c) => c.kind === "extract")) errors.push("a rule must extract at least one measurement");
  }

  const plausibilityChecks: PlausibilityCheck[] = [];
  if (raw.plausibilityChecks !== undefined) {
    if (!Array.isArray(raw.plausibilityChecks)) errors.push("plausibilityChecks must be an array");
    else
      raw.plausibilityChecks.forEach((p, i) => {
        const w = `plausibilityChecks[${i}]`;
        if (!isObj(p) || !["ratio", "range", "mutual-consistency"].includes(p.kind as string) || !isObj(p.parameters)) {
          return void errors.push(`${w} must have kind ratio | range | mutual-consistency and a parameters object`);
        }
        plausibilityChecks.push({
          checkId: str(p, "checkId", w),
          description: str(p, "description", w),
          kind: p.kind as PlausibilityCheck["kind"],
          parameters: p.parameters,
        });
      });
  }

  const rule: ExtractionRule = {
    ruleId: str(raw, "ruleId", "rule"),
    layoutId: str(raw, "layoutId", "rule"),
    layoutName: str(raw, "layoutName", "rule"),
    layoutVersion: typeof layoutVersion === "number" ? layoutVersion : 1,
    layoutMatchExpression: pattern(raw, "layoutMatchExpression", "rule"),
    lineClassifications,
    plausibilityChecks,
    metadata: {
      createdAt: typeof (raw.metadata as Record<string, unknown> | undefined)?.createdAt === "string"
        ? ((raw.metadata as Record<string, unknown>).createdAt as string)
        : "1970-01-01T00:00:00.000Z",
      draftedBy: (raw.metadata as Record<string, unknown> | undefined)?.draftedBy === "operator" ? "operator" : "ai",
      ...(typeof (raw.metadata as Record<string, unknown> | undefined)?.aiModel === "string"
        ? { aiModel: (raw.metadata as Record<string, unknown>).aiModel as string }
        : {}),
    },
  };

  return errors.length ? { ok: false, errors } : { ok: true, rule, errors };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
