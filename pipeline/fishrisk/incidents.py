"""게이트 2 준비: 과거 사고 지점의 지형 취약성 V를 시범 지역과 같은 방법으로 계산한다.

    python -m fishrisk.incidents      # pipeline/ 에서 실행. out/incidents/terrain.json 생성

사고 목록: validation/incidents.csv (날짜·시각·좌표의 확실성과 출처 포함).
시범 지역 밖(디포베이·실레츠만·야하츠) 사고도 같은 원본 타일(DEM N44W125, WorldCover N42W126,
JRC 130W_50N) 안에 있어서 지점마다 작은 격자를 새로 만들어 같은 규칙으로 V를 낸다.
주차장(퇴로)은 OpenStreetMap에서 지점 둘레 2 km를 조회한다.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from .config import BBox
from .osm import OUT_DIR, build_query, fetch, parse
from .rasters import RAW, SOURCES, grid_spec_around, warp_array
from .spots import DraftSpot
from .terrain import Grid, run

ROOT = Path(__file__).resolve().parents[1]
INCIDENTS = ROOT / "validation" / "incidents.csv"
OUT = OUT_DIR / "incidents"

GRID_RADIUS_M = 3000
GRID_WEST_M = 8000
PARKING_RADIUS_DEG = 0.02  # 약 2 km


def read_incidents(path: Path = INCIDENTS) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def local_grid(lat: float, lng: float) -> Grid:
    t, w, h = grid_spec_around(lat, lng, GRID_RADIUS_M, GRID_WEST_M)
    layers = {s.key: warp_array(RAW / s.url.rsplit("/", 1)[-1], s, t, w, h) for s in SOURCES}
    return Grid(layers["dem"].astype("float32"), layers["cover"], layers["occurrence"], layers["seasonality"], t)


def parkings_near(lat: float, lng: float) -> list[tuple[float, float, str]]:
    box = BBox(lng - PARKING_RADIUS_DEG, lat - PARKING_RADIUS_DEG, lng + PARKING_RADIUS_DEG, lat + PARKING_RADIUS_DEG)
    cands = parse(fetch(build_query(box)), box)
    return [(c.lat, c.lng, c.name) for c in cands if c.kind == "parking" and c.tags.get("access") not in ("private", "no", "customers")]


def main(argv: list[str]) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for inc in read_incidents():
        lat, lng = float(inc["lat"]), float(inc["lng"])
        spot = DraftSpot(inc["id"], inc["place"], inc["type"], lat, lng, "", "")
        g = local_grid(lat, lng)
        [t] = run([spot], g, parkings_near(lat, lng), "incident")
        rows.append({**t, "incident": inc})
        top = ", ".join(f"{f['code']} {f['score']}" for f in t["factors"][:3])
        print(f"{inc['id']:28s} V {t['score']:3d} 고도 {t['elevation_m']:4.1f} 경사 {t['slope_deg']:4.1f} 신뢰도 {t['confidence']} | {top}")
    (OUT / "terrain.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)}건 → {(OUT / 'terrain.json').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
