"""1단계 3·4번: 포인트별 지형 지표 7개와 지형 취약성 V.

    python -m fishrisk.terrain        # pipeline/ 에서 실행. out/terrain_scores.json 생성

입력: data/grid/*.tif (rasters.py), out/osm_raw.json(주차장), review/spots_draft.csv(keep=yes)
지표별 0~100 점수 기준은 PRD에 없어 정한 초기값이다(아래 상수). 게이트 1 검토 때 조정한다.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer

from .osm import OUT_DIR, parse
from .rasters import CRS, GRID
from .spots import DraftSpot, read_review
from .terrain_score import FactorInput, compute_terrain_score

RES = 30.0

# ---- 점수 기준(초기값) ---------------------------------------------------------
SLOPE_RADIUS_M = 100  # PRD: 반경 100 m 평균·최대 경사
SLOPE_FULL_DEG = 30  # 이 경사면 100점
ELEV_SAFE_M = 8  # 이 고도 이상이면 0점
ELEV_WORST_M = 1  # 이 고도 이하면 100점
WATER_NEAR_M = 5  # 물가까지 이 거리 이하면 100점
WATER_FAR_M = 150  # 이 거리 이상이면 0점
FETCH_MAX_M = 5000  # 열린 수면 거리 상한
FETCH_RAYS = 36
EGRESS_FULL_M = 1000  # 주차장까지 이 거리면 100점
EGRESS_LOW_M = 3  # 퇴로 경로에 이 고도 이하 구간이 있으면 가산
WALK_M_PER_MIN = 75  # 해안 지형 도보 속도
WALK_DETOUR = 1.3  # 직선 거리 대비 실제 경로
EGRESS_SKIP_M = 45  # 퇴로 최저 고도를 셀 때 포인트 자리(시작 45 m)는 뺀다
# 30 m 지형에서는 부두 상판·방파제 마루가 물로 잡혀 0 m가 된다. 구조물은 이 고도 아래로 보지 않는다.
# 뉴포트 공용 부두 상판은 대략 평균해면 +4 m 안팎이다(현장 확인 전 가정값, 신뢰도 낮음으로 표시).
# 해변은 물가(0 m 부근) 대신 사람이 서는 뒤쪽 모래밭 높이로 본다. 갯벌(하구)은 실제로 잠기므로 기본값이 없다.
# 갯바위(암반 단)도 30 m 지형에서는 물로 잡혀 0 m가 되므로 3 m 아래로 보지 않는다(2026-11-24 게이트 2 준비 때 추가, 가정값).
STRUCTURE_MIN_ELEV_M = {"pier": 4.0, "jetty": 4.0, "beach": 2.0, "rocks": 3.0}

# ESA WorldCover 분류
COVER_KO = {10: "숲", 20: "관목", 30: "초지", 40: "농지", 50: "인공 구조물", 60: "나지·암반", 70: "눈·얼음", 80: "물", 90: "습지", 95: "맹그로브", 100: "이끼"}


def clamp(x: float) -> float:
    return float(max(0.0, min(100.0, x)))


@dataclass
class Grid:
    dem: np.ndarray
    cover: np.ndarray
    occ: np.ndarray
    seas: np.ndarray
    transform: rasterio.Affine
    water: np.ndarray = field(init=False)
    slope: np.ndarray = field(init=False)

    def __post_init__(self):
        occ_valid = self.occ != 255
        # 영구 수면: 물 출현 50% 이상, 피복이 물, 또는 지표수 자료가 없는 바다(DEM 0.5 m 이하)
        self.water = ((self.occ >= 50) & occ_valid) | (self.cover == 80) | (~occ_valid & (self.dem <= 0.5))
        dem = np.where(self.dem < -100, 0, self.dem).astype("float64")
        gy, gx = np.gradient(dem, RES)
        self.slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    @property
    def shape(self):
        return self.dem.shape

    def rc(self, x: float, y: float) -> tuple[int, int]:
        col, row = ~self.transform * (x, y)
        return int(math.floor(row)), int(math.floor(col))

    def inside(self, r: int, c: int) -> bool:
        return 0 <= r < self.shape[0] and 0 <= c < self.shape[1]

    def disk(self, x: float, y: float, radius: float) -> tuple[np.ndarray, np.ndarray]:
        """반경 안 픽셀의 (행, 열) 배열."""
        r0, c0 = self.rc(x, y)
        k = int(math.ceil(radius / RES))
        rr, cc = np.mgrid[r0 - k : r0 + k + 1, c0 - k : c0 + k + 1]
        cx, cy = self.transform * (cc + 0.5, rr + 0.5)
        m = (np.hypot(cx - x, cy - y) <= radius) & (rr >= 0) & (cc >= 0) & (rr < self.shape[0]) & (cc < self.shape[1])
        return rr[m], cc[m]


def load_grid(path: Path = GRID) -> Grid:
    def read(name):
        with rasterio.open(path / f"{name}.tif") as ds:
            return ds.read(1), ds.transform

    dem, t = read("dem")
    cover, _ = read("cover")
    occ, _ = read("occurrence")
    seas, _ = read("seasonality")
    return Grid(dem.astype("float32"), cover, occ, seas, t)


@dataclass
class Metrics:
    slope_mean_deg: float
    slope_max_deg: float
    elevation_m: float
    water_distance_m: float
    flood_fraction: float
    exposure: float  # 0~1
    exposure_deg: float | None
    cover_code: int
    egress_distance_m: float
    egress_min_elevation_m: float
    egress_from: str
    land_pixels: int
    egress_xy: tuple[float, float] | None = None  # 고른 주차장의 UTM 좌표(lidar.py가 퇴로 경로를 볼 때 쓴다)


def fetch_rays(g: Grid, x: float, y: float) -> tuple[np.ndarray, np.ndarray]:
    """방위(도, 북=0 시계방향)별 열린 수면 거리. 시작점 근처 90 m의 육지는 건너뛴다."""
    angles = np.arange(FETCH_RAYS) * (360 / FETCH_RAYS)
    out = np.zeros(FETCH_RAYS)
    steps = np.arange(RES, FETCH_MAX_M + RES, RES)
    for i, a in enumerate(np.radians(angles)):
        started, dist = False, 0.0
        for d in steps:
            r, c = g.rc(x + d * math.sin(a), y + d * math.cos(a))
            if not g.inside(r, c):
                if started:
                    dist = FETCH_MAX_M  # 격자 밖(서쪽 바다)까지 열려 있다
                break
            if g.water[r, c]:
                started = True
                dist = d
            elif started or d > 90:
                break
        out[i] = min(dist, FETCH_MAX_M)
    return angles, out


def compute_metrics(g: Grid, x: float, y: float, parkings: list[tuple[float, float, str]]) -> Metrics:
    rr, cc = g.disk(x, y, SLOPE_RADIUS_M)
    land = ~g.water[rr, cc]
    lr, lc = rr[land], cc[land]
    if lr.size:
        s = g.slope[lr, lc]
        slope_mean, slope_max = float(s.mean()), float(s.max())
    else:
        slope_mean = slope_max = 0.0

    er, ec = g.disk(x, y, 60)
    eland = ~g.water[er, ec]
    if eland.any():
        # 물가 쪽 낮은 픽셀에 끌려 내려가지 않도록 상위 25% 값을 쓴다.
        elev = float(np.percentile(g.dem[er[eland], ec[eland]], 75))
    else:
        r, c = g.rc(x, y)
        elev = float(max(0.0, g.dem[r, c])) if g.inside(r, c) else 0.0

    wr, wc = g.disk(x, y, 1000)
    wm = g.water[wr, wc]
    if wm.any():
        px, py = g.transform * (wc[wm] + 0.5, wr[wm] + 0.5)
        water_d = float(max(0.0, np.hypot(px - x, py - y).min() - RES / 2))
    else:
        water_d = 1000.0

    if lr.size:
        o, se = g.occ[lr, lc], g.seas[lr, lc]
        intermittent = ((o > 0) & (o < 50)) | ((se > 0) & (se < 12) & (se != 255))
        flood = float(intermittent.mean())
    else:
        flood = 1.0  # 육지 픽셀이 없으면 물 위(위험한 쪽)

    angles, fetch = fetch_rays(g, x, y)
    exposure = float((fetch / FETCH_MAX_M).mean())
    if fetch.sum() > 0:
        ang = np.radians(angles)
        deg = math.degrees(math.atan2((np.sin(ang) * fetch).sum(), (np.cos(ang) * fetch).sum())) % 360
    else:
        deg = None

    cr, ccv = g.disk(x, y, 30)
    vals = g.cover[cr, ccv]
    vals = vals[(vals != 0) & (vals != 80)]
    cover = int(np.bincount(vals).argmax()) if vals.size else 80

    if parkings:
        px, py, pname = min(parkings, key=lambda p: math.hypot(p[0] - x, p[1] - y))
        dist = math.hypot(px - x, py - y)
        n = max(2, int(dist // 15))
        mins = []
        for t in np.linspace(0, 1, n):
            if t * dist < EGRESS_SKIP_M and dist > EGRESS_SKIP_M:
                continue
            r, c = g.rc(x + (px - x) * t, y + (py - y) * t)
            if g.inside(r, c) and not g.water[r, c]:
                mins.append(float(g.dem[r, c]))
        path_min = min(mins) if mins else elev
    else:
        dist, path_min, pname = 2000.0, elev, ""
        px = py = None

    return Metrics(slope_mean, slope_max, elev, water_d, flood, exposure, deg, cover, dist, path_min, pname, int(lr.size),
                   (px, py) if px is not None else None)


def surface_of(spot_type: str, cover: int) -> tuple[float, str]:
    """지표 상태 점수와 화면용 이름. 피복과 OSM 유형을 함께 본다(WorldCover에는 모래 분류가 없다)."""
    if spot_type in ("jetty", "rocks"):
        return 80, "암반"
    if spot_type == "pier":
        return 25, "인공 구조물"
    if spot_type == "estuary" or cover in (90, 95):
        return 60, "갯벌"
    if spot_type == "beach":
        return 40, "모래"
    return {50: 25, 60: 70}.get(cover, 45), COVER_KO.get(cover, "기타")


def factors_of(spot: DraftSpot, m: Metrics) -> tuple[list[FactorInput], str]:
    slope_s = clamp(max(m.slope_mean_deg, 0.6 * m.slope_max_deg) / SLOPE_FULL_DEG * 100)
    elev_s = clamp((ELEV_SAFE_M - m.elevation_m) / (ELEV_SAFE_M - ELEV_WORST_M) * 100)
    flood_s = clamp(m.flood_fraction * 150)
    near_s = clamp((WATER_FAR_M - m.water_distance_m) / (WATER_FAR_M - WATER_NEAR_M) * 100)
    expo_s = clamp(m.exposure * 200)
    surf_s, cover_ko = surface_of(spot.type, m.cover_code)
    egress_s = clamp(m.egress_distance_m / EGRESS_FULL_M * 100 + (20 if m.egress_min_elevation_m <= EGRESS_LOW_M else 0))
    walk = walk_minutes(m.egress_distance_m)

    expo_label = "외해로 열린 곳" if expo_s >= 60 else "부분적으로 열린 곳" if expo_s >= 30 else "파랑이 가려지는 곳"
    flood_label = "과거 물에 잠긴 흔적 많음" if flood_s >= 60 else "과거 물에 잠긴 흔적 있음" if flood_s >= 20 else "물에 잠긴 흔적 거의 없음"
    egress_label = f"주차장까지 도보 약 {walk}분" + (", 퇴로에 저지대 구간" if m.egress_min_elevation_m <= EGRESS_LOW_M else "")
    return [
        FactorInput("slope", slope_s, f"경사 평균 {m.slope_mean_deg:.0f}°, 최대 {m.slope_max_deg:.0f}°"),
        FactorInput("low_elevation", elev_s, f"평균해면보다 {m.elevation_m:.1f} m 높음"),
        FactorInput("flood_trace", flood_s, flood_label),
        FactorInput("water_proximity", near_s, f"물가까지 약 {m.water_distance_m:.0f} m"),
        FactorInput("wave_exposure", expo_s, expo_label),
        FactorInput("surface", surf_s, f"{cover_ko} 지표"),
        FactorInput("egress", egress_s, egress_label),
    ], cover_ko


def walk_minutes(distance_m: float) -> int:
    return int(math.ceil(distance_m * WALK_DETOUR / WALK_M_PER_MIN))


def flood_frequency(m: Metrics) -> str:
    f = m.flood_fraction
    return "high" if f >= 0.4 else "medium" if f >= 0.13 else "low"


def confidence_of(spot: DraftSpot, m: Metrics) -> str:
    # 30 m DSM은 방파제·갯바위 단위의 높낮이를 구분하지 못한다(PRD 신뢰도 표시).
    if spot.type in ("jetty", "rocks") or m.elevation_m <= 4 or m.land_pixels == 0:
        return "low"
    return "medium"


DATA_VINTAGE = {
    "copernicus_dem_glo30": {"acquired": "2011-2015", "released": 2021},
    "esa_worldcover": 2021,
    "jrc_global_surface_water": {"period": "1984-2021", "version": "1.4"},
    "openstreetmap": None,  # 실행 시각으로 채운다
}


# 1 m 라이다 고도(lidar.py)를 쓸 수 있는 유형별 범위(평균해면 기준, m). 벗어나면 포인트 위치가
# 1 m 지형과 어긋난 것으로 보고 30 m 고도·기본값을 그대로 쓴다.
# 해변·갯벌은 '물러설 곳' 높이라 범위가 더 높다(2026-11-24 변경).
LIDAR_VALID_RANGE_M = {"jetty": (1.5, 8.0), "beach": (1.5, 8.0), "rocks": (0.0, 10.0), "estuary": (0.5, 8.0)}


def lidar_elevation(spot_type: str, rec: dict | None) -> tuple[float | None, str]:
    """라이다 고도와 사용 여부 설명. (값, 'lidar:<규칙>' | 'lidar_rejected' | 'none')"""
    if not rec or rec.get("elevation_m") is None or spot_type not in LIDAR_VALID_RANGE_M:
        return None, "none"
    lo, hi = LIDAR_VALID_RANGE_M[spot_type]
    v = float(rec["elevation_m"])
    if lo <= v <= hi:
        return v, f"lidar:{rec.get('rule', '')}"
    return None, "lidar_rejected"


def load_lidar() -> dict:
    path = OUT_DIR / "lidar.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def run(
    spots: list[DraftSpot],
    g: Grid,
    parkings_ll: list[tuple[float, float, str]],
    osm_date: str,
    lidar: dict | None = None,
    lidar_prefix: str = "",
) -> list[dict]:
    to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    parkings = [(*to_utm.transform(lng, lat), name) for lat, lng, name in parkings_ll]
    vintage = {**DATA_VINTAGE, "openstreetmap": osm_date}
    out = []
    for s in spots:
        x, y = to_utm.transform(s.lng, s.lat)
        m = compute_metrics(g, x, y, parkings)
        lv, elev_source = lidar_elevation(s.type, (lidar or {}).get(lidar_prefix + s.id))
        floor = STRUCTURE_MIN_ELEV_M.get(s.type)
        if lv is not None:
            # 라이다가 있으면 기본값 대신 실제 고도를 쓴다. 30 m 퇴로 최저 고도는 물가 칸에서 출발해 0 m가 되므로
            # 쓰지 않고 같은 높이로 둔다(해변·갯벌은 물러설 곳, 방파제는 마루). 1 m 퇴로 경로는 아직 따라가 보지 않았다.
            m.elevation_m = lv
            m.egress_min_elevation_m = lv
        elif floor is not None and m.elevation_m < floor:
            m.elevation_m = floor
            # 구조물 위를 걷는 구간도 같은 높이로 본다.
            m.egress_min_elevation_m = max(m.egress_min_elevation_m, floor)
        factors, cover_ko = factors_of(s, m)
        v = compute_terrain_score(factors)
        out.append(
            {
                "spot_id": s.id,
                "score": v.score,
                "slope_deg": round(m.slope_mean_deg, 1),
                "elevation_m": round(m.elevation_m, 1),
                "water_distance_m": round(m.water_distance_m, 0),
                "cover": cover_ko,
                "flood_frequency": flood_frequency(m),
                "wave_exposure_deg": None if m.exposure_deg is None else round(m.exposure_deg, 0),
                "egress_distance_m": round(m.egress_distance_m, 0),
                "egress_rise_m": round(max(0.0, m.elevation_m - m.egress_min_elevation_m), 1),
                "egress_min_elevation_m": round(m.egress_min_elevation_m, 1),
                "factors": [f.to_dict() for f in v.factors],
                "confidence": "medium" if lv is not None else confidence_of(s, m),
                "refuge_distance_m": ((lidar or {}).get(lidar_prefix + s.id) or {}).get("refuge_distance_m") if lv is not None else None,
                "elevation_source": elev_source if lv is not None or elev_source == "lidar_rejected" else ("floor" if floor is not None and m.elevation_m == floor else "copernicus30"),
                "data_vintage": vintage,
                "access_walk_minutes": walk_minutes(m.egress_distance_m),
                "access_from": m.egress_from or "가까운 주차장",
                "metrics": asdict(m),
            }
        )
    return out


def parkings_from_osm(raw: dict) -> list[tuple[float, float, str]]:
    out = []
    for c in parse(raw):
        if c.kind == "parking" and c.tags.get("access") not in ("private", "no", "customers"):
            out.append((c.lat, c.lng, c.name))
    return out


def main(argv: list[str]) -> int:
    raw = json.loads((OUT_DIR / "osm_raw.json").read_text(encoding="utf-8"))
    osm_date = raw.get("osm3s", {}).get("timestamp_osm_base", "")[:10]
    spots = [s for s in read_review() if s.keep.strip().lower() == "yes"]
    rows = run(spots, load_grid(), parkings_from_osm(raw), osm_date, load_lidar())
    path = OUT_DIR / "terrain_scores.json"
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)}곳 계산 → {path.relative_to(OUT_DIR.parent)}")
    for r in sorted(rows, key=lambda r: -r["score"]):
        top = ", ".join(f"{f['code']} {f['score']}" for f in r["factors"][:3])
        print(f"{r['score']:3d} {r['confidence']:6s} {r['spot_id']:32s} 고도 {r['elevation_m']:5.1f} 경사 {r['slope_deg']:4.1f} 물가 {r['water_distance_m']:4.0f}m 도보 {r['access_walk_minutes']:3d}분 | {top}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
