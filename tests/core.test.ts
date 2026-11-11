import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BASE_CATALOG } from "../src/core/catalog";
import { Evaluator } from "../src/core/eval";
import { parseDef, parseTerm } from "../src/core/parse";
import { check, type FnDef, show, TermError, usesMu } from "../src/core/term";
import { verify } from "../src/core/verify";
import { SOLUTIONS } from "./solutions";

function build(theorem: boolean) {
  const defs = new Map<string, FnDef>();
  const env = { get: (id: string) => defs.get(id) };
  const ev = new Evaluator(env);
  const cat = new Map(BASE_CATALOG.map((c) => [c.id, c]));
  return { defs, env, ev, cat, theorem };
}

describe("項", () => {
  it("記法の往復", () => {
    for (const [, src] of SOLUTIONS) {
      const d = parseDef(src);
      expect(show(parseTerm(show(d.term)))).toBe(show(d.term));
    }
  });
  it("アリティ違反を検出する", () => {
    const env = { get: () => undefined };
    expect(() => check(parseTerm("C(S; P[2,1], P[2,2])"), env)).toThrow(TermError);
    expect(() => check(parseTerm("R(Z, P[3,1])"), env)).toThrow(TermError);
    expect(() => check(parseTerm("P[2,3]"), env)).toThrow(TermError);
    expect(check(parseTerm("R(P[1,1], C(S; P[3,3]))"), env)).toBe(2);
  });
});

describe("解答例がカタログの検査に合格する", () => {
  for (const theorem of [false, true]) {
    it(theorem ? "定理化あり" : "定理化なし(T0〜T2)", () => {
      const b = build(theorem);
      for (const [cid, src] of SOLUTIONS) {
        const d = parseDef(src);
        const arity = check(d.term, b.env);
        const def: FnDef = { id: d.name, arity, term: d.term };
        b.defs.set(d.name, def);
        if (!cid) continue;
        const cat = b.cat.get(cid)!;
        if (!theorem && !["T0", "T1", "T2"].includes(cat.tier)) continue;
        const r = verify(b.ev, def, cat);
        expect(r, `${cid}: ${JSON.stringify(r.counter ?? r.message)}`).toMatchObject({ ok: true });
        if (theorem) {
          def.native = cat.native;
          b.ev.clear();
        }
      }
      expect(usesMu(b.defs.get("is_prime")!.term, b.env)).toBe(false);
      if (theorem) expect(usesMu(b.defs.get("collatz")!.term, b.env)).toBe(true);
    });
  }
});

describe("評価器", () => {
  const b = build(false);
  for (const [, src] of SOLUTIONS.slice(0, 10)) {
    const d = parseDef(src);
    b.defs.set(d.name, { id: d.name, arity: check(d.term, b.env), term: d.term });
  }
  it("自作の add / mult はネイティブと一致する", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }), (x, y) => {
        const a = b.ev.run(parseTerm("add"), [BigInt(x), BigInt(y)], 1e7);
        const m = b.ev.run(parseTerm("mult"), [BigInt(x), BigInt(y)], 1e7);
        return a.ok && a.value === BigInt(x + y) && m.ok && m.value === BigInt(x * y);
      }),
    );
  });
  it("停止しない最小化は予算で打ち切る", () => {
    const r = b.ev.run(parseTerm("M(C(S; P[2,2]))"), [3n], 1000);
    expect(r).toMatchObject({ ok: false, code: "budget" });
  });
  it("帯域幅を超えると破棄する", () => {
    const r = b.ev.run(parseTerm("add"), [250n, 10n], 1e6, 8);
    expect(r).toMatchObject({ ok: false, code: "overflow" });
  });
  it("コストは再現する(メモ化しても同じ)", () => {
    const c1 = b.ev.run(parseTerm("mult"), [7n, 9n], 1e7);
    const c2 = b.ev.run(parseTerm("mult"), [7n, 9n], 1e7);
    expect(c1.cost).toBe(c2.cost);
  });
});
