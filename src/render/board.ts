// PixiJS による盤面描画と盤面上の操作。仕様書 §5, §7.1
import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import type { BuildId } from "../data/balance";
import type { EntView, Frame } from "../sim/game";
import type { Dir, Status } from "../sim/world";
import { cmd, live, type Tool, useUi } from "../ui/store";
import {
  beltTexture,
  CELL,
  crossTexture,
  gridTexture,
  loadFonts,
  type MachineLook,
  machineTexture,
  readPalette,
  setPalette,
  tokenTexture,
} from "./sketch";

const CONFIGURABLE = new Set<BuildId>(["P", "Ref", "R", "M", "in", "out"]);

function lookOf(
  v: Pick<EntView, "kind" | "sub" | "label" | "dir" | "ar" | "fn">,
  status: Status,
  variant: number,
): MachineLook {
  const base = { dir: v.dir, ar: v.ar, status, variant, label: v.label };
  switch (v.kind) {
    case "zero":
      return { ...base, shape: "circle", label: "Z", ar: 0 };
    case "dup":
      return { ...base, shape: "diamond", label: "複" };
    case "split":
      return { ...base, shape: "diamond", label: "分" };
    case "trash":
      return { ...base, shape: "trash", label: "" };
    case "in":
      return { ...base, shape: "port-in", label: "入", small: v.label };
    case "out":
      return { ...base, shape: "port-out", label: "納", small: v.label };
  }
  const f = v.fn;
  if (f?.t === "R") return { ...base, shape: "double", label: "R", small: `${f.g ?? "?"}, ${f.h ?? "?"}` };
  if (f?.t === "M") return { ...base, shape: "tower", label: "μ", small: f.f ?? "?" };
  if (f?.t === "Ref") return { ...base, shape: "box" };
  return { ...base, shape: "circle" };
}

function toolView(t: Tool, dir: Dir): Pick<EntView, "kind" | "sub" | "label" | "dir" | "ar" | "fn"> {
  const b = t.build;
  if (b === "S") return { kind: "fn", sub: "S", label: "S", dir, ar: 1, fn: { t: "S" } };
  if (b === "P") {
    const f = t.fn?.t === "P" ? t.fn : { t: "P" as const, n: 2, i: 1 };
    return { kind: "fn", sub: "P", label: `P${f.n},${f.i}`, dir, ar: f.n, fn: f };
  }
  if (b === "Ref")
    return {
      kind: "fn",
      sub: "Ref",
      label: t.fn?.t === "Ref" ? (t.fn.id ?? "?") : "?",
      dir,
      ar: 1,
      fn: t.fn ?? { t: "Ref", id: null },
    };
  if (b === "R")
    return { kind: "fn", sub: "R", label: "R", dir, ar: 2, fn: t.fn ?? { t: "R", g: null, h: null } };
  if (b === "M")
    return { kind: "fn", sub: "M", label: "μ", dir, ar: 1, fn: t.fn ?? { t: "M", f: null, cutoff: 10000 } };
  return {
    kind: b as EntView["kind"],
    sub: b,
    label: b === "in" || b === "out" ? (t.contract ?? "自由") : "",
    dir,
    ar: b === "in" ? (t.arity ?? 1) : 0,
  };
}

export class Board {
  app = new Application();
  private root = new Container();
  private grid!: TilingSprite;
  private border = new Graphics();
  private entLayer = new Container();
  private tokLayer = new Container();
  private fx = new Graphics();
  private ghost = new Sprite();
  private sprites = new Map<number, { s: Sprite; v: EntView; key: string }>();
  private toks: Sprite[] = [];
  private prevPos = new Map<number, number>();
  private ents: EntView[] = [];
  private size = 32;
  private hover: { x: number; y: number } | null = null;
  private drag: null | {
    mode: "place" | "remove" | "pan";
    lastCell: { x: number; y: number } | null;
    sx: number;
    sy: number;
    moved: boolean;
  } = null;
  private keys = new Set<string>();
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private destroyed = false;
  private unsub: (() => void)[] = [];

  async init(host: HTMLElement) {
    await loadFonts();
    await this.app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    if (this.destroyed) return;
    host.appendChild(this.app.canvas);
    setPalette(readPalette());
    this.grid = new TilingSprite({ texture: gridTexture(), width: 10, height: 10 });
    this.grid.tileScale.set(CELL / 128);
    this.ghost.alpha = 0.45;
    this.ghost.visible = false;
    this.root.addChild(this.grid, this.border, this.entLayer, this.tokLayer, this.ghost, this.fx);
    this.app.stage.addChild(this.root);
    this.root.position.set(60, 90);
    this.bind(host);
    this.app.ticker.add(() => this.update());
    const st = useUi.getState();
    this.setWorld(st.ents, st.size);
    this.unsub.push(
      useUi.subscribe((s, p) => {
        if (s.ents !== p.ents || s.size !== p.size) this.setWorld(s.ents, s.size);
        if (s.dark !== p.dark) requestAnimationFrame(() => this.retheme());
      }),
    );
  }

  destroy() {
    this.destroyed = true;
    for (const u of this.unsub) u();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* 初期化前に破棄された */
    }
  }

  private retheme() {
    // 古いテクスチャを破棄する前に、すべてのスプライトから外す
    for (const rec of this.sprites.values()) {
      rec.s.texture = Texture.EMPTY;
      rec.key = "";
    }
    for (const t of this.toks) {
      t.texture = Texture.EMPTY;
      t.label = "";
    }
    this.ghost.texture = Texture.EMPTY;
    this.grid.texture = Texture.EMPTY;
    setPalette(readPalette());
    palCache = null;
    this.grid.texture = gridTexture();
    this.setWorld(this.ents, this.size);
  }

  setWorld(ents: EntView[], size: number) {
    this.ents = ents;
    this.size = size;
    this.grid.width = size * CELL;
    this.grid.height = size * CELL;
    const p = readPalette();
    this.border
      .clear()
      .rect(0, 0, size * CELL, size * CELL)
      .stroke({ width: 2, color: p.ink, alpha: 0.5 });
    const alive = new Set<number>();
    for (const v of ents) {
      alive.add(v.id);
      const key = `${v.kind}|${v.sub}|${v.label}|${v.dir}|${v.ar}|${JSON.stringify(v.fn ?? 0)}`;
      let rec = this.sprites.get(v.id);
      if (!rec) {
        const s = new Sprite();
        s.width = CELL;
        s.height = CELL;
        this.entLayer.addChild(s);
        rec = { s, v, key: "" };
        this.sprites.set(v.id, rec);
      }
      rec.v = v;
      rec.s.position.set(v.x * CELL, v.y * CELL);
      if (rec.key !== key) {
        rec.key = key;
        rec.s.texture = this.texOf(v, v.kind === "fn" && v.ar < 0 ? "invalid" : "idle", 0);
        rec.s.width = CELL;
        rec.s.height = CELL;
      }
    }
    for (const [id, rec] of this.sprites)
      if (!alive.has(id)) {
        rec.s.destroy();
        this.sprites.delete(id);
      }
  }

  private texOf(
    v: Pick<EntView, "kind" | "sub" | "label" | "dir" | "ar" | "fn">,
    status: Status,
    variant: number,
  ) {
    if (v.kind === "belt") return beltTexture(v.dir);
    if (v.kind === "cross") return crossTexture();
    return machineTexture(lookOf(v, status, variant));
  }

  // ------------------------------------------------------------ 毎フレーム
  private update() {
    const now = performance.now();
    const pan = 12 / this.root.scale.x;
    if (this.keys.has("a") || this.keys.has("arrowleft")) this.root.x += pan;
    if (this.keys.has("d") || this.keys.has("arrowright")) this.root.x -= pan;
    if (this.keys.has("w") || this.keys.has("arrowup")) this.root.y += pan;
    if (this.keys.has("s") || this.keys.has("arrowdown")) this.root.y -= pan;

    const f = live.frame;
    const p = readPaletteCached();
    this.fx.clear();
    if (f) {
      this.drawTokens(f, now);
      const wobble = this.reduced ? 0 : Math.floor(now / 260) % 3;
      for (const m of f.machines) {
        const rec = this.sprites.get(m.id);
        if (!rec) continue;
        if (rec.v.kind === "fn") {
          const status: Status = rec.v.ar < 0 ? "invalid" : m.status;
          const tex = this.texOf(rec.v, status, status === "busy" ? wobble : 0);
          if (rec.s.texture !== tex) {
            rec.s.texture = tex;
            rec.s.width = CELL;
            rec.s.height = CELL;
          }
          if (m.status === "busy" && m.prog > 0) {
            const x = rec.v.x * CELL + 8;
            const y = rec.v.y * CELL + CELL - 5;
            this.fx
              .moveTo(x, y)
              .lineTo(x + (CELL - 16) * m.prog, y)
              .stroke({ width: 3, color: p.secondary });
          }
          if (m.buf > 0) {
            for (let i = 0; i < Math.min(m.buf, 6); i++)
              this.fx.circle(rec.v.x * CELL + 8 + i * 6, rec.v.y * CELL + 6, 2).fill(p.ink);
          }
        } else if (rec.v.kind === "out" && m.note) {
          this.fx
            .rect(rec.v.x * CELL + 3, rec.v.y * CELL + 3, CELL - 6, CELL - 6)
            .stroke({ width: 2, color: m.note === "ok" ? p.success : p.danger, alpha: 0.9 });
        }
      }
    }
    const ui = useUi.getState();
    // 選択枠
    if (ui.selected) {
      const { x, y } = ui.selected;
      this.fx.rect(x * CELL - 2, y * CELL - 2, CELL + 4, CELL + 4).stroke({ width: 2.5, color: p.secondary });
    }
    // 設置プレビュー
    if (
      ui.tool &&
      this.hover &&
      this.hover.x >= 0 &&
      this.hover.y >= 0 &&
      this.hover.x < this.size &&
      this.hover.y < this.size
    ) {
      const tex = this.texOf(toolView(ui.tool, ui.dir), "idle", 0);
      if (this.ghost.texture !== tex) this.ghost.texture = tex;
      this.ghost.width = CELL;
      this.ghost.height = CELL;
      this.ghost.position.set(this.hover.x * CELL, this.hover.y * CELL);
      this.ghost.visible = true;
    } else this.ghost.visible = false;
  }

  private drawTokens(f: Frame, now: number) {
    const prev = live.prev;
    const a = Math.min(1, (now - live.at) / 50);
    if (prev && prev !== this.lastPrev) {
      this.prevPos.clear();
      for (let i = 0; i < prev.ids.length; i++) this.prevPos.set(prev.ids[i], i);
      this.lastPrev = prev;
    }
    const n = f.ids.length;
    while (this.toks.length < n) {
      const s = new Sprite();
      s.anchor.set(0.5);
      this.tokLayer.addChild(s);
      this.toks.push(s);
    }
    for (let i = 0; i < this.toks.length; i++) {
      const s = this.toks[i];
      if (i >= n) {
        s.visible = false;
        continue;
      }
      let x = f.xs[i];
      let y = f.ys[i];
      const pi = prev ? this.prevPos.get(f.ids[i]) : undefined;
      if (pi !== undefined && prev) {
        const px = prev.xs[pi];
        const py = prev.ys[pi];
        if (Math.abs(px - x) + Math.abs(py - y) < 1.6) {
          x = px + (x - px) * a;
          y = py + (y - py) * a;
        }
      }
      const key = `${f.labels[i]}|${f.jobs[i] < 0 ? 3 : f.jobs[i] % 3}`;
      if (s.label !== key) {
        s.label = key;
        s.texture = tokenTexture(f.labels[i], f.jobs[i]);
        s.width = 30;
        s.height = 30;
      }
      s.visible = true;
      s.position.set(x * CELL, y * CELL);
    }
  }
  private lastPrev: Frame | null = null;

  // ------------------------------------------------------------ 操作
  private cellAt(clientX: number, clientY: number) {
    const r = this.app.canvas.getBoundingClientRect();
    const wx = (clientX - r.left - this.root.x) / this.root.scale.x;
    const wy = (clientY - r.top - this.root.y) / this.root.scale.y;
    return { x: Math.floor(wx / CELL), y: Math.floor(wy / CELL) };
  }
  private entAt(c: { x: number; y: number }) {
    return this.ents.find((e) => e.x === c.x && e.y === c.y);
  }

  private placeAt(c: { x: number; y: number }, dir: Dir) {
    const ui = useUi.getState();
    const t = ui.tool;
    if (!t) return;
    cmd({
      c: "place",
      build: t.build,
      x: c.x,
      y: c.y,
      dir,
      fn: t.fn,
      contract: t.contract,
      arity: t.arity,
    }).then((r) => {
      if (r.ok && CONFIGURABLE.has(t.build)) useUi.setState({ selected: { x: c.x, y: c.y } });
    });
  }

  private bind(host: HTMLElement) {
    const cv = this.app.canvas;
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      const c = this.cellAt(e.clientX, e.clientY);
      const ui = useUi.getState();
      const base = { lastCell: c, sx: e.clientX, sy: e.clientY, moved: false };
      if (e.button === 2) {
        this.drag = { mode: "remove", ...base };
        if (this.entAt(c)) cmd({ c: "remove", x: c.x, y: c.y });
        else if (ui.tool) useUi.setState({ tool: null });
        else useUi.setState({ selected: null });
      } else if (e.button === 1 || !ui.tool) {
        this.drag = { mode: "pan", ...base };
      } else {
        this.drag = { mode: "place", ...base };
        this.placeAt(c, ui.dir);
      }
    });
    cv.addEventListener("pointermove", (e) => {
      const c = this.cellAt(e.clientX, e.clientY);
      this.hover = c;
      const d = this.drag;
      if (!d) return;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
      if (d.mode === "pan") {
        this.root.x += e.movementX;
        this.root.y += e.movementY;
        return;
      }
      const lc = d.lastCell!;
      if (c.x === lc.x && c.y === lc.y) return;
      // 飛ばしたマスも 1 マスずつ処理する
      let { x, y } = lc;
      let guard = 0;
      while ((x !== c.x || y !== c.y) && guard++ < 200) {
        const dx = c.x - x;
        const dy = c.y - y;
        let dir: Dir;
        if (Math.abs(dx) >= Math.abs(dy)) {
          dir = dx > 0 ? 0 : 2;
          x += Math.sign(dx);
        } else {
          dir = dy > 0 ? 1 : 3;
          y += Math.sign(dy);
        }
        if (d.mode === "remove") cmd({ c: "remove", x, y });
        else {
          const ui = useUi.getState();
          if (ui.tool?.build === "belt") {
            useUi.setState({ dir });
            cmd(
              { c: "place", build: "belt", x: x - [1, 0, -1, 0][dir], y: y - [0, 1, 0, -1][dir], dir },
              true,
            );
            this.placeAt({ x, y }, dir);
          } else this.placeAt({ x, y }, ui.dir);
        }
      }
      d.lastCell = c;
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (d?.mode === "pan" && !d.moved && e.button === 0) {
        const c = this.cellAt(e.clientX, e.clientY);
        useUi.setState({ selected: this.entAt(c) ? c : null });
      }
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", () => {
      this.drag = null;
    });
    cv.addEventListener("pointerleave", () => {
      this.hover = null;
    });
    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const old = this.root.scale.x;
        const next = Math.min(2.5, Math.max(0.25, old * Math.exp(-e.deltaY * 0.0015)));
        this.root.x = mx - ((mx - this.root.x) * next) / old;
        this.root.y = my - ((my - this.root.y) * next) / old;
        this.root.scale.set(next);
      },
      { passive: false },
    );
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    void host;
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const ui = useUi.getState();
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      cmd({ c: "undo" });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (ui.panel) {
      if (k === "escape") useUi.setState({ panel: null });
      return;
    }
    this.keys.add(k);
    if (k === "r") {
      if (ui.tool) useUi.setState({ dir: ((ui.dir + 1) % 4) as Dir });
      else if (ui.selected) cmd({ c: "rotate", ...ui.selected });
      else if (this.hover && this.entAt(this.hover)) cmd({ c: "rotate", ...this.hover });
    } else if (k === "q") {
      const v = this.hover && this.entAt(this.hover);
      if (v) {
        const build = (v.kind === "fn" ? v.sub : v.kind) as BuildId;
        useUi.setState({
          tool: { build, fn: v.fn, contract: v.contract, arity: v.arity },
          dir: v.dir,
          selected: null,
        });
      } else useUi.setState({ tool: null });
    } else if (k === "escape") {
      useUi.setState(ui.tool ? { tool: null } : { selected: null });
    } else if ((k === "delete" || k === "backspace") && ui.selected) {
      cmd({ c: "remove", ...ui.selected });
      useUi.setState({ selected: null });
    }
  };
}

let palCache: ReturnType<typeof readPalette> | null = null;
let palAt = 0;
function readPaletteCached() {
  const now = performance.now();
  if (!palCache || now - palAt > 1000) {
    palCache = readPalette();
    palAt = now;
  }
  return palCache;
}
