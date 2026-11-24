"""검수 화면용 로컬 서버. 필요한 파일만 열어 준다(.env.local 등 다른 파일은 열지 않는다).

    python pipeline/review/serve.py          # 저장소 어디서든. http://127.0.0.1:8765/
"""

from __future__ import annotations

import http.server
import mimetypes
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALLOWED = {
    "/pipeline/review/review.html": ROOT / "pipeline/review/review.html",
    "/pipeline/review/spots_draft.csv": ROOT / "pipeline/review/spots_draft.csv",
    "/pipeline/out/terrain_scores.json": ROOT / "pipeline/out/terrain_scores.json",
}
MAPLIBRE = ROOT / "node_modules/maplibre-gl/dist"
mimetypes.add_type("text/javascript", ".mjs")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/pipeline/review/review.html")
            self.end_headers()
            return
        file = ALLOWED.get(path)
        if file is None and path.startswith("/node_modules/maplibre-gl/dist/"):
            name = path.rsplit("/", 1)[-1]
            cand = MAPLIBRE / name
            if "/" not in name and cand.is_file():
                file = cand
        if file is None or not file.is_file():
            self.send_error(404)
            return
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(file.name)[0] or "application/octet-stream") + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"검수 화면: http://127.0.0.1:{port}/  (Ctrl+C로 끝)", flush=True)
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
