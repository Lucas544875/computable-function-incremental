import type { CmdResult, Command, EntView, Frame, Meta, Mode } from "../sim/game";

export type ToWorker =
  | { t: "init" }
  | { t: "new"; mode: Mode }
  | { t: "cmd"; id: number; cmd: Command }
  | { t: "save" }
  | { t: "export"; id: number }
  | { t: "import"; id: number; data: string }
  | { t: "wipe" };

export type FromWorker =
  | { t: "ready"; hasGame: boolean }
  | { t: "meta"; meta: Meta }
  | { t: "world"; ents: EntView[]; size: number }
  | { t: "frame"; frame: Frame }
  | { t: "result"; id: number; result: CmdResult }
  | { t: "exported"; id: number; data: string };
