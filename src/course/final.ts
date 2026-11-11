// ゲーデル文の構成。プレイヤーが作った diag と prf の項を論理式に翻訳し、不動点を取る。仕様書 §4.12 G5〜G6
//
//   D(v, v')        = repr(diag)                … 「v' は v の対角化である」
//   F(v, v', v'', v''') = repr((a, z, p) ↦ prf(p, a))  … 出力 v''' が prf(v'', v) の値
//   B(v)            = ∀v''¬F[S0/v''']           … 「v の証明は存在しない」
//   A(v)            = ∀v'(D(v, v') → B(v'))
//   G               = A(num(⌜A⌝)) = diag(⌜A⌝)   … 「この文の証明は存在しない」
import { type Env, type FnDef, type Term, TermError, usesMu } from "../core/term";
import { enc, fStr, fSubst, numeral, parseF } from "./godel";
import { inline, measure, render, sizeOf } from "./repr";

export interface GodelReport {
  ok: boolean;
  error?: string;
  /** 厳密に計算できたか(A を実際に書き下せたか) */
  exact: boolean;
  sizeD: string;
  sizeF: string;
  sizeA: string;
  /** A の中の自由な v の出現回数(数項が代入される箇所) */
  occurrences: string;
  /** G の記号数(exact でなければ概算) */
  sizeG: string;
  /** G のゲーデル数のビット数(概算) */
  bitsG: string;
  /** A の冒頭 */
  preview: string;
  diagName: string;
  prfName: string;
}

const LOG2_13 = 3.700439718;
const EXPLICIT_LIMIT = 120_000;

type ClaimedDef = FnDef & { claim?: string | null; theorem?: boolean };

export function computeGodel(defs: ClaimedDef[], env: Env, cleared: (id: string) => boolean): GodelReport {
  const fail = (error: string): GodelReport => ({
    ok: false,
    error,
    exact: false,
    sizeD: "",
    sizeF: "",
    sizeA: "",
    occurrences: "",
    sizeG: "",
    bitsG: "",
    preview: "",
    diagName: "",
    prfName: "",
  });
  for (const need of ["repr", "fix"]) if (!cleared(need)) return fail(`先に契約 ${need} を達成してください`);
  const diag = defs.find((d) => d.claim === "diag" && d.theorem);
  const prf = defs.find((d) => d.claim === "prf" && d.theorem);
  if (!diag) return fail("定理化済みの diag がありません");
  if (!prf) return fail("定理化済みの prf がありません");
  for (const d of [diag, prf])
    if (usesMu(d.term, env))
      return fail(
        `${d.id} は最小化 μ を使っています。表現可能性の議論は原始帰納的な項で行うので、μ を使わずに作り直してください`,
      );
  try {
    const memo = new Map<string, Term>();
    const diagT = inline({ kind: "Ref", id: diag.id }, env, memo);
    const prfT = inline({ kind: "Ref", id: prf.id }, env, memo);
    const tB: Term = {
      kind: "C",
      f: prfT,
      gs: [
        { kind: "P", n: 3, i: 3 },
        { kind: "P", n: 3, i: 1 },
      ],
      n: 3,
    };
    const nD = sizeOf(diagT, [0], 1, 2);
    const nF = sizeOf(tB, [0, 1, 2], 3, 4);
    const mD = measure(diagT);
    const mF = measure(tB);
    // B = ∀v''¬F[S0/v''']: 出力 v'''(4 記号)を S0(2 記号)に置き換える
    const nB = 5n + nF - mF.out * 2n;
    // B[v'/v]: 自由な v(1 記号)を v'(2 記号)に
    const nB2 = nB + mF.ins[0];
    const nA = 6n + nD + nB2;
    const occ = mD.ins[0];
    let exact = false;
    let sizeG: bigint;
    let preview = "";
    if (nA <= BigInt(EXPLICIT_LIMIT)) {
      const D = render(diagT, [0], 1, 2, EXPLICIT_LIMIT * 2);
      const F = render(tB, [0, 1, 2], 3, 4, EXPLICIT_LIMIT * 2);
      const Ff = F && parseF(F);
      if (D && Ff) {
        const B = `∀v''¬${fStr(fSubst(Ff, 3, { k: "S", a: { k: "0" } }))}`;
        const Bf = parseF(B)!;
        const A = `∀v'(${D}→${fStr(fSubst(Bf, 0, { k: "v", i: 1 }))})`;
        if (BigInt(A.length) !== nA) throw new TermError("内部エラー: 記号数の計算が一致しません");
        const num = numeral(enc(A));
        sizeG = BigInt(A.length) + occ * BigInt(num.length - 1);
        preview = A.length > 160 ? `${A.slice(0, 160)}…` : A;
        exact = true;
      } else sizeG = 0n;
    } else sizeG = 0n;
    if (!exact) {
      // 数項の長さ ≒ 6.5 × (A の符号のビット数) ≒ 6.5 × 3.70 × |A|
      sizeG = nA + (occ * nA * 2405n) / 100n;
    }
    const bits = (sizeG * BigInt(Math.round(LOG2_13 * 1000))) / 1000n;
    return {
      ok: true,
      exact,
      sizeD: nD.toString(),
      sizeF: nF.toString(),
      sizeA: nA.toString(),
      occurrences: occ.toString(),
      sizeG: sizeG.toString(),
      bitsG: bits.toString(),
      preview,
      diagName: diag.id,
      prfName: prf.id,
    };
  } catch (e) {
    if (e instanceof TermError) return fail(e.message);
    if (e instanceof RangeError) return fail("項が深すぎて展開できません");
    throw e;
  }
}
