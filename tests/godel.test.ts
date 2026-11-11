import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkProof, dec, enc, fStr, G, numeral, parseF, parseT, Q_AXIOMS, SYMS } from "../src/course/godel";
import { sampleProofs } from "../src/course/proofs";

describe("符号化", () => {
  it("記号列と自然数が 1 対 1 に対応する", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 40n }), (n) => enc(dec(n)) === n));
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...SYMS), { maxLength: 30 }),
        (a) => dec(enc(a.join(""))) === a.join(""),
      ),
    );
  });
  it("記号列の関数", () => {
    const x = enc("(v+0)=v");
    expect(G.len(x)).toBe(7n);
    expect(dec(G.concat(enc("S"), enc("0")))).toBe("S0");
    expect(dec(G.slice(x, 1n, 4n))).toBe("v+0");
    expect(G.occurs(enc("+0"), x)).toBe(1n);
    expect(G.occurs(enc("0+"), x)).toBe(0n);
    expect(G.at(x, 0n)).toBe(9n);
  });
});

describe("構文", () => {
  it("項と論理式を判定する", () => {
    for (const s of ["0", "v''", "SS0", "(v+S0)", "((v·v')+0)"]) expect(parseT(s), s).not.toBeNull();
    for (const s of ["", "S", "(v+)", "v+v", "0=0"]) expect(parseT(s), s).toBeNull();
    for (const s of [...Q_AXIOMS, "∀v∀v'(v+v')=(v'+v)", "¬¬0=0"]) expect(fStr(parseF(s)!), s).toBe(s);
    for (const s of ["0", "(0=0)", "0=0→0=0", "∀0=0", "0=0#0=0"]) expect(parseF(s), s).toBeNull();
  });
  it("2 進の数項は正しい値を表す", () => {
    const val = (s: string): bigint => {
      const ev = (t: any): bigint =>
        t.k === "0" ? 0n : t.k === "S" ? ev(t.a) + 1n : t.k === "+" ? ev(t.a) + ev(t.b) : ev(t.a) * ev(t.b);
      return ev(parseT(s));
    };
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 30n }), (n) => val(numeral(n)) === n));
  });
  it("代入と自由変数", () => {
    expect(dec(G.subst(enc("(v=v'→∀vv=v')"), enc("v"), enc("S0")))).toBe("(S0=v'→∀vv=v')");
    expect(G.is_free(enc("v"), enc("∀vv=v'"))).toBe(0n);
    expect(G.is_free(enc("v'"), enc("∀vv=v'"))).toBe(1n);
  });
});

describe("証明検査", () => {
  it("Q での実際の証明を受理する", () => {
    for (const p of sampleProofs()) {
      expect(G.prf(enc(p.proof), enc(p.goal)), p.name).toBe(1n);
      expect(G.prf(enc(p.proof), enc("0=S0")), p.name).toBe(0n);
    }
    expect(sampleProofs().find((p) => p.name === "1+1=2")!.goal).toBe("(S0+S0)=SS0");
  });
  it("1 行抜いた証明は受理しない", () => {
    const p = sampleProofs()[0];
    const lines = p.proof.split("#");
    expect(checkProof([lines[0], ...lines.slice(2)].join("#")).ok).toBe(false);
  });
  it("代入可能でない項の例化は公理にならない", () => {
    // ∀v ¬∀v' v=v' → ¬∀v' v'=v' は v' が束縛されるので不可
    expect(G.is_logic_axiom(enc("(∀v¬∀v'v=v'→¬∀v'v'=v')"))).toBe(0n);
    expect(G.is_logic_axiom(enc("(∀v¬∀v'v=v'→¬∀v'S0=v')"))).toBe(1n);
    expect(G.is_logic_axiom(enc("(∀v(0=0→v=v)→(0=0→∀vv=v))"))).toBe(1n);
    expect(G.is_logic_axiom(enc("(∀v(v=0→v=v)→(v=0→∀vv=v))"))).toBe(0n);
  });
  it("対角化と不動点", () => {
    const a = enc("¬v=0");
    const d = dec(G.diag(a));
    expect(d).toBe(`¬${numeral(a)}=0`);
    expect(parseF(dec(G.fix(enc("v=v'"), enc("¬v=0"))))).not.toBeNull();
  });
});
