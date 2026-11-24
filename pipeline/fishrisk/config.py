"""시범 지역과 공통 상수. 값의 출처는 docs/roles/developer-a-data-risk.md."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def contains(self, lat: float, lng: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lng <= self.east


# 오리건주 뉴포트: 야퀴나 헤드 ~ 사우스 비치, 남북 약 9 km
AOI = BBox(west=-124.10, south=44.59, east=-124.02, north=44.69)

# 지표 계산 반경과 격자
SPOT_RADIUS_M = 500
GRID_RESOLUTION_M = 30

# 예보 격자 셀 크기(도)
FORECAST_CELL_DEG = 0.05

# NOAA 조위 관측소: South Beach, Yaquina River
NOAA_STATION_ID = "9435380"

# 낚시 허용 여부를 확인하기 전까지 포인트에서 빼는 구역(대략적 범위)
EXCLUDED_AREAS: dict[str, BBox] = {
    "yaquina-head": BBox(west=-124.090, south=44.670, east=-124.060, north=44.685),
}


def _snap(value: float, step: float) -> float:
    # 0.5에서 항상 위로 올린다(파이썬 round의 짝수 반올림을 피한다).
    return math.floor(value / step + 0.5) * step


def cell_id(lat: float, lng: float, step: float = FORECAST_CELL_DEG) -> str:
    """좌표가 속한 예보 격자 셀 id. 예: (44.6131, -124.0712) -> "44.60_-124.05"."""
    snapped_lat = _snap(lat, step)
    snapped_lng = _snap(lng, step)
    # -0.00 같은 표기를 피한다.
    return f"{snapped_lat + 0.0:.2f}_{snapped_lng + 0.0:.2f}"


def is_excluded(lat: float, lng: float) -> str | None:
    """제외 구역 안이면 그 구역 이름, 아니면 None."""
    for name, box in EXCLUDED_AREAS.items():
        if box.contains(lat, lng):
            return name
    return None
