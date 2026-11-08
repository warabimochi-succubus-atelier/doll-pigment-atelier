"""開発用のサーバー（python -m http.server の代わり）

使い方: python tools/dev-server.py [ポート番号]   （既定は 8765）

python -m http.server はキャッシュの指示（Cache-Control）を送らないため、
ブラウザが「しばらく変わらないだろう」と推測してファイルをキャッシュから読み、
変更が反映されないことがある。特に iPhone から LAN のアドレス（http://192.168.x.x:8765 など）で
開くと、http では Service Worker も動かないため、再読み込みしても古いファイルのままになりやすい。
このサーバーはすべての応答に Cache-Control: no-cache を付け、毎回サーバーに確かめさせる
（変わっていないファイルは 304 で返すので軽い）。

どこから起動しても、このリポジトリのルートを配信する。開発用なので、公開のサーバーには使わない。
"""
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def lan_address():
    # 外へ出るときに使う自分の IP アドレス（実際には送信しない）。分からなければ None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('192.0.2.1', 9))
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    sys.stdout.reconfigure(line_buffering=True)  # 起動の案内をすぐ表示する（出力をファイルなどに流したときも）
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(('', port), handler) as httpd:
        print(f'配信中: {ROOT}')
        print(f'  この PC:        http://localhost:{port}/')
        ip = lan_address()
        if ip:
            print(f'  同じ Wi-Fi から: http://{ip}:{port}/')
        print('止めるときは Ctrl+C')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
