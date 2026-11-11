// 項のテキスト記法 ⇄ 項。例: mult = R(C[1](Z;), C(add; P[3,1], P[3,3]))
import { type Term, TermError } from "./term";

const RESERVED = new Set(["Z", "S", "P", "C", "R", "M"]);
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Tok = { t: "id" | "num" | "p"; v: string; at: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s+|([A-Za-z_][A-Za-z0-9_]*)|(\d+)|([()[\],;<>=/μ])/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new TermError(`${i + 1} 文字目の「${src[i]}」は読めません`);
    if (m[1]) out.push({ t: "id", v: m[1], at: i });
    else if (m[2]) out.push({ t: "num", v: m[2], at: i });
    else if (m[3]) out.push({ t: "p", v: m[3], at: i });
    i = re.lastIndex;
  }
  return out;
}

class Parser {
  i = 0;
  constructor(
    private toks: Tok[],
    private holeNames: string[],
    private holeArities: number[],
  ) {}
  peek() {
    return this.toks[this.i];
  }
  eat(v: string) {
    const t = this.toks[this.i];
    if (!t || t.v !== v) throw new TermError(`「${v}」が必要です(${t ? `「${t.v}」の位置` : "末尾"})`);
    this.i++;
  }
  num(): number {
    const t = this.toks[this.i];
    if (t?.t !== "num") throw new TermError("数が必要です");
    this.i++;
    return Number(t.v);
  }
  term(): Term {
    const t = this.toks[this.i++];
    if (!t) throw new TermError("項が途中で終わっています");
    if (t.t !== "id" && t.v !== "μ") throw new TermError(`「${t.v}」の位置に項が必要です`);
    switch (t.v) {
      case "Z":
        return { kind: "Z" };
      case "S":
        return { kind: "S" };
      case "P": {
        this.eat("[");
        const n = this.num();
        this.eat(",");
        const i = this.num();
        this.eat("]");
        return { kind: "P", n, i };
      }
      case "C": {
        let n = -1;
        if (this.peek()?.v === "[") {
          this.eat("[");
          n = this.num();
          this.eat("]");
        }
        this.eat("(");
        const f = this.term();
        this.eat(";");
        const gs: Term[] = [];
        while (this.peek() && this.peek().v !== ")") {
          gs.push(this.term());
          if (this.peek()?.v === ",") this.i++;
          else break;
        }
        this.eat(")");
        return { kind: "C", f, gs, n };
      }
      case "R": {
        this.eat("(");
        const g = this.term();
        this.eat(",");
        const h = this.term();
        this.eat(")");
        return { kind: "R", g, h };
      }
      case "M":
      case "μ": {
        this.eat("(");
        const f = this.term();
        this.eat(")");
        return { kind: "M", f };
      }
    }
    const hi = this.holeNames.indexOf(t.v);
    if (hi >= 0) return { kind: "H", i: hi, n: this.holeArities[hi] };
    if (this.peek()?.v === "<") {
      this.i++;
      const fs: Term[] = [this.term()];
      while (this.peek()?.v === ",") {
        this.i++;
        fs.push(this.term());
      }
      this.eat(">");
      return { kind: "App", id: t.v, fs };
    }
    return { kind: "Ref", id: t.v };
  }
}

export function parseTerm(src: string, holeNames: string[] = [], holeArities: number[] = []): Term {
  const p = new Parser(lex(src), holeNames, holeArities);
  const t = p.term();
  if (p.peek()) throw new TermError(`「${p.peek().v}」以降が余分です`);
  return t;
}

export interface ParsedDef {
  name: string;
  holeNames: string[];
  holes: number[];
  term: Term;
}

/** `name = term` または図式 `name<f/2, g/1> = term` */
export function parseDef(src: string): ParsedDef {
  const eq = src.indexOf("=");
  if (eq < 0) throw new TermError("「名前 = 項」の形で書いてください");
  const head = lex(src.slice(0, eq));
  const name = head[0]?.v ?? "";
  if (!NAME_RE.test(name)) throw new TermError("名前は英字で始まる英数字にしてください");
  if (RESERVED.has(name)) throw new TermError(`${name} は予約語です`);
  const holeNames: string[] = [];
  const holes: number[] = [];
  let i = 1;
  if (head[i]?.v === "<") {
    i++;
    while (head[i] && head[i].v !== ">") {
      const hn = head[i++];
      if (hn.t !== "id" || RESERVED.has(hn.v)) throw new TermError("スロット名が不正です");
      if (head[i]?.v !== "/" || head[i + 1]?.t !== "num")
        throw new TermError(`スロットは ${hn.v}/2 のようにアリティを付けてください`);
      holeNames.push(hn.v);
      holes.push(Number(head[i + 1].v));
      i += 2;
      if (head[i]?.v === ",") i++;
    }
    if (head[i]?.v !== ">") throw new TermError("「>」が必要です");
    i++;
  }
  if (head[i]) throw new TermError(`「${head[i].v}」が余分です`);
  return { name, holeNames, holes, term: parseTerm(src.slice(eq + 1), holeNames, holes) };
}
