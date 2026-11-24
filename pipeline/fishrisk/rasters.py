"""1단계 2번: 위성·지형 원본을 내려받아 시범 지역 하나의 30 m 격자(UTM 10N)로 맞춘다.

    python -m fishrisk.rasters        # pipeline/ 에서 실행

결과: data/grid/{dem,cover,occurrence,seasonality}.tif (같은 격자, 같은 크기)
원본은 data/raw/, 격자는 data/grid/ 에 두며 둘 다 커밋하지 않는다(.gitignore).
"""

from __future__ import annotations

import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds

from .config import AOI, GRID_RESOLUTION_M

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
GRID = ROOT / "data" / "grid"

CRS = "EPSG:32610"  # UTM 10N
# 파랑 노출(바다 쪽 열린 거리)을 재려면 서쪽 바다가 충분히 있어야 한다.
BUFFER_M = {"west": 8000, "east": 2000, "south": 2000, "north": 2000}


@dataclass(frozen=True)
class Source:
    key: str
    url: str
    resampling: Resampling
    nodata: float
    dtype: str
    year: int  # 제작·관측 기준 연도(terrain_scores.data_vintage)


SOURCES = [
    Source(
        "dem",
        "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N44_00_W125_00_DEM/"
        "Copernicus_DSM_COG_10_N44_00_W125_00_DEM.tif",
        Resampling.bilinear,
        -9999.0,
        "float32",
        2021,
    ),
    Source(
        "cover",
        "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42W126_Map.tif",
        Resampling.mode,
        0,
        "uint8",
        2021,
    ),
    Source(
        "occurrence",
        "https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_130W_50Nv1_4_2021.tif",
        Resampling.average,
        255,
        "uint8",
        2021,
    ),
    Source(
        "seasonality",
        "https://storage.googleapis.com/global-surface-water/downloads2021/seasonality/seasonality_130W_50Nv1_4_2021.tif",
        Resampling.mode,
        255,
        "uint8",
        2021,
    ),
]


def grid_spec(res: float = GRID_RESOLUTION_M):
    """AOI+여유를 덮는 UTM 격자(transform, width, height)."""
    w, s, e, n = transform_bounds("EPSG:4326", CRS, AOI.west, AOI.south, AOI.east, AOI.north)
    w -= BUFFER_M["west"]
    e += BUFFER_M["east"]
    s -= BUFFER_M["south"]
    n += BUFFER_M["north"]
    w, s = np.floor(w / res) * res, np.floor(s / res) * res
    e, n = np.ceil(e / res) * res, np.ceil(n / res) * res
    width, height = int((e - w) / res), int((n - s) / res)
    return from_origin(w, n, res, res), width, height


def download(src: Source) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / src.url.rsplit("/", 1)[-1]
    if path.exists() and path.stat().st_size > 0:
        return path
    tmp = path.with_suffix(".part")
    req = urllib.request.Request(src.url, headers={"User-Agent": "fishing-risk-map-pipeline/0.1"})
    with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(path)
    return path


def warp_to_grid(src_path: Path, src: Source, out_path: Path) -> None:
    transform, width, height = grid_spec()
    dst = np.full((height, width), src.nodata, dtype=src.dtype)
    with rasterio.open(src_path) as ds:
        reproject(
            source=rasterio.band(ds, 1),
            destination=dst,
            src_nodata=ds.nodata,
            dst_transform=transform,
            dst_crs=CRS,
            dst_nodata=src.nodata,
            resampling=src.resampling,
        )
    profile = {
        "driver": "GTiff",
        "width": width,
        "height": height,
        "count": 1,
        "dtype": src.dtype,
        "crs": CRS,
        "transform": transform,
        "nodata": src.nodata,
        "compress": "deflate",
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **profile) as out:
        out.write(dst, 1)


def main(argv: list[str]) -> int:
    meta = {}
    for src in SOURCES:
        raw = download(src)
        out = GRID / f"{src.key}.tif"
        warp_to_grid(raw, src, out)
        with rasterio.open(out) as ds:
            a = ds.read(1, masked=True)
            meta[src.key] = {"file": raw.name, "year": src.year, "min": float(a.min()), "max": float(a.max())}
        print(f"{src.key}: {raw.name} → {out.relative_to(ROOT)}  범위 {meta[src.key]['min']:.1f}~{meta[src.key]['max']:.1f}")
    (GRID / "sources.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    t, w, h = grid_spec()
    print(f"격자 {w}×{h} ({GRID_RESOLUTION_M} m, {CRS})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
