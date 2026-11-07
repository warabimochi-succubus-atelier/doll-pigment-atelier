# Doll Pigment Atelier

成功した色を蓄積し、再現を支援するドールメイク用アトリエツールです。
仕様書（[SPECIFICATION.md](SPECIFICATION.md)）の機能を実装しています。使い方は [USER_MANUAL.md](USER_MANUAL.md) を参照してください。ビルド不要の静的 PWA（HTML / CSS / JavaScript）です。

現在の版は `js/version.js` の `APP_VERSION` です。公開するまでは 0.x で、公開するときに 1.0.0 にします。

## 起動

```bash
python -m http.server 8765
```

ブラウザで http://localhost:8765/ を開きます（`index.html` を直接開いても動きます。Service Worker だけは http で配信したときに有効になります）。

## 公開

GitHub Pages で公開します（仕様書 5.1）。

- 公開 URL：https://warabimochi-succubus-atelier.github.io/doll-pigment-atelier/
- 設定：リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にする
- ビルドは不要です。main に push すると公開されます。
- 公開する変更では `js/version.js` の `APP_VERSION` を上げてください（例：`0.9.0` → `0.9.1`）。Service Worker のキャッシュ名はこの版から作るので、利用者の端末に新しい版が入り、画面に「新しい版があります」と表示されます。「更新する」を押すと切り替わり、古いキャッシュは消えます。

## 画面

| タブ | 内容 | 仕様書 |
| --- | --- | --- |
| 調色 | 画像登録（複数枚。ファイル選択またはカメラで撮影）→ 拡大・スクロールして ドラッグで範囲選択して色を抽出（または HEX / RGB で数値指定）→ 抽出色の平均を代表色に（ほかと離れた抽出色に印）→ レシピ帳の近い色を自動表示（ΔE2000 の小さい順・同差なら高評価優先、ワンクリックで呼び出し）→ 逆引き調色を自動で計算（最大4色・5%刻み）→ 手動調整（絵具と重量比）→ レシピ帳に保存。グレーカード補正、未補正の画像を含むときの「目安」表示、画像が1枚もないときだけ「サンプル画像で試してみる」を表示 | 2.1〜2.4, 4 |
| レシピ帳 | カラーエントリの一覧・絞り込み・並べ替え。詳細ダイアログで評価・コメント・制作条件（使用メディウムを含む。前回の値を初期値にする）・記録画像を編集、調色への呼び出し・削除 | 2.5, 2.6, 3.3, 3.4 |
| 絵具箱 | 標準DB（リキテックス レギュラー 122色 / ソフト 105色 / ベーシックス 80色をラインで切り替え。メタリック・蛍光・イリディッセントは計算対象外）、品番・色名での検索、品番と透明度の表示、所持の設定（最初は未所持。表示中の一括解除）、白との混色見本（1:1 / 1:4 / 1:10）。ユーザー絵具の登録は将来機能として枠のみ | 2.7, 3.1, 3.5 |
| 設定 | ZIP でのエクスポート / インポート（画像を含む。以前の JSON も読み込める）、永続保存の要求、サンプルのカラーの追加、すべて削除、版の表示 | 5 |

調色候補の「持っていない」を押すと、その絵具を未所持にして、マストーンが最も近い絵具に置き換えて割合を再計算します（2.7）。

最初はレシピ帳が空の状態で始まります。サンプルのカラー（6件）は、空のレシピ帳の案内か、設定の「サンプルのカラーを追加」から入れられます（今のカラーは消しません）。

## 現在の制限と実装メモ

- 混色は [Mixbox](https://github.com/scrtwpns/mixbox) 2.0（`js/vendor/mixbox.js`。npm パッケージ `mixbox` を改変せずに同梱）で計算します（仕様書 3.5）。各絵具の色は、カラーチャートの色見本から取った色です（`js/paints-data.js`）。絵具ごとの着色力の違いは扱いません。
- Mixbox は CC BY-NC 4.0 です。営利目的で使う場合は商用ライセンスが必要です（NOTICE.md）。
- 逆引き調色は、Mixbox の潜在表現の距離で組み合わせと割合を絞り込み、上位だけを色に戻して ΔE で選びます（`js/km.js`）。所持している絵具が多くても、計算に使える257色すべてで1秒以内に収まります（PC）。
- メディウムは予測色の計算には含めていません。
- 保存先はブラウザの IndexedDB（データベース `dpa.atelier`）です。以前の版の localStorage（`dpa.userdb.v3`）のデータは、初回の起動で移します。画像は長辺 1600px の本画像と長辺 320px のサムネイルを Blob で保存し、カラーエントリから id で参照します。以前の版でエントリの中に持っていたサムネイルは、起動時に画像として取り出します（本画像は残っていないため、サムネイルを本画像として使います）。
- サンプルのカラーの調色記録は、追加するときに代表色を逆引きして作っています。

## ファイル構成

```text
SPECIFICATION.md      仕様書（正本）
USER_MANUAL.md        ユーザーマニュアル
index.html            画面
css/style.css         スタイル（ライト / ダーク、スマホ下部タブ）
js/version.js         アプリの版（画面の表示と Service Worker のキャッシュ名に使う）
js/color.js           sRGB / 線形 / Lab 変換、CIEDE2000
js/paints-data.js     標準DB のデータ（リキテックス レギュラー・ソフト・ベーシックス 307色：品番・色名・仮の色・透明度・系統・販売中止）
js/vendor/mixbox.js   Mixbox 2.0（混色の計算。CC BY-NC 4.0。改変しない）
js/vendor/mixbox.LICENSE  Mixbox のライセンス全文
js/km.js              Mixbox による混色、逆引き調色、絵具置換
js/reverse-worker.js  逆引き調色を画面とは別のスレッド（Web Worker）で計算する
js/store.js           ユーザーDB（IndexedDB。カラーエントリ・設定・画像）とサンプルデータ
js/zip.js             バックアップ用の ZIP の書き出しと読み込み
js/picker.js          画像の範囲選択
js/sample.js          サンプル画像（アニメ系ドールの顔、照明違い2枚）の生成
js/app.js             画面ロジック
icons/                アプリアイコン（PWA 用 any / maskable、iOS 用、ファビコン）
icons/source/         アイコンの元画像
images/author-logo.webp  作者ロゴ（「このアプリについて」ダイアログ）
manifest.webmanifest  PWA マニフェスト
sw.js                 Service Worker（オフライン用。新しい版が届いたら画面に知らせる）
LICENSE               MIT License
NOTICE.md             ロゴ・アイコンと Mixbox の権利について
```

## ライセンス

[MIT License](LICENSE) のもとで公開しています。ただし、ロゴとアイコン、同梱している Mixbox（`js/vendor/mixbox.js`。CC BY-NC 4.0、営利目的での利用は不可）は対象外です。詳しくは [NOTICE.md](NOTICE.md) を参照してください。
