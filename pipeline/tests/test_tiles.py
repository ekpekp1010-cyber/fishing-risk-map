import gzip

import mapbox_vector_tile
import mercantile
import numpy as np
import pytest
from pmtiles.reader import MmapSource, Reader
from rasterio.transform import from_origin
from shapely.geometry import shape

from fishrisk.spots import DraftSpot
from fishrisk.terrain import Grid
from fishrisk.tiles import (
    _dilate,
    build_zones,
    decode_terrain_rgb,
    encode_terrain_rgb,
    to_utm,
    utm_to_ll,
    write_zones_pmtiles,
)


def test_terrain_rgb_roundtrip():
    h = np.array([[-10.0, 0.0, 3.4, 1234.5]])
    assert decode_terrain_rgb(encode_terrain_rgb(h)) == pytest.approx(h, abs=0.05)
    # 0 m는 Mapbox 규칙상 (1, 134, 160)
    assert tuple(encode_terrain_rgb(np.array([[0.0]]))[0, 0]) == (1, 134, 160)


def test_dilate_grows_by_one_pixel_per_step():
    m = np.zeros((7, 7), dtype=bool)
    m[3, 3] = True
    assert _dilate(m, 1).sum() == 5
    assert _dilate(m, 2).sum() == 13


def coast_grid_at(lat=44.62, lng=-124.06):
    """실제 좌표계(UTM 10N)에 놓은 가짜 해안: 서쪽 절반 바다."""
    x, y = to_utm.transform(lng, lat)
    n = 60
    dem = np.zeros((n, n), dtype="float32")
    dem[:, 30:] = 5
    cover = np.full((n, n), 30, dtype="uint8")
    cover[:, :30] = 80
    occ = np.zeros((n, n), dtype="uint8")
    occ[:, :30] = 100
    return Grid(dem, cover, occ, np.zeros((n, n), dtype="uint8"), from_origin(x - 30 * 30, y + 30 * 30, 30, 30))


def test_zones_follow_shore_and_do_not_overlap():
    g = coast_grid_at()
    x0, y0 = to_utm.transform(-124.06, 44.62)
    lng1, lat1 = utm_to_ll.transform(x0, y0 + 100)  # 100 m 북쪽 이웃 포인트
    spots = [
        DraftSpot("a", "A", "beach", 44.62, -124.06, "", ""),
        DraftSpot("b", "B", "beach", lat1, lng1, "", ""),
    ]
    zones = build_zones(spots, {"a": {"score": 50}}, g)
    assert [z["id"] for z in zones] == ["zone-a", "zone-b"]
    a, b = (z["geometry"] for z in zones)
    assert a.intersection(b).area < 1e-12  # 겹치지 않는다
    assert zones[0]["terrain_score"] == 50 and zones[1]["terrain_score"] is None
    # 물가 띠(양쪽 60 m) 밖으로 나가지 않는다: 150 m 원보다 훨씬 작다
    assert zones[0]["area_m2"] < 3.14 * 150**2 / 2


def test_zones_pmtiles_has_zone_layer(tmp_path):
    g = coast_grid_at()
    zones = build_zones([DraftSpot("a", "A", "jetty", 44.62, -124.06, "", "")], {}, g)
    path = tmp_path / "z.pmtiles"
    n = write_zones_pmtiles(zones, path)
    assert n > 0
    with open(path, "rb") as f:
        r = Reader(MmapSource(f))
        assert r.metadata()["vector_layers"][0]["id"] == "zones"
        t = mercantile.tile(-124.06, 44.62, 14)
        layer = mapbox_vector_tile.decode(gzip.decompress(r.get(t.z, t.x, t.y)))["zones"]
        assert layer["features"][0]["properties"] == {"zoneId": "zone-a", "spotId": "a"}
    assert shape(zones[0]["geometry"].__geo_interface__).contains(shape({"type": "Point", "coordinates": [-124.06, 44.62]}))
