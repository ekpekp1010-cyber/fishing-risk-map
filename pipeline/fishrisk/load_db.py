"""1단계 결과를 Supabase에 넣는다: spots, terrain_scores.

    python -m fishrisk.load_db            # pipeline/ 에서 실행. 저장소 루트의 .env.local을 읽는다

- review/spots_draft.csv의 keep=yes는 active=true, keep=no는 active=false로 넣는다.
- source가 'osm:'으로 시작하지 않는 포인트(손으로 넣은 확인용 등)는 건드리지 않는다.
- service role 키는 .env.local에서만 읽고 출력하지 않는다.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

from .config import cell_id
from .osm import OUT_DIR
from .spots import read_review

ROOT = Path(__file__).resolve().parents[2]


def read_env(path: Path = ROOT / ".env.local") -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Rest:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Content-Type": "application/json"}

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if not rows:
            return
        req = urllib.request.Request(
            f"{self.base}/{table}?on_conflict={on_conflict}",
            data=json.dumps(rows, ensure_ascii=False).encode(),
            headers={**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status >= 300:
                raise RuntimeError(f"{table} {r.status}")

    def select(self, table: str, query: str) -> list[dict]:
        req = urllib.request.Request(f"{self.base}/{table}?{query}", headers=self.headers)
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)


def build_rows() -> tuple[list[dict], list[dict]]:
    terrain = {t["spot_id"]: t for t in json.loads((OUT_DIR / "terrain_scores.json").read_text(encoding="utf-8"))}
    spots, scores = [], []
    for s in read_review():
        keep = s.keep.strip().lower() == "yes"
        t = terrain.get(s.id)
        spots.append(
            {
                "id": s.id,
                "name": s.name,
                "type": s.type,
                "lat": s.lat,
                "lng": s.lng,
                "access_walk_minutes": t["access_walk_minutes"] if t else None,
                "access_from": t["access_from"] if t else None,
                "forecast_cell_id": cell_id(s.lat, s.lng),
                "active": keep and t is not None,
                "source": f"osm:{s.osm_id}",
                "notes": s.note or "자동 선정 초안(사람 검수 전)",
            }
        )
        if t:
            scores.append({k: t[k] for k in (
                "spot_id", "score", "slope_deg", "elevation_m", "water_distance_m", "cover", "flood_frequency",
                "wave_exposure_deg", "egress_distance_m", "egress_rise_m", "egress_min_elevation_m",
                "factors", "confidence", "data_vintage",
            )})
    return spots, scores


def main(argv: list[str]) -> int:
    env = read_env()
    rest = Rest(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    spots, scores = build_rows()
    cells = {c["id"] for c in rest.select("forecast_cells", "select=id")}
    missing = sorted({s["forecast_cell_id"] for s in spots} - cells)
    if missing:
        print(f"예보 셀이 없는 포인트가 있다: {missing}. supabase/seed.sql에 셀을 추가한다.")
        return 1
    rest.upsert("spots", spots, "id")
    rest.upsert("terrain_scores", scores, "spot_id")
    active = sum(1 for s in spots if s["active"])
    print(f"spots {len(spots)}곳(활성 {active}), terrain_scores {len(scores)}행 적재")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
