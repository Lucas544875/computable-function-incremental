// 不完全性コースの参照実装: 記号列の符号化、Robinson 算術 Q の構文、証明検査。仕様書 §4.12
//
// 形式言語(13 記号): 0 S + · = ¬ → ∀ ( ) v ' #
//   項    t ::= 0 | v'…' | St | (t+t) | (t·t)
//   論理式 A ::= t=t | ¬A | (A→B) | ∀xA
// 記号列のゲーデル数は全単射 13 進法(各記号が 1〜13 の桁、空列が 0)。

export const SYMS = ["0", "S", "+", "·", "=", "¬", "→", "∀", "(", ")", "v", "'", "#"];
const DIGIT = new Map(SYMS.map((s, i) => [s, BigInt(i + 1)]));

export function enc(s: string): bigint {
  let n = 0n;
  for (const ch of s) {
    const d = DIGIT.get(ch);
    if (d === undefined) throw new Error(`記号ではありません: ${ch}`);
    n = n * 13n + d;
  }
  return n;
}

export function dec(n: bigint): string {
  const out: string[] = [];
  while (n > 0n) {
    let d = n % 13n;
    if (d === 0n) d = 13n;
    out.push(SYMS[Number(d) - 1]);
    n = (n - d) / 13n;
  }
  return out.reverse().join("");
}

// ---------------------------------------------------------------- 構文木
export type T = { k: "0" } | { k: "v"; i: number } | { k: "S"; a: T } | { k: "+" | "·"; a: T; b: T };
export type F =
  | { k: "="; a: T; b: T }
  | { k: "¬"; a: F }
  | { k: "→"; a: F; b: F }
  | { k: "∀"; x: number; a: F };

export const varStr = (i: number) => `v${"'".repeat(i)}`;

export function tStr(t: T): string {
  switch (t.k) {
    case "0":
      return "0";
    case "v":
      return varStr(t.i);
    case "S":
      return `S${tStr(t.a)}`;
    default:
      return `(${tStr(t.a)}${t.k}${tStr(t.b)})`;
  }
}
export function fStr(f: F): string {
  switch (f.k) {
    case "=":
      return `${tStr(f.a)}=${tStr(f.b)}`;
    case "¬":
      return `¬${fStr(f.a)}`;
    case "→":
      return `(${fStr(f.a)}→${fStr(f.b)})`;
    case "∀":
      return `∀${varStr(f.x)}${fStr(f.a)}`;
  }
}

type Res<X> = { v: X; i: number } | null;

function pTerm(s: string, i: number): Res<T> {
  const c = s[i];
  if (c === "0") return { v: { k: "0" }, i: i + 1 };
  if (c === "v") {
    let j = i + 1;
    while (s[j] === "'") j++;
    return { v: { k: "v", i: j - i - 1 }, i: j };
  }
  if (c === "S") {
    // 数項 SSS…0 が深くなるので、S の列は反復で読む
    let j = i;
    while (s[j] === "S") j++;
    const inner = pTerm(s, j);
    if (!inner) return null;
    let t = inner.v;
    for (let n = j - i; n > 0; n--) t = { k: "S", a: t };
    return { v: t, i: inner.i };
  }
  if (c === "(") {
    const a = pTerm(s, i + 1);
    if (!a) return null;
    const op = s[a.i];
    if (op !== "+" && op !== "·") return null;
    const b = pTerm(s, a.i + 1);
    if (!b || s[b.i] !== ")") return null;
    return { v: { k: op, a: a.v, b: b.v }, i: b.i + 1 };
  }
  return null;
}

function pFormula(s: string, i: number): Res<F> {
  const c = s[i];
  if (c === "¬") {
    const a = pFormula(s, i + 1);
    return a && { v: { k: "¬", a: a.v }, i: a.i };
  }
  if (c === "∀") {
    const x = pTerm(s, i + 1);
    if (x?.v.k !== "v") return null;
    const a = pFormula(s, x.i);
    return a && { v: { k: "∀", x: x.v.i, a: a.v }, i: a.i };
  }
  const a = pTerm(s, i);
  if (a && s[a.i] === "=") {
    const b = pTerm(s, a.i + 1);
    return b && { v: { k: "=", a: a.v, b: b.v }, i: b.i };
  }
  if (c === "(") {
    const l = pFormula(s, i + 1);
    if (!l || s[l.i] !== "→") return null;
    const r = pFormula(s, l.i + 1);
    if (!r || s[r.i] !== ")") return null;
    return { v: { k: "→", a: l.v, b: r.v }, i: r.i + 1 };
  }
  return null;
}

export function parseT(s: string): T | null {
  const r = pTerm(s, 0);
  return r && r.i === s.length ? r.v : null;
}
export function parseF(s: string): F | null {
  const r = pFormula(s, 0);
  return r && r.i === s.length ? r.v : null;
}

// ---------------------------------------------------------------- 変数と代入
function tVars(t: T, out: Set<number>) {
  if (t.k === "v") out.add(t.i);
  else if (t.k === "S") tVars(t.a, out);
  else if (t.k !== "0") {
    tVars(t.a, out);
    tVars(t.b, out);
  }
}
export function freeVars(f: F, bound: number[] = [], out = new Set<number>()): Set<number> {
  switch (f.k) {
    case "=": {
      const vs = new Set<number>();
      tVars(f.a, vs);
      tVars(f.b, vs);
      for (const v of vs) if (!bound.includes(v)) out.add(v);
      break;
    }
    case "¬":
      freeVars(f.a, bound, out);
      break;
    case "→":
      freeVars(f.a, bound, out);
      freeVars(f.b, bound, out);
      break;
    case "∀":
      freeVars(f.a, [...bound, f.x], out);
  }
  return out;
}

function tSubst(t: T, x: number, r: T): T {
  switch (t.k) {
    case "0":
      return t;
    case "v":
      return t.i === x ? r : t;
    case "S":
      return { k: "S", a: tSubst(t.a, x, r) };
    default:
      return { k: t.k, a: tSubst(t.a, x, r), b: tSubst(t.b, x, r) };
  }
}
/** 自由な x を r に置き換える(束縛の衝突は調べない) */
export function fSubst(f: F, x: number, r: T): F {
  switch (f.k) {
    case "=":
      return { k: "=", a: tSubst(f.a, x, r), b: tSubst(f.b, x, r) };
    case "¬":
      return { k: "¬", a: fSubst(f.a, x, r) };
    case "→":
      return { k: "→", a: fSubst(f.a, x, r), b: fSubst(f.b, x, r) };
    case "∀":
      return f.x === x ? f : { k: "∀", x: f.x, a: fSubst(f.a, x, r) };
  }
}
/** r は f の中の x に代入可能か(r の変数が束縛されないか) */
export function substitutable(f: F, x: number, r: T): boolean {
  const rv = new Set<number>();
  tVars(r, rv);
  const go = (g: F, bound: number[]): boolean => {
    switch (g.k) {
      case "=": {
        const vs = new Set<number>();
        tVars(g.a, vs);
        tVars(g.b, vs);
        return !vs.has(x) || !bound.some((b) => rv.has(b));
      }
      case "¬":
        return go(g.a, bound);
      case "→":
        return go(g.a, bound) && go(g.b, bound);
      case "∀":
        return g.x === x ? true : go(g.a, [...bound, g.x]);
    }
  };
  return go(f, []);
}

/** 2 進の数項。num(0) = 0、num(2n) = (SS0·num(n))、num(2n+1) = S(SS0·num(n)) */
export function numeral(n: bigint): string {
  if (n === 0n) return "0";
  const bits = n.toString(2);
  let s = "0";
  for (const b of bits) s = b === "1" ? `S(SS0·${s})` : `(SS0·${s})`;
  return s;
}

// ---------------------------------------------------------------- 公理と推論規則
export const EQ_AXIOMS = [
  "v=v",
  "(v=v'→(v=v''→v'=v''))",
  "(v=v'→Sv=Sv')",
  "(v=v'→(v+v'')=(v'+v''))",
  "(v=v'→(v''+v)=(v''+v'))",
  "(v=v'→(v·v'')=(v'·v''))",
  "(v=v'→(v''·v)=(v''·v'))",
];
export const Q_AXIOMS = [
  "¬Sv=0",
  "(Sv=Sv'→v=v')",
  "(¬v=0→¬∀v'¬v=Sv')",
  "(v+0)=v",
  "(v+Sv')=S(v+v')",
  "(v·0)=0",
  "(v·Sv')=((v·v')+v)",
];
const EQ_SET = new Set(EQ_AXIOMS);
const Q_SET = new Set(Q_AXIOMS);

/** A の自由な x を何かの項 t に置き換えると B になるか。なるなら t(自由な x がなければ "none") */
function matchInst(a: F, b: F, x: number): T | "none" | null {
  let t: T | null = null;
  const mt = (p: T, q: T): boolean => {
    if (p.k === "v" && p.i === x) {
      if (t === null) {
        t = q;
        return true;
      }
      return tStr(t) === tStr(q);
    }
    if (p.k !== q.k) return false;
    if (p.k === "0") return true;
    if (p.k === "v") return p.i === (q as typeof p).i;
    if (p.k === "S") return mt(p.a, (q as typeof p).a);
    return mt(p.a, (q as typeof p).a) && mt(p.b, (q as typeof p).b);
  };
  const mf = (p: F, q: F): boolean => {
    if (p.k !== q.k) return false;
    switch (p.k) {
      case "=":
        return mt(p.a, (q as typeof p).a) && mt(p.b, (q as typeof p).b);
      case "¬":
        return mf(p.a, (q as typeof p).a);
      case "→":
        return mf(p.a, (q as typeof p).a) && mf(p.b, (q as typeof p).b);
      case "∀":
        if (p.x !== (q as typeof p).x) return false;
        return p.x === x ? fStr(p.a) === fStr((q as typeof p).a) : mf(p.a, (q as typeof p).a);
    }
  };
  if (!mf(a, b)) return null;
  return t ?? "none";
}

export function isLogicAxiomF(f: F): boolean {
  const s = fStr(f);
  if (EQ_SET.has(s)) return true;
  if (f.k !== "→") return false;
  const { a, b } = f;
  // L1: (A→(B→A))
  if (b.k === "→" && fStr(a) === fStr(b.b)) return true;
  // L2: ((A→(B→C))→((A→B)→(A→C)))
  if (a.k === "→" && a.b.k === "→" && b.k === "→" && b.a.k === "→" && b.b.k === "→") {
    const [A, B, Cc] = [fStr(a.a), fStr(a.b.a), fStr(a.b.b)];
    if (fStr(b.a.a) === A && fStr(b.a.b) === B && fStr(b.b.a) === A && fStr(b.b.b) === Cc) return true;
  }
  // L3: ((¬A→¬B)→(B→A))
  if (a.k === "→" && a.a.k === "¬" && a.b.k === "¬" && b.k === "→") {
    if (fStr(a.a.a) === fStr(b.b) && fStr(a.b.a) === fStr(b.a)) return true;
  }
  // L4: (∀xA→A[t/x])、t は x に代入可能
  if (a.k === "∀") {
    const t = matchInst(a.a, b, a.x);
    if (t === "none") return true;
    if (t && substitutable(a.a, a.x, t)) return true;
  }
  // L5: (∀x(A→B)→(A→∀xB))、x は A に自由に現れない
  if (a.k === "∀" && a.a.k === "→" && b.k === "→" && b.b.k === "∀" && b.b.x === a.x) {
    if (fStr(a.a.a) === fStr(b.a) && fStr(a.a.b) === fStr(b.b.a) && !freeVars(b.a).has(a.x)) return true;
  }
  return false;
}

export type Justification =
  | { by: "論理公理" | "Q の公理" }
  | { by: "MP"; from: [number, number] }
  | { by: "汎化"; from: [number] };

/** 証明列(# 区切り)を検査する。各行の根拠を返す。不正なら null と最初の不正行 */
export function checkProof(
  p: string,
): { ok: true; lines: string[]; why: Justification[] } | { ok: false; at: number; lines: string[] } {
  const lines = p.split("#");
  const why: Justification[] = [];
  const parsed: (F | null)[] = lines.map((l) => parseF(l));
  for (let i = 0; i < lines.length; i++) {
    const f = parsed[i];
    if (!f) return { ok: false, at: i, lines };
    if (Q_SET.has(lines[i])) {
      why.push({ by: "Q の公理" });
      continue;
    }
    if (isLogicAxiomF(f)) {
      why.push({ by: "論理公理" });
      continue;
    }
    let found: Justification | null = null;
    if (f.k === "∀") {
      const body = fStr(f.a);
      const j = lines.slice(0, i).indexOf(body);
      if (j >= 0) found = { by: "汎化", from: [j] };
    }
    if (!found) {
      const index = new Map<string, number>();
      for (let j = 0; j < i; j++) if (!index.has(lines[j])) index.set(lines[j], j);
      for (let j = 0; j < i && !found; j++) {
        const k = index.get(`(${lines[j]}→${lines[i]})`);
        if (k !== undefined) found = { by: "MP", from: [j, k] };
      }
    }
    if (!found) return { ok: false, at: i, lines };
    why.push(found);
  }
  return { ok: true, lines, why };
}

// ---------------------------------------------------------------- 符号上の関数(カタログのネイティブ実装)
const B = (b: boolean) => (b ? 1n : 0n);
export const G = {
  len: (x: bigint) => BigInt(dec(x).length),
  at: (x: bigint, i: bigint) => {
    const s = dec(x);
    return i < BigInt(s.length) ? DIGIT.get(s[Number(i)])! : 0n;
  },
  concat: (x: bigint, y: bigint) => enc(dec(x) + dec(y)),
  slice: (x: bigint, i: bigint, j: bigint) => {
    const s = dec(x);
    const n = BigInt(s.length);
    const a = i < n ? Number(i) : s.length;
    const b = j < n ? Number(j) : s.length;
    return enc(s.slice(a, Math.max(a, b)));
  },
  occurs: (x: bigint, y: bigint) => B(dec(y).includes(dec(x))),
  num: (n: bigint) => enc(numeral(n)),
  is_var: (x: bigint) => B(/^v'*$/.test(dec(x))),
  is_term: (x: bigint) => B(parseT(dec(x)) !== null),
  is_formula: (x: bigint) => B(parseF(dec(x)) !== null),
  is_free: (x: bigint, a: bigint) => {
    const xs = dec(x);
    const f = parseF(dec(a));
    return B(/^v'*$/.test(xs) && !!f && freeVars(f).has(xs.length - 1));
  },
  subst: (a: bigint, x: bigint, t: bigint) => {
    const xs = dec(x);
    const f = parseF(dec(a));
    const r = parseT(dec(t));
    if (!f || !r || !/^v'*$/.test(xs)) return a;
    return enc(fStr(fSubst(f, xs.length - 1, r)));
  },
  is_logic_axiom: (a: bigint) => {
    const f = parseF(dec(a));
    return B(!!f && isLogicAxiomF(f));
  },
  is_q_axiom: (a: bigint) => B(Q_SET.has(dec(a))),
  mp: (a: bigint, b: bigint, c: bigint) => {
    const [as, bs, cs] = [dec(a), dec(b), dec(c)];
    return B(!!parseF(as) && !!parseF(cs) && bs === `(${as}→${cs})`);
  },
  gen: (a: bigint, c: bigint) => {
    const [as, cs] = [dec(a), dec(c)];
    const f = parseF(cs);
    return B(!!parseF(as) && !!f && f.k === "∀" && fStr(f.a) === as);
  },
  prf: (p: bigint, a: bigint) => {
    const ps = dec(p);
    const r = checkProof(ps);
    return B(r.ok && r.lines[r.lines.length - 1] === dec(a));
  },
  beta: (c: bigint, d: bigint, i: bigint) => c % (1n + (i + 1n) * d),
  diag: (x: bigint) => G.subst(x, enc("v"), G.num(x)),
  /** 不動点: D(v, v') と B(v) から、A(v) = ∀v'(D→B[v'/v]) の対角化 A(⌜A⌝) の符号を作る */
  fix: (d: bigint, b: bigint) => {
    const ds = dec(d);
    const bf = parseF(dec(b));
    if (!parseF(ds) || !bf) return 0n;
    const a = `∀v'(${ds}→${fStr(fSubst(bf, 0, { k: "v", i: 1 }))})`;
    return G.diag(enc(a));
  },
};
