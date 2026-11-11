import { type ReactNode, useState } from "react";
import { boardable } from "../core/catalog";
import { ALL_CATALOG, ALL_TIERS, CATALOG } from "../data/all";
import { CLEAR_DELIVERIES, PERKS, perkCost, RESEARCH } from "../data/balance";
import { fmt } from "./format";
import { cmd, exportSave, importSave, send, useUi } from "./store";

export function Modal({ children }: { children: ReactNode }) {
  const set = useUi((s) => s.set);
  return (
    <div className="modal open">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 背景クリックで閉じる(Esc でも閉じられる) */}
      <div className="modal-bg" onClick={() => set({ panel: null })} onKeyDown={() => undefined} />
      <div className="modal-body panel">
        <button
          type="button"
          className="btn-small"
          style={{ float: "right" }}
          onClick={() => set({ panel: null })}
        >
          閉じる
        </button>
        {children}
      </div>
    </div>
  );
}

export function Contracts() {
  const meta = useUi((s) => s.meta)!;
  const focus = useUi((s) => s.focusContract);
  const set = useUi((s) => s.set);
  const explore = meta.mode === "explore";
  const state = new Map(meta.contracts.map((c) => [c.id, c]));
  const tiers = ALL_TIERS;
  return (
    <>
      <div className="head">
        <h2>契約</h2>
        <span className="muted small">
          {explore
            ? "関数を作り、「関数」画面で検査に合格すれば達成"
            : `正解を ${CLEAR_DELIVERIES} 回納品すれば達成。同時に稼働できるのは ${meta.maxActive} 件`}
        </span>
      </div>
      {tiers.map((tier) => {
        const list = ALL_CATALOG.filter((c) => c.tier === tier.id);
        if (!list.length || !list.some((c) => state.get(c.id)?.unlocked)) return null;
        return (
          <section key={tier.id}>
            <h3>
              {tier.title} <span className="muted small">{tier.blurb}</span>
            </h3>
            {list.map((cat) => {
              const c = state.get(cat.id)!;
              if (!c.unlocked)
                return (
                  <div key={cat.id} className="item border border-dashed locked">
                    ？？？{" "}
                    <span className="small">
                      先に必要:{" "}
                      {[
                        ...cat.needs.filter((n) => !state.get(n)?.cleared).map((n) => CATALOG.get(n)?.title),
                        ...(cat.needsResearch && !meta.research.includes(cat.needsResearch)
                          ? ["研究「図式」"]
                          : []),
                      ].join("、")}
                    </span>
                  </div>
                );
              return (
                <div
                  key={cat.id}
                  className={`item border ${focus === cat.id ? "border-secondary border-thick" : ""}`}
                >
                  <div className="line">
                    <h4 style={{ margin: 0 }}>{cat.title}</h4>
                    <code>{cat.id}</code>
                    <span className="muted small">
                      {cat.arity} 引数
                      {cat.schema
                        ? `・図式(スロット ${cat.schema.holes.map((h) => `${h} 引数`).join("、")})`
                        : ""}
                    </span>
                    {c.cleared && <span className="badge success">達成</span>}
                    {c.theorem && <span className="badge secondary">定理化済み</span>}
                    {c.active && <span className="badge warning">稼働中</span>}
                    <span className="spacer" />
                    {boardable(cat) && (
                      <>
                        <button
                          type="button"
                          className={`btn-small ${c.active ? "" : "btn-secondary"}`}
                          onClick={() => cmd({ c: "activate", id: cat.id, on: !c.active })}
                        >
                          {c.active ? "止める" : "稼働させる"}
                        </button>
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() =>
                            set({
                              tool: { build: "in", contract: cat.id },
                              focusContract: cat.id,
                              panel: null,
                              selected: null,
                            })
                          }
                        >
                          入力港を置く
                        </button>
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() =>
                            set({
                              tool: { build: "out", contract: cat.id },
                              focusContract: cat.id,
                              panel: null,
                              selected: null,
                            })
                          }
                        >
                          納品港を置く
                        </button>
                      </>
                    )}
                  </div>
                  <p className="term">{cat.def}</p>
                  {cat.hint && <p className="small muted">ヒント: {cat.hint}</p>}
                  {!explore && boardable(cat) && (
                    <div className="line small">
                      <span>
                        納品 {c.delivered}
                        {c.cleared ? "" : ` / ${CLEAR_DELIVERIES}`}
                      </span>
                      <span>不正解 {c.wrong}</span>
                      <span>
                        連続正解 {c.streak}(最高 {c.best} / 定理化に {meta.streakNeed})
                      </span>
                      <span>報酬 {fmt(c.reward)} QED / 個</span>
                      <span className="spacer" />
                      {!cat.fixedRange && c.level < 6 && (
                        <button
                          type="button"
                          className="btn-small"
                          title="入力の範囲が 2 倍、報酬が 3 倍になる"
                          onClick={() => cmd({ c: "upgradeRange", id: cat.id })}
                        >
                          入力範囲を広げる(Lv {c.level} → {c.level + 1}、{fmt(c.upCost)} QED)
                        </button>
                      )}
                    </div>
                  )}
                  {!boardable(cat) && (
                    <p className="small muted">
                      盤面には流しません。関数を作り、「関数」画面でこの契約に対して検査します(合格すれば達成・定理化)。
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}

export function Research() {
  const meta = useUi((s) => s.meta)!;
  const explore = meta.mode === "explore";
  const cleared = new Set(meta.contracts.filter((c) => c.cleared).map((c) => c.id));
  return (
    <>
      <div className="head">
        <h2>研究</h2>
        {explore ? (
          <span className="muted small">探究モードでは、条件の契約を達成すると自動で解禁されます</span>
        ) : (
          <span>
            定理点 <b>{meta.tp}</b>
          </span>
        )}
      </div>
      {(["構成", "物流", "機械", "運用"] as const).map((branch) => (
        <section key={branch}>
          <h3>{branch}</h3>
          <div className="grid2">
            {RESEARCH.filter((r) => r.branch === branch).map((r) => {
              const done = meta.research.includes(r.id);
              const open = meta.researchOpen.includes(r.id);
              const lacks = [
                ...(r.after ?? [])
                  .filter((a) => !meta.research.includes(a))
                  .map((a) => `研究「${RESEARCH.find((x) => x.id === a)?.title}」`),
                ...(r.needs ?? [])
                  .filter((n) => !cleared.has(n))
                  .map((n) => `契約「${CATALOG.get(n)?.title}」`),
              ];
              return (
                <div
                  key={r.id}
                  className={`item border ${done ? "border-success" : open ? "" : "border-dashed locked"}`}
                  style={{ margin: 0 }}
                >
                  <div className="line">
                    <b>{r.title}</b>
                    <span className="spacer" />
                    {done ? (
                      <span className="badge success">済</span>
                    ) : explore ? null : (
                      <button
                        type="button"
                        className="btn-small btn-secondary"
                        disabled={!open || meta.tp < r.cost}
                        onClick={() => cmd({ c: "research", id: r.id })}
                      >
                        {r.cost} 点
                      </button>
                    )}
                  </div>
                  <p className="small">{r.desc}</p>
                  {!done && lacks.length > 0 && <p className="small muted">条件: {lacks.join("、")}</p>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

export function Prestige() {
  const meta = useUi((s) => s.meta)!;
  const p = meta.prestige;
  const cat = CATALOG.get(p.next.fn);
  const can = p.next.have >= p.next.need;
  return (
    <>
      <div className="head">
        <h2>階層昇格</h2>
        <span>
          現在 E{p.level} ・ 公理点 <b>{p.axiom}</b>
        </span>
      </div>
      <p>
        Grzegorczyk
        階層になぞらえた周回です。昇格すると盤面・QED・研究・契約の進行・定理化が最初に戻り、公理点{" "}
        {1 + p.level} を得ます。関数ライブラリは残ります。
      </p>
      <div className="item border">
        <p>
          {p.next.name} への条件: 契約「{cat?.title}」で {p.next.need.toLocaleString()} 回納品(現在{" "}
          {p.next.have.toLocaleString()})
        </p>
        <div className="progress">
          <div
            className="bar secondary"
            style={{ width: `${Math.min(100, (p.next.have / p.next.need) * 100)}%` }}
          />
        </div>
        <div className="row-btns">
          <button
            type="button"
            className="btn-secondary"
            disabled={!can}
            onClick={() => {
              if (window.confirm("昇格すると盤面と進行が最初に戻ります。よろしいですか?"))
                cmd({ c: "prestige" });
            }}
          >
            昇格する
          </button>
        </div>
      </div>
      <h3>公理(永続する強化)</h3>
      <div className="grid2">
        {PERKS.map((k) => {
          const lv = p.perks[k.id] ?? 0;
          return (
            <div key={k.id} className="item border" style={{ margin: 0 }}>
              <div className="line">
                <b>{k.title}</b>
                <span className="muted small">
                  Lv {lv} / {k.max}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn-small btn-secondary"
                  disabled={lv >= k.max || p.axiom < perkCost(lv)}
                  onClick={() => cmd({ c: "perk", id: k.id })}
                >
                  {lv >= k.max ? "最大" : `${perkCost(lv)} 点`}
                </button>
              </div>
              <p className="small">{k.desc}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Settings() {
  const meta = useUi((s) => s.meta)!;
  const dark = useUi((s) => s.dark);
  const [data, setData] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <>
      <div className="head">
        <h2>設定</h2>
      </div>
      <div className="row-btns">
        <button
          type="button"
          className="btn-small"
          onClick={() => {
            try {
              localStorage.setItem("cfi-dark", dark ? "0" : "1");
            } catch {
              /* 保存できなくても切り替えは行う */
            }
            useUi.setState({ dark: !dark });
          }}
        >
          {dark ? "ライトテーマにする" : "ダークテーマにする"}
        </button>
        <button type="button" className="btn-small" onClick={() => cmd({ c: "clearTokens" })}>
          盤面のトークンを消す
        </button>
      </div>
      <h3>セーブ</h3>
      <p className="small muted">30 秒ごととタブを閉じるときに、このブラウザへ自動保存されます。</p>
      <div className="row-btns">
        <button
          type="button"
          className="btn-small"
          onClick={async () => {
            send({ t: "save" });
            setData(await exportSave());
            setMsg("下の文字列を控えてください");
          }}
        >
          エクスポート
        </button>
        <button
          type="button"
          className="btn-small"
          onClick={async () => {
            const r = await importSave(data);
            setMsg(r.ok ? "読み込みました" : (r.error ?? ""));
          }}
        >
          下の文字列をインポート
        </button>
        <span className="small">{msg}</span>
      </div>
      <textarea
        rows={4}
        value={data}
        onChange={(e) => setData(e.target.value)}
        placeholder="セーブ文字列"
        spellCheck={false}
      />
      <h3>モード</h3>
      {meta.mode === "factory" ? (
        <div className="row-btns">
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              if (window.confirm("探究モードに切り替えると工場モードには戻せません。よろしいですか?"))
                cmd({ c: "toExplore" });
            }}
          >
            探究モードに切り替える(戻せません)
          </button>
        </div>
      ) : (
        <p className="small">探究モードで遊んでいます。</p>
      )}
      <div className="row-btns">
        <button
          type="button"
          className="btn-small btn-danger"
          onClick={() => {
            if (window.confirm("セーブデータを消して最初の画面に戻ります。よろしいですか?")) {
              useUi.setState({ panel: null });
              send({ t: "wipe" });
            }
          }}
        >
          セーブを消して最初から
        </button>
      </div>
      <h3>クレジット</h3>
      <p className="small">
        画面の部品は PaperCSS(ISC License)、手描きの図形は Rough.js(MIT License)、書体は Klee One と Zen
        Kurenaido(SIL Open Font License 1.1)、描画は PixiJS(MIT License)を使っています。
      </p>
    </>
  );
}

export function Help() {
  return (
    <>
      <div className="head">
        <h2>遊び方</h2>
      </div>
      <p>
        ベルトには自然数が流れ、機械は関数として働きます。使える部品は種関数(ゼロ Z・後者 S・射影 P)と、3
        つの組み立て方だけです。
      </p>
      <ul>
        <li>
          <b>合成</b>: 機械の出力を別の機械の入力にベルトで繋ぐ。
        </li>
        <li>
          <b>原始帰納法</b>: 帰納炉 R に g と h を装着する。f(x, 0) = g(x)、f(x, n+1) = h(x, n, f(x, n))。
        </li>
        <li>
          <b>最小化</b>: 探索塔 μ に f を装着する。f(x, y) = 0 となる最小の y
          を返す。見つからなければ止まらない。
        </li>
      </ul>
      <p>
        <b>伝票</b>:
        入力港は引数の組を出すたびに伝票を付けます(丸の線が実線・破線・二重線で区別されます)。複数入力の機械は、同じ伝票の値が全ポートに揃ったときだけ動きます。ゼロ源の
        0 は伝票なしで、どの伝票とも組めます。
      </p>
      <p>
        <b>入力の順番</b>: 機械の入力は 後ろ = 1 番目、左 = 2 番目、右 = 3
        番目(機械に数字が書いてあります)。入力港の出力は 前 = 1 番目、左 = 2 番目、右 = 3 番目。
      </p>
      <p>
        <b>カプセル化</b>: 納品港を選んで名前を付けると、そこに届くまでの配線が 1
        つの関数になります。関数機として置いたり、帰納炉や探索塔に装着したりできます。
      </p>
      <p>
        <b>定理化</b>: 契約に対する検査に合格し、連続正解を重ねた関数は 1
        ステップで評価されるようになります。それを部品にした関数もまとめて速くなります。
      </p>
      <h3>操作</h3>
      <table className="keys">
        <tbody>
          {[
            ["左クリック / ドラッグ", "設置(道具なしのときは選択・盤面の移動)"],
            ["右クリック / ドラッグ", "撤去(全額返金)"],
            ["R", "回転"],
            ["Q", "スポイト(カーソル下の機械を道具にする)。何もなければ道具を外す"],
            ["1〜0", "下の一覧から道具を選ぶ"],
            ["Esc", "道具・選択を外す"],
            ["Ctrl + Z", "設置・撤去の取り消し"],
            ["ホイール", "拡大・縮小"],
            ["W A S D / 矢印", "盤面の移動"],
          ].map(([k, v]) => (
            <tr key={k}>
              <td>
                <b>{k}</b>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
