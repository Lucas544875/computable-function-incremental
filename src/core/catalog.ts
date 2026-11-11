// カタログ関数: 契約の目標関数。ネイティブ実装が参照定義を兼ねる。仕様書 §4.4

import type { Rng } from "./rng";
import type { Native, NativeSchema } from "./term";

export interface CatalogFn {
  id: string;
  title: string;
  tier: string;
  arity: number;
  /** 数学的な定義(表示用) */
  def: string;
  hint?: string;
  native: Native;
  /** 流れてくる引数を作る。level は入力範囲の拡張段階 */
  gen: (rng: Rng, level: number) => bigint[];
  /** 検査入力 */
  cases: () => bigint[][];
  reward: number;
  /** 先に達成が必要な契約 */
  needs: string[];
  /** 図式の場合: 穴のアリティと、検査時に装着する関数 */
  schema?: {
    holes: number[];
    holeNames: string[];
    native: NativeSchema;
    probes: { name: string; fs: Native[] }[];
  };
  /** 入力範囲の拡張ができない(構造を持つ入力) */
  fixedRange?: boolean;
  /** 検査のステップ予算(既定より大きくしたい場合) */
  budget?: number;
  /** 盤面に流さず、検査の合格だけで達成・定理化する(両モード共通) */
  verifyOnly?: boolean;
  /** 先に必要な研究 */
  needsResearch?: string;
  /** 引数と値の種類。"s" は記号列の符号(反例を記号列でも表示する)、"n" は数 */
  argKinds?: string;
  outKind?: "s" | "n";
}

/** 入力港・納品港で流せる契約か */
export const boardable = (c: CatalogFn) => !c.schema && !c.verifyOnly && c.arity >= 1 && c.arity <= 3;

const big = (n: number) => BigInt(n);

/** 各引数 [lo, hi) の一様乱数。level ごとに幅が 2 倍 */
function uniform(his: number[], los: number[] = []) {
  return (rng: Rng, level: number) =>
    his.map((hi, j) => {
      const lo = los[j] ?? 0;
      return big(lo + rng.int((hi - lo) * 2 ** level));
    });
}

/** 各引数 [lo, hi) の全数 */
function exhaustive(his: number[], los: number[] = []) {
  return () => {
    let out: bigint[][] = [[]];
    his.forEach((hi, j) => {
      const next: bigint[][] = [];
      for (const pre of out) for (let v = los[j] ?? 0; v < hi; v++) next.push([...pre, big(v)]);
      out = next;
    });
    return out;
  };
}

function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (let d = 2n; d * d <= n; d++) if (n % d === 0n) return false;
  return true;
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  // ニュートン法(大きい数でも正確)
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

export const pair = (x: bigint, y: bigint) => ((x + y) * (x + y + 1n)) / 2n + y;
export function unpair(z: bigint): [bigint, bigint] {
  const w = (isqrt(8n * z + 1n) - 1n) / 2n;
  const y = z - (w * (w + 1n)) / 2n;
  return [w - y, y];
}

function ack(m: bigint, n: bigint): bigint | null {
  if (m === 0n) return n + 1n;
  if (m === 1n) return n + 2n;
  if (m === 2n) return 2n * n + 3n;
  if (m === 3n) return n > 4096n ? null : (1n << (n + 3n)) - 3n;
  if (m === 4n && n === 0n) return 13n;
  if (m === 4n && n === 1n) return 65533n;
  return null;
}

type Row = Omit<CatalogFn, "id" | "arity" | "tier">;
const fn = (id: string, tier: string, arity: number, row: Row): CatalogFn => ({ id, tier, arity, ...row });

export const TIERS: { id: string; title: string; blurb: string }[] = [
  { id: "T0", title: "T0 種", blurb: "ゼロ・後者・射影とベルトだけで作る" },
  { id: "T1", title: "T1 帰納", blurb: "帰納炉で反復する" },
  { id: "T2", title: "T2 原始帰納", blurb: "原始帰納的関数を積み上げる" },
  { id: "T3", title: "T3 最小化", blurb: "探索塔で「最小の y」を探す" },
  { id: "T4", title: "T4 符号化", blurb: "数の組を 1 つの数に畳む" },
  { id: "T5", title: "T5 万能", blurb: "関数を計算する関数" },
];

export const BASE_CATALOG: CatalogFn[] = [
  // ---- T0
  fn("id", "T0", 1, {
    title: "そのまま届ける",
    def: "id(x) = x",
    hint: "入力港と納品港をベルトで繋ぐ",
    native: ([x]) => x,
    gen: uniform([8]),
    cases: exhaustive([8]),
    reward: 1,
    needs: [],
  }),
  fn("plus2", "T0", 1, {
    title: "2 を足す",
    def: "plus2(x) = x + 2",
    hint: "後者機 S を 2 台並べる(これが合成)",
    native: ([x]) => x + 2n,
    gen: uniform([8]),
    cases: exhaustive([8]),
    reward: 2,
    needs: ["id"],
  }),
  fn("zero", "T0", 1, {
    title: "いつも 0",
    def: "zero(x) = 0",
    hint: "ゼロ源の 0 は伝票なしなので、射影機 P[2,2] で x と組にしてから x を捨てる",
    native: () => 0n,
    gen: uniform([8]),
    cases: exhaustive([8]),
    reward: 2,
    needs: ["id"],
  }),
  fn("succ2nd", "T0", 2, {
    title: "2 番目に 1 を足す",
    def: "succ2nd(x, y) = y + 1",
    hint: "射影機 P[2,2] で y だけ通し、後者機に入れる",
    native: ([, y]) => y + 1n,
    gen: uniform([8, 8]),
    cases: exhaustive([5, 5]),
    reward: 3,
    needs: ["plus2"],
  }),
  // ---- T1
  fn("add", "T1", 2, {
    title: "加算",
    def: "add(x, 0) = x,  add(x, n+1) = S(add(x, n))",
    hint: "帰納炉に g = id、h = (x, n, acc) ↦ acc + 1 を装着する",
    native: ([x, y]) => x + y,
    gen: uniform([8, 8]),
    cases: exhaustive([6, 6]),
    reward: 8,
    needs: ["succ2nd"],
  }),
  fn("pred", "T1", 1, {
    title: "前者",
    def: "pred(0) = 0,  pred(n+1) = n",
    hint: "g は 0 引数の Z、h は (n, acc) ↦ n",
    native: ([x]) => (x > 0n ? x - 1n : 0n),
    gen: uniform([12]),
    cases: exhaustive([10]),
    reward: 8,
    needs: ["succ2nd"],
  }),
  fn("monus", "T1", 2, {
    title: "切り捨て減算",
    def: "monus(x, y) = max(x − y, 0)",
    hint: "pred を y 回くり返す",
    native: ([x, y]) => (x > y ? x - y : 0n),
    gen: uniform([10, 10]),
    cases: exhaustive([6, 6]),
    reward: 12,
    needs: ["pred"],
  }),
  fn("mult", "T1", 2, {
    title: "乗算",
    def: "mult(x, 0) = 0,  mult(x, n+1) = add(x, mult(x, n))",
    native: ([x, y]) => x * y,
    gen: uniform([8, 8]),
    cases: exhaustive([6, 6]),
    reward: 20,
    needs: ["add"],
  }),
  fn("sgn", "T1", 1, {
    title: "符号",
    def: "sgn(0) = 0,  sgn(n+1) = 1",
    native: ([x]) => (x > 0n ? 1n : 0n),
    gen: uniform([6]),
    cases: exhaustive([8]),
    reward: 10,
    needs: ["pred"],
  }),
  fn("is_zero", "T1", 1, {
    title: "ゼロ判定",
    def: "is_zero(0) = 1,  is_zero(n+1) = 0",
    native: ([x]) => (x === 0n ? 1n : 0n),
    gen: uniform([4]),
    cases: exhaustive([8]),
    reward: 10,
    needs: ["pred"],
  }),
  // ---- T2
  fn("exp", "T2", 2, {
    title: "冪乗",
    def: "exp(x, 0) = 1,  exp(x, n+1) = mult(x, exp(x, n))",
    native: ([x, y]) => x ** y,
    gen: uniform([5, 5]),
    cases: exhaustive([5, 5]),
    reward: 60,
    needs: ["mult"],
  }),
  fn("fact", "T2", 1, {
    title: "階乗",
    def: "fact(0) = 1,  fact(n+1) = (n+1) · fact(n)",
    native: ([n]) => {
      let r = 1n;
      for (let i = 2n; i <= n; i++) r *= i;
      return r;
    },
    gen: uniform([7]),
    cases: exhaustive([7]),
    reward: 60,
    needs: ["mult"],
  }),
  fn("eq", "T2", 2, {
    title: "等しい",
    def: "eq(x, y) = 1 (x = y),  0 (x ≠ y)",
    hint: "monus(x, y) + monus(y, x) が 0 かどうか",
    native: ([x, y]) => (x === y ? 1n : 0n),
    gen: uniform([4, 4]),
    cases: exhaustive([6, 6]),
    reward: 40,
    needs: ["monus", "is_zero"],
  }),
  fn("lt", "T2", 2, {
    title: "より小さい",
    def: "lt(x, y) = 1 (x < y),  0 (x ≥ y)",
    native: ([x, y]) => (x < y ? 1n : 0n),
    gen: uniform([6, 6]),
    cases: exhaustive([6, 6]),
    reward: 40,
    needs: ["monus", "sgn"],
  }),
  fn("min", "T2", 2, {
    title: "最小",
    def: "min(x, y)",
    hint: "x − (x ∸ y)",
    native: ([x, y]) => (x < y ? x : y),
    gen: uniform([10, 10]),
    cases: exhaustive([6, 6]),
    reward: 40,
    needs: ["monus"],
  }),
  fn("max", "T2", 2, {
    title: "最大",
    def: "max(x, y)",
    hint: "x + (y ∸ x)",
    native: ([x, y]) => (x > y ? x : y),
    gen: uniform([10, 10]),
    cases: exhaustive([6, 6]),
    reward: 40,
    needs: ["monus", "add"],
  }),
  fn("div", "T2", 2, {
    title: "商",
    def: "div(x, y) = ⌊x / y⌋(div(x, 0) = 0)",
    hint: "x を 0 から数え上げ、(q+1)·y ≤ n+1 のとき q を 1 増やす",
    native: ([x, y]) => (y === 0n ? 0n : x / y),
    gen: uniform([16, 6]),
    cases: exhaustive([10, 5]),
    reward: 100,
    needs: ["lt", "mult"],
  }),
  fn("mod", "T2", 2, {
    title: "剰余",
    def: "mod(x, y) = x − y·⌊x / y⌋(mod(x, 0) = x)",
    native: ([x, y]) => (y === 0n ? x : x % y),
    gen: uniform([16, 6]),
    cases: exhaustive([10, 5]),
    reward: 100,
    needs: ["lt"],
  }),
  fn("is_prime", "T2", 1, {
    title: "素数判定",
    def: "is_prime(n) = 1 (n は素数),  0 (それ以外)",
    hint: "2 ≤ d < n の範囲で割り切る d を数える",
    native: ([n]) => (isPrime(n) ? 1n : 0n),
    gen: uniform([24]),
    cases: exhaustive([24]),
    reward: 200,
    needs: ["mod", "eq"],
  }),
  // ---- T3
  fn("isqrt", "T3", 1, {
    title: "平方根(切り捨て)",
    def: "isqrt(n) = μy[(y+1)² > n]",
    hint: "探索塔は f(x, y) = 0 となる最小の y を返す",
    native: ([n]) => isqrt(n),
    gen: uniform([40]),
    cases: exhaustive([30]),
    reward: 600,
    needs: ["lt", "mult"],
  }),
  fn("log2", "T3", 1, {
    title: "2 を底とする対数(切り捨て)",
    def: "log2(n) = μy[2^(y+1) > n](log2(0) = 0)",
    native: ([n]) => (n < 1n ? 0n : big(n.toString(2).length - 1)),
    gen: uniform([64]),
    cases: exhaustive([34]),
    reward: 600,
    needs: ["exp", "lt"],
  }),
  fn("nth_prime", "T3", 1, {
    title: "n 番目の素数",
    def: "nth_prime(0) = 2,  nth_prime(n+1) = μp[p > nth_prime(n) ∧ p は素数]",
    native: ([n]) => {
      let p = 2n;
      for (let i = 0n; i < n; i++) {
        p++;
        while (!isPrime(p)) p++;
      }
      return p;
    },
    gen: uniform([8]),
    cases: exhaustive([8]),
    reward: 1500,
    needs: ["is_prime"],
  }),
  fn("collatz", "T3", 1, {
    title: "コラッツ停止時間",
    def: "collatz(n) = n が 1 になるまでの回数(n → n/2 または 3n+1)。n ≥ 1",
    hint: "すべての n で止まるかは未解決。k 回くり返した値を返す関数を作り、それが 1 になる最小の k を探す",
    native: ([n]) => {
      if (n < 1n) return null;
      let c = 0n;
      let v = n;
      while (v !== 1n) {
        v = v % 2n === 0n ? v / 2n : 3n * v + 1n;
        c++;
      }
      return c;
    },
    gen: uniform([10], [1]),
    cases: exhaustive([10], [1]),
    reward: 3000,
    needs: ["mod", "div", "eq"],
    budget: 5e7,
  }),
  // ---- T4
  fn("pair", "T4", 2, {
    title: "対関数",
    def: "pair(x, y) = (x+y)(x+y+1)/2 + y",
    native: ([x, y]) => pair(x, y),
    gen: uniform([8, 8]),
    cases: exhaustive([6, 6]),
    reward: 8000,
    needs: ["div", "isqrt"],
  }),
  fn("unl", "T4", 1, {
    title: "対の左成分",
    def: "unl(pair(x, y)) = x",
    native: ([z]) => unpair(z)[0],
    gen: uniform([60]),
    cases: exhaustive([30]),
    reward: 12000,
    needs: ["pair"],
  }),
  fn("unr", "T4", 1, {
    title: "対の右成分",
    def: "unr(pair(x, y)) = y",
    native: ([z]) => unpair(z)[1],
    gen: uniform([60]),
    cases: exhaustive([30]),
    reward: 12000,
    needs: ["pair"],
  }),
  fn("ack", "T4", 2, {
    title: "アッカーマン関数",
    def: "A(0, n) = n+1,  A(m+1, 0) = A(m, 1),  A(m+1, n+1) = A(m, A(m+1, n))",
    hint: "原始帰納的ではない。計算の履歴(スタック)を 1 つの数に符号化して、止まるまで探索する",
    native: ([m, n]) => ack(m, n),
    gen: (rng) => {
      const m = rng.int(3);
      return [big(m), big(rng.int(m === 2 ? 3 : 4))];
    },
    cases: () => [...exhaustive([3, 3])(), [3n, 0n]],
    reward: 80000,
    needs: ["unl", "unr"],
    fixedRange: true,
    budget: 2e8,
  }),
];
