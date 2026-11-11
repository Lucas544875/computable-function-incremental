// シミュレーションを UI スレッドから分離する Worker。固定 20 tick/秒。仕様書 §7.1
import { del, get, set } from "idb-keyval";
import LZString from "lz-string";
import { TPS } from "../data/balance";
import { Game } from "../sim/game";
import type { FromWorker, ToWorker } from "./protocol";

const SAVE_KEY = "cfi-save-v1";
let game: Game | null = null;
let sentMeta = -1;
let sentWorld = -1;
let lastMetaAt = 0;
let acc = 0;
let last = performance.now();

const post = (m: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

function sync(force = false) {
  if (!game) return;
  const now = performance.now();
  if (game.world.version !== sentWorld) {
    sentWorld = game.world.version;
    post({ t: "world", ents: game.entViews(), size: game.world.size });
  }
  if (force || (game.metaVersion !== sentMeta && now - lastMetaAt > 100)) {
    sentMeta = game.metaVersion;
    lastMetaAt = now;
    post({ t: "meta", meta: game.meta() });
    game.offline = null;
  }
}

function frame() {
  if (!game) return;
  const f = game.frame();
  post({ t: "frame", frame: f }, [f.ids.buffer, f.xs.buffer, f.ys.buffer, f.jobs.buffer]);
}

async function save() {
  if (game) await set(SAVE_KEY, game.serialize(Date.now()));
}

function start(g: Game | null) {
  game = g;
  sentMeta = -1;
  sentWorld = -1;
  post({ t: "ready", hasGame: !!g });
  sync(true);
  frame();
}

setInterval(() => {
  const now = performance.now();
  acc = Math.min(acc + (now - last), 250);
  last = now;
  if (!game) return;
  const dt = 1000 / TPS;
  let n = 0;
  while (acc >= dt) {
    acc -= dt;
    game.tick();
    n++;
  }
  if (n) frame();
  sync();
}, 1000 / TPS);

setInterval(save, 30_000);

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.t) {
    case "init": {
      let g: Game | null = null;
      try {
        const raw = await get<string>(SAVE_KEY);
        if (raw) g = Game.load(raw, Date.now());
      } catch (e) {
        console.error("セーブデータを読み込めませんでした", e);
      }
      start(g);
      break;
    }
    case "new":
      start(new Game(m.mode, Date.now() & 0x7fffffff || 1));
      await save();
      break;
    case "cmd": {
      if (!game) break;
      const result = game.exec(m.cmd);
      post({ t: "result", id: m.id, result });
      sync(true);
      break;
    }
    case "save":
      await save();
      break;
    case "export":
      post({
        t: "exported",
        id: m.id,
        data: game ? LZString.compressToBase64(game.serialize(Date.now())) : "",
      });
      break;
    case "import": {
      try {
        const raw = LZString.decompressFromBase64(m.data.trim());
        if (!raw) throw new Error("文字列を展開できません");
        const g = Game.load(raw, Date.now());
        start(g);
        await save();
        post({ t: "result", id: m.id, result: { ok: true, info: "読み込みました" } });
      } catch (e) {
        post({
          t: "result",
          id: m.id,
          result: { ok: false, error: `読み込めません: ${(e as Error).message}` },
        });
      }
      break;
    }
    case "wipe":
      await del(SAVE_KEY);
      start(null);
      break;
  }
};
