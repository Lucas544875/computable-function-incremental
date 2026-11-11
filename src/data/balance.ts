// バランス数値と研究ツリー。調整はこのファイルに集約する(仕様書 §10)
import type { Kind } from "../sim/world";

export const TPS = 20;
export const START_QED = 60;
export const CLEAR_DELIVERIES = 20;
export const THEOREM_STREAK = 40;
export const GLOBAL_STEP_LIMIT = 2_000_000;
export const BASE_SIZE = 32;
export const BASE_BITS = 64;
export const OFFLINE_EFFICIENCY = 0.5;
export const BASE_OFFLINE_HOURS = 2;

export type BuildId = Kind | "S" | "P" | "Ref" | "R" | "M";

export const PRICES: Record<BuildId, number> = {
  belt: 1,
  cross: 4,
  zero: 5,
  fn: 0,
  S: 10,
  P: 10,
  dup: 10,
  split: 30,
  trash: 2,
  in: 0,
  out: 0,
  Ref: 50,
  R: 100,
  M: 500,
};

export interface ResearchItem {
  id: string;
  branch: "構成" | "物流" | "機械" | "運用";
  title: string;
  desc: string;
  cost: number;
  /** 先に必要な研究 */
  after?: string[];
  /** 先に達成が必要な契約 */
  needs?: string[];
}

export const RESEARCH: ResearchItem[] = [
  {
    id: "encap",
    branch: "構成",
    title: "カプセル化",
    desc: "納品港までの配線を 1 個の関数機にまとめる",
    cost: 1,
    needs: ["plus2"],
  },
  {
    id: "rec",
    branch: "構成",
    title: "帰納炉 R",
    desc: "g と h を装着して n 回くり返す",
    cost: 1,
    after: ["encap"],
    needs: ["succ2nd"],
  },
  {
    id: "mu",
    branch: "構成",
    title: "探索塔 μ",
    desc: "f(x, y) = 0 となる最小の y を探す",
    cost: 4,
    after: ["rec"],
    needs: ["is_prime"],
  },
  {
    id: "editor",
    branch: "構成",
    title: "項エディタ",
    desc: "関数をテキストで定義する",
    cost: 3,
    after: ["rec"],
    needs: ["mult"],
  },
  {
    id: "schema",
    branch: "構成",
    title: "図式",
    desc: "関数スロットを持つ関数を定義する(不完全性コース G0)",
    cost: 3,
    after: ["editor"],
    needs: ["is_prime"],
  },
  { id: "belt1", branch: "物流", title: "ベルト速度 I", desc: "ベルトが 2 倍速", cost: 1, needs: ["plus2"] },
  { id: "belt2", branch: "物流", title: "ベルト速度 II", desc: "ベルトが 4 倍速", cost: 2, after: ["belt1"] },
  {
    id: "split",
    branch: "物流",
    title: "分配器",
    desc: "トークンを交互に振り分けて並列化する",
    cost: 1,
    needs: ["add"],
  },
  { id: "board1", branch: "物流", title: "盤面拡張 I", desc: "48 × 48", cost: 2, needs: ["add"] },
  { id: "board2", branch: "物流", title: "盤面拡張 II", desc: "64 × 64", cost: 3, after: ["board1"] },
  { id: "board3", branch: "物流", title: "盤面拡張 III", desc: "96 × 96", cost: 5, after: ["board2"] },
  { id: "board4", branch: "物流", title: "盤面拡張 IV", desc: "128 × 128", cost: 8, after: ["board3"] },
  {
    id: "speed1",
    branch: "機械",
    title: "機械速度 I",
    desc: "機械が 1 tick に 4 ステップ進む",
    cost: 1,
    needs: ["add"],
  },
  {
    id: "speed2",
    branch: "機械",
    title: "機械速度 II",
    desc: "1 tick に 16 ステップ",
    cost: 2,
    after: ["speed1"],
  },
  {
    id: "speed3",
    branch: "機械",
    title: "機械速度 III",
    desc: "1 tick に 64 ステップ",
    cost: 4,
    after: ["speed2"],
  },
  {
    id: "buffer",
    branch: "機械",
    title: "入力バッファ",
    desc: "機械の入力待ちが 4 → 12 個",
    cost: 2,
    needs: ["add"],
  },
  {
    id: "bits1",
    branch: "機械",
    title: "帯域幅 256bit",
    desc: "流せる値の上限を広げる",
    cost: 2,
    needs: ["exp"],
  },
  { id: "bits2", branch: "機械", title: "帯域幅 1024bit", desc: "", cost: 3, after: ["bits1"] },
  {
    id: "bits3",
    branch: "機械",
    title: "帯域幅 65536bit",
    desc: "ゲーデル数が流せる",
    cost: 4,
    after: ["bits2"],
  },
  {
    id: "contracts2",
    branch: "運用",
    title: "同時契約 2",
    desc: "2 つの契約を同時に稼働",
    cost: 2,
    needs: ["add"],
  },
  {
    id: "contracts3",
    branch: "運用",
    title: "同時契約 4",
    desc: "4 つの契約を同時に稼働",
    cost: 4,
    after: ["contracts2"],
  },
  {
    id: "input1",
    branch: "運用",
    title: "入力港の高速化",
    desc: "引数が 2 倍の頻度で届く",
    cost: 2,
    needs: ["mult"],
  },
  { id: "offline1", branch: "運用", title: "オフライン進行 8 時間", desc: "", cost: 2, needs: ["mult"] },
  { id: "offline2", branch: "運用", title: "オフライン進行 24 時間", desc: "", cost: 4, after: ["offline1"] },
];

/** 階層昇格: 代表関数の契約でこの回数だけ納品する */
export const PRESTIGE_STEPS: { fn: string; need: number; name: string }[] = [
  { fn: "add", need: 300, name: "E¹" },
  { fn: "mult", need: 600, name: "E²" },
  { fn: "exp", need: 1000, name: "E³" },
  { fn: "is_prime", need: 2000, name: "E⁴" },
  { fn: "nth_prime", need: 3000, name: "E⁵" },
];

export interface Perk {
  id: string;
  title: string;
  desc: string;
  max: number;
}
export const PERKS: Perk[] = [
  { id: "speed", title: "熟練", desc: "機械速度 ×2(レベルごと)", max: 5 },
  { id: "reward", title: "信用", desc: "納品の報酬 ×2(レベルごと)", max: 10 },
  { id: "streak", title: "直観", desc: "定理化に必要な連続正解 −25%(レベルごと)", max: 3 },
  { id: "start", title: "元手", desc: "開始時の QED ×10(レベルごと)", max: 4 },
];
export const perkCost = (level: number) => level + 1;
