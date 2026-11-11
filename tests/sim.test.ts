import { describe, expect, it } from "vitest";
import { type Command, Game } from "../src/sim/game";

function must(g: Game, c: Command) {
  const r = g.exec(c);
  expect(r.ok, `${c.c}: ${r.error}`).toBe(true);
  return r;
}
const run = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g.tick();
};

describe("盤面シミュレーション(工場モード)", () => {
  const g = new Game("factory", 7);

  it("id: 入力港 → ベルト → 納品港で納品できる", () => {
    must(g, { c: "place", build: "in", x: 0, y: 0, dir: 0, contract: "id" });
    must(g, { c: "place", build: "belt", x: 1, y: 0, dir: 0 });
    must(g, { c: "place", build: "out", x: 2, y: 0, dir: 0, contract: "id" });
    must(g, { c: "activate", id: "id", on: true });
    run(g, 600);
    const st = g.contracts.get("id")!;
    expect(st.delivered).toBeGreaterThan(20);
    expect(st.wrong).toBe(0);
    expect(st.cleared).toBe(true);
    expect(g.tp).toBe(1);
    expect(g.qed.toNumber()).toBeGreaterThan(60);
  });

  it("plus2: 後者機 2 台の合成、カプセル化で C(S; S) になる", () => {
    must(g, { c: "activate", id: "id", on: false });
    must(g, { c: "place", build: "in", x: 0, y: 2, dir: 0, contract: "plus2" });
    must(g, { c: "place", build: "S", x: 1, y: 2, dir: 0 });
    must(g, { c: "place", build: "S", x: 2, y: 2, dir: 0 });
    must(g, { c: "place", build: "out", x: 3, y: 2, dir: 0, contract: "plus2" });
    must(g, { c: "activate", id: "plus2", on: true });
    run(g, 800);
    expect(g.contracts.get("plus2")!.cleared).toBe(true);
    expect(g.contracts.get("plus2")!.wrong).toBe(0);
    must(g, { c: "research", id: "encap" });
    must(g, { c: "encapsulate", x: 3, y: 2, name: "p2" });
    expect(g.meta().defs.find((d) => d.id === "p2")!.text).toBe("C(S; S)");
    const rep = must(g, { c: "claim", name: "p2", id: "plus2" });
    expect(rep.data.ok).toBe(true);
  });

  it("連続正解で定理化される", () => {
    run(g, 1200);
    const d = g.defs.get("p2")!;
    expect(g.contracts.get("plus2")!.best).toBeGreaterThanOrEqual(g.streakNeed);
    expect(d.theorem).toBe(true);
  });

  it("succ2nd: 2 引数の入力港と射影機(伝票で同期)", () => {
    must(g, { c: "activate", id: "plus2", on: false });
    must(g, { c: "place", build: "in", x: 0, y: 6, dir: 0, contract: "succ2nd" });
    must(g, { c: "place", build: "belt", x: 1, y: 6, dir: 0 });
    must(g, { c: "place", build: "belt", x: 0, y: 5, dir: 0 });
    must(g, { c: "place", build: "belt", x: 1, y: 5, dir: 0 });
    must(g, { c: "place", build: "belt", x: 2, y: 5, dir: 1 });
    must(g, { c: "place", build: "P", x: 2, y: 6, dir: 0, fn: { t: "P", n: 2, i: 2 } });
    must(g, { c: "place", build: "S", x: 3, y: 6, dir: 0 });
    must(g, { c: "place", build: "out", x: 4, y: 6, dir: 0, contract: "succ2nd" });
    must(g, { c: "activate", id: "succ2nd", on: true });
    run(g, 1500);
    const st = g.contracts.get("succ2nd")!;
    expect(st.wrong).toBe(0);
    expect(st.cleared).toBe(true);
    must(g, { c: "encapsulate", x: 4, y: 6, name: "s2" });
    expect(g.meta().defs.find((d) => d.id === "s2")!.text).toBe("C(S; P[2,2])");
  });

  it("帰納炉で add を作る", () => {
    must(g, { c: "research", id: "rec" });
    g.research.add("editor");
    must(g, { c: "define", src: "idf = P[1,1]" });
    must(g, { c: "define", src: "hs = C(S; P[3,3])" });
    must(g, { c: "activate", id: "succ2nd", on: false });
    g.qed = g.qed.add(1000);
    // 入力港(東向き): x → 前、n → 左(北)。帰納炉(東向き): 後ろ = x、左 = n
    must(g, { c: "place", build: "in", x: 0, y: 10, dir: 0, contract: "add" });
    must(g, { c: "place", build: "belt", x: 1, y: 10, dir: 0 });
    must(g, { c: "place", build: "belt", x: 0, y: 9, dir: 0 });
    must(g, { c: "place", build: "belt", x: 1, y: 9, dir: 0 });
    must(g, { c: "place", build: "belt", x: 2, y: 9, dir: 1 });
    must(g, { c: "place", build: "R", x: 2, y: 10, dir: 0, fn: { t: "R", g: "idf", h: "hs" } });
    must(g, { c: "place", build: "out", x: 3, y: 10, dir: 0, contract: "add" });
    must(g, { c: "activate", id: "add", on: true });
    run(g, 6000);
    const st = g.contracts.get("add")!;
    expect(st.wrong).toBe(0);
    expect(st.cleared).toBe(true);
    must(g, { c: "encapsulate", x: 3, y: 10, name: "myadd" });
    expect(g.meta().defs.find((d) => d.id === "myadd")!.text).toBe("R(idf, hs)");
  });

  it("撤去は全額返金、取り消しができる", () => {
    const before = g.qed.toString();
    must(g, { c: "place", build: "S", x: 20, y: 20, dir: 0 });
    must(g, { c: "remove", x: 20, y: 20 });
    expect(g.qed.toString()).toBe(before);
    must(g, { c: "undo" });
    expect(g.world.at(20, 20)?.kind).toBe("fn");
    must(g, { c: "undo" });
  });

  it("セーブとロードで状態が戻る。オフライン進行が付く", () => {
    const now = 1_000_000;
    const json = g.serialize(now);
    const h = Game.load(json, now + 3600_000);
    expect(h.defs.get("p2")!.theorem).toBe(true);
    expect(h.contracts.get("add")!.cleared).toBe(true);
    expect(h.world.cells.size).toBe(g.world.cells.size);
    expect(h.tp).toBe(g.tp);
    expect(h.offline).not.toBeNull();
    run(h, 400);
    expect(h.contracts.get("add")!.wrong).toBe(0);
  });

  it("決定論的: 同じ操作列は同じ結果になる", () => {
    const mk = () => {
      const a = new Game("factory", 99);
      a.exec({ c: "place", build: "in", x: 0, y: 0, dir: 0, contract: "id" });
      a.exec({ c: "place", build: "belt", x: 1, y: 0, dir: 0 });
      a.exec({ c: "place", build: "out", x: 2, y: 0, dir: 0, contract: "id" });
      a.exec({ c: "activate", id: "id", on: true });
      run(a, 500);
      return a.serialize(0);
    };
    expect(mk()).toBe(mk());
  });
});

describe("探究モード", () => {
  it("検査に 1 回合格すれば契約達成・定理化・解禁が進む", () => {
    const g = new Game("explore", 1);
    expect(g.exec({ c: "define", src: "idf = P[1,1]" }).ok).toBe(true);
    expect(g.exec({ c: "claim", name: "idf", id: "id" }).data.ok).toBe(true);
    expect(g.contracts.get("id")!.cleared).toBe(true);
    expect(g.defs.get("idf")!.theorem).toBe(true);
    g.exec({ c: "define", src: "bad = C(S; S)" });
    const r = g.exec({ c: "claim", name: "bad", id: "zero" });
    expect(r.data.ok).toBe(false);
    expect(r.data.counter).toMatchObject({ args: ["0"], expected: "0", actual: "2" });
    g.exec({ c: "define", src: "p2 = C(S; S)" });
    g.exec({ c: "claim", name: "p2", id: "plus2" });
    expect(g.has("encap")).toBe(true);
  });

  it("暴走する探索塔は止まったままになり、打ち切り設定で次へ進む", () => {
    const g = new Game("explore", 1);
    g.research.add("editor").add("mu");
    g.exec({ c: "define", src: "never = C(S; P[2,2])" });
    g.exec({ c: "place", build: "in", x: 0, y: 0, dir: 0, arity: 1 });
    g.exec({ c: "place", build: "M", x: 1, y: 0, dir: 0, fn: { t: "M", f: "never", cutoff: 0 } });
    g.exec({ c: "place", build: "trash", x: 2, y: 0, dir: 0 });
    run(g, 50);
    expect(g.world.at(1, 0)!.status).toBe("runaway");
    g.exec({ c: "config", x: 1, y: 0, fn: { t: "M", f: "never", cutoff: 500 } });
    run(g, 50);
    expect(g.world.at(1, 0)!.status).not.toBe("runaway");
  });
});

describe("階層昇格", () => {
  it("条件を満たすと昇格でき、盤面と進行が戻り、関数と公理点が残る", () => {
    const g = new Game("factory", 5);
    g.research.add("editor");
    g.exec({ c: "define", src: "myadd = R(P[1,1], C(S; P[3,3]))" });
    g.exec({ c: "place", build: "belt", x: 0, y: 0, dir: 0 });
    expect(g.exec({ c: "prestige" }).ok).toBe(false);
    g.contracts.get("add")!.delivered = 300;
    expect(g.exec({ c: "prestige" }).ok).toBe(true);
    expect(g.level).toBe(1);
    expect(g.axiom).toBe(1);
    expect(g.world.cells.size).toBe(0);
    expect(g.defs.has("myadd")).toBe(true);
    expect(g.contracts.get("add")!.delivered).toBe(0);
    expect(g.exec({ c: "perk", id: "speed" }).ok).toBe(true);
    expect(g.machineSpeed).toBe(2);
  });
});

describe("性能", () => {
  it("機械 1,000 台・トークン 1,000 個超で 1 tick が 50ms(20tps)に収まる", () => {
    const g = new Game("explore", 1);
    g.world.size = 128;
    let machines = 0;
    for (let row = 0; row < 60; row++) {
      const y = row * 2;
      g.exec({ c: "place", build: "in", x: 0, y, dir: 0, arity: 1 });
      for (let x = 1; x < 100; x++) {
        if (x % 5 === 0) {
          g.exec({ c: "place", build: "S", x, y, dir: 0 });
          machines++;
        } else g.exec({ c: "place", build: "belt", x, y, dir: 0 });
      }
      g.exec({ c: "place", build: "trash", x: 100, y, dir: 0 });
    }
    for (let i = 0; i < 300; i++) g.tick();
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      g.tick();
      g.frame();
    }
    const per = (performance.now() - t0) / 100;
    const tokens = g.frame().ids.length;
    console.log(`machines=${machines} tokens=${tokens} ${per.toFixed(2)}ms/tick`);
    expect(machines).toBeGreaterThan(1000);
    expect(tokens).toBeGreaterThan(1000);
    expect(per).toBeLessThan(50);
  });
});
