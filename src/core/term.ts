// μ-再帰関数の項。仕様書 §2 の数学モデルに対応する。

export type Term =
  | { kind: "Z" }
  | { kind: "S" }
  | { kind: "P"; n: number; i: number }
  /** 合成 f(g1(x),...,gm(x))。n は全体のアリティ(-1 は未推論) */
  | { kind: "C"; f: Term; gs: Term[]; n: number }
  | { kind: "R"; g: Term; h: Term }
  | { kind: "M"; f: Term }
  | { kind: "Ref"; id: string }
  /** 図式の穴(関数変数)。図式の定義の中にだけ現れる */
  | { kind: "H"; i: number; n: number }
  /** 図式の適用。穴に fs を装着する */
  | { kind: "App"; id: string; fs: Term[] };

/** 関数スロットつき関数の評価。fs は装着された関数 */
export type Native = (args: bigint[]) => bigint | null;
export type NativeSchema = (fs: ((args: bigint[]) => bigint)[], args: bigint[]) => bigint | null;

export interface FnDef {
  id: string;
  arity: number;
  term: Term;
  /** 図式なら穴のアリティ一覧 */
  holes?: number[];
  holeNames?: string[];
  /** 定理化済みならネイティブ実装 */
  native?: Native | null;
  nativeSchema?: NativeSchema | null;
}

export interface Env {
  get(id: string): FnDef | undefined;
}

export class TermError extends Error {}

export const Z: Term = { kind: "Z" };
export const S: Term = { kind: "S" };
export const P = (n: number, i: number): Term => ({ kind: "P", n, i });
export const C = (f: Term, gs: Term[], n = -1): Term => ({ kind: "C", f, gs, n });
export const R = (g: Term, h: Term): Term => ({ kind: "R", g, h });
export const M = (f: Term): Term => ({ kind: "M", f });
export const Ref = (id: string): Term => ({ kind: "Ref", id });

/** アリティ検査。C の未推論アリティをその場で埋める。違反は TermError */
export function check(t: Term, env: Env, holes: number[] = []): number {
  switch (t.kind) {
    case "Z":
      return 0;
    case "S":
      return 1;
    case "P":
      if (!(t.n >= 1 && t.i >= 1 && t.i <= t.n))
        throw new TermError(`P[${t.n},${t.i}] は不正です(1 ≤ i ≤ n)`);
      return t.n;
    case "C": {
      const fa = check(t.f, env, holes);
      if (fa !== t.gs.length)
        throw new TermError(`合成: ${show(t.f)} は ${fa} 引数ですが、内側の関数が ${t.gs.length} 個あります`);
      const as = t.gs.map((g) => check(g, env, holes));
      if (t.n < 0) t.n = as.length ? as[0] : 0;
      for (let j = 0; j < as.length; j++)
        if (as[j] !== t.n)
          throw new TermError(
            `合成: 内側の関数 ${show(t.gs[j])} は ${as[j]} 引数ですが、${t.n} 引数が必要です`,
          );
      return t.n;
    }
    case "R": {
      const ga = check(t.g, env, holes);
      const ha = check(t.h, env, holes);
      if (ha !== ga + 2)
        throw new TermError(`帰納法: g が ${ga} 引数なら h は ${ga + 2} 引数が必要です(実際は ${ha} 引数)`);
      return ga + 1;
    }
    case "M": {
      const fa = check(t.f, env, holes);
      if (fa < 1) throw new TermError("最小化: f は 1 引数以上が必要です");
      return fa - 1;
    }
    case "Ref": {
      const d = env.get(t.id);
      if (!d) throw new TermError(`関数 ${t.id} が見つかりません`);
      if (d.holes?.length) throw new TermError(`${t.id} は図式です。${t.id}<…> の形で関数を装着してください`);
      return d.arity;
    }
    case "H":
      if (t.i >= holes.length) throw new TermError("図式の外で関数スロットは使えません");
      return holes[t.i];
    case "App": {
      const d = env.get(t.id);
      if (!d) throw new TermError(`図式 ${t.id} が見つかりません`);
      const hs = d.holes ?? [];
      if (hs.length !== t.fs.length)
        throw new TermError(`図式 ${t.id} のスロットは ${hs.length} 個です(${t.fs.length} 個が渡されました)`);
      t.fs.forEach((f, j) => {
        const a = check(f, env, holes);
        if (a !== hs[j])
          throw new TermError(
            `図式 ${t.id} の第 ${j + 1} スロットは ${hs[j]} 引数の関数が必要です(${a} 引数)`,
          );
      });
      return d.arity;
    }
  }
}

export function show(t: Term, holeNames: string[] = []): string {
  const s = (u: Term) => show(u, holeNames);
  switch (t.kind) {
    case "Z":
      return "Z";
    case "S":
      return "S";
    case "P":
      return `P[${t.n},${t.i}]`;
    case "C":
      return t.gs.length ? `C(${s(t.f)}; ${t.gs.map(s).join(", ")})` : `C[${Math.max(t.n, 0)}](${s(t.f)};)`;
    case "R":
      return `R(${s(t.g)}, ${s(t.h)})`;
    case "M":
      return `M(${s(t.f)})`;
    case "Ref":
      return t.id;
    case "H":
      return holeNames[t.i] ?? `?${t.i + 1}`;
    case "App":
      return `${t.id}<${t.fs.map(s).join(", ")}>`;
  }
}

/** 項が参照する定義名(直接のみ) */
export function refs(t: Term, out = new Set<string>()): Set<string> {
  switch (t.kind) {
    case "C":
      refs(t.f, out);
      for (const g of t.gs) refs(g, out);
      break;
    case "R":
      refs(t.g, out);
      refs(t.h, out);
      break;
    case "M":
      refs(t.f, out);
      break;
    case "Ref":
      out.add(t.id);
      break;
    case "App":
      out.add(t.id);
      for (const f of t.fs) refs(f, out);
      break;
  }
  return out;
}

/** 最小化 M を(参照先も含めて)使っているか。使っていなければ原始帰納的 */
export function usesMu(t: Term, env: Env, seen = new Set<string>()): boolean {
  switch (t.kind) {
    case "M":
      return true;
    case "C":
      return usesMu(t.f, env, seen) || t.gs.some((g) => usesMu(g, env, seen));
    case "R":
      return usesMu(t.g, env, seen) || usesMu(t.h, env, seen);
    case "Ref":
    case "App": {
      const inner = t.kind === "App" && t.fs.some((f) => usesMu(f, env, seen));
      if (inner) return true;
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      const d = env.get(t.id);
      return d ? usesMu(d.term, env, seen) : false;
    }
    default:
      return false;
  }
}

/** 図式の穴に関数を代入する */
export function subst(t: Term, fs: Term[]): Term {
  switch (t.kind) {
    case "H":
      return fs[t.i];
    case "C":
      return { kind: "C", f: subst(t.f, fs), gs: t.gs.map((g) => subst(g, fs)), n: t.n };
    case "R":
      return { kind: "R", g: subst(t.g, fs), h: subst(t.h, fs) };
    case "M":
      return { kind: "M", f: subst(t.f, fs) };
    case "App":
      return { kind: "App", id: t.id, fs: t.fs.map((f) => subst(f, fs)) };
    default:
      return t;
  }
}

/** 恒等な合成 C(f; P[k,1..k]) を f に畳むなどの軽い整理 */
export function simplify(t: Term): Term {
  switch (t.kind) {
    case "C": {
      const f = simplify(t.f);
      const gs = t.gs.map(simplify);
      const k = gs.length;
      if (k > 0 && gs.every((g, j) => g.kind === "P" && g.n === k && g.i === j + 1)) return f;
      if (f.kind === "P" && f.n === k) return gs[f.i - 1];
      return { kind: "C", f, gs, n: t.n };
    }
    case "R":
      return { kind: "R", g: simplify(t.g), h: simplify(t.h) };
    case "M":
      return { kind: "M", f: simplify(t.f) };
    case "App":
      return { kind: "App", id: t.id, fs: t.fs.map(simplify) };
    default:
      return t;
  }
}
