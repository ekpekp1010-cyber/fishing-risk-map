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

OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
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
out geom;
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
    # 선·면 요소의 꼭짓점 [(lat, lng), ...]. 관계(relation)는 outer 구성원을 이어 붙인다.
    geometry: tuple[tuple[float, float], ...] = ()


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


def _geometry(el: dict) -> list[tuple[float, float]]:
    if "geometry" in el:
        return [(p["lat"], p["lon"]) for p in el["geometry"] if p]
    pts: list[tuple[float, float]] = []
    for m in el.get("members", []):
        if m.get("role", "outer") in ("outer", "") and "geometry" in m:
            pts.extend((p["lat"], p["lon"]) for p in m["geometry"] if p)
    return pts


def _position(el: dict, geom: list[tuple[float, float]]) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    if c:
        return c["lat"], c["lon"]
    b = el.get("bounds")
    if not geom and b:
        return (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
    if geom:
        # 꼭짓점 평균(면은 대략적인 중심, 선은 중간쯤)
        return sum(p[0] for p in geom) / len(geom), sum(p[1] for p in geom) / len(geom)
    return None


def parse(payload: dict, box: BBox = AOI) -> list[Candidate]:
    out: list[Candidate] = []
    seen: set[str] = set()
    for el in payload.get("elements", []):
        tags = el.get("tags") or {}
        kind = classify(tags)
        # 시범 지역 밖으로 길게 이어진 해변·갯벌은 지역 안의 꼭짓점만 쓴다.
        geom = [p for p in _geometry(el) if box.contains(*p)]
        pos = _position(el, geom)
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
                geometry=tuple((round(a, 6), round(b, 6)) for a, b in geom),
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
        props.pop("geometry")
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [c.lng, c.lat]},
                "properties": props,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def fetch(query: str, urls: tuple[str, ...] = OVERPASS_URLS, timeout: int = 90) -> dict:
    """공개 Overpass 서버를 차례로 시도한다(일시적인 502·504가 잦다)."""
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for url in urls:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except Exception as e:  # noqa: BLE001 - 다음 서버로 넘어간다
            print(f"Overpass 실패({url}): {e}", file=sys.stderr)
            last = e
    raise RuntimeError("모든 Overpass 서버가 실패했다") from last


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
