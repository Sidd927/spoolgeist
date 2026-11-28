/** rule-hash tests (Claude Code). */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { canonicalJson, computeRuleHash, sha256Hex } from "../rule-hash.js";
import { cbcRule } from "./fixtures.js";

describe("sha256Hex", () => {
  it("matches NIST FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with Node's crypto for arbitrary Unicode strings and block-boundary lengths", () => {
    for (let n = 50; n < 70; n++) {
      const s = "x".repeat(n);
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), (s) => {
        expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
      }),
      { numRuns: 300 },
    );
  });
});

describe("computeRuleHash", () => {
  it("is independent of object key order", () => {
    const r = cbcRule();
    const reordered = JSON.parse(JSON.stringify(r, Object.keys(r).reverse()));
    // the replacer above drops nested keys; build a true reorder instead:
    const deepReverse = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(deepReverse)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, deepReverse(x)]))
          : v;
    void reordered;
    expect(computeRuleHash(deepReverse(r) as typeof r)).toBe(computeRuleHash(r));
  });

  it("changes when ANY nested field changes (the design's replacer-array bug)", () => {
    const base = computeRuleHash(cbcRule());
    const r = structuredClone(cbcRule());
    (r.lineClassifications[5] as { lineMatchExpression: string }).lineMatchExpression += " *";
    expect(computeRuleHash(r)).not.toBe(base);
    const r2 = structuredClone(cbcRule());
    (r2.lineClassifications[5] as { plausibleRange: { min: number; max: number } }).plausibleRange.max = 26;
    expect(computeRuleHash(r2)).not.toBe(base);
    const r3 = structuredClone(cbcRule());
    (r3.lineClassifications[5] as { expectedUnit: string }).expectedUnit = "g/L";
    expect(computeRuleHash(r3)).not.toBe(base);
  });

  it("canonicalJson omits undefined, keeps array order, rejects non-finite numbers", () => {
    expect(canonicalJson({ b: 1, a: undefined, c: [2, 1] })).toBe('{"b":1,"c":[2,1]}');
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });
});
