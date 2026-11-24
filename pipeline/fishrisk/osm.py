"""1단계 1번: OpenStreetMap에서 낚시 포인트 후보와 퇴로 기준점(주차장)을 뽑는다.

    python -m fishrisk.osm            # pipeline/ 에서 실행. out/spot_candidates.geojson 생성

후보는 사람이 검수한 뒤 spots 테이블에 넣는다. 이 단계의 이름은 OSM 원문(대개 영어)이며
화면용 한국어 이름은 검수 때 정한다.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import AOI, BBox, is_excluded

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "fishing-risk-map-pipeline/0.1"
OUT_DIR = Path(__file__).resolve().parents[1] / "out"


def build_query(box: BBox = AOI) -> str:
    b = f"{box.south},{box.west},{box.north},{box.east}"
    return f"""
[out:json][timeout:60];
(
  nwr["man_made"~"^(breakwater|groyne|pier)$"]({b});
  nwr["natural"~"^(beach|bare_rock|rock|shingle)$"]({b});
  nwr["wetland"="tidalflat"]({b});
  nwr["natural"="wetland"]["tidal"="yes"]({b});
  nwr["leisure"~"^(fishing|slipway)$"]({b});
  nwr["amenity"="parking"]({b});
);
out center tags;
""".strip()


@dataclass(frozen=True)
class Candidate:
    osm_id: str  # 예: "way/123456"
    kind: str  # spot 후보면 SpotType, 주차장이면 "parking", 판단 불가면 "unknown"
    name: str
    lat: float
    lng: float
    tags: dict
    excluded: str | None  # 제외 구역 이름


def classify(tags: dict) -> str | None:
    """OSM 태그를 SpotType 또는 "parking"/"unknown"으로. 관심 없는 요소는 None."""
    man_made = tags.get("man_made")
    natural = tags.get("natural")
    if man_made in ("breakwater", "groyne"):
        return "jetty"
    if man_made == "pier":
        # 부잔교·선착장(floating)도 pier로 본다.
        return "pier"
    if natural in ("beach", "shingle"):
        return "beach"
    if natural in ("bare_rock", "rock"):
        return "rocks"
    if tags.get("wetland") == "tidalflat" or (natural == "wetland" and tags.get("tidal") == "yes"):
        return "estuary"
    if tags.get("amenity") == "parking":
        return "parking"
    if tags.get("leisure") in ("fishing", "slipway"):
        return "unknown"
    return None


def _position(el: dict) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    if c:
        return c["lat"], c["lon"]
    return None


def parse(payload: dict, box: BBox = AOI) -> list[Candidate]:
    out: list[Candidate] = []
    seen: set[str] = set()
    for el in payload.get("elements", []):
        tags = el.get("tags") or {}
        kind = classify(tags)
        pos = _position(el)
        if kind is None or pos is None:
            continue
        lat, lng = pos
        if not box.contains(lat, lng):
            continue
        osm_id = f"{el['type']}/{el['id']}"
        if osm_id in seen:
            continue
        seen.add(osm_id)
        out.append(
            Candidate(
                osm_id=osm_id,
                kind=kind,
                name=tags.get("name", ""),
                lat=round(lat, 6),
                lng=round(lng, 6),
                tags=tags,
                excluded=is_excluded(lat, lng),
            )
        )
    out.sort(key=lambda c: (c.kind, -c.lat, c.lng))
    return out


def to_geojson(cands: list[Candidate]) -> dict:
    features = []
    for c in cands:
        props = asdict(c)
        props.pop("lat")
        props.pop("lng")
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [c.lng, c.lat]},
                "properties": props,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def fetch(query: str, url: str = OVERPASS_URL, timeout: int = 90) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def main(argv: list[str]) -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw = fetch(build_query())
    (OUT_DIR / "osm_raw.json").write_text(json.dumps(raw), encoding="utf-8")
    cands = parse(raw)
    path = OUT_DIR / "spot_candidates.geojson"
    path.write_text(json.dumps(to_geojson(cands), ensure_ascii=False, indent=1), encoding="utf-8")

    counts: dict[str, int] = {}
    for c in cands:
        if not c.excluded:
            counts[c.kind] = counts.get(c.kind, 0) + 1
    spots = sum(v for k, v in counts.items() if k not in ("parking",))
    print(f"후보 {len(cands)}개 저장: {path}")
    print("종류별(제외 구역 뺌):", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    print(f"포인트 후보(주차장 제외): {spots}개, 제외 구역: {sum(1 for c in cands if c.excluded)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
