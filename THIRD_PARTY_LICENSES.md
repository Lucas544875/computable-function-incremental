# 第三者のライセンス

このゲームは次のソフトウェアと書体を含みます。各ライセンスの全文は、`npm install` 後の `node_modules/<パッケージ名>/` にあります。

## 見た目(デザインシステム)

| 名前 | 用途 | ライセンス | 入手元 |
|---|---|---|---|
| PaperCSS 1.9.2 | 画面の部品(ボタン、カード、バッジなど) | ISC | https://github.com/papercss/papercss |
| Rough.js | 盤面の手描き風の図形 | MIT | https://github.com/rough-stuff/rough |
| Klee One | 本文・数値の書体 | SIL Open Font License 1.1 | https://github.com/fontworks-fonts/Klee |
| Zen Kurenaido | 見出し・機械ラベルの書体 | SIL Open Font License 1.1 | https://github.com/googlefonts/zen-kurenaido |

- PaperCSS は `src/styles/paper.css` に取り込んでいます。変更点は、Google Fonts を読み込む `@import` 行を削除したことだけです。
- 書体は Fontsource のパッケージ(`@fontsource/klee-one`、`@fontsource/zen-kurenaido`)から同梱し、外部の CDN は使いません。

## 実行時のライブラリ

| 名前 | 用途 | ライセンス |
|---|---|---|
| React / React DOM | 画面 | MIT |
| Zustand | 画面の状態管理 | MIT |
| PixiJS | 盤面の描画 | MIT |
| break_infinity.js | 通貨の巨大数 | MIT |
| idb-keyval | セーブ(IndexedDB) | Apache-2.0 |
| lz-string | セーブ文字列の圧縮 | MIT |
