// UI 側の状態。シミュレーションの状態は Worker が持ち、ここにはその写しと操作状態だけを置く。
import { create } from "zustand";
import type { BuildId } from "../data/balance";
import type { CmdResult, Command, EntView, Frame, Meta, Mode } from "../sim/game";
import type { Dir, FnSpec } from "../sim/world";
import type { FromWorker, ToWorker } from "../worker/protocol";

export interface Tool {
  build: BuildId;
  fn?: FnSpec;
  contract?: string | null;
  arity?: number;
}

export type Panel = null | "contracts" | "library" | "research" | "notes" | "settings" | "prestige" | "help";

interface UiState {
  ready: boolean;
  hasGame: boolean;
  meta: Meta | null;
  ents: EntView[];
  size: number;
  tool: Tool | null;
  dir: Dir;
  selected: { x: number; y: number } | null;
  panel: Panel;
  focusContract: string | null;
  toast: { kind: "info" | "good" | "warn"; text: string; at: number } | null;
  dark: boolean;
  set: (p: Partial<UiState>) => void;
}

export const useUi = create<UiState>((set) => ({
  ready: false,
  hasGame: false,
  meta: null,
  ents: [],
  size: 32,
  tool: null,
  dir: 0,
  selected: null,
  panel: null,
  focusContract: null,
  toast: null,
  dark: false,
  set: (p) => set(p),
}));

/** 最新フレーム。毎 tick 変わるので React の状態には入れない */
export const live: { frame: Frame | null; prev: Frame | null; at: number } = {
  frame: null,
  prev: null,
  at: 0,
};

let worker: Worker;
let seq = 1;
const pending = new Map<number, (r: any) => void>();

export function boot() {
  worker = new Worker(new URL("../worker/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    switch (m.t) {
      case "ready":
        useUi.setState({ ready: true, hasGame: m.hasGame, selected: null, tool: null });
        if (!m.hasGame) useUi.setState({ meta: null, ents: [] });
        break;
      case "meta":
        useUi.setState({ meta: m.meta });
        break;
      case "world":
        useUi.setState({ ents: m.ents, size: m.size });
        break;
      case "frame":
        live.prev = live.frame;
        live.frame = m.frame;
        live.at = performance.now();
        break;
      case "result":
        pending.get(m.id)?.(m.result);
        pending.delete(m.id);
        break;
      case "exported":
        pending.get(m.id)?.(m.data);
        pending.delete(m.id);
        break;
    }
  };
  send({ t: "init" });
  if (import.meta.env.DEV) (window as any).__cfi = { cmd, useUi, live };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) send({ t: "save" });
  });
}

export function send(m: ToWorker) {
  worker.postMessage(m);
}

export function toast(kind: "info" | "good" | "warn", text: string) {
  useUi.setState({ toast: { kind, text, at: Date.now() } });
}

/** コマンドを送り、失敗したら理由をトースト表示する */
export function cmd(c: Command, quiet = false): Promise<CmdResult> {
  return new Promise((resolve) => {
    const id = seq++;
    pending.set(id, (r: CmdResult) => {
      if (!quiet) {
        if (!r.ok && r.error) toast("warn", r.error);
        else if (r.info) toast(r.data?.ok === false ? "warn" : "good", r.info);
      }
      resolve(r);
    });
    send({ t: "cmd", id, cmd: c });
  });
}

export function exportSave(): Promise<string> {
  return new Promise((resolve) => {
    const id = seq++;
    pending.set(id, resolve);
    send({ t: "export", id });
  });
}

export function importSave(data: string): Promise<CmdResult> {
  return new Promise((resolve) => {
    const id = seq++;
    pending.set(id, resolve);
    send({ t: "import", id, data });
  });
}

export function newGame(mode: Mode) {
  send({ t: "new", mode });
}
