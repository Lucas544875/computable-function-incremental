// Q での実際の証明を組み立てる小さな道具。prf の検査入力(正しい証明と壊れた証明)に使う。
import { checkProof, type F, fStr, fSubst, parseF, parseT, Q_AXIOMS, type T } from "./godel";

export class ProofBuilder {
  lines: string[] = [];
  add(s: string): string {
    if (!this.lines.includes(s)) this.lines.push(s);
    return s;
  }
  /** 公理や証明済みの式 a の自由変数 x に項 t を代入した式を導く(汎化 + L4 + MP) */
  inst(a: string, x: number, t: string): string {
    const f = parseF(a) as F;
    const r = parseT(t) as T;
    const v = `v${"'".repeat(x)}`;
    const out = fStr(fSubst(f, x, r));
    this.add(a);
    this.add(`∀${v}${a}`);
    this.add(`(∀${v}${a}→${out})`);
    return this.add(out);
  }
  /** 複数の変数にまとめて代入する(閉じた項のみ。大きい番号から行う) */
  insts(a: string, subs: [number, string][]): string {
    let cur = a;
    for (const [x, t] of [...subs].sort((p, q) => q[0] - p[0])) cur = this.inst(cur, x, t);
    return cur;
  }
  /** a と (a→c) が証明済みのとき c */
  mp(a: string, c: string): string {
    this.add(a);
    this.add(`(${a}→${c})`);
    return this.add(c);
  }
  refl(t: string): string {
    return this.inst("v=v", 0, t);
  }
  /** x=y から y=x */
  sym(x: string, y: string): string {
    this.insts("(v=v'→(v=v''→v'=v''))", [
      [0, x],
      [1, y],
      [2, x],
    ]);
    this.refl(x);
    this.mp(`${x}=${y}`, `(${x}=${x}→${y}=${x})`);
    return this.mp(`${x}=${x}`, `${y}=${x}`);
  }
  /** x=y と y=z から x=z */
  trans(x: string, y: string, z: string): string {
    this.sym(x, y);
    this.insts("(v=v'→(v=v''→v'=v''))", [
      [0, y],
      [1, x],
      [2, z],
    ]);
    this.mp(`${y}=${x}`, `(${y}=${z}→${x}=${z})`);
    return this.mp(`${y}=${z}`, `${x}=${z}`);
  }
  text(): string {
    return this.lines.join("#");
  }
}

export interface SampleProof {
  name: string;
  proof: string;
  goal: string;
}

function build(name: string, f: (b: ProofBuilder) => string): SampleProof {
  const b = new ProofBuilder();
  const goal = f(b);
  // 最後の行が結論になるように並べ直す
  b.lines = [...b.lines.filter((l) => l !== goal), goal];
  const proof = b.text();
  const r = checkProof(proof);
  if (!r.ok) throw new Error(`証明例 ${name} が不正です(${r.at + 1} 行目: ${r.lines[r.at]})`);
  return { name, proof, goal };
}

let cache: SampleProof[] | null = null;
export function sampleProofs(): SampleProof[] {
  if (cache) return cache;
  cache = [
    build("0=0", (b) => b.refl("0")),
    build("0+0=0", (b) => b.inst(Q_AXIOMS[3], 0, "0")),
    build("¬S0=0", (b) => b.inst(Q_AXIOMS[0], 0, "0")),
    build("S0=S0 → 0=0", (b) =>
      b.insts(Q_AXIOMS[1], [
        [0, "0"],
        [1, "0"],
      ]),
    ),
    build("1+1=2", (b) => {
      const a = b.insts(Q_AXIOMS[4], [
        [0, "S0"],
        [1, "0"],
      ]); // (S0+S0)=S(S0+0)
      const c = b.inst(Q_AXIOMS[3], 0, "S0"); // (S0+0)=S0
      b.insts("(v=v'→Sv=Sv')", [
        [0, "(S0+0)"],
        [1, "S0"],
      ]);
      b.mp(c, "S(S0+0)=SS0");
      void a;
      return b.trans("(S0+S0)", "S(S0+0)", "SS0");
    }),
    build("1·1=1", (b) => {
      b.insts(Q_AXIOMS[6], [
        [0, "S0"],
        [1, "0"],
      ]); // (S0·S0)=((S0·0)+S0)
      const z = b.inst(Q_AXIOMS[5], 0, "S0"); // (S0·0)=0
      b.insts("(v=v'→(v+v'')=(v'+v''))", [
        [0, "(S0·0)"],
        [1, "0"],
        [2, "S0"],
      ]);
      b.mp(z, "((S0·0)+S0)=(0+S0)");
      b.trans("(S0·S0)", "((S0·0)+S0)", "(0+S0)");
      // (0+S0)=S(0+0)、(0+0)=0、S(0+0)=S0
      b.insts(Q_AXIOMS[4], [
        [0, "0"],
        [1, "0"],
      ]);
      const zz = b.inst(Q_AXIOMS[3], 0, "0");
      b.insts("(v=v'→Sv=Sv')", [
        [0, "(0+0)"],
        [1, "0"],
      ]);
      b.mp(zz, "S(0+0)=S0");
      b.trans("(0+S0)", "S(0+0)", "S0");
      return b.trans("(S0·S0)", "(0+S0)", "S0");
    }),
  ];
  return cache;
}
