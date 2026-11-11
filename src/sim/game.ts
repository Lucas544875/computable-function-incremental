// ゲーム本体: 盤面 + 契約 + 経済 + 研究 + 定理化 + セーブ。DOM に依存しない。
import Decimal from "break_infinity.js";
import { boardable, type CatalogFn } from "../core/catalog";
import { EvalStop, Evaluator } from "../core/eval";
import { NAME_RE, parseDef, parseTerm } from "../core/parse";
import { Rng } from "../core/rng";
import { check, type FnDef, refs, show, type Term, TermError, usesMu } from "../core/term";
import { type VerifyReport, verify } from "../core/verify";
import { computeGodel, type GodelReport } from "../course/final";
import { ALL_CATALOG } from "../data/all";
import {
  BASE_BITS,
  BASE_OFFLINE_HOURS,
  BASE_SIZE,
  type BuildId,
  CLEAR_DELIVERIES,
  GLOBAL_STEP_LIMIT,
  OFFLINE_EFFICIENCY,
  PERKS,
  PRESTIGE_STEPS,
  PRICES,
  perkCost,
  RESEARCH,
  START_QED,
  THEOREM_STREAK,
  TPS,
} from "../data/balance";
import { extract, machineTerm } from "./extract";
import {
  type Dir,
  DX,
  DY,
  type Ent,
  type EvalOutcome,
  type FnSpec,
  type Hooks,
  type Kind,
  type Status,
  type Tuning,
  World,
} from "./world";

export type Mode = "factory" | "explore";

export interface Blueprint extends FnDef {
  origin: "board" | "text";
  claim?: string | null;
  verified?: boolean;
  theorem?: boolean;
  report?: VerifyReport | null;
}

interface ContractState {
  active: boolean;
  delivered: number;
  wrong: number;
  streak: number;
  best: number;
  cleared: boolean;
  level: number;
  ready: boolean;
  jobs: Map<number, bigint | null>;
}

export type Command =
  | {
      c: "place";
      build: BuildId;
      x: number;
      y: number;
      dir: Dir;
      fn?: FnSpec;
      contract?: string | null;
      arity?: number;
    }
  | { c: "remove"; x: number; y: number }
  | { c: "rotate"; x: number; y: number }
  | { c: "config"; x: number; y: number; fn?: FnSpec; contract?: string | null; arity?: number }
  | { c: "resetMachine"; x: number; y: number }
  | { c: "clearTokens" }
  | { c: "undo" }
  | { c: "activate"; id: string; on: boolean }
  | { c: "upgradeRange"; id: string }
  | { c: "encapsulate"; x: number; y: number; name: string }
  | { c: "define"; src: string }
  | { c: "deleteDef"; name: string }
  | { c: "claim"; name: string; id: string }
  | { c: "testRun"; name: string; args: string[] }
  | { c: "research"; id: string }
  | { c: "prestige" }
  | { c: "perk"; id: string }
  | { c: "toExplore" }
  | { c: "godel" }
  | { c: "pause"; on: boolean };

export interface CmdResult {
  ok: boolean;
  error?: string;
  info?: string;
  data?: any;
}

export interface DefView {
  id: string;
  arity: number;
  text: string;
  holes: number[];
  holeNames: string[];
  origin: "board" | "text";
  claim: string | null;
  verified: boolean;
  theorem: boolean;
  primrec: boolean;
  report: VerifyReport | null;
  inUse: boolean;
}

export interface ContractView {
  id: string;
  unlocked: boolean;
  active: boolean;
  delivered: number;
  wrong: number;
  streak: number;
  best: number;
  cleared: boolean;
  level: number;
  ready: boolean;
  reward: string;
  upCost: string;
  theorem: boolean;
}

export interface EntView {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  dir: Dir;
  label: string;
  sub: string;
  ar: number;
  fn?: FnSpec;
  contract?: string | null;
  arity?: number;
}

export interface Meta {
  mode: Mode;
  tick: number;
  paused: boolean;
  qed: string;
  rate: string;
  tp: number;
  size: number;
  bits: number;
  research: string[];
  researchOpen: string[];
  builds: BuildId[];
  maxActive: number;
  streakNeed: number;
  contracts: ContractView[];
  defs: DefView[];
  prestige: {
    level: number;
    axiom: number;
    perks: Record<string, number>;
    next: { fn: string; need: number; have: number; name: string };
  };
  log: { seq: number; kind: "info" | "good" | "warn"; text: string }[];
  offline: { seconds: number; gain: string } | null;
  godel: GodelReport | null;
  worldVersion: number;
}

export interface Frame {
  tick: number;
  ids: Int32Array;
  xs: Float32Array;
  ys: Float32Array;
  jobs: Int32Array;
  labels: string[];
  machines: { id: number; status: Status; prog: number; buf: number; note?: string; last?: string[] }[];
}

const SAVE_VERSION = 1;

export function fmtValue(v: bigint): string {
  const s = v.toString();
  if (s.length <= 6) return s;
  return `${s[0]}.${s.slice(1, 3)}e${s.length - 1}`;
}

export class Game {
  mode: Mode;
  world: World;
  defs = new Map<string, Blueprint>();
  catalog: Map<string, CatalogFn>;
  contracts = new Map<string, ContractState>();
  qed = new Decimal(START_QED);
  tp = 0;
  research = new Set<string>();
  awarded = new Set<string>();
  tickNo = 0;
  paused = false;
  rng: Rng;
  jobSeq = 0;
  level = 0;
  axiom = 0;
  perks: Record<string, number> = {};
  log: Meta["log"] = [];
  private logSeq = 0;
  private buckets: Decimal[] = [];
  private bucket = new Decimal(0);
  savedRate = new Decimal(0);
  offline: Meta["offline"] = null;
  godel: GodelReport | null = null;
  private ev: Evaluator;
  private failCache = new Map<string, EvalOutcome>();
  private undoStack: Command[][] = [];
  private warned = new Map<string, number>();
  metaVersion = 0;
  env = { get: (id: string) => this.defs.get(id) };

  constructor(mode: Mode, seed = 12345, catalog: CatalogFn[] = ALL_CATALOG) {
    this.mode = mode;
    this.catalog = new Map(catalog.map((c) => [c.id, c]));
    this.rng = new Rng(seed);
    this.world = new World(mode === "explore" ? 96 : BASE_SIZE);
    this.ev = new Evaluator(this.env);
    for (const c of catalog) this.contracts.set(c.id, this.freshContract());
    this.afterProgress();
  }

  private freshContract(): ContractState {
    return {
      active: false,
      delivered: 0,
      wrong: 0,
      streak: 0,
      best: 0,
      cleared: false,
      level: 0,
      ready: false,
      jobs: new Map(),
    };
  }

  // ---------------------------------------------------------------- 派生値
  get explore() {
    return this.mode === "explore";
  }
  has(r: string) {
    return this.research.has(r);
  }
  perk(id: string) {
    return this.perks[id] ?? 0;
  }
  get bits(): number {
    if (this.explore) return 0;
    return this.has("bits3") ? 65536 : this.has("bits2") ? 1024 : this.has("bits1") ? 256 : BASE_BITS;
  }
  get machineSpeed(): number {
    const base = this.has("speed3") ? 64 : this.has("speed2") ? 16 : this.has("speed1") ? 4 : 1;
    return base * 2 ** this.perk("speed");
  }
  get boardSize(): number {
    if (this.explore) return 96;
    return this.has("board4")
      ? 128
      : this.has("board3")
        ? 96
        : this.has("board2")
          ? 64
          : this.has("board1")
            ? 48
            : BASE_SIZE;
  }
  get maxActive(): number {
    if (this.explore) return 99;
    return this.has("contracts3") ? 4 : this.has("contracts2") ? 2 : 1;
  }
  get streakNeed(): number {
    return Math.max(5, Math.round(THEOREM_STREAK * 0.75 ** this.perk("streak")));
  }
  get offlineCapHours(): number {
    return this.has("offline2") ? 24 : this.has("offline1") ? 8 : BASE_OFFLINE_HOURS;
  }
  tuning(): Tuning {
    return {
      beltSpeed: this.explore ? 1 : this.has("belt2") ? 1 : this.has("belt1") ? 0.5 : 0.25,
      bufCap: this.explore || this.has("buffer") ? 12 : 4,
      zeroPeriod: this.explore ? 1 : 4,
      inPeriod: this.explore ? 2 : this.has("input1") ? 5 : 10,
    };
  }
  builds(): BuildId[] {
    const b: BuildId[] = ["belt", "cross", "in", "out", "zero", "S", "P", "dup", "trash"];
    if (this.has("split")) b.push("split");
    if (this.has("encap")) b.push("Ref");
    if (this.has("rec")) b.push("R");
    if (this.has("mu")) b.push("M");
    return b;
  }
  unlocked(id: string): boolean {
    const c = this.catalog.get(id);
    if (!c || (c.needsResearch && !this.has(c.needsResearch))) return false;
    return c.needs.every((n) => this.contracts.get(n)?.cleared);
  }
  researchOpen(id: string): boolean {
    const r = RESEARCH.find((x) => x.id === id);
    if (!r || this.has(id)) return false;
    return (
      (r.after ?? []).every((a) => this.has(a)) &&
      (r.needs ?? []).every((n) => this.contracts.get(n)?.cleared)
    );
  }
  rewardOf(id: string): Decimal {
    const c = this.catalog.get(id)!;
    const st = this.contracts.get(id)!;
    return new Decimal(c.reward)
      .mul(Decimal.pow(3, st.level))
      .mul(1 + Math.min(st.streak, 100) / 100)
      .mul(Decimal.pow(2, this.perk("reward")));
  }
  upCost(id: string): Decimal {
    const c = this.catalog.get(id)!;
    const st = this.contracts.get(id)!;
    return new Decimal(c.reward).mul(150).mul(Decimal.pow(12, st.level));
  }

  say(kind: "info" | "good" | "warn", text: string) {
    this.log.push({ seq: ++this.logSeq, kind, text });
    if (this.log.length > 40) this.log.shift();
    this.metaVersion++;
  }
  private warnOnce(key: string, text: string) {
    const last = this.warned.get(key) ?? -1e9;
    if (this.tickNo - last < TPS * 20) return;
    this.warned.set(key, this.tickNo);
    this.say("warn", text);
  }

  // ---------------------------------------------------------------- シミュレーション
  private hooks: Hooks = {
    evalFn: (e, args) => this.evalMachine(e, args),
    emit: (e) => this.emit(e),
    deliver: (e, t) => this.deliver(e, t.v, t.job),
    portArity: (e) => this.portArity(e),
  };

  portArity(e: Ent): number {
    if (e.contract) return this.catalog.get(e.contract)?.arity ?? 0;
    return e.arity ?? 1;
  }

  private evalMachine(e: Ent, args: bigint[]): EvalOutcome {
    const term = e.term!;
    const cutoff = e.fn?.t === "M" ? e.fn.cutoff : 0;
    const limit = cutoff > 0 ? cutoff : GLOBAL_STEP_LIMIT;
    const speed = this.machineSpeed;
    const ticksOf = (cost: number) => (this.explore ? 1 : Math.max(1, Math.ceil(cost / speed)));
    const key = `${e.id}|${limit}|${args.join(",")}`;
    const cached = this.failCache.get(key);
    if (cached) return cached;
    const r = this.ev.run(term, args, limit, this.bits);
    if (r.ok) return { value: r.value, ticks: ticksOf(r.cost) };
    let out: EvalOutcome;
    if (r.code === "overflow") {
      this.warnOnce(
        `ov${e.id}`,
        `(${e.x}, ${e.y}) の機械: 値が帯域幅 ${this.bits}bit を超えたので破棄しました`,
      );
      out = { value: null, ticks: ticksOf(r.cost) };
    } else if (r.code === "budget" && cutoff > 0) {
      out = { value: null, ticks: ticksOf(cutoff) };
    } else {
      this.warnOnce(
        `ra${e.id}`,
        `(${e.x}, ${e.y}) の機械が暴走しています(${limit.toLocaleString()} ステップで止まらない)`,
      );
      out = { value: null, ticks: 1, runaway: true };
    }
    if (this.failCache.size > 5000) this.failCache.clear();
    this.failCache.set(key, out);
    return out;
  }

  private emit(e: Ent): { args: bigint[]; job: number } | null {
    if (!e.contract) {
      const k = e.arity ?? 1;
      return { args: Array.from({ length: k }, () => BigInt(this.rng.int(6))), job: ++this.jobSeq };
    }
    const cat = this.catalog.get(e.contract);
    const st = this.contracts.get(e.contract);
    if (!cat || !st?.active) return null;
    const args = cat.gen(this.rng, st.level);
    const job = ++this.jobSeq;
    st.jobs.set(job, cat.native(args));
    if (st.jobs.size > 4000) st.jobs.delete(st.jobs.keys().next().value!);
    return { args, job };
  }

  private deliver(e: Ent, v: bigint, job: number) {
    e.last = [fmtValue(v)];
    if (!e.contract) return;
    const st = this.contracts.get(e.contract);
    if (!st?.active) return;
    const expected = st.jobs.get(job);
    st.jobs.delete(job);
    if (expected !== undefined && expected !== null && expected === v) {
      if (!this.explore) {
        const gain = this.rewardOf(e.contract);
        this.qed = this.qed.add(gain);
        this.bucket = this.bucket.add(gain);
      }
      st.delivered++;
      st.streak++;
      if (st.streak > st.best) st.best = st.streak;
      e.note = "ok";
      if ((!st.cleared && st.delivered >= CLEAR_DELIVERIES) || (!st.ready && st.best >= this.streakNeed))
        this.afterProgress();
    } else {
      st.wrong++;
      st.streak = 0;
      e.note = "ng";
      const why = expected === undefined ? "伝票が一致しません(重複か、別の契約の値)" : `正解は ${expected}`;
      this.warnOnce(
        `ng${e.contract}`,
        `「${this.catalog.get(e.contract)!.title}」に不正解の ${fmtValue(v)} が届きました。${why}`,
      );
    }
  }

  tick() {
    if (this.paused) return;
    this.tickNo++;
    this.world.tick(this.hooks, this.tuning());
    if (this.tickNo % (TPS * 10) === 0) {
      this.buckets.push(this.bucket);
      this.bucket = new Decimal(0);
      if (this.buckets.length > 30) this.buckets.shift();
      this.metaVersion++;
    }
    if (this.tickNo % 5 === 0) this.metaVersion++;
  }

  rate(): Decimal {
    if (!this.buckets.length) return this.savedRate;
    return this.buckets.reduce((a, b) => a.add(b), new Decimal(0)).div(this.buckets.length * 10);
  }

  // ---------------------------------------------------------------- 進行
  /** 契約の達成・定理化・研究の自動解禁をまとめて更新する */
  afterProgress() {
    // 探究モードは、関数を登録する手段(カプセル化と項エディタ)を最初から持つ
    if (this.explore) for (const r of ["encap", "editor"]) this.research.add(r);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, st] of this.contracts) {
        const cat = this.catalog.get(id)!;
        if (!st.cleared) {
          const done =
            this.explore || !boardable(cat)
              ? [...this.defs.values()].some((d) => d.claim === id && d.verified)
              : st.delivered >= CLEAR_DELIVERIES;
          if (done) {
            st.cleared = true;
            if (!this.explore) this.tp++;
            this.say("good", `契約達成: ${cat.title}(${id})`);
            changed = true;
          }
        }
        if (!st.ready && (this.explore || !boardable(cat) || st.best >= this.streakNeed)) {
          st.ready = true;
          changed = true;
        }
      }
      for (const d of this.defs.values()) {
        if (d.theorem || !d.verified || !d.claim) continue;
        const st = this.contracts.get(d.claim);
        const cat = this.catalog.get(d.claim);
        if (!st || !cat || !st.ready) continue;
        d.theorem = true;
        if (cat.schema) d.nativeSchema = cat.schema.native;
        else d.native = cat.native;
        if (!this.awarded.has(d.claim)) {
          this.awarded.add(d.claim);
          if (!this.explore) this.tp++;
        }
        this.ev.clear();
        this.failCache.clear();
        this.say("good", `定理化: ${d.id} は ${d.claim} として 1 ステップで評価されます`);
        changed = true;
      }
      if (this.explore)
        for (const r of RESEARCH)
          if (this.researchOpen(r.id)) {
            this.research.add(r.id);
            this.say("info", `解禁: ${r.title}`);
            changed = true;
          }
    }
    if (this.world.size !== this.boardSize) this.world.size = this.boardSize;
    this.refreshMachines();
    this.metaVersion++;
  }

  refreshMachines() {
    for (const e of this.world.cells.values()) {
      if (e.kind !== "fn") continue;
      const t = machineTerm(e);
      e.term = null;
      e.ar = -1;
      if (!t) continue;
      try {
        const ar = check(t, this.env);
        if (ar <= 3) {
          e.term = t;
          e.ar = ar;
        }
      } catch {
        /* 未設定・不正な機械は止めておく */
      }
    }
    this.world.version++;
  }

  // ---------------------------------------------------------------- コマンド
  private priceOf(e: Pick<Ent, "kind" | "fn">): number {
    return e.kind === "fn" ? PRICES[e.fn!.t] : PRICES[e.kind];
  }

  exec(cmd: Command, fromUndo = false): CmdResult {
    try {
      const r = this.run(cmd, fromUndo);
      this.metaVersion++;
      return r;
    } catch (e) {
      if (e instanceof TermError || e instanceof EvalStop) return { ok: false, error: e.message };
      throw e;
    }
  }

  private run(cmd: Command, fromUndo: boolean): CmdResult {
    const w = this.world;
    const fail = (error: string): CmdResult => ({ ok: false, error });
    const ok = (info?: string, data?: any): CmdResult => ({ ok: true, info, data });
    switch (cmd.c) {
      case "place": {
        if (!w.inBounds(cmd.x, cmd.y)) return fail("盤面の外です");
        if (!this.builds().includes(cmd.build)) return fail("まだ解禁されていません");
        const isFn = ["S", "P", "Ref", "R", "M"].includes(cmd.build);
        const kind: Kind = isFn ? "fn" : (cmd.build as Kind);
        const fn: FnSpec | undefined = isFn
          ? (cmd.fn ??
            (cmd.build === "S"
              ? { t: "S" }
              : cmd.build === "P"
                ? { t: "P", n: 2, i: 1 }
                : cmd.build === "Ref"
                  ? { t: "Ref", id: null }
                  : cmd.build === "R"
                    ? { t: "R", g: null, h: null }
                    : { t: "M", f: null, cutoff: 10000 }))
          : undefined;
        const cur = w.at(cmd.x, cmd.y);
        if (cur) {
          if (cur.kind === "belt" && kind === "belt") {
            if (cur.dir !== cmd.dir) {
              cur.dir = cmd.dir;
              w.dirty();
            }
            return ok();
          }
          return fail("そこには既に何かあります");
        }
        const price = new Decimal(this.priceOf({ kind, fn }));
        if (!this.explore) {
          if (this.qed.lt(price)) return fail(`QED が足りません(${price} 必要)`);
          this.qed = this.qed.sub(price);
        }
        const contract = kind === "in" || kind === "out" ? (cmd.contract ?? null) : undefined;
        w.place({
          kind,
          x: cmd.x,
          y: cmd.y,
          dir: cmd.dir,
          fn,
          contract,
          arity: kind === "in" ? (cmd.arity ?? 1) : undefined,
        });
        this.refreshMachines();
        if (!fromUndo) this.pushUndo([{ c: "remove", x: cmd.x, y: cmd.y }]);
        return ok();
      }
      case "remove": {
        const e = w.remove(cmd.x, cmd.y);
        if (!e) return ok();
        if (!this.explore) this.qed = this.qed.add(this.priceOf(e));
        this.refreshMachines();
        if (!fromUndo) {
          const build = (e.kind === "fn" ? e.fn!.t : e.kind) as BuildId;
          this.pushUndo([
            { c: "place", build, x: e.x, y: e.y, dir: e.dir, fn: e.fn, contract: e.contract, arity: e.arity },
          ]);
        }
        return ok();
      }
      case "rotate": {
        const e = w.at(cmd.x, cmd.y);
        if (!e) return ok();
        e.dir = ((e.dir + 1) % 4) as Dir;
        w.resetRuntime(e);
        w.dirty();
        return ok();
      }
      case "config": {
        const e = w.at(cmd.x, cmd.y);
        if (!e) return fail("何もありません");
        if (cmd.fn && e.kind === "fn" && cmd.fn.t === e.fn!.t) e.fn = { ...cmd.fn };
        if (cmd.contract !== undefined && (e.kind === "in" || e.kind === "out")) {
          if (cmd.contract && !this.unlocked(cmd.contract)) return fail("その契約はまだ受けられません");
          e.contract = cmd.contract;
        }
        if (cmd.arity !== undefined && e.kind === "in") e.arity = Math.max(1, Math.min(3, cmd.arity));
        w.resetRuntime(e);
        this.refreshMachines();
        w.dirty();
        return ok();
      }
      case "resetMachine": {
        const e = w.at(cmd.x, cmd.y);
        if (e) w.resetRuntime(e);
        return ok();
      }
      case "clearTokens":
        w.clearTokens();
        for (const st of this.contracts.values()) st.jobs.clear();
        return ok("盤面のトークンを消しました");
      case "undo": {
        const u = this.undoStack.pop();
        if (!u) return fail("取り消せる操作がありません");
        for (const c of u) this.exec(c, true);
        return ok();
      }
      case "activate": {
        const st = this.contracts.get(cmd.id);
        if (!st || !this.unlocked(cmd.id)) return fail("その契約はまだ受けられません");
        if (!boardable(this.catalog.get(cmd.id)!))
          return fail("この契約は盤面に流せません。「関数」画面で検査します");
        if (cmd.on && !st.active) {
          const n = [...this.contracts.values()].filter((s) => s.active).length;
          if (n >= this.maxActive)
            return fail(`同時に稼働できる契約は ${this.maxActive} 件です。先に別の契約を止めてください`);
        }
        st.active = cmd.on;
        if (!cmd.on) {
          st.jobs.clear();
          st.streak = 0;
        }
        return ok();
      }
      case "upgradeRange": {
        const st = this.contracts.get(cmd.id);
        const cat = this.catalog.get(cmd.id);
        if (!st || !cat || cat.fixedRange) return fail("この契約は入力範囲を広げられません");
        if (st.level >= 6) return fail("これ以上広げられません");
        const cost = this.upCost(cmd.id);
        if (!this.explore) {
          if (this.qed.lt(cost)) return fail("QED が足りません");
          this.qed = this.qed.sub(cost);
        }
        st.level++;
        return ok();
      }
      case "encapsulate": {
        if (!this.has("encap")) return fail("カプセル化はまだ研究されていません");
        const e = w.at(cmd.x, cmd.y);
        if (e?.kind !== "out") return fail("納品港を選んでください");
        this.checkName(cmd.name);
        const { term } = extract(w, e, (p) => this.portArity(p));
        const arity = check(term, this.env);
        this.defs.set(cmd.name, { id: cmd.name, arity, term, origin: "board" });
        this.say("good", `カプセル化: ${cmd.name} = ${show(term)}`);
        return ok(`${cmd.name} を登録しました(${arity} 引数)`);
      }
      case "define": {
        if (!this.has("editor")) return fail("項エディタはまだ研究されていません");
        const d = parseDef(cmd.src);
        this.checkName(d.name);
        if (d.holes.length && !this.has("schema")) return fail("図式はまだ研究されていません");
        const arity = check(d.term, this.env, d.holes);
        this.defs.set(d.name, {
          id: d.name,
          arity,
          term: d.term,
          origin: "text",
          holes: d.holes.length ? d.holes : undefined,
          holeNames: d.holeNames,
        });
        return ok(`${d.name} を登録しました(${arity} 引数)`);
      }
      case "deleteDef": {
        if (!this.defs.has(cmd.name)) return fail("見つかりません");
        if (this.inUse(cmd.name)) return fail("ほかの関数か盤面の機械が使っています");
        this.defs.delete(cmd.name);
        this.ev.clear();
        return ok();
      }
      case "claim": {
        const d = this.defs.get(cmd.name);
        const cat = this.catalog.get(cmd.id);
        if (!d || !cat) return fail("見つかりません");
        if (!this.unlocked(cmd.id)) return fail("その契約はまだ受けられません");
        if (d.theorem) return fail("定理化済みの関数は付け替えられません");
        const rep = verify(this.ev, d, cat, 0);
        d.claim = cmd.id;
        d.verified = rep.ok;
        d.report = rep;
        this.afterProgress();
        return ok(rep.ok ? `検査に合格(${rep.passed} 件)` : "検査に不合格", rep);
      }
      case "testRun": {
        const d = this.defs.get(cmd.name);
        if (!d) return fail("見つかりません");
        if (d.holes?.length) return fail("図式は単体では実行できません");
        if (cmd.args.length !== d.arity) return fail(`引数は ${d.arity} 個です`);
        if (cmd.args.some((a) => !/^\d+$/.test(a.trim()))) return fail("引数は 0 以上の整数にしてください");
        const r = this.ev.run(
          { kind: "Ref", id: d.id },
          cmd.args.map((a) => BigInt(a.trim())),
          5e7,
          0,
        );
        return ok(
          undefined,
          r.ok ? { value: r.value.toString(), cost: r.cost } : { fail: r.code, cost: r.cost },
        );
      }
      case "research": {
        const r = RESEARCH.find((x) => x.id === cmd.id);
        if (!r || !this.researchOpen(cmd.id)) return fail("まだ研究できません");
        if (this.tp < r.cost) return fail("定理点が足りません");
        this.tp -= r.cost;
        this.research.add(r.id);
        this.afterProgress();
        return ok(`研究完了: ${r.title}`);
      }
      case "prestige": {
        if (this.explore) return fail("探究モードに階層昇格はありません");
        const next = this.prestigeNext();
        if (next.have < next.need) return fail("昇格条件を満たしていません");
        this.axiom += 1 + this.level;
        this.level++;
        this.resetRun();
        this.say("good", `階層 ${next.name} に昇格しました`);
        return ok();
      }
      case "perk": {
        const p = PERKS.find((x) => x.id === cmd.id);
        if (!p) return fail("見つかりません");
        const lv = this.perk(p.id);
        if (lv >= p.max) return fail("最大です");
        if (this.axiom < perkCost(lv)) return fail("公理点が足りません");
        this.axiom -= perkCost(lv);
        this.perks[p.id] = lv + 1;
        return ok();
      }
      case "toExplore": {
        this.mode = "explore";
        this.afterProgress();
        this.say("info", "探究モードに切り替えました");
        return ok();
      }
      case "godel": {
        const rep = computeGodel(
          [...this.defs.values()],
          this.env,
          (id) => !!this.contracts.get(id)?.cleared,
        );
        if (rep.ok) {
          if (!this.godel?.ok) this.say("good", "ゲーデル文を構成しました。証明ノートが完成です");
          this.godel = rep;
        }
        return rep.ok ? ok("ゲーデル文を構成しました", rep) : fail(rep.error ?? "構成できません");
      }
      case "pause":
        this.paused = cmd.on;
        return ok();
    }
  }

  private pushUndo(u: Command[]) {
    this.undoStack.push(u);
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  private checkName(name: string) {
    if (!NAME_RE.test(name)) throw new TermError("名前は英字で始まる英数字にしてください(例: add)");
    if (["Z", "S", "P", "C", "R", "M"].includes(name)) throw new TermError(`${name} は予約語です`);
    if (this.defs.has(name)) throw new TermError(`${name} は既にあります。別の名前にしてください`);
  }

  inUse(name: string): boolean {
    for (const d of this.defs.values()) if (d.id !== name && refs(d.term).has(name)) return true;
    for (const e of this.world.cells.values()) {
      const f = e.fn;
      if (!f) continue;
      if (
        (f.t === "Ref" && f.id === name) ||
        (f.t === "R" && (f.g === name || f.h === name)) ||
        (f.t === "M" && f.f === name)
      )
        return true;
    }
    return false;
  }

  prestigeNext() {
    const i = Math.min(this.level, PRESTIGE_STEPS.length - 1);
    const s = PRESTIGE_STEPS[i];
    const extra = this.level - i;
    const need = s.need * 3 ** extra;
    return {
      fn: s.fn,
      need,
      have: this.contracts.get(s.fn)?.delivered ?? 0,
      name: extra ? `E${this.level + 1}` : s.name,
    };
  }

  private resetRun() {
    this.world = new World(BASE_SIZE);
    this.qed = new Decimal(START_QED).mul(Decimal.pow(10, this.perk("start")));
    this.tp = 0;
    this.research.clear();
    this.awarded.clear();
    for (const id of this.contracts.keys()) this.contracts.set(id, this.freshContract());
    for (const d of this.defs.values()) {
      d.theorem = false;
      d.native = null;
      d.nativeSchema = null;
    }
    this.buckets = [];
    this.undoStack = [];
    this.ev.clear();
    this.failCache.clear();
    this.afterProgress();
  }

  // ---------------------------------------------------------------- 表示用スナップショット
  meta(): Meta {
    const used = new Set<string>();
    for (const d of this.defs.values()) for (const r of refs(d.term)) used.add(r);
    for (const e of this.world.cells.values()) {
      const f = e.fn;
      if (f?.t === "Ref" && f.id) used.add(f.id);
      if (f?.t === "R") {
        if (f.g) used.add(f.g);
        if (f.h) used.add(f.h);
      }
      if (f?.t === "M" && f.f) used.add(f.f);
    }
    const theoremIds = new Set([...this.defs.values()].filter((d) => d.theorem).map((d) => d.claim));
    return {
      mode: this.mode,
      tick: this.tickNo,
      paused: this.paused,
      qed: this.qed.toString(),
      rate: this.rate().toString(),
      tp: this.tp,
      size: this.world.size,
      bits: this.bits,
      research: [...this.research],
      researchOpen: RESEARCH.filter((r) => this.researchOpen(r.id)).map((r) => r.id),
      builds: this.builds(),
      maxActive: this.maxActive,
      streakNeed: this.streakNeed,
      contracts: [...this.contracts].map(([id, st]) => ({
        id,
        unlocked: this.unlocked(id),
        active: st.active,
        delivered: st.delivered,
        wrong: st.wrong,
        streak: st.streak,
        best: st.best,
        cleared: st.cleared,
        level: st.level,
        ready: st.ready,
        reward: this.rewardOf(id).toString(),
        upCost: this.upCost(id).toString(),
        theorem: theoremIds.has(id),
      })),
      defs: [...this.defs.values()].map((d) => ({
        id: d.id,
        arity: d.arity,
        text: show(d.term, d.holeNames),
        holes: d.holes ?? [],
        holeNames: d.holeNames ?? [],
        origin: d.origin,
        claim: d.claim ?? null,
        verified: !!d.verified,
        theorem: !!d.theorem,
        primrec: !usesMu(d.term, this.env),
        report: d.report ?? null,
        inUse: used.has(d.id),
      })),
      prestige: { level: this.level, axiom: this.axiom, perks: { ...this.perks }, next: this.prestigeNext() },
      log: this.log.slice(-12),
      offline: this.offline,
      godel: this.godel,
      worldVersion: this.world.version,
    };
  }

  entViews(): EntView[] {
    const out: EntView[] = [];
    for (const e of this.world.cells.values()) {
      let label = "";
      let sub: string = e.kind;
      if (e.kind === "fn") {
        const f = e.fn!;
        sub = f.t;
        label =
          f.t === "S"
            ? "S"
            : f.t === "P"
              ? `P${f.n},${f.i}`
              : f.t === "Ref"
                ? (f.id ?? "?")
                : f.t === "R"
                  ? "R"
                  : "μ";
      } else if (e.kind === "in" || e.kind === "out")
        label = e.contract ?? (e.kind === "in" ? `自由${e.arity ?? 1}` : "自由");
      out.push({
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        dir: e.dir,
        label,
        sub,
        ar: e.kind === "in" ? this.portArity(e) : (e.ar ?? 0),
        fn: e.fn,
        contract: e.contract,
        arity: e.arity,
      });
    }
    return out;
  }

  frame(): Frame {
    const toks: { id: number; x: number; y: number; job: number; label: string }[] = [];
    const machines: Frame["machines"] = [];
    const add = (e: Ent, t: Ent["tok"], straight: boolean) => {
      if (!t) return;
      const outDir = straight ? t.d : e.dir;
      let x = e.x + 0.5;
      let y = e.y + 0.5;
      if (e.kind === "belt" || e.kind === "cross") {
        if (t.p < 0.5) {
          x -= DX[t.d] * (0.5 - t.p);
          y -= DY[t.d] * (0.5 - t.p);
        } else {
          x += DX[outDir] * (t.p - 0.5);
          y += DY[outDir] * (t.p - 0.5);
        }
      }
      toks.push({ id: t.id, x, y, job: t.job, label: fmtValue(t.v) });
    };
    for (const e of this.world.cells.values()) {
      if (e.kind === "belt") add(e, e.tok, false);
      else if (e.kind === "cross") {
        add(e, e.tok, true);
        add(e, e.tok2, true);
      } else if (e.kind === "dup" || e.kind === "split") add(e, e.tok, false);
      else if (e.kind === "fn") {
        const total = e.total || 1;
        machines.push({
          id: e.id,
          status: e.status ?? "idle",
          prog: e.res && Number.isFinite(e.busy!) ? 1 - e.busy! / total : 0,
          buf: e.bufs!.reduce((s, b) => s + b.length, 0),
        });
      } else if (e.kind === "in" || e.kind === "out")
        machines.push({ id: e.id, status: "idle", prog: 0, buf: 0, note: e.note, last: e.last });
    }
    const n = toks.length;
    const f: Frame = {
      tick: this.tickNo,
      ids: new Int32Array(n),
      xs: new Float32Array(n),
      ys: new Float32Array(n),
      jobs: new Int32Array(n),
      labels: new Array(n),
      machines,
    };
    toks.forEach((t, i) => {
      f.ids[i] = t.id;
      f.xs[i] = t.x;
      f.ys[i] = t.y;
      f.jobs[i] = t.job;
      f.labels[i] = t.label;
    });
    return f;
  }

  // ---------------------------------------------------------------- セーブ
  serialize(now: number): string {
    return JSON.stringify({
      v: SAVE_VERSION,
      mode: this.mode,
      savedAt: now,
      tick: this.tickNo,
      seed: this.rng.s,
      qed: this.qed.toString(),
      rate: this.rate().toString(),
      tp: this.tp,
      research: [...this.research],
      awarded: [...this.awarded],
      level: this.level,
      axiom: this.axiom,
      perks: this.perks,
      size: this.world.size,
      godel: this.godel,
      ents: [...this.world.cells.values()].map((e) => ({
        kind: e.kind,
        x: e.x,
        y: e.y,
        dir: e.dir,
        fn: e.fn,
        contract: e.contract,
        arity: e.arity,
      })),
      defs: [...this.defs.values()].map((d) => ({
        id: d.id,
        src: show(d.term, d.holeNames),
        holes: d.holes ?? [],
        holeNames: d.holeNames ?? [],
        origin: d.origin,
        claim: d.claim ?? null,
        verified: !!d.verified,
      })),
      contracts: Object.fromEntries(
        [...this.contracts].map(([id, s]) => [
          id,
          { a: s.active, d: s.delivered, w: s.wrong, b: s.best, c: s.cleared, l: s.level, r: s.ready },
        ]),
      ),
    });
  }

  static load(json: string, now: number, catalog: CatalogFn[] = ALL_CATALOG): Game {
    const s = JSON.parse(json);
    if (typeof s !== "object" || s === null || s.v !== SAVE_VERSION)
      throw new Error("セーブデータの形式が違います");
    const g = new Game(s.mode === "explore" ? "explore" : "factory", s.seed ?? 1, catalog);
    g.tickNo = s.tick ?? 0;
    g.qed = new Decimal(s.qed ?? START_QED);
    g.savedRate = new Decimal(s.rate ?? 0);
    g.tp = s.tp ?? 0;
    g.research = new Set(s.research ?? []);
    g.awarded = new Set(s.awarded ?? []);
    g.level = s.level ?? 0;
    g.axiom = s.axiom ?? 0;
    g.perks = s.perks ?? {};
    g.godel = s.godel ?? null;
    for (const d of s.defs ?? []) {
      try {
        const term: Term = parseTerm(d.src, d.holeNames ?? [], d.holes ?? []);
        const arity = check(term, g.env, d.holes ?? []);
        g.defs.set(d.id, {
          id: d.id,
          arity,
          term,
          origin: d.origin ?? "text",
          holes: d.holes?.length ? d.holes : undefined,
          holeNames: d.holeNames ?? [],
          claim: d.claim,
          verified: d.verified,
        });
      } catch {
        g.say("warn", `関数 ${d.id} を読み込めませんでした`);
      }
    }
    for (const [id, c] of Object.entries<any>(s.contracts ?? {})) {
      const st = g.contracts.get(id);
      if (!st) continue;
      Object.assign(st, {
        active: !!c.a,
        delivered: c.d ?? 0,
        wrong: c.w ?? 0,
        best: c.b ?? 0,
        cleared: !!c.c,
        level: c.l ?? 0,
        ready: !!c.r,
      });
    }
    g.world = new World(s.size ?? BASE_SIZE);
    for (const e of s.ents ?? []) if (g.world.inBounds(e.x, e.y)) g.world.place(e);
    g.log = [];
    g.afterProgress();
    g.log = [];
    const elapsed = Math.min((now - (s.savedAt ?? now)) / 1000, g.offlineCapHours * 3600);
    if (!g.explore && elapsed > 60 && g.savedRate.gt(0)) {
      const gain = g.savedRate.mul(elapsed * OFFLINE_EFFICIENCY);
      g.qed = g.qed.add(gain);
      g.offline = { seconds: Math.floor(elapsed), gain: gain.toString() };
    }
    return g;
  }
}
