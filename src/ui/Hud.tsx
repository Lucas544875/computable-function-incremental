import { useEffect, useState } from "react";
import { boardable } from "../core/catalog";
import { CATALOG } from "../data/all";
import { type BuildId, PRICES } from "../data/balance";
import { fmt, fmtTime } from "./format";
import { cmd, importSave, newGame, type Tool, useUi } from "./store";

export const BUILD_NAMES: Record<BuildId, { name: string; mark: string; desc: string }> = {
  belt: { name: "ベルト", mark: "→", desc: "トークンを運ぶ。ドラッグで続けて敷ける" },
  cross: { name: "交差", mark: "＋", desc: "縦と横のベルトを交わらせずにすれ違わせる" },
  in: { name: "入力港", mark: "入", desc: "契約の引数を伝票つきで出す。1 番目は前、2 番目は左、3 番目は右" },
  out: { name: "納品港", mark: "納", desc: "値を受け取って正解と照合する" },
  zero: { name: "ゼロ源", mark: "Z", desc: "0 を出しつづける(伝票なし)" },
  S: { name: "後者機", mark: "S", desc: "n ↦ n + 1" },
  P: { name: "射影機", mark: "P", desc: "n 個の入力のうち i 番目だけを通す" },
  dup: { name: "複製器", mark: "複", desc: "後ろから来た値を、繋がっている前・左・右すべてに複製する" },
  trash: { name: "廃棄口", mark: "×", desc: "トークンを捨てる" },
  split: { name: "分配器", mark: "分", desc: "トークンを交互に振り分ける(並列化)" },
  Ref: { name: "関数機", mark: "f", desc: "カプセル化した関数を 1 マスで置く" },
  R: { name: "帰納炉", mark: "R", desc: "f(x, 0) = g(x)、f(x, n+1) = h(x, n, f(x, n))" },
  M: { name: "探索塔", mark: "μ", desc: "f(x, y) = 0 となる最小の y" },
  fn: { name: "機械", mark: "", desc: "" },
};

export function Title() {
  const [imp, setImp] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="title">
      <h1>計算可能関数の工場</h1>
      <p>ゼロ・後者・射影から、合成と帰納法と最小化だけで関数を組み上げる。</p>
      <div className="modes">
        <div className="card">
          <div className="card-body">
            <h3 className="card-title">工場モード</h3>
            <p>ベルトと機械で関数を実装し、納品を重ねて工場を育てる。</p>
            <p className="muted small">通貨・研究・定理化・階層昇格あり。</p>
            <div className="row-btns">
              <button type="button" className="btn-secondary" onClick={() => newGame("factory")}>
                はじめる
              </button>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <h3 className="card-title">探究モード</h3>
            <p>待ち時間なし。関数を正しく構成できたかだけで進む。</p>
            <p className="muted small">通貨なし。検査に 1 回合格すれば達成。</p>
            <div className="row-btns">
              <button type="button" className="btn-secondary" onClick={() => newGame("explore")}>
                はじめる
              </button>
            </div>
          </div>
        </div>
      </div>
      <details>
        <summary>セーブ文字列から再開する</summary>
        <textarea
          rows={3}
          cols={48}
          value={imp}
          onChange={(e) => setImp(e.target.value)}
          placeholder="エクスポートした文字列を貼る"
        />
        <div className="row-btns">
          <button
            type="button"
            className="btn-small"
            onClick={async () => setErr((await importSave(imp)).error ?? "")}
          >
            読み込む
          </button>
          <span className="text-danger">{err}</span>
        </div>
      </details>
    </div>
  );
}

export function TopBar() {
  const meta = useUi((s) => s.meta)!;
  const set = useUi((s) => s.set);
  const cleared = meta.contracts.filter((c) => c.cleared).length;
  const canPrestige = meta.prestige.next.have >= meta.prestige.next.need;
  return (
    <div className="topbar">
      <span className="brand">計算可能関数の工場</span>
      {meta.mode === "factory" ? (
        <>
          <span className="stat" title="通貨。納品で得る">
            QED <b>{fmt(meta.qed)}</b> <span className="muted small">(+{fmt(meta.rate)}/秒)</span>
          </span>
          <span className="stat" title="研究に使う。契約の初回達成と定理化で得る">
            定理点 <b>{meta.tp}</b>
          </span>
        </>
      ) : (
        <span className="badge secondary">探究モード</span>
      )}
      <span className="stat">
        達成 <b>{cleared}</b> / {meta.contracts.length}
      </span>
      <span className="spacer" />
      <button type="button" className="btn-small" onClick={() => set({ panel: "contracts" })}>
        契約
      </button>
      <button type="button" className="btn-small" onClick={() => set({ panel: "library" })}>
        関数
      </button>
      <button type="button" className="btn-small" onClick={() => set({ panel: "research" })}>
        研究{meta.mode === "factory" && meta.researchOpen.length > 0 && meta.tp > 0 ? " ●" : ""}
      </button>
      <button type="button" className="btn-small" onClick={() => set({ panel: "notes" })}>
        証明ノート
      </button>
      {meta.mode === "factory" &&
        (meta.prestige.level > 0 || meta.prestige.axiom > 0 || canPrestige || cleared >= 5) && (
          <button type="button" className="btn-small" onClick={() => set({ panel: "prestige" })}>
            昇格{canPrestige ? " ●" : ""}
          </button>
        )}
      <button type="button" className="btn-small" onClick={() => cmd({ c: "pause", on: !meta.paused })}>
        {meta.paused ? "再開" : "一時停止"}
      </button>
      <button type="button" className="btn-small" onClick={() => set({ panel: "settings" })}>
        設定
      </button>
      <button type="button" className="btn-small" onClick={() => set({ panel: "help" })}>
        遊び方
      </button>
    </div>
  );
}

export function Hotbar() {
  const meta = useUi((s) => s.meta)!;
  const tool = useUi((s) => s.tool);
  const focus = useUi((s) => s.focusContract);
  const set = useUi((s) => s.set);
  const pick = (b: BuildId) => {
    if (tool?.build === b) return set({ tool: null });
    const t: Tool = { build: b };
    if (b === "in" || b === "out") {
      const active = meta.contracts.find((c) => c.active);
      t.contract = (focus && boardable(CATALOG.get(focus)!) ? focus : null) ?? active?.id ?? null;
      t.arity = 1;
    }
    set({ tool: t, selected: null });
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey || e.metaKey) return;
      if (useUi.getState().panel) return;
      const i = "1234567890".indexOf(e.key);
      if (i >= 0 && meta.builds[i]) pick(meta.builds[i]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return (
    <div className="hotbar border">
      {meta.builds.map((b, i) => (
        <button
          key={b}
          type="button"
          className={`btn-small ${tool?.build === b ? "on" : ""}`}
          title={BUILD_NAMES[b].desc}
          onClick={() => pick(b)}
        >
          <span>
            {BUILD_NAMES[b].name}
            {i < 10 && <span className="key"> {(i + 1) % 10}</span>}
          </span>
          {meta.mode === "factory" && <small>{PRICES[b] ? `${PRICES[b]} QED` : "無料"}</small>}
        </button>
      ))}
    </div>
  );
}

/** 次にやることを 1 つだけ示す */
export function Guide() {
  const meta = useUi((s) => s.meta)!;
  const set = useUi((s) => s.set);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const c = (id: string) => meta.contracts.find((x) => x.id === id)!;
  const explore = meta.mode === "explore";
  let title = "";
  let body = "";
  const next = meta.contracts.find((x) => x.unlocked && !x.cleared);
  if (!c("id").cleared && !c("id").active && !explore) {
    title = "最初の契約";
    body = "「契約」を開いて「そのまま届ける」を稼働させます。";
  } else if (!c("id").cleared) {
    title = "そのまま届ける";
    body = explore
      ? "入力港と納品港を置き、ベルトで繋ぎます。納品港を選んで「カプセル化」し、「関数」画面で契約 id に対して検査します。"
      : "下の一覧から入力港と納品港を置き、ベルトで繋ぎます。R で回転、右クリックで撤去。20 回納品すると達成です。";
  } else if (!explore && meta.researchOpen.length > 0 && meta.tp > 0 && !meta.research.includes("rec")) {
    title = "研究";
    body = "定理点が貯まりました。「研究」でカプセル化と帰納炉を解禁します。";
  } else if (next) {
    const cat = CATALOG.get(next.id)!;
    title = `次の目標: ${cat.title}`;
    body = `${cat.def}${cat.hint ? `。ヒント: ${cat.hint}` : ""}`;
  } else {
    title = "すべての契約を達成しました";
    body = "証明ノートを確認してください。";
  }
  return (
    <div className="guide border">
      <div className="row-btns" style={{ marginTop: 0 }}>
        <h4 style={{ flex: 1, margin: 0 }}>{title}</h4>
        <button
          type="button"
          className="btn-small"
          onClick={() => setHidden(true)}
          aria-label="ガイドを閉じる"
        >
          閉じる
        </button>
      </div>
      <p className="small">{body}</p>
      {next && (
        <button
          type="button"
          className="btn-small"
          onClick={() => set({ panel: "contracts", focusContract: next.id })}
        >
          契約を見る
        </button>
      )}
    </div>
  );
}

export function Toasts() {
  const toast = useUi((s) => s.toast);
  const meta = useUi((s) => s.meta);
  const [seen, setSeen] = useState(0);
  const [, force] = useState(0);
  const lastLog = meta?.log[meta.log.length - 1];
  useEffect(() => {
    if (lastLog && lastLog.seq > seen) {
      setSeen(lastLog.seq);
      useUi.setState({ toast: { kind: lastLog.kind, text: lastLog.text, at: Date.now() } });
    }
  }, [lastLog, seen]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => force((n) => n + 1), 4600);
    return () => clearTimeout(t);
  }, [toast]);
  const [off, setOff] = useState<{ seconds: number; gain: string } | null>(null);
  useEffect(() => {
    if (meta?.offline) setOff(meta.offline);
  }, [meta?.offline]);
  const show = toast && Date.now() - toast.at < 4500;
  return (
    <div className="toasts" role="status">
      {off && (
        <div className="alert alert-success" style={{ pointerEvents: "auto" }}>
          おかえりなさい。留守の {fmtTime(off.seconds)} で {fmt(off.gain)} QED を得ました。{" "}
          <button type="button" className="btn-small" onClick={() => setOff(null)}>
            閉じる
          </button>
        </div>
      )}
      {show && (
        <div
          className={`alert alert-${toast.kind === "good" ? "success" : toast.kind === "warn" ? "warning" : "secondary"}`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
