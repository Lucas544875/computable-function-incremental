import { useMemo, useState } from "react";
import { parseDef } from "../core/parse";
import { check, type FnDef, TermError } from "../core/term";
import type { VerifyReport } from "../core/verify";
import { CATALOG } from "../data/all";
import type { DefView } from "../sim/game";
import { cmd, useUi } from "./store";

export function Report({ r }: { r: VerifyReport }) {
  if (r.ok)
    return (
      <p className="text-success small">
        検査に合格({r.passed} 件、{r.steps.toLocaleString()} ステップ)
      </p>
    );
  if (r.message) return <p className="text-danger small">不合格: {r.message}</p>;
  const c = r.counter!;
  return (
    <p className="text-danger small">
      不合格。最小の反例: 引数 ({c.args.join(", ")}){c.probe ? `、装着した関数: ${c.probe}` : ""} → 期待{" "}
      {c.expected}、実際 {c.actual}
    </p>
  );
}

function Editor() {
  const meta = useUi((s) => s.meta)!;
  const [src, setSrc] = useState("");
  const env = useMemo(() => {
    const m = new Map<string, FnDef>(
      meta.defs.map((d) => [
        d.id,
        { id: d.id, arity: d.arity, term: { kind: "Z" }, holes: d.holes.length ? d.holes : undefined },
      ]),
    );
    return { get: (id: string) => m.get(id) };
  }, [meta.defs]);
  let status = "";
  let ok = false;
  if (src.trim()) {
    try {
      const d = parseDef(src);
      if (meta.defs.some((x) => x.id === d.name)) throw new TermError(`${d.name} は既にあります`);
      const a = check(d.term, env, d.holes);
      status = `${d.name}: ${a} 引数${d.holes.length ? `、スロット ${d.holes.length} 個の図式` : ""}`;
      ok = true;
    } catch (e) {
      status = e instanceof TermError ? e.message : String(e);
    }
  }
  return (
    <div className="item border">
      <h4>項エディタ</h4>
      <p className="small muted">
        例: <code>mult = R(C[1](Z;), C(add; P[3,1], P[3,3]))</code>。定数は <code>C[k](Z;)</code>
        (k 引数の 0)。
        {meta.research.includes("schema") && (
          <>
            {" "}
            図式は <code>名前&lt;f/2&gt; = …</code>、使うときは <code>名前&lt;関数&gt;</code>。
          </>
        )}
      </p>
      <textarea
        rows={2}
        value={src}
        onChange={(e) => setSrc(e.target.value)}
        placeholder="名前 = 項"
        spellCheck={false}
      />
      <div className="row-btns">
        <button
          type="button"
          className="btn-small btn-secondary"
          disabled={!ok}
          onClick={async () => {
            if ((await cmd({ c: "define", src })).ok) setSrc("");
          }}
        >
          登録
        </button>
        <span className={`small ${ok ? "text-success" : "text-danger"}`}>{status}</span>
      </div>
    </div>
  );
}

function DefCard({ d }: { d: DefView }) {
  const meta = useUi((s) => s.meta)!;
  const set = useUi((s) => s.set);
  const focus = useUi((s) => s.focusContract);
  const candidates = meta.contracts.filter((c) => {
    const cat = CATALOG.get(c.id)!;
    return c.unlocked && cat.arity === d.arity && !!cat.schema === d.holes.length > 0;
  });
  const pickDefault = () => {
    if (d.claim) return d.claim;
    const has = (id: string | null | undefined) => !!id && candidates.some((c) => c.id === id);
    const active = candidates.find((c) => c.active)?.id;
    if (has(active)) return active as string;
    if (has(focus)) return focus as string;
    return (
      (candidates.find((c) => !c.cleared) ?? candidates.find((c) => !c.theorem) ?? candidates[0])?.id ?? ""
    );
  };
  const [target, setTarget] = useState(pickDefault);
  const [args, setArgs] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const head = d.holes.length
    ? `${d.id}<${d.holeNames.map((n, i) => `${n}/${d.holes[i]}`).join(", ")}>`
    : d.id;
  return (
    <div className="item border">
      <div className="line">
        <h4 style={{ margin: 0 }}>{head}</h4>
        <span className="muted small">{d.arity} 引数</span>
        {d.theorem && <span className="badge secondary">定理化済み({d.claim})</span>}
        {!d.theorem && d.verified && <span className="badge success">検査済み({d.claim})</span>}
        <span className="badge">{d.primrec ? "原始帰納的" : "μ を含む"}</span>
        <span className="spacer" />
        {d.holes.length === 0 && d.arity <= 3 && meta.builds.includes("Ref") && (
          <button
            type="button"
            className="btn-small"
            onClick={() =>
              set({ tool: { build: "Ref", fn: { t: "Ref", id: d.id } }, panel: null, selected: null })
            }
          >
            盤面に置く
          </button>
        )}
        <button
          type="button"
          className="btn-small btn-danger"
          disabled={d.inUse}
          title={d.inUse ? "ほかの関数か機械が使っています" : ""}
          onClick={() => cmd({ c: "deleteDef", name: d.id })}
        >
          削除
        </button>
      </div>
      <p className="term">{d.text}</p>
      {!d.theorem && candidates.length > 0 && (
        <div className="row-btns">
          <span className="small">契約に対して検査:</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "auto" }}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {CATALOG.get(c.id)!.title}({c.id})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-small btn-secondary"
            disabled={busy || !target}
            onClick={async () => {
              setBusy(true);
              await cmd({ c: "claim", name: d.id, id: target });
              setBusy(false);
            }}
          >
            {busy ? "検査中…" : "検査する"}
          </button>
        </div>
      )}
      {d.report && <Report r={d.report} />}
      {d.verified && !d.theorem && meta.mode === "factory" && (
        <p className="small muted">
          定理化するには、契約 {d.claim} で {meta.streakNeed} 回連続で正解してください(最高{" "}
          {meta.contracts.find((c) => c.id === d.claim)?.best ?? 0} 回)。
        </p>
      )}
      {d.holes.length === 0 && (
        <div className="row-btns">
          <span className="small">試し実行:</span>
          <input
            type="text"
            style={{ width: "9rem" }}
            placeholder={Array.from({ length: d.arity }, (_, i) => i + 1).join(", ") || "引数なし"}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
          <button
            type="button"
            className="btn-small"
            onClick={async () => {
              const list = args.trim() ? args.split(/[,\s]+/).filter(Boolean) : [];
              const r = await cmd({ c: "testRun", name: d.id, args: list }, true);
              if (!r.ok) setResult(r.error ?? "");
              else if (r.data.fail)
                setResult(
                  r.data.fail === "budget"
                    ? `予算内に停止せず(${r.data.cost.toLocaleString()} ステップ)`
                    : "値が大きすぎます",
                );
              else setResult(`= ${r.data.value}(${r.data.cost.toLocaleString()} ステップ)`);
            }}
          >
            実行
          </button>
          <span className="small">{result}</span>
        </div>
      )}
    </div>
  );
}

export function Library() {
  const meta = useUi((s) => s.meta)!;
  return (
    <>
      <div className="head">
        <h2>関数ライブラリ</h2>
        <span className="muted small">カプセル化・定義した関数。ほかの関数や帰納炉・探索塔の部品になる</span>
      </div>
      {meta.research.includes("editor") ? (
        <Editor />
      ) : (
        <p className="muted small">
          項エディタは研究で解禁されます。それまでは盤面の納品港から「カプセル化」で登録します。
        </p>
      )}
      {meta.defs.length === 0 && <p>まだ関数がありません。</p>}
      {[...meta.defs].reverse().map((d) => (
        <DefCard key={d.id} d={d} />
      ))}
    </>
  );
}
