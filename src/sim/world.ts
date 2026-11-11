// 盤面: グリッド、機械、ベルト、トークン。仕様書 §4.1, §4.2, §7.1
import type { Term } from "../core/term";

export type Dir = 0 | 1 | 2 | 3; // 0=東 1=南 2=西 3=北
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
export const opp = (d: number): Dir => ((d + 2) % 4) as Dir;
export const turn = (d: number, by: number): Dir => ((d + by + 4) % 4) as Dir;

export type Kind = "belt" | "cross" | "zero" | "fn" | "dup" | "split" | "trash" | "in" | "out";

export type FnSpec =
  | { t: "S" }
  | { t: "P"; n: number; i: number }
  | { t: "Ref"; id: string | null }
  | { t: "R"; g: string | null; h: string | null }
  | { t: "M"; f: string | null; cutoff: number };

export interface Token {
  id: number;
  v: bigint;
  /** 伝票。-1 は伝票なし */
  job: number;
  /** セル内の進み 0..1 */
  p: number;
  /** 進入時の進行方向 */
  d: Dir;
}

export type Status = "idle" | "busy" | "wait" | "blocked" | "runaway" | "invalid";

export interface Ent {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  dir: Dir;
  fn?: FnSpec;
  /** 入力港・納品港: 紐づく契約(null は自由ポート) */
  contract?: string | null;
  /** 自由な入力港のアリティ */
  arity?: number;
  // ---- 実行時状態(保存しない)
  tok?: Token | null;
  tok2?: Token | null;
  bufs?: Token[][];
  out?: Token | null;
  busy?: number;
  total?: number;
  res?: { v: bigint | null; job: number } | null;
  status?: Status;
  note?: string;
  rr?: number;
  timer?: number;
  last?: string[];
  /** fn: 検査済みの項とアリティ(-1 は未設定・不正) */
  term?: Term | null;
  ar?: number;
}

export interface EvalOutcome {
  value: bigint | null;
  ticks: number;
  runaway?: boolean;
}

export interface Hooks {
  evalFn(e: Ent, args: bigint[]): EvalOutcome;
  /** 入力港: 引数の組と伝票を発行する。出せないなら null */
  emit(e: Ent): { args: bigint[]; job: number } | null;
  deliver(e: Ent, t: Token): void;
  portArity(e: Ent): number;
}

export interface Tuning {
  beltSpeed: number;
  bufCap: number;
  zeroPeriod: number;
  inPeriod: number;
}

/** 進行方向 d で入ってくるトークンが繋がる入力ポート番号(なければ -1)。後ろ=0、左=1、右=2 */
export function portOf(e: Ent, d: number): number {
  const rel = (d - e.dir + 4) % 4;
  return rel === 0 ? 0 : rel === 1 ? 1 : rel === 3 ? 2 : -1;
}
/** ポート番号 → その入力がある側(機械から見た方向) */
export function portSide(e: Ent, port: number): Dir {
  return port === 0 ? opp(e.dir) : port === 1 ? turn(e.dir, 3) : turn(e.dir, 1);
}
/** 入力港の第 j 出力の方向。前=1 番目、左=2 番目、右=3 番目 */
export function inPortDir(e: Ent, j: number): Dir {
  return j === 0 ? e.dir : j === 1 ? turn(e.dir, 3) : turn(e.dir, 1);
}

export class World {
  cells = new Map<number, Ent>();
  private nextId = 1;
  private tokSeq = 1;
  private order: Ent[] | null = null;
  version = 0;
  constructor(public size: number) {}

  key(x: number, y: number) {
    return y * 4096 + x;
  }
  at(x: number, y: number): Ent | undefined {
    return this.cells.get(this.key(x, y));
  }
  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }
  neighbor(e: Ent, d: number): Ent | undefined {
    return this.at(e.x + DX[d], e.y + DY[d]);
  }

  place(spec: Pick<Ent, "kind" | "x" | "y" | "dir" | "fn" | "contract" | "arity">): Ent {
    const e: Ent = { ...spec, id: this.nextId++ };
    if (e.fn) e.fn = { ...e.fn };
    this.resetRuntime(e);
    this.cells.set(this.key(e.x, e.y), e);
    this.dirty();
    return e;
  }
  remove(x: number, y: number): Ent | undefined {
    const e = this.at(x, y);
    if (e) {
      this.cells.delete(this.key(x, y));
      this.dirty();
    }
    return e;
  }
  dirty() {
    this.order = null;
    this.version++;
  }
  resetRuntime(e: Ent) {
    e.tok = null;
    e.tok2 = null;
    e.bufs = [[], [], []];
    e.out = null;
    e.busy = 0;
    e.total = 0;
    e.res = null;
    e.status = "idle";
    e.rr = 0;
    e.timer = 0;
    e.last = [];
  }
  clearTokens() {
    for (const e of this.cells.values()) this.resetRuntime(e);
  }

  mkTok(v: bigint, job: number): Token {
    return { id: this.tokSeq++, v, job, p: 0, d: 0 };
  }

  /** e は進行方向 d のトークンを(満杯かどうかは別として)受け取れる形か */
  connectable(e: Ent | undefined, d: number): boolean {
    if (!e) return false;
    switch (e.kind) {
      case "belt":
        return d !== opp(e.dir);
      case "cross":
      case "trash":
      case "out":
        return true;
      case "fn": {
        const p = portOf(e, d);
        return p >= 0 && p < (e.ar ?? -1);
      }
      case "dup":
      case "split":
        return d === e.dir;
      default:
        return false;
    }
  }

  canAccept(e: Ent | undefined, d: number, cap: number): boolean {
    if (!e || !this.connectable(e, d)) return false;
    switch (e.kind) {
      case "belt":
      case "dup":
      case "split":
        return !e.tok;
      case "cross":
        return d % 2 === 0 ? !e.tok : !e.tok2;
      case "fn":
        return e.bufs![portOf(e, d)].length < cap;
      default:
        return true;
    }
  }

  private push(e: Ent, d: Dir, t: Token, hooks: Hooks) {
    t.p = 0;
    t.d = d;
    switch (e.kind) {
      case "belt":
      case "dup":
      case "split":
        e.tok = t;
        break;
      case "cross":
        if (d % 2 === 0) e.tok = t;
        else e.tok2 = t;
        break;
      case "fn":
        e.bufs![portOf(e, d)].push(t);
        break;
      case "out":
        hooks.deliver(e, t);
        break;
    }
  }

  /** 全入力ポートに同じ伝票(または伝票なし)のトークンが揃っていれば取り出す */
  private match(e: Ent): { args: bigint[]; job: number } | null {
    const ar = e.ar ?? -1;
    const bufs = e.bufs!;
    if (ar === 0) return { args: [], job: -1 };
    for (let p = 0; p < ar; p++) if (bufs[p].length === 0) return null;
    const jobs = new Set<number>();
    for (let p = 0; p < ar; p++) for (const t of bufs[p]) if (t.job >= 0) jobs.add(t.job);
    const candidates = jobs.size ? [...jobs] : [-1];
    for (const job of candidates) {
      const idx: number[] = [];
      for (let p = 0; p < ar; p++) {
        let i = bufs[p].findIndex((t) => t.job === job);
        if (i < 0) i = bufs[p].findIndex((t) => t.job < 0);
        if (i < 0) break;
        idx.push(i);
      }
      if (idx.length === ar) {
        const args = idx.map((i, p) => bufs[p].splice(i, 1)[0].v);
        return { args, job };
      }
    }
    return null;
  }

  private beltOrder(): Ent[] {
    if (this.order) return this.order;
    const out: Ent[] = [];
    const seen = new Set<number>();
    const visit = (e: Ent) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      if (e.kind === "belt") {
        const n = this.neighbor(e, e.dir);
        if (n && (n.kind === "belt" || n.kind === "cross")) visit(n);
      }
      out.push(e);
    };
    const all = [...this.cells.values()].filter((e) => e.kind === "belt" || e.kind === "cross");
    all.sort((a, b) => a.id - b.id);
    for (const e of all) visit(e);
    this.order = out;
    return out;
  }

  tick(hooks: Hooks, tun: Tuning) {
    const cap = tun.bufCap;
    const ents = [...this.cells.values()];
    for (const e of ents) {
      switch (e.kind) {
        case "fn": {
          if (e.out) {
            const n = this.neighbor(e, e.dir);
            if (this.canAccept(n, e.dir, cap)) {
              this.push(n!, e.dir, e.out, hooks);
              e.out = null;
            }
          }
          if (e.res) {
            if (e.busy! > 0) e.busy!--;
            if (e.busy! <= 0 && !e.out) {
              if (e.res.v !== null) e.out = this.mkTok(e.res.v, e.res.job);
              e.res = null;
            }
          }
          if (!e.res && (e.ar ?? -1) >= 0 && !(e.ar === 0 && e.out)) {
            const m = this.match(e);
            if (m) {
              const r = hooks.evalFn(e, m.args);
              e.res = { v: r.value, job: m.job };
              e.busy = r.runaway ? Number.POSITIVE_INFINITY : r.ticks;
              e.total = e.busy;
            }
          }
          e.status =
            (e.ar ?? -1) < 0
              ? "invalid"
              : e.res
                ? e.busy === Number.POSITIVE_INFINITY
                  ? "runaway"
                  : e.busy! > 0
                    ? "busy"
                    : "blocked"
                : e.out
                  ? "blocked"
                  : e.bufs!.some((b) => b.length > 0)
                    ? "wait"
                    : "idle";
          break;
        }
        case "zero": {
          if (e.timer! > 0) e.timer!--;
          if (e.timer! <= 0) {
            const n = this.neighbor(e, e.dir);
            if (this.canAccept(n, e.dir, cap)) {
              this.push(n!, e.dir, this.mkTok(0n, -1), hooks);
              e.timer = tun.zeroPeriod;
            }
          }
          break;
        }
        case "in": {
          if (e.timer! > 0) e.timer!--;
          if (e.timer! <= 0) {
            const k = hooks.portArity(e);
            if (k <= 0) break;
            let ok = true;
            for (let j = 0; j < k; j++) {
              const d = inPortDir(e, j);
              if (!this.canAccept(this.neighbor(e, d), d, cap)) ok = false;
            }
            if (!ok) break;
            const em = hooks.emit(e);
            if (!em) break;
            em.args.forEach((v, j) => {
              const d = inPortDir(e, j);
              this.push(this.neighbor(e, d)!, d, this.mkTok(v, em.job), hooks);
            });
            e.last = em.args.map(String);
            e.timer = tun.inPeriod;
          }
          break;
        }
        case "dup":
        case "split": {
          const t = e.tok;
          if (!t) break;
          const dirs = [e.dir, turn(e.dir, 3), turn(e.dir, 1)].filter((d) =>
            this.connectable(this.neighbor(e, d), d),
          );
          if (!dirs.length) break;
          if (e.kind === "dup") {
            if (dirs.every((d) => this.canAccept(this.neighbor(e, d), d, cap))) {
              for (const d of dirs) this.push(this.neighbor(e, d)!, d, this.mkTok(t.v, t.job), hooks);
              e.tok = null;
            }
          } else {
            for (let i = 0; i < dirs.length; i++) {
              const d = dirs[(e.rr! + i) % dirs.length];
              if (this.canAccept(this.neighbor(e, d), d, cap)) {
                this.push(this.neighbor(e, d)!, d, t, hooks);
                e.tok = null;
                e.rr = (e.rr! + i + 1) % dirs.length;
                break;
              }
            }
          }
          break;
        }
      }
    }
    for (const e of this.beltOrder()) {
      if (e.kind === "belt") {
        const t = e.tok;
        if (!t) continue;
        t.p = Math.min(1, t.p + tun.beltSpeed);
        if (t.p >= 1) {
          const n = this.neighbor(e, e.dir);
          if (this.canAccept(n, e.dir, cap)) {
            e.tok = null;
            this.push(n!, e.dir, t, hooks);
          }
        }
      } else {
        for (const slot of ["tok", "tok2"] as const) {
          const t = e[slot];
          if (!t) continue;
          t.p = Math.min(1, t.p + tun.beltSpeed);
          if (t.p >= 1) {
            const n = this.neighbor(e, t.d);
            if (this.canAccept(n, t.d, cap)) {
              e[slot] = null;
              this.push(n!, t.d, t, hooks);
            }
          }
        }
      }
    }
  }
}
