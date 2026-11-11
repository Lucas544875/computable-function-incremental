// 表現可能性: 本作の項 t を、Q の言語の論理式 F_t(入力…, 出力) に翻訳する。仕様書 §4.12 G4
//
// 変数の約束: k 引数の項なら 入力は v, v', …(番号 0..k-1)、出力は番号 k、内部で使う変数は番号 k+1 以降。
// 略記: A∧B = ¬(A→¬B)、∃xA = ¬∀x¬A、s<t = ∃z (Sz+s)=t、
//       β(c, d, i, u) = ∃q (c=((q·S(Si·d))+u) ∧ u<S(Si·d))   … u = c mod (1 + (i+1)·d)
import { type Env, subst, type Term, TermError } from "../core/term";

type VarE = { s: "in"; j: number } | { s: "out" } | { s: "f"; c: number };
type Sub = { t: Term; ins: VarE[]; out: VarE; df: number };
type Part = string | VarE | Sub;
type Doc = Part[];

const I = (j: number): VarE => ({ s: "in", j });
const O: VarE = { s: "out" };
const Fr = (c: number): VarE => ({ s: "f", c });

const eq = (a: Doc, b: Doc): Doc => [...a, "=", ...b];
const not = (a: Doc): Doc => ["¬", ...a];
const imp = (a: Doc, b: Doc): Doc => ["(", ...a, "→", ...b, ")"];
const all = (x: VarE, a: Doc): Doc => ["∀", x, ...a];
const and = (a: Doc, b: Doc): Doc => not(imp(a, not(b)));
const ex = (x: VarE, a: Doc): Doc => not(all(x, not(a)));
const lt = (s: Doc, t: Doc, z: VarE): Doc => ex(z, eq(["(", "S", z, "+", ...s, ")"], t));
const conj = (xs: Doc[]): Doc => xs.reduceRight((acc, x) => and(x, acc));

export function arityOf(t: Term): number {
  switch (t.kind) {
    case "Z":
      return 0;
    case "S":
      return 1;
    case "P":
      return t.n;
    case "C":
      return t.n >= 0 ? t.n : t.gs.length ? arityOf(t.gs[0]) : 0;
    case "R":
      return arityOf(t.g) + 1;
    case "M":
      return arityOf(t.f) - 1;
    default:
      throw new TermError("参照を含む項は翻訳できません");
  }
}

const docs = new WeakMap<Term, Doc>();
function docOf(t: Term): Doc {
  const hit = docs.get(t);
  if (hit) return hit;
  let d: Doc;
  switch (t.kind) {
    case "Z":
      d = eq([O], ["0"]);
      break;
    case "S":
      d = eq([O], ["S", I(0)]);
      break;
    case "P":
      d = eq([O], [I(t.i - 1)]);
      break;
    case "C": {
      const k = arityOf(t);
      const m = t.gs.length;
      const xs = Array.from({ length: k }, (_, j) => I(j));
      const zs = Array.from({ length: m }, (_, j) => Fr(j));
      const parts: Doc[] = t.gs.map((g, j) => [{ t: g, ins: xs, out: zs[j], df: m }]);
      parts.push([{ t: t.f, ins: zs, out: O, df: m }]);
      d = conj(parts);
      for (let j = m - 1; j >= 0; j--) d = ex(zs[j], d);
      break;
    }
    case "R": {
      const k = arityOf(t) - 1;
      const xs = Array.from({ length: k }, (_, j) => I(j));
      const n = I(k);
      const [c, dd, i, u, w, q, z] = [Fr(0), Fr(1), Fr(2), Fr(3), Fr(4), Fr(5), Fr(6)];
      const m = (iT: Doc): Doc => ["S", "(", "S", ...iT, "·", dd, ")"];
      const beta = (iT: Doc, uV: VarE): Doc =>
        ex(q, and(eq([c], ["(", "(", q, "·", ...m(iT), ")", "+", uV, ")"]), lt([uV], m(iT), z)));
      const base = ex(u, and(beta(["0"], u), [{ t: t.g, ins: xs, out: u, df: 7 }]));
      const step = all(
        i,
        imp(
          lt([i], [n], z),
          ex(
            u,
            ex(w, conj([beta([i], u), beta(["S", i], w), [{ t: t.h, ins: [...xs, i, u], out: w, df: 7 }]])),
          ),
        ),
      );
      d = ex(c, ex(dd, conj([base, step, beta([n], O)])));
      break;
    }
    case "M": {
      const k = arityOf(t);
      const xs = Array.from({ length: k }, (_, j) => I(j));
      const [z, i, zz] = [Fr(0), Fr(1), Fr(2)];
      const isZero = (y: VarE): Doc =>
        ex(z, and([{ t: t.f, ins: [...xs, y], out: z, df: 3 }], eq([z], ["0"])));
      d = and(isZero(O), all(i, imp(lt([i], [O], zz), not(isZero(i)))));
      break;
    }
    default:
      throw new TermError("参照を含む項は翻訳できません");
  }
  docs.set(t, d);
  return d;
}

const idx = (v: VarE, ins: number[], out: number, fresh: number) =>
  v.s === "in" ? ins[v.j] : v.s === "out" ? out : fresh + v.c;

/** 論理式を書き下す。記号数が limit を超えたら null */
export function render(t: Term, ins: number[], out: number, fresh: number, limit = 400_000): string | null {
  const buf: string[] = [];
  let count = 0;
  const go = (u: Term, uIns: number[], uOut: number, uFresh: number): boolean => {
    for (const p of docOf(u)) {
      if (typeof p === "string") {
        buf.push(p);
        count++;
      } else if ("t" in p) {
        if (
          !go(
            p.t,
            p.ins.map((v) => idx(v, uIns, uOut, uFresh)),
            idx(p.out, uIns, uOut, uFresh),
            uFresh + p.df,
          )
        )
          return false;
      } else {
        const n = idx(p, uIns, uOut, uFresh);
        buf.push(`v${"'".repeat(n)}`);
        count += n + 1;
      }
      if (count > limit) return false;
    }
    return true;
  };
  return go(t, ins, out, fresh) ? buf.join("") : null;
}

/** 記号数 = c + Σ ins[j]·(入力 j の番号) + out·(出力の番号) + f·(fresh)。出現回数は ins / out の係数に等しい */
export interface Lin {
  c: bigint;
  ins: bigint[];
  out: bigint;
  f: bigint;
}
const lins = new WeakMap<Term, Lin>();
export function measure(t: Term): Lin {
  const hit = lins.get(t);
  if (hit) return hit;
  const L: Lin = { c: 0n, ins: Array.from({ length: Math.max(arityOf(t), 0) }, () => 0n), out: 0n, f: 0n };
  const addVar = (v: VarE, times: bigint, withSymbol: boolean) => {
    if (withSymbol) L.c += times;
    if (v.s === "in") L.ins[v.j] += times;
    else if (v.s === "out") L.out += times;
    else {
      L.c += times * BigInt(v.c);
      L.f += times;
    }
  };
  for (const p of docOf(t)) {
    if (typeof p === "string") L.c += 1n;
    else if ("t" in p) {
      const s = measure(p.t);
      L.c += s.c + s.f * BigInt(p.df);
      L.f += s.f;
      for (let j = 0; j < s.ins.length; j++) addVar(p.ins[j], s.ins[j], false);
      addVar(p.out, s.out, false);
    } else addVar(p, 1n, true);
  }
  lins.set(t, L);
  return L;
}
export function sizeOf(t: Term, ins: number[], out: number, fresh: number): bigint {
  const L = measure(t);
  return (
    L.c + L.ins.reduce((s, n, j) => s + n * BigInt(ins[j]), 0n) + L.out * BigInt(out) + L.f * BigInt(fresh)
  );
}

/** 参照と図式をすべて展開する。同じ定義は同じオブジェクトになるので、大きさの計算は共有部分を 1 回しか数えない */
export function inline(t: Term, env: Env, memo = new Map<string, Term>()): Term {
  switch (t.kind) {
    case "Ref": {
      const hit = memo.get(t.id);
      if (hit) return hit;
      const d = env.get(t.id);
      if (!d) throw new TermError(`関数 ${t.id} が見つかりません`);
      const r = inline(d.term, env, memo);
      memo.set(t.id, r);
      return r;
    }
    case "App": {
      const d = env.get(t.id);
      if (!d) throw new TermError(`図式 ${t.id} が見つかりません`);
      return inline(subst(d.term, t.fs), env, memo);
    }
    case "C":
      return { kind: "C", f: inline(t.f, env, memo), gs: t.gs.map((g) => inline(g, env, memo)), n: t.n };
    case "R":
      return { kind: "R", g: inline(t.g, env, memo), h: inline(t.h, env, memo) };
    case "M":
      return { kind: "M", f: inline(t.f, env, memo) };
    case "H":
      throw new TermError("図式は単体では翻訳できません");
    default:
      return t;
  }
}

/** k 引数の項を標準の変数割り当て(入力 0..k-1、出力 k)で論理式にする */
export function reprString(t: Term, limit?: number): string | null {
  const k = arityOf(t);
  return render(
    t,
    Array.from({ length: k }, (_, j) => j),
    k,
    k + 1,
    limit,
  );
}
