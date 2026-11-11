import { useState } from "react";
import type { GodelReport } from "../course/final";
import { EQ_AXIOMS, Q_AXIOMS } from "../course/godel";
import { NOTE_LINES, SYSTEM_NOTES, THEOREM } from "../course/notes";
import { CATALOG } from "../data/all";
import { cmd, useUi } from "./store";

function big(s: string): string {
  if (s.length <= 9) return Number(s).toLocaleString("ja-JP");
  return `約 ${s[0]}.${s.slice(1, 3)} × 10^${s.length - 1}`;
}

function Result({ r }: { r: GodelReport }) {
  return (
    <div className="item border border-secondary">
      <p>
        あなたの <code>{r.diagName}</code> と <code>{r.prfName}</code> から、ゲーデル文 G を構成しました。
      </p>
      <ul className="small">
        <li>D(対角化を表現する論理式): {big(r.sizeD)} 記号</li>
        <li>F(証明関係を表現する論理式): {big(r.sizeF)} 記号</li>
        <li>
          A(v) = ∀v'(D → B): {big(r.sizeA)} 記号。v は {big(r.occurrences)} か所に自由に現れる
        </li>
        <li>
          G = A(num(⌜A⌝)): {r.exact ? "" : "およそ "}
          {big(r.sizeG)} 記号。ゲーデル数は約 {big(r.bitsG)} ビット
        </li>
      </ul>
      {r.exact ? (
        <p className="small">
          A の冒頭: <span className="term">{r.preview}</span>
        </p>
      ) : (
        <p className="small muted">
          A は大きすぎて書き下せませんが、記号数は正確に計算されています(共有される部分を 1
          回だけ数える方法による)。G の記号数は数項の長さを見積もった概算です。
        </p>
      )}
    </div>
  );
}

export function Notes() {
  const meta = useUi((s) => s.meta)!;
  const set = useUi((s) => s.set);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const state = new Map(meta.contracts.map((c) => [c.id, c]));
  const done = (ids: string[] = []) => ids.every((id) => state.get(id)?.cleared);
  const buildDone = NOTE_LINES.filter((l) => l.kind === "構成").every((l) =>
    l.final ? !!meta.godel?.ok : done(l.needs),
  );
  const g0 = state.get("bsum");
  return (
    <>
      <div className="head">
        <h2>証明ノート</h2>
        <span className="muted small">算術化による第一不完全性定理の証明</span>
      </div>
      <div className="item border border-thick">
        <b>定理</b> {THEOREM}
      </div>
      {!g0?.unlocked && (
        <p className="small muted">
          このコースは、契約「素数判定」を達成して研究「図式」を解禁すると始まります。それまでは本編(T0〜T2)を進めてください。
        </p>
      )}
      <p className="small">
        「構成」の行は、あなたが実際に関数を作って検査に合格すると埋まります。「引用」の行はメタ数学の論証で、ゲームが検査できるのは計算だけなので、補題として引用します。
      </p>
      {NOTE_LINES.map((l, i) => {
        const ok = l.kind === "構成" ? (l.final ? !!meta.godel?.ok : done(l.needs)) : buildDone;
        return (
          <div className="note-line" key={l.title}>
            <span className="no">{i + 1}</span>
            <div className="body">
              <div className="line">
                <b>{l.title}</b>
                <span
                  className={`badge ${l.kind === "構成" ? "secondary" : l.kind === "引用" ? "" : "success"}`}
                >
                  {l.kind}
                </span>
                {l.kind === "構成" && (
                  <span className={`badge ${ok ? "success" : "warning"}`}>{ok ? "構成済み" : "未達"}</span>
                )}
                {l.kind !== "構成" && ok && <span className="badge success">成立</span>}
              </div>
              <p className="small">{l.body}</p>
              {l.needs && (
                <div className="row-btns" style={{ marginTop: 0 }}>
                  {l.needs.map((id) => {
                    const c = state.get(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`btn-small ${c?.cleared ? "btn-success" : ""}`}
                        disabled={!c?.unlocked}
                        title={CATALOG.get(id)?.def}
                        onClick={() => set({ panel: "contracts", focusContract: id })}
                      >
                        {id}
                        {c?.cleared ? " ✓" : c?.unlocked ? "" : "(未解禁)"}
                      </button>
                    );
                  })}
                </div>
              )}
              {l.final && (
                <>
                  <div className="row-btns">
                    <button
                      type="button"
                      className="btn-small btn-secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const r = await cmd({ c: "godel" }, true);
                        setErr(r.ok ? "" : (r.error ?? ""));
                        setBusy(false);
                      }}
                    >
                      {busy ? "構成中…" : "ゲーデル文を構成する"}
                    </button>
                    <span className="small text-danger">{err}</span>
                  </div>
                  {meta.godel?.ok && <Result r={meta.godel} />}
                </>
              )}
            </div>
          </div>
        );
      })}
      {buildDone && (
        <div className="alert alert-success" style={{ marginTop: "0.8rem" }}>
          証明ノートが完成しました。あなたの関数だけで、証明も反証もできない文が 1 つ確定しています。
        </div>
      )}

      <h3 style={{ marginTop: "1.2rem" }}>体系の定義</h3>
      <p className="small">{SYSTEM_NOTES.language}</p>
      {SYSTEM_NOTES.grammar.map((s) => (
        <p className="term" key={s}>
          {s}
        </p>
      ))}
      <p className="small">{SYSTEM_NOTES.coding}</p>
      <p className="small">{SYSTEM_NOTES.numerals}</p>
      <h4>論理公理と推論規則</h4>
      {[...SYSTEM_NOTES.logic, ...EQ_AXIOMS.map((a, i) => `E${i + 1}  ${a}`), ...SYSTEM_NOTES.rules].map(
        (s) => (
          <p className="term" key={s}>
            {s}
          </p>
        ),
      )}
      <h4>Q の公理</h4>
      {Q_AXIOMS.map((a, i) => (
        <p className="term" key={a}>
          Q{i + 1} {a}
        </p>
      ))}
      <h4>翻訳 repr の規則</h4>
      {SYSTEM_NOTES.repr.map((s) => (
        <p className="term small" key={s}>
          {s}
        </p>
      ))}
      <p className="small muted" style={{ marginTop: "0.8rem" }}>
        {SYSTEM_NOTES.caveat}
      </p>
    </>
  );
}
