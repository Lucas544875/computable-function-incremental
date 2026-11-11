import { describe, expect, it } from "vitest";
import { parseTerm } from "../src/core/parse";
import { check, type FnDef } from "../src/core/term";
import { computeGodel } from "../src/course/final";
import { parseF } from "../src/course/godel";
import { Game } from "../src/sim/game";
import { SOLUTIONS } from "./solutions";

const numeralTerm = (n: number) => `${"C(S; ".repeat(n)}Z${")".repeat(n)}`;

// 図式(G0)と記号列(G1 の一部)の解答例
const COURSE_SOLUTIONS: [string | null, string][] = [
  ["bsum", "bsum<f/2> = R(C[1](Z;), C(add; P[3,3], C(f; P[3,1], P[3,2])))"],
  ["bprod", "bprod<f/2> = R(C[1](C(S; Z);), C(mult; P[3,3], C(f; P[3,1], P[3,2])))"],
  ["bex", "bex<f/2> = C(sgn; bsum<C(sgn; f)>)"],
  ["ball", "ball<f/2> = C(is_zero; bsum<C(is_zero; f)>)"],
  ["bmu", "bmu<f/2> = bsum<C(is_zero; C(bsum<C(sgn; f)>; P[2,1], C(S; P[2,2])))>"],
  ["cases", "cases<c/1, f/1, g/1> = C(add; C(mult; C(sgn; c), f), C(mult; C(is_zero; c), g))"],
  [null, "cnt2<f/3> = R(C[2](Z;), C(add; P[4,4], C(f; P[4,1], P[4,2], P[4,3])))"],
  ["bex2", "bex2<f/3> = C(sgn; cnt2<C(sgn; f)>)"],
  ["ball2", "ball2<f/3> = C(is_zero; cnt2<C(is_zero; f)>)"],
  ["bmu2", "bmu2<f/3> = cnt2<C(is_zero; C(cnt2<C(sgn; f)>; P[3,1], P[3,2], C(S; P[3,3])))>"],
  [null, `twelve = ${numeralTerm(12)}`],
  [null, `thirteen = ${numeralTerm(13)}`],
  [null, "rep13 = C(div; C(pred; C(exp; C[1](thirteen;), P[1,1])), C[1](twelve;))"],
  ["len", "len = C(bmu<C(lt; P[2,1], C(rep13; C(S; P[2,2])))>; P[1,1], S)"],
  ["concat", "concat = C(add; C(mult; P[2,1], C(exp; C[2](thirteen;), C(len; P[2,2]))), P[2,2])"],
];

describe("不完全性コース(探究モードで通し)", () => {
  const g = new Game("explore", 3);
  g.research.add("editor");

  it("T0〜T4 の解答例で契約が進み、図式が解禁される", () => {
    for (const [cid, src] of SOLUTIONS) {
      expect(g.exec({ c: "define", src }).ok, src).toBe(true);
      if (cid) {
        const r = g.exec({ c: "claim", name: src.split(" ")[0], id: cid });
        expect(r.data?.ok, `${cid}: ${r.error ?? JSON.stringify(r.data?.counter)}`).toBe(true);
      }
    }
    expect(g.has("schema")).toBe(true);
    expect(g.has("mu")).toBe(true);
    expect(g.unlocked("bsum")).toBe(true);
    expect(g.unlocked("univ")).toBe(true);
  });

  it("図式と記号列の解答例が検査に合格し、定理化される", () => {
    for (const [cid, src] of COURSE_SOLUTIONS) {
      const r0 = g.exec({ c: "define", src });
      expect(r0.ok, `${src}: ${r0.error}`).toBe(true);
      if (cid) {
        const name = src.split(/[ <]/)[0];
        const r = g.exec({ c: "claim", name, id: cid });
        expect(r.data?.ok, `${cid}: ${r.error ?? JSON.stringify(r.data?.counter ?? r.data?.message)}`).toBe(
          true,
        );
        expect(g.defs.get(name)!.theorem).toBe(true);
      }
    }
    expect(g.contracts.get("len")!.cleared).toBe(true);
    expect(g.unlocked("at")).toBe(true);
  });

  it("間違った図式は、装着した関数つきの反例で不合格になる", () => {
    g.exec({ c: "define", src: "badsum<f/2> = R(C[1](Z;), C(add; P[3,3], C(f; P[3,1], P[3,1])))" });
    const r = g.exec({ c: "claim", name: "badsum", id: "bprod" });
    expect(r.data.ok).toBe(false);
    expect(r.data.counter.probe).toBeTruthy();
  });

  it("セーブとロードで図式と定理化が戻る", () => {
    const h = Game.load(g.serialize(0), 0);
    expect(h.defs.get("bmu")!.theorem).toBe(true);
    expect(h.defs.get("len")!.theorem).toBe(true);
    const r = h.exec({ c: "testRun", name: "len", args: ["1000000"] });
    expect(r.data.value).toBe("6");
  });

  it("工場モードでも、盤面に流せない契約は検査だけで達成できる", () => {
    const f = new Game("factory", 3);
    f.research.add("editor").add("schema");
    for (const id of [
      "id",
      "plus2",
      "succ2nd",
      "add",
      "pred",
      "monus",
      "mult",
      "sgn",
      "is_zero",
      "eq",
      "lt",
      "div",
      "mod",
      "is_prime",
    ])
      f.contracts.get(id)!.cleared = true;
    for (const [, src] of SOLUTIONS.slice(0, 23)) f.exec({ c: "define", src });
    f.exec({ c: "define", src: COURSE_SOLUTIONS[0][1] });
    const tp = f.tp;
    expect(f.exec({ c: "claim", name: "bsum", id: "bsum" }).data.ok).toBe(true);
    expect(f.contracts.get("bsum")!.cleared).toBe(true);
    expect(f.defs.get("bsum")!.theorem).toBe(true);
    expect(f.tp).toBe(tp + 2);
    expect(f.exec({ c: "activate", id: "bsum", on: true }).ok).toBe(false);
  });
});

describe("ゲーデル文の構成", () => {
  const env0 = { get: () => undefined };
  const mk = (id: string, src: string, claim: string): FnDef & { claim: string; theorem: boolean } => {
    const term = parseTerm(src);
    return { id, arity: check(term, env0), term, claim, theorem: true };
  };
  it("小さい項なら実際に書き下し、記号数の計算と一致する", () => {
    const defs = [mk("d", "C(S; S)", "diag"), mk("p", "R(P[1,1], C(S; P[3,3]))", "prf")];
    const env = { get: (id: string) => defs.find((d) => d.id === id) };
    const r = computeGodel(defs, env, () => true);
    expect(r.ok, r.error).toBe(true);
    expect(r.exact).toBe(true);
    expect(parseF(r.preview.replace("…", ""))).toBeNull(); // 冒頭だけなので単体では論理式でない
    expect(BigInt(r.sizeG)).toBeGreaterThan(BigInt(r.sizeA));
  });
  it("μ を使った項は受け付けない", () => {
    const defs = [mk("d", "M(P[2,2])", "diag"), mk("p", "P[2,1]", "prf")];
    const env = { get: (id: string) => defs.find((d) => d.id === id) };
    expect(computeGodel(defs, env, () => true).ok).toBe(false);
  });
  it("巨大な項でも記号数は計算できる(共有部分を 1 回だけ数える)", () => {
    const defs: (FnDef & { claim?: string; theorem?: boolean })[] = [
      mk("f0", "R(P[1,1], C(S; P[3,3]))", "x"),
    ];
    for (let i = 1; i <= 60; i++) defs.push(mk(`f${i}`, "P[2,1]", "x"));
    for (let i = 1; i <= 60; i++) defs[i].term = parseTerm(`C(f${i - 1}; f${i - 1}, f${i - 1})`);
    defs.push({ ...mk("d", "S", "diag"), term: parseTerm("C(f60; P[1,1], P[1,1])") });
    defs.push({ ...mk("p", "P[2,1]", "prf"), term: parseTerm("f60") });
    const env = { get: (id: string) => defs.find((d) => d.id === id) };
    const r = computeGodel(defs, env, () => true);
    expect(r.ok, r.error).toBe(true);
    expect(r.exact).toBe(false);
    expect(r.sizeA.length).toBeGreaterThan(25);
  });
});
