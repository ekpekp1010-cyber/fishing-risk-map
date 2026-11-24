"""1단계 5·6번: 위험 구역 도형과 PMTiles, 3D 지형 terrain-RGB 타일.

    python -m fishrisk.tiles                  # pipeline/ 에서 실행

결과(out/tiles/, 커밋하지 않음):
- zones.geojson      구역 도형(WGS84). load_db가 zones 테이블에 넣는다
- zones.pmtiles      벡터 타일, 레이어 "zones", 속성 zoneId·spotId (계약 3번)
- terrain/{z}/{x}/{y}.png   Mapbox terrain-RGB, 256 px (계약: NEXT_PUBLIC_TERRAIN_TILES_URL)

구역 규칙(정한 값): 포인트 둘레 원(유형별 반경)과 물가 띠(물·육지 경계에서 양쪽 60 m)의 교집합.
이웃 포인트와 겹치는 부분은 보로노이 경계로 나눈다.
"""

from __future__ import annotations

import gzip
import io
import json
import math
import sys
from pathlib import Path

import mapbox_vector_tile
import mercantile
import numpy as np
import rasterio
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from pyproj import Transformer
from rasterio.features import shapes
from rasterio.warp import Resampling, reproject
from shapely import MultiPoint, MultiPolygon, Point, Polygon, box, voronoi_polygons
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union

from .config import cell_id
from .osm import OUT_DIR
from .rasters import CRS, RAW, SOURCES
from .spots import read_review
from .terrain import load_grid

TILES = OUT_DIR / "tiles"

ZONE_RADIUS_M = {"jetty": 90, "pier": 70, "beach": 150, "estuary": 150, "rocks": 100}
SHORE_BAND_M = 60
MIN_CORE_M = 25  # 띠 밖(구조물 위 등)이어도 포인트 둘레 이만큼은 구역에 넣는다
SIMPLIFY_M = 4

ZONE_ZOOMS = range(11, 17)
TERRAIN_ZOOMS = range(8, 15)
EXTENT = 4096

to_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
utm_to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
ll_to_merc = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)


# ---- 구역 ----------------------------------------------------------------------


def _dilate(mask: np.ndarray, steps: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(steps):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def shore_band_polygon(g) -> Polygon | MultiPolygon:
    """물·육지 경계 양쪽 SHORE_BAND_M 안의 영역(UTM)."""
    steps = max(1, round(SHORE_BAND_M / 30))
    water = g.water
    band = (_dilate(water, steps) & ~water) | (_dilate(~water, steps) & water)
    polys = [shape(geom) for geom, v in shapes(band.astype("uint8"), mask=band, transform=g.transform) if v == 1]
    return unary_union(polys)


def build_zones(spots, terrain_by_id: dict, g) -> list[dict]:
    band = shore_band_polygon(g)
    pts = {s.id: Point(*to_utm.transform(s.lng, s.lat)) for s in spots}
    hull = box(*unary_union(list(pts.values())).buffer(2000).bounds)
    cells = voronoi_polygons(MultiPoint(list(pts.values())), extend_to=hull)
    cell_of = {}
    for sid, p in pts.items():
        cell_of[sid] = next(c for c in cells.geoms if c.covers(p))

    zones = []
    for s in spots:
        p = pts[s.id]
        circle = p.buffer(ZONE_RADIUS_M.get(s.type, 100), quad_segs=16)
        geom = circle.intersection(band).union(p.buffer(MIN_CORE_M))
        geom = geom.intersection(cell_of[s.id]).simplify(SIMPLIFY_M)
        if geom.is_empty:
            continue
        if geom.geom_type == "Polygon":
            geom = MultiPolygon([geom])
        elif geom.geom_type == "GeometryCollection":
            geom = MultiPolygon([x for x in geom.geoms if x.geom_type == "Polygon"])
        ll = shp_transform(utm_to_ll.transform, geom)
        t = terrain_by_id.get(s.id)
        zones.append(
            {
                "id": f"zone-{s.id}",
                "spot_id": s.id,
                "terrain_score": t["score"] if t else None,
                "forecast_cell_id": cell_id(s.lat, s.lng),
                "geometry": ll,
                "area_m2": round(geom.area),
            }
        )
    return zones


def write_geojson(zones: list[dict], path: Path) -> None:
    fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"zoneId": z["id"], "spotId": z["spot_id"]}, "geometry": mapping(z["geometry"])}
            for z in zones
        ],
    }
    path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")


# ---- 구역 PMTiles -----------------------------------------------------------------


def _header(tile_type, compression, bounds_ll, zooms, center_zoom) -> dict:
    w, s, e, n = bounds_ll
    return {
        "tile_type": tile_type,
        "tile_compression": compression,
        "min_zoom": min(zooms),
        "max_zoom": max(zooms),
        "min_lon_e7": int(w * 1e7),
        "min_lat_e7": int(s * 1e7),
        "max_lon_e7": int(e * 1e7),
        "max_lat_e7": int(n * 1e7),
        "center_zoom": center_zoom,
        "center_lon_e7": int((w + e) / 2 * 1e7),
        "center_lat_e7": int((s + n) / 2 * 1e7),
    }


def write_zones_pmtiles(zones: list[dict], path: Path) -> int:
    merc = [(z, shp_transform(ll_to_merc.transform, z["geometry"])) for z in zones]
    bounds_ll = unary_union([z["geometry"] for z in zones]).bounds
    tiles: list[tuple[int, bytes]] = []
    for zoom in ZONE_ZOOMS:
        for t in mercantile.tiles(*bounds_ll, zooms=zoom):
            xy = mercantile.xy_bounds(t)
            tb = box(xy.left, xy.bottom, xy.right, xy.top)
            pad = tb.buffer((xy.right - xy.left) / 64, join_style="mitre")
            feats = []
            for z, g in merc:
                if not g.intersects(tb):
                    continue
                clipped = g.intersection(pad)
                if clipped.is_empty:
                    continue
                feats.append({"geometry": clipped.wkt, "properties": {"zoneId": z["id"], "spotId": z["spot_id"]}})
            if not feats:
                continue
            data = mapbox_vector_tile.encode(
                [{"name": "zones", "features": feats}],
                default_options={"quantize_bounds": (xy.left, xy.bottom, xy.right, xy.top), "extents": EXTENT},
            )
            tiles.append((zxy_to_tileid(t.z, t.x, t.y), gzip.compress(data, mtime=0)))
    tiles.sort()
    with open(path, "wb") as f:
        w = Writer(f)
        for tid, data in tiles:
            w.write_tile(tid, data)
        w.finalize(
            _header(TileType.MVT, Compression.GZIP, bounds_ll, ZONE_ZOOMS, 13),
            {
                "name": "fishing-risk-zones",
                "attribution": "© OpenStreetMap contributors; Copernicus DEM; JRC Global Surface Water",
                "vector_layers": [
                    {"id": "zones", "fields": {"zoneId": "String", "spotId": "String"}, "minzoom": min(ZONE_ZOOMS), "maxzoom": max(ZONE_ZOOMS)}
                ],
            },
        )
    return len(tiles)


# ---- 지형 terrain-RGB --------------------------------------------------------------


def encode_terrain_rgb(height: np.ndarray) -> np.ndarray:
    """Mapbox terrain-RGB: height = -10000 + (R*65536 + G*256 + B) * 0.1"""
    v = np.clip(np.round((height + 10000) * 10), 0, 256**3 - 1).astype("uint32")
    return np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], axis=-1).astype("uint8")


def decode_terrain_rgb(rgb: np.ndarray) -> np.ndarray:
    r, g, b = (rgb[..., i].astype("float64") for i in range(3))
    return -10000 + (r * 65536 + g * 256 + b) * 0.1


def write_terrain_tiles(dem_path: Path, bounds_ll, out_dir: Path) -> int:
    n = 0
    with rasterio.open(dem_path) as ds:
        for zoom in TERRAIN_ZOOMS:
            for t in mercantile.tiles(*bounds_ll, zooms=zoom):
                xy = mercantile.xy_bounds(t)
                dst = np.zeros((256, 256), dtype="float32")
                reproject(
                    source=rasterio.band(ds, 1),
                    destination=dst,
                    src_nodata=ds.nodata,
                    dst_transform=rasterio.transform.from_bounds(xy.left, xy.bottom, xy.right, xy.top, 256, 256),
                    dst_crs="EPSG:3857",
                    dst_nodata=0,
                    resampling=Resampling.bilinear,
                )
                dst = np.where(np.isfinite(dst) & (dst > -100), dst, 0)
                p = out_dir / str(t.z) / str(t.x) / f"{t.y}.png"
                p.parent.mkdir(parents=True, exist_ok=True)
                buf = io.BytesIO()
                Image.fromarray(encode_terrain_rgb(dst), "RGB").save(buf, "PNG", optimize=True)
                p.write_bytes(buf.getvalue())
                n += 1
    return n


def grid_bounds_ll(g) -> tuple[float, float, float, float]:
    h, w = g.shape
    left, top = g.transform * (0, 0)
    right, bottom = g.transform * (w, h)
    xs, ys = utm_to_ll.transform([left, right, left, right], [top, top, bottom, bottom])
    return min(xs), min(ys), max(xs), max(ys)


def main(argv: list[str]) -> int:
    TILES.mkdir(parents=True, exist_ok=True)
    g = load_grid()
    spots = [s for s in read_review() if s.keep.strip().lower() == "yes"]
    terrain = {t["spot_id"]: t for t in json.loads((OUT_DIR / "terrain_scores.json").read_text(encoding="utf-8"))}

    zones = build_zones(spots, terrain, g)
    write_geojson(zones, TILES / "zones.geojson")
    n_vt = write_zones_pmtiles(zones, TILES / "zones.pmtiles")
    areas = sorted(z["area_m2"] for z in zones)
    print(f"구역 {len(zones)}개 (면적 {areas[0]}~{areas[-1]} m², 중앙값 {areas[len(areas) // 2]} m²) → zones.pmtiles 타일 {n_vt}개")

    dem_raw = RAW / SOURCES[0].url.rsplit("/", 1)[-1]
    n_t = write_terrain_tiles(dem_raw, grid_bounds_ll(g), TILES / "terrain")
    print(f"지형 terrain-RGB 타일 {n_t}개 (z{min(TERRAIN_ZOOMS)}~{max(TERRAIN_ZOOMS)}) → out/tiles/terrain/")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
