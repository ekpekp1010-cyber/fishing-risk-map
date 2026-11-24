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
import time
from pathlib import Path

from .config import BBox
from .osm import OUT_DIR, fetch, parse
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


def parkings_near(incident_id: str, lat: float, lng: float) -> list[tuple[float, float, str]] | None:
    """지점 둘레 공용 주차장. 결과는 out/incidents/parking-<id>.json에 저장해 다시 쓴다. 조회 실패면 None."""
    cache = OUT / f"parking-{incident_id}.json"
    if cache.exists():
        return [tuple(p) for p in json.loads(cache.read_text(encoding="utf-8"))]
    box = BBox(lng - PARKING_RADIUS_DEG, lat - PARKING_RADIUS_DEG, lng + PARKING_RADIUS_DEG, lat + PARKING_RADIUS_DEG)
    query = f'[out:json][timeout:25];nwr["amenity"="parking"]({box.south},{box.west},{box.north},{box.east});out center tags;'
    for attempt in range(3):
        try:
            cands = parse(fetch(query, timeout=40), box)
            break
        except RuntimeError:
            time.sleep(5 * (attempt + 1))
    else:
        return None
    out = [(c.lat, c.lng, c.name) for c in cands if c.kind == "parking" and c.tags.get("access") not in ("private", "no", "customers")]
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


SNAP_RADIUS_M = 300


def snap_to_shore(g: Grid, lat: float, lng: float) -> tuple[float, float, float]:
    """보도 장소로 잡은 근사 좌표를 반경 300 m 안의 가장 가까운 물가 육지 칸(물과 맞닿은 칸)으로 옮긴다.
    파도에 휩쓸린 사람은 물가에 있었다고 본다. 반환: (lat, lng, 옮긴 거리 m)"""
    import math

    import numpy as np
    from pyproj import Transformer

    from .rasters import CRS

    fwd = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    inv = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    x, y = fwd.transform(lng, lat)
    w = g.water
    edge = ~w & (np.roll(w, 1, 0) | np.roll(w, -1, 0) | np.roll(w, 1, 1) | np.roll(w, -1, 1))
    rr, cc = g.disk(x, y, SNAP_RADIUS_M)
    m = edge[rr, cc]
    if not m.any():
        return lat, lng, 0.0
    px, py = g.transform * (cc[m] + 0.5, rr[m] + 0.5)
    d = np.hypot(px - x, py - y)
    i = int(d.argmin())
    lng2, lat2 = inv.transform(px[i], py[i])
    return round(lat2, 6), round(lng2, 6), float(math.floor(d[i]))


def main(argv: list[str]) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for inc in read_incidents():
        lat, lng = float(inc["lat"]), float(inc["lng"])
        g = local_grid(lat, lng)
        lat, lng, moved = snap_to_shore(g, lat, lng)
        spot = DraftSpot(inc["id"], inc["place"], inc["type"], lat, lng, "", "")
        parks = parkings_near(inc["id"], lat, lng)
        # 주차장 조회가 끝내 실패하면 빈 목록 → 퇴로 거리 2 km(가장 위험한 쪽)로 계산된다.
        [t] = run([spot], g, parks or [], "incident")
        rows.append({**t, "incident": inc, "snapped": {"lat": lat, "lng": lng, "moved_m": moved},
                     "parking_lookup": "ok" if parks is not None else "failed"})
        top = ", ".join(f"{f['code']} {f['score']}" for f in t["factors"][:3])
        print(f"{inc['id']:28s} 물가로 {moved:4.0f} m · V {t['score']:3d} 고도 {t['elevation_m']:4.1f} 경사 {t['slope_deg']:4.1f} 신뢰도 {t['confidence']} | {top}")
    (OUT / "terrain.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)}건 → {(OUT / 'terrain.json').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
