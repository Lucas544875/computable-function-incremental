// Rough.js で盤面の図形を描き、PixiJS のテクスチャにする。線の設定はここに集約する(仕様書 §5.1)
import { Texture } from "pixi.js";
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Options } from "roughjs/bin/core";
import type { Status } from "../sim/world";

export const CELL = 48;
const T = 128; // テクスチャ 1 枚の解像度
const U = T / 96; // 96 単位の座標系で描く

/** 盤面の全図形に共通の線の設定 */
const LINE: Options = {
  roughness: 1.15,
  bowing: 1.1,
  strokeWidth: 2.3 * U,
  hachureAngle: -41,
  fillWeight: 1.1 * U,
};
const FONT_LABEL = '"Zen Kurenaido", "Klee One", sans-serif';
const FONT_NUM = '"Klee One", "Zen Kurenaido", sans-serif';

export interface Palette {
  ink: string;
  paper: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    ink: v("--primary"),
    paper: v("--main-background"),
    secondary: v("--secondary"),
    success: v("--success"),
    warning: v("--warning"),
    danger: v("--danger"),
    muted: v("--muted"),
  };
}

let pal: Palette;
const cache = new Map<string, Texture>();

export function setPalette(p: Palette) {
  pal = p;
  for (const t of cache.values()) t.destroy(true);
  cache.clear();
}

function make(
  key: string,
  size: number,
  draw: (rc: RoughCanvas, ctx: CanvasRenderingContext2D) => void,
): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  draw(rough.canvas(c), ctx);
  const tex = Texture.from(c);
  cache.set(key, tex);
  return tex;
}

function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}

/** 東向きの座標 (x, y) を dir 向きに回す(96 単位、中心 48) */
function rot(x: number, y: number, dir: number): [number, number] {
  const dx = x - 48;
  const dy = y - 48;
  const r = [
    [dx, dy],
    [-dy, dx],
    [-dx, -dy],
    [dy, -dx],
  ][dir];
  return [(r[0] + 48) * U, (r[1] + 48) * U];
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  px: number,
  font: string,
  color: string,
  maxW = 0,
) {
  let size = px * U;
  ctx.font = `${size}px ${font}`;
  if (maxW) {
    const w = ctx.measureText(s).width;
    if (w > maxW * U) {
      size = Math.max(9 * U, (size * maxW * U) / w);
      ctx.font = `${size}px ${font}`;
    }
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, x * U, y * U);
}

function arrow(rc: RoughCanvas, dir: number, from: number, to: number, o: Options) {
  const [x1, y1] = rot(from, 48, dir);
  const [x2, y2] = rot(to, 48, dir);
  rc.line(x1, y1, x2, y2, o);
  const [ax, ay] = rot(to - 9, 40, dir);
  const [bx, by] = rot(to - 9, 56, dir);
  rc.line(ax, ay, x2, y2, o);
  rc.line(bx, by, x2, y2, o);
}

export function gridTexture(): Texture {
  return make("grid", T, (_rc, ctx) => {
    ctx.strokeStyle = pal.secondary;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0.75, 0);
    ctx.lineTo(0.75, T);
    ctx.moveTo(0, 0.75);
    ctx.lineTo(T, 0.75);
    ctx.stroke();
  });
}

export function beltTexture(dir: number): Texture {
  return make(`belt${dir}`, T, (rc) => {
    const o = { ...LINE, stroke: pal.muted, seed: 11 + dir };
    const [x1, y1] = rot(3, 48, dir);
    const [x2, y2] = rot(93, 48, dir);
    rc.line(x1, y1, x2, y2, o);
    const [tx, ty] = rot(60, 48, dir);
    const [ax, ay] = rot(48, 37, dir);
    const [bx, by] = rot(48, 59, dir);
    rc.line(ax, ay, tx, ty, o);
    rc.line(bx, by, tx, ty, o);
  });
}

export function crossTexture(): Texture {
  return make("cross", T, (rc) => {
    const o = { ...LINE, stroke: pal.muted, seed: 5 };
    rc.line(8 * U, 48 * U, 88 * U, 48 * U, o);
    rc.line(48 * U, 8 * U, 48 * U, 36 * U, o);
    rc.line(48 * U, 60 * U, 48 * U, 88 * U, o);
    rc.arc(48 * U, 48 * U, 24 * U, 24 * U, Math.PI / 2, (Math.PI * 3) / 2, false, o);
  });
}

export interface MachineLook {
  shape: "circle" | "box" | "double" | "tower" | "diamond" | "port-in" | "port-out" | "trash";
  label: string;
  small?: string;
  dir: number;
  /** 入力ポート数(機械)または出力数(入力港) */
  ar: number;
  status: Status;
  variant: number;
}

export function machineTexture(m: MachineLook): Texture {
  const key = `m|${m.shape}|${m.label}|${m.small ?? ""}|${m.dir}|${m.ar}|${m.status}|${m.variant}`;
  return make(key, T, (rc, ctx) => {
    const seed = hash(`${m.shape}${m.label}`) + m.variant * 977;
    const fill =
      m.status === "runaway"
        ? pal.danger
        : m.status === "blocked"
          ? pal.warning
          : m.status === "busy"
            ? pal.ink
            : pal.muted;
    const gap = (m.status === "busy" ? 5.5 : m.status === "idle" || m.status === "wait" ? 11 : 7) * U;
    const base: Options = { ...LINE, stroke: pal.ink, seed };
    const body: Options =
      m.status === "invalid"
        ? { ...base, strokeLineDash: [7 * U, 6 * U], stroke: pal.muted }
        : { ...base, fill, fillStyle: "hachure", hachureGap: gap };
    // 本体
    switch (m.shape) {
      case "circle":
        rc.circle(48 * U, 48 * U, 66 * U, body);
        break;
      case "diamond":
        rc.polygon(
          [
            [48 * U, 12 * U],
            [84 * U, 48 * U],
            [48 * U, 84 * U],
            [12 * U, 48 * U],
          ],
          body,
        );
        break;
      case "trash":
        rc.rectangle(20 * U, 20 * U, 56 * U, 56 * U, { ...base, strokeLineDash: [7 * U, 6 * U] });
        rc.line(30 * U, 30 * U, 66 * U, 66 * U, base);
        rc.line(66 * U, 30 * U, 30 * U, 66 * U, base);
        break;
      default:
        rc.rectangle(14 * U, 14 * U, 68 * U, 68 * U, body);
        if (m.shape === "double" || m.shape === "port-out")
          rc.rectangle(20 * U, 20 * U, 56 * U, 56 * U, { ...base, seed: seed + 1 });
        if (m.shape === "tower") {
          rc.line(14 * U, 14 * U, 48 * U, 3 * U, base);
          rc.line(48 * U, 3 * U, 82 * U, 14 * U, base);
        }
    }
    // 出力の矢印
    const thin: Options = { ...base, strokeWidth: 1.8 * U };
    if (m.shape === "port-in") {
      const outs = [
        [m.dir, "1"],
        [(m.dir + 3) % 4, "2"],
        [(m.dir + 1) % 4, "3"],
      ] as const;
      outs.slice(0, m.ar).forEach(([d, n]) => {
        arrow(rc, d, 83, 95, thin);
        if (m.ar > 1) {
          const [x, y] = rot(89, 31, d);
          text(ctx, n, x / U, y / U, 15, FONT_NUM, pal.secondary);
        }
      });
    } else if (m.shape !== "trash" && m.shape !== "port-out" && m.shape !== "diamond") {
      arrow(rc, m.dir, 83, 95, thin);
    }
    // 入力ポートの番号
    if (
      (m.shape === "circle" || m.shape === "box" || m.shape === "double" || m.shape === "tower") &&
      m.ar >= 2
    ) {
      const sides = [(m.dir + 2) % 4, (m.dir + 3) % 4, (m.dir + 1) % 4];
      for (let p = 0; p < m.ar; p++) {
        const [x, y] = rot(90, 33, sides[p]);
        text(ctx, String(p + 1), x / U, y / U, 15, FONT_NUM, pal.secondary);
      }
    }
    // ラベル(紙色で下地を抜いてから書く)
    if (m.label) {
      const cy = m.small ? 42 : 48;
      ctx.font = `${30 * U}px ${FONT_LABEL}`;
      const w = Math.min(ctx.measureText(m.label).width / U, 58);
      ctx.fillStyle = pal.paper;
      ctx.globalAlpha = 0.85;
      ctx.fillRect((48 - w / 2 - 3) * U, (cy - 15) * U, (w + 6) * U, (m.small ? 42 : 30) * U);
      ctx.globalAlpha = 1;
      text(ctx, m.label, 48, cy, 30, FONT_LABEL, pal.ink, 58);
      if (m.small) text(ctx, m.small, 48, 64, 18, FONT_LABEL, pal.ink, 60);
    }
  });
}

export function tokenTexture(label: string, job: number): Texture {
  const style = job < 0 ? 3 : job % 3;
  if (cache.size > 3000) trimTokens();
  return make(`t|${label}|${style}`, 64, (rc, ctx) => {
    const o: Options = {
      roughness: 0.9,
      strokeWidth: 2.4,
      stroke: style === 3 ? pal.muted : pal.ink,
      seed: hash(label),
    };
    rc.circle(32, 32, 50, {
      ...o,
      fill: pal.paper,
      fillStyle: "solid",
      strokeLineDash: style === 1 ? [6, 5] : undefined,
    });
    if (style === 2) rc.circle(32, 32, 40, { ...o, strokeWidth: 1.4, seed: o.seed! + 3 });
    const n = label.length;
    const px = n <= 2 ? 27 : n === 3 ? 21 : n === 4 ? 17 : 13;
    ctx.font = `600 ${px}px ${FONT_NUM}`;
    ctx.fillStyle = pal.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 32, 33, 44);
  });
}

function trimTokens() {
  // 表示中のスプライトが参照しているかもしれないので破棄はせず、キャッシュから外すだけにする
  for (const k of cache.keys()) if (k.startsWith("t|")) cache.delete(k);
}

/** 盤面で使う文字のフォントを先に読み込む(Canvas への描画は読み込みを待たないため) */
export async function loadFonts() {
  const sample = "入納複分自由μZSPR0123456789abcxyz?,.e";
  await Promise.all([
    document.fonts.load(`30px "Zen Kurenaido"`, sample),
    document.fonts.load(`600 20px "Klee One"`, sample),
    document.fonts.load(`20px "Klee One"`, sample),
  ]).catch(() => undefined);
}
