// 項の符号化(対関数による)と、符号から計算する万能関数の参照実装。T5 と不完全性コース G4 で使う。
//   nil = 0、cons(a, l) = pair(a, l) + 1
//   ⌜Z⌝ = pair(0, 0)、⌜S⌝ = pair(1, 0)、⌜P[n,i]⌝ = pair(2, pair(n, i))
//   ⌜C(f; g…)⌝ = pair(3, pair(⌜f⌝, [⌜g⌝…]))、⌜R(g, h)⌝ = pair(4, pair(⌜g⌝, ⌜h⌝))、⌜M(f)⌝ = pair(5, ⌜f⌝)
import { pair, unpair } from "./catalog";
import type { Term } from "./term";

export function listCode(xs: bigint[]): bigint {
  let l = 0n;
  for (let i = xs.length - 1; i >= 0; i--) l = pair(xs[i], l) + 1n;
  return l;
}
export function listDecode(l: bigint, max = 64): bigint[] {
  const out: bigint[] = [];
  while (l > 0n && out.length < max) {
    const [a, rest] = unpair(l - 1n);
    out.push(a);
    l = rest;
  }
  return out;
}

export function termCode(t: Term): bigint {
  switch (t.kind) {
    case "Z":
      return pair(0n, 0n);
    case "S":
      return pair(1n, 0n);
    case "P":
      return pair(2n, pair(BigInt(t.n), BigInt(t.i)));
    case "C":
      return pair(3n, pair(termCode(t.f), listCode(t.gs.map(termCode))));
    case "R":
      return pair(4n, pair(termCode(t.g), termCode(t.h)));
    case "M":
      return pair(5n, termCode(t.f));
    default:
      throw new Error("参照を含む項は符号化できません(先に展開してください)");
  }
}

/** どの自然数も何かの項(または不正)として読める。不正なタグは null */
export function termDecode(e: bigint, depth = 0): Term | null {
  if (depth > 200) return null;
  const [tag, w] = unpair(e);
  switch (tag) {
    case 0n:
      return w === 0n ? { kind: "Z" } : null;
    case 1n:
      return w === 0n ? { kind: "S" } : null;
    case 2n: {
      const [n, i] = unpair(w);
      if (n > 64n || i > 64n) return null;
      return { kind: "P", n: Number(n), i: Number(i) };
    }
    case 3n: {
      const [f, gl] = unpair(w);
      const ft = termDecode(f, depth + 1);
      const gs = listDecode(gl).map((g) => termDecode(g, depth + 1));
      if (!ft || gs.some((g) => !g)) return null;
      return { kind: "C", f: ft, gs: gs as Term[], n: -1 };
    }
    case 4n: {
      const [g, h] = unpair(w);
      const gt = termDecode(g, depth + 1);
      const ht = termDecode(h, depth + 1);
      return gt && ht ? { kind: "R", g: gt, h: ht } : null;
    }
    case 5n: {
      const ft = termDecode(w, depth + 1);
      return ft ? { kind: "M", f: ft } : null;
    }
    default:
      return null;
  }
}

/** 万能関数 U(e, x): 符号 e の項を、引数リスト x に適用する。足りない引数は 0、不正な符号は 0。止まらなければ null */
export function universal(e: bigint, x: bigint, limit = 3_000_000): bigint | null {
  const t = termDecode(e);
  if (!t) return 0n;
  let steps = 0;
  class Stop extends Error {}
  const ev = (u: Term, a: bigint[]): bigint => {
    if (++steps > limit) throw new Stop();
    switch (u.kind) {
      case "Z":
        return 0n;
      case "S":
        return (a[0] ?? 0n) + 1n;
      case "P":
        return u.i >= 1 ? (a[u.i - 1] ?? 0n) : 0n;
      case "C":
        return ev(
          u.f,
          u.gs.map((g) => ev(g, a)),
        );
      case "R": {
        const n = a.length ? a[a.length - 1] : 0n;
        const xs = a.slice(0, -1);
        let acc = ev(u.g, xs);
        for (let i = 0n; i < n; i++) {
          acc = ev(u.h, [...xs, i, acc]);
          if (++steps > limit) throw new Stop();
        }
        return acc;
      }
      case "M":
        for (let y = 0n; ; y++) if (ev(u.f, [...a, y]) === 0n) return y;
    }
    return 0n;
  };
  try {
    return ev(t, listDecode(x));
  } catch (err) {
    if (err instanceof Stop) return null;
    throw err;
  }
}
