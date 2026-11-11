import { useEffect, useState } from "react";
import { boardable } from "../core/catalog";
import { CATALOG } from "../data/all";
import type { EntView } from "../sim/game";
import type { FnSpec } from "../sim/world";
import { BUILD_NAMES } from "./Hud";
import { cmd, live, useUi } from "./store";

const STATUS: Record<string, string> = {
  idle: "待機中",
  busy: "計算中",
  wait: "入力待ち(同じ伝票の値が全ポートに揃うのを待っている)",
  blocked: "出力先が詰まっている",
  runaway: "暴走中(止まらない計算)",
  invalid: "設定が済んでいない、またはアリティが合わない",
};

function useLive(id: number | undefined) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  return id === undefined ? undefined : live.frame?.machines.find((m) => m.id === id);
}

export function Inspector() {
  const sel = useUi((s) => s.selected);
  const ents = useUi((s) => s.ents);
  const meta = useUi((s) => s.meta)!;
  const set = useUi((s) => s.set);
  const [name, setName] = useState("");
  const v: EntView | undefined = sel ? ents.find((e) => e.x === sel.x && e.y === sel.y) : undefined;
  const m = useLive(v?.id);
  if (!sel || !v) return null;
  const build = v.kind === "fn" ? (v.sub as keyof typeof BUILD_NAMES) : v.kind;
  const info = BUILD_NAMES[build];
  const fns = meta.defs.filter((d) => d.holes.length === 0);
  const setFn = (fn: FnSpec) => cmd({ c: "config", x: v.x, y: v.y, fn });
  const f = v.fn;
  const arityOf = (id: string | null) => fns.find((d) => d.id === id)?.arity;
  const options = (pred: (a: number) => boolean) => [
    <option key="" value="">
      (未選択)
    </option>,
    ...fns
      .filter((d) => pred(d.arity))
      .map((d) => (
        <option key={d.id} value={d.id}>
          {d.id}({d.arity} 引数){d.theorem ? " 定理" : ""}
        </option>
      )),
  ];
  const contracts = meta.contracts.filter((c) => c.unlocked && boardable(CATALOG.get(c.id)!));

  return (
    <div className="inspector border">
      <h4>
        {info.name}{" "}
        <span className="muted small">
          ({v.x}, {v.y})
        </span>
      </h4>
      <p className="small">{info.desc}</p>

      {f?.t === "P" && (
        <>
          <label>
            入力の数 n
            <select
              value={f.n}
              onChange={(e) =>
                setFn({ t: "P", n: Number(e.target.value), i: Math.min(f.i, Number(e.target.value)) })
              }
            >
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            通す番号 i
            <select value={f.i} onChange={(e) => setFn({ t: "P", n: f.n, i: Number(e.target.value) })}>
              {Array.from({ length: f.n }, (_, i) => i + 1).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </>
      )}
      {f?.t === "Ref" && (
        <label>
          関数
          <select value={f.id ?? ""} onChange={(e) => setFn({ t: "Ref", id: e.target.value || null })}>
            {options((a) => a <= 3)}
          </select>
        </label>
      )}
      {f?.t === "R" && (
        <>
          <label>
            g(n = 0 のとき。k 引数)
            <select value={f.g ?? ""} onChange={(e) => setFn({ ...f, g: e.target.value || null })}>
              {options((a) => a <= 2)}
            </select>
          </label>
          <label>
            h(くり返し。k + 2 引数: x…, n, 前の値)
            <select value={f.h ?? ""} onChange={(e) => setFn({ ...f, h: e.target.value || null })}>
              {options((a) => a >= 2 && a <= 4)}
            </select>
          </label>
          {f.g && f.h && arityOf(f.h) !== (arityOf(f.g) ?? 0) + 2 && (
            <p className="text-danger small">
              g が {arityOf(f.g)} 引数なら h は {(arityOf(f.g) ?? 0) + 2} 引数が必要です。
            </p>
          )}
          <p className="small muted">
            入力は x…, n の順(後ろ = 1、左 = 2、右 = 3)。最後の入力が回数 n です。
          </p>
        </>
      )}
      {f?.t === "M" && (
        <>
          <label>
            f(k + 1 引数: x…, y)
            <select value={f.f ?? ""} onChange={(e) => setFn({ ...f, f: e.target.value || null })}>
              {options((a) => a >= 1 && a <= 4)}
            </select>
          </label>
          <label>
            打ち切りステップ数(0 = 打ち切らない)
            <input
              type="number"
              min={0}
              step={1000}
              value={f.cutoff}
              onChange={(e) => setFn({ ...f, cutoff: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        </>
      )}
      {(v.kind === "in" || v.kind === "out") && (
        <label>
          契約
          <select
            value={v.contract ?? ""}
            onChange={(e) => cmd({ c: "config", x: v.x, y: v.y, contract: e.target.value || null })}
          >
            <option value="">自由(契約なし)</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {CATALOG.get(c.id)!.title}({c.id})
              </option>
            ))}
          </select>
        </label>
      )}
      {v.kind === "in" && !v.contract && (
        <label>
          引数の数(試し用の小さい値を流す)
          <select
            value={v.arity ?? 1}
            onChange={(e) => cmd({ c: "config", x: v.x, y: v.y, arity: Number(e.target.value) })}
          >
            {[1, 2, 3].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
      {v.kind === "in" && v.contract && !meta.contracts.find((c) => c.id === v.contract)?.active && (
        <p className="text-warning small">この契約は稼働していないので、引数は流れません。</p>
      )}

      {v.kind === "fn" && m && (
        <p className={`small ${m.status === "runaway" || m.status === "invalid" ? "text-danger" : ""}`}>
          状態: {STATUS[m.status]}
          {m.buf > 0 ? `(入力待ち ${m.buf} 個)` : ""}
        </p>
      )}
      {(v.kind === "in" || v.kind === "out") && m?.last && m.last.length > 0 && (
        <p className="small">直近の値: {m.last.join(", ")}</p>
      )}

      {v.kind === "out" && meta.research.includes("encap") && (
        <>
          <label>
            カプセル化(ここに届くまでの配線を関数にする)
            <input
              type="text"
              placeholder="関数の名前(例: add)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="row-btns">
            <button
              type="button"
              className="btn-small btn-secondary"
              onClick={async () => {
                const r = await cmd({ c: "encapsulate", x: v.x, y: v.y, name: name.trim() });
                if (r.ok) {
                  setName("");
                  set({ panel: "library" });
                }
              }}
            >
              カプセル化
            </button>
          </div>
        </>
      )}

      <div className="row-btns">
        <button type="button" className="btn-small" onClick={() => cmd({ c: "rotate", x: v.x, y: v.y })}>
          回転
        </button>
        {v.kind === "fn" && (
          <button
            type="button"
            className="btn-small"
            onClick={() => cmd({ c: "resetMachine", x: v.x, y: v.y })}
          >
            リセット
          </button>
        )}
        <button
          type="button"
          className="btn-small btn-danger"
          onClick={() => {
            cmd({ c: "remove", x: v.x, y: v.y });
            set({ selected: null });
          }}
        >
          撤去
        </button>
      </div>
    </div>
  );
}
