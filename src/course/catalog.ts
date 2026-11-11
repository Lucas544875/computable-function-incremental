// 不完全性コースの契約(G0〜G5)と、T5 万能関数。仕様書 §4.12
import type { CatalogFn } from "../core/catalog";
import { parseTerm } from "../core/parse";
import type { Rng } from "../core/rng";
import { listCode, termCode, termDecode, universal } from "../core/tcode";
import { check, type Native, type NativeSchema, TermError } from "../core/term";
import { setTextDecoder } from "../core/verify";
import { dec, enc, G, Q_AXIOMS } from "./godel";
import { sampleProofs } from "./proofs";
import { reprString } from "./repr";

setTextDecoder(dec);

const big = (n: number) => BigInt(n);
function product(...lists: bigint[][]): bigint[][] {
  let out: bigint[][] = [[]];
  for (const l of lists) out = out.flatMap((pre) => l.map((v) => [...pre, v]));
  return out;
}
const range = (n: number) => Array.from({ length: n }, (_, i) => big(i));
const fromCases = (cases: () => bigint[][]) => {
  let memo: bigint[][] | null = null;
  const get = () => {
    memo ??= cases();
    return memo;
  };
  return {
    cases: get,
    gen: (rng: Rng) => get()[rng.int(get().length)],
    fixedRange: true,
    verifyOnly: true,
    budget: 3e8,
  };
};

type Row = Pick<CatalogFn, "title" | "def" | "needs"> & Partial<CatalogFn> & { cases: () => bigint[][] };
function fn(id: string, tier: string, arity: number, native: Native, row: Row): CatalogFn {
  return {
    id,
    tier,
    arity,
    native,
    reward: 0,
    ...fromCases(row.cases),
    ...row,
    cases: fromCases(row.cases).cases,
  };
}
function schema(
  id: string,
  arity: number,
  holes: number[],
  holeNames: string[],
  native: NativeSchema,
  probes: { name: string; fs: Native[] }[],
  row: Row,
): CatalogFn {
  return {
    id,
    tier: "G0",
    arity,
    native: () => 0n,
    reward: 0,
    ...fromCases(row.cases),
    needsResearch: "schema",
    ...row,
    schema: { holes, holeNames, native, probes },
  };
}

// ---- G0: 図式
const sumOver = (
  f: (a: bigint[]) => bigint,
  pre: bigint[],
  n: bigint,
  init: bigint,
  op: (acc: bigint, v: bigint) => bigint,
) => {
  let acc = init;
  for (let i = 0n; i < n; i++) acc = op(acc, f([...pre, i]));
  return acc;
};
const firstHit = (f: (a: bigint[]) => bigint, pre: bigint[], n: bigint) => {
  for (let i = 0n; i < n; i++) if (f([...pre, i]) !== 0n) return i;
  return n;
};
const P2 = [
  { name: "f(x, i) = x + i", fs: [([x, i]: bigint[]) => x + i] },
  { name: "f(x, i) = [x = i]", fs: [([x, i]: bigint[]) => (x === i ? 1n : 0n)] },
  { name: "f(x, i) = [i² > x]", fs: [([x, i]: bigint[]) => (i * i > x ? 1n : 0n)] },
  { name: "f(x, i) = [i ≤ x]", fs: [([x, i]: bigint[]) => (i <= x ? 1n : 0n)] },
];
const P3 = [
  { name: "f(x, y, i) = [x + i = y]", fs: [([x, y, i]: bigint[]) => (x + i === y ? 1n : 0n)] },
  { name: "f(x, y, i) = [i < x·y]", fs: [([x, y, i]: bigint[]) => (i < x * y ? 1n : 0n)] },
  { name: "f(x, y, i) = x + y + i", fs: [([x, y, i]: bigint[]) => x + y + i] },
];
const xn = () => product(range(5), range(6));
const xyn = () => product(range(3), range(4), range(5));
const G0_NEEDS = ["is_prime"];

const G0: CatalogFn[] = [
  schema("bsum", 2, [2], ["f"], (fs, [x, n]) => sumOver(fs[0], [x], n, 0n, (a, v) => a + v), P2, {
    title: "有界和",
    def: "bsum<f>(x, n) = Σ_{i<n} f(x, i)",
    hint: "図式は項エディタで bsum<f/2> = … と定義する。f は関数スロット",
    needs: G0_NEEDS,
    cases: xn,
  }),
  schema(
    "bprod",
    2,
    [2],
    ["f"],
    (fs, [x, n]) => sumOver(fs[0], [x], n, 1n, (a, v) => a * v),
    [P2[0], P2[3]],
    {
      title: "有界積",
      def: "bprod<f>(x, n) = Π_{i<n} f(x, i)",
      needs: G0_NEEDS,
      cases: xn,
    },
  ),
  schema("bex", 2, [2], ["f"], (fs, [x, n]) => (firstHit(fs[0], [x], n) < n ? 1n : 0n), P2, {
    title: "有界存在量化",
    def: "bex<f>(x, n) = 1 (∃i<n. f(x, i) ≠ 0)、0 (それ以外)",
    needs: ["bsum"],
    cases: xn,
  }),
  schema(
    "ball",
    2,
    [2],
    ["f"],
    (fs, [x, n]) => {
      for (let i = 0n; i < n; i++) if (fs[0]([x, i]) === 0n) return 0n;
      return 1n;
    },
    P2,
    {
      title: "有界全称量化",
      def: "ball<f>(x, n) = 1 (∀i<n. f(x, i) ≠ 0)、0 (それ以外)",
      needs: ["bsum"],
      cases: xn,
    },
  ),
  schema("bmu", 2, [2], ["f"], (fs, [x, n]) => firstHit(fs[0], [x], n), P2, {
    title: "有界最小化",
    def: "bmu<f>(x, n) = f(x, i) ≠ 0 となる最小の i < n(なければ n)",
    hint: "「i 以下に当たりがない」j の個数を数える",
    needs: ["bsum"],
    cases: xn,
  }),
  schema(
    "cases",
    1,
    [1, 1, 1],
    ["c", "f", "g"],
    (fs, a) => (fs[0](a) !== 0n ? fs[1](a) : fs[2](a)),
    [
      {
        name: "c(x) = [x は偶数]、f(x) = x + 1、g(x) = 2x",
        fs: [([x]) => (x % 2n === 0n ? 1n : 0n), ([x]) => x + 1n, ([x]) => 2n * x],
      },
      { name: "c(x) = x、f(x) = 7、g(x) = 3", fs: [([x]) => x, () => 7n, () => 3n] },
    ],
    {
      title: "場合分け",
      def: "cases<c, f, g>(x) = f(x) (c(x) ≠ 0)、g(x) (c(x) = 0)",
      needs: G0_NEEDS,
      cases: () => product(range(8)),
    },
  ),
  schema("bex2", 3, [3], ["f"], (fs, [x, y, n]) => (firstHit(fs[0], [x, y], n) < n ? 1n : 0n), P3, {
    title: "有界存在量化(パラメータ 2 個)",
    def: "bex2<f>(x, y, n) = 1 (∃i<n. f(x, y, i) ≠ 0)",
    needs: ["bex"],
    cases: xyn,
  }),
  schema(
    "ball2",
    3,
    [3],
    ["f"],
    (fs, [x, y, n]) => {
      for (let i = 0n; i < n; i++) if (fs[0]([x, y, i]) === 0n) return 0n;
      return 1n;
    },
    P3,
    {
      title: "有界全称量化(パラメータ 2 個)",
      def: "ball2<f>(x, y, n) = 1 (∀i<n. f(x, y, i) ≠ 0)",
      needs: ["ball"],
      cases: xyn,
    },
  ),
  schema("bmu2", 3, [3], ["f"], (fs, [x, y, n]) => firstHit(fs[0], [x, y], n), P3, {
    title: "有界最小化(パラメータ 2 個)",
    def: "bmu2<f>(x, y, n) = f(x, y, i) ≠ 0 となる最小の i < n(なければ n)",
    needs: ["bmu"],
    cases: xyn,
  }),
];

// ---- G1〜G5 の検査入力
const E = (ss: string[]) => ss.map(enc);
const STR = ["", "0", "S0", "v'", "0=0", "(v+0)=v", "¬Sv=0", "#", "∀vv=v", "0=0#0=0"];
const TERMS = ["0", "v", "v''", "S0", "SSv'", "(v+0)", "(S0·v')", "((v+v')·S0)"];
const NONTERMS = ["", "S", "0=0", "(v+0", "v+0", "(v+0))", "+", "'", "0'", "(0)", "v'v"];
const FORMS = ["0=0", "v=v'", "¬0=S0", "(0=0→v=v)", "∀vv=v", "∀v'¬(v=v'→0=S0)", "(v=v'→∀vv=v')", ...Q_AXIOMS];
const NONFORMS = ["", "0", "(0=0)", "0=0→0=0", "∀0=0", "¬", "(0=0→)", "0=0#0=0", "∀v", "0==0", "v'"];
const LOGIC_YES = [
  "v=v",
  "(v=v'→(v=v''→v'=v''))",
  "(v=v'→Sv=Sv')",
  "(0=0→(v=v→0=0))",
  "((0=0→(v=v→0=S0))→((0=0→v=v)→(0=0→0=S0)))",
  "((¬0=0→¬v=v)→(v=v→0=0))",
  "(∀vv=v→0=0)",
  "(∀vv=v→v=v)",
  "(∀v(v+0)=v→(S0+0)=S0)",
  "(∀v¬∀v'v=v'→¬∀v'S0=v')",
  "(∀v(0=0→v=v)→(0=0→∀vv=v))",
  "(∀v0=0→0=0)",
];
const LOGIC_NO = [
  "(∀v¬∀v'v=v'→¬∀v'v'=v')",
  "(∀v(v=0→v=v)→(v=0→∀vv=v))",
  "0=0",
  "(0=0→(v=v→v=v))",
  "(∀vv=v→0=S0)",
  "(v+0)=v",
  "",
  "(0=0",
];
const PROGRAMS = [
  "S",
  "P[2,2]",
  "C(S; S)",
  "C[1](Z;)",
  "R(P[1,1], C(S; P[3,3]))",
  "R(Z, P[2,1])",
  "R(C[1](Z;), C(R(P[1,1], C(S; P[3,3])); P[3,1], P[3,3]))",
];
const progCode = (src: string) => {
  const t = parseTerm(src);
  check(t, { get: () => undefined });
  return termCode(t);
};

const reprNative: Native = ([e]) => {
  const t = termDecode(e);
  if (!t) return 0n;
  try {
    check(t, { get: () => undefined });
    const s = reprString(t, 20000);
    return s === null ? 0n : enc(s);
  } catch (err) {
    if (err instanceof TermError) return 0n;
    throw err;
  }
};

const ALL_G1 = ["len", "at", "concat", "slice", "occurs"];
const ALL_G2 = ["num", "is_var", "is_term", "is_formula", "is_free", "subst"];

const COURSE: CatalogFn[] = [
  // ---- G1 記号列
  fn("len", "G1", 1, ([x]) => G.len(x), {
    title: "記号列の長さ",
    def: "len(x) = x が表す記号列の記号数(全単射 13 進法の桁数)",
    hint: "L 桁の数は (13^L − 1)/12 以上。x の値までくり返すと終わらないので、有界最小化で桁数を探す",
    needs: ["bmu", "exp", "div", "lt"],
    cases: () => [...product(range(30)), ...product(E(STR))],
    argKinds: "s",
  }),
  fn("at", "G1", 2, ([x, i]) => G.at(x, i), {
    title: "i 番目の記号",
    def: "at(x, i) = x の左から i 番目(0 始まり)の記号の番号 1〜13。範囲外は 0",
    needs: ["len", "mod"],
    cases: () => E(STR).flatMap((x) => range(Number(G.len(x)) + 2).map((i) => [x, i])),
    argKinds: "sn",
  }),
  fn("concat", "G1", 2, ([x, y]) => G.concat(x, y), {
    title: "連結",
    def: "concat(x, y) = x · 13^len(y) + y",
    needs: ["len"],
    cases: () => product(E(STR.slice(0, 7)), E(STR.slice(0, 7))),
    argKinds: "ss",
    outKind: "s",
  }),
  fn("slice", "G1", 3, ([x, i, j]) => G.slice(x, i, j), {
    title: "切り出し",
    def: "slice(x, i, j) = x の i 番目から j 番目の手前まで(範囲外は端に丸める。i ≥ j なら空列)",
    needs: ["at", "concat"],
    cases: () =>
      E(["", "S0", "(v+0)=v", "∀vv=v"]).flatMap((x) =>
        product([x], range(Number(G.len(x)) + 2), range(Number(G.len(x)) + 2)),
      ),
    argKinds: "snn",
    outKind: "s",
  }),
  fn("occurs", "G1", 2, ([x, y]) => G.occurs(x, y), {
    title: "出現",
    def: "occurs(x, y) = 1 (x が y の部分列として現れる)。∃i, j ≤ len(y). slice(y, i, j) = x",
    hint: "符号の値ではなく、位置 i, j について量化する",
    needs: ["slice", "bex2", "eq"],
    cases: () => product(E(["", "0", "v", "=0", "S0", "0=", "v'"]), E(STR)),
    argKinds: "ss",
  }),
  // ---- G2 構文
  fn("num", "G2", 1, ([n]) => G.num(n), {
    title: "数項",
    def: "num(0) = ⌜0⌝、num(2n) = ⌜(SS0·⌝ num(n) ⌜)⌝、num(2n+1) = ⌜S(SS0·⌝ num(n) ⌜)⌝(n > 0)",
    hint: "1 進の数項 S…S0 はゲーデル数個の S が要るので使わない。2 進なら長さが桁数に比例する",
    needs: ALL_G1,
    cases: () => [...product(range(20)), [1000n], [enc("0=0")]],
    outKind: "s",
  }),
  fn("is_var", "G2", 1, ([x]) => G.is_var(x), {
    title: "変数である",
    def: "is_var(x) = 1 (x は v, v', v'', … のどれか)",
    needs: ALL_G1,
    cases: () => product(E(["v", "v'", "v''", "", "0", "vv", "'v", "v'0", "S", "v'''"])),
    argKinds: "s",
  }),
  fn("is_term", "G2", 1, ([x]) => G.is_term(x), {
    title: "項である",
    def: "項 t ::= 0 | 変数 | St | (t+t) | (t·t)",
    hint: "左から 1 記号ずつ読み、状態を 1 つの数に畳んで帰納法で進める",
    needs: ["is_var"],
    cases: () => product(E([...TERMS, ...NONTERMS])),
    argKinds: "s",
  }),
  fn("is_formula", "G2", 1, ([x]) => G.is_formula(x), {
    title: "論理式である",
    def: "論理式 A ::= t=t | ¬A | (A→B) | ∀xA(x は変数)",
    needs: ["is_term"],
    cases: () => product(E([...FORMS, ...NONFORMS])),
    argKinds: "s",
  }),
  fn("is_free", "G2", 2, ([x, a]) => G.is_free(x, a), {
    title: "自由変数である",
    def: "is_free(x, a) = 1 (変数 x が論理式 a に自由に現れる)",
    needs: ["is_formula"],
    cases: () => product(E(["v", "v'", "v''", "0"]), E([...FORMS.slice(0, 8), "0"])),
    argKinds: "ss",
  }),
  fn("subst", "G2", 3, ([a, x, t]) => G.subst(a, x, t), {
    title: "代入",
    def: "subst(a, x, t) = 論理式 a の自由な変数 x を項 t に置き換えたもの(a, x, t のどれかが不正なら a のまま)",
    needs: ["is_free", "is_term"],
    cases: () => [
      ...product(E(FORMS.slice(0, 9)), E(["v", "v'"]), E(["0", "Sv'", "(v+v)"])),
      [enc("0"), enc("v"), enc("0")],
      [enc("v=v"), enc("0"), enc("0")],
      [enc("v=v"), enc("v"), enc("=")],
    ],
    argKinds: "sss",
    outKind: "s",
  }),
  // ---- G3 証明
  fn("is_logic_axiom", "G3", 1, ([a]) => G.is_logic_axiom(a), {
    title: "論理公理である",
    def: "命題論理の図式 L1〜L3、量化の図式 L4・L5、等号の公理 E1〜E7 のどれかの形(証明ノートに一覧)",
    needs: ALL_G2,
    cases: () => product(E([...LOGIC_YES, ...LOGIC_NO])),
    argKinds: "s",
  }),
  fn("is_q_axiom", "G3", 1, ([a]) => G.is_q_axiom(a), {
    title: "Q の公理である",
    def: "Robinson 算術 Q の 7 つの公理のどれか(証明ノートに一覧)",
    needs: ["is_formula", "eq"],
    cases: () => product(E([...Q_AXIOMS, "v=v", "(v+0)=v'", "¬Sv=0#", "", "0=0"])),
    argKinds: "s",
  }),
  fn("mp", "G3", 3, ([a, b, c]) => G.mp(a, b, c), {
    title: "モーダス・ポネンス",
    def: "mp(a, b, c) = 1 (a, c が論理式で、b = ⌜(⌝ a ⌜→⌝ c ⌜)⌝)",
    needs: ["is_formula", "concat"],
    cases: () =>
      [
        ["0=0", "(0=0→v=v)", "v=v"],
        ["0=0", "(v=v→0=0)", "v=v"],
        ["0=0", "(0=0→v=v)", "0=0"],
        ["0=", "(0=→v=v)", "v=v"],
        ["v=v", "(v=v→(0=0→v=v))", "(0=0→v=v)"],
        ["0=0", "0=0", "0=0"],
      ].map(E),
    argKinds: "sss",
  }),
  fn("gen", "G3", 2, ([a, c]) => G.gen(a, c), {
    title: "汎化",
    def: "gen(a, c) = 1 (a が論理式で、ある変数 x について c = ⌜∀⌝ x a)",
    needs: ["is_formula", "is_var"],
    cases: () =>
      [
        ["v=v", "∀vv=v"],
        ["v=v", "∀v'v=v"],
        ["v=v", "∀vv=v'"],
        ["v=v", "v=v"],
        ["v=", "∀vv="],
        ["(v+0)=v", "∀v(v+0)=v"],
      ].map(E),
    argKinds: "ss",
  }),
  fn("prf", "G3", 2, ([p, a]) => G.prf(p, a), {
    title: "証明である",
    def: "prf(p, a) = 1 (p は # で区切った論理式の列で、各行は公理か、前の行からの MP・汎化で、最後の行が a)",
    hint: "検査には Q での実際の証明(0=0、1+1=2 など)と、それを壊したものが使われる",
    needs: ["is_logic_axiom", "is_q_axiom", "mp", "gen"],
    cases: () => {
      const out: bigint[][] = [];
      for (const s of sampleProofs().slice(0, 5)) {
        const lines = s.proof.split("#");
        out.push([enc(s.proof), enc(s.goal)]);
        out.push([enc(s.proof), enc("0=S0")]);
        out.push([enc([lines[0], ...lines.slice(2)].join("#")), enc(s.goal)]);
        out.push([enc(`${s.proof}#`), enc(s.goal)]);
      }
      out.push([0n, enc("0=0")], [enc("v=v"), enc("v=v")], [enc("0=0"), enc("0=0")]);
      return out;
    },
    argKinds: "ss",
    budget: 2e9,
  }),
  // ---- G4 表現可能性
  fn("beta", "G4", 3, ([c, d, i]) => G.beta(c, d, i), {
    title: "β 関数",
    def: "beta(c, d, i) = c mod (1 + (i+1)·d)",
    hint: "有限列 a₀…aₙ を 2 つの数 c, d に畳む(中国剰余定理)。帰納法を論理式に翻訳するときに使う",
    needs: ["mod", "bmu"],
    cases: () => product(range(12), range(4), range(4)),
  }),
  fn("repr", "G4", 1, reprNative, {
    title: "表現可能性の翻訳",
    def: "repr(e) = 符号 e の項 t を表現する論理式 F_t の符号(翻訳の規則は証明ノートに一覧。不正な符号は 0)",
    hint: "項の符号は T5 と同じ(対関数)。構造に沿った再帰は、スタックを数に畳んで帰納法で回す",
    needs: ["unl", "unr", "concat", "num", "is_formula"],
    cases: () => [
      ...product(PROGRAMS.slice(0, 6).map(progCode)),
      [progCode("Z")],
      [progCode("C(S; Z)")],
      [7n],
      [progCode("M(C(S; P[2,2]))")],
    ],
    outKind: "s",
    budget: 2e9,
  }),
  // ---- G5 対角化
  fn("diag", "G5", 1, ([x]) => G.diag(x), {
    title: "対角化",
    def: "diag(x) = subst(x, ⌜v⌝, num(x))。論理式 A(v) の符号を、A 自身の符号の数項を代入した文の符号に写す",
    needs: ["subst", "num"],
    cases: () => product(E(["¬v=0", "v=v", "0=0", "∀vv=v", "(v=v'→∀vv=v')", "0"])),
    argKinds: "s",
    outKind: "s",
  }),
  fn("fix", "G5", 2, ([d, b]) => G.fix(d, b), {
    title: "不動点の構成",
    def: "fix(d, b) = diag(⌜∀v'(⌝ d ⌜→⌝ subst(b, ⌜v⌝, ⌜v'⌝) ⌜)⌝)(d, b が論理式でなければ 0)",
    hint: "d が対角化を表現する論理式 D(v, v') なら、fix(d, b) は「自分自身が B をみたす」と述べる文の符号になる",
    needs: ["diag", "repr"],
    cases: () =>
      [
        ["v'=Sv", "¬v=0"],
        ["v=v'", "v=v"],
        ["v'=Sv", "∀v''¬v=v''"],
        ["0", "v=v"],
        ["v=v'", "("],
      ].map(E),
    argKinds: "ss",
    outKind: "s",
  }),
];

const UNIV: CatalogFn = {
  id: "univ",
  tier: "T5",
  arity: 2,
  title: "万能関数",
  def: "U(e, x) = 符号 e の項を、引数リスト x に適用した値(足りない引数は 0、不正な符号は 0)",
  hint: "項の符号: ⌜Z⌝ = pair(0,0)、⌜S⌝ = pair(1,0)、⌜P[n,i]⌝ = pair(2, pair(n,i))、⌜C(f; g…)⌝ = pair(3, pair(⌜f⌝, リスト))、⌜R(g,h)⌝ = pair(4, pair(⌜g⌝,⌜h⌝))、⌜M(f)⌝ = pair(5, ⌜f⌝)。リストは nil = 0、cons(a, l) = pair(a, l) + 1。1 ステップ進める関数を作り、止まるまでの回数を探索塔で探す",
  native: ([e, x]) => universal(e, x),
  ...fromCases(() => {
    const out: bigint[][] = [];
    const args: Record<string, bigint[][]> = {
      S: [[0n], [4n]],
      "P[2,2]": [[3n, 8n]],
      "C(S; S)": [[5n]],
      "C[1](Z;)": [[9n]],
    };
    for (const p of PROGRAMS)
      for (const a of args[p] ?? [
        [2n, 3n],
        [0n, 4n],
        [3n, 0n],
      ])
        out.push([progCode(p), listCode(a)]);
    out.push([7n, 0n]);
    return out;
  }),
  reward: 0,
  needs: ["unl", "unr"],
  budget: 5e9,
};

export const COURSE_CATALOG: CatalogFn[] = [UNIV, ...G0, ...COURSE];
export const COURSE_TIERS = [
  { id: "G0", title: "G0 図式", blurb: "関数を引数に取る構成を一度だけ導出する" },
  { id: "G1", title: "G1 記号列", blurb: "記号列を数として扱う" },
  { id: "G2", title: "G2 構文", blurb: "項・論理式・代入" },
  { id: "G3", title: "G3 証明", blurb: "「p は a の証明である」" },
  { id: "G4", title: "G4 表現可能性", blurb: "関数を論理式に翻訳する" },
  { id: "G5", title: "G5 対角化", blurb: "自分自身について述べる文" },
];
