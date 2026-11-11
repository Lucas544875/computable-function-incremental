// 検査: ブループリントをカタログの参照実装と照合し、最小の反例を返す。仕様書 §4.11
import type { CatalogFn } from "./catalog";
import type { Evaluator } from "./eval";
import type { FnDef, Term } from "./term";

export interface VerifyReport {
  ok: boolean;
  total: number;
  passed: number;
  /** 不合格時の最小反例 */
  counter?: { args: string[]; expected: string; actual: string; probe?: string };
  steps: number;
  message?: string;
}

export const DEFAULT_VERIFY_BUDGET = 2e7;

let textOf: ((v: bigint) => string) | null = null;
/** 記号列の符号を読める形にする関数を登録する(不完全性コースが登録する) */
export function setTextDecoder(f: (v: bigint) => string) {
  textOf = f;
}
function shown(v: bigint, kind: string | undefined): string {
  const s = v.toString();
  const num = s.length > 24 ? `${s.slice(0, 10)}…(${s.length} 桁)` : s;
  if (kind !== "s" || !textOf) return num;
  const t = textOf(v);
  return `${num}「${t.length > 120 ? `${t.slice(0, 120)}…` : t}」`;
}

function size(a: bigint[]) {
  return a.reduce((s, v) => s + v, 0n);
}

export function verify(ev: Evaluator, def: FnDef, cat: CatalogFn, maxBits = 0): VerifyReport {
  const holes = def.holes ?? [];
  if (cat.schema) {
    const want = cat.schema.holes;
    if (holes.length !== want.length || holes.some((h, i) => h !== want[i]))
      return fail(`スロットの形が違います(必要: ${want.map((n) => `${n} 引数`).join("、")})`);
  } else if (holes.length) return fail("図式は関数の契約には使えません");
  if (def.arity !== cat.arity) return fail(`${cat.arity} 引数の関数が必要です(これは ${def.arity} 引数)`);

  const cases = cat.cases().sort((a, b) => (size(a) < size(b) ? -1 : size(a) > size(b) ? 1 : 0));
  const budget = cat.budget ?? DEFAULT_VERIFY_BUDGET;
  let steps = 0;
  let passed = 0;
  let total = 0;
  const probes = cat.schema ? cat.schema.probes : [{ name: "", fs: [] }];
  for (const probe of probes) {
    let term: Term = def.term;
    let expectFn = cat.native;
    if (cat.schema) {
      // 穴にネイティブ関数を装着した一時的な定義で評価する
      const tmp = probe.fs.map((f, i) => ({
        id: `__probe${i}`,
        arity: holes[i],
        term: { kind: "Z" } as Term,
        native: f,
      }));
      const probeEnv = new Map(tmp.map((d) => [d.id, d]));
      ev.withExtra(probeEnv);
      term = { kind: "App", id: def.id, fs: tmp.map((d) => ({ kind: "Ref", id: d.id })) };
      const fs = probe.fs.map((f) => (a: bigint[]) => f(a) ?? 0n);
      const sch = cat.schema;
      expectFn = (a) => sch.native(fs, a);
    }
    try {
      for (const args of cases) {
        total++;
        const expected = expectFn(args);
        const r = ev.run(term, args, budget, maxBits);
        steps += r.cost;
        const actual = r.ok
          ? shown(r.value, cat.outKind)
          : r.code === "budget"
            ? "予算内に停止せず"
            : r.code === "overflow"
              ? "帯域幅を超過"
              : "未定義の関数を参照";
        if (!r.ok || expected === null || r.value !== expected) {
          return {
            ok: false,
            total: cases.length * probes.length,
            passed,
            steps,
            counter: {
              args: args.map((a, i) => shown(a, cat.argKinds?.[i])),
              expected: expected === null ? "未定義" : shown(expected, cat.outKind),
              actual,
              probe: probe.name || undefined,
            },
          };
        }
        passed++;
      }
    } finally {
      ev.withExtra(null);
    }
  }
  return { ok: true, total, passed, steps };

  function fail(message: string): VerifyReport {
    return { ok: false, total: 0, passed: 0, steps: 0, message };
  }
}
