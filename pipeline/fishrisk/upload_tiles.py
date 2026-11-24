"""out/tiles/의 구역 PMTiles와 지형 타일을 Supabase Storage 공개 버킷 'tiles'에 올린다.

    python -m fishrisk.upload_tiles       # pipeline/ 에서 실행. 저장소 루트의 .env.local을 읽는다

올린 뒤 화면용 주소 두 개를 출력한다(NEXT_PUBLIC_ZONES_PMTILES_URL, NEXT_PUBLIC_TERRAIN_TILES_URL).
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .load_db import read_env
from .tiles import TILES

BUCKET = "tiles"
CONTENT_TYPE = {".pmtiles": "application/octet-stream", ".png": "image/png", ".geojson": "application/geo+json"}
CACHE_SECONDS = 3600


class Storage:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/storage/v1"
        self.public = url.rstrip("/") + f"/storage/v1/object/public/{BUCKET}"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def _req(self, method: str, path: str, data: bytes | None = None, headers: dict | None = None):
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={**self.headers, **(headers or {})})
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()

    def ensure_bucket(self) -> None:
        body = json.dumps({"id": BUCKET, "name": BUCKET, "public": True}).encode()
        try:
            self._req("POST", "/bucket", body, {"Content-Type": "application/json"})
            print(f"공개 버킷 '{BUCKET}'를 만들었다.")
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")
            if e.code in (400, 409) and ("exists" in text.lower() or "duplicate" in text.lower()):
                return
            raise RuntimeError(f"버킷 생성 실패 {e.code}: {text}") from e

    def upload(self, local: Path, remote: str) -> None:
        self._req(
            "POST",
            f"/object/{BUCKET}/{remote}",
            local.read_bytes(),
            {
                "Content-Type": CONTENT_TYPE.get(local.suffix, "application/octet-stream"),
                "x-upsert": "true",
                "cache-control": f"max-age={CACHE_SECONDS}",
            },
        )


def files_to_upload() -> list[tuple[Path, str]]:
    out = [(TILES / "zones.pmtiles", "zones.pmtiles")]
    for p in sorted((TILES / "terrain").rglob("*.png")):
        out.append((p, "terrain/" + p.relative_to(TILES / "terrain").as_posix()))
    return out


def main(argv: list[str]) -> int:
    env = read_env()
    st = Storage(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    st.ensure_bucket()
    files = files_to_upload()
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(lambda f: st.upload(*f), files))
    print(f"{len(files)}개 파일을 올렸다.")
    print(f"NEXT_PUBLIC_ZONES_PMTILES_URL={st.public}/zones.pmtiles")
    print(f"NEXT_PUBLIC_TERRAIN_TILES_URL={st.public}/terrain/{{z}}/{{x}}/{{y}}.png")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
