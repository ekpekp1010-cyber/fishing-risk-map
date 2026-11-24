import numpy as np
import pytest
from rasterio.transform import from_origin

from fishrisk.osm import Candidate
from fishrisk.spots import build, line_length_m, meters, pier_reason_to_drop, point_along
from fishrisk.terrain import FETCH_MAX_M, Grid, compute_metrics, fetch_rays, surface_of, walk_minutes


def cand(kind, name="", tags=None, geometry=(), lat=44.62, lng=-124.05, excluded=None):
    return Candidate(f"way/{abs(hash((kind, name, lat, lng)))}", kind, name, lat, lng, tags or {}, excluded, tuple(geometry))


# ---- spots ---------------------------------------------------------------------


def test_point_along_line():
    g = [(44.6, -124.10), (44.6, -124.00)]
    lat, lng = point_along(g, 0.5)
    assert lat == pytest.approx(44.6) and lng == pytest.approx(-124.05)
    assert line_length_m(g) == pytest.approx(7930, rel=0.01)


def test_pier_rules():
    assert pier_reason_to_drop(cand("pier", "Dock A", {"floating": "yes"})) == "기관 전용·계류용"
    assert pier_reason_to_drop(cand("pier", "", {"floating": "yes"}, [(0, 0), (0, 0.001)])) == "계류용 부잔교"
    assert pier_reason_to_drop(cand("pier", "Embarcadero Crab Dock", {"floating": "yes"})) is None
    assert pier_reason_to_drop(cand("pier", "", {"access": "private"})) == "출입 금지"
    assert pier_reason_to_drop(cand("pier", "", {}, [(44.6, -124.05), (44.6, -124.0502)])) == "30 m 미만 무명 부두"
    assert pier_reason_to_drop(cand("pier", "Abbey Street Pier", {})) is None


def test_long_jetty_gives_root_mid_tip_from_land_to_sea():
    jetty = cand("jetty", "South Jetty", {"man_made": "breakwater"}, [(44.61, -124.060), (44.61, -124.080)])
    spots, _ = build([jetty])
    assert [s.id for s in sorted(spots, key=lambda s: -s.lng)] == ["south-jetty-root", "south-jetty-mid", "south-jetty-tip"]
    assert {s.name for s in spots} == {"사우스 제티 입구", "사우스 제티 중간", "사우스 제티 끝"}


def test_build_dedups_excludes_and_names_uniquely():
    a = cand("estuary", lat=44.6190, lng=-124.0420)
    b = cand("estuary", lat=44.6192, lng=-124.0421)  # 30 m 옆: 중복
    c = cand("estuary", lat=44.6170, lng=-124.0420)
    head = cand("beach", "Cobble Beach", excluded="yaquina-head")
    slip = cand("unknown", tags={"leisure": "slipway"})
    spots, dropped = build([a, b, c, head, slip])
    assert len(spots) == 2
    assert len({s.id for s in spots}) == 2 and len({s.name for s in spots}) == 2
    assert {why for _, why in dropped} == {"제외 구역(yaquina-head)", "보트 경사로·용도 불명"}
    assert meters((spots[0].lat, spots[0].lng), (spots[1].lat, spots[1].lng)) > 100


# ---- terrain -------------------------------------------------------------------


def synthetic_grid():
    """서쪽 절반 바다(물), 동쪽 절반 육지(경사 지형) 격자. 30 m, 100×100."""
    n = 100
    dem = np.zeros((n, n), dtype="float32")
    cols = np.arange(n)
    dem[:, 50:] = (cols[50:] - 49) * 1.0  # 동쪽으로 갈수록 1 m/픽셀 상승
    cover = np.full((n, n), 30, dtype="uint8")
    cover[:, :50] = 80
    occ = np.zeros((n, n), dtype="uint8")
    occ[:, :50] = 100
    seas = np.zeros((n, n), dtype="uint8")
    return Grid(dem, cover, occ, seas, from_origin(0, 3000, 30, 30))


def test_fetch_rays_open_to_west_only():
    g = synthetic_grid()
    x, y = 50 * 30 + 15, 1500  # 바다와 육지 경계 바로 동쪽
    angles, fetch = fetch_rays(g, x, y)
    west = fetch[angles == 270][0]
    east = fetch[angles == 90][0]
    assert west == FETCH_MAX_M  # 격자 밖까지 바다
    assert east == 0


def test_compute_metrics_on_synthetic_grid():
    g = synthetic_grid()
    # 물가에서 동쪽으로 6픽셀(180 m − 반 픽셀) 떨어진 육지
    m = compute_metrics(g, 55 * 30 + 15, 1500, [(80 * 30, 1500, "P1")])
    assert m.water_distance_m == pytest.approx(165, abs=1)
    assert 0 < m.elevation_m < 10
    assert m.slope_mean_deg == pytest.approx(np.degrees(np.arctan(1 / 30)), abs=1)
    assert m.egress_from == "P1"
    assert m.exposure == 0  # 90 m보다 안쪽 육지는 열린 수면으로 보지 않는다

    shore = compute_metrics(g, 50 * 30 + 15, 1500, [])
    assert 0.3 < shore.exposure < 0.7  # 서쪽 반원만 열려 있다
    assert shore.exposure_deg == pytest.approx(270, abs=5)


def test_surface_and_walk():
    assert surface_of("jetty", 60) == (80, "암반")
    assert surface_of("pier", 50) == (25, "인공 구조물")
    assert surface_of("beach", 60) == (40, "모래")
    assert surface_of("estuary", 30) == (60, "갯벌")
    assert walk_minutes(75 / 1.3) == 1
    assert walk_minutes(1000) == 18
