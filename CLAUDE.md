# Doll Pigment Atelier

## 仕様書

- 仕様の正本はこのリポジトリの [SPECIFICATION.md](SPECIFICATION.md)。機能の追加・変更の前に必ず確認する。
- デスクトップの `調色アプリ` フォルダにある旧仕様書（`Doll Color Atelier 仕様書.md` など）は参照しない。
- 実装で仕様を変える場合は、SPECIFICATION.md も同じ変更で更新する。
- 画面や操作が変わる場合は、[USER_MANUAL.md](USER_MANUAL.md) も同じ変更で更新する（アプリの「このアプリについて」から GitHub 上のこのファイルにリンクしている）。

## 構成

- ビルド不要の静的 PWA（HTML / CSS / JavaScript）。現在は画面モック。
- 起動: `python -m http.server 8765` → http://localhost:8765/
- ファイル構成とモックとしての割り切りは [README.md](README.md) を参照。
