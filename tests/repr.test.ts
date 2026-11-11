import { describe, expect, it } from "vitest";
import { pair } from "../src/core/catalog";
import { parseTerm } from "../src/core/parse";
import { listCode, termCode, termDecode, universal } from "../src/core/tcode";
import { check, show } from "../src/core/term";
import { freeVars, parseF } from "../src/course/godel";
import { arityOf, render, reprString, sizeOf } from "../src/course/repr";

const env = { get: () => undefined };
const T = (s: string) => {
  const t = parseTerm(s);
  check(t, env);
  return t;
};
const samples = [
  "Z",
  "S",
  "P[2,1]",
  "C(S; S)",
  "R(P[1,1], C(S; P[3,3]))",
  "R(Z, P[2,1])",
  "M(C(S; P[2,2]))",
  "R(C[1](Z;), C(R(P[1,1], C(S; P[3,3])); P[3,1], P[3,3]))",
];

describe("項の符号化と万能関数", () => {
  it("符号化の往復", () => {
    for (const s of samples)
      expect(show(termDecode(termCode(T(s)))!)).toBe(show(T(s)).replace(/C\[\d+\]/g, "C[0]"));
    expect(termCode(T("S"))).toBe(pair(1n, 0n));
  });
  it("U(⌜add⌝, [x, y]) = x + y など", () => {
    const add = termCode(T("R(P[1,1], C(S; P[3,3]))"));
    expect(universal(add, listCode([5n, 7n]))).toBe(12n);
    expect(universal(termCode(T("R(Z, P[2,1])")), listCode([9n]))).toBe(8n);
    expect(universal(termCode(T(samples[7])), listCode([6n, 7n]))).toBe(42n);
    expect(universal(termCode(T("M(C(S; P[2,2]))")), listCode([1n]), 5000)).toBeNull();
    expect(universal(pair(9n, 3n), 0n)).toBe(0n);
  });
});

describe("表現可能性の翻訳", () => {
  it("出力は整った論理式で、自由変数は入力と出力だけ", () => {
    for (const s of samples) {
      const t = T(s);
      const k = arityOf(t);
      const str = reprString(t)!;
      const f = parseF(str);
      expect(f, s).not.toBeNull();
      const fv = [...freeVars(f!)].sort((a, b) => a - b);
      for (const v of fv) expect(v, `${s}: ${str}`).toBeLessThanOrEqual(k);
      expect(fv).toContain(k);
    }
  });
  it("記号数の計算は実際に書き下した長さと一致する", () => {
    for (const s of samples) {
      const t = T(s);
      const k = arityOf(t);
      const ins = Array.from({ length: k }, (_, j) => j);
      expect(sizeOf(t, ins, k, k + 1)).toBe(BigInt(reprString(t)!.length));
      const ins2 = ins.map((j) => j + 5);
      expect(sizeOf(t, ins2, 3, 20)).toBe(BigInt(render(t, ins2, 3, 20)!.length));
    }
  });
  it("S の翻訳は v'=Sv", () => {
    expect(reprString(T("S"))).toBe("v'=Sv");
    expect(reprString(T("Z"))).toBe("v=0");
  });
});
