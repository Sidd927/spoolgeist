/** decimal tests (Claude Code). */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { compareDecimal, isPlainDecimal, numberToDecimal } from "../decimal.js";

const dec = fc
  .tuple(fc.boolean(), fc.stringMatching(/^\d{1,9}$/), fc.option(fc.stringMatching(/^\d{1,6}$/)))
  .map(([neg, i, f]) => (neg ? "-" : "") + i + (f === null ? "" : "." + f));

/** Reference: scale to 6 fractional digits as BigInt. */
function scaled(s: string): bigint {
  const neg = s.startsWith("-");
  const [i = "0", f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, "0"));
  return neg ? -v : v;
}

describe("decimal", () => {
  it("accepts only plain decimals", () => {
    for (const ok of ["0", "13.5", "-2.25", "007", "123456789.123456"]) expect(isPlainDecimal(ok)).toBe(true);
    for (const bad of ["", "1e3", "+1", "1,5", ".5", "5.", "1.2.3", " 1", "1 ", "NaN", "Infinity", "1234567890", "1.1234567"])
      expect(isPlainDecimal(bad)).toBe(false);
  });

  it("compareDecimal agrees with an exact BigInt reference", () => {
    fc.assert(
      fc.property(dec, dec, (a, b) => {
        const ref = scaled(a) < scaled(b) ? -1 : scaled(a) > scaled(b) ? 1 : 0;
        expect(compareDecimal(a, b)).toBe(ref);
      }),
      { numRuns: 1000 },
    );
  });

  it("handles -0, trailing zeros and float traps exactly", () => {
    expect(compareDecimal("-0", "0")).toBe(0);
    expect(compareDecimal("1.50", "1.5")).toBe(0);
    expect(compareDecimal("0.3", "0.300000")).toBe(0);
    expect(compareDecimal("0.3", "0.299999")).toBe(1);
    expect(compareDecimal("-1.5", "-1.49")).toBe(-1);
    expect(compareDecimal("10", "9.999999")).toBe(1);
  });

  it("numberToDecimal rejects non-finite and exponent forms", () => {
    expect(numberToDecimal(13.5)).toBe("13.5");
    expect(() => numberToDecimal(Number.NaN)).toThrow();
    expect(() => numberToDecimal(1e-7)).toThrow();
  });
});
