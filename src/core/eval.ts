// 項の評価器。ステップ予算・帯域幅(ビット長上限)・メモ化つき。仕様書 §2.1, §7.2
import { type Env, type FnDef, subst, type Term } from "./term";

export type EvalFail = "budget" | "overflow" | "missing";
export class EvalStop extends Error {
  constructor(public code: EvalFail) {
    super(code);
  }
}

interface Ctx {
  steps: number;
  limit: number;
  maxVal: bigint | null;
}

export type EvalResult =
  | { ok: true; value: bigint; cost: number }
  | { ok: false; code: EvalFail; cost: number };

const MEMO_CAP = 50000;

export class Evaluator {
  private memo = new Map<string, Map<string, { v: bigint; c: number }>>();
  private expanded = new WeakMap<Term, Term>();
  constructor(private env: Env) {}

  private extra: Map<string, FnDef> | null = null;
  /** 検査用の一時的な定義を重ねる */
  withExtra(extra: Map<string, FnDef> | null) {
    this.extra = extra;
  }
  private lookup(id: string): FnDef | undefined {
    return this.extra?.get(id) ?? this.env.get(id);
  }

  clear() {
    this.memo.clear();
  }

  /** maxBits = 0 は上限なし */
  run(term: Term, args: bigint[], limit: number, maxBits = 0): EvalResult {
    const ctx: Ctx = { steps: 0, limit, maxVal: maxBits > 0 ? 1n << BigInt(maxBits) : null };
    try {
      const value = this.ev(term, args, ctx);
      return { ok: true, value, cost: Math.max(1, ctx.steps) };
    } catch (e) {
      if (e instanceof EvalStop) return { ok: false, code: e.code, cost: Math.min(ctx.steps, limit) };
      if (e instanceof RangeError) return { ok: false, code: "overflow", cost: ctx.steps };
      throw e;
    }
  }

  private step(ctx: Ctx, n = 1) {
    ctx.steps += n;
    if (ctx.steps > ctx.limit) throw new EvalStop("budget");
  }

  private out(ctx: Ctx, v: bigint): bigint {
    if (ctx.maxVal !== null && v >= ctx.maxVal) throw new EvalStop("overflow");
    return v;
  }

  private ev(t: Term, args: bigint[], ctx: Ctx): bigint {
    switch (t.kind) {
      case "Z":
        this.step(ctx);
        return 0n;
      case "S":
        this.step(ctx);
        return this.out(ctx, args[0] + 1n);
      case "P":
        this.step(ctx);
        return args[t.i - 1];
      case "C": {
        const gs = t.gs;
        const vals = new Array<bigint>(gs.length);
        for (let j = 0; j < gs.length; j++) vals[j] = this.ev(gs[j], args, ctx);
        return this.ev(t.f, vals, ctx);
      }
      case "R": {
        const k = args.length - 1;
        const n = args[k];
        if (n > BigInt(ctx.limit)) throw new EvalStop("budget");
        const xs = args.slice(0, k);
        let acc = this.ev(t.g, xs, ctx);
        const hargs = [...xs, 0n, 0n];
        for (let i = 0n; i < n; i++) {
          hargs[k] = i;
          hargs[k + 1] = acc;
          acc = this.ev(t.h, hargs, ctx);
          this.step(ctx);
        }
        return acc;
      }
      case "M": {
        const fargs = [...args, 0n];
        for (let y = 0n; ; y++) {
          fargs[args.length] = y;
          const v = this.ev(t.f, fargs, ctx);
          this.step(ctx);
          if (v === 0n) return y;
        }
      }
      case "Ref": {
        const d = this.lookup(t.id);
        if (!d) throw new EvalStop("missing");
        if (d.native) {
          this.step(ctx);
          const v = d.native(args);
          if (v === null) throw new EvalStop("budget");
          return this.out(ctx, v);
        }
        let m = this.memo.get(t.id);
        if (!m) {
          m = new Map();
          this.memo.set(t.id, m);
        }
        const key = args.join(",");
        const hit = m.get(key);
        if (hit) {
          this.step(ctx, hit.c);
          return hit.v;
        }
        const before = ctx.steps;
        const v = this.ev(d.term, args, ctx);
        if (m.size >= MEMO_CAP) m.clear();
        m.set(key, { v, c: ctx.steps - before });
        return v;
      }
      case "App": {
        const d = this.lookup(t.id);
        if (!d) throw new EvalStop("missing");
        if (d.nativeSchema) {
          this.step(ctx);
          const fs = t.fs.map((f) => (a: bigint[]) => this.ev(f, a, ctx));
          const v = d.nativeSchema(fs, args);
          if (v === null) throw new EvalStop("budget");
          return this.out(ctx, v);
        }
        let ex = this.expanded.get(t);
        if (!ex) {
          ex = subst(d.term, t.fs);
          this.expanded.set(t, ex);
        }
        return this.ev(ex, args, ctx);
      }
      case "H":
        throw new EvalStop("missing");
    }
  }
}
