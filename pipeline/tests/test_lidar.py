import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from fishrisk.lidar import MSL_MINUS_NAVD88_M, standing_elevation, to_utm
from fishrisk.terrain import lidar_elevation

LAT, LNG = 44.6400, -124.0630


def write_window(path, heights_navd):
    """포인트를 가운데에 둔 300×300 m(1 m) 가짜 3DEP 창. heights_navd(x_offset_m) → NAVD88 고도"""
    x, y = to_utm.transform(LNG, LAT)
    n = 300
    cols = np.arange(n) - n // 2 + 0.5  # 포인트 기준 동쪽(+) 거리(m)
    a = np.tile(heights_navd(cols), (n, 1)).astype("float32")
    with rasterio.open(
        path, "w", driver="GTiff", width=n, height=n, count=1, dtype="float32", crs="EPSG:32610",
        transform=from_origin(x - n / 2, y + n / 2, 1, 1), nodata=-9999,
    ) as ds:
        ds.write(a, 1)
    return path


def test_beach_refuge_is_high_ground_within_100m(tmp_path):
    # 서쪽은 바다(평균해면 0), 동쪽으로 경사가 올라 60 m부터 마른 모래 3 m(평균해면 기준)
    def h(dx):
        msl = np.clip(dx / 20, 0, 3.0)
        return msl + MSL_MINUS_NAVD88_M
    p = write_window(tmp_path / "b.tif", h)
    r = standing_elevation(p, LAT, LNG, "beach")
    assert r["rule"] == "refuge_p90_100m"
    assert r["elevation_m"] == pytest.approx(3.0, abs=0.05)
    assert 40 <= r["refuge_distance_m"] <= 60  # 2.5 m 이상이 시작되는 거리(50 m) 부근


def test_rocks_use_low_bench_not_cliff_top(tmp_path):
    # 포인트 동쪽 10 m부터 20 m 절벽
    p = write_window(tmp_path / "r.tif", lambda dx: np.where(dx > 10, 20.0, 1.0) + MSL_MINUS_NAVD88_M)
    r = standing_elevation(p, LAT, LNG, "rocks")
    assert r["rule"] == "bench_p25_30m"
    assert r["elevation_m"] == pytest.approx(1.0, abs=0.05)


def test_jetty_uses_crest(tmp_path):
    # 폭 10 m 마루 5 m, 양옆 물(−0.5)
    p = write_window(tmp_path / "j.tif", lambda dx: np.where(np.abs(dx) < 5, 5.0, -0.5) + MSL_MINUS_NAVD88_M)
    r = standing_elevation(p, LAT, LNG, "jetty")
    assert r["elevation_m"] == pytest.approx(5.0, abs=0.05)


def test_lidar_value_used_only_within_type_range():
    assert lidar_elevation("beach", {"elevation_m": 2.1, "rule": "refuge_p90_100m"}) == (2.1, "lidar:refuge_p90_100m")
    assert lidar_elevation("beach", {"elevation_m": 37.0}) == (None, "lidar_rejected")  # 절벽 위
    assert lidar_elevation("jetty", {"elevation_m": -0.5}) == (None, "lidar_rejected")  # 물 위
    assert lidar_elevation("pier", {"elevation_m": 3.0}) == (None, "none")  # 부두는 쓰지 않는다
    assert lidar_elevation("beach", None) == (None, "none")
