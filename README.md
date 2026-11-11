# 計算可能関数の工場(computable-function-incremental)

ゼロ・後者・射影の 3 つの種関数から、**合成・原始帰納法・最小化** だけで関数を組み上げていく、工場づくりのインクリメンタルゲームです。ベルトには自然数が流れ、機械は関数として働きます。

- **工場モード**: ベルトと機械で関数を実装し、納品を重ねて工場を育てる。通貨・研究・定理化・階層昇格あり
- **探究モード**: 待ち時間なし。関数を正しく構成できたか(検査に合格したか)だけで進む
- **不完全性コース**: 算術化によって、ゲーデルの第一不完全性定理の証明を組み立てる上級目標

仕様は [docs/SPEC.md](docs/SPEC.md) にあります。

## 動かす

Node.js 22 以上が必要です。

```sh
npm install
npm run dev      # 開発サーバー
npm test         # テスト
npm run lint     # Biome による検査
npm run build    # 型検査と本番ビルド(dist/)
```

`main` に push すると、GitHub Actions がテストとビルドを行い、GitHub Pages に公開します(リポジトリ設定で Pages のソースを「GitHub Actions」にしてください)。

## 構成

```
src/
  core/     項・アリティ検査・評価器・検査・契約カタログ(DOM に依存しない)
  course/   不完全性コース: 記号列の符号化、Q の構文と証明検査、表現可能性の翻訳、ゲーデル文の構成
  sim/      盤面シミュレーション、カプセル化、ゲーム本体(契約・経済・研究・セーブ)
  worker/   シミュレーションを動かす Web Worker
  render/   PixiJS + Rough.js による盤面描画
  ui/       React の画面
  data/     バランス数値、研究ツリー
tests/      Vitest + fast-check。契約の解答例(tests/solutions.ts)を含む
```

## 項の記法

関数はすべて次の項で表されます(項エディタでそのまま書けます)。

| 記法 | 意味 |
|---|---|
| `Z` / `S` / `P[n,i]` | ゼロ(0 引数)/ 後者 / n 個のうち i 番目 |
| `C(f; g1, g2)` | 合成 f(g1(x…), g2(x…))。`C[k](f;)` は 0 引数の f を k 引数の定数にする |
| `R(g, h)` | 原始帰納法 f(x…, 0) = g(x…)、f(x…, n+1) = h(x…, n, f(x…, n)) |
| `M(f)` | 最小化 μy[f(x…, y) = 0] |
| `名前<f/2> = …` | 図式(関数スロットつきの関数)。使うときは `名前<関数>` |

例: `mult = R(C[1](Z;), C(add; P[3,1], P[3,3]))`

## ライセンス表記

画面の見た目は PaperCSS・Rough.js・Klee One・Zen Kurenaido によります。詳細は [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください。
