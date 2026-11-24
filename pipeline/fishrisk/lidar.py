"""USGS 3DEP 1 m 지면 고도(라이다 기반)로 포인트 고도를 바로잡는다.

    python -m fishrisk.lidar          # pipeline/ 에서 실행. data/lidar/*.tif, out/lidar.json

30 m Copernicus DSM은 방파제·부두·해변·암반 단을 물로 보거나 절벽 위와 섞어 고도를 틀리게 잡았다.
그래서 terrain.py는 유형별 기본 고도(해변 2 m, 부두·방파제 4 m, 갯바위 3 m)를 썼다.
이 모듈은 포인트 둘레 300 m를 1 m로 받아 유형별로 사람이 서는 자리의 고도를 구한다(standing_elevation).
퇴로 최저 고도는 1 m 직선 경로가 물을 가로질러 의미가 없어 30 m 방식 그대로 둔다.
3DEP은 NAVD88 기준이라 NOAA 9435380의 기준면 차이(MSL − NAVD88 = 3.68 ft = 1.122 m)를 뺀다.
부두는 맨땅 고도(bare earth)에 상판이 없으므로 고치지 않는다.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer

from .osm import OUT_DIR
from .rasters import CRS
from .spots import read_review

ROOT = Path(__file__).resolve().parents[1]
LIDAR_DIR = ROOT / "data" / "lidar"
SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"

MSL_MINUS_NAVD88_M = 3.68 * 0.3048  # NOAA 9435380 기준면(ft) → m
WINDOW_M = 300
NODATA = -9999.0
SKIP_TYPES = {"pier"}  # 맨땅 고도에는 부두 상판이 없다

to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)


def fetch_window(key: str, lat: float, lng: float) -> Path:
    LIDAR_DIR.mkdir(parents=True, exist_ok=True)
    path = LIDAR_DIR / f"{key}.tif"
    if path.exists() and path.stat().st_size > 0:
        return path
    x, y = to_utm.transform(lng, lat)
    h = WINDOW_M / 2
    params = {
        "bbox": f"{x - h},{y - h},{x + h},{y + h}",
        "bboxSR": "32610",
        "imageSR": "32610",
        "size": f"{WINDOW_M},{WINDOW_M}",
        "format": "tiff",
        "pixelType": "F32",
        "noData": str(NODATA),
        "interpolation": "RSP_BilinearInterpolation",
        "f": "image",
    }
    url = f"{SERVICE}?{urllib.parse.urlencode(params)}"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fishing-risk-map-pipeline/0.1"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if not data.startswith((b"II*", b"MM\x00*")):
                raise RuntimeError(f"GeoTIFF가 아님: {data[:120]!r}")
            path.write_bytes(data)
            return path
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"3DEP 내려받기 실패 {key}") from last


def read_msl(path: Path) -> tuple[np.ndarray, rasterio.Affine]:
    with rasterio.open(path) as ds:
        a = ds.read(1).astype("float64")
        nod = ds.nodata if ds.nodata is not None else NODATA
        a[(a == nod) | (a < -100)] = np.nan
        return a - MSL_MINUS_NAVD88_M, ds.transform


MHHW_ABOVE_MSL_M = (12.91 - 9.02) * 0.3048  # NOAA 9435380: 평균 고고조면 − 평균해면 ≈ 1.19 m
RULE_RADIUS_M = 30
REFUGE_RADIUS_M = 100


def standing_elevation(path: Path, lat: float, lng: float, spot_type: str) -> dict:
    """유형별로 사람이 서는 자리의 고도(평균해면 기준). OSM 좌표는 1 m 자료에 견주면 10~20 m씩 어긋나므로
    점 한 칸이 아니라 둘레에서 유형에 맞는 지형을 찾는다.
    - 방파제: 반경 30 m 상위 5% (마루 위를 걷는다)
    - 해변·하구 갯벌: 물러설 곳 = 반경 100 m 상위 10% (뒤쪽 마른 모래·둑). 그곳까지 거리도 기록
    - 갯바위: 반경 30 m 하위 25% (절벽 위가 아니라 물가 암반 단)
    """
    a, t = read_msl(path)
    x, y = to_utm.transform(lng, lat)
    rows, cols = np.indices(a.shape)
    cx, cy = t * (cols + 0.5, rows + 0.5)
    d = np.hypot(cx - x, cy - y)
    ok = np.isfinite(a)
    near = a[(d <= RULE_RADIUS_M) & ok]
    if near.size == 0:
        return {"elevation_m": None, "rule": "no_data"}
    if spot_type == "jetty":
        return {"elevation_m": float(np.percentile(near, 95)), "rule": "crest_p95_30m"}
    if spot_type == "rocks":
        return {"elevation_m": float(np.percentile(near, 25)), "rule": "bench_p25_30m"}
    if spot_type in ("beach", "estuary"):
        # 물러설 곳: 해변·갯벌에서는 물이 들어오면 뒤로 물러선다. 위험은 물러설 곳까지 물·파도가 닿는지다.
        # 반경 100 m 지면의 상위 10% 높이(해변 뒤 마른 모래·모래언덕 앞, 갯벌 가장자리 둑)와 그곳까지의 거리.
        wide = ok & (d <= REFUGE_RADIUS_M)
        if not wide.any():
            return {"elevation_m": None, "rule": "no_data"}
        refuge = float(np.percentile(a[wide], 90))
        reach = ok & (a >= refuge - 0.5) & (d <= REFUGE_RADIUS_M)
        dist = float(np.where(reach, d, np.inf).min())
        return {"elevation_m": refuge, "rule": "refuge_p90_100m", "refuge_distance_m": round(dist, 1)}
    return {"elevation_m": float(np.percentile(near, 75)), "rule": "p75_30m"}


def targets() -> list[dict]:
    """포인트(검수 keep=yes)와 사고 지점(물가로 옮긴 좌표)."""
    out = []
    for s in read_review():
        if s.keep.strip().lower() != "yes":
            continue
        out.append({"key": s.id, "type": s.type, "lat": s.lat, "lng": s.lng})
    inc_path = OUT_DIR / "incidents" / "terrain.json"
    if inc_path.exists():
        for t in json.loads(inc_path.read_text(encoding="utf-8")):
            out.append({"key": f"incident-{t['incident']['id']}", "type": t["incident"]["type"],
                        "lat": t["snapped"]["lat"], "lng": t["snapped"]["lng"]})
    return out


def main(argv: list[str]) -> int:
    result = {}
    for tg in targets():
        if tg["type"] in SKIP_TYPES:
            result[tg["key"]] = {"skipped": "pier"}
            continue
        p = fetch_window(tg["key"], tg["lat"], tg["lng"])
        result[tg["key"]] = r = standing_elevation(p, tg["lat"], tg["lng"], tg["type"])
        print(f"{tg['key']:40s} {tg['type']:8s} 고도 {r['elevation_m'] if r['elevation_m'] is None else round(r['elevation_m'], 2)} ({r['rule']})")
    (OUT_DIR / "lidar.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(result)}곳 → out/lidar.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
