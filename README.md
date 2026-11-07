# Doll Pigment Atelier（モック）

成功した色を蓄積し、再現を支援するドールメイク用アトリエツールの画面モックです。
仕様書（[SPECIFICATION.md](SPECIFICATION.md)）の「初期バージョン必須機能」を一通り触れる状態にしています。使い方は [USER_MANUAL.md](USER_MANUAL.md) を参照してください。ビルド不要の静的 PWA（HTML / CSS / JavaScript）です。

## 起動

```bash
python -m http.server 8765
```

ブラウザで http://localhost:8765/ を開きます（`index.html` を直接開いても動きます。Service Worker だけは http で配信したときに有効になります）。

## 公開

GitHub Pages で公開します（仕様書 6.1）。

- 公開 URL：https://warabimochi-succubus-atelier.github.io/doll-pigment-atelier/
- 設定：リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にする
- ビルドは不要です。main に push すると公開されます。
- 公開する変更では `sw.js` の `CACHE` の名前を更新してください（例：`dpa-mock-v3` → `dpa-mock-v4`）。古いキャッシュが消え、利用者の端末に新しい版が届きます。

## 画面

| タブ | 内容 | 仕様書 |
| --- | --- | --- |
| 新規調色 | 画像登録（複数枚）→ ドラッグで範囲選択して色を抽出 → 代表色の決め方（平均色 / 中央値） → 逆引き調色（最大4色・5%刻み）→ 手動調整（絵具の割合と、メディウム（水を含む）の絵具合計重量に対する割合）→ ライブラリに保存。グレーカード補正、未補正の画像を含むときの「目安」表示、画像が1枚もないときだけ「サンプル画像で試してみる」を表示 | 2.1〜2.3, 4 |
| 再現・検索 | 過去作品の写真または色の数値（HEX / RGB）から、ライブラリを ΔE2000 の小さい順（同差なら高評価優先）で検索し、ワンクリックで呼び出し | 2.4 |
| 色ライブラリ | カラーエントリの一覧・絞り込み・並べ替え。詳細ダイアログで評価・塗り回数・制作条件・記録画像を編集。調色記録には使用メディウムも表示、呼び出し・複製・削除 | 2.5, 2.6, 3.3, 3.4 |
| 絵具DB | 標準DB（リキテックス 19色）、白との混色見本（1:1 / 1:4 / 1:10）、所持 / 未所持の切り替え。ユーザー絵具の登録は将来機能として枠のみ | 2.7, 3.1, 3.5 |
| 設定 | JSON でのエクスポート / インポート、永続保存の要求、サンプルデータへのリセット | 6 |

調色候補の「持っていない」を押すと、その絵具を未所持にして、マストーンが最も近い絵具に置き換えて割合を再計算します（2.7）。

## モックとしての割り切り

- 絵具の K・S は実測ではなく、マストーン色と仮の着色力から RGB 3チャンネルで近似した値です（`js/km.js`）。3.5 の見本撮影による推定は未実装です。
- メディウムは記録のみで、予測色の計算には含めていません。
- 保存先は localStorage です（本実装では IndexedDB）。画像は縮小したサムネイルだけを保存します。
- サンプルデータの調色記録は、起動時に代表色を逆引きして作っています。

## ファイル構成

```text
SPECIFICATION.md      仕様書（正本）
USER_MANUAL.md        ユーザーマニュアル
index.html            画面
css/style.css         スタイル（ライト / ダーク、スマホ下部タブ）
js/color.js           sRGB / 線形 / Lab 変換、CIEDE2000
js/km.js              標準DB、Kubelka-Munk 混色、逆引き調色、絵具置換
js/store.js           ユーザーDB（localStorage）とサンプルデータ
js/picker.js          画像の範囲選択
js/sample.js          サンプル画像（アニメ系ドールの顔、照明違い2枚）の生成
js/app.js             画面ロジック
icons/                アプリアイコン（PWA 用 any / maskable、iOS 用、ファビコン）
icons/source/         アイコンの元画像
images/author-logo.webp  作者ロゴ（「このアプリについて」ダイアログ）
manifest.webmanifest  PWA マニフェスト
sw.js                 Service Worker（オフライン用）
```
