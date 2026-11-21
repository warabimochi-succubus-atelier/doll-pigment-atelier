# Doll Pigment Atelier

## 仕様書

- 仕様の正本はこのリポジトリの [SPECIFICATION.md](SPECIFICATION.md)。機能の追加・変更の前に必ず確認する。
- デスクトップの `調色アプリ` フォルダにある旧仕様書（`Doll Color Atelier 仕様書.md` など）は参照しない。
- 実装で仕様を変える場合は、SPECIFICATION.md も同じ変更で更新する。
- 画面や操作が変わる場合は、[USER_MANUAL.md](USER_MANUAL.md) も同じ変更で更新する（アプリの「このアプリについて」から GitHub 上のこのファイルにリンクしている）。

## 構成

- ビルド不要の静的 PWA（HTML / CSS / JavaScript）。初期版（0.x。公開前）。
- 混色は同梱の Mixbox（`js/vendor/mixbox.js`、CC BY-NC 4.0。営利目的では使えない）で計算する。このファイルは改変しない。
- 起動: `python tools/dev-server.py` → http://localhost:8765/（`python -m http.server` と違い、キャッシュさせないヘッダーを付けて配信する）
- テスト: `node --test tests/`（追加のパッケージ不要）。`js/` の計算・データ処理を変えたら実行する。
- ファイル構成と現在の制限は [README.md](README.md) を参照。
- アプリのファイル（HTML / CSS / JS / アイコンなど）を変えたら、必ず `js/version.js` の `APP_VERSION` を上げる。Service Worker はアプリのファイルを版ごとのキャッシュから返すので、上げないと利用者に届かない（localhost では毎回サーバーから取るので、開発中は気づけない。公開と同じ動きは http://127.0.0.1:8765/ で確かめる）。
