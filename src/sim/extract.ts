// カプセル化: 納品港から配線を逆向きにたどって項にする。仕様書 §4.3
import { simplify, type Term, TermError } from "../core/term";
import { type Dir, type Ent, inPortDir, opp, portSide, turn, type World } from "./world";

export function machineTerm(e: Ent): Term | null {
  const f = e.fn;
  if (!f) return null;
  switch (f.t) {
    case "S":
      return { kind: "S" };
    case "P":
      return { kind: "P", n: f.n, i: f.i };
    case "Ref":
      return f.id ? { kind: "Ref", id: f.id } : null;
    case "R":
      return f.g && f.h ? { kind: "R", g: { kind: "Ref", id: f.g }, h: { kind: "Ref", id: f.h } } : null;
    case "M":
      return f.f ? { kind: "M", f: { kind: "Ref", id: f.f } } : null;
  }
}

const at = (e: Ent) => `(${e.x}, ${e.y})`;

/** 納品港 out に届く値を、入力港の引数の関数として表す項を返す */
export function extract(
  world: World,
  out: Ent,
  portArity: (e: Ent) => number,
): { term: Term; arity: number } {
  let source: Ent | null = null;
  const stack = new Set<string>();

  /** セル c の d 側の隣が c に向けて出すものの項。出していなければ null */
  const feeder = (c: Ent, side: Dir): Term | null => {
    const n = world.neighbor(c, side);
    if (!n) return null;
    return emitted(n, opp(side));
  };

  /** n が方向 e に出すものの項 */
  const emitted = (n: Ent, e: Dir): Term | null => {
    const key = `${n.id}:${e}`;
    if (stack.has(key))
      throw new TermError(`配線が輪になっています ${at(n)}。くり返しは帰納炉か探索塔で行ってください`);
    stack.add(key);
    try {
      switch (n.kind) {
        case "belt":
          return n.dir === e ? single(n, [0, 1, 2, 3].filter((s) => s !== n.dir) as Dir[]) : null;
        case "cross": {
          const t = feeder(n, opp(e));
          if (!t) throw new TermError(`交差 ${at(n)} の手前が繋がっていません`);
          return t;
        }
        case "dup":
          return e === opp(n.dir) ? null : single(n, [opp(n.dir)]);
        case "split":
          if (e === opp(n.dir)) return null;
          throw new TermError(`分配器 ${at(n)} はカプセル化できません(並列化は関数の外で行います)`);
        case "zero":
          return n.dir === e ? { kind: "C", f: { kind: "Z" }, gs: [], n: -1 } : null;
        case "in": {
          const k = portArity(n);
          for (let j = 0; j < k; j++)
            if (inPortDir(n, j) === e) {
              if (source && source !== n)
                throw new TermError("入力港が 2 つ以上繋がっています。1 つにしてください");
              source = n;
              return { kind: "P", n: -1, i: j + 1 };
            }
          return null;
        }
        case "fn": {
          if (n.dir !== e) return null;
          const f = n.term;
          const ar = n.ar ?? -1;
          if (!f || ar < 0) throw new TermError(`機械 ${at(n)} の設定が済んでいません`);
          const gs: Term[] = [];
          for (let p = 0; p < ar; p++) {
            const t = feeder(n, portSide(n, p));
            if (!t) throw new TermError(`機械 ${at(n)} の入力 ${p + 1} が繋がっていません`);
            gs.push(t);
          }
          return { kind: "C", f, gs, n: -1 };
        }
        default:
          return null;
      }
    } finally {
      stack.delete(key);
    }
  };

  const single = (c: Ent, sides: Dir[]): Term => {
    const ts = sides.map((s) => feeder(c, s)).filter((t): t is Term => t !== null);
    if (ts.length === 0) throw new TermError(`${at(c)} の手前が途切れています`);
    if (ts.length > 1)
      throw new TermError(`${at(c)} でベルトが合流しています。カプセル化する配線は一本道にしてください`);
    return ts[0];
  };

  const ins = ([0, 1, 2, 3] as Dir[]).map((s) => feeder(out, s)).filter((t): t is Term => t !== null);
  if (ins.length === 0) throw new TermError("納品港に何も繋がっていません");
  if (ins.length > 1) throw new TermError("納品港に 2 本以上繋がっています");
  const arity = source ? portArity(source) : 0;
  const fix = (t: Term): Term => {
    switch (t.kind) {
      case "P":
        return t.n < 0 ? { kind: "P", n: arity, i: t.i } : t;
      case "C":
        return t.n < 0 ? { kind: "C", f: t.f, gs: t.gs.map(fix), n: arity } : t;
      default:
        return t;
    }
  };
  if (arity === 0 && ins[0].kind === "P") throw new TermError("入力港が見つかりません");
  return { term: simplify(fix(ins[0])), arity };
}

export { turn };
