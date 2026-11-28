/**
 * decimal.ts — exact decimal handling for laboratory values.
 *
 * Written by Claude Code. Lab values are kept as their printed strings; they
 * are never converted to floating point for comparison or display. Only plain
 * decimals are valid: optional leading "-", digits, optional "." + digits.
 * No exponents, no thousands separators, no leading "+", no locale commas.
 */

const DECIMAL_RE = /^-?\d{1,9}(?:\.\d{1,6})?$/;

/** True if `s` is a plain decimal accepted as a lab value. */
export function isPlainDecimal(s: string): boolean {
  return DECIMAL_RE.test(s);
}

interface Parsed {
  neg: boolean;
  int: string; // no leading zeros (except "0")
  frac: string; // no trailing zeros
}

function parse(s: string): Parsed {
  if (!isPlainDecimal(s)) throw new Error(`not a plain decimal: ${JSON.stringify(s)}`);
  let neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [i = "0", f = ""] = body.split(".");
  const int = i.replace(/^0+(?=\d)/, "");
  const frac = f.replace(/0+$/, "");
  if (int === "0" && frac === "") neg = false; // -0 == 0
  return { neg, int, frac };
}

function cmpAbs(a: Parsed, b: Parsed): number {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const len = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(len, "0");
  const fb = b.frac.padEnd(len, "0");
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

/** Exact comparison of two plain decimals: -1, 0 or 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (pa.neg !== pb.neg) return pa.neg ? -1 : 1;
  const c = cmpAbs(pa, pb);
  const signed = pa.neg ? -c : c;
  return signed < 0 ? -1 : signed > 0 ? 1 : 0;
}

/**
 * Converts a finite JS number from a rule (e.g. a plausible-range bound) into
 * a plain decimal string without exponent. Rule bounds are authored values such
 * as 13.5 or 4000, whose shortest round-trip representation is exact.
 */
export function numberToDecimal(n: number): string {
  if (!Number.isFinite(n)) throw new Error("range bound must be finite");
  const s = String(n);
  if (/e/i.test(s)) throw new Error(`range bound ${s} must be written without exponent`);
  return s;
}
